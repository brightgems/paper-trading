import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

// ─── Strategy CRUD ──────────────────────────────────────────────
export const getStrategies = () => api.get('/strategy');
export const getStrategy = (id) => api.get(`/strategy/${id}`);
export const createStrategy = (data) => api.post('/strategy', data);
export const updateStrategy = (id, data) => api.put(`/strategy/${id}`, data);
export const deleteStrategy = (id) => api.delete(`/strategy/${id}`);

// ─── Strategy Data ──────────────────────────────────────────────
export const getStrategyNav = (id) => api.get(`/strategy/${id}/nav`);
export const getStrategyHoldings = (id) => api.get(`/strategy/${id}/holdings`);
export const getStrategyTransactions = (id) => api.get(`/strategy/${id}/transactions`);
export const getStrategyBacktests = (id) => api.get(`/strategy/${id}/backtest`);
export const importBacktestCSV = (id, formData) =>
  api.post(`/strategy/${id}/backtest/import`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
export const getStrategySignals = (id) => api.get(`/strategy/${id}/signals`);

// ─── Compare / Engine ───────────────────────────────────────────
export const compareStrategies = () => api.get('/strategy/compare/all');
export const triggerRebalance = (id) => api.post(`/strategy/engine/rebalance/${id}`);
export const triggerAllRebalance = () => api.post('/strategy/engine/rebalance-all');
export const getEngineStatus = () => api.get('/strategy/engine/status');

// ─── Markets (existing trade endpoints) ─────────────────────────
export const getIndices = () => api.get('/trade/indices');
export const getStockPrice = (symbol) => api.get(`/trade/price/${symbol}`);

export default api;
