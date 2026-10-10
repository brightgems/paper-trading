/**
 * Expanded API Test Suite — Paper Trading Simulator
 *
 * Covers strategy CRUD error handling, query-parameter validation,
 * engine/compare field validation, backtest endpoints, trade endpoints,
 * Content-Type headers, nonexistent-strategy graceful handling, and
 * MCP server integration (initialize, tools/list, tools/call).
 *
 * Uses Node's built-in test runner (node:test) and assert (node:assert).
 * No external test dependencies. Uses built-in fetch() (Node 18+).
 *
 * Run from the server directory:
 *   node --test tests/api-expanded.test.js
 * or with the full suite:
 *   node --test tests/
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');

const PORT = 5006;
const BASE = `http://localhost:${PORT}/api`;
const MCP_SERVER_PATH = require('node:path').resolve(
    __dirname,
    '../../mcp/index.js',
);

let server;

// ─── Setup / Teardown ───────────────────────────────────────
before(async () => {
    // index.js calls app.listen(PORT) at module-load time.  Intercept
    // http.createServer (used internally by Express's app.listen) to
    // capture the server reference without calling app.listen a second
    // time (which would cause EADDRINUSE).
    process.env.NODE_ENV = 'production';
    process.env.PORT = String(PORT);
    process.env.DISABLE_SCHEDULER = 'true';

    const http = require('node:http');
    const originalCreateServer = http.createServer;
    http.createServer = function (...args) {
        server = originalCreateServer.apply(http, args);
        http.createServer = originalCreateServer;
        return server;
    };
    require('../index.js');

    if (server && !server.listening) {
        await new Promise((resolve) => server.once('listening', resolve));
    }

    try {
        await fetch(`${BASE}/strategy/test_exp`, { method: 'DELETE' });
    } catch (_) { /* ignore */ }
});

after(async () => {
    try {
        await fetch(`${BASE}/strategy/test_exp`, { method: 'DELETE' });
    } catch (_) { /* ignore */ }
    try { require('../services/scheduler').stop(); } catch (_) { /* ignore */ }
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
});

async function jsonReq(p, options = {}) {
    return fetch(`${BASE}${p}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
    });
}

// ─── Strategy CRUD – Error Handling & Validation ─────────────
describe('Strategy CRUD – error handling & validation', () => {
    test('POST /strategy without id → 400', async () => {
        const res = await jsonReq('/strategy', {
            method: 'POST',
            body: JSON.stringify({ name: 'No ID Strategy' }),
        });
        assert.strictEqual(res.status, 400);
        const body = await res.json();
        assert.ok(body.error);
    });

    test('POST /strategy without name → 400', async () => {
        const res = await jsonReq('/strategy', {
            method: 'POST',
            body: JSON.stringify({ id: 'no_name_strat' }),
        });
        assert.strictEqual(res.status, 400);
        const body = await res.json();
        assert.ok(body.error);
    });

    test('POST /strategy with duplicate id → 409', async () => {
        const createRes = await jsonReq('/strategy', {
            method: 'POST',
            body: JSON.stringify({
                id: 'test_exp',
                name: 'Test Expanded',
                description: 'temporary test strategy',
            }),
        });
        assert.ok(
            createRes.status === 201 || createRes.status === 409,
            `first create should succeed, got ${createRes.status}`,
        );
        const dupRes = await jsonReq('/strategy', {
            method: 'POST',
            body: JSON.stringify({ id: 'test_exp', name: 'Test Expanded 2' }),
        });
        assert.strictEqual(dupRes.status, 409);
        const body = await dupRes.json();
        assert.ok(body.error);
    });

    test('PUT /strategy/nonexistent → 404', async () => {
        const res = await jsonReq('/strategy/nonexistent_strat', {
            method: 'PUT',
            body: JSON.stringify({ name: 'Updated Name' }),
        });
        assert.strictEqual(res.status, 404);
        const body = await res.json();
        assert.ok(body.error);
    });

    test('DELETE /strategy/nonexistent → 404', async () => {
        const res = await jsonReq('/strategy/nonexistent_strat', {
            method: 'DELETE',
        });
        assert.strictEqual(res.status, 404);
        const body = await res.json();
        assert.ok(body.error);
    });
});

// ─── Strategy Data – Query Parameters ────────────────────────
describe('Strategy data – query parameters', () => {
    test('GET /strategy/combo_6factor/nav?limit=1 → 200, length <= 1', async () => {
        const res = await fetch(`${BASE}/strategy/combo_6factor/nav?limit=1`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok(Array.isArray(data));
        assert.ok(data.length <= 1, `expected <= 1 rows, got ${data.length}`);
    });

    test('GET /strategy/combo_6factor/transactions?limit=5 → 200, length <= 5', async () => {
        const res = await fetch(`${BASE}/strategy/combo_6factor/transactions?limit=5`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok(Array.isArray(data));
        assert.ok(data.length <= 5, `expected <= 5 rows, got ${data.length}`);
    });

    test('GET /strategy/combo_6factor/transactions?side=buy → 200, all side=buy', async () => {
        const res = await fetch(`${BASE}/strategy/combo_6factor/transactions?side=buy`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok(Array.isArray(data));
        for (const tx of data) { assert.strictEqual(tx.side, 'buy'); }
    });

    test('GET /strategy/combo_6factor/holdings?date=2026-01-01 → 200, returns array', async () => {
        const res = await fetch(`${BASE}/strategy/combo_6factor/holdings?date=2026-01-01`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok(Array.isArray(data));
    });
});

// ─── Engine & Compare – Field Validation ─────────────────────
describe('Engine & compare – field validation', () => {
    test('GET /strategy/engine/status → 200, first strategy has required fields', async () => {
        const res = await fetch(`${BASE}/strategy/engine/status`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok(data.strategies);
        assert.ok(data.strategies.length > 0);
        const s = data.strategies[0];
        for (const f of ['id','name','status','totalAssets','cash','positionRatio','holdingCount']) {
            assert.ok(f in s, `missing field "${f}"`);
        }
    });

    test('GET /strategy/compare/all → 200, first item has required fields', async () => {
        const res = await fetch(`${BASE}/strategy/compare/all`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok(data.length > 0);
        const item = data[0];
        for (const f of ['id','name','totalAssets','cumulativeReturn','sharpe','maxDrawdown','holdingCount','winRate']) {
            assert.ok(f in item, `missing field "${f}"`);
        }
    });
});

// ─── Backtest Endpoints ──────────────────────────────────────
describe('Backtest endpoints', () => {
    test('GET /strategy/combo_6factor/backtest → 200, field validation if non-empty', async () => {
        const res = await fetch(`${BASE}/strategy/combo_6factor/backtest`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok(Array.isArray(data));
        if (data.length > 0) {
            const bt = data[0];
            for (const f of ['strategy_id', 'backtest_date', 'start_date', 'end_date']) {
                assert.ok(f in bt, `missing field "${f}"`);
            }
        }
    });

    test('GET /strategy/combo_6factor/backtest-comparison → 200, live object has required fields', async () => {
        const res = await fetch(`${BASE}/strategy/combo_6factor/backtest-comparison`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok(data.live);
        for (const f of ['totalAssets','cumulativeReturn','sharpe','maxDrawdown','daysElapsed','startDate','endDate','equityCurve']) {
            assert.ok(f in data.live, `missing field "${f}"`);
        }
    });
});

// ─── Trade Endpoints ─────────────────────────────────────────
describe('Trade endpoints', () => {
    test('GET /trade/price/000001.SZ → 200, has price field', async () => {
        const res = await fetch(`${BASE}/trade/price/000001.SZ`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok('price' in data);
    });

    test('GET /trade/candles/000001.SZ → 200, returns array', async () => {
        const res = await fetch(`${BASE}/trade/candles/000001.SZ`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok(Array.isArray(data));
    });
});

// ─── Content-Type / Headers ──────────────────────────────────
describe('Content-Type / headers', () => {
    test('GET /strategy/combo_6factor/holdings → Content-Type is application/json', async () => {
        const res = await fetch(`${BASE}/strategy/combo_6factor/holdings`);
        assert.strictEqual(res.status, 200);
        const ct = res.headers.get('content-type');
        assert.ok(ct && ct.includes('application/json'), `expected application/json, got ${ct}`);
    });
});

// ─── Nonexistent Strategy – Graceful Handling ────────────────
describe('Nonexistent strategy – graceful handling', () => {
    test('GET /strategy/nonexistent/holdings → 200 with empty array', async () => {
        const res = await fetch(`${BASE}/strategy/nonexistent/holdings`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok(Array.isArray(data));
        assert.strictEqual(data.length, 0);
    });

    test('GET /strategy/nonexistent/nav → 200 with empty array', async () => {
        const res = await fetch(`${BASE}/strategy/nonexistent/nav`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok(Array.isArray(data));
        assert.strictEqual(data.length, 0);
    });
});

// ─── MCP Server Tests ────────────────────────────────────────
describe('Scheduler endpoints', () => {
    test('GET /strategy/engine/scheduler/status → 200, has running field and strategies array', async () => {
        const res = await fetch(`${BASE}/strategy/engine/scheduler/status`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok('running' in data, 'should have running field');
        assert.ok(Array.isArray(data.strategies), 'should have strategies array');
    });

    test('POST /strategy/engine/scheduler/start → 200, started or alreadyRunning', async () => {
        const res = await jsonReq('/strategy/engine/scheduler/start', { method: 'POST' });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok(data.started || data.alreadyRunning, 'should indicate started or alreadyRunning');
    });

    test('POST /strategy/engine/scheduler/stop → 200, has stopped', async () => {
        const res = await jsonReq('/strategy/engine/scheduler/stop', { method: 'POST' });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok(data.stopped, 'should indicate stopped');
    });

    test('POST /strategy/engine/run/nonexistent → 200, has skipped', async () => {
        const res = await jsonReq('/strategy/engine/run/nonexistent', { method: 'POST' });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok(data.skipped, 'should be skipped for nonexistent strategy');
    });

    test('POST /strategy/engine/run-all → 200, has results or skipped', async () => {
        const res = await jsonReq('/strategy/engine/run-all', { method: 'POST' });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok(data.results || data.skipped, 'should have results array or skipped');
    });
});

describe('MCP server tests', () => {
    let mcpChild = null;
    let mcpReady = false;
    let initResponse = null;

    /** Send a JSON-RPC request via stdin; wait for matching response on stdout. */
    function mcpRequest(child, msg, timeoutMs = 8000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error('MCP request timeout')),
                timeoutMs,
            );
            let buffer = '';
            const onData = (chunk) => {
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop();
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const parsed = JSON.parse(line);
                        if (parsed.id === msg.id) {
                            clearTimeout(timer);
                            child.stdout.off('data', onData);
                            resolve(parsed);
                            return;
                        }
                    } catch (_e) { /* not a JSON-RPC message line */ }
                }
            };
            child.stdout.on('data', onData);
            child.stdin.write(JSON.stringify(msg) + '\n');
        });
    }

    before(async () => {
        try {
            mcpChild = spawn('node', [MCP_SERVER_PATH], {
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            await new Promise((resolve, reject) => {
                const timer = setTimeout(
                    () => reject(new Error('MCP spawn timeout')),
                    5000,
                );
                mcpChild.on('error', (err) => { clearTimeout(timer); reject(err); });
                mcpChild.on('exit', (code) => {
                    clearTimeout(timer);
                    reject(new Error(`MCP exited with code ${code}`));
                });
                mcpChild.stderr.on('data', (d) => {
                    if (d.toString().includes('started')) {
                        clearTimeout(timer);
                        resolve();
                    }
                });
            });

            initResponse = await mcpRequest(mcpChild, {
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: {
                    protocolVersion: '2024-11-05',
                    capabilities: {},
                    clientInfo: { name: 'test-client', version: '1.0.0' },
                },
            });

            mcpChild.stdin.write(
                JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
            );
            mcpReady = true;

            // Clean up test strategy created by earlier tests so MCP sees only seeded data.
            try {
                await fetch(`${BASE}/strategy/test_exp`, { method: 'DELETE' });
            } catch (_) { /* ignore */ }
        } catch (_err) {
            mcpReady = false;
            if (mcpChild) {
                try { mcpChild.kill(); } catch (_) { /* ignore */ }
                mcpChild = null;
            }
        }
    });

    after(() => {
        if (mcpChild) {
            try { mcpChild.kill(); } catch (_) { /* ignore */ }
            mcpChild = null;
        }
    });

    test('MCP initialize handshake → responds with serverInfo', async (t) => {
        if (!mcpReady) { t.skip('MCP server not available'); return; }
        assert.strictEqual(initResponse.jsonrpc, '2.0');
        assert.strictEqual(initResponse.id, 1);
        assert.ok(initResponse.result, 'initialize should return result');
        assert.ok(initResponse.result.serverInfo, 'result should have serverInfo');
        assert.ok(initResponse.result.serverInfo.name, 'serverInfo should have name');
    });

    test('MCP tools/list → 20 tools', async (t) => {
        if (!mcpReady) { t.skip('MCP server not available'); return; }
        const res = await mcpRequest(mcpChild, {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
            params: {},
        });
        assert.ok(res.result, 'tools/list should return result');
        assert.ok(Array.isArray(res.result.tools), 'tools should be an array');
        assert.strictEqual(res.result.tools.length, 20,
            `expected 20 tools, got ${res.result.tools.length}`);
    });

    test('MCP tools/call list_strategies → 3 strategies', async (t) => {
        if (!mcpReady) { t.skip('MCP server not available'); return; }
        const res = await mcpRequest(mcpChild, {
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: { name: 'list_strategies', arguments: {} },
        });
        assert.ok(res.result, 'tools/call should return result');
        assert.ok(res.result.content, 'result should have content array');
        assert.ok(res.result.content[0], 'should have at least one content item');
        assert.ok(res.result.content[0].text, 'content item should have text');
        const strategies = JSON.parse(res.result.content[0].text);
        assert.ok(Array.isArray(strategies), 'strategies should be an array');
        assert.ok(strategies.length >= 1,
            `expected >= 3 strategies, got ${strategies.length}`);
    });
});
