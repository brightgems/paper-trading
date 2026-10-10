/**
 * Rebalance Engine
 *
 * Core engine for the multi-strategy paper trading simulator.
 * Flow:
 *   1. Get latest signals for strategy
 *   2. Get current holdings (latest trade_date)
 *   3. Get current prices from marketData service
 *   4. Check stop loss / take profit (always runs)
 *   5. Check position discipline (>=80% → Monday only for rebalance, max 5 trades)
 *   6. Sell holdings not in signal list (reason='rebalance')
 *   7. Buy new signal stocks not held (reason='rebalance', respect max 5 on Monday)
 *   8. Calculate costs (commission, stamp tax, transfer fee)
 *   9. Update holdings, insert transactions, snapshot NAV
 *
 * A-share rules: T+1, lot size 100, commission 0.00025 (min 5),
 *   stamp tax 0.001 (sell only), transfer fee 0.00002 (SH only)
 */

const { getDB } = require('../config/db');
const MarketDataService = require('./marketData');
const { loadSignals } = require('./signalLoader');

// ─── Constants ──────────────────────────────────────────────

const LOT_SIZE = 100;
const COMMISSION_RATE = 0.00025;
const MIN_COMMISSION = 5;
const STAMP_TAX_RATE = 0.001;       // sell only
const TRANSFER_FEE_RATE = 0.00002;  // SH only
const POSITION_THRESHOLD = 0.80;    // 80%
const MAX_REBALANCE_TRADES = 5;

// ─── Utilities ──────────────────────────────────────────────

function todayStr() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
}

function isMonday(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return d.getDay() === 1;
}

function isASHare(symbol) {
    return symbol.endsWith('.SH') || symbol.endsWith('.SZ') || symbol.endsWith('.BJ');
}

function isSH(symbol) {
    return symbol.endsWith('.SH');
}

/**
 * Calculate transaction costs for A-share trades.
 * @param {number} amount — trade amount (price × quantity)
 * @param {boolean} isBuy
 * @param {string} symbol
 * @returns {{commission, stampTax, transferFee, total}}
 */
function calcCosts(amount, isBuy, symbol) {
    if (!isASHare(symbol)) {
        const comm = Math.max(amount * COMMISSION_RATE, 1);
        return { commission: comm, stampTax: 0, transferFee: 0, total: comm };
    }
    const commission = Math.max(amount * COMMISSION_RATE, MIN_COMMISSION);
    const transferFee = isSH(symbol) ? amount * TRANSFER_FEE_RATE : 0;
    const stampTax = isBuy ? 0 : amount * STAMP_TAX_RATE;
    return { commission, stampTax, transferFee, total: commission + transferFee + stampTax };
}

/**
 * Round down to nearest lot size.
 */
function roundToLot(qty) {
    return Math.floor(qty / LOT_SIZE) * LOT_SIZE;
}

// ─── DB helpers ─────────────────────────────────────────────

function getStrategy(strategyId) {
    const db = getDB();
    return db.prepare('SELECT * FROM strategies WHERE id = ?').get(strategyId);
}

function getLatestHoldings(strategyId) {
    const db = getDB();
    const latest = db.prepare(`
        SELECT trade_date FROM holdings WHERE strategy_id = ? ORDER BY trade_date DESC LIMIT 1
    `).get(strategyId);
    if (!latest) return [];
    return db.prepare(`
        SELECT * FROM holdings WHERE strategy_id = ? AND trade_date = ?
    `).all(strategyId, latest.trade_date);
}

function getLatestNav(strategyId) {
    const db = getDB();
    return db.prepare(`
        SELECT * FROM nav_snapshots WHERE strategy_id = ?
        ORDER BY trade_date DESC LIMIT 1
    `).get(strategyId);
}

function getAllNavSnapshots(strategyId) {
    const db = getDB();
    return db.prepare(`
        SELECT * FROM nav_snapshots WHERE strategy_id = ? ORDER BY trade_date ASC
    `).all(strategyId);
}

// ─── NAV Calculation ────────────────────────────────────────

/**
 * Calculate and insert a NAV snapshot for the given date.
 * Computes total_assets, market_value, position_ratio, daily_return,
 * cumulative_return, max_drawdown, sharpe.
 */
function snapshotNAV(strategyId, tradeDate, cash, holdings, benchmarkReturn = 0) {
    const db = getDB();
    const strategy = getStrategy(strategyId);
    if (!strategy) throw new Error(`Strategy not found: ${strategyId}`);

    const marketValue = holdings.reduce((sum, h) => sum + h.market_value, 0);
    const totalAssets = cash + marketValue;
    const positionRatio = totalAssets > 0 ? marketValue / totalAssets : 0;
    const initialCapital = strategy.initial_capital || 1000000;

    // Previous NAV for daily return
    const prevNav = getLatestNav(strategyId);
    const prevTotal = prevNav ? prevNav.total_assets : initialCapital;
    const dailyReturn = prevTotal > 0 ? (totalAssets - prevTotal) / prevTotal : 0;
    const cumulativeReturn = initialCapital > 0 ? (totalAssets - initialCapital) / initialCapital : 0;

    // Max drawdown (running): find peak so far
    const allNavs = getAllNavSnapshots(strategyId);
    const peaks = allNavs.map(n => n.total_assets).concat([totalAssets]);
    let peak = initialCapital;
    for (const p of peaks) { if (p > peak) peak = p; }
    const maxDrawdown = peak > 0 ? (totalAssets - peak) / peak : 0;

    // Sharpe ratio (annualized, from daily returns, rf=0)
    const dailyReturns = allNavs.map(n => n.daily_return).concat([dailyReturn]);
    const sharpe = calcSharpe(dailyReturns);

    // Upsert nav snapshot
    db.prepare(`
        INSERT INTO nav_snapshots
            (strategy_id, trade_date, total_assets, cash, market_value, position_ratio,
             daily_return, cumulative_return, benchmark_return, excess_return, max_drawdown, sharpe)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(strategy_id, trade_date) DO UPDATE SET
            total_assets=excluded.total_assets, cash=excluded.cash, market_value=excluded.market_value,
            position_ratio=excluded.position_ratio, daily_return=excluded.daily_return,
            cumulative_return=excluded.cumulative_return, benchmark_return=excluded.benchmark_return,
            excess_return=excluded.excess_return, max_drawdown=excluded.max_drawdown, sharpe=excluded.sharpe
    `).run(
        strategyId, tradeDate, totalAssets, cash, marketValue, positionRatio,
        dailyReturn, cumulativeReturn, benchmarkReturn, cumulativeReturn - benchmarkReturn,
        maxDrawdown, sharpe
    );

    return { totalAssets, cash, marketValue, positionRatio, dailyReturn, cumulativeReturn, maxDrawdown, sharpe };
}

/**
 * Calculate annualized Sharpe ratio from daily returns.
 * 252 trading days per year, risk-free rate = 0.
 */
function calcSharpe(dailyReturns) {
    if (!dailyReturns || dailyReturns.length < 2) return 0;
    const valid = dailyReturns.filter(r => r !== 0 && !isNaN(r));
    if (valid.length < 2) return 0;
    const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
    const variance = valid.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / valid.length;
    const std = Math.sqrt(variance);
    if (std === 0) return 0;
    return (mean / std) * Math.sqrt(252);
}

// ─── Trade Execution ────────────────────────────────────────

/**
 * Execute a virtual sell trade.
 * Updates holdings quantity, records transaction.
 * @returns {{amount, costs, quantity}}
 */
function executeSell(strategyId, tradeDate, holding, sellQty, reason, price) {
    const db = getDB();
    const symbol = holding.symbol;
    const qty = Math.min(sellQty, holding.available_quantity);
    if (qty <= 0) return null;

    const amount = qty * price;
    const costs = calcCosts(amount, false, symbol);
    const netAmount = amount - costs.commission - costs.stampTax - costs.transferFee;

    // Record transaction
    db.prepare(`
        INSERT INTO transactions
            (strategy_id, trade_date, symbol, name, side, quantity, price, amount,
             commission, stamp_tax, transfer_fee, reason, signal_rank)
        VALUES (?, ?, ?, ?, 'sell', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        strategyId, tradeDate, symbol, holding.name, qty, price, amount,
        costs.commission, costs.stampTax, costs.transferFee, reason, holding.signal_rank || null
    );

    return { amount, costs, quantity: qty, netAmount };
}

/**
 * Execute a virtual buy trade.
 * Records transaction (holdings updated after in batch).
 * @returns {{amount, costs, quantity}}
 */
function executeBuy(strategyId, tradeDate, symbol, name, buyQty, price, reason, rank) {
    const db = getDB();
    if (buyQty <= 0) return null;

    const amount = buyQty * price;
    const costs = calcCosts(amount, true, symbol);
    const totalCost = amount + costs.commission + costs.transferFee;

    // Record transaction
    db.prepare(`
        INSERT INTO transactions
            (strategy_id, trade_date, symbol, name, side, quantity, price, amount,
             commission, stamp_tax, transfer_fee, reason, signal_rank)
        VALUES (?, ?, ?, ?, 'buy', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        strategyId, tradeDate, symbol, name, buyQty, price, amount,
        costs.commission, costs.stampTax, costs.transferFee, reason, rank || null
    );

    return { amount, costs, quantity: buyQty, totalCost };
}

// ─── Update Holdings (batch) ────────────────────────────────

/**
 * Replace all holdings for a strategy on a given date with the current snapshot.
 */
function updateHoldings(strategyId, tradeDate, newHoldings) {
    const db = getDB();
    // Delete existing holdings for this date (in case of re-run)
    db.prepare('DELETE FROM holdings WHERE strategy_id = ? AND trade_date = ?')
      .run(strategyId, tradeDate);

    const stmt = db.prepare(`
        INSERT INTO holdings
            (strategy_id, trade_date, symbol, name, quantity, available_quantity,
             cost_price, current_price, market_value, profit_pct, weight)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = db.transaction((items) => {
        for (const h of items) {
            stmt.run(
                strategyId, tradeDate, h.symbol, h.name,
                h.quantity, h.available_quantity,
                h.cost_price, h.current_price, h.market_value,
                h.profit_pct, h.weight
            );
        }
    });
    tx(newHoldings);
}

// ─── Seed Strategies ────────────────────────────────────────

const SEED_STRATEGIES = [
    {
        id: 'hs300_top50',
        name: '沪深300 Top-50',
        description: '沪深300成分股因子打分Top-50策略',
        initial_capital: 1000000,
        signal_source: 'top10_csv',
        signal_config: JSON.stringify({ csv_path: '/git/quant_factors/results/paper_top10.csv', top_k: 10 }),
        rebalance_rule: JSON.stringify({ frequency: 'weekly', day: 'monday', max_trades: 5 }),
        stop_loss: -5.0,
        take_profit: 15.0,
        benchmark: '000300.SH',
        status: 'active',
    },
    {
        id: 'all_market_top10',
        name: '全市场 Top-10',
        description: '全市场因子打分Top-10策略',
        initial_capital: 1000000,
        signal_source: 'top10_csv',
        signal_config: JSON.stringify({ csv_path: '/git/quant_factors/results/paper_top10.csv', top_k: 10 }),
        rebalance_rule: JSON.stringify({ frequency: 'weekly', day: 'monday', max_trades: 5 }),
        stop_loss: -7.0,
        take_profit: 20.0,
        benchmark: '000985.CSI',
        status: 'active',
    },
    {
        id: 'hs300_equal_weight',
        name: '沪深300等权基准',
        description: '沪深300等权买入持有基准',
        initial_capital: 1000000,
        signal_source: 'none',
        signal_config: JSON.stringify({}),
        rebalance_rule: JSON.stringify({ frequency: 'none' }),
        stop_loss: -100,  // no stop loss
        take_profit: 100, // no take profit
        benchmark: '000300.SH',
        status: 'active',
    },
];

function seedStrategies() {
    const db = getDB();
    const existing = db.prepare('SELECT COUNT(*) as count FROM strategies').get();
    if (existing.count > 0) return { seeded: false, count: existing.count };

    const stmt = db.prepare(`
        INSERT INTO strategies
            (id, name, description, initial_capital, signal_source, signal_config,
             rebalance_rule, stop_loss, take_profit, benchmark, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = db.transaction((strategies) => {
        for (const s of strategies) {
            stmt.run(
                s.id, s.name, s.description, s.initial_capital,
                s.signal_source, s.signal_config, s.rebalance_rule,
                s.stop_loss, s.take_profit, s.benchmark, s.status
            );
        }
    });
    tx(SEED_STRATEGIES);

    // Initialize NAV for each strategy (cash = initial_capital, no positions)
    const navStmt = db.prepare(`
        INSERT OR IGNORE INTO nav_snapshots
            (strategy_id, trade_date, total_assets, cash, market_value, position_ratio,
             daily_return, cumulative_return, benchmark_return, excess_return, max_drawdown, sharpe)
        VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0)
    `);
    const today = todayStr();
    for (const s of SEED_STRATEGIES) {
        navStmt.run(s.id, today, s.initial_capital, s.initial_capital);
    }

    return { seeded: true, count: SEED_STRATEGIES.length };
}

// ─── Main Rebalance Function ────────────────────────────────

/**
 * Run rebalance for a single strategy.
 * @param {string} strategyId
 * @param {Object} options — { forceRebalance: boolean, date: string }
 * @returns {Object} — { strategyId, tradeDate, actions, nav }
 */
async function rebalance(strategyId, options = {}) {
    const tradeDate = options.date || todayStr();
    const forceRebalance = options.forceRebalance || false;

    const db = getDB();
    const strategy = getStrategy(strategyId);
    if (!strategy) throw new Error(`Strategy not found: ${strategyId}`);
    if (strategy.status !== 'active') {
        return { strategyId, tradeDate, actions: [], nav: null, skipped: 'strategy not active' };
    }

    // Check if already rebalanced today (idempotency)
    const existingNav = db.prepare(`
        SELECT * FROM nav_snapshots WHERE strategy_id = ? AND trade_date = ?
    `).get(strategyId, tradeDate);
    // Allow re-run (upsert), but note it

    // ── 1. Load signals ──
    const signalConfig = JSON.parse(strategy.signal_config || '{}');
    let signals = [];
    if (strategy.signal_source !== 'none') {
        signals = loadSignals(strategy.signal_source, signalConfig);
        // For backtest_import, get today's signals from the date map
        if (strategy.signal_source === 'backtest_import' && !Array.isArray(signals)) {
            signals = signals[tradeDate] || [];
        }
    }
    const signalSymbols = new Set(signals.map(s => s.symbol));

    // ── 2. Get current holdings ──
    let holdings = getLatestHoldings(strategyId);

    // ── 3. Get current prices ──
    const allSymbols = new Set([
        ...holdings.map(h => h.symbol),
        ...signals.map(s => s.symbol),
    ]);

    const priceMap = {};
    for (const sym of allSymbols) {
        try {
            priceMap[sym] = await MarketDataService.getRealTimePrice(sym);
        } catch (e) {
            // Fallback to last known price
            const h = holdings.find(h => h.symbol === sym);
            const s = signals.find(s => s.symbol === sym);
            priceMap[sym] = h ? h.current_price : (s ? s.close : 0);
        }
    }

    // Get current cash from latest NAV
    const latestNav = getLatestNav(strategyId);
    let cash = latestNav ? latestNav.cash : strategy.initial_capital;

    const actions = [];

    // ── 4. Check stop loss / take profit (always runs) ──
    const stopLoss = strategy.stop_loss ?? -5.0;
    const takeProfit = strategy.take_profit ?? 15.0;

    for (const holding of holdings) {
        const currentPrice = priceMap[holding.symbol] || holding.current_price;
        const profitPct = holding.cost_price > 0
            ? ((currentPrice - holding.cost_price) / holding.cost_price) * 100
            : 0;

        if (profitPct <= stopLoss) {
            // Stop loss: sell all available
            const result = executeSell(
                strategyId, tradeDate, holding, holding.available_quantity,
                'stop_loss', currentPrice
            );
            if (result) {
                cash += result.netAmount;
                holding.quantity -= result.quantity;
                holding.available_quantity = 0;
                actions.push({
                    type: 'stop_loss', symbol: holding.symbol,
                    quantity: result.quantity, price: currentPrice,
                    amount: result.amount, profitPct: parseFloat(profitPct.toFixed(2))
                });
            }
        } else if (profitPct >= takeProfit) {
            // Take profit: sell all available
            const result = executeSell(
                strategyId, tradeDate, holding, holding.available_quantity,
                'take_profit', currentPrice
            );
            if (result) {
                cash += result.netAmount;
                holding.quantity -= result.quantity;
                holding.available_quantity = 0;
                actions.push({
                    type: 'take_profit', symbol: holding.symbol,
                    quantity: result.quantity, price: currentPrice,
                    amount: result.amount, profitPct: parseFloat(profitPct.toFixed(2))
                });
            }
        }
    }

    // Clean up zero-quantity holdings
    holdings = holdings.filter(h => h.quantity > 0);

    // ── 5. Position discipline ──
    // Calculate current position ratio
    const currentMarketValue = holdings.reduce((sum, h) => {
        const p = priceMap[h.symbol] || h.current_price;
        return sum + p * h.quantity;
    }, 0);
    const currentTotal = cash + currentMarketValue;
    const positionRatio = currentTotal > 0 ? currentMarketValue / currentTotal : 0;

    let allowRebalance = true;
    if (positionRatio >= POSITION_THRESHOLD && !forceRebalance) {
        // High position: only Monday allows rebalance, max 5 trades
        if (!isMonday(tradeDate)) {
            allowRebalance = false;
        }
    }

    // ── 6 & 7. Rebalance: sell holdings not in signal, buy new signals ──
    if (allowRebalance && strategy.signal_source !== 'none') {
        let rebalanceTradeCount = 0;

        // 6. Sell holdings not in signal list
        for (const holding of holdings) {
            if (!signalSymbols.has(holding.symbol)) {
                if (holding.available_quantity <= 0) continue; // T+1: can't sell today's buy
                if (positionRatio >= POSITION_THRESHOLD && !forceRebalance &&
                    rebalanceTradeCount >= MAX_REBALANCE_TRADES) break;

                const currentPrice = priceMap[holding.symbol] || holding.current_price;
                const result = executeSell(
                    strategyId, tradeDate, holding, holding.available_quantity,
                    'rebalance', currentPrice
                );
                if (result) {
                    cash += result.netAmount;
                    holding.quantity -= result.quantity;
                    holding.available_quantity = 0;
                    rebalanceTradeCount++;
                    actions.push({
                        type: 'rebalance_sell', symbol: holding.symbol,
                        quantity: result.quantity, price: currentPrice, amount: result.amount
                    });
                }
            }
        }

        // Clean up zero-quantity
        holdings = holdings.filter(h => h.quantity > 0);

        // 7. Buy new signal stocks not held
        const heldSymbols = new Set(holdings.map(h => h.symbol));

        for (const signal of signals) {
            if (heldSymbols.has(signal.symbol)) continue;
            if (positionRatio >= POSITION_THRESHOLD && !forceRebalance &&
                rebalanceTradeCount >= MAX_REBALANCE_TRADES) break;

            const price = priceMap[signal.symbol] || signal.close || 0;
            if (price <= 0) continue;

            // Fetch real stock name via marketData (CSV signals have no name column)
            let stockName = signal.name || signal.symbol;
            try {
                const quote = await MarketDataService.getFullQuote(signal.symbol);
                if (quote && quote.name && quote.name !== signal.symbol) {
                    stockName = quote.name;
                }
            } catch (e) { /* fallback to signal name */ }

            // Calculate buy quantity based on weight and available cash
            // Use signal weight to determine allocation
            const totalAssets = cash + holdings.reduce((s, h) => {
                return s + (priceMap[h.symbol] || h.current_price) * h.quantity;
            }, 0);

            const targetAmount = totalAssets * (signal.weight || 0.1);
            const maxAffordable = cash * 0.95; // keep 5% cash buffer
            const buyAmount = Math.min(targetAmount, maxAffordable);
            const rawQty = Math.floor(buyAmount / price);
            const buyQty = roundToLot(rawQty);

            if (buyQty <= 0) continue;

            const result = executeBuy(
                strategyId, tradeDate, signal.symbol,
                stockName, buyQty, price,
                'rebalance', signal.rank
            );
            if (result) {
                cash -= result.totalCost;
                // Add to holdings
                holdings.push({
                    symbol: signal.symbol,
                    name: stockName,
                    quantity: buyQty,
                    available_quantity: 0,  // T+1: not available to sell today
                    cost_price: price,
                    current_price: price,
                    market_value: price * buyQty,
                    profit_pct: 0,
                    weight: signal.weight || 0.1,
                    signal_rank: signal.rank,
                });
                heldSymbols.add(signal.symbol);
                rebalanceTradeCount++;
                actions.push({
                    type: 'rebalance_buy', symbol: signal.symbol,
                    quantity: buyQty, price, amount: result.amount
                });
            }
        }
    }

    // ── 8. Update holdings with current prices ──
    const finalHoldings = holdings.map(h => {
        const price = priceMap[h.symbol] || h.current_price;
        const mv = price * h.quantity;
        const profitPct = h.cost_price > 0
            ? parseFloat(((price - h.cost_price) / h.cost_price * 100).toFixed(2))
            : 0;
        return {
            symbol: h.symbol,
            name: h.name,
            quantity: h.quantity,
            available_quantity: h.quantity,  // All existing holdings become available next day
            cost_price: h.cost_price,
            current_price: price,
            market_value: parseFloat(mv.toFixed(2)),
            profit_pct: profitPct,
            weight: 0, // calculated below
        };
    });

    // Calculate weights
    const totalMV = finalHoldings.reduce((s, h) => s + h.market_value, 0);
    const totalAssets = cash + totalMV;
    for (const h of finalHoldings) {
        h.weight = totalAssets > 0 ? parseFloat((h.market_value / totalAssets).toFixed(4)) : 0;
    }

    // ── 9. Update holdings, snapshot NAV ──
    // For T+1: newly bought stocks have available_quantity=0
    // Re-apply T+1 rule: only pre-existing holdings are available
    const oldSymbols = new Set(getLatestHoldings(strategyId).map(h => h.symbol));
    for (const h of finalHoldings) {
        if (!oldSymbols.has(h.symbol)) {
            h.available_quantity = 0; // Newly bought today, T+1
        }
    }

    updateHoldings(strategyId, tradeDate, finalHoldings);

    // Get benchmark return
    let benchmarkReturn = 0;
    try {
        const indices = await MarketDataService.getIndices();
        const bench = indices.find(i => i.symbol === strategy.benchmark);
        if (bench) benchmarkReturn = bench.changePercent || 0;
    } catch (e) {
        // Benchmark fetch failed, use 0
    }

    const nav = snapshotNAV(strategyId, tradeDate, cash, finalHoldings, benchmarkReturn);

    return {
        strategyId,
        tradeDate,
        actions,
        nav,
        stats: {
            cash: parseFloat(cash.toFixed(2)),
            marketValue: parseFloat(totalMV.toFixed(2)),
            totalAssets: parseFloat(totalAssets.toFixed(2)),
            positionRatio: parseFloat((totalAssets > 0 ? totalMV / totalAssets : 0).toFixed(4)),
            actionCount: actions.length,
        },
    };
}

/**
 * Run rebalance for all active strategies.
 */
async function rebalanceAll(options = {}) {
    const db = getDB();
    const strategies = db.prepare(`
        SELECT id FROM strategies WHERE status = 'active'
    `).all();

    const results = [];
    for (const s of strategies) {
        try {
            const result = await rebalance(s.id, options);
            results.push(result);
        } catch (e) {
            results.push({ strategyId: s.id, error: e.message });
        }
    }
    return results;
}

/**
 * Get engine status: last run, strategy count, position summary.
 */
function getEngineStatus() {
    const db = getDB();
    const strategies = db.prepare('SELECT * FROM strategies').all();
    const status = strategies.map(s => {
        const latestNav = getLatestNav(s.id);
        const latestHoldings = getLatestHoldings(s.id);
        return {
            id: s.id,
            name: s.name,
            status: s.status,
            benchmark: s.benchmark,
            signalSource: s.signal_source,
            totalAssets: latestNav ? latestNav.total_assets : s.initial_capital,
            cash: latestNav ? latestNav.cash : s.initial_capital,
            positionRatio: latestNav ? latestNav.position_ratio : 0,
            dailyReturn: latestNav ? latestNav.daily_return : 0,
            cumulativeReturn: latestNav ? latestNav.cumulative_return : 0,
            maxDrawdown: latestNav ? latestNav.max_drawdown : 0,
            sharpe: latestNav ? latestNav.sharpe : 0,
            holdingCount: latestHoldings.length,
            lastTradeDate: latestNav ? latestNav.trade_date : null,
        };
    });
    return {
        timestamp: new Date().toISOString(),
        strategyCount: strategies.length,
        strategies: status,
    };
}

/**
 * Backfill stock names for existing holdings, transactions, and signals.
 *
 * CSV-loaded signals (e.g. top10_csv) only carry symbol/close/rank — no name.
 * This updates rows whose name is NULL, empty, or equal to the symbol by
 * fetching the real Chinese stock name from the marketData service. Existing
 * real names are reused to minimize API calls.
 *
 * @param {string} strategyId
 * @returns {{ updated: number, nameMap: Object }}
 */
async function backfillNames(strategyId) {
    const db = getDB();

    // Gather distinct (symbol, name) rows across the three tables
    const rows = [
        ...db.prepare(`SELECT DISTINCT symbol, name FROM holdings WHERE strategy_id = ?`).all(strategyId),
        ...db.prepare(`SELECT DISTINCT symbol, name FROM transactions WHERE strategy_id = ?`).all(strategyId),
        ...db.prepare(`SELECT DISTINCT symbol, name FROM signals WHERE strategy_id = ?`).all(strategyId),
    ];

    // 1. Reuse names already present in the DB
    const nameMap = {};
    for (const row of rows) {
        if (row.name && row.name !== '' && row.name !== row.symbol) {
            nameMap[row.symbol] = row.name;
        }
    }

    // 2. For symbols still missing a name, fetch via marketData API
    const allSymbols = [...new Set(rows.map(r => r.symbol))];
    for (const symbol of allSymbols) {
        if (nameMap[symbol]) continue;
        try {
            const quote = await MarketDataService.getFullQuote(symbol);
            if (quote && quote.name && quote.name !== symbol) {
                nameMap[symbol] = quote.name;
            }
        } catch (e) { /* skip this symbol */ }
    }

    // 3. Update rows whose name is NULL/empty/== symbol
    const stmts = [
        db.prepare(`UPDATE holdings SET name = ? WHERE strategy_id = ? AND symbol = ? AND (name IS NULL OR name = '' OR name = symbol)`),
        db.prepare(`UPDATE transactions SET name = ? WHERE strategy_id = ? AND symbol = ? AND (name IS NULL OR name = '' OR name = symbol)`),
        db.prepare(`UPDATE signals SET name = ? WHERE strategy_id = ? AND symbol = ? AND (name IS NULL OR name = '' OR name = symbol)`),
    ];
    const tx = db.transaction((entries) => {
        for (const [symbol, name] of entries) {
            for (const stmt of stmts) stmt.run(name, strategyId, symbol);
        }
    });
    tx(Object.entries(nameMap));

    return { updated: Object.keys(nameMap).length, nameMap };
}

/**
 * Check stop-loss/take-profit for all holdings of a strategy.
 * Runs independently of rebalance (e.g. daily at 14:30 via scheduler).
 * T+1 rule: can sell any day (uses available_quantity).
 * @param {string} strategyId
 * @returns {Promise<{strategyId, actions: Array, checked: number, tradeDate: string}>}
 */
async function checkStopLossTakeProfit(strategyId) {
    const strategy = getStrategy(strategyId);
    if (!strategy) throw new Error(`Strategy not found: ${strategyId}`);
    if (strategy.status !== 'active') {
        return { strategyId, actions: [], checked: 0, skipped: 'not active' };
    }

    const tradeDate = todayStr();
    const holdings = getLatestHoldings(strategyId);
    if (holdings.length === 0) {
        return { strategyId, actions: [], checked: 0, tradeDate };
    }

    const stopLoss = strategy.stop_loss ?? -5.0;
    const takeProfit = strategy.take_profit ?? 15.0;

    // Fetch current prices
    const priceMap = {};
    for (const h of holdings) {
        try { priceMap[h.symbol] = await MarketDataService.getRealTimePrice(h.symbol); }
        catch (e) { priceMap[h.symbol] = h.current_price; }
    }

    const actions = [];
    const latestNav = getLatestNav(strategyId);
    let cash = latestNav ? latestNav.cash : strategy.initial_capital;

    for (const holding of holdings) {
        const price = priceMap[holding.symbol] || holding.current_price;
        const profitPct = holding.cost_price > 0
            ? ((price - holding.cost_price) / holding.cost_price) * 100 : 0;

        if (profitPct <= stopLoss || profitPct >= takeProfit) {
            const reason = profitPct <= stopLoss ? 'stop_loss' : 'take_profit';
            const result = executeSell(strategyId, tradeDate, holding, holding.available_quantity, reason, price);
            if (result) {
                cash += result.netAmount;
                holding.quantity -= result.quantity;
                holding.available_quantity = 0;
                actions.push({ type: reason, symbol: holding.symbol, quantity: result.quantity,
                    price, amount: result.amount, profitPct: parseFloat(profitPct.toFixed(2)) });
            }
        }
    }

    // Persist updated holdings + NAV if any positions were sold
    if (actions.length > 0) {
        const remaining = holdings.filter(h => h.quantity > 0);
        const finalHoldings = remaining.map(h => {
            const price = priceMap[h.symbol] || h.current_price;
            const mv = price * h.quantity;
            const profitPct = h.cost_price > 0
                ? parseFloat(((price - h.cost_price) / h.cost_price * 100).toFixed(2)) : 0;
            return { symbol: h.symbol, name: h.name, quantity: h.quantity,
                available_quantity: h.available_quantity, cost_price: h.cost_price,
                current_price: price, market_value: parseFloat(mv.toFixed(2)),
                profit_pct: profitPct, weight: 0 };
        });
        updateHoldings(strategyId, tradeDate, finalHoldings);
        snapshotNAV(strategyId, tradeDate, cash, finalHoldings, 0);
    }

    return { strategyId, actions, checked: holdings.length, tradeDate };
}

/**
 * Update NAV snapshot with latest market prices.
 * Fetches current prices via marketData service, recomputes market values,
 * and inserts/updates the NAV snapshot for today.
 * @param {string} strategyId
 * @returns {Promise<{strategyId, tradeDate, totalAssets, cash, marketValue, positionRatio}>}
 */
async function updateNavSnapshot(strategyId) {
    const strategy = getStrategy(strategyId);
    if (!strategy) throw new Error(`Strategy not found: ${strategyId}`);
    if (strategy.status !== 'active') return { strategyId, skipped: 'not active' };

    const tradeDate = todayStr();
    const holdings = getLatestHoldings(strategyId);
    const latestNav = getLatestNav(strategyId);
    const cash = latestNav ? latestNav.cash : strategy.initial_capital;

    const finalHoldings = [];
    for (const h of holdings) {
        let price = h.current_price;
        try { price = await MarketDataService.getRealTimePrice(h.symbol); }
        catch (e) { /* use last known price */ }
        const mv = price * h.quantity;
        const profitPct = h.cost_price > 0
            ? parseFloat(((price - h.cost_price) / h.cost_price * 100).toFixed(2)) : 0;
        finalHoldings.push({ symbol: h.symbol, name: h.name, quantity: h.quantity,
            available_quantity: h.available_quantity, cost_price: h.cost_price,
            current_price: price, market_value: parseFloat(mv.toFixed(2)),
            profit_pct: profitPct, weight: 0 });
    }

    if (finalHoldings.length > 0) updateHoldings(strategyId, tradeDate, finalHoldings);

    let benchmarkReturn = 0;
    try {
        const indices = await MarketDataService.getIndices();
        const bench = indices.find(i => i.symbol === strategy.benchmark);
        if (bench) benchmarkReturn = bench.changePercent || 0;
    } catch (e) { /* benchmark fetch failed */ }

    const nav = snapshotNAV(strategyId, tradeDate, cash, finalHoldings, benchmarkReturn);
    return { strategyId, tradeDate, totalAssets: nav.totalAssets, cash: nav.cash,
        marketValue: nav.marketValue, positionRatio: nav.positionRatio };
}

module.exports = {
    rebalance,
    rebalanceAll,
    getEngineStatus,
    backfillNames,
    seedStrategies,
    snapshotNAV,
    checkStopLossTakeProfit,
    updateNavSnapshot,
    calcCosts,
    calcSharpe,
    roundToLot,
    LOT_SIZE,
    COMMISSION_RATE,
    MIN_COMMISSION,
    STAMP_TAX_RATE,
    TRANSFER_FEE_RATE,
    POSITION_THRESHOLD,
    MAX_REBALANCE_TRADES,
    SEED_STRATEGIES,
};
