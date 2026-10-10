#!/usr/bin/env node
/**
 * Paper Trading MCP Server
 * Stdio-based MCP server exposing 20 tools for multi-strategy paper trading.
 * Wraps the Express API server via direct DB access (better-sqlite3) and the rebalance engine.
 * No HTTP calls — direct in-process calls to controllers/engine.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Import server modules via createRequire (ESM -> CJS interop)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { getDB } = require('/git/paper-trading/server/config/db.js');
const rebalanceEngine = require('/git/paper-trading/server/services/rebalanceEngine.js');
const signalLoader = require('/git/paper-trading/server/services/signalLoader.js');
const MarketDataService = require('/git/paper-trading/server/services/marketData.js');

// ─── Helpers ───────────────────────────────────────────────
function todayStr() {
    return new Date().toISOString().slice(0, 10);
}
function safeParse(s) {
    if (!s) return {};
    try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return {}; }
}
function annualizeReturn(cum, days) {
    if (!days || days <= 0) return cum || 0;
    return Math.pow(1 + (cum || 0), 252 / days) - 1;
}
function daysBetween(a, b) {
    if (!a || !b) return 0;
    return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
}
function getLatestNavRow(db, id) {
    return db.prepare('SELECT * FROM nav_snapshots WHERE strategy_id = ? ORDER BY trade_date DESC LIMIT 1').get(id);
}
function getLatestHoldingsDate(db, id) {
    return db.prepare('SELECT trade_date FROM holdings WHERE strategy_id = ? ORDER BY trade_date DESC LIMIT 1').get(id);
}
function computeWinRate(db, id) {
    const sells = db.prepare("SELECT symbol, price, trade_date FROM transactions WHERE strategy_id = ? AND side = 'sell'").all(id);
    if (!sells.length) return 0;
    let wins = 0;
    for (const s of sells) {
        const h = db.prepare('SELECT cost_price FROM holdings WHERE strategy_id = ? AND symbol = ? AND trade_date = ? ORDER BY id DESC LIMIT 1').get(id, s.symbol, s.trade_date);
        if (h && h.cost_price > 0 && s.price > h.cost_price) wins++;
    }
    return wins / sells.length;
}
function jsonOut(obj) {
    return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
}
function errOut(msg) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: String(msg) }) }] };
}

// ─── Tool Definitions (20) ─────────────────────────────────
const TOOLS = [
    {
        name: 'list_strategies',
        description: 'List all strategies with latest NAV stats: total_assets, daily_return, cumulative_return, max_drawdown, sharpe, holding_count, last_trade_date.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'get_strategy_detail',
        description: 'Get full detail of a single strategy: record + parsed signal_config/rebalance_rule + summary { latestNav, holdingCount, transactionCount }.',
        inputSchema: {
            type: 'object',
            properties: { strategy_id: { type: 'string' } },
            required: ['strategy_id'],
            additionalProperties: false,
        },
    },
    {
        name: 'get_nav_curve',
        description: 'Get NAV snapshot history for a strategy, ordered by trade_date ASC.',
        inputSchema: {
            type: 'object',
            properties: {
                strategy_id: { type: 'string' },
                start_date: { type: 'string' },
                end_date: { type: 'string' },
                limit: { type: 'number' },
            },
            required: ['strategy_id'],
            additionalProperties: false,
        },
    },
    {
        name: 'get_holdings',
        description: 'Get holdings for a strategy on the latest or specified date, ordered by market_value DESC.',
        inputSchema: {
            type: 'object',
            properties: {
                strategy_id: { type: 'string' },
                date: { type: 'string' },
            },
            required: ['strategy_id'],
            additionalProperties: false,
        },
    },
    {
        name: 'get_transactions',
        description: 'Get transactions for a strategy ordered by trade_date DESC. Default limit 200.',
        inputSchema: {
            type: 'object',
            properties: {
                strategy_id: { type: 'string' },
                start_date: { type: 'string' },
                end_date: { type: 'string' },
                limit: { type: 'number' },
                side: { type: 'string', enum: ['buy', 'sell'] },
            },
            required: ['strategy_id'],
            additionalProperties: false,
        },
    },
    {
        name: 'get_strategy_compare',
        description: 'Compare strategies. Pass ids as comma-separated string, or omit for all active. Returns per-strategy metrics including turnover and winRate.',
        inputSchema: {
            type: 'object',
            properties: { ids: { type: 'string' } },
            additionalProperties: false,
        },
    },
    {
        name: 'get_positions_overview',
        description: 'All strategies current holdings combined into one list with strategy_id, symbol, quantity, prices, market_value, profit_pct, weight.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'get_engine_status',
        description: 'Engine status: timestamp, strategyCount, and per-strategy summary (status, benchmark, totalAssets, cash, positionRatio, returns, holdingCount, lastTradeDate).',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'get_backtest_comparison',
        description: 'Compare live performance vs stored backtest results for a strategy. Returns live metrics, backtest list, and delta vs latest backtest.',
        inputSchema: {
            type: 'object',
            properties: { strategy_id: { type: 'string' } },
            required: ['strategy_id'],
            additionalProperties: false,
        },
    },
    {
        name: 'get_rebalance_preview',
        description: 'Preview what a rebalance would do WITHOUT executing: current holdings, latest signals, stocks to sell/buy, position discipline check, estimated trades.',
        inputSchema: {
            type: 'object',
            properties: { strategy_id: { type: 'string' } },
            required: ['strategy_id'],
            additionalProperties: false,
        },
    },
    {
        name: 'create_strategy',
        description: 'Create a new strategy and initialize its first NAV snapshot (cash = initial_capital).',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                description: { type: 'string' },
                initial_capital: { type: 'number' },
                signal_source: { type: 'string' },
                signal_config: { type: 'object', additionalProperties: true },
                rebalance_rule: { type: 'object', additionalProperties: true },
                stop_loss: { type: 'number' },
                take_profit: { type: 'number' },
                benchmark: { type: 'string' },
                status: { type: 'string' },
            },
            required: ['id', 'name'],
            additionalProperties: false,
        },
    },
    {
        name: 'update_strategy',
        description: 'Update fields of an existing strategy. Only provided fields are changed.',
        inputSchema: {
            type: 'object',
            properties: {
                strategy_id: { type: 'string' },
                name: { type: 'string' },
                description: { type: 'string' },
                initial_capital: { type: 'number' },
                signal_source: { type: 'string' },
                signal_config: { type: 'object', additionalProperties: true },
                rebalance_rule: { type: 'object', additionalProperties: true },
                stop_loss: { type: 'number' },
                take_profit: { type: 'number' },
                benchmark: { type: 'string' },
                status: { type: 'string' },
            },
            required: ['strategy_id'],
            additionalProperties: false,
        },
    },
    {
        name: 'delete_strategy',
        description: 'Delete a strategy and ALL related data (holdings, transactions, nav_snapshots, signals, backtest_results).',
        inputSchema: {
            type: 'object',
            properties: { strategy_id: { type: 'string' } },
            required: ['strategy_id'],
            additionalProperties: false,
        },
    },
    {
        name: 'import_signals',
        description: 'Import an array of signals for a strategy with today date. Each: { symbol, name?, rank?, score?, close?, action?, weight? }. INSERT OR REPLACE.',
        inputSchema: {
            type: 'object',
            properties: {
                strategy_id: { type: 'string' },
                signals: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            symbol: { type: 'string' },
                            name: { type: 'string' },
                            rank: { type: 'number' },
                            score: { type: 'number' },
                            close: { type: 'number' },
                            action: { type: 'string' },
                            weight: { type: 'number' },
                        },
                        required: ['symbol'],
                    },
                },
            },
            required: ['strategy_id', 'signals'],
            additionalProperties: false,
        },
    },
    {
        name: 'import_signals_from_csv',
        description: 'Load signals from a top10 CSV (default /git/quant_factors/results/paper_top10.csv) and insert into the signals table.',
        inputSchema: {
            type: 'object',
            properties: {
                strategy_id: { type: 'string' },
                csv_path: { type: 'string' },
            },
            required: ['strategy_id'],
            additionalProperties: false,
        },
    },
    {
        name: 'import_backtest_result',
        description: 'Import a single backtest result row. params/equity_curve/monthly_returns are stored as JSON strings.',
        inputSchema: {
            type: 'object',
            properties: {
                strategy_id: { type: 'string' },
                start_date: { type: 'string' },
                end_date: { type: 'string' },
                initial_capital: { type: 'number' },
                final_value: { type: 'number' },
                annual_return: { type: 'number' },
                sharpe: { type: 'number' },
                max_drawdown: { type: 'number' },
                calmar: { type: 'number' },
                win_rate: { type: 'number' },
                turnover: { type: 'number' },
                benchmark_return: { type: 'number' },
                excess_return: { type: 'number' },
                ir: { type: 'number' },
                hit_rate: { type: 'number' },
                total_trades: { type: 'number' },
                params: { type: 'object', additionalProperties: true },
                equity_curve: { type: 'array' },
                monthly_returns: { type: 'array' },
            },
            required: ['strategy_id', 'start_date', 'end_date'],
            additionalProperties: false,
        },
    },
    {
        name: 'import_backtest_from_csv',
        description: 'Parse a backtest results CSV (default /git/quant_factors/results/backtest_results.csv), auto-detect columns, and INSERT into backtest_results.',
        inputSchema: {
            type: 'object',
            properties: {
                strategy_id: { type: 'string' },
                csv_path: { type: 'string' },
            },
            required: ['strategy_id'],
            additionalProperties: false,
        },
    },
    {
        name: 'trigger_rebalance',
        description: 'Run rebalance for a single strategy (async — fetches live prices). Params: force (ignore position discipline), date. Returns actions, nav, stats.',
        inputSchema: {
            type: 'object',
            properties: {
                strategy_id: { type: 'string' },
                force: { type: 'boolean' },
                date: { type: 'string' },
            },
            required: ['strategy_id'],
            additionalProperties: false,
        },
    },
    {
        name: 'trigger_all_rebalance',
        description: 'Run rebalance for all active strategies (async). Returns timestamp, total, and per-strategy results.',
        inputSchema: {
            type: 'object',
            properties: {
                force: { type: 'boolean' },
                date: { type: 'string' },
            },
            additionalProperties: false,
        },
    },
    {
        name: 'update_nav_snapshot',
        description: 'Refresh prices (async marketData call) and recompute NAV for a strategy WITHOUT executing trades. Updates holdings prices and nav_snapshots.',
        inputSchema: {
            type: 'object',
            properties: {
                strategy_id: { type: 'string' },
                date: { type: 'string' },
            },
            required: ['strategy_id'],
            additionalProperties: false,
        },
    },
];

// ─── Tool Handler ──────────────────────────────────────────
async function callTool(name, args = {}) {
    const db = getDB();
    switch (name) {
        case 'list_strategies': {
            const strategies = db.prepare('SELECT * FROM strategies ORDER BY id').all();
            const out = strategies.map(s => {
                const nav = getLatestNavRow(db, s.id);
                const hd = getLatestHoldingsDate(db, s.id);
                const hc = hd ? db.prepare('SELECT COUNT(*) as c FROM holdings WHERE strategy_id = ? AND trade_date = ?').get(s.id, hd.trade_date).c : 0;
                const lt = db.prepare('SELECT trade_date FROM transactions WHERE strategy_id = ? ORDER BY trade_date DESC LIMIT 1').get(s.id);
                return {
                    id: s.id, name: s.name, description: s.description, status: s.status,
                    benchmark: s.benchmark, initial_capital: s.initial_capital,
                    total_assets: nav ? nav.total_assets : s.initial_capital,
                    daily_return: nav ? nav.daily_return : 0,
                    cumulative_return: nav ? nav.cumulative_return : 0,
                    max_drawdown: nav ? nav.max_drawdown : 0,
                    sharpe: nav ? nav.sharpe : 0,
                    holding_count: hc,
                    last_trade_date: lt ? lt.trade_date : null,
                };
            });
            return jsonOut(out);
        }
        case 'get_strategy_detail': {
            const s = db.prepare('SELECT * FROM strategies WHERE id = ?').get(args.strategy_id);
            if (!s) throw new Error(`Strategy not found: ${args.strategy_id}`);
            const nav = getLatestNavRow(db, s.id);
            const hd = getLatestHoldingsDate(db, s.id);
            const hc = hd ? db.prepare('SELECT COUNT(*) as c FROM holdings WHERE strategy_id = ? AND trade_date = ?').get(s.id, hd.trade_date).c : 0;
            const tc = db.prepare('SELECT COUNT(*) as c FROM transactions WHERE strategy_id = ?').get(s.id).c;
            return jsonOut({
                ...s,
                signal_config: safeParse(s.signal_config),
                rebalance_rule: safeParse(s.rebalance_rule),
                summary: { latestNav: nav, holdingCount: hc, transactionCount: tc },
            });
        }
        case 'get_nav_curve': {
            let sql = 'SELECT * FROM nav_snapshots WHERE strategy_id = ?';
            const p = [args.strategy_id];
            if (args.start_date) { sql += ' AND trade_date >= ?'; p.push(args.start_date); }
            if (args.end_date) { sql += ' AND trade_date <= ?'; p.push(args.end_date); }
            sql += ' ORDER BY trade_date ASC';
            if (args.limit) { sql += ' LIMIT ?'; p.push(args.limit); }
            return jsonOut(db.prepare(sql).all(...p));
        }
        case 'get_holdings': {
            let date = args.date;
            if (!date) { const hd = getLatestHoldingsDate(db, args.strategy_id); date = hd ? hd.trade_date : null; }
            if (!date) return jsonOut([]);
            return jsonOut(db.prepare('SELECT * FROM holdings WHERE strategy_id = ? AND trade_date = ? ORDER BY market_value DESC').all(args.strategy_id, date));
        }
        case 'get_transactions': {
            let sql = 'SELECT * FROM transactions WHERE strategy_id = ?';
            const p = [args.strategy_id];
            if (args.start_date) { sql += ' AND trade_date >= ?'; p.push(args.start_date); }
            if (args.end_date) { sql += ' AND trade_date <= ?'; p.push(args.end_date); }
            if (args.side) { sql += ' AND side = ?'; p.push(args.side); }
            sql += ' ORDER BY trade_date DESC, id DESC LIMIT ?';
            p.push(args.limit || 200);
            return jsonOut(db.prepare(sql).all(...p));
        }
        case 'get_strategy_compare': {
            let strategies;
            if (args.ids) {
                const idArr = args.ids.split(',').map(x => x.trim()).filter(Boolean);
                const ph = idArr.map(() => '?').join(',');
                strategies = db.prepare(`SELECT * FROM strategies WHERE id IN (${ph})`).all(...idArr);
            } else {
                strategies = db.prepare("SELECT * FROM strategies WHERE status = 'active' ORDER BY id").all();
            }
            const out = strategies.map(s => {
                const nav = getLatestNavRow(db, s.id);
                const hd = getLatestHoldingsDate(db, s.id);
                const hc = hd ? db.prepare('SELECT COUNT(*) as c FROM holdings WHERE strategy_id = ? AND trade_date = ?').get(s.id, hd.trade_date).c : 0;
                const tc = db.prepare('SELECT COUNT(*) as c, COALESCE(SUM(amount),0) as amt FROM transactions WHERE strategy_id = ?').get(s.id);
                const lt = db.prepare('SELECT trade_date FROM transactions WHERE strategy_id = ? ORDER BY trade_date DESC LIMIT 1').get(s.id);
                const totalAssets = nav ? nav.total_assets : s.initial_capital;
                return {
                    id: s.id, name: s.name, totalAssets,
                    cumulativeReturn: nav ? nav.cumulative_return : 0,
                    dailyReturn: nav ? nav.daily_return : 0,
                    maxDrawdown: nav ? nav.max_drawdown : 0,
                    sharpe: nav ? nav.sharpe : 0,
                    positionRatio: nav ? nav.position_ratio : 0,
                    holdingCount: hc, transactionCount: tc.c,
                    turnover: totalAssets > 0 ? tc.amt / totalAssets : 0,
                    winRate: computeWinRate(db, s.id),
                    lastTradeDate: lt ? lt.trade_date : null,
                };
            });
            return jsonOut(out);
        }
        case 'get_positions_overview': {
            const strategies = db.prepare('SELECT id, name FROM strategies ORDER BY id').all();
            const out = [];
            for (const s of strategies) {
                const hd = getLatestHoldingsDate(db, s.id);
                if (!hd) continue;
                const rows = db.prepare('SELECT * FROM holdings WHERE strategy_id = ? AND trade_date = ? ORDER BY market_value DESC').all(s.id, hd.trade_date);
                for (const h of rows) {
                    out.push({
                        strategy_id: s.id, strategy_name: s.name,
                        symbol: h.symbol, name: h.name, quantity: h.quantity,
                        available_quantity: h.available_quantity, cost_price: h.cost_price,
                        current_price: h.current_price, market_value: h.market_value,
                        profit_pct: h.profit_pct, weight: h.weight,
                    });
                }
            }
            return jsonOut(out);
        }
        case 'get_engine_status': {
            return jsonOut(rebalanceEngine.getEngineStatus());
        }
        case 'get_backtest_comparison': {
            const s = db.prepare('SELECT * FROM strategies WHERE id = ?').get(args.strategy_id);
            if (!s) throw new Error(`Strategy not found: ${args.strategy_id}`);
            const navs = db.prepare('SELECT * FROM nav_snapshots WHERE strategy_id = ? ORDER BY trade_date ASC').all(args.strategy_id);
            const latestNav = navs.length ? navs[navs.length - 1] : null;
            const startDate = navs.length ? navs[0].trade_date : null;
            const endDate = navs.length ? latestNav.trade_date : null;
            const days = daysBetween(startDate, endDate);
            const live = {
                totalAssets: latestNav ? latestNav.total_assets : s.initial_capital,
                cumulativeReturn: latestNav ? latestNav.cumulative_return : 0,
                annualReturn: annualizeReturn(latestNav ? latestNav.cumulative_return : 0, days),
                sharpe: latestNav ? latestNav.sharpe : 0,
                maxDrawdown: latestNav ? latestNav.max_drawdown : 0,
                winRate: computeWinRate(db, args.strategy_id),
                daysElapsed: days, startDate, endDate,
                equityCurve: navs.map(n => ({ date: n.trade_date, value: n.total_assets, benchmark_return: n.benchmark_return })),
            };
            const bts = db.prepare('SELECT * FROM backtest_results WHERE strategy_id = ? ORDER BY backtest_date DESC').all(args.strategy_id);
            const backtest = bts.map(bt => ({
                backtest_date: bt.backtest_date, start_date: bt.start_date, end_date: bt.end_date,
                initial_capital: bt.initial_capital, final_value: bt.final_value,
                annual_return: bt.annual_return, sharpe: bt.sharpe, max_drawdown: bt.max_drawdown,
                calmar: bt.calmar, win_rate: bt.win_rate, turnover: bt.turnover,
                benchmark_return: bt.benchmark_return, excess_return: bt.excess_return,
                ir: bt.ir, hit_rate: bt.hit_rate, total_trades: bt.total_trades,
                params: safeParse(bt.params), equity_curve: safeParse(bt.equity_curve),
                monthly_returns: safeParse(bt.monthly_returns),
            }));
            let delta = null;
            if (backtest.length) {
                const b0 = backtest[0];
                delta = {
                    annualReturn: (live.annualReturn || 0) - (b0.annual_return || 0),
                    sharpe: (live.sharpe || 0) - (b0.sharpe || 0),
                    maxDrawdown: (live.maxDrawdown || 0) - (b0.max_drawdown || 0),
                    winRate: (live.winRate || 0) - (b0.win_rate || 0),
                };
            }
            return jsonOut({ strategyId: s.id, strategyName: s.name, benchmark: s.benchmark, live, backtest, delta });
        }
        case 'get_rebalance_preview': {
            const s = db.prepare('SELECT * FROM strategies WHERE id = ?').get(args.strategy_id);
            if (!s) throw new Error(`Strategy not found: ${args.strategy_id}`);
            const signalConfig = safeParse(s.signal_config);
            let signals = [];
            if (s.signal_source !== 'none') {
                signals = signalLoader.loadSignals(s.signal_source, signalConfig);
                if (s.signal_source === 'backtest_import' && !Array.isArray(signals)) signals = signals[todayStr()] || [];
            }
            const signalSymbols = new Set((signals || []).map(x => x.symbol));
            const hd = getLatestHoldingsDate(db, s.id);
            const currentHoldings = hd ? db.prepare('SELECT * FROM holdings WHERE strategy_id = ? AND trade_date = ?').all(s.id, hd.trade_date) : [];
            const heldSymbols = new Set(currentHoldings.map(h => h.symbol));
            const toSell = currentHoldings.filter(h => !signalSymbols.has(h.symbol));
            const toBuy = (signals || []).filter(x => !heldSymbols.has(x.symbol));
            const today = todayStr();
            const isMon = new Date(today + 'T12:00:00').getDay() === 1;
            const nav = getLatestNavRow(db, s.id);
            const positionRatio = nav ? nav.position_ratio : 0;
            return jsonOut({
                strategy_id: s.id, trade_date: today,
                current_holdings: currentHoldings, latest_signals: signals,
                stocks_to_sell: toSell.map(h => ({ symbol: h.symbol, name: h.name, quantity: h.quantity, available_quantity: h.available_quantity })),
                stocks_to_buy: toBuy.map(x => ({ symbol: x.symbol, name: x.name, rank: x.rank, weight: x.weight })),
                position_discipline: { isMonday: isMon, positionRatio, threshold: 0.80, rebalanceAllowed: positionRatio < 0.80 || isMon },
                estimated_trades: toSell.length + toBuy.length,
            });
        }
        case 'create_strategy': {
            const id = args.id;
            if (!id) throw new Error('id is required');
            if (!args.name) throw new Error('name is required');
            const existing = db.prepare('SELECT id FROM strategies WHERE id = ?').get(id);
            if (existing) throw new Error(`Strategy already exists: ${id}`);
            const capital = args.initial_capital ?? 1000000;
            db.prepare(`INSERT INTO strategies (id, name, description, initial_capital, signal_source, signal_config, rebalance_rule, stop_loss, take_profit, benchmark, status) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
                id, args.name, args.description ?? null, capital,
                args.signal_source || 'top10_csv',
                JSON.stringify(args.signal_config || {}),
                JSON.stringify(args.rebalance_rule || {}),
                args.stop_loss ?? -5.0, args.take_profit ?? 15.0,
                args.benchmark || '000300.SH', args.status || 'active'
            );
            db.prepare(`INSERT OR IGNORE INTO nav_snapshots (strategy_id, trade_date, total_assets, cash, market_value, position_ratio, daily_return, cumulative_return, benchmark_return, excess_return, max_drawdown, sharpe) VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0)`).run(id, todayStr(), capital, capital);
            return jsonOut({ id, message: 'Strategy created' });
        }
        case 'update_strategy': {
            const s = db.prepare('SELECT * FROM strategies WHERE id = ?').get(args.strategy_id);
            if (!s) throw new Error(`Strategy not found: ${args.strategy_id}`);
            const fields = [], vals = [];
            const simple = ['name', 'description', 'initial_capital', 'signal_source', 'stop_loss', 'take_profit', 'benchmark', 'status'];
            for (const k of simple) {
                if (args[k] !== undefined) { fields.push(`${k} = ?`); vals.push(args[k]); }
            }
            if (args.signal_config !== undefined) { fields.push('signal_config = ?'); vals.push(JSON.stringify(args.signal_config)); }
            if (args.rebalance_rule !== undefined) { fields.push('rebalance_rule = ?'); vals.push(JSON.stringify(args.rebalance_rule)); }
            if (!fields.length) return jsonOut({ id: args.strategy_id, message: 'No fields to update' });
            fields.push("updated_at = datetime('now')");
            vals.push(args.strategy_id);
            db.prepare(`UPDATE strategies SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
            return jsonOut({ id: args.strategy_id, message: 'Strategy updated' });
        }
        case 'delete_strategy': {
            const tx = db.transaction(() => {
                db.prepare('DELETE FROM holdings WHERE strategy_id = ?').run(args.strategy_id);
                db.prepare('DELETE FROM transactions WHERE strategy_id = ?').run(args.strategy_id);
                db.prepare('DELETE FROM nav_snapshots WHERE strategy_id = ?').run(args.strategy_id);
                db.prepare('DELETE FROM signals WHERE strategy_id = ?').run(args.strategy_id);
                db.prepare('DELETE FROM backtest_results WHERE strategy_id = ?').run(args.strategy_id);
                db.prepare('DELETE FROM strategies WHERE id = ?').run(args.strategy_id);
            });
            tx();
            return jsonOut({ id: args.strategy_id, message: 'Strategy and all related data deleted' });
        }
        case 'import_signals': {
            const s = db.prepare('SELECT id FROM strategies WHERE id = ?').get(args.strategy_id);
            if (!s) throw new Error(`Strategy not found: ${args.strategy_id}`);
            const signals = Array.isArray(args.signals) ? args.signals : [];
            const today = todayStr();
            const stmt = db.prepare(`INSERT OR REPLACE INTO signals (strategy_id, signal_date, symbol, name, rank, score, close, action, weight) VALUES (?,?,?,?,?,?,?,?,?)`);
            const tx = db.transaction((items) => {
                for (const sig of items) {
                    if (!sig.symbol) continue;
                    stmt.run(args.strategy_id, today, sig.symbol, sig.name || sig.symbol, sig.rank ?? null, sig.score ?? 0, sig.close ?? 0, sig.action || 'buy', sig.weight ?? null);
                }
            });
            tx(signals);
            return jsonOut({ strategy_id: args.strategy_id, imported: signals.filter(x => x.symbol).length });
        }
        case 'import_signals_from_csv': {
            const csvPath = args.csv_path || '/git/quant_factors/results/paper_top10.csv';
            const signals = signalLoader.loadTop10CSV(csvPath);
            const s = db.prepare('SELECT id FROM strategies WHERE id = ?').get(args.strategy_id);
            if (!s) throw new Error(`Strategy not found: ${args.strategy_id}`);
            const today = todayStr();
            const stmt = db.prepare(`INSERT OR REPLACE INTO signals (strategy_id, signal_date, symbol, name, rank, score, close, action, weight) VALUES (?,?,?,?,?,?,?,?,?)`);
            const tx = db.transaction((items) => {
                for (const sig of items) stmt.run(args.strategy_id, today, sig.symbol, sig.name, sig.rank, sig.score, sig.close, sig.action, sig.weight);
            });
            tx(signals);
            return jsonOut({ strategy_id: args.strategy_id, imported: signals.length, symbols: signals.map(x => x.symbol) });
        }
        case 'import_backtest_result': {
            if (!args.start_date || !args.end_date) throw new Error('start_date and end_date are required');
            const s = db.prepare('SELECT id FROM strategies WHERE id = ?').get(args.strategy_id);
            if (!s) throw new Error(`Strategy not found: ${args.strategy_id}`);
            db.prepare(`INSERT INTO backtest_results (strategy_id, backtest_date, start_date, end_date, initial_capital, final_value, annual_return, sharpe, max_drawdown, calmar, win_rate, turnover, benchmark_return, excess_return, ir, hit_rate, total_trades, params, equity_curve, monthly_returns) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
                args.strategy_id, todayStr(), args.start_date, args.end_date,
                args.initial_capital ?? null, args.final_value ?? null,
                args.annual_return ?? null, args.sharpe ?? null, args.max_drawdown ?? null,
                args.calmar ?? null, args.win_rate ?? null, args.turnover ?? null,
                args.benchmark_return ?? null, args.excess_return ?? null, args.ir ?? null,
                args.hit_rate ?? null, args.total_trades ?? null,
                JSON.stringify(args.params || {}),
                args.equity_curve ? JSON.stringify(args.equity_curve) : null,
                args.monthly_returns ? JSON.stringify(args.monthly_returns) : null
            );
            return jsonOut({ strategy_id: args.strategy_id, message: 'Backtest result imported' });
        }
        case 'import_backtest_from_csv': {
            const csvPath = args.csv_path || '/git/quant_factors/results/backtest_results.csv';
            const { headers, rows } = signalLoader.parseCSVFile(csvPath);
            const s = db.prepare('SELECT id FROM strategies WHERE id = ?').get(args.strategy_id);
            if (!s) throw new Error(`Strategy not found: ${args.strategy_id}`);
            const findCol = (re) => headers.find(h => re.test(h));
            const colMap = {
                start_date: findCol(/^start.?date/i),
                end_date: findCol(/^end.?date/i),
                initial_capital: findCol(/initial.?capital/i),
                final_value: findCol(/final.?value/i),
                annual_return: findCol(/annual.?return/i),
                sharpe: findCol(/sharpe/i),
                max_drawdown: findCol(/max.?drawdown/i),
                calmar: findCol(/calmar/i),
                win_rate: findCol(/win.?rate/i),
                turnover: findCol(/turnover/i),
                benchmark_return: findCol(/benchmark.?return/i),
                excess_return: findCol(/excess.?return/i),
                ir: findCol(/^ir$/i),
                hit_rate: findCol(/hit.?rate/i),
                total_trades: findCol(/total.?trades/i),
            };
            const num = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
            const stmt = db.prepare(`INSERT INTO backtest_results (strategy_id, backtest_date, start_date, end_date, initial_capital, final_value, annual_return, sharpe, max_drawdown, calmar, win_rate, turnover, benchmark_return, excess_return, ir, hit_rate, total_trades, params, equity_curve, monthly_returns) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
            let imported = 0;
            const today = todayStr();
            const tx = db.transaction((items) => {
                for (const row of items) {
                    const g = (k) => colMap[k] ? row[colMap[k]] : '';
                    const sd = g('start_date'), ed = g('end_date');
                    if (!sd || !ed) continue;
                    stmt.run(
                        args.strategy_id, today, sd, ed,
                        num(g('initial_capital')), num(g('final_value')),
                        num(g('annual_return')), num(g('sharpe')), num(g('max_drawdown')),
                        num(g('calmar')), num(g('win_rate')), num(g('turnover')),
                        num(g('benchmark_return')), num(g('excess_return')), num(g('ir')),
                        num(g('hit_rate')), num(g('total_trades')),
                        '{}', null, null
                    );
                    imported++;
                }
            });
            tx(rows);
            return jsonOut({ strategy_id: args.strategy_id, imported, columns: colMap });
        }
        case 'trigger_rebalance': {
            // ASYNC: rebalanceEngine.rebalance calls the marketData API
            const r = await rebalanceEngine.rebalance(args.strategy_id, {
                forceRebalance: args.force || false,
                date: args.date,
            });
            return jsonOut({
                strategy_id: r.strategyId,
                trade_date: r.tradeDate,
                actions: r.actions,
                nav: r.nav,
                stats: r.stats,
                ...(r.skipped ? { skipped: r.skipped } : {}),
            });
        }
        case 'trigger_all_rebalance': {
            // ASYNC: rebalanceEngine.rebalanceAll runs rebalance for each active strategy
            const results = await rebalanceEngine.rebalanceAll({
                forceRebalance: args.force || false,
                date: args.date,
            });
            return jsonOut({ timestamp: new Date().toISOString(), total: results.length, results });
        }
        case 'update_nav_snapshot': {
            // ASYNC: fetch live prices (marketData), recompute holdings + NAV without executing trades
            const tradeDate = args.date || todayStr();
            const s = db.prepare('SELECT * FROM strategies WHERE id = ?').get(args.strategy_id);
            if (!s) throw new Error(`Strategy not found: ${args.strategy_id}`);
            const hd = getLatestHoldingsDate(db, s.id);
            let holdings = hd ? db.prepare('SELECT * FROM holdings WHERE strategy_id = ? AND trade_date = ?').all(s.id, hd.trade_date) : [];
            const priceMap = {};
            for (const h of holdings) {
                try { priceMap[h.symbol] = await MarketDataService.getRealTimePrice(h.symbol); }
                catch (e) { priceMap[h.symbol] = h.current_price; }
            }
            const updated = holdings.map(h => {
                const price = priceMap[h.symbol] ?? h.current_price;
                const mv = price * h.quantity;
                const profitPct = h.cost_price > 0 ? parseFloat(((price - h.cost_price) / h.cost_price * 100).toFixed(2)) : 0;
                return { ...h, current_price: price, market_value: parseFloat(mv.toFixed(2)), profit_pct: profitPct };
            });
            const totalMV = updated.reduce((a, h) => a + h.market_value, 0);
            const latestNav = getLatestNavRow(db, s.id);
            const cash = latestNav ? latestNav.cash : s.initial_capital;
            const totalAssets = cash + totalMV;
            for (const h of updated) h.weight = totalAssets > 0 ? parseFloat((h.market_value / totalAssets).toFixed(4)) : 0;
            // Persist refreshed holdings for tradeDate (price refresh, no trades)
            if (updated.length > 0) {
                db.prepare('DELETE FROM holdings WHERE strategy_id = ? AND trade_date = ?').run(s.id, tradeDate);
                const ins = db.prepare(`INSERT INTO holdings (strategy_id, trade_date, symbol, name, quantity, available_quantity, cost_price, current_price, market_value, profit_pct, weight) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
                const tx2 = db.transaction((items) => {
                    for (const h of items) ins.run(s.id, tradeDate, h.symbol, h.name, h.quantity, h.available_quantity, h.cost_price, h.current_price, h.market_value, h.profit_pct, h.weight);
                });
                tx2(updated);
            }
            let benchmarkReturn = 0;
            try {
                const indices = await MarketDataService.getIndices();
                const bench = indices.find(i => i.symbol === s.benchmark);
                if (bench) benchmarkReturn = bench.changePercent || 0;
            } catch (e) { /* benchmark fetch failed, use 0 */ }
            const nav = rebalanceEngine.snapshotNAV(s.id, tradeDate, cash, updated, benchmarkReturn);
            return jsonOut({ strategy_id: s.id, trade_date: tradeDate, nav });
        }
        default:
            throw new Error(`Unknown tool: ${name}`);
    }
}

// ─── Server Setup ──────────────────────────────────────────
const server = new Server(
    { name: 'paper-trading-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        return await callTool(name, args || {});
    } catch (e) {
        return errOut(e.message);
    }
});

// ─── Startup ───────────────────────────────────────────────
async function main() {
    // Ensure the 3 default strategies exist
    rebalanceEngine.seedStrategies();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[paper-trading-mcp] server started on stdio');
}

main().catch((e) => {
    console.error('[paper-trading-mcp] fatal:', e);
    process.exit(1);
});
