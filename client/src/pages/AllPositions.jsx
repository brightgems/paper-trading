import { useEffect, useState } from 'react';
import { useApi, fmtMoney, fmtNum, fmtPct } from '../components/ui';
import { getStrategies, getStrategyHoldings } from '../services/api';
import { Wallet, Filter } from 'lucide-react';

const AllPositions = () => {
  const { data: strategies } = useApi(getStrategies);
  const [allHoldings, setAllHoldings] = useState({}); // { strategyId: holdings[] }
  const [filterStrategy, setFilterStrategy] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!strategies) return;
    let active = true;
    setLoading(true);
    Promise.all(
      strategies.map(async (s) => {
        try {
          const res = await getStrategyHoldings(s.id);
          return [s.id, res.data];
        } catch {
          return [s.id, []];
        }
      })
    ).then(results => {
      if (!active) return;
      const map = {};
      results.forEach(([id, data]) => { map[id] = data; });
      setAllHoldings(map);
      setLoading(false);
    });
    return () => { active = false; };
  }, [strategies]);

  // Merge holdings by symbol
  const merged = {};
  const strategyList = strategies || [];
  strategyList.forEach(s => {
    const holdings = allHoldings[s.id] || [];
    holdings.forEach(h => {
      if (!merged[h.symbol]) {
        merged[h.symbol] = {
          symbol: h.symbol,
          name: h.name,
          byStrategy: {},
          totalMarketValue: 0,
        };
      }
      merged[h.symbol].byStrategy[s.id] = {
        quantity: h.quantity,
        market_value: Number(h.market_value) || 0,
        weight: h.weight,
      };
      merged[h.symbol].totalMarketValue += Number(h.market_value) || 0;
    });
  });

  let rows = Object.values(merged);
  if (filterStrategy !== 'all') {
    rows = rows.filter(r => r.byStrategy[filterStrategy]);
  }
  rows.sort((a, b) => b.totalMarketValue - a.totalMarketValue);

  const grandTotal = rows.reduce((sum, r) => sum + r.totalMarketValue, 0);

  if (loading) return <div className="flex justify-center py-32"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400" /></div>;

  return (
    <div className="max-w-[1600px] mx-auto px-6 py-8">
      <h1 className="text-2xl font-bold text-slate-100 mb-6 flex items-center gap-3">
        <Wallet className="w-7 h-7 text-blue-400" /> 持仓看板
      </h1>

      {/* Filter */}
      <div className="flex items-center gap-3 mb-6">
        <Filter className="w-4 h-4 text-slate-400" />
        <select
          value={filterStrategy}
          onChange={(e) => setFilterStrategy(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-blue-400 outline-none"
        >
          <option value="all">全部策略</option>
          {strategyList.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <span className="text-sm text-slate-500">合计市值: {fmtMoney(grandTotal)}</span>
      </div>

      {/* Table */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[800px]">
          <thead>
            <tr className="border-b border-slate-700 text-slate-400">
              <th className="text-left p-4">代码</th>
              <th className="text-left p-4">名称</th>
              {strategyList.map(s => (
                <th key={s.id} className="text-right p-4 whitespace-nowrap">{s.name}</th>
              ))}
              <th className="text-right p-4">合并市值</th>
              <th className="text-right p-4">占比</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol} className="border-b border-slate-800 hover:bg-slate-800/30">
                <td className="p-4 text-blue-400 font-medium">{r.symbol}</td>
                <td className="p-4 text-slate-200">{r.name}</td>
                {strategyList.map(s => {
                  const pos = r.byStrategy[s.id];
                  return (
                    <td key={s.id} className="p-4 text-right">
                      {pos ? (
                        <div>
                          <span className="text-slate-300">{pos.quantity?.toLocaleString()}</span>
                          <span className="text-slate-500 text-xs ml-1">{fmtMoney(pos.market_value)}</span>
                        </div>
                      ) : <span className="text-slate-600">—</span>}
                    </td>
                  );
                })}
                <td className="p-4 text-right text-slate-100 font-medium">{fmtMoney(r.totalMarketValue)}</td>
                <td className="p-4 text-right text-slate-400">{grandTotal > 0 ? fmtPct(r.totalMarketValue / grandTotal, 1) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AllPositions;
