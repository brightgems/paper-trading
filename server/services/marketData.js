const axios = require('axios');
const iconv = require('iconv-lite');

// 东方财富 secid 转换: 000001.SZ -> 0.000001, 600000.SH -> 1.600000, AAPL.US -> 105.AAPL, 0700.HK -> 116.0700
function toSecid(symbol) {
    const sym = symbol.replace('.SH', '').replace('.SZ', '').replace('.BJ', '').replace('.US', '').replace('.HK', '');
    // 美股: NASDAQ=105, NYSE=106
    if (symbol.endsWith('.US')) return `105.${sym}`;
    // 港股: 116
    if (symbol.endsWith('.HK')) return `116.${sym}`;
    // A股
    if (symbol.endsWith('.SH') || symbol.startsWith('6')) return `1.${sym}`;
    if (symbol.endsWith('.BJ') || sym.startsWith('8') || sym.startsWith('4')) return `0.${sym}`;
    return `0.${sym}`;
}

// secid 转回标准代码
function fromSecid(secid) {
    const [market, code] = secid.split('.');
    if (market === '1') return `${code}.SH`;
    if (market === '0') return `${code}.SZ`;
    return code;
}

// 标准化代码: 000001 -> 000001.SZ, 600000 -> 600000.SH, AAPL -> AAPL.US, 0700 -> 0700.HK
function normalizeSymbol(input) {
    let sym = input.toUpperCase().trim();
    if (sym.includes('.')) return sym;
    // 美股: 字母代码
    if (/^[A-Z]+$/.test(sym)) return `${sym}.US`;
    // 港股: 5位数字或以0开头4位数
    if (/^\d{4,5}$/.test(sym) && sym.startsWith('0') && sym.length <= 5 && !sym.startsWith('00') && sym.length === 5) return `${sym}.HK`;
    if (/^\d{5}$/.test(sym) && sym.startsWith('0')) return `${sym}.HK`;
    // A股
    if (sym.startsWith('6') || sym.startsWith('5') || sym.startsWith('11') || sym.startsWith('13')) return `${sym}.SH`;
    if (sym.startsWith('0') || sym.startsWith('3') || sym.startsWith('12')) return `${sym}.SZ`;
    if (sym.startsWith('8') || sym.startsWith('4')) return `${sym}.BJ`;
    return `${sym}.SZ`;
}

const EM_BASE = 'http://push2.eastmoney.com';
const EM_HIS = 'http://push2his.eastmoney.com';
const EM_SEARCH = 'https://searchapi.eastmoney.com';
const EM_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
const TX_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': 'https://gu.qq.com/' };

// 腾讯行情: 688075.SH -> sh688075, 000541.SZ -> sz000541
function toTxSymbol(symbol) {
    const sym = symbol.replace('.SH', '').replace('.SZ', '').replace('.BJ', '');
    if (symbol.endsWith('.SH') || symbol.startsWith('6')) return `sh${sym}`;
    if (symbol.endsWith('.BJ') || sym.startsWith('8') || sym.startsWith('4')) return `bj${sym}`;
    return `sz${sym}`;
}

// 解析腾讯行情字符串
function parseTxQuote(raw) {
    // v_sh688075="1~安旭生物~688075~30.89~30.64~30.60~928202~444198~484004~..."
    const fields = raw.split('~');
    if (fields.length < 50) return null;
    return {
        name: fields[1],              // 股票名称
        code: fields[2],              // 股票代码
        price: parseFloat(fields[3]), // 当前价
        prevClose: parseFloat(fields[4]), // 昨收
        open: parseFloat(fields[5]),  // 开盘
        volume: parseInt(fields[6]),  // 成交量(手)
        amount: parseFloat(fields[37]), // 成交额
        high: parseFloat(fields[33]), // 最高
        low: parseFloat(fields[34]),  // 最低
        change: parseFloat(fields[31]), // 涨跌额
        changePercent: parseFloat(fields[32]), // 涨跌幅%
        marketCap: parseFloat(fields[45]) * 10000, // 总市值(元)
    };
}

class MarketDataService {

    // 实时行情
    static async getRealTimePrice(symbol) {
        try {
            const txSym = toTxSymbol(normalizeSymbol(symbol));
            const resp = await axios.get(`https://qt.gtimg.cn/q=${txSym}`, {
                headers: TX_HEADERS,
                timeout: 5000,
                proxy: false,
                responseType: 'arraybuffer',
            });
            const text = iconv.decode(Buffer.from(resp.data), 'gbk');
            const match = text.match(/="([^"]+)"/);
            if (!match || !match[1]) return this._getMockPrice(symbol);
            const q = parseTxQuote(match[1]);
            return q ? q.price : this._getMockPrice(symbol);
        } catch (e) {
            return this._getMockPrice(symbol);
        }
    }

    // 获取股票名称 (search API)
    static async getStockName(symbol) {
        try {
            const code = symbol.replace('.SH', '').replace('.SZ', '').replace('.BJ', '');
            const resp = await axios.get(`${EM_SEARCH}/api/suggest/get`, {
                params: { input: code, type: '14', token: 'D43BF722C8E33BDC906FB84D85E326E8' },
                headers: EM_HEADERS,
                timeout: 5000,
                proxy: false
            });
            const table = resp.data?.QuotationCodeTable;
            const data = table?.Data || table;
            const arr = Array.isArray(data) ? data : (data?.Data ? data.Data : []);
            const match = arr.find(item => item.Code === code);
            return match?.Name || null;
        } catch { return null; }
    }

    // 完整报价
    static async getFullQuote(symbol) {
        try {
            const normalized = normalizeSymbol(symbol);
            const txSym = toTxSymbol(normalized);
            const resp = await axios.get(`https://qt.gtimg.cn/q=${txSym}`, {
                headers: TX_HEADERS,
                timeout: 5000,
                proxy: false,
                responseType: 'arraybuffer',
            });
            const text = iconv.decode(Buffer.from(resp.data), 'gbk');
            const match = text.match(/="([^"]+)"/);
            if (!match || !match[1]) throw new Error('no data');
            const q = parseTxQuote(match[1]);
            if (!q) throw new Error('parse failed');
            return {
                price: q.price,
                change: q.change,
                changePercent: q.changePercent,
                previousClose: q.prevClose,
                open: q.open,
                high: q.high,
                low: q.low,
                volume: q.volume,
                amount: q.amount,
                name: q.name,
                code: q.code,
                marketCap: q.marketCap,
                floatCap: null,
                pe: null,
                pb: null,
            };
        } catch (error) {
            return {
                price: this._getMockPrice(symbol),
                change: 0, changePercent: 0, previousClose: 0,
                name: symbol, code: symbol
            };
        }
    }

    // K线数据 — use Tencent historical API
    static async getChartData(symbol, range = '1d') {
        try {
            const normalized = normalizeSymbol(symbol);
            const txSym = toTxSymbol(normalized);
            const rangeUpper = range.toUpperCase();

            // 腾讯日K: https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh688075,day,2020-01-01,,640,qfq
            let klt = 'day';
            let count = 30;
            if (rangeUpper === '1D') { klt = 'day'; count = 1; }
            else if (rangeUpper === '1W') { klt = 'day'; count = 5; }
            else if (rangeUpper === '1M') { klt = 'day'; count = 30; }
            else if (rangeUpper === '6M') { klt = 'day'; count = 120; }
            else if (rangeUpper === '1Y') { klt = 'day'; count = 250; }
            else { klt = 'day'; count = 30; }

            const resp = await axios.get(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get`, {
                params: { param: `${txSym},${klt},2020-01-01,,${count},qfq` },
                headers: TX_HEADERS,
                timeout: 8000,
                proxy: false,
            });

            const data = resp.data?.data?.[txSym];
            if (!data) {
                // Try without prefix
                const key = Object.keys(resp.data?.data || {})[0];
                if (!key) return this._getMockChart(symbol, rangeUpper);
                const klines = resp.data.data[key]?.[klt] || resp.data.data[key]?.qfqday || [];
                if (!klines.length) return this._getMockChart(symbol, rangeUpper);
                return klines.map(k => ({
                    time: k[0],
                    open: parseFloat(k[1]),
                    close: parseFloat(k[2]),
                    high: parseFloat(k[3]),
                    low: parseFloat(k[4]),
                    volume: parseInt(k[5]) || 0,
                }));
            }

            const klines = data?.[klt] || data?.qfqday || [];
            if (!klines.length) return this._getMockChart(symbol, rangeUpper);

            return klines.map(k => ({
                time: k[0],
                open: parseFloat(k[1]),
                close: parseFloat(k[2]),
                high: parseFloat(k[3]),
                low: parseFloat(k[4]),
                volume: parseInt(k[5]) || 0,
            }));
        } catch (error) {
            return this._getMockChart(symbol, range);
        }
    }

    // 搜索股票 (A股+美股+港股)
    static async searchSymbol(query) {
        try {
            const resp = await axios.get(`${EM_SEARCH}/api/suggest/get`, {
                params: { input: query, type: '14', token: 'D43BF722C8E33BDC906FB84D3A8BB6F1', count: 30 },
                headers: EM_HEADERS,
                timeout: 8000,
                proxy: false
            });
            const quotes = resp.data?.QuotationCodeTable?.Data || [];
            return quotes
                .filter(q => {
                    // mkt: 0=深 1=沪 2=港股 3=美股
                    return q.mkt === '0' || q.mkt === '1' || q.mkt === '2' || q.mkt === '3';
                })
                .map(q => {
                    let symbol, exchange;
                    if (q.mkt === '1') { symbol = `${q.Code}.SH`; exchange = 'SH'; }
                    else if (q.mkt === '0') { symbol = `${q.Code}.SZ`; exchange = 'SZ'; }
                    else if (q.mkt === '2') { symbol = `${q.Code}.HK`; exchange = 'HK'; }
                    else if (q.mkt === '3') { symbol = `${q.Code}.US`; exchange = 'US'; }
                    else { symbol = q.Code; exchange = ''; }
                    return {
                        symbol,
                        description: q.Name,
                        type: 'stock',
                        exchange
                    };
                });
        } catch (error) {
            return [];
        }
    }

    // 指数行情
    static async getIndices() {
        // A股 + 美股 + 港股
        const indices = [
            { secid: '1.000001', name: '上证指数', symbol: '000001.SH' },
            { secid: '0.399001', name: '深证成指', symbol: '399001.SZ' },
            { secid: '0.399006', name: '创业板指', symbol: '399006.SZ' },
            { secid: '1.000300', name: '沪深300', symbol: '000300.SH' },
            { secid: '1.000688', name: '科创50', symbol: '000688.SH' },
            { secid: '100.NDX', name: '纳斯达克', symbol: 'NDX.US' },
            { secid: '100.SPX', name: '标普500', symbol: 'SPX.US' },
            { secid: '100.DJIA', name: '道琼斯', symbol: 'DJIA.US' },
            { secid: '124.HSTECH', name: '恒生科技', symbol: 'HSTECH.HK' },
        ];
        try {
            // 逐个查询指数行情 (海外指数需要stock/get, 不支持ulist.np)
            const results = [];
            for (const idx of indices) {
                try {
                    const resp = await axios.get(`${EM_BASE}/api/qt/stock/get`, {
                        params: { secid: idx.secid, fields: 'f43,f57,f58,f59,f60,f169,f170' },
                        headers: EM_HEADERS,
                        timeout: 5000,
                        proxy: false
                    });
                    const d = resp.data?.data;
                    if (d) {
                        // f59=小数位数, 用10^f59还原价格; 涨跌幅始终/100
                        const dec = d.f59 != null ? d.f59 : 2;
                        const div = Math.pow(10, dec);
                        results.push({
                            symbol: idx.symbol,
                            name: d.f58 || idx.name,
                            price: (d.f43 || 0) / div,
                            change: (d.f169 || 0) / div,
                            changePercent: (d.f170 || 0) / 100
                        });
                    } else {
                        results.push({ ...idx, price: 0, change: 0, changePercent: 0 });
                    }
                } catch {
                    results.push({ ...idx, price: 0, change: 0, changePercent: 0 });
                }
            }
            return results;
        } catch (error) {
            return indices.map(i => ({ ...i, price: 0, change: 0, changePercent: 0 }));
        }
    }

    // 涨幅榜/跌幅榜/活跃榜
    static async getScreeners(type = 'gainers') {
        // 热门ETF列表 (活跃榜时返回ETF而非个股)
        const hotETFs = [
            { secid: '1.513100', name: '纳斯达克ETF', symbol: '513100.SH' },
            { secid: '1.513300', name: '纳斯达克科技ETF', symbol: '513300.SH' },
            { secid: '1.588000', name: '科创50ETF', symbol: '588000.SH' },
            { secid: '1.513130', name: '恒生科技指数ETF', symbol: '513130.SH' },
            { secid: '1.513180', name: '恒生科技ETF', symbol: '513180.SH' },
            { secid: '1.513050', name: '中概互联ETF', symbol: '513050.SH' },
            { secid: '0.159920', name: '恒生ETF', symbol: '159920.SZ' },
            { secid: '1.510300', name: '沪深300ETF', symbol: '510300.SH' },
            { secid: '1.510500', name: '中证500ETF', symbol: '510500.SH' },
            { secid: '1.159825', name: '农业ETF', symbol: '159825.SZ' },
        ];

        if (type === 'active') {
            // 活跃榜: 返回热门ETF行情
            try {
                const secids = hotETFs.map(e => e.secid).join(',');
                const resp = await axios.get(`${EM_BASE}/api/qt/ulist.np/get`, {
                    params: { secids, fields: 'f1,f2,f3,f4,f5,f6,f12,f14' },
                    headers: EM_HEADERS,
                    timeout: 8000,
                    proxy: false
                });
                const list = resp.data?.data?.diff || [];
                return list.map((d, i) => ({
                    symbol: hotETFs[i].symbol,
                    name: d.f14 || hotETFs[i].name,
                    price: d.f2 / 100,
                    change: d.f4 / 100,
                    changePercent: d.f3 / 100,
                    volume: d.f5 || 0,
                    amount: d.f6 || 0,
                    marketCap: 0
                }));
            } catch (error) {
                return hotETFs.map(e => ({ ...e, price: 0, change: 0, changePercent: 0, volume: 0, amount: 0, marketCap: 0 }));
            }
        }

        try {
            // clist接口: fltt=2返回实际值(已处理精度)
            const sortField = 'f3';
            const sortDir = type === 'losers' ? 'asc' : 'desc';
            const resp = await axios.get(`${EM_BASE}/api/qt/clist/get`, {
                params: {
                    pn: 1, pz: 20, po: sortDir, np: 1,
                    fltt: 2, fs: 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048',
                    fields: 'f2,f3,f4,f5,f6,f7,f12,f14,f15,f16,f17,f18',
                    fid: sortField
                },
                headers: EM_HEADERS,
                timeout: 8000,
                proxy: false
            });
            const list = resp.data?.data?.diff || [];
            return list.map(d => ({
                symbol: d.f12.startsWith('6') || d.f12.startsWith('5') ? `${d.f12}.SH` : `${d.f12}.SZ`,
                name: d.f14,
                price: d.f2 / 100,
                change: d.f4 / 100,
                changePercent: d.f3 / 100,
                volume: d.f5,
                amount: d.f6,
                marketCap: 0
            }));
        } catch (error) {
            return [];
        }
    }

    // 市场新闻
    static async getMarketNews() {
        try {
            const resp = await axios.get('https://np-anotice-stock.eastmoney.com/api/security/ann', {
                params: { cb: '', sr: -1, page_size: 15, page_index: 1, ann_type: 'A', client_source: 'web' }
            });
            const list = resp.data?.data?.list || [];
            return list.map(n => ({
                id: n.art_code,
                headline: n.title,
                summary: n.display_time,
                url: `https://np-anotice-stock.eastmoney.com/api/security/ann?art_code=${n.art_code}`,
                image: null,
                datetime: n.notice_date ? new Date(n.notice_date).getTime() : Date.now()
            }));
        } catch (error) {
            return this._getMockNews();
        }
    }

    // 个股新闻
    static async getCompanyNews(symbol) {
        const sym = normalizeSymbol(symbol);
        const code = sym.replace('.SH', '').replace('.SZ', '');
        try {
            const resp = await axios.get('https://search-api-web.eastmoney.com/search/jsonp', {
                params: { cb: '', param: JSON.stringify({ uid: '', keyword: code, type: ['cmsArticleWebOld'], client: 'web', clientType: 'web', clientVersion: 'curr', param: { cmsArticleWebOld: { searchScope: 'default', sort: 'default', pageIndex: 1, pageSize: 10, preTag: '', postTag: '' } } }) }
            });
            return [];
        } catch (error) {
            return [];
        }
    }

    // 公司资料
    static async getCompanyProfile(symbol) {
        const sym = normalizeSymbol(symbol);
        try {
            const quote = await this.getFullQuote(sym);
            return {
                name: quote.name || sym,
                ticker: sym,
                logo: null,
                marketCapitalization: quote.marketCap,
                weburl: null,
                finnhubIndustry: null
            };
        } catch (error) {
            return { name: sym, ticker: sym };
        }
    }

    // 财务数据
    static async getFinancials(symbol) {
        try {
            const quote = await this.getFullQuote(symbol);
            return {
                metric: {
                    "52WeekHigh": quote.high,
                    "52WeekLow": quote.low,
                    "marketCapitalization": quote.marketCap,
                    "peBasicExclExtraTTM": quote.pe,
                    "pb": quote.pb
                }
            };
        } catch (error) {
            return {};
        }
    }

    // 机构推荐 (东方财富无对应API, 返回空)
    static async getRecommendations(symbol) {
        return [];
    }

    static _getMockPrice(symbol) {
        return 10 + (Math.random() * 5);
    }

    static _getMockChart(symbol, range) {
        const points = range === '1D' ? 20 : range === '1W' ? 50 : 100;
        const volatility = range === '1Y' ? 1 : 0.2;
        let price = 15;
        return Array.from({ length: points }, (_, i) => {
            price = price + (Math.random() - 0.5) * volatility;
            return {
                time: new Date(Date.now() - (points - i) * 3600000).toISOString(),
                close: price, high: price + 0.5, low: price - 0.5, open: price
            };
        });
    }

    static _getMockNews() {
        return [{ id: 1, headline: "市场数据暂不可用", summary: "请检查服务器", url: "#", datetime: Date.now() }];
    }
}

module.exports = MarketDataService;
