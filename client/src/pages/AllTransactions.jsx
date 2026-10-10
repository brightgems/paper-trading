import { useEffect, useState } from 'react';
import { useApi, fmtMoney, fmtNum } from '../components/ui';
import { getStrategies, getStrategyTransactions } from '../services/api';
import { ArrowLeftRight, Filter, Search } from 'lucide-react';

const AllTransactions = () => {
  const { data: strategies } = useApi(getStrategies);
  const [allTxns, setAllTxns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStrategy, setFilterStrategy] = useState('all');
  const [filterSymbol, setFilterSymbol] = useState('');
  const [filterDate, setFilterDate] = useState('');

  useEffect(() => {
    if (!strategies) return;
    let active = true;
    setLoading(true);
    Promise.all(
      strategies.map(async (s) => {
        try {
          const res = await getStrategyTransactions(s.id);
          return res.data.map(t => ({ ...t, strategy_id: s.id, strategy_name: s.name }));
        } catch {
          return [];
        }
      })
    ).then(results => {
      if (!active) return;
      const merged = results.flat().sort((a, b) => (b.trade_date || '').localeCompare(a.trade_date || ''));
      setAllTxns(merged);
      setLoading(false);
    });
    return () => { active = false; };
  }, [strategies]);

  const filtered = allTxns.filter(t => {
    if (filterStrategy !== 'all' && t.strategy_id !== filterStrategy) return false;
    if (filterSymbol && !t.symbol?.toLowerCase().includes(filterSymbol.toLowerCase()) && !t.name?.includes(filterSymbol)) return false;
    if (filterDate && !t.trade_date?.startsWith(filterDate)) return false;
    return true;
  });

  if (loading) return <div className="flex justify-center py-32"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400" /></div>;

  return (
    <div className="max-w-[1600px] mx-auto px-6 py-8">
      <h1 className="text-2xl font-bold text-slate-100 mb-6 flex items-center gap-3">
        <ArrowLeftRight className="w-7 h-7 text-blue-400" /> 交易流水
      </h1>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            value={filterStrategy}
            onChange={(e) => setFilterStrategy(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-blue-400 outline-none"
          >
            <option value="all">全部策略</option>
            {strategies?.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="股票代码/名称"
            value={filterSymbol}
            onChange={(e) => setFilterSymbol(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-3 py-2 text-sm text-slate-200 focus:border-blue-400 outline-none w-40"
          />
        </div>
        <input
          type="date"
          value={filterDate}
          onChange={(e) => setFilterDate(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-blue-400 outline-none"
        />
        <span className="text-sm text-slate-500">共 {filtered.length} 条记录</span>
      </div>

      {/* Table */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="border-b border-slate-700 text-slate-400">
              <th className="text-left p-4">日期</th>
              <th className="text-left p-4">策略</th>
              <th className="text-left p-4">代码</th>
              <th className="text-left p-4">名称</th>
              <th className="text-left p-4">方向</th>
              <th className="text-right p-4">数量</th>
              <th className="text-right p-4">价格</th>
              <th className="text-right p-4">金额</th>
              <th className="text-left p-4">原因</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t, i) => (
              <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/30">
                <td className="p-4 text-slate-400 whitespace-nowrap">{t.trade_date}</td>
                <td className="p-4 text-slate-300 text-xs">{t.strategy_name}</td>
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
                <td className="p-4 text-slate-500 text-xs">{t.reason || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="text-slate-500 text-center py-12">无匹配记录</p>}
      </div>
    </div>
  );
};

export default AllTransactions;
