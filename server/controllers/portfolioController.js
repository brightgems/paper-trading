/**
 * Portfolio Controller
 * Read-only endpoints for holdings, NAV snapshots, transactions,
 * strategy comparison, and backtest results import/query.
 */

const { getDB } = require('../config/db');
const fs = require('fs');
const path = require('path');
const { parseCSVFile } = require('../services/signalLoader');

// ─── Holdings ───────────────────────────────────────────────

exports.getHoldings = (req, res) => {
    try {
        const db = getDB();
        const { strategyId } = req.params;
        const { date } = req.query;

        let holdings;
        if (date) {
            holdings = db.prepare(`
                SELECT * FROM holdings WHERE strategy_id = ? AND trade_date = ?
                ORDER BY market_value DESC
            `).all(strategyId, date);
        } else {
            // Get latest date's holdings
            const latest = db.prepare(`
                SELECT trade_date FROM holdings WHERE strategy_id = ?
                ORDER BY trade_date DESC LIMIT 1
            `).get(strategyId);
            if (!latest) return res.json([]);
            holdings = db.prepare(`
                SELECT * FROM holdings WHERE strategy_id = ? AND trade_date = ?
                ORDER BY market_value DESC
            `).all(strategyId, latest.trade_date);
        }

        res.json(holdings);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ─── NAV Snapshots ─────────────────────────────────────────

exports.getNavSnapshots = (req, res) => {
    try {
        const db = getDB();
        const { strategyId } = req.params;
        const { start_date, end_date, limit } = req.query;

        let query = 'SELECT * FROM nav_snapshots WHERE strategy_id = ?';
        const params = [strategyId];

        if (start_date) { query += ' AND trade_date >= ?'; params.push(start_date); }
        if (end_date) { query += ' AND trade_date <= ?'; params.push(end_date); }

        query += ' ORDER BY trade_date ASC';
        if (limit) { query += ' LIMIT ?'; params.push(parseInt(limit)); }

        const snapshots = db.prepare(query).all(...params);
        res.json(snapshots);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ─── Transactions ──────────────────────────────────────────

exports.getTransactions = (req, res) => {
    try {
        const db = getDB();
        const { strategyId } = req.params;
        const { start_date, end_date, limit, side } = req.query;

        let query = 'SELECT * FROM transactions WHERE strategy_id = ?';
        const params = [strategyId];

        if (start_date) { query += ' AND trade_date >= ?'; params.push(start_date); }
        if (end_date) { query += ' AND trade_date <= ?'; params.push(end_date); }
        if (side) { query += ' AND side = ?'; params.push(side); }

        query += ' ORDER BY trade_date DESC, id DESC';
        if (limit) { query += ' LIMIT ?'; params.push(parseInt(limit)); }
        else { query += ' LIMIT 200'; }

        const transactions = db.prepare(query).all(...params);
        res.json(transactions);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ─── Signals ────────────────────────────────────────────────

exports.getSignals = (req, res) => {
    try {
        const db = getDB();
        const { strategyId } = req.params;
        const { date } = req.query;

        let signals;
        if (date) {
            signals = db.prepare(`
                SELECT * FROM signals WHERE strategy_id = ? AND signal_date = ?
                ORDER BY rank ASC
            `).all(strategyId, date);
        } else {
            // Get latest signal_date's signals
            const latest = db.prepare(`
                SELECT signal_date FROM signals WHERE strategy_id = ?
                ORDER BY signal_date DESC LIMIT 1
            `).get(strategyId);
            if (!latest) return res.json([]);
            signals = db.prepare(`
                SELECT * FROM signals WHERE strategy_id = ? AND signal_date = ?
                ORDER BY rank ASC
            `).all(strategyId, latest.signal_date);
        }

        res.json(signals);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ─── Strategy Comparison ───────────────────────────────────

exports.compareStrategies = (req, res) => {
    try {
        const db = getDB();
        const { ids } = req.query;

        let strategies;
        if (ids) {
            const idList = ids.split(',').map(s => s.trim());
            const placeholders = idList.map(() => '?').join(',');
            strategies = db.prepare(`
                SELECT * FROM strategies WHERE id IN (${placeholders})
            `).all(...idList);
        } else {
            strategies = db.prepare('SELECT * FROM strategies WHERE status = ?').all('active');
        }

        const comparison = strategies.map(s => {
            const latestNav = db.prepare(`
                SELECT * FROM nav_snapshots WHERE strategy_id = ?
                ORDER BY trade_date DESC LIMIT 1
            `).get(s.id);

            const holdingCount = db.prepare(`
                SELECT COUNT(*) as count FROM holdings
                WHERE strategy_id = ? AND trade_date = (
                    SELECT MAX(trade_date) FROM holdings WHERE strategy_id = ?
                )
            `).get(s.id, s.id);

            // Calculate additional stats from all nav snapshots
            const allNavs = db.prepare(`
                SELECT daily_return, trade_date FROM nav_snapshots
                WHERE strategy_id = ? ORDER BY trade_date ASC
            `).all(s.id);

            const validReturns = allNavs.map(n => n.daily_return).filter(r => r !== 0 && !isNaN(r));
            const winDays = validReturns.filter(r => r > 0).length;
            const winRate = validReturns.length > 0 ? winDays / validReturns.length : 0;

            const txCount = db.prepare(`
                SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total_amount
                FROM transactions WHERE strategy_id = ?
            `).get(s.id);

            return {
                id: s.id,
                name: s.name,
                benchmark: s.benchmark,
                initial_capital: s.initial_capital,
                totalAssets: latestNav ? latestNav.total_assets : s.initial_capital,
                cumulativeReturn: latestNav ? latestNav.cumulative_return : 0,
                dailyReturn: latestNav ? latestNav.daily_return : 0,
                maxDrawdown: latestNav ? latestNav.max_drawdown : 0,
                sharpe: latestNav ? latestNav.sharpe : 0,
                positionRatio: latestNav ? latestNav.position_ratio : 0,
                holdingCount: holdingCount ? holdingCount.count : 0,
                transactionCount: txCount ? txCount.count : 0,
                turnover: txCount && latestNav ? txCount.total_amount / (latestNav.total_assets || 1) : 0,
                winRate: parseFloat(winRate.toFixed(4)),
                lastTradeDate: latestNav ? latestNav.trade_date : null,
            };
        });

        res.json(comparison);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ─── Backtest Results: Query ───────────────────────────────

exports.getBacktestResults = (req, res) => {
    try {
        const db = getDB();
        const { strategyId } = req.params;
        const { limit } = req.query;

        let query = `
            SELECT * FROM backtest_results WHERE strategy_id = ?
            ORDER BY backtest_date DESC
        `;
        const params = [strategyId];
        if (limit) { query += ' LIMIT ?'; params.push(parseInt(limit)); }
        else { query += ' LIMIT 20'; }

        const results = db.prepare(query).all(...params);

        // Parse JSON columns
        const parsed = results.map(r => ({
            ...r,
            params: JSON.parse(r.params || '{}'),
            equity_curve: r.equity_curve ? JSON.parse(r.equity_curve) : [],
            monthly_returns: r.monthly_returns ? JSON.parse(r.monthly_returns) : [],
        }));

        res.json(parsed);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ─── Backtest Results: Import from CSV ─────────────────────

exports.importBacktestResults = (req, res) => {
    try {
        const db = getDB();
        const { strategyId } = req.params;
        const { csv_path } = req.body;

        // Verify strategy exists
        const strategy = db.prepare('SELECT * FROM strategies WHERE id = ?').get(strategyId);
        if (!strategy) return res.status(404).json({ error: 'Strategy not found' });

        const filePath = csv_path || '/git/quant_factors/results/backtest_results.csv';
        if (!fs.existsSync(filePath)) {
            return res.status(400).json({ error: `CSV not found: ${filePath}` });
        }

        const { headers, rows } = parseCSVFile(filePath);
        if (rows.length === 0) {
            return res.status(400).json({ error: 'CSV has no data rows' });
        }

        // Find relevant columns (flexible naming)
        const findCol = (patterns) => headers.find(h =>
            patterns.some(p => new RegExp(p, 'i').test(h))
        );

        const colMap = {
            start_date: findCol(['start.?date', 'start']),
            end_date: findCol(['end.?date', 'end']),
            initial_capital: findCol(['initial.?capital', 'capital']),
            final_value: findCol(['final.?value', 'final', 'end.?value']),
            annual_return: findCol(['annual.?return', 'annual']),
            sharpe: findCol(['sharpe']),
            max_drawdown: findCol(['max.?drawdown', 'drawdown', 'mdd']),
            calmar: findCol(['calmar']),
            win_rate: findCol(['win.?rate', 'winrate']),
            turnover: findCol(['turnover', '换手']),
            benchmark_return: findCol(['benchmark.?return', 'benchmark']),
            excess_return: findCol(['excess.?return', 'excess', 'alpha']),
            ir: findCol(['\\bir\\b', 'info.?ratio', 'information']),
            hit_rate: findCol(['hit.?rate', 'hitrate']),
            total_trades: findCol(['total.?trade', 'trades']),
        };

        const today = new Date().toISOString().slice(0, 10);
        let imported = 0;

        const insertStmt = db.prepare(`
            INSERT INTO backtest_results
                (strategy_id, backtest_date, start_date, end_date, initial_capital,
                 final_value, annual_return, sharpe, max_drawdown, calmar, win_rate,
                 turnover, benchmark_return, excess_return, ir, hit_rate, total_trades,
                 params, equity_curve, monthly_returns)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const tx = db.transaction((items) => {
            for (const row of items) {
                const getVal = (col) => col ? parseFloat(row[col]) || null : null;
                const getStr = (col) => col ? (row[col] || '').trim() : '';

                insertStmt.run(
                    strategyId, today,
                    getStr(colMap.start_date) || '',
                    getStr(colMap.end_date) || '',
                    getVal(colMap.initial_capital),
                    getVal(colMap.final_value),
                    getVal(colMap.annual_return),
                    getVal(colMap.sharpe),
                    getVal(colMap.max_drawdown),
                    getVal(colMap.calmar),
                    getVal(colMap.win_rate),
                    getVal(colMap.turnover),
                    getVal(colMap.benchmark_return),
                    getVal(colMap.excess_return),
                    getVal(colMap.ir),
                    getVal(colMap.hit_rate),
                    getVal(colMap.total_trades) ? parseInt(getVal(colMap.total_trades)) : null,
                    JSON.stringify({ csv_path: filePath, imported_at: today }),
                    null, // equity_curve — not in CSV
                    null, // monthly_returns — not in CSV
                );
                imported++;
            }
        });

        tx(rows);

        res.json({
            strategyId, imported, total: rows.length,
            columns: colMap,
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ─── Strategy Dashboard Summary ────────────────────────────

exports.getDashboard = (req, res) => {
    try {
        const db = getDB();
        const { strategyId } = req.params;

        // If strategyId provided, return single strategy dashboard; otherwise return all
        let strategies;
        if (strategyId) {
            const s = db.prepare('SELECT * FROM strategies WHERE id = ?').get(strategyId);
            if (!s) return res.status(404).json({ error: 'Strategy not found' });
            strategies = [s];
        } else {
            strategies = db.prepare('SELECT * FROM strategies ORDER BY created_at ASC').all();
        }

        const dashboard = strategies.map(s => {
            const latestNav = db.prepare(`
                SELECT * FROM nav_snapshots WHERE strategy_id = ?
                ORDER BY trade_date DESC LIMIT 1
            `).get(s.id);

            const prevNav = db.prepare(`
                SELECT * FROM nav_snapshots WHERE strategy_id = ?
                ORDER BY trade_date DESC LIMIT 1 OFFSET 1
            `).get(s.id);

            const latestHoldings = db.prepare(`
                SELECT * FROM holdings WHERE strategy_id = ?
                AND trade_date = (SELECT MAX(trade_date) FROM holdings WHERE strategy_id = ?)
            `).all(s.id, s.id);

            const recentTx = db.prepare(`
                SELECT * FROM transactions WHERE strategy_id = ?
                ORDER BY trade_date DESC, id DESC LIMIT 10
            `).all(s.id);

            // Equity curve (all nav snapshots)
            const equityCurve = db.prepare(`
                SELECT trade_date as date, total_assets as value, cumulative_return
                FROM nav_snapshots WHERE strategy_id = ?
                ORDER BY trade_date ASC
            `).all(s.id);

            return {
                id: s.id,
                name: s.name,
                benchmark: s.benchmark,
                status: s.status,
                initial_capital: s.initial_capital,
                signal_source: s.signal_source,
                latestNav: latestNav || null,
                prevNav: prevNav || null,
                holdings: latestHoldings,
                recentTransactions: recentTx,
                equityCurve,
            };
        });

        // Return single object if one strategy, array if all
        res.json(dashboard.length === 1 ? dashboard[0] : dashboard);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};
