import { useEffect, useState } from 'react';
import { useApi, fmtNum, colorPctRaw } from '../components/ui';
import { getIndices } from '../services/api';
import { TrendingUp, Layers, Activity } from 'lucide-react';

const Markets = () => {
  const { data: indices, loading } = useApi(getIndices);

  return (
    <div className="max-w-[1600px] mx-auto px-6 py-8">
      <h1 className="text-2xl font-bold text-slate-100 mb-6 flex items-center gap-3">
        <Layers className="w-7 h-7 text-blue-400" /> 指数行情
      </h1>

      {loading ? (
        <div className="flex justify-center py-32">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400" />
        </div>
      ) : indices && indices.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {indices.map((idx) => {
            const change = idx.change_pct ?? idx.changePct ?? idx.pct_chg ?? 0;
            const isUp = change >= 0;
            return (
              <div key={idx.code || idx.symbol} className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-lg font-bold text-slate-100">{idx.name || idx.code || idx.symbol}</h3>
                    <p className="text-xs text-slate-500">{idx.code || idx.symbol}</p>
                  </div>
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    isUp ? 'bg-emerald-500/10' : 'bg-red-500/10'
                  }`}>
                    {isUp ? <TrendingUp className="w-5 h-5 text-emerald-400" /> : <TrendingUp className="w-5 h-5 text-red-400 rotate-180" />}
                  </div>
                </div>
                <div className="flex items-baseline gap-4">
                  <span className="text-2xl font-bold text-slate-100">{fmtNum(idx.last || idx.price || idx.close)}</span>
                  <span className={`text-lg font-semibold ${colorPctRaw(change)}`}>
                    {isUp ? '+' : ''}{Number(change).toFixed(2)}%
                  </span>
                </div>
                {(idx.high || idx.low) && (
                  <div className="flex gap-4 mt-3 text-xs text-slate-500">
                    {idx.high && <span>高: {fmtNum(idx.high)}</span>}
                    {idx.low && <span>低: {fmtNum(idx.low)}</span>}
                    {idx.volume && <span>成交: {idx.volume?.toLocaleString()}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-12 text-center">
          <Activity className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <p className="text-slate-500">暂无行情数据</p>
        </div>
      )}
    </div>
  );
};

export default Markets;
