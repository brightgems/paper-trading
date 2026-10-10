import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import ReactECharts from 'echarts-for-react';
import { getStockPrice, getStockCandles } from '../services/api';
import { ArrowLeft } from 'lucide-react';
import { echartsBase } from '../components/ui';

const TIME_RANGES = ['1W', '1M', '6M', '1Y'];

const StockDetail = () => {
    const { symbol } = useParams();
    const [price, setPrice] = useState(null);
    const [quote, setQuote] = useState(null);
    const [chartData, setChartData] = useState([]);
    const [timeRange, setTimeRange] = useState('1M');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        const fetchData = async () => {
            setLoading(true);
            setError(null);
            try {
                const [priceRes, candlesRes] = await Promise.all([
                    getStockPrice(symbol),
                    getStockCandles(symbol, timeRange),
                ]);
                if (cancelled) return;
                setPrice(priceRes.data.price);
                setQuote(priceRes.data);
                setChartData(candlesRes.data || []);
            } catch (e) {
                if (!cancelled) setError(e.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        fetchData();
        return () => { cancelled = true; };
    }, [symbol, timeRange]);

    // Calculate MA lines
    const calcMA = (data, period) => {
        const result = [];
        for (let i = 0; i < data.length; i++) {
            if (i < period - 1) {
                result.push(null);
                continue;
            }
            let sum = 0;
            for (let j = 0; j < period; j++) sum += data[i - j].close;
            result.push((sum / period).toFixed(2));
        }
        return result;
    };

    const ma5 = calcMA(chartData, 5);
    const ma20 = calcMA(chartData, 20);

    // Professional candlestick chart with dual y-axis
    const chartOption = chartData.length > 0 ? {
        ...echartsBase,
        legend: {
            ...echartsBase.legend,
            data: ['日K', 'MA5', 'MA20', '成交量'],
            top: 0,
        },
        xAxis: {
            ...echartsBase.xAxis,
            data: chartData.map(d => d.time),
            axisLabel: {
                ...echartsBase.xAxis.axisLabel,
                formatter: (val) => val ? val.slice(5) : '',  // MM-DD
            },
        },
        yAxis: [
            {
                ...echartsBase.yAxis,
                scale: true,
                name: '价格',
                nameTextStyle: { color: '#64748b', fontSize: 10 },
                // Leave 15% space at bottom for volume
                boundaryGap: ['5%', '15%'],
            },
            {
                ...echartsBase.yAxis,
                scale: true,
                name: '成交量',
                nameTextStyle: { color: '#64748b', fontSize: 10 },
                max: (val) => val.max * 4,  // Compress volume to bottom 25%
                splitLine: { show: false },
            },
        ],
        dataZoom: [
            { type: 'inside', start: 0, end: 100 },
            { type: 'slider', start: 0, end: 100, height: 20, bottom: 5, borderColor: '#334155', fillerColor: 'rgba(59,130,246,0.1)' },
        ],
        grid: { left: '8%', right: '3%', top: '12%', bottom: '18%' },
        tooltip: {
            ...echartsBase.tooltip,
            trigger: 'axis',
            axisPointer: { type: 'cross', crossStyle: { color: '#64748b' } },
            formatter: (params) => {
                const idx = params[0]?.dataIndex;
                if (idx == null) return '';
                const d = chartData[idx];
                if (!d) return '';
                const change = d.close - d.open;
                const changePct = d.open > 0 ? (change / d.open * 100).toFixed(2) : '0';
                const color = change >= 0 ? '#ef4444' : '#22c55e';
                let html = `<div style="font-weight:600;margin-bottom:4px">${d.time}</div>`;
                html += `<div style="color:#94a3b8">开 <span style="color:${color};font-weight:600">${d.open.toFixed(2)}</span></div>`;
                html += `<div style="color:#94a3b8">收 <span style="color:${color};font-weight:600">${d.close.toFixed(2)}</span> <span style="color:${color}">(${changePct}%)</span></div>`;
                html += `<div style="color:#94a3b8">高 ${d.high.toFixed(2)}</div>`;
                html += `<div style="color:#94a3b8">低 ${d.low.toFixed(2)}</div>`;
                html += `<div style="color:#94a3b8">量 ${(d.volume / 10000).toFixed(0)}万手</div>`;
                if (ma5[idx]) html += `<div style="color:#f59e0b">MA5 ${ma5[idx]}</div>`;
                if (ma20[idx]) html += `<div style="color:#3b82f6">MA20 ${ma20[idx]}</div>`;
                return html;
            },
        },
        series: [
            {
                name: '日K',
                type: 'candlestick',
                yAxisIndex: 0,
                data: chartData.map(d => [d.open, d.close, d.low, d.high]),
                itemStyle: {
                    color: '#ef4444',       // A-share: red = up
                    color0: '#22c55e',      // green = down
                    borderColor: '#ef4444',
                    borderColor0: '#22c55e',
                },
            },
            {
                name: 'MA5',
                type: 'line',
                yAxisIndex: 0,
                data: ma5,
                smooth: true,
                symbol: 'none',
                lineStyle: { color: '#f59e0b', width: 1 },
                connectNulls: false,
            },
            {
                name: 'MA20',
                type: 'line',
                yAxisIndex: 0,
                data: ma20,
                smooth: true,
                symbol: 'none',
                lineStyle: { color: '#3b82f6', width: 1 },
                connectNulls: false,
            },
            {
                name: '成交量',
                type: 'bar',
                yAxisIndex: 1,
                data: chartData.map(d => ({
                    value: d.volume,
                    itemStyle: {
                        color: d.close >= d.open
                            ? 'rgba(239, 68, 68, 0.4)'   // red tint for up days
                            : 'rgba(34, 197, 94, 0.4)',   // green tint for down days
                    },
                })),
                barWidth: '60%',
            },
        ],
    } : null;

    return (
        <div className="max-w-[1400px] mx-auto px-6 py-8">
            <Link to={-1} className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-100 mb-4">
                <ArrowLeft className="w-4 h-4" /> 返回
            </Link>

            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-slate-100">{quote?.name || symbol}</h1>
                    <p className="text-sm text-slate-500 mt-1">{symbol}</p>
                </div>
                {price != null && (
                    <div className="text-right">
                        <h2 className="text-3xl font-bold text-slate-100">¥{Number(price).toFixed(2)}</h2>
                        {quote?.changePercent != null && (
                            <p className={`text-sm font-medium mt-1 ${quote.changePercent >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                                {quote.change >= 0 ? '+' : ''}{Number(quote.change).toFixed(2)} ({quote.changePercent >= 0 ? '+' : ''}{quote.changePercent.toFixed(2)}%)
                            </p>
                        )}
                    </div>
                )}
            </div>

            {/* Time range selector */}
            <div className="flex gap-1 mb-4 bg-slate-800/50 border border-slate-700 rounded-lg p-1 w-fit">
                {TIME_RANGES.map(range => (
                    <button
                        key={range}
                        onClick={() => setTimeRange(range)}
                        className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${
                            timeRange === range
                                ? 'bg-slate-700 text-slate-100'
                                : 'text-slate-400 hover:text-slate-100'
                        }`}
                    >
                        {range}
                    </button>
                ))}
            </div>

            {/* Chart */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mb-6">
                {loading ? (
                    <div className="flex justify-center py-20">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400" />
                    </div>
                ) : error ? (
                    <p className="text-center py-20 text-red-400">加载失败: {error}</p>
                ) : chartOption ? (
                    <ReactECharts option={chartOption} style={{ height: '500px' }} />
                ) : (
                    <p className="text-center py-20 text-slate-500">暂无行情数据</p>
                )}
            </div>

            {/* Quote details */}
            {quote && !loading && (
                <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
                    <h3 className="text-sm font-medium text-slate-300 mb-4">行情详情</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {[
                            { label: '昨收', value: quote.previousClose },
                            { label: '开盘', value: quote.open },
                            { label: '最高', value: quote.high },
                            { label: '最低', value: quote.low },
                            { label: '成交量(手)', value: quote.volume },
                            { label: '成交额', value: quote.amount },
                            { label: '涨跌额', value: quote.change },
                            { label: '涨跌幅', value: quote.changePercent != null ? `${quote.changePercent.toFixed(2)}%` : null },
                        ].map(({ label, value }) => (
                            <div key={label} className="bg-slate-900/50 rounded-lg p-3 border border-slate-800">
                                <p className="text-xs text-slate-500 mb-1">{label}</p>
                                <p className="text-sm font-bold text-slate-200">
                                    {value != null ? (typeof value === 'number' ? value.toLocaleString() : value) : '—'}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default StockDetail;
