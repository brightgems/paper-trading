const Transaction = require('../models/Transaction');
const Portfolio = require('../models/Portfolio');
const User = require('../models/User');
const MarketDataService = require('../services/marketData');

function normalizeSymbol(sym) {
    let s = sym.toUpperCase().trim();
    if (s.includes('.')) return s;
    // 美股: 字母代码
    if (/^[A-Z]+$/.test(s)) return `${s}.US`;
    // 港股: 5位数字
    if (/^\d{5}$/.test(s) && s.startsWith('0')) return `${s}.HK`;
    if (s.startsWith('6') || s.startsWith('5') || s.startsWith('11') || s.startsWith('13')) return `${s}.SH`;
    if (s.startsWith('0') || s.startsWith('3') || s.startsWith('12')) return `${s}.SZ`;
    if (s.startsWith('8') || s.startsWith('4')) return `${s}.BJ`;
    return `${s}.SZ`;
}

// 判断是否A股 (需要100股整手+T+1)
function isAStock(sym) {
    return sym.endsWith('.SH') || sym.endsWith('.SZ') || sym.endsWith('.BJ');
}

// 计算交易成本
function calcCost(amount, isBuy, settings, sym) {
    const s = settings || {};
    // 美股/港股: 佣金无最低5元限制, 无印花税/过户费
    if (!isAStock(sym)) {
        const commRate = s.commissionRate || 0.00025;
        const comm = Math.max(amount * commRate, 1); // 最低$1或等值
        return { commission: comm, transferFee: 0, stampDuty: 0, total: comm };
    }
    // A股: 佣金+印花税+过户费
    const commRate = s.commissionRate || 0.00025;
    const minComm = s.minCommission || 5;
    const transferRate = s.transferFeeRate || 0.00002;
    const stampRate = s.stampDutyRate || 0.001;
    const comm = Math.max(amount * commRate, minComm);
    const transfer = amount * transferRate;
    const stampDuty = isBuy ? 0 : amount * stampRate;
    return { commission: comm, transferFee: transfer, stampDuty, total: comm + transfer + stampDuty };
}

// 买入
exports.buyStock = async (req, res) => {
    try {
        const { symbol, quantity, tpin } = req.body;
        const sym = normalizeSymbol(symbol);
        const qty = Number(quantity);

        const user = await User.findById(req.user._id).select('+tpin');
        if (!await user.matchTpin(tpin)) {
            return res.status(401).json({ message: '交易密码错误' });
        }

        // A股需要100股整手, 美股/港股可零买
        const lotSize = isAStock(sym) ? (user.tradeSettings?.lotSize || 100) : 1;
        if (qty <= 0 || qty % lotSize !== 0) {
            return res.status(400).json({ message: isAStock(sym) ? `买入数量必须是${lotSize}股的整数倍` : '买入数量必须大于0' });
        }

        const price = await MarketDataService.getRealTimePrice(sym);
        const amount = price * qty;
        const costs = calcCost(amount, true, user.tradeSettings, sym);
        const totalCost = amount + costs.total;

        if (user.balance < totalCost) {
            return res.status(400).json({ message: '资金不足', balance: user.balance, need: totalCost });
        }

        user.balance -= totalCost;
        await user.save();

        await Transaction.create({
            user: req.user._id, symbol: sym, quantity: qty, price,
            type: 'BUY', totalAmount: amount, cost: costs.total,
        });

        let portfolioItem = await Portfolio.findOne({ user: req.user._id, symbol: sym });
        if (portfolioItem) {
            const totalInvested = (portfolioItem.quantity * portfolioItem.avgPrice) + amount;
            const newQty = portfolioItem.quantity + qty;
            portfolioItem.avgPrice = totalInvested / newQty;
            portfolioItem.quantity = newQty;
            // T+1: 新买的不加入availableQuantity
            await portfolioItem.save();
        } else {
            await Portfolio.create({
                user: req.user._id, symbol: sym, quantity: qty,
                availableQuantity: 0, avgPrice: price,
            });
        }

        res.status(200).json({
            message: `成功买入 ${qty} 股 ${sym}`,
            symbol: sym, price, amount: amount.toFixed(2),
            cost: costs.total.toFixed(2), total: totalCost.toFixed(2),
            balance: user.balance
        });
    } catch (error) {
        console.error('Buy error:', error);
        res.status(500).json({ message: '服务器错误' });
    }
};

// 卖出
exports.sellStock = async (req, res) => {
    try {
        const { symbol, quantity, tpin } = req.body;
        const sym = normalizeSymbol(symbol);
        const qty = Number(quantity);

        const user = await User.findById(req.user._id).select('+tpin');
        if (!await user.matchTpin(tpin)) {
            return res.status(401).json({ message: '交易密码错误' });
        }

        // A股需要100股整手, 美股/港股可零卖
        const lotSize = isAStock(sym) ? (user.tradeSettings?.lotSize || 100) : 1;
        if (qty <= 0 || qty % lotSize !== 0) {
            return res.status(400).json({ message: isAStock(sym) ? `卖出数量必须是${lotSize}股的整数倍` : '卖出数量必须大于0' });
        }

        let portfolioItem = await Portfolio.findOne({ user: req.user._id, symbol: sym });
        if (!portfolioItem || portfolioItem.quantity < qty) {
            return res.status(400).json({ message: '持仓不足' });
        }

        // T+1检查 (仅A股)
        if (isAStock(sym) && user.tradeSettings?.tPlus1 && (portfolioItem.availableQuantity || 0) < qty) {
            return res.status(400).json({
                message: `T+1限制: 可卖 ${portfolioItem.availableQuantity || 0} 股`,
                available: portfolioItem.availableQuantity || 0
            });
        }

        const price = await MarketDataService.getRealTimePrice(sym);
        const amount = price * qty;
        const costs = calcCost(amount, false, user.tradeSettings, sym);
        const netProceeds = amount - costs.total;

        user.balance += netProceeds;
        await user.save();

        await Transaction.create({
            user: req.user._id, symbol: sym, quantity: qty, price,
            type: 'SELL', totalAmount: amount, cost: costs.total,
        });

        portfolioItem.quantity -= qty;
        portfolioItem.availableQuantity = (portfolioItem.availableQuantity || 0) - qty;
        if (portfolioItem.quantity <= 0) {
            await Portfolio.deleteOne({ _id: portfolioItem._id });
        } else {
            await portfolioItem.save();
        }

        res.status(200).json({
            message: `成功卖出 ${qty} 股 ${sym}`,
            symbol: sym, price, amount: amount.toFixed(2),
            cost: costs.total.toFixed(2), net: netProceeds.toFixed(2),
            balance: user.balance
        });
    } catch (error) {
        console.error('Sell error:', error);
        res.status(500).json({ message: '服务器错误' });
    }
};

// 持仓
exports.getPortfolio = async (req, res) => {
    try {
        const holdings = await Portfolio.find({ user: req.user._id });
        const user = await User.findById(req.user._id);

        const enriched = await Promise.all(holdings.map(async (h) => {
            let quoteData = { price: 0, change: 0, changePercent: 0, name: h.symbol };
            let sparklineData = [];
            try {
                quoteData = await MarketDataService.getFullQuote(h.symbol);
                sparklineData = await MarketDataService.getChartData(h.symbol, '1d');
            } catch (e) { }
            const currentPrice = quoteData.price || 0;
            const currentValue = currentPrice * h.quantity;
            const pnl = currentValue - (h.avgPrice * h.quantity);
            const pnlPercentage = h.avgPrice > 0 ? (pnl / (h.avgPrice * h.quantity)) * 100 : 0;
            const dayChange = (quoteData.change || 0) * h.quantity;

            return {
                ...h.toObject(),
                currentPrice,
                currentValue,
                pnl,
                pnlPercentage,
                dayChange,
                dayChangePercent: quoteData.changePercent,
                name: quoteData.name || h.symbol,
                sparkline: sparklineData
            };
        }));

        const totalMarketValue = enriched.reduce((s, h) => s + h.currentValue, 0);
        const totalInvested = enriched.reduce((s, h) => s + (h.avgPrice * h.quantity), 0);
        const totalProfit = totalMarketValue - totalInvested;

        res.status(200).json({
            holdings: enriched,
            summary: {
                cash: user.balance,
                totalMarketValue,
                totalInvested,
                totalProfit,
                totalProfitPercent: totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0,
                totalAssets: user.balance + totalMarketValue,
            }
        });
    } catch (error) {
        console.error('Portfolio error:', error);
        res.status(500).json({ message: '服务器错误' });
    }
};

// 交易记录
exports.getTransactions = async (req, res) => {
    try {
        const txns = await Transaction.find({ user: req.user._id }).sort({ date: -1 }).limit(100);
        res.status(200).json(txns);
    } catch (error) {
        res.status(500).json({ message: '服务器错误' });
    }
};

// 搜索
exports.searchSymbol = async (req, res) => {
    try {
        const results = await MarketDataService.searchSymbol(req.params.query);
        res.status(200).json(results);
    } catch (error) {
        res.json([]);
    }
};

// 实时价格
exports.getPrice = async (req, res) => {
    try {
        const quote = await MarketDataService.getFullQuote(req.params.symbol);
        res.status(200).json(quote);
    } catch (error) {
        res.status(500).json({ message: '服务器错误' });
    }
};

// K线
exports.getCandles = async (req, res) => {
    try {
        const range = req.query.range || '1M';
        const data = await MarketDataService.getChartData(req.params.symbol, range);
        res.status(200).json(data);
    } catch (error) {
        res.json([]);
    }
};

// 指数
exports.getIndices = async (req, res) => {
    try {
        const data = await MarketDataService.getIndices();
        res.status(200).json(data);
    } catch (error) {
        res.json([]);
    }
};

// 涨跌榜
exports.getScreeners = async (req, res) => {
    try {
        const type = req.query.type || 'gainers';
        const data = await MarketDataService.getScreeners(type);
        res.status(200).json(data);
    } catch (error) {
        res.json([]);
    }
};

// 公司资料
exports.getCompanyProfile = async (req, res) => {
    try {
        const data = await MarketDataService.getCompanyProfile(req.params.symbol);
        res.status(200).json(data);
    } catch (error) {
        res.json({});
    }
};

// 财务数据
exports.getFinancials = async (req, res) => {
    try {
        const data = await MarketDataService.getFinancials(req.params.symbol);
        res.status(200).json(data);
    } catch (error) {
        res.json({});
    }
};

// 市场新闻
exports.getMarketNews = async (req, res) => {
    try {
        const data = await MarketDataService.getMarketNews();
        res.status(200).json(data);
    } catch (error) {
        res.json([]);
    }
};

// 个股新闻
exports.getNews = async (req, res) => {
    try {
        const data = await MarketDataService.getCompanyNews(req.params.symbol);
        res.status(200).json(data);
    } catch (error) {
        res.json([]);
    }
};

// 推荐
exports.getRecommendations = async (req, res) => {
    res.status(200).json([]);
};

// 止损
exports.setStopLoss = async (req, res) => {
    try {
        const { symbol, type, value } = req.body;
        const sym = normalizeSymbol(symbol);
        if (!sym || !type || !value) {
            return res.status(400).json({ message: '参数缺失' });
        }

        const portfolioItem = await Portfolio.findOne({ user: req.user._id, symbol: sym });
        if (!portfolioItem) {
            return res.status(404).json({ message: '无持仓' });
        }

        const currentPrice = await MarketDataService.getRealTimePrice(sym);
        let stopPrice = 0;
        if (type === 'price') {
            stopPrice = parseFloat(value);
        } else if (type === 'percent') {
            stopPrice = currentPrice * (1 - (parseFloat(value) / 100));
        }

        portfolioItem.stopLossType = type;
        portfolioItem.stopLossValue = value;
        portfolioItem.stopLossPrice = stopPrice;
        portfolioItem.stopLossActive = true;
        await portfolioItem.save();

        res.status(200).json({
            message: `止损设置: ${sym} ¥${stopPrice.toFixed(2)}`,
            stopLossPrice: stopPrice
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: '服务器错误' });
    }
};
