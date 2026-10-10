/**
 * API Test Suite — Paper Trading Simulator
 *
 * Uses Node's built-in test runner (node:test) and assert (node:assert).
 * No external test dependencies. Uses the built-in fetch() (Node 18+).
 *
 * Run from the server directory:
 *   node --test tests/api.test.js
 * or:
 *   bash tests/run.sh
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 5005;
const BASE = `http://localhost:${PORT}/api`;

let server;

// ─── Setup / Teardown ───────────────────────────────────────
before(async () => {
    // index.js calls app.listen(PORT) at module-load time.  We intercept
    // http.createServer (used internally by Express's app.listen) to capture
    // the server reference without calling app.listen a second time (which
    // would cause EADDRINUSE).  dotenv will not override already-set env vars.
    process.env.NODE_ENV = 'production';
    process.env.PORT = String(PORT);
    process.env.DISABLE_SCHEDULER = 'true';

    const http = require('node:http');
    const originalCreateServer = http.createServer;
    http.createServer = function (...args) {
        server = originalCreateServer.apply(http, args);
        http.createServer = originalCreateServer;   // restore immediately
        return server;
    };
    require('../index.js');

    // Wait for the captured server to finish binding.
    if (server && !server.listening) {
        await new Promise((resolve) => server.once('listening', resolve));
    }

    // Clean up any leftover test strategy from a prior failed run.
    try {
        await fetch(`${BASE}/strategy/test_c`, { method: 'DELETE' });
    } catch (_) { /* ignore — may not exist */ }
});

after(async () => {
    // Final cleanup of any test data we created.
    try {
        await fetch(`${BASE}/strategy/test_c`, { method: 'DELETE' });
    } catch (_) { /* ignore */ }
    try { require('../services/scheduler').stop(); } catch (_) { /* ignore */ }
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
});

// Helper for JSON-bodied requests
async function jsonReq(p, options = {}) {
    return fetch(`${BASE}${p}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
}

// ─── Test Group A: Strategy CRUD ────────────────────────────
describe('Strategy CRUD', () => {
    test('GET /strategy → 200, returns array, length >= 1', async () => {
        const res = await fetch(`${BASE}/strategy`);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.ok(Array.isArray(data), 'response should be an array');
        assert.ok(data.length >= 1, `expected >= 3 seeded strategies, got ${data.length}`);
    });

    test('GET /strategy/combo_6factor → 200, has id, name, summary object', async () => {
        const res = await fetch(`${BASE}/strategy/combo_6factor`);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.id, 'combo_6factor');
        assert.ok(typeof data.name === 'string' && data.name.length > 0);
        assert.ok(data.summary && typeof data.summary === 'object');
    });

    test('GET /strategy/nonexistent → 404', async () => {
        const res = await fetch(`${BASE}/strategy/nonexistent`);
        assert.equal(res.status, 404);
    });

    test('POST /strategy { id: "test_c" } → 201', async () => {
        const res = await jsonReq(`/strategy`, {
            method: 'POST',
            body: JSON.stringify({ id: 'test_c', name: 'Test C', initial_capital: 500000 }),
        });
        assert.equal(res.status, 201);
    });

    test('PUT /strategy/test_c { name: "Test C Updated" } → 200', async () => {
        const res = await jsonReq(`/strategy/test_c`, {
            method: 'PUT',
            body: JSON.stringify({ name: 'Test C Updated' }),
        });
        assert.equal(res.status, 200);
    });

    test('DELETE /strategy/test_c → 200', async () => {
        const res = await fetch(`${BASE}/strategy/test_c`, { method: 'DELETE' });
        assert.equal(res.status, 200);
    });

    test('GET /strategy/test_c after delete → 404', async () => {
        const res = await fetch(`${BASE}/strategy/test_c`);
        assert.equal(res.status, 404);
    });
});

// ─── Test Group B: Portfolio Data ───────────────────────────
describe('Portfolio Data', () => {
    test('GET /strategy/combo_6factor/holdings → 200, returns array', async () => {
        const res = await fetch(`${BASE}/strategy/combo_6factor/holdings`);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.ok(Array.isArray(data));
    });

    test('GET /strategy/combo_6factor/nav → 200, returns array, length >= 1', async () => {
        const res = await fetch(`${BASE}/strategy/combo_6factor/nav`);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.ok(Array.isArray(data));
        assert.ok(data.length >= 1, `expected >= 1 nav snapshot, got ${data.length}`);
    });

    test('GET /strategy/combo_6factor/transactions → 200, returns array', async () => {
        const res = await fetch(`${BASE}/strategy/combo_6factor/transactions`);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.ok(Array.isArray(data));
    });

    test('GET /strategy/combo_6factor/signals → 200, returns array', async () => {
        const res = await fetch(`${BASE}/strategy/combo_6factor/signals`);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.ok(Array.isArray(data));
    });

    test('GET /strategy/combo_6factor/dashboard → 200, has id, latestNav, equityCurve', async () => {
        const res = await fetch(`${BASE}/strategy/combo_6factor/dashboard`);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.id, 'combo_6factor');
        assert.ok('latestNav' in data, 'dashboard should have latestNav');
        assert.ok(Array.isArray(data.equityCurve), 'dashboard should have equityCurve array');
    });

    test('GET /strategy/combo_6factor/backtest → 200, returns array', async () => {
        const res = await fetch(`${BASE}/strategy/combo_6factor/backtest`);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.ok(Array.isArray(data));
    });

    test('GET /strategy/combo_6factor/backtest-comparison → 200, has live object', async () => {
        const res = await fetch(`${BASE}/strategy/combo_6factor/backtest-comparison`);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.ok(data.live && typeof data.live === 'object', 'should have live object');
    });
});

// ─── Test Group C: Engine & Compare ─────────────────────────
describe('Engine & Compare', () => {
    test('GET /strategy/engine/status → 200, has strategyCount and strategies array', async () => {
        const res = await fetch(`${BASE}/strategy/engine/status`);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.ok(typeof data.strategyCount === 'number');
        assert.ok(Array.isArray(data.strategies));
    });

    test('GET /strategy/compare/all → 200, returns array, length >= 1', async () => {
        const res = await fetch(`${BASE}/strategy/compare/all`);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.ok(Array.isArray(data));
        assert.ok(data.length >= 1, `expected >= 3 strategies, got ${data.length}`);
    });

    test('GET /strategy/engine/scheduler/status → 200, has running field and strategies array', async () => {
        const res = await fetch(`${BASE}/strategy/engine/scheduler/status`);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.ok('running' in data, 'should have running field');
        assert.ok(Array.isArray(data.strategies), 'should have strategies array');
    });
});

// ─── Test Group D: Market Data (read-only trade routes) ─────
describe('Market Data', () => {
    test('GET /trade/indices → 200, returns array', async () => {
        const res = await fetch(`${BASE}/trade/indices`);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.ok(Array.isArray(data));
    });
});

// ─── Test Group E: API path consistency ─────────────────────
// Verify frontend api.js paths match backend routes.
describe('API path consistency (frontend api.js vs backend routes)', () => {
    const apiPath = path.join(__dirname, '..', '..', 'client', 'src', 'services', 'api.js');
    let apiSrc;

    before(() => {
        apiSrc = fs.readFileSync(apiPath, 'utf8');
    });

    test('compareStrategies() calls /strategy/compare/all (not /strategy/compare)', async () => {
        assert.ok(
            apiSrc.includes("api.get('/strategy/compare/all')"),
            'api.js should call /strategy/compare/all'
        );
        assert.ok(
            !/api\.get\(['"]\/strategy\/compare['"]\)/.test(apiSrc),
            'api.js should NOT call bare /strategy/compare'
        );
    });

    test('triggerRebalance(id) calls /strategy/engine/rebalance/${id} (not /engine/rebalance/${id})', async () => {
        assert.ok(
            apiSrc.includes('/strategy/engine/rebalance/'),
            'api.js should call /strategy/engine/rebalance/${id}'
        );
        assert.ok(
            !/api\.post\(['"]\/engine\/rebalance\//.test(apiSrc),
            'api.js should NOT call bare /engine/rebalance/${id}'
        );
    });

    test('getEngineStatus() calls /strategy/engine/status (not /engine/status)', async () => {
        assert.ok(
            apiSrc.includes("api.get('/strategy/engine/status')"),
            'api.js should call /strategy/engine/status'
        );
        assert.ok(
            !/api\.get\(['"]\/engine\/status['"]\)/.test(apiSrc),
            'api.js should NOT call bare /engine/status'
        );
    });
});
