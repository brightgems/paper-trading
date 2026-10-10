/**
 * MCP Server — Multi-Strategy Paper Trading Tracker
 *
 * Exposes 20 tools that AI agents can call to:
 *   - Query strategies, NAV curves, holdings, transactions
 *   - Create / update / delete strategies
 *   - Import signals and backtest results (JSON or CSV)
 *   - Trigger rebalances (single or all strategies)
 *   - Preview rebalances (dry run)
 *   - Compare backtest vs live performance
 *   - Update NAV snapshots
 *   - Get engine status and positions overview
 *
 * Uses @modelcontextprotocol/sdk with StdioServerTransport.
 * DB: better-sqlite3 sync API, same SQLite as the Express backend.
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

// ─── Database ───────────────────────────────────────────────

const DB_PATH = path.join(__dirname, '..', 'server', 'data', 'strategies.db');

function getDB() {
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    return db;
}

// ─── Helpers ────────────────────────────────────────────────

function todayStr() {
    return new Date().toISOString().slice(0, 10);
}

/** Wrap a result as MCP text content. */
function ok(data) {
    return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
}

/** Wrap an error as MCP text content with isError flag. */
function fail(msg) {
    return {
        content: [{ type: 'text', text: typeof msg === 'string' ? msg : msg.message }],
        isError: true,
    };
}

/** Parse a JSON column that may be null or '{}'. */
function parseJSON(val, fallback = {}) {
    if (!val) return fallback;
    try { return JSON.parse(val); } catch { return fallback; }
}

/** Minimal CSV parser handling quoted fields. */
function parseCSVFile(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`CSV file not found: ${filePath}`);
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n').filter(l => l.trim());
    if (lines.length < 2) return { headers: [], rows: [] };

    function parseLine(line) {
        const result = [];
        let cur = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
                else { inQuotes = !inQuotes; }
            } else if (ch === ',' && !inQuotes) {
                result.push(cur);
                cur = '';
            } else {
                cur += ch;
            }
        }
        result.push(cur);
        return result.map(s => s.trim());
    }

    const headers = parseLine(lines[0]);
    const rows = lines.slice(1).map(line => {
        const vals = parseLine(line);
        const obj = {};
        headers.forEach((h, i) => { obj[h] = vals[i] !== undefined ? vals[i] : ''; });
        return obj;
    });
    return { headers, rows };
}

// ─── Server Setup ───────────────────────────────────────────

const server = new McpServer({
    name: 'paper-trading-mcp',
    version: '1.0.0',
});

// ═══════════════════════════════════════════════════════════
// TOOL 1: list_strategies
// ═══════════════════════════════════════════════════════════

server.registerTool(
    'list_strategies',
    {
        description: 'List all strategies with their latest NAV (total assets, returns, drawdown, Sharpe). Returns an array of strategy summary objects.',
    },
    async () => {
        try {
            const db = getDB();
            const strategies = db.prepare('SELECT * FROM strategies ORDER BY created_at ASC').all();

            const result = strategies.map(s => {
                const nav = db.prepare(`
                    SELECT * FROM nav_snapshots WHERE strategy_id = ?
                    ORDER BY trade_date DESC LIMIT 1
                `).get(s.id);

                return {
                    id: s.id,
                    name: s.name,
                    description: s.description,
                    status: s.status,
                    benchmark: s.benchmark,
                    signal_source: s.signal_source,
                    initial_capital: s.initial_capital,
                    total_assets: nav ? nav.total_assets : s.initial_capital,
                    cash: nav ? nav.cash : s.initial_capital,
                    daily_return: nav ? nav.daily_return : 0,
                    cumulative_return: nav ? nav.cumulative_return : 0,
                    max_drawdown: nav ? nav.max_drawdown : 0,
                    sharpe: nav ? nav.sharpe : 0,
                    position_ratio: nav ? nav.position_ratio : 0,
                    last_trade_date: nav ? nav.trade_date : null,
                };
            });

            return ok(result);
        } catch (e) {
            return fail(e);
        }
    }
);

// ═══════════════════════════════════════════════════════════
// TOOL 2: get_strategy_detail
// ═══════════════════════════════════════════════════════════

server.registerTool(
    'get_strategy_detail',
    {
        description: 'Get full strategy detail: config, latest holdings, recent transactions (limit 20), and latest NAV snapshot.',
        inputSchema: {
            strategy_id: z.string().describe('Strategy ID, e.g. "hs300_top50"'),
        },
    },
    async ({ strategy_id }) => {
        try {
            const db = getDB();
            const strategy = db.prepare('SELECT * FROM strategies WHERE id = ?').get(strategy_id);
            if (!strategy) return fail(`Strategy not found: ${strategy_id}`);

            const latestNav = db.prepare(`
                SELECT * FROM nav_snapshots WHERE strategy_id = ?
                ORDER BY trade_date DESC LIMIT 1
            `).get(strategy_id);

            const latestDate = db.prepare(`
                SELECT trade_date FROM holdings WHERE strategy_id = ?
                ORDER BY trade_date DESC LIMIT 1
            `).get(strategy_id);

            const holdings = latestDate
                ? db.prepare(`
                    SELECT * FROM holdings WHERE strategy_id = ? AND trade_date = ?
                    ORDER BY market_value DESC
                `).all(strategy_id, latestDate.trade_date)
                : [];

            const transactions = db.prepare(`
                SELECT * FROM transactions WHERE strategy_id = ?
                ORDER BY trade_date DESC, id DESC LIMIT 20
            `).all(strategy_id);

            return ok({
                ...strategy,
                signal_config: parseJSON(strategy.signal_config),
                rebalance_rule: parseJSON(strategy.rebalance_rule),
                latest_nav: latestNav,
                holdings,
                recent_transactions: transactions,
            });
        } catch (e) {
            return fail(e);
        }
    }
);

// ═══════════════════════════════════════════════════════════
// TOOL 3: get_nav_curve
// ═══════════════════════════════════════════════════════════

server.registerTool(
    'get_nav_curve',
    {
        description: 'Get NAV time series for a strategy. Returns array of {trade_date, total_assets, cash, market_value, daily_return, cumulative_return, max_drawdown, sharpe}.',
        inputSchema: {
            strategy_id: z.string().describe('Strategy ID'),
            start_date: z.string().optional().describe('Start date YYYY-MM-DD (inclusive, optional)'),
            end_date: z.string().optional().describe('End date YYYY-MM-DD (inclusive, optional)'),
        },
    },
    async ({ strategy_id, start_date, end_date }) => {
        try {
            const db = getDB();
            let query = 'SELECT * FROM nav_snapshots WHERE strategy_id = ?';
            const params = [strategy_id];
            if (start_date) { query += ' AND trade_date >= ?'; params.push(start_date); }
            if (end_date) { query += ' AND trade_date <= ?'; params.push(end_date); }
            query += ' ORDER BY trade_date ASC';

            const rows = db.prepare(query).all(...params);
            return ok(rows);
        } catch (e) {
            return fail(e);
        }
    }
);

// ═══════════════════════════════════════════════════════════
// TOOL 4: get_holdings
// ═══════════════════════════════════════════════════════════

server.registerTool(
    'get_holdings',
    {
        description: 'Get holdings for a strategy. If trade_date is omitted, returns the latest holdings. Returns array of {symbol, name, quantity, available_quantity, cost_price, current_price, market_value, profit_pct, weight}.',
        inputSchema: {
            strategy_id: z.string().describe('Strategy ID'),
            trade_date: z.string().optional().describe('Trade date YYYY-MM-DD (optional, defaults to latest)'),
        },
    },
    async ({ strategy_id, trade_date }) => {
        try {
            const db = getDB();
            let date = trade_date;
            if (!date) {
                const latest = db.prepare(`
                    SELECT trade_date FROM holdings WHERE strategy_id = ?
                    ORDER BY trade_date DESC LIMIT 1
                `).get(strategy_id);
                if (!latest) return ok([]);
                date = latest.trade_date;
            }
            const rows = db.prepare(`
                SELECT * FROM holdings WHERE strategy_id = ? AND trade_date = ?
                ORDER BY market_value DESC
            `).all(strategy_id, date);
            return ok(rows);
        } catch (e) {
            return fail(e);
        }
    }
);

// ═══════════════════════════════════════════════════════════
// TOOL 5: get_transactions
// ═══════════════════════════════════════════════════════════

server.registerTool(
    'get_transactions',
    {
        description: 'Get transaction history for a strategy. Filterable by date range and limit. Returns array of {trade_date, symbol, name, side, quantity, price, amount, commission, stamp_tax, transfer_fee, reason, signal_rank}.',
        inputSchema: {
            strategy_id: z.string().describe('Strategy ID'),
            start_date: z.string().optional().describe('Start date YYYY-MM-DD (inclusive, optional)'),
            end_date: z.string().optional().describe('End date YYYY-MM-DD (inclusive, optional)'),
            limit: z.number().optional().describe('Max rows to return (default 200)'),
        },
    },
    async ({ strategy_id, start_date, end_date, limit }) => {
        try {
            const db = getDB();
            let query = 'SELECT * FROM transactions WHERE strategy_id = ?';
            const params = [strategy_id];
            if (start_date) { query += ' AND trade_date >= ?'; params.push(start_date); }
            if (end_date) { query += ' AND trade_date <= ?'; params.push(end_date); }
            query += ' ORDER BY trade_date DESC, id DESC';
            query += ` LIMIT ${limit || 200}`;
            const rows = db.prepare(query).all(...params);
            return ok(rows);
        } catch (e) {
            return fail(e);
        }
    }
);

// ═══════════════════════════════════════════════════════════
// TOOL 6: get_strategy_compare
// ═══════════════════════════════════════════════════════════

server.registerTool(
    'get_strategy_compare',
    {
        description: 'Compare all active strategies side-by-side. Returns array with total assets, returns, drawdown, Sharpe, holding count, transaction count, win rate, and turnover for each strategy.',
    },
    async () => {
        try {
            const db = getDB();
            const strategies = db.prepare('SELECT * FROM strategies WHERE status = ?').all('active');

            const result = strategies.map(s => {
                const nav = db.prepare(`
                    SELECT * FROM nav_snapshots WHERE strategy_id = ?
                    ORDER BY trade_date DESC LIMIT 1
                `).get(s.id);

                const holdingCount = db.prepare(`
                    SELECT COUNT(*) as count FROM holdings
                    WHERE strategy_id = ? AND trade_date = (
                        SELECT MAX(trade_date) FROM holdings WHERE strategy_id = ?
                    )
                `).get(s.id, s.id);

                const allNavs = db.prepare(`
                    SELECT daily_return FROM nav_snapshots
                    WHERE strategy_id = ? ORDER BY trade_date ASC
                `).all(s.id);

                const validReturns = allNavs.map(n => n.daily_return).filter(r => r !== 0 && !isNaN(r));
                const winDays = validReturns.filter(r => r > 0).length;
                const winRate = validReturns.length > 0 ? winDays / validReturns.length : 0;

                const txStats = db.prepare(`
                    SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total_amount
                    FROM transactions WHERE strategy_id = ?
                `).get(s.id);

                return {
                    id: s.id,
                    name: s.name,
                    benchmark: s.benchmark,
                    initial_capital: s.initial_capital,
                    total_assets: nav ? nav.total_assets : s.initial_capital,
                    cumulative_return: nav ? nav.cumulative_return : 0,
                    daily_return: nav ? nav.daily_return : 0,
                    max_drawdown: nav ? nav.max_drawdown : 0,
                    sharpe: nav ? nav.sharpe : 0,
                    position_ratio: nav ? nav.position_ratio : 0,
                    holding_count: holdingCount ? holdingCount.count : 0,
                    transaction_count: txStats ? txStats.count : 0,
                    turnover: txStats && nav ? txStats.total_amount / (nav.total_assets || 1) : 0,
                    win_rate: parseFloat(winRate.toFixed(4)),
                    last_trade_date: nav ? nav.trade_date : null,
                };
            });

            return ok(result);
        } catch (e) {
            return fail(e);
        }
    }
);

// ═══════════════════════════════════════════════════════════
// TOOL 7: create_strategy
// ═══════════════════════════════════════════════════════════

server.registerTool(
    'create_strategy',
    {
        description: 'Create a new strategy. Inserts into strategies table and initializes a NAV snapshot with cash = initial_capital.',
        inputSchema: {
            id: z.string().describe('Unique strategy ID, e.g. "momentum_top20"'),
            name: z.string().describe('Human-readable strategy name'),
            description: z.string().optional().describe('Strategy description'),
            initial_capital: z.number().describe('Initial capital in CNY (default 1000000)'),
            signal_source: z.string().describe('Signal source: top10_csv | quantdb_factor | backtest_import | none'),
            signal_config: z.record(z.any()).describe('Signal config object, e.g. {csv_path: "/path/to.csv", top_k: 10}'),
            rebalance_rule: z.record(z.any()).describe('Rebalance rule, e.g. {frequency: "weekly", day: "monday", max_trades: 5}'),
            stop_loss: z.number().describe('Stop loss threshold in % (e.g. -5.0 means sell when down 5%)'),
            take_profit: z.number().describe('Take profit threshold in % (e.g. 15.0 means sell when up 15%)'),
            benchmark: z.string().describe('Benchmark symbol, e.g. 000300.SH'),
        },
    },
    async (params) => {
        try {
            const db = getDB();
            const existing = db.prepare('SELECT id FROM strategies WHERE id = ?').get(params.id);
            if (existing) return fail(`Strategy already exists: ${params.id}`);

            const signalConfig = JSON.stringify(params.signal_config || {});
            const rebalanceRule = JSON.stringify(params.rebalance_rule || {});

            db.prepare(`
                INSERT INTO strategies
                    (id, name, description, initial_capital, signal_source, signal_config,
                     rebalance_rule, stop_loss, take_profit, benchmark, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
            `).run(
                params.id, params.name, params.description || '',
                params.initial_capital, params.signal_source, signalConfig,
                rebalanceRule, params.stop_loss, params.take_profit, params.benchmark
            );

            // Initialize NAV snapshot
            const today = todayStr();
            db.prepare(`
                INSERT OR IGNORE INTO nav_snapshots
                    (strategy_id, trade_date, total_assets, cash, market_value, position_ratio,
                     daily_return, cumulative_return, benchmark_return, excess_return, max_drawdown, sharpe)
                VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0)
            `).run(params.id, today, params.initial_capital, params.initial_capital);

            return ok({ created: true, id: params.id, name: params.name, initialized_nav_date: today });
        } catch (e) {
            return fail(e);
        }
    }
);

// ═══════════════════════════════════════════════════════════
// TOOL 8: update_strategy
// ═══════════════════════════════════════════════════════════

server.registerTool(
    'update_strategy',
    {
        description: 'Update an existing strategy. Pass any subset of the create fields. Only provided fields are updated.',
        inputSchema: {
            id: z.string().describe('Strategy ID to update'),
            name: z.string().optional(),
            description: z.string().optional(),
            initial_capital: z.number().optional(),
            signal_source: z.string().optional(),
            signal_config: z.record(z.any()).optional(),
            rebalance_rule: z.record(z.any()).optional(),
            stop_loss: z.number().optional(),
            take_profit: z.number().optional(),
            benchmark: z.string().optional(),
            status: z.string().optional().describe('Set to "active", "paused", or "archived"'),
        },
    },
    async (params) => {
        try {
            const db = getDB();
            const strategy = db.prepare('SELECT * FROM strategies WHERE id = ?').get(params.id);
            if (!strategy) return fail(`Strategy not found: ${params.id}`);

            const updates = [];
            const values = [];

            const fieldMap = {
                name: 'name',
                description: 'description',
                initial_capital: 'initial_capital',
                signal_source: 'signal_source',
                stop_loss: 'stop_loss',
                take_profit: 'take_profit',
                benchmark: 'benchmark',
                status: 'status',
            };

            for (const [key, col] of Object.entries(fieldMap)) {
                if (params[key] !== undefined) {
                    updates.push(`${col} = ?`);
                    values.push(params[key]);
                }
            }

            // JSON fields need stringification
            if (params.signal_config !== undefined) {
                updates.push('signal_config = ?');
                values.push(JSON.stringify(params.signal_config));
            }
            if (params.rebalance_rule !== undefined) {
                updates.push('rebalance_rule = ?');
                values.push(JSON.stringify(params.rebalance_rule));
            }

            if (updates.length === 0) {
                return fail('No fields to update. Provide at least one field besides id.');
            }

            updates.push(`updated_at = datetime('now')`);
            values.push(params.id);

            db.prepare(`UPDATE strategies SET ${updates.join(', ')} WHERE id = ?`).run(...values);

            const updated = db.prepare('SELECT * FROM strategies WHERE id = ?').get(params.id);
            return ok({
                updated: true,
                strategy: {
                    ...updated,
                    signal_config: parseJSON(updated.signal_config),
                    rebalance_rule: parseJSON(updated.rebalance_rule),
                },
            });
        } catch (e) {
            return fail(e);
        }
    }
);

// ═══════════════════════════════════════════════════════════
// TOOL 9: import_signals
// ═══════════════════════════════════════════════════════════

server.registerTool(
    'import_signals',
    {
        description: 'Import trading signals for a strategy on a given signal_date. Each signal has symbol, name, rank, score, close, action, weight. Uses INSERT OR REPLACE (upsert by strategy_id + signal_date + symbol).',
        inputSchema: {
            strategy_id: z.string().describe('Strategy ID'),
            signals: z.array(z.object({
                symbol: z.string().describe('Stock symbol, e.g. 600000.SH'),
                name: z.string().optional().describe('Stock name'),
                rank: z.number().optional().describe('Rank (1 = top)'),
                score: z.number().optional().describe('Signal score'),
                close: z.number().optional().describe('Closing price'),
                action: z.string().optional().describe('buy | sell | hold'),
                weight: z.number().optional().describe('Target portfolio weight (0-1)'),
            })).describe('Array of signal objects'),
            signal_date: z.string().describe('Signal date YYYY-MM-DD'),
        },
    },
    async ({ strategy_id, signals, signal_date }) => {
        try {
            const db = getDB();
            const strategy = db.prepare('SELECT id FROM strategies WHERE id = ?').get(strategy_id);
            if (!strategy) return fail(`Strategy not found: ${strategy_id}`);

            const stmt = db.prepare(`
                INSERT OR REPLACE INTO signals
                    (strategy_id, signal_date, symbol, name, rank, score, close, action, weight)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const tx = db.transaction((items) => {
                for (const s of items) {
                    stmt.run(
                        strategy_id, signal_date, s.symbol,
                        s.name || s.symbol,
                        s.rank || null,
                        s.score || 0,
                        s.close || 0,
                        s.action || 'buy',
                        s.weight || null
                    );
                }
            });
            tx(signals);

            return ok({
                imported: signals.length,
                strategy_id,
                signal_date,
                symbols: signals.map(s => s.symbol),
            });
        } catch (e) {
            return fail(e);
        }
    }
);

// ═══════════════════════════════════════════════════════════
// TOOL 10: import_signals_from_csv
// ═══════════════════════════════════════════════════════════

server.registerTool(
    'import_signals_from_csv',
    {
        description: 'Import trading signals from a CSV file. Expected columns: symbol (required), name, rank, score, close, action, weight. If signal_date is omitted, uses today. Flexible column matching.',
        inputSchema: {
            strategy_id: z.string().describe('Strategy ID'),
            csv_path: z.string().describe('Absolute path to the CSV file'),
            signal_date: z.string().optional().describe('Signal date YYYY-MM-DD (defaults to today)'),
        },
    },
    async ({ strategy_id, csv_path, signal_date }) => {
        try {
            const db = getDB();
            const strategy = db.prepare('SELECT id FROM strategies WHERE id = ?').get(strategy_id);
            if (!strategy) return fail(`Strategy not found: ${strategy_id}`);

            const { headers, rows } = parseCSVFile(csv_path);
            if (rows.length === 0) return fail('CSV has no data rows');

            // Flexible column matching
            const findCol = (patterns) => headers.find(h =>
                patterns.some(p => new RegExp(p, 'i').test(h))
            );

            const colMap = {
                symbol: findCol(['symbol', 'code', 'stock', '股票']),
                name: findCol(['name', '名称']),
                rank: findCol(['rank']),
                score: findCol(['score']),
                close: findCol(['close', 'price']),
                action: findCol(['action', '方向']),
                weight: findCol(['weight', '权重']),
            };

            if (!colMap.symbol) {
                return fail(`CSV must have a symbol column. Found headers: ${headers.join(', ')}`);
            }

            const date = signal_date || todayStr();
            const signals = rows.map((row, idx) => ({
                symbol: (row[colMap.symbol] || '').trim(),
                name: colMap.name ? (row[colMap.name] || '').trim() : '',
                rank: colMap.rank ? parseInt(row[colMap.rank]) || (idx + 1) : (idx + 1),
                score: colMap.score ? parseFloat(row[colMap.score]) || 0 : 0,
                close: colMap.close ? parseFloat(row[colMap.close]) || 0 : 0,
                action: colMap.action ? (row[colMap.action] || 'buy').trim() : 'buy',
                weight: colMap.weight ? parseFloat(row[colMap.weight]) || null : null,
            })).filter(s => s.symbol);

            const stmt = db.prepare(`
                INSERT OR REPLACE INTO signals
                    (strategy_id, signal_date, symbol, name, rank, score, close, action, weight)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const tx = db.transaction((items) => {
                for (const s of items) {
                    stmt.run(strategy_id, date, s.symbol, s.name, s.rank, s.score, s.close, s.action, s.weight);
                }
            });
            tx(signals);

            return ok({
                imported: signals.length,
                strategy_id,
                signal_date: date,
                columns_mapped: colMap,
                symbols: signals.map(s => s.symbol),
            });
        } catch (e) {
            return fail(e);
        }
    }
);

// ═══════════════════════════════════════════════════════════
// TOOL 11: import_backtest_result
// ═══════════════════════════════════════════════════════════

server.registerTool(
    'import_backtest_result',
    {
        description: 'Import a single backtest result record for a strategy. Stores metrics (annual return, Sharpe, drawdown, IR, etc.), equity curve, monthly returns, and params as JSON.',
        inputSchema: {
            strategy_id: z.string().describe('Strategy ID'),
            start_date: z.string().describe('Backtest start date YYYY-MM-DD'),
            end_date: z.string().describe('Backtest end date YYYY-MM-DD'),
            initial_capital: z.number().describe('Backtest initial capital'),
            final_value: z.number().describe('Backtest final portfolio value'),
            annual_return: z.number().describe('Annualized return (%)'),
            sharpe: z.number().describe('Annualized Sharpe ratio'),
            max_drawdown: z.number().describe('Maximum drawdown (%)'),
            benchmark_return: z.number().describe('Benchmark annualized return (%)'),
            excess_return: z.number().describe('Excess annualized return over benchmark (%)'),
            ir: z.number().describe('Information ratio'),
            equity_curve: z.array(z.object({
                date: z.string(),
                value: z.number(),
                benchmark: z.number().optional(),
            })).describe('Equity curve as array of {date, value, benchmark?}'),
            monthly_returns: z.array(z.object({
                month: z.string(),
                return: z.number(),
            })).describe('Monthly returns as array of {month, return}'),
            params: z.record(z.any()).describe('Backtest parameters object'),
        },
    },
    async (params) => {
        try {
            const db = getDB();
            const strategy = db.prepare('SELECT id FROM strategies WHERE id = ?').get(params.strategy_id);
            if (!strategy) return fail(`Strategy not found: ${params.strategy_id}`);

            const today = todayStr();
            db.prepare(`
                INSERT INTO backtest_results
                    (strategy_id, backtest_date, start_date, end_date, initial_capital,
                     final_value, annual_return, sharpe, max_drawdown, benchmark_return,
                     excess_return, ir, params, equity_curve, monthly_returns)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                params.strategy_id, today,
                params.start_date, params.end_date,
                params.initial_capital, params.final_value,
                params.annual_return, params.sharpe, params.max_drawdown,
                params.benchmark_return, params.excess_return, params.ir,
                JSON.stringify(params.params || {}),
                JSON.stringify(params.equity_curve || []),
                JSON.stringify(params.monthly_returns || [])
            );

            return ok({
                imported: true,
                strategy_id: params.strategy_id,
                backtest_date: today,
                start_date: params.start_date,
                end_date: params.end_date,
            });
        } catch (e) {
            return fail(e);
        }
    }
);

// ═══════════════════════════════════════════════════════════
// TOOL 12: import_backtest_from_csv
// ═══════════════════════════════════════════════════════════

server.registerTool(
    'import_backtest_from_csv',
    {
        description: 'Import backtest results from a CSV file. Flexible column matching for start_date, end_date, initial_capital, final_value, annual_return, sharpe, max_drawdown, benchmark_return, excess_return, ir, etc.',
        inputSchema: {
            strategy_id: z.string().describe('Strategy ID'),
            csv_path: z.string().describe('Absolute path to the CSV file'),
        },
    },
    async ({ strategy_id, csv_path }) => {
        try {
            const db = getDB();
            const strategy = db.prepare('SELECT id FROM strategies WHERE id = ?').get(strategy_id);
            if (!strategy) return fail(`Strategy not found: ${strategy_id}`);

            const { headers, rows } = parseCSVFile(csv_path);
            if (rows.length === 0) return fail('CSV has no data rows');

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
                benchmark_return: findCol(['benchmark.?return', 'benchmark']),
                excess_return: findCol(['excess.?return', 'excess', 'alpha']),
                ir: findCol(['\\bir\\b', 'info.?ratio', 'information']),
            };

            const today = todayStr();
            const stmt = db.prepare(`
                INSERT INTO backtest_results
                    (strategy_id, backtest_date, start_date, end_date, initial_capital,
                     final_value, annual_return, sharpe, max_drawdown, benchmark_return,
                     excess_return, ir, params, equity_curve, monthly_returns)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            let imported = 0;
            const tx = db.transaction((items) => {
                for (const row of items) {
                    const getVal = (col) => col ? (parseFloat(row[col]) || null) : null;
                    const getStr = (col) => col ? (row[col] || '').trim() : '';

                    stmt.run(
                        strategy_id, today,
                        getStr(colMap.start_date),
                        getStr(colMap.end_date),
                        getVal(colMap.initial_capital),
                        getVal(colMap.final_value),
                        getVal(colMap.annual_return),
                        getVal(colMap.sharpe),
                        getVal(colMap.max_drawdown),
                        getVal(colMap.benchmark_return),
                        getVal(colMap.excess_return),
                        getVal(colMap.ir),
                        JSON.stringify({ csv_path, imported_at: today }),
                        null, null
                    );
                    imported++;
                }
            });
            tx(rows);

            return ok({
                imported,
                total: rows.length,
                strategy_id,
                columns_mapped: colMap,
            });
        } catch (e) {
            return fail(e);
        }
    }
);

// ═══════════════════════════════════════════════════════════
// TOOL 13: trigger_rebalance
// ═══════════════════════════════════════════════════════════

server.registerTool(
    'trigger_rebalance',
    {
        description: 'Trigger rebalance for a single strategy. Delegates to the rebalance engine: loads signals, checks stop loss/take profit, sells holdings not in signals, buys new signal stocks, updates holdings/transactions/NAV. If trade_date is omitted, uses today.',
        inputSchema: {
            strategy_id: z.string().describe('Strategy ID'),
            trade_date: z.string().optional().describe('Trade date YYYY-MM-DD (defaults to today)'),
        },
    },
    async ({ strategy_id, trade_date }) => {
        try {
            // Delegate to the existing rebalance engine
            const rebalanceEngine = require('../server/services/rebalanceEngine');
            const result = await rebalanceEngine.rebalance(strategy_id, {
                forceRebalance: false,
                date: trade_date || undefined,
            });
            return ok(result);
        } catch (e) {
            return fail(e);
        }
    }
);

// ═══════════════════════════════════════════════════════════
// TOOL 14: trigger_all_rebalance
// ═══════════════════════════════════════════════════════════

server.registerTool(
    'trigger_all_rebalance',
    {
        description: 'Trigger rebalance for all active strategies. Returns array of per-strategy results with actions and NAV stats.',
        inputSchema: {
            trade_date: z.string().optional().describe('Trade date YYYY-MM-DD (defaults to today)'),
        },
    },
    async ({ trade_date }) => {
        try {
            const rebalanceEngine = require('../server/services/rebalanceEngine');
            const results = await rebalanceEngine.rebalanceAll({
                forceRebalance: false,
                date: trade_date || undefined,
            });
            return ok({
                timestamp: new Date().toISOString(),
                total: results.length,
                results,
            });
        } catch (e) {
            return fail(e);
        }
    }
);

// ═══════════════════════════════════════════════════════════
// TOOL 15: get_rebalance_preview
// ═══════════════════════════════════════════════════════════

server.registerTool(
    'get_rebalance_preview',
    {
        description: 'Dry-run rebalance preview for a strategy. Shows what trades WOULD be executed without actually writing to DB. Compares current holdings vs latest signals and returns proposed buys/sells.',
        inputSchema: {
            strategy_id: z.string().describe('Strategy ID'),
            trade_date: z.string().optional().describe('Trade date YYYY-MM-DD (defaults to today)'),
        },
    },
    async ({ strategy_id, trade_date }) => {
        try {
            const db = getDB();
            const strategy = db.prepare('SELECT * FROM strategies WHERE id = ?').get(strategy_id);
            if (!strategy) return fail(`Strategy not found: ${strategy_id}`);

            const date = trade_date || todayStr();

            // Get latest holdings
            const latestDate = db.prepare(`
                SELECT trade_date FROM holdings WHERE strategy_id = ?
                ORDER BY trade_date DESC LIMIT 1
            `).get(strategy_id);

            const holdings = latestDate
                ? db.prepare(`SELECT * FROM holdings WHERE strategy_id = ? AND trade_date = ?`)
                    .all(strategy_id, latestDate.trade_date)
                : [];

            // Get latest signals for this strategy
            const latestSignalDate = db.prepare(`
                SELECT signal_date FROM signals WHERE strategy_id = ?
                ORDER BY signal_date DESC LIMIT 1
            `).get(strategy_id);

            const signals = latestSignalDate
                ? db.prepare(`SELECT * FROM signals WHERE strategy_id = ? AND signal_date = ? ORDER BY rank ASC`)
                    .all(strategy_id, latestSignalDate.signal_date)
                : [];

            const signalSymbols = new Set(signals.map(s => s.symbol));
            const heldSymbols = new Set(holdings.map(h => h.symbol));

            // Proposed sells: held but not in signals
            const proposedSells = holdings
                .filter(h => !signalSymbols.has(h.symbol))
                .map(h => ({
                    action: 'sell',
                    symbol: h.symbol,
                    name: h.name,
                    quantity: h.available_quantity,
                    cost_price: h.cost_price,
                    current_price: h.current_price,
                    profit_pct: h.profit_pct,
                    reason: 'rebalance',
                }));

            // Proposed buys: in signals but not held
            const proposedBuys = signals
                .filter(s => !heldSymbols.has(s.symbol))
                .map(s => {
                    const targetAmount = (strategy.initial_capital || 1000000) * (s.weight || 0.1);
                    const rawQty = s.close > 0 ? Math.floor(targetAmount / s.close) : 0;
                    const buyQty = Math.floor(rawQty / 100) * 100; // lot size 100
                    return {
                        action: 'buy',
                        symbol: s.symbol,
                        name: s.name,
                        rank: s.rank,
                        score: s.score,
                        close: s.close,
                        weight: s.weight,
                        proposed_quantity: buyQty,
                        proposed_amount: parseFloat((buyQty * s.close).toFixed(2)),
                        reason: 'rebalance',
                    };
                })
                .filter(b => b.proposed_quantity > 0);

            // Stop loss / take profit checks
            const stopLoss = strategy.stop_loss ?? -5.0;
            const takeProfit = strategy.take_profit ?? 15.0;
            const stopLossTriggers = holdings
                .filter(h => h.profit_pct <= stopLoss || h.profit_pct >= takeProfit)
                .map(h => ({
                    action: 'sell',
                    symbol: h.symbol,
                    name: h.name,
                    quantity: h.available_quantity,
                    profit_pct: h.profit_pct,
                    reason: h.profit_pct <= stopLoss ? 'stop_loss' : 'take_profit',
                }));

            return ok({
                strategy_id,
                trade_date: date,
                signal_date: latestSignalDate ? latestSignalDate.signal_date : null,
                holdings_date: latestDate ? latestDate.trade_date : null,
                current_holdings_count: holdings.length,
                signals_count: signals.length,
                proposed_sells: proposedSells,
                proposed_buys: proposedBuys,
                stop_loss_take_profit_triggers: stopLossTriggers,
                stop_loss_threshold: stopLoss,
                take_profit_threshold: takeProfit,
                total_proposed_trades: proposedSells.length + proposedBuys.length + stopLossTriggers.length,
                dry_run: true,
            });
        } catch (e) {
            return fail(e);
        }
    }
);

// ═══════════════════════════════════════════════════════════
// TOOL 16: get_backtest_comparison
// ═══════════════════════════════════════════════════════════

server.registerTool(
    'get_backtest_comparison',
    {
        description: 'Compare live paper trading performance vs imported backtest results for a strategy. Returns live stats (annual return, Sharpe, drawdown, win rate, equity curve), backtest stats, and delta between live and latest backtest.',
        inputSchema: {
            strategy_id: z.string().describe('Strategy ID'),
        },
    },
    async ({ strategy_id }) => {
        try {
            const db = getDB();
            const strategy = db.prepare('SELECT * FROM strategies WHERE id = ?').get(strategy_id);
            if (!strategy) return fail(`Strategy not found: ${strategy_id}`);

            // Live paper trading stats
            const latestNav = db.prepare(`
                SELECT * FROM nav_snapshots WHERE strategy_id = ?
                ORDER BY trade_date DESC LIMIT 1
            `).get(strategy_id);

            const firstNav = db.prepare(`
                SELECT * FROM nav_snapshots WHERE strategy_id = ?
                ORDER BY trade_date ASC LIMIT 1
            `).get(strategy_id);

            const allNavs = db.prepare(`
                SELECT trade_date, total_assets, daily_return, cumulative_return
                FROM nav_snapshots WHERE strategy_id = ?
                ORDER BY trade_date ASC
            `).all(strategy_id);

            const liveReturns = allNavs.map(n => n.daily_return).filter(r => r !== 0);
            const liveWinDays = liveReturns.filter(r => r > 0).length;
            const liveWinRate = liveReturns.length > 0 ? liveWinDays / liveReturns.length : 0;

            const daysElapsed = allNavs.length;
            const liveCumReturn = latestNav ? latestNav.cumulative_return : 0;
            const liveAnnualReturn = daysElapsed > 0 && latestNav && firstNav
                ? (Math.pow((latestNav.total_assets / firstNav.total_assets), 252 / daysElapsed) - 1)
                : 0;

            const liveStats = {
                total_assets: latestNav ? latestNav.total_assets : strategy.initial_capital,
                cumulative_return: liveCumReturn,
                annual_return: liveAnnualReturn,
                sharpe: latestNav ? latestNav.sharpe : 0,
                max_drawdown: latestNav ? latestNav.max_drawdown : 0,
                win_rate: liveWinRate,
                days_elapsed: daysElapsed,
                start_date: firstNav ? firstNav.trade_date : null,
                end_date: latestNav ? latestNav.trade_date : null,
                equity_curve: allNavs.map(n => ({
                    date: n.trade_date,
                    value: n.total_assets,
                    cumulative_return: n.cumulative_return,
                })),
            };

            // Backtest results
            const backtestResults = db.prepare(`
                SELECT * FROM backtest_results WHERE strategy_id = ?
                ORDER BY backtest_date DESC
            `).all(strategy_id);

            const backtestStats = backtestResults.map(r => ({
                ...r,
                params: parseJSON(r.params),
                equity_curve: r.equity_curve ? JSON.parse(r.equity_curve) : [],
                monthly_returns: r.monthly_returns ? JSON.parse(r.monthly_returns) : [],
            }));

            // Delta: live vs latest backtest
            let delta = null;
            if (backtestStats.length > 0) {
                const bt = backtestStats[0];
                delta = {
                    annual_return: liveAnnualReturn - (bt.annual_return || 0),
                    sharpe: (latestNav ? latestNav.sharpe : 0) - (bt.sharpe || 0),
                    max_drawdown: (latestNav ? latestNav.max_drawdown : 0) - (bt.max_drawdown || 0),
                    win_rate: liveWinRate - (bt.win_rate || 0),
                };
            }

            return ok({
                strategy_id,
                strategy_name: strategy.name,
                benchmark: strategy.benchmark,
                live: liveStats,
                backtest: backtestStats,
                delta,
            });
        } catch (e) {
            return fail(e);
        }
    }
);

// ═══════════════════════════════════════════════════════════
// TOOL 17: update_nav_snapshot
// ═══════════════════════════════════════════════════════════

server.registerTool(
    'update_nav_snapshot',
    {
        description: 'Recalculate and upsert the NAV snapshot for a strategy on a given trade_date. Uses the strategy\'s latest holdings to compute total assets, market value, position ratio, daily return, cumulative return, max drawdown, and Sharpe. Cash is derived from the previous NAV snapshot.',
        inputSchema: {
            strategy_id: z.string().describe('Strategy ID'),
            trade_date: z.string().describe('Trade date YYYY-MM-DD'),
        },
    },
    async ({ strategy_id, trade_date }) => {
        try {
            const db = getDB();
            const strategy = db.prepare('SELECT * FROM strategies WHERE id = ?').get(strategy_id);
            if (!strategy) return fail(`Strategy not found: ${strategy_id}`);

            // Get holdings for this date (or latest)
            let holdings = db.prepare(`
                SELECT * FROM holdings WHERE strategy_id = ? AND trade_date = ?
            `).all(strategy_id, trade_date);

            if (holdings.length === 0) {
                // Try latest holdings date
                const latest = db.prepare(`
                    SELECT trade_date FROM holdings WHERE strategy_id = ?
                    ORDER BY trade_date DESC LIMIT 1
                `).get(strategy_id);
                if (latest) {
                    holdings = db.prepare(`
                        SELECT * FROM holdings WHERE strategy_id = ? AND trade_date = ?
                    `).all(strategy_id, latest.trade_date);
                }
            }

            // Get previous NAV for cash
            const prevNav = db.prepare(`
                SELECT * FROM nav_snapshots WHERE strategy_id = ?
                ORDER BY trade_date DESC LIMIT 1
            `).get(strategy_id);

            const initialCapital = strategy.initial_capital || 1000000;
            const cash = prevNav ? prevNav.cash : initialCapital;
            const marketValue = holdings.reduce((sum, h) => sum + h.market_value, 0);
            const totalAssets = cash + marketValue;
            const positionRatio = totalAssets > 0 ? marketValue / totalAssets : 0;
            const prevTotal = prevNav ? prevNav.total_assets : initialCapital;
            const dailyReturn = prevTotal > 0 ? (totalAssets - prevTotal) / prevTotal : 0;
            const cumulativeReturn = initialCapital > 0 ? (totalAssets - initialCapital) / initialCapital : 0;

            // Max drawdown
            const allNavs = db.prepare(`
                SELECT total_assets FROM nav_snapshots WHERE strategy_id = ?
                ORDER BY trade_date ASC
            `).all(strategy_id);
            const peaks = allNavs.map(n => n.total_assets).concat([totalAssets]);
            let peak = initialCapital;
            for (const p of peaks) { if (p > peak) peak = p; }
            const maxDrawdown = peak > 0 ? (totalAssets - peak) / peak : 0;

            // Sharpe
            const dailyReturns = allNavs.map(n => {
                // Recalculate from total_assets if available
                return n.daily_return || 0;
            }).concat([dailyReturn]);
            const validRets = dailyReturns.filter(r => r !== 0 && !isNaN(r));
            let sharpe = 0;
            if (validRets.length >= 2) {
                const mean = validRets.reduce((a, b) => a + b, 0) / validRets.length;
                const variance = validRets.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / validRets.length;
                const std = Math.sqrt(variance);
                sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;
            }

            // Upsert
            db.prepare(`
                INSERT INTO nav_snapshots
                    (strategy_id, trade_date, total_assets, cash, market_value, position_ratio,
                     daily_return, cumulative_return, benchmark_return, excess_return, max_drawdown, sharpe)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(strategy_id, trade_date) DO UPDATE SET
                    total_assets=excluded.total_assets, cash=excluded.cash, market_value=excluded.market_value,
                    position_ratio=excluded.position_ratio, daily_return=excluded.daily_return,
                    cumulative_return=excluded.cumulative_return, benchmark_return=excluded.benchmark_return,
                    excess_return=excluded.excess_return, max_drawdown=excluded.max_drawdown, sharpe=excluded.sharpe
            `).run(
                strategy_id, trade_date, totalAssets, cash, marketValue, positionRatio,
                dailyReturn, cumulativeReturn,
                prevNav ? prevNav.benchmark_return : 0,
                cumulativeReturn - (prevNav ? prevNav.benchmark_return : 0),
                maxDrawdown, sharpe
            );

            return ok({
                strategy_id,
                trade_date,
                total_assets: parseFloat(totalAssets.toFixed(2)),
                cash: parseFloat(cash.toFixed(2)),
                market_value: parseFloat(marketValue.toFixed(2)),
                position_ratio: parseFloat(positionRatio.toFixed(4)),
                daily_return: parseFloat(dailyReturn.toFixed(6)),
                cumulative_return: parseFloat(cumulativeReturn.toFixed(6)),
                max_drawdown: parseFloat(maxDrawdown.toFixed(6)),
                sharpe: parseFloat(sharpe.toFixed(4)),
                holdings_count: holdings.length,
            });
        } catch (e) {
            return fail(e);
        }
    }
);

// ═══════════════════════════════════════════════════════════
// TOOL 18: get_engine_status
// ═══════════════════════════════════════════════════════════

server.registerTool(
    'get_engine_status',
    {
        description: 'Get overall engine status: strategy count, per-strategy summary (total assets, cash, position ratio, returns, drawdown, Sharpe, holding count, last trade date).',
    },
    async () => {
        try {
            const db = getDB();
            const strategies = db.prepare('SELECT * FROM strategies').all();

            const status = strategies.map(s => {
                const nav = db.prepare(`
                    SELECT * FROM nav_snapshots WHERE strategy_id = ?
                    ORDER BY trade_date DESC LIMIT 1
                `).get(s.id);

                const latestDate = db.prepare(`
                    SELECT trade_date FROM holdings WHERE strategy_id = ?
                    ORDER BY trade_date DESC LIMIT 1
                `).get(s.id);

                const holdingCount = latestDate
                    ? db.prepare(`SELECT COUNT(*) as count FROM holdings WHERE strategy_id = ? AND trade_date = ?`)
                        .get(s.id, latestDate.trade_date)
                    : { count: 0 };

                return {
                    id: s.id,
                    name: s.name,
                    status: s.status,
                    benchmark: s.benchmark,
                    signal_source: s.signal_source,
                    total_assets: nav ? nav.total_assets : s.initial_capital,
                    cash: nav ? nav.cash : s.initial_capital,
                    position_ratio: nav ? nav.position_ratio : 0,
                    daily_return: nav ? nav.daily_return : 0,
                    cumulative_return: nav ? nav.cumulative_return : 0,
                    max_drawdown: nav ? nav.max_drawdown : 0,
                    sharpe: nav ? nav.sharpe : 0,
                    holding_count: holdingCount.count,
                    last_trade_date: nav ? nav.trade_date : null,
                };
            });

            return ok({
                timestamp: new Date().toISOString(),
                strategy_count: strategies.length,
                strategies: status,
            });
        } catch (e) {
            return fail(e);
        }
    }
);

// ═══════════════════════════════════════════════════════════
// TOOL 19: delete_strategy
// ═══════════════════════════════════════════════════════════

server.registerTool(
    'delete_strategy',
    {
        description: 'Delete a strategy and ALL its related data (nav_snapshots, holdings, transactions, signals, backtest_results). This is irreversible. Use with caution.',
        inputSchema: {
            strategy_id: z.string().describe('Strategy ID to delete'),
        },
    },
    async ({ strategy_id }) => {
        try {
            const db = getDB();
            const strategy = db.prepare('SELECT id, name FROM strategies WHERE id = ?').get(strategy_id);
            if (!strategy) return fail(`Strategy not found: ${strategy_id}`);

            const counts = {};
            const tables = ['nav_snapshots', 'holdings', 'transactions', 'signals', 'backtest_results'];

            const tx = db.transaction(() => {
                for (const table of tables) {
                    const result = db.prepare(`DELETE FROM ${table} WHERE strategy_id = ?`).run(strategy_id);
                    counts[table] = result.changes;
                }
                db.prepare('DELETE FROM strategies WHERE id = ?').run(strategy_id);
            });
            tx();

            return ok({
                deleted: true,
                strategy_id,
                strategy_name: strategy.name,
                cascaded_deletes: counts,
            });
        } catch (e) {
            return fail(e);
        }
    }
);

// ═══════════════════════════════════════════════════════════
// TOOL 20: get_positions_overview
// ═══════════════════════════════════════════════════════════

server.registerTool(
    'get_positions_overview',
    {
        description: 'Get positions overview across all strategies (or a single strategy). Returns per-strategy holding summaries with symbol, quantity, market_value, weight, profit_pct, and aggregate stats.',
        inputSchema: {
            strategy_id: z.string().optional().describe('Strategy ID (optional — if omitted, aggregates across all strategies)'),
        },
    },
    async ({ strategy_id }) => {
        try {
            const db = getDB();

            let strategies;
            if (strategy_id) {
                strategies = db.prepare('SELECT * FROM strategies WHERE id = ?').all(strategy_id);
            } else {
                strategies = db.prepare('SELECT * FROM strategies WHERE status = ?').all('active');
            }

            const overview = strategies.map(s => {
                const latestDate = db.prepare(`
                    SELECT trade_date FROM holdings WHERE strategy_id = ?
                    ORDER BY trade_date DESC LIMIT 1
                `).get(s.id);

                const holdings = latestDate
                    ? db.prepare(`
                        SELECT symbol, name, quantity, available_quantity, cost_price,
                               current_price, market_value, profit_pct, weight
                        FROM holdings WHERE strategy_id = ? AND trade_date = ?
                        ORDER BY market_value DESC
                    `).all(s.id, latestDate.trade_date)
                    : [];

                const nav = db.prepare(`
                    SELECT * FROM nav_snapshots WHERE strategy_id = ?
                    ORDER BY trade_date DESC LIMIT 1
                `).get(s.id);

                const totalMV = holdings.reduce((sum, h) => sum + h.market_value, 0);
                const totalCost = holdings.reduce((sum, h) => sum + (h.cost_price * h.quantity), 0);
                const totalProfit = totalMV - totalCost;
                const profitPct = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

                // Top positions by weight
                const topPositions = holdings.slice(0, 5).map(h => ({
                    symbol: h.symbol,
                    name: h.name,
                    quantity: h.quantity,
                    market_value: h.market_value,
                    weight: h.weight,
                    profit_pct: h.profit_pct,
                }));

                return {
                    strategy_id: s.id,
                    strategy_name: s.name,
                    benchmark: s.benchmark,
                    trade_date: latestDate ? latestDate.trade_date : null,
                    total_assets: nav ? nav.total_assets : s.initial_capital,
                    cash: nav ? nav.cash : s.initial_capital,
                    market_value: totalMV,
                    position_ratio: nav ? nav.position_ratio : 0,
                    holding_count: holdings.length,
                    total_cost: parseFloat(totalCost.toFixed(2)),
                    total_profit: parseFloat(totalProfit.toFixed(2)),
                    profit_pct: parseFloat(profitPct.toFixed(2)),
                    top_positions: topPositions,
                    all_holdings: holdings,
                };
            });

            // Aggregate across strategies
            const aggregate = {
                total_strategies: overview.length,
                total_assets: overview.reduce((s, o) => s + o.total_assets, 0),
                total_market_value: overview.reduce((s, o) => s + o.market_value, 0),
                total_cash: overview.reduce((s, o) => s + o.cash, 0),
                total_holdings: overview.reduce((s, o) => s + o.holding_count, 0),
            };

            return ok({ strategies: overview, aggregate });
        } catch (e) {
            return fail(e);
        }
    }
);

// ─── Export for testing / programmatic use ─────────────────

module.exports = { server, getDB, DB_PATH };

// ─── Start server if run directly ──────────────────────────

if (require.main === module) {
    (async () => {
        const transport = new StdioServerTransport();
        await server.connect(transport);
        // Log to stderr — stdout is reserved for MCP protocol
        console.error('[paper-trading-mcp] Server started on stdio');
    })().catch(e => {
        console.error('[paper-trading-mcp] Fatal error:', e);
        process.exit(1);
    });
}
