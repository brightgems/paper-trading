import { useEffect, useState } from 'react';
import { useApi, fmtMoney } from '../components/ui';
import { getStrategies, createStrategy, updateStrategy, deleteStrategy } from '../services/api';
import { Settings, Plus, Pencil, Trash2, X, Save, RotateCcw } from 'lucide-react';

const EMPTY_FORM = {
  name: '',
  description: '',
  initial_capital: 1000000,
  signal_source: 'top10_csv',
  signal_config: '{}',
  rebalance_rule: '{}',
  stop_loss: 0,
  take_profit: 0,
  benchmark: '000300.SH',
  status: 'running',
};

const StrategyConfig = () => {
  const { data: strategies, loading, refetch } = useApi(getStrategies);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState(null);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setError(null);
    setShowForm(true);
  };

  const openEdit = (s) => {
    setForm({
      name: s.name || '',
      description: s.description || '',
      initial_capital: s.initial_capital || 1000000,
      signal_source: s.signal_source || 'top10_csv',
      signal_config: typeof s.signal_config === 'string' ? s.signal_config : JSON.stringify(s.signal_config || {}, null, 2),
      rebalance_rule: typeof s.rebalance_rule === 'string' ? s.rebalance_rule : JSON.stringify(s.rebalance_rule || {}, null, 2),
      stop_loss: s.stop_loss || 0,
      take_profit: s.take_profit || 0,
      benchmark: s.benchmark || '000300.SH',
      status: s.status || 'running',
    });
    setEditingId(s.id);
    setError(null);
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    // Validate JSON fields
    try {
      JSON.parse(form.signal_config);
      JSON.parse(form.rebalance_rule);
    } catch (err) {
      setError('信号配置或调仓规则 JSON 格式错误');
      return;
    }
    try {
      const payload = {
        ...form,
        signal_config: JSON.parse(form.signal_config),
        rebalance_rule: JSON.parse(form.rebalance_rule),
        initial_capital: Number(form.initial_capital),
        stop_loss: Number(form.stop_loss),
        take_profit: Number(form.take_profit),
      };
      if (editingId) {
        await updateStrategy(editingId, payload);
      } else {
        await createStrategy(payload);
      }
      setShowForm(false);
      refetch();
    } catch (err) {
      setError(err.response?.data?.error || err.message || '操作失败');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('确认删除该策略？此操作不可撤销。')) return;
    try {
      await deleteStrategy(id);
      refetch();
    } catch (err) {
      setError(err.response?.data?.error || '删除失败');
    }
  };

  if (loading) return <div className="flex justify-center py-32"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400" /></div>;

  return (
    <div className="max-w-[1600px] mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-3">
          <Settings className="w-7 h-7 text-blue-400" /> 策略配置
        </h1>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-blue-500/10 text-blue-400 rounded-lg hover:bg-blue-500/20 transition-colors text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> 新建策略
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3 mb-6 text-sm">
          {error}
        </div>
      )}

      {/* Strategy list */}
      <div className="space-y-4">
        {strategies?.map(s => (
          <div key={s.id} className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="text-lg font-bold text-slate-100">{s.name}</h3>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    s.status === 'running' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-700 text-slate-400'
                  }`}>
                    {s.status === 'running' ? '运行中' : '已停止'}
                  </span>
                </div>
                <p className="text-sm text-slate-400 mb-3">{s.description || '无描述'}</p>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
                  <span>初始资金: {fmtMoney(s.initial_capital)}</span>
                  <span>基准: {s.benchmark}</span>
                  <span>信号源: {s.signal_source || '—'}</span>
                  <span>止损: {s.stop_loss || '无'}</span>
                  <span>止盈: {s.take_profit || '无'}</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => openEdit(s)}
                  className="p-2 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(s.id)}
                  className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
        {strategies?.length === 0 && (
          <p className="text-slate-500 text-center py-20">暂无策略，点击右上角新建</p>
        )}
      </div>

      {/* Modal form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-slate-700">
              <h2 className="text-lg font-bold text-slate-100">{editingId ? '编辑策略' : '新建策略'}</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">名称</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 focus:border-blue-400 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">描述</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  rows={2}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 focus:border-blue-400 outline-none resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">初始资金</label>
                  <input
                    type="number"
                    value={form.initial_capital}
                    onChange={e => setForm({ ...form, initial_capital: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 focus:border-blue-400 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">基准</label>
                  <input
                    type="text"
                    value={form.benchmark}
                    onChange={e => setForm({ ...form, benchmark: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 focus:border-blue-400 outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">信号源</label>
                  <select
                    value={form.signal_source}
                    onChange={e => setForm({ ...form, signal_source: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 focus:border-blue-400 outline-none"
                  >
                    <option value="top10_csv">top10_csv</option>
                    <option value="quantdb_factor">quantdb_factor</option>
                    <option value="none">none</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">止损</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.stop_loss}
                    onChange={e => setForm({ ...form, stop_loss: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 focus:border-blue-400 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">止盈</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.take_profit}
                    onChange={e => setForm({ ...form, take_profit: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 focus:border-blue-400 outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">信号配置 (JSON)</label>
                <textarea
                  value={form.signal_config}
                  onChange={e => setForm({ ...form, signal_config: e.target.value })}
                  rows={4}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 focus:border-blue-400 outline-none font-mono text-xs"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">调仓规则 (JSON)</label>
                <textarea
                  value={form.rebalance_rule}
                  onChange={e => setForm({ ...form, rebalance_rule: e.target.value })}
                  rows={4}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 focus:border-blue-400 outline-none font-mono text-xs"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">状态</label>
                <select
                  value={form.status}
                  onChange={e => setForm({ ...form, status: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 focus:border-blue-400 outline-none"
                >
                  <option value="running">运行中</option>
                  <option value="stopped">已停止</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex items-center gap-2 px-4 py-2 text-slate-400 hover:text-slate-100 rounded-lg transition-colors text-sm"
                >
                  <X className="w-4 h-4" /> 取消
                </button>
                <button
                  type="submit"
                  className="flex items-center gap-2 px-4 py-2 bg-blue-500/10 text-blue-400 rounded-lg hover:bg-blue-500/20 transition-colors text-sm font-medium"
                >
                  <Save className="w-4 h-4" /> 保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default StrategyConfig;
