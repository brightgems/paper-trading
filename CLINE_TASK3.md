# Cline Task 3: Fix StockDetail + Stock Names + NAV Chart

## Project root
`/git/paper-trading`

## Problem 1: StockDetail page broken

`client/src/pages/StockDetail.jsx` was rewritten but has bugs:
1. Uses `useState(() => {...})` as if it were `useEffect` — this is wrong. Must use `useEffect` from React.
2. The page should show: K-line candlestick chart (using ECharts), price header, quote details table.
3. No Buy/Sell panel — this is a read-only tracking dashboard.
4. Must use dark theme (slate-800/700 colors, same as StrategyDetail.jsx).
5. Must use `getStockPrice` and `getStockCandles` from `services/api.js`.
6. The `getStockPrice` endpoint returns `{ price, change, changePercent, previousClose, open, high, low, volume, amount, name, code }` — use these fields.
7. Time range buttons: 1D, 1W, 1M, 6M, 1Y.
8. Use `import { echartsBase } from '../components/ui'` for chart styling.
9. Back button should use `Link to={-1}` or `useNavigate(-1)`.
10. Candlestick colors: A-share convention — red (#ef4444) for up, green (#22c55e) for down.

Read `client/src/pages/StrategyDetail.jsx` for the dark theme style reference.

## Problem 2: Stock names missing

Holdings and signals only have symbol codes, no Chinese stock names. The `marketData.js` service `getFullQuote()` returns `d.f58` as name, but for some stocks it returns the code instead of the name.

Fix approach: In `server/services/rebalanceEngine.js`, in the `executeBuy` function, after getting the price from marketData, also fetch the stock name using `MarketDataService.getFullQuote(symbol)` and store the `quote.name` in the holdings/transactions/signals `name` field.

Also fix the existing data: add an API endpoint or script that backfills stock names for existing holdings.

Specifically in `rebalanceEngine.js`:
1. In the buy section (step 7), before calling `executeBuy`, fetch the full quote to get the stock name:
```javascript
let stockName = signal.name || signal.symbol;
try {
    const quote = await MarketDataService.getFullQuote(signal.symbol);
    if (quote && quote.name && quote.name !== signal.symbol) {
        stockName = quote.name;
    }
} catch(e) { /* fallback to signal name */ }
```
2. Pass `stockName` to `executeBuy` instead of `signal.name || signal.symbol`.

Also in `signalLoader.js` `loadTop10CSV()`: the CSV only has symbol/close/rank columns, no name. That's OK — names will be fetched during rebalance. But for display before rebalance, add a `backfillNames` utility function in `rebalanceEngine.js` that updates existing holdings/signals names via marketData API.

## Problem 3: NAV chart — merge backtest + live on same chart

In `client/src/pages/StrategyDetail.jsx`, the backtest tab shows backtest and live NAV on separate concerns. The user wants:

1. **On the NAV tab (净值曲线 tab)**: Show BOTH backtest equity curve AND live NAV on the same chart.
   - Backtest curve: solid line, color #f59e0b (amber)
   - Live NAV curve: solid line, color #3b82f6 (blue)  
   - A vertical dashed line (markLine) at the date where live trading started (the first nav_snapshots trade_date)
   - X-axis: dates (backtest dates + live dates combined)
   - Y-axis: total assets value
   - Both curves should be on the same time axis. Backtest data has daily dates (2020-06-01 to 2026-09-17). Live data has trade_date (2026-10-10).

2. **On the backtest tab (回测对比 tab)**: Keep the existing overlay chart but make sure it works. The backtest equity_curve now has 1521 daily points. The live NAV has 1 point. They should overlay on the same chart with:
   - Backtest: amber solid line
   - Live: blue solid line  
   - Vertical markLine at live trading start date

3. **Data alignment**: The backtest equity_curve dates are daily (2020-06-01 format). The live NAV dates are daily (2026-10-10 format). Merge them on the same x-axis. For dates where only backtest exists, live NAV = null. For dates where only live exists, backtest = null.

Implementation in StrategyDetail.jsx:
```javascript
// Merge backtest and live NAV dates
const btCurve = backtests?.[0]?.equity_curve || [];
const liveNav = nav || [];
const allDates = [...new Set([
    ...btCurve.map(p => p.date),
    ...liveNav.map(d => d.trade_date)
])].sort();

const liveStartDate = liveNav[0]?.trade_date;

const mergedChartOption = {
    ...echartsBase,
    legend: { ...echartsBase.legend, data: ['回测净值', '模拟盘净值'], top: 0 },
    xAxis: { ...echartsBase.xAxis, data: allDates },
    yAxis: { ...echartsBase.yAxis, scale: true },
    series: [
        {
            name: '回测净值',
            type: 'line',
            data: allDates.map(d => {
                const p = btCurve.find(p => p.date === d);
                return p ? Number(p.value) : null;
            }),
            smooth: true,
            symbol: 'none',
            lineStyle: { color: '#f59e0b', width: 2 },
            connectNulls: false,
        },
        {
            name: '模拟盘净值',
            type: 'line',
            data: allDates.map(d => {
                const n = liveNav.find(n => n.trade_date === d);
                return n ? Number(n.total_assets) : null;
            }),
            smooth: true,
            symbol: 'none',
            lineStyle: { color: '#3b82f6', width: 2 },
            connectNulls: false,
            markLine: liveStartDate ? {
                symbol: 'none',
                lineStyle: { color: '#64748b', type: 'dashed', width: 1.5 },
                data: [{ xAxis: liveStartDate, label: { formatter: '模拟盘开始', color: '#94a3b8' } }],
            } : undefined,
        },
    ],
};
```

Replace the current `navChartOption` in the NAV tab with this merged chart.

## Problem 4: getStockCandles API function

In `client/src/services/api.js`, `getStockCandles` is defined but may not be exported correctly. Verify it exports:
```javascript
export const getStockCandles = (symbol, range) => api.get(`/trade/candles/${symbol}`, { params: { range } });
```

The backend `tradeController.getCandles` reads `req.query.range` and calls `MarketDataService.getChartData(symbol, range)`. Verify this works.

## Constraints
- Only modify: `client/src/pages/StockDetail.jsx`, `client/src/pages/StrategyDetail.jsx`, `server/services/rebalanceEngine.js`, `client/src/services/api.js`
- Do NOT modify `index.js`, `db.js`, `marketData.js`, or any controller files
- Use `useEffect` (not `useState`) for side effects in React
- Keep dark theme consistent with StrategyDetail.jsx
- Run `npx vite build` after changes to verify no build errors
