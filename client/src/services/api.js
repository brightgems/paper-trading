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

// ─── Stock Detail (trade endpoints) ──────────────────────────────
export const getStockCandles = (symbol, range) =>
  api.get(`/trade/candles/${symbol}`, { params: { range } });
export const getCompanyProfile = (symbol) => api.get(`/trade/profile/${symbol}`);
export const getFinancials = (symbol) => api.get(`/trade/financials/${symbol}`);
export const getRecommendations = (symbol) =>
  api.get(`/trade/recommendations/${symbol}`);
export const getCompanyNews = (symbol) => api.get(`/trade/news/${symbol}`);
export const getMarketNews = () => api.get('/trade/news/market');

// ─── Auth / Portfolio (legacy endpoints) ─────────────────────────
export const getPortfolio = () => api.get('/trade/portfolio');
export const getTransactions = (params) =>
  api.get('/trade/transactions', { params });
export const getMe = () => api.get('/auth/me');
export const updateProfile = (data) => api.put('/profile', data);
export const resetTpin = (data) => api.post('/auth/reset-tpin', data);

export default api;
