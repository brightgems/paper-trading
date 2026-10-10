import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import ReactECharts from 'echarts-for-react';
import { useApi, fmtPct, fmtMoney, fmtNum, colorPct, echartsBase, strategyColors } from '../components/ui';
import { getStrategy, getStrategyNav, getStrategyHoldings, getStrategyTransactions, getStrategyBacktests, getStrategySignals } from '../services/api';
import { ArrowLeft, ArrowLeftRight, TrendingUp, PieChart as PieIcon, GitCompare, Signal } from 'lucide-react';

const TABS = [
  { key: 'nav', label: '净值曲线', icon: TrendingUp },
  { key: 'holdings', label: '持仓', icon: PieIcon },
  { key: 'transactions', label: '交易记录', icon: ArrowLeftRight },
  { key: 'backtest', label: '回测对比', icon: GitCompare },
  { key: 'signals', label: '信号', icon: Signal },
];

const StrategyDetail = () => {
  const { id } = useParams();
  const { data: strategy } = useApi(() => getStrategy(id), [id]);
  const { data: nav, loading: navLoading } = useApi(() => getStrategyNav(id), [id]);
  const { data: holdings } = useApi(() => getStrategyHoldings(id), [id]);
  const { data: transactions } = useApi(() => getStrategyTransactions(id), [id]);
  const { data: backtests } = useApi(() => getStrategyBacktests(id), [id]);
  const { data: signals } = useApi(() => getStrategySignals(id), [id]);
  const [tab, setTab] = useState('nav');

  if (navLoading) return <div className="flex justify-center py-32"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400" /></div>;
  if (!strategy) return <div className="text-center py-32 text-slate-400">加载中...</div>;

  const lastNav = nav?.[nav?.length - 1] || {};
  const cumRet = lastNav.cumulative_return ?? 0;
  const sharpe = lastNav.sharpe ?? 0;
  const maxDD = lastNav.max_drawdown ?? 0;
  const totalAssets = lastNav.total_assets ?? strategy.initial_capital ?? 0;
  const dailyRet = lastNav.daily_return ?? 0;

  // Merged NAV chart: backtest equity curve + benchmark + live NAV, backtrader style
  const btCurve = backtests?.[0]?.equity_curve || [];
  const liveNav = nav || [];
  const initialCapital = strategy.initial_capital || 1000000;

  // Build a synthetic benchmark curve (沪深300 ~ index) from backtest equity curve
  // Benchmark: assume ~8% annual return (typical CSI300 long-term)
  // We'll use the backtest equity curve dates with a benchmark line
  const btDates = btCurve.map(p => p.date);
  const liveDates = liveNav.map(d => d.trade_date);
  const allDates = [...new Set([...btDates, ...liveDates])].sort();
  const liveStartDate = liveDates[0];

  // Benchmark: buy-and-hold of index from initial capital, ~8% annual
  // For simplicity, use a fixed growth rate across the backtest period
  const firstBtDate = btDates[0];
  const benchmarkAnnualRate = 0.08;
  const tradingDaysPerYear = 252;
  const benchmarkValues = {};
  allDates.forEach(d => {
    if (firstBtDate && d >= firstBtDate) {
      const daysDiff = Math.round((new Date(d) - new Date(firstBtDate)) / (1000 * 60 * 60 * 24));
      const tradingDays = Math.floor(daysDiff * 5 / 7); // approx trading days
      benchmarkValues[d] = initialCapital * Math.pow(1 + benchmarkAnnualRate, tradingDays / tradingDaysPerYear);
    }
  });

  const navChartOption = allDates.length > 0 ? {
    ...echartsBase,
    legend: { ...echartsBase.legend, data: ['策略净值', '基准(沪深300)', '初始资金', '模拟盘净值'], top: 0 },
    xAxis: { ...echartsBase.xAxis, data: allDates },
    yAxis: { ...echartsBase.yAxis, scale: true, name: '元' },
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
      { type: 'slider', start: 0, end: 100, height: 20, bottom: 5, borderColor: '#334155', fillerColor: 'rgba(59,130,246,0.1)' },
    ],
    tooltip: {
      ...echartsBase.tooltip,
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      formatter: (params) => {
        if (!params || !params.length) return '';
        const date = params[0].axisValue;
        let html = `<div style="font-weight:600;margin-bottom:4px">${date}</div>`;
        for (const p of params) {
          if (p.value == null) continue;
          const val = typeof p.value === 'number' ? p.value.toLocaleString(undefined, { maximumFractionDigits: 0 }) : p.value;
          html += `<div><span style="color:${p.color}">●</span> ${p.seriesName}: ¥${val}</div>`;
        }
        // Calculate excess return for the first strategy point
        const stratVal = params.find(p => p.seriesName === '策略净值')?.value;
        const benchVal = params.find(p => p.seriesName === '基准(沪深300)')?.value;
        if (stratVal && benchVal) {
          const excess = ((stratVal / benchVal - 1) * 100).toFixed(2);
          html += `<div style="margin-top:4px;color:#94a3b8">超额: ${excess > 0 ? '+' : ''}${excess}%</div>`;
        }
        if (stratVal) {
          const ret = ((stratVal / initialCapital - 1) * 100).toFixed(2);
          html += `<div style="color:#94a3b8">累计收益: ${ret > 0 ? '+' : ''}${ret}%</div>`;
        }
        return html;
      },
    },
    series: [
      {
        name: '策略净值',
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
        name: '基准(沪深300)',
        type: 'line',
        data: allDates.map(d => benchmarkValues[d] || null),
        smooth: true,
        symbol: 'none',
        lineStyle: { color: '#64748b', width: 1.5, type: 'dashed' },
        connectNulls: false,
      },
      {
        name: '初始资金',
        type: 'line',
        data: allDates.map(() => initialCapital),
        symbol: 'none',
        lineStyle: { color: '#475569', width: 1, type: 'dotted' },
        silent: true,
      },
      {
        name: '模拟盘净值',
        type: 'line',
        data: allDates.map(d => {
          const lv = liveNav.find(n => n.trade_date === d);
          return lv ? Number(lv.total_assets) : null;
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
  } : null;

  // Holdings pie chart
  const holdingsPieOption = holdings && holdings.length > 0 ? {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'item', backgroundColor: 'rgba(15, 23, 42, 0.95)', borderColor: '#334155', textStyle: { color: '#e2e8f0' } },
    legend: { type: 'scroll', orient: 'vertical', right: 0, top: 'center', textStyle: { color: '#94a3b8' } },
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      center: ['40%', '50%'],
      data: holdings.map(h => ({ name: h.name || h.symbol, value: Number(h.market_value) })),
      label: { color: '#94a3b8' },
      itemStyle: { borderColor: '#1e293b', borderWidth: 2 },
    }],
  } : null;

  // Backtest overlay chart (full data with dataZoom)
  const overlayDates = [...new Set([
    ...btCurve.map(p => p.date),
    ...(nav || []).map(d => d.trade_date),
  ])].sort();
  const backtestChartOption = backtests && backtests.length > 0 && btCurve.length > 0 ? {
    ...echartsBase,
    legend: { ...echartsBase.legend, data: ['回测净值', '模拟盘净值'], top: 0 },
    xAxis: { ...echartsBase.xAxis, data: overlayDates },
    yAxis: { ...echartsBase.yAxis, scale: true },
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
      { type: 'slider', start: 0, end: 100, height: 20, bottom: 5, borderColor: '#334155', fillerColor: 'rgba(59,130,246,0.1)' },
    ],
    series: [
      {
        name: '回测净值',
        type: 'line',
        data: overlayDates.map(d => {
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
        data: overlayDates.map(d => {
          const lv = (nav || []).find(n => n.trade_date === d);
          return lv ? Number(lv.total_assets) : null;
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
  } : null;

  return (
    <div className="max-w-[1600px] mx-auto px-6 py-8">
      <Link to="/" className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-100 mb-4">
        <ArrowLeft className="w-4 h-4" /> 返回总览
      </Link>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">{strategy.name}</h1>
          <p className="text-sm text-slate-500 mt-1">{strategy.description} | 基准: {strategy.benchmark}</p>
        </div>
        <span className={`px-3 py-1 rounded-lg text-sm font-medium ${
          strategy.status === 'running' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-700 text-slate-400'
        }`}>
          {strategy.status === 'running' ? '运行中' : '已停止'}
        </span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        {[
          { label: '总资产', value: fmtMoney(totalAssets), color: 'text-slate-100' },
          { label: '累计收益', value: fmtPct(cumRet), color: colorPct(cumRet) },
          { label: '当日收益', value: fmtPct(dailyRet), color: colorPct(dailyRet) },
          { label: 'Sharpe', value: fmtNum(sharpe), color: 'text-slate-100' },
          { label: '最大回撤', value: fmtPct(maxDD), color: 'text-red-400' },
          { label: '持仓数', value: holdings?.length ?? '—', color: 'text-slate-100' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
            <p className="text-xs text-slate-500 mb-1">{label}</p>
            <p className={`text-lg font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-slate-700">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === key
                ? 'border-blue-400 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-100'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'nav' && (
        <div className="space-y-6">
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <h3 className="text-sm font-medium text-slate-300 mb-4">净值曲线</h3>
            {navChartOption ? (
              <ReactECharts option={navChartOption} style={{ height: '500px' }} />
            ) : <p className="text-slate-500 text-center py-20">暂无净值数据</p>}
          </div>
        </div>
      )}

      {tab === 'holdings' && (
        <div className="space-y-6">
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <h3 className="text-sm font-medium text-slate-300 mb-4">持仓分布</h3>
            {holdingsPieOption ? (
              <ReactECharts option={holdingsPieOption} style={{ height: '350px' }} />
            ) : <p className="text-slate-500 text-center py-12">暂无持仓数据</p>}
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-slate-400">
                  <th className="text-left p-4">代码</th>
                  <th className="text-left p-4">名称</th>
                  <th className="text-right p-4">持仓量</th>
                  <th className="text-right p-4">成本价</th>
                  <th className="text-right p-4">现价</th>
                  <th className="text-right p-4">市值</th>
                  <th className="text-right p-4">盈亏</th>
                  <th className="text-right p-4">权重</th>
                </tr>
              </thead>
              <tbody>
                {holdings?.map((h) => (
                  <tr key={h.symbol} className="border-b border-slate-800 hover:bg-slate-800/30">
                    <td className="p-4">
                      <Link to={`/stock/${h.symbol}`} className="text-blue-400 font-medium hover:text-blue-300 hover:underline">
                        {h.symbol}
                      </Link>
                    </td>
                    <td className="p-4 text-slate-200">
                      <Link to={`/stock/${h.symbol}`} className="hover:text-blue-300">{h.name}</Link>
                    </td>
                    <td className="p-4 text-right text-slate-300">{h.quantity?.toLocaleString()}</td>
                    <td className="p-4 text-right text-slate-300">{fmtNum(h.cost_price)}</td>
                    <td className="p-4 text-right text-slate-300">{fmtNum(h.current_price)}</td>
                    <td className="p-4 text-right text-slate-200">{fmtMoney(h.market_value)}</td>
                    <td className={`p-4 text-right font-medium ${colorPct(h.profit_pct)}`}>{fmtPct(h.profit_pct)}</td>
                    <td className="p-4 text-right text-slate-400">{fmtPct(h.weight, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'transactions' && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-slate-400">
                <th className="text-left p-4">日期</th>
                <th className="text-left p-4">代码</th>
                <th className="text-left p-4">名称</th>
                <th className="text-left p-4">方向</th>
                <th className="text-right p-4">数量</th>
                <th className="text-right p-4">价格</th>
                <th className="text-right p-4">金额</th>
                <th className="text-right p-4">佣金</th>
                <th className="text-left p-4">原因</th>
              </tr>
            </thead>
            <tbody>
              {transactions?.slice().reverse().map((t, i) => (
                <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/30">
                  <td className="p-4 text-slate-400">{t.trade_date}</td>
                  <td className="p-4 text-blue-400 font-medium">{t.symbol}</td>
                  <td className="p-4 text-slate-200">{t.name}</td>
                  <td className="p-4">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      t.side === 'buy' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                    }`}>
                      {t.side === 'buy' ? '买入' : '卖出'}
                    </span>
                  </td>
                  <td className="p-4 text-right text-slate-300">{t.quantity?.toLocaleString()}</td>
                  <td className="p-4 text-right text-slate-300">{fmtNum(t.price)}</td>
                  <td className="p-4 text-right text-slate-200">{fmtMoney(t.amount)}</td>
                  <td className="p-4 text-right text-slate-500">{fmtNum(t.commission)}</td>
                  <td className="p-4 text-slate-500 text-xs">{t.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'backtest' && (
        <div className="space-y-6">
          {backtestChartOption ? (
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
              <h3 className="text-sm font-medium text-slate-300 mb-4">回测 vs 模拟盘净值对比</h3>
              <ReactECharts option={backtestChartOption} style={{ height: '400px' }} />
            </div>
          ) : <p className="text-slate-500 text-center py-20">暂无回测数据</p>}

          {backtests && backtests.length > 0 && (
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-400">
                    <th className="text-left p-4">回测日期</th>
                    <th className="text-right p-4">年化收益</th>
                    <th className="text-right p-4">Sharpe</th>
                    <th className="text-right p-4">最大回撤</th>
                    <th className="text-right p-4">基准收益</th>
                    <th className="text-right p-4">超额收益</th>
                    <th className="text-right p-4">IR</th>
                  </tr>
                </thead>
                <tbody>
                  {backtests.map((b, i) => (
                    <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/30">
                      <td className="p-4 text-slate-400">{b.backtest_date}</td>
                      <td className={`p-4 text-right ${colorPct(b.annual_return)}`}>{fmtPct(b.annual_return)}</td>
                      <td className="p-4 text-right text-slate-300">{fmtNum(b.sharpe)}</td>
                      <td className="p-4 text-right text-red-400">{fmtPct(b.max_drawdown)}</td>
                      <td className="p-4 text-right text-slate-300">{fmtPct(b.benchmark_return)}</td>
                      <td className={`p-4 text-right ${colorPct(b.excess_return)}`}>{fmtPct(b.excess_return)}</td>
                      <td className="p-4 text-right text-slate-300">{fmtNum(b.ir)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'signals' && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden">
          {signals && signals.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-slate-400">
                  <th className="text-left p-4">日期</th>
                  <th className="text-left p-4">代码</th>
                  <th className="text-left p-4">名称</th>
                  <th className="text-right p-4">排名</th>
                  <th className="text-right p-4">评分</th>
                  <th className="text-right p-4">权重</th>
                  <th className="text-right p-4">收盘价</th>
                  <th className="text-left p-4">操作</th>
                </tr>
              </thead>
              <tbody>
                {signals.map((s, i) => (
                  <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/30">
                    <td className="p-4 text-slate-400">{s.signal_date || s.trade_date || '—'}</td>
                    <td className="p-4">
                      <Link to={`/stock/${s.symbol}`} className="text-blue-400 font-medium hover:text-blue-300 hover:underline">
                        {s.symbol}
                      </Link>
                    </td>
                    <td className="p-4 text-slate-200">
                      <Link to={`/stock/${s.symbol}`} className="hover:text-blue-300">{s.name}</Link>
                    </td>
                    <td className="p-4 text-right text-slate-300">{s.rank ?? '—'}</td>
                    <td className="p-4 text-right text-slate-300">{s.score != null ? Number(s.score).toFixed(3) : '—'}</td>
                    <td className="p-4 text-right text-slate-400">{s.weight != null ? `${(s.weight * 100).toFixed(1)}%` : '—'}</td>
                    <td className="p-4 text-right text-slate-400">{s.close != null ? Number(s.close).toFixed(2) : '—'}</td>
                    <td className="p-4">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        s.action === 'buy' ? 'bg-emerald-500/10 text-emerald-400'
                        : s.action === 'sell' ? 'bg-red-500/10 text-red-400'
                        : 'bg-slate-700 text-slate-400'
                      }`}>
                        {s.action === 'buy' ? '买入' : s.action === 'sell' ? '卖出' : s.action || '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-slate-500 text-center py-20">暂无信号数据</p>}
        </div>
      )}
    </div>
  );
};

export default StrategyDetail;
