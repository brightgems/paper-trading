import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, fmtPct, fmtMoney, fmtNum, colorPct, strategyColors } from '../components/ui';
import { getStrategies, getStrategyNav } from '../services/api';
import { BarChart3, TrendingUp, TrendingDown, Activity, Wallet } from 'lucide-react';

const StrategyOverview = () => {
  const { data: strategies, loading, error } = useApi(getStrategies);
  const [navData, setNavData] = useState({});

  useEffect(() => {
    if (!strategies) return;
    strategies.forEach(async (s) => {
      try {
        const res = await getStrategyNav(s.id);
        setNavData(prev => ({ ...prev, [s.id]: res.data }));
      } catch { /* ignore */ }
    });
  }, [strategies]);

  if (loading) return <div className="flex justify-center py-32"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400" /></div>;
  if (error) return <div className="text-center py-32 text-red-400">加载策略数据失败</div>;
  if (!strategies || strategies.length === 0) return <div className="text-center py-32 text-slate-400">暂无策略，请先在策略配置中创建</div>;

  // Aggregate summary
  const totalAssets = strategies.reduce((sum, s) => {
    const nav = navData[s.id];
    const last = nav?.[nav.length - 1];
    return sum + (last?.total_assets || s.initial_capital || 0);
  }, 0);
  const avgReturn = strategies.reduce((sum, s) => {
    const nav = navData[s.id];
    const last = nav?.[nav.length - 1];
    return sum + (last?.cumulative_return || 0);
  }, 0) / strategies.length;

  const summaryCards = [
    { label: '总资产', value: fmtMoney(totalAssets), icon: Wallet, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { label: '策略数', value: strategies.length, icon: BarChart3, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { label: '平均累计收益', value: fmtPct(avgReturn), icon: avgReturn >= 0 ? TrendingUp : TrendingDown, color: colorPct(avgReturn), bg: avgReturn >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10' },
    { label: '运行中策略', value: strategies.filter(s => s.status === 'running').length, icon: Activity, color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
  ];

  return (
    <div className="max-w-[1600px] mx-auto px-6 py-8">
      <h1 className="text-2xl font-bold text-slate-100 mb-6">策略总览</h1>

      {/* Summary row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {summaryCards.map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-slate-800/50 border border-slate-700 rounded-xl p-5 flex items-center gap-4">
            <div className={`w-12 h-12 rounded-lg ${bg} flex items-center justify-center`}>
              <Icon className={`w-6 h-6 ${color}`} />
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-1">{label}</p>
              <p className="text-xl font-bold text-slate-100">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Strategy cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {strategies.map((s, idx) => {
          const nav = navData[s.id];
          const last = nav?.[nav?.length - 1];
          const cumRet = last?.cumulative_return ?? 0;
          const sharpe = last?.sharpe ?? 0;
          const maxDD = last?.max_drawdown ?? 0;
          const marketValue = last?.market_value ?? 0;
          const totalAssetsS = last?.total_assets ?? s.initial_capital ?? 0;
          const positionRatio = totalAssetsS > 0 ? (marketValue / totalAssetsS) : 0;
          const holdingsCount = nav ? 0 : 0; // will be replaced when holdings loaded
          const color = strategyColors[idx % strategyColors.length];

          return (
            <Link
              key={s.id}
              to={`/strategy/${s.id}`}
              className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 hover:border-blue-500/50 transition-colors group"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                    <h3 className="text-lg font-bold text-slate-100 group-hover:text-blue-400 transition-colors">{s.name}</h3>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{s.benchmark}</p>
                </div>
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  s.status === 'running' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-700 text-slate-400'
                }`}>
                  {s.status === 'running' ? '运行中' : '已停止'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-slate-500">净值</p>
                  <p className="text-lg font-semibold text-slate-100">{fmtMoney(totalAssetsS)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">累计收益</p>
                  <p className={`text-lg font-semibold ${colorPct(cumRet)}`}>{fmtPct(cumRet)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Sharpe</p>
                  <p className="text-sm font-semibold text-slate-200">{fmtNum(sharpe)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">最大回撤</p>
                  <p className="text-sm font-semibold text-red-400">{fmtPct(maxDD)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">仓位比例</p>
                  <p className="text-sm font-semibold text-slate-200">{fmtPct(positionRatio, 0)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">初始资金</p>
                  <p className="text-sm font-semibold text-slate-200">{fmtMoney(s.initial_capital)}</p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
};

export default StrategyOverview;
