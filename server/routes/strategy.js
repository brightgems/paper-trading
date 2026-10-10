/**
 * Strategy Router
 * All routes for strategy CRUD, portfolio data, and engine control.
 * No auth — this is a read-only tracking dashboard.
 */

const express = require('express');
const router = express.Router();

// Controllers
const strategyController = require('../controllers/strategyController');
const portfolioController = require('../controllers/portfolioController');
const engineController = require('../controllers/engineController');

// ─── Engine Control (before /:strategyId to avoid param collision) ──

router.get('/engine/status', engineController.status);
router.post('/engine/rebalance-all', engineController.triggerRebalanceAll);
router.post('/engine/rebalance/:strategyId', engineController.triggerRebalance);

// ─── Scheduler Control (before /:strategyId to avoid param collision) ──
router.get('/engine/scheduler/status', engineController.getSchedulerStatus);
router.post('/engine/scheduler/start', engineController.startScheduler);
router.post('/engine/scheduler/stop', engineController.stopScheduler);
router.post('/engine/run-all', engineController.runAllStrategies);
router.post('/engine/run/:strategyId', engineController.runStrategyCycle);

// ─── Strategy Comparison (before /:strategyId) ─────────────

router.get('/compare/all', portfolioController.compareStrategies);

// ─── Strategy CRUD ─────────────────────────────────────────

router.get('/', strategyController.listStrategies);
router.post('/', strategyController.createStrategy);
router.post('/seed', strategyController.seed);
router.get('/:strategyId', strategyController.getStrategy);
router.put('/:strategyId', strategyController.updateStrategy);
router.delete('/:strategyId', strategyController.deleteStrategy);

// ─── Portfolio Data ────────────────────────────────────────

router.get('/:strategyId/holdings', portfolioController.getHoldings);
router.get('/:strategyId/nav', portfolioController.getNavSnapshots);
router.get('/:strategyId/transactions', portfolioController.getTransactions);
router.get('/:strategyId/signals', portfolioController.getSignals);
router.get('/:strategyId/dashboard', portfolioController.getDashboard);

// ─── Backtest Results ──────────────────────────────────────

router.get('/:strategyId/backtest', portfolioController.getBacktestResults);
router.post('/:strategyId/backtest/import', portfolioController.importBacktestResults);
router.get('/:strategyId/backtest-comparison', engineController.runBacktestComparison);

module.exports = router;
