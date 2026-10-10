import { useEffect, useState, useCallback } from 'react';
import api from '../services/api';

/** Generic data fetcher hook */
export function useApi(fetcher, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetcher();
      setData(res.data);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, deps);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}

/** Format helpers */
export const fmtPct = (v, digits = 2) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`;

export const fmtPctRaw = (v, digits = 2) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${Number(v).toFixed(digits)}%`;

export const fmtMoney = (v) =>
  v == null ? '—' : `¥${Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtNum = (v, digits = 2) =>
  v == null ? '—' : Number(v).toFixed(digits);

export const fmtInt = (v) =>
  v == null ? '—' : Number(v).toLocaleString('zh-CN');

export const colorPct = (v) =>
  v == null ? 'text-slate-400' : v >= 0 ? 'text-emerald-400' : 'text-red-400';

export const colorPctRaw = (v) =>
  v == null ? 'text-slate-400' : v >= 0 ? 'text-emerald-400' : 'text-red-400';

/** ECharts common dark theme options */
export const echartsBase = {
  backgroundColor: 'transparent',
  textStyle: { color: '#94a3b8', fontFamily: 'Inter, system-ui, sans-serif' },
  tooltip: {
    trigger: 'axis',
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    borderColor: '#334155',
    textStyle: { color: '#e2e8f0' },
  },
  legend: {
    textStyle: { color: '#94a3b8' },
    inactiveColor: '#475569',
  },
  grid: { left: '3%', right: '3%', bottom: '3%', top: '12%', containLabel: true },
  xAxis: {
    type: 'category',
    axisLine: { lineStyle: { color: '#334155' } },
    axisLabel: { color: '#64748b' },
    splitLine: { show: false },
  },
  yAxis: {
    type: 'value',
    axisLine: { lineStyle: { color: '#334155' } },
    axisLabel: { color: '#64748b' },
    splitLine: { lineStyle: { color: '#1e293b' } },
  },
};

/** Strategy color palette for charts */
export const strategyColors = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#ef4444', '#84cc16',
];

export { api };
