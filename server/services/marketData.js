const axios = require('axios');

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

class MarketDataService {

    // 实时行情
    static async getRealTimePrice(symbol) {
        try {
            const normalized = normalizeSymbol(symbol);
            const secid = toSecid(normalized);
            const resp = await axios.get(`${EM_BASE}/api/qt/stock/get`, {
                params: { secid, fields: 'f43,f44,f45,f46,f47,f48,f50,f51,f52,f55,f57,f58,f59,f60,f116,f117,f169,f170,f171' },
                headers: EM_HEADERS,
                timeout: 8000,
                proxy: false
            });
            const d = resp.data?.data;
            if (!d) return this._getMockPrice(symbol);
            // f59=小数位数, 价格需除以10^f59还原; A股f59默认2(即/100), 美股f59可能不同
            const dec = d.f59 != null ? d.f59 : 2;
            return d.f43 / Math.pow(10, dec);
        } catch (e) {
            return this._getMockPrice(symbol);
        }
    }

    // 完整报价
    static async getFullQuote(symbol) {
        try {
            const normalized = normalizeSymbol(symbol);
            const secid = toSecid(normalized);
            const resp = await axios.get(`${EM_BASE}/api/qt/stock/get`, {
                params: { secid, fields: 'f43,f44,f45,f46,f47,f48,f50,f51,f52,f55,f57,f58,f59,f60,f116,f117,f169,f170,f171' },
                headers: EM_HEADERS,
                timeout: 8000,
                proxy: false
            });
            const d = resp.data?.data;
            if (!d) throw new Error('no data');
            // f59=小数位数, 价格需除以10^f59还原
            const dec = d.f59 != null ? d.f59 : 2;
            const div = Math.pow(10, dec);
            return {
                price: d.f43 / div,           // 现价
                change: d.f169 / div,         // 涨跌额
                changePercent: d.f170 / 100,  // 涨跌幅% (百分比始终/100)
                previousClose: d.f60 / div,   // 昨收
                open: d.f46 / div,            // 开盘
                high: d.f44 / div,            // 最高
                low: d.f45 / div,             // 最低
                volume: d.f47,                // 成交量(手)
                amount: d.f48,                // 成交额
                name: d.f58,                  // 名称
                code: d.f57,                  // 代码
                marketCap: d.f116,            // 总市值
                floatCap: d.f117,             // 流通市值
                pe: d.f50 / div,              // PE
                pb: d.f55 / div,              // PB
            };
        } catch (error) {
            return {
                price: this._getMockPrice(symbol),
                change: 0, changePercent: 0, previousClose: 0,
                name: symbol, code: symbol
            };
        }
    }

    // K线数据
    static async getChartData(symbol, range = '1d') {
        try {
            const secid = toSecid(normalizeSymbol(symbol));
            // klt: 1=1分 5=5分 15=15分 30=30分 60=60分 101=日 102=周 103=月
            let klt = 101, beg = '20200101';
            const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            const rangeUpper = range.toUpperCase();

            if (rangeUpper === '1D') { klt = 5; beg = today; }
            else if (rangeUpper === '1W') { klt = 15; beg = today; }
            else if (rangeUpper === '1M') { klt = 101; 
                const d = new Date(); d.setMonth(d.getMonth() - 1); beg = d.toISOString().slice(0,10).replace(/-/g,''); }
            else if (rangeUpper === '3M' || rangeUpper === '3MO') { klt = 101;
                const d = new Date(); d.setMonth(d.getMonth() - 3); beg = d.toISOString().slice(0,10).replace(/-/g,''); }
            else if (rangeUpper === '6M') { klt = 101;
                const d = new Date(); d.setMonth(d.getMonth() - 6); beg = d.toISOString().slice(0,10).replace(/-/g,''); }
            else if (rangeUpper === '1Y') { klt = 102;
                const d = new Date(); d.setFullYear(d.getFullYear() - 1); beg = d.toISOString().slice(0,10).replace(/-/g,''); }
            else { klt = 101; 
                const d = new Date(); d.setMonth(d.getMonth() - 1); beg = d.toISOString().slice(0,10).replace(/-/g,''); }

            const resp = await axios.get(`${EM_HIS}/api/qt/stock/kline/get`, {
                params: { secid, klt, fqt: 1, beg, end: '20500101', fields: 'f51,f52,f53,f54,f55,f56,f57' }
            });
            const klines = resp.data?.data?.klines;
            if (!klines || klines.length === 0) return this._getMockChart(symbol, rangeUpper);

            return klines.map(k => {
                const [date, open, close, high, low, volume, amount] = k.split(',');
                return {
                    time: date,
                    open: parseFloat(open),
                    high: parseFloat(high),
                    low: parseFloat(low),
                    close: parseFloat(close),
                    volume: parseInt(volume),
                    amount: parseFloat(amount)
                };
            });
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
