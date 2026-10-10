/**
 * Strategy Controller
 * CRUD operations for trading strategies.
 */

const { getDB } = require('../config/db');
const { seedStrategies, SEED_STRATEGIES } = require('../services/rebalanceEngine');

// ─── List all strategies ───────────────────────────────────

exports.listStrategies = (req, res) => {
    try {
        const db = getDB();
        const strategies = db.prepare(`
            SELECT s.*,
                (SELECT COUNT(*) FROM holdings h
                 WHERE h.strategy_id = s.id
                 AND h.trade_date = (SELECT MAX(trade_date) FROM holdings WHERE strategy_id = s.id)
                ) as holding_count,
                (SELECT total_assets FROM nav_snapshots n
                 WHERE n.strategy_id = s.id ORDER BY n.trade_date DESC LIMIT 1
                ) as latest_total_assets,
                (SELECT daily_return FROM nav_snapshots n
                 WHERE n.strategy_id = s.id ORDER BY n.trade_date DESC LIMIT 1
                ) as latest_daily_return,
                (SELECT cumulative_return FROM nav_snapshots n
                 WHERE n.strategy_id = s.id ORDER BY n.trade_date DESC LIMIT 1
                ) as latest_cumulative_return,
                (SELECT max_drawdown FROM nav_snapshots n
                 WHERE n.strategy_id = s.id ORDER BY n.trade_date DESC LIMIT 1
                ) as latest_max_drawdown,
                (SELECT sharpe FROM nav_snapshots n
                 WHERE n.strategy_id = s.id ORDER BY n.trade_date DESC LIMIT 1
                ) as latest_sharpe,
                (SELECT trade_date FROM nav_snapshots n
                 WHERE n.strategy_id = s.id ORDER BY n.trade_date DESC LIMIT 1
                ) as last_trade_date
            FROM strategies s
            ORDER BY s.created_at ASC
        `).all();

        // Parse JSON columns
        const parsed = strategies.map(s => ({
            ...s,
            signal_config: JSON.parse(s.signal_config || '{}'),
            rebalance_rule: JSON.parse(s.rebalance_rule || '{}'),
        }));

        res.json(parsed);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ─── Get single strategy ───────────────────────────────────

exports.getStrategy = (req, res) => {
    try {
        const db = getDB();
        const strategy = db.prepare('SELECT * FROM strategies WHERE id = ?').get(req.params.strategyId);
        if (!strategy) return res.status(404).json({ error: 'Strategy not found' });

        // Get summary stats
        const latestNav = db.prepare(`
            SELECT * FROM nav_snapshots WHERE strategy_id = ?
            ORDER BY trade_date DESC LIMIT 1
        `).get(strategy.id);

        const holdingCount = db.prepare(`
            SELECT COUNT(*) as count FROM holdings
            WHERE strategy_id = ? AND trade_date = (
                SELECT MAX(trade_date) FROM holdings WHERE strategy_id = ?
            )
        `).get(strategy.id, strategy.id);

        const txCount = db.prepare(`
            SELECT COUNT(*) as count FROM transactions WHERE strategy_id = ?
        `).get(strategy.id);

        res.json({
            ...strategy,
            signal_config: JSON.parse(strategy.signal_config || '{}'),
            rebalance_rule: JSON.parse(strategy.rebalance_rule || '{}'),
            summary: {
                latestNav: latestNav || null,
                holdingCount: holdingCount ? holdingCount.count : 0,
                transactionCount: txCount ? txCount.count : 0,
            },
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ─── Create strategy ───────────────────────────────────────

exports.createStrategy = (req, res) => {
    try {
        const db = getDB();
        const {
            id, name, description, initial_capital,
            signal_source, signal_config, rebalance_rule,
            stop_loss, take_profit, benchmark, status,
        } = req.body;

        if (!id || !name) {
            return res.status(400).json({ error: 'id and name are required' });
        }

        // Check duplicate
        const existing = db.prepare('SELECT id FROM strategies WHERE id = ?').get(id);
        if (existing) return res.status(409).json({ error: 'Strategy ID already exists' });

        db.prepare(`
            INSERT INTO strategies
                (id, name, description, initial_capital, signal_source, signal_config,
                 rebalance_rule, stop_loss, take_profit, benchmark, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id, name, description || '', initial_capital || 1000000,
            signal_source || 'top10_csv',
            JSON.stringify(signal_config || {}),
            JSON.stringify(rebalance_rule || {}),
            stop_loss ?? -5.0, take_profit ?? 15.0,
            benchmark || '000300.SH', status || 'active'
        );

        // Initialize NAV with cash = initial_capital
        const today = new Date().toISOString().slice(0, 10);
        db.prepare(`
            INSERT OR IGNORE INTO nav_snapshots
                (strategy_id, trade_date, total_assets, cash, market_value, position_ratio,
                 daily_return, cumulative_return, benchmark_return, excess_return, max_drawdown, sharpe)
            VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0)
        `).run(id, today, initial_capital || 1000000, initial_capital || 1000000);

        res.status(201).json({ id, message: 'Strategy created' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ─── Update strategy ───────────────────────────────────────

exports.updateStrategy = (req, res) => {
    try {
        const db = getDB();
        const existing = db.prepare('SELECT * FROM strategies WHERE id = ?').get(req.params.strategyId);
        if (!existing) return res.status(404).json({ error: 'Strategy not found' });

        const {
            name, description, initial_capital,
            signal_source, signal_config, rebalance_rule,
            stop_loss, take_profit, benchmark, status,
        } = req.body;

        db.prepare(`
            UPDATE strategies SET
                name = COALESCE(?, name),
                description = COALESCE(?, description),
                initial_capital = COALESCE(?, initial_capital),
                signal_source = COALESCE(?, signal_source),
                signal_config = COALESCE(?, signal_config),
                rebalance_rule = COALESCE(?, rebalance_rule),
                stop_loss = COALESCE(?, stop_loss),
                take_profit = COALESCE(?, take_profit),
                benchmark = COALESCE(?, benchmark),
                status = COALESCE(?, status),
                updated_at = datetime('now')
            WHERE id = ?
        `).run(
            name || null,
            description !== undefined ? description : null,
            initial_capital || null,
            signal_source || null,
            signal_config ? JSON.stringify(signal_config) : null,
            rebalance_rule ? JSON.stringify(rebalance_rule) : null,
            stop_loss !== undefined ? stop_loss : null,
            take_profit !== undefined ? take_profit : null,
            benchmark || null,
            status || null,
            req.params.strategyId
        );

        res.json({ id: req.params.strategyId, message: 'Strategy updated' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ─── Delete strategy ───────────────────────────────────────

exports.deleteStrategy = (req, res) => {
    try {
        const db = getDB();
        const existing = db.prepare('SELECT id FROM strategies WHERE id = ?').get(req.params.strategyId);
        if (!existing) return res.status(404).json({ error: 'Strategy not found' });

        // Delete all related data
        db.prepare('DELETE FROM holdings WHERE strategy_id = ?').run(req.params.strategyId);
        db.prepare('DELETE FROM transactions WHERE strategy_id = ?').run(req.params.strategyId);
        db.prepare('DELETE FROM nav_snapshots WHERE strategy_id = ?').run(req.params.strategyId);
        db.prepare('DELETE FROM signals WHERE strategy_id = ?').run(req.params.strategyId);
        db.prepare('DELETE FROM backtest_results WHERE strategy_id = ?').run(req.params.strategyId);
        db.prepare('DELETE FROM strategies WHERE id = ?').run(req.params.strategyId);

        res.json({ id: req.params.strategyId, message: 'Strategy and all related data deleted' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ─── Seed strategies (first run) ───────────────────────────

exports.seed = (req, res) => {
    try {
        const result = seedStrategies();
        res.json({ message: result.seeded ? 'Strategies seeded' : 'Strategies already exist', ...result });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};
