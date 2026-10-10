import { useEffect, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { useApi, fmtPct, fmtNum, colorPct, echartsBase, strategyColors } from '../components/ui';
import { getStrategies, compareStrategies, getStrategyNav } from '../services/api';
import { GitCompare, Grid3x3 } from 'lucide-react';

const StrategyCompare = () => {
  const { data: strategies } = useApi(getStrategies);
  const { data: compareData, loading } = useApi(compareStrategies);
  const [navMap, setNavMap] = useState({});
  const [selectedStrategy, setSelectedStrategy] = useState(null);

  useEffect(() => {
    if (!strategies) return;
    strategies.forEach(async (s) => {
      try {
        const res = await getStrategyNav(s.id);
        setNavMap(prev => ({ ...prev, [s.id]: res.data }));
      } catch { /* ignore */ }
    });
  }, [strategies]);

  useEffect(() => {
    if (strategies && strategies.length > 0 && !selectedStrategy) {
      setSelectedStrategy(strategies[0].id);
    }
  }, [strategies]);

  // Multi-strategy nav overlay
  const allDates = navMap && Object.values(navMap)[0]?.map(d => d.trade_date) || [];
  const navOverlayOption = allDates.length > 0 ? {
    ...echartsBase,
    legend: {
      ...echartsBase.legend,
      data: strategies?.map(s => s.name) || [],
      top: 0,
    },
    xAxis: { ...echartsBase.xAxis, data: allDates },
    yAxis: { ...echartsBase.yAxis, scale: true, axisLabel: { ...echartsBase.yAxis.axisLabel, formatter: (v) => (v / 10000).toFixed(0) + '万' } },
    series: strategies?.map((s, idx) => {
      const nav = navMap[s.id];
      return {
        name: s.name,
        type: 'line',
        data: nav?.map(d => Number(d.total_assets)) || [],
        smooth: true,
        symbol: 'none',
        lineStyle: { color: strategyColors[idx % strategyColors.length], width: 2 },
      };
    }) || [],
  } : null;

  // Monthly returns heatmap for selected strategy
  const selectedNav = selectedStrategy ? navMap[selectedStrategy] : null;
  const monthlyData = [];
  const years = new Set();
  if (selectedNav) {
    selectedNav.forEach(d => {
      if (d.trade_date) {
        const [year, month] = d.trade_date.split('-');
        years.add(year);
        const ret = d.daily_return ?? 0;
        // accumulate monthly return
        const key = `${year}-${month}`;
        const existing = monthlyData.find(m => m.key === key);
        if (existing) {
          existing.ret = existing.ret + ret;
        } else {
          monthlyData.push({ key, year, month: parseInt(month), ret });
        }
      }
    });
  }
  const yearList = [...years].sort();
  const months = Array.from({ length: 12 }, (_, i) => `${i + 1}月`);

  const heatmapOption = yearList.length > 0 ? {
    backgroundColor: 'transparent',
    tooltip: {
      backgroundColor: 'rgba(15, 23, 42, 0.95)',
      borderColor: '#334155',
      textStyle: { color: '#e2e8f0' },
      formatter: (p) => `${p.value[0]}年${p.value[1]}月<br/>收益率: ${(p.value[2] * 100).toFixed(2)}%`,
    },
    grid: { left: '8%', right: '5%', top: '10%', bottom: '15%' },
    xAxis: {
      type: 'category',
      data: months,
      axisLine: { lineStyle: { color: '#334155' } },
      axisLabel: { color: '#64748b' },
      splitArea: { show: true, areaStyle: { color: ['transparent'] } },
    },
    yAxis: {
      type: 'category',
      data: yearList,
      axisLine: { lineStyle: { color: '#334155' } },
      axisLabel: { color: '#64748b' },
    },
    visualMap: {
      min: -0.1,
      max: 0.1,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: '2%',
      textStyle: { color: '#94a3b8' },
      inRange: { color: ['#f87171', '#1e293b', '#34d399'] },
    },
    series: [{
      name: '月度收益',
      type: 'heatmap',
      data: monthlyData.map(m => [m.month - 1, m.year, m.ret]),
      label: { show: false },
      emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0, 0, 0, 0.5)' } },
    }],
  } : null;

  if (loading) return <div className="flex justify-center py-32"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400" /></div>;

  return (
    <div className="max-w-[1600px] mx-auto px-6 py-8">
      <h1 className="text-2xl font-bold text-slate-100 mb-6 flex items-center gap-3">
        <GitCompare className="w-7 h-7 text-blue-400" /> 策略对比
      </h1>

      {/* Nav overlay */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mb-6">
        <h3 className="text-sm font-medium text-slate-300 mb-4">净值曲线对比</h3>
        {navOverlayOption ? (
          <ReactECharts option={navOverlayOption} style={{ height: '400px' }} />
        ) : <p className="text-slate-500 text-center py-20">暂无数据</p>}
      </div>

      {/* Comparison table */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-slate-400">
              <th className="text-left p-4">策略</th>
              <th className="text-right p-4">累计收益</th>
              <th className="text-right p-4">Sharpe</th>
              <th className="text-right p-4">最大回撤</th>
              <th className="text-right p-4">胜率</th>
              <th className="text-right p-4">换手率</th>
            </tr>
          </thead>
          <tbody>
            {compareData?.map((c, i) => (
              <tr key={c.strategy_id} className="border-b border-slate-800 hover:bg-slate-800/30">
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: strategyColors[i % strategyColors.length] }} />
                    <span className="text-slate-100 font-medium">{c.name}</span>
                  </div>
                </td>
                <td className={`p-4 text-right font-medium ${colorPct(c.cumulative_return)}`}>{fmtPct(c.cumulative_return)}</td>
                <td className="p-4 text-right text-slate-300">{fmtNum(c.sharpe)}</td>
                <td className="p-4 text-right text-red-400">{fmtPct(c.max_drawdown)}</td>
                <td className="p-4 text-right text-slate-300">{c.win_rate != null ? fmtPct(c.win_rate, 1) : '—'}</td>
                <td className="p-4 text-right text-slate-300">{c.turnover != null ? fmtPct(c.turnover, 1) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Monthly heatmap */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
            <Grid3x3 className="w-4 h-4" /> 月度收益热力图
          </h3>
          <select
            value={selectedStrategy || ''}
            onChange={(e) => setSelectedStrategy(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:border-blue-400 outline-none"
          >
            {strategies?.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        {heatmapOption ? (
          <ReactECharts option={heatmapOption} style={{ height: '350px' }} />
        ) : <p className="text-slate-500 text-center py-20">暂无数据</p>}
      </div>
    </div>
  );
};

export default StrategyCompare;
