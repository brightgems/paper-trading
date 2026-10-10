/**
 * Engine Controller
 * Endpoints to trigger rebalance, get engine status, and run backtest comparison.
 */

const {
    rebalance,
    rebalanceAll,
    getEngineStatus,
} = require('../services/rebalanceEngine');

// ─── Trigger rebalance for one strategy ────────────────────

exports.triggerRebalance = async (req, res) => {
    try {
        const { strategyId } = req.params;
        const { force, date } = req.body || {};
        const result = await rebalance(strategyId, {
            forceRebalance: force || false,
            date: date || undefined,
        });
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ─── Trigger rebalance for all strategies ──────────────────

exports.triggerRebalanceAll = async (req, res) => {
    try {
        const { force, date } = req.body || {};
        const results = await rebalanceAll({
            forceRebalance: force || false,
            date: date || undefined,
        });
        res.json({
            timestamp: new Date().toISOString(),
            total: results.length,
            results,
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ─── Get engine status ─────────────────────────────────────

exports.status = (req, res) => {
    try {
        const status = getEngineStatus();
        res.json(status);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ─── Run backtest comparison ───────────────────────────────
// Compares live paper trading performance vs imported backtest results

exports.runBacktestComparison = (req, res) => {
    try {
        const { getDB } = require('../config/db');
        const db = getDB();
        const { strategyId } = req.params;

        const strategy = db.prepare('SELECT * FROM strategies WHERE id = ?').get(strategyId);
        if (!strategy) return res.status(404).json({ error: 'Strategy not found' });

        // Live paper trading stats
        const latestNav = db.prepare(`
            SELECT * FROM nav_snapshots WHERE strategy_id = ?
            ORDER BY trade_date DESC LIMIT 1
        `).get(strategyId);

        const firstNav = db.prepare(`
            SELECT * FROM nav_snapshots WHERE strategy_id = ?
            ORDER BY trade_date ASC LIMIT 1
        `).get(strategyId);

        const allNavs = db.prepare(`
            SELECT trade_date, total_assets, daily_return, cumulative_return
            FROM nav_snapshots WHERE strategy_id = ?
            ORDER BY trade_date ASC
        `).all(strategyId);

        const liveReturns = allNavs.map(n => n.daily_return).filter(r => r !== 0);
        const liveWinDays = liveReturns.filter(r => r > 0).length;
        const liveWinRate = liveReturns.length > 0 ? liveWinDays / liveReturns.length : 0;

        // Calculate live annual return from days elapsed
        const daysElapsed = allNavs.length;
        const liveCumReturn = latestNav ? latestNav.cumulative_return : 0;
        const liveAnnualReturn = daysElapsed > 0 && latestNav && firstNav
            ? (Math.pow((latestNav.total_assets / firstNav.total_assets), 252 / daysElapsed) - 1)
            : 0;

        const liveStats = {
            totalAssets: latestNav ? latestNav.total_assets : strategy.initial_capital,
            cumulativeReturn: liveCumReturn,
            annualReturn: liveAnnualReturn,
            sharpe: latestNav ? latestNav.sharpe : 0,
            maxDrawdown: latestNav ? latestNav.max_drawdown : 0,
            winRate: liveWinRate,
            daysElapsed,
            startDate: firstNav ? firstNav.trade_date : null,
            endDate: latestNav ? latestNav.trade_date : null,
            equityCurve: allNavs.map(n => ({
                date: n.trade_date,
                value: n.total_assets,
                cumulative_return: n.cumulative_return,
            })),
        };

        // Backtest results
        const backtestResults = db.prepare(`
            SELECT * FROM backtest_results WHERE strategy_id = ?
            ORDER BY backtest_date DESC
        `).all(strategyId);

        const backtestStats = backtestResults.map(r => ({
            ...r,
            params: JSON.parse(r.params || '{}'),
            equity_curve: r.equity_curve ? JSON.parse(r.equity_curve) : [],
            monthly_returns: r.monthly_returns ? JSON.parse(r.monthly_returns) : [],
        }));

        // Comparison
        const comparison = {
            strategyId,
            strategyName: strategy.name,
            benchmark: strategy.benchmark,
            live: liveStats,
            backtest: backtestStats,
            // Delta: live vs latest backtest
            delta: backtestStats.length > 0 ? {
                annualReturn: liveAnnualReturn - (backtestStats[0].annual_return || 0),
                sharpe: (latestNav ? latestNav.sharpe : 0) - (backtestStats[0].sharpe || 0),
                maxDrawdown: (latestNav ? latestNav.max_drawdown : 0) - (backtestStats[0].max_drawdown || 0),
                winRate: liveWinRate - (backtestStats[0].win_rate || 0),
            } : null,
        };

        res.json(comparison);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};
