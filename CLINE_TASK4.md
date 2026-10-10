# Cline Task 4: Internal Scheduler + Unified Strategy Pipeline

## Project root
`/git/paper-trading`

## Read DESIGN_SCHEDULER.md in the project root first — it has the full architecture.

## Overview

Build an internal scheduler inside the Node.js app that:
1. At 09:25 on trading days: generates signals (calls Python script), executes rebalance
2. At 14:30 on trading days: checks stop-loss/take-profit, updates NAV snapshot
3. Each strategy carries its own `rebalance_rule` and `signal_config` in JSON columns
4. No external cron — uses `node-cron` (already installed)

## Files to create

### 1. `server/services/signalGenerator.js`

Unified signal generation interface:

```javascript
const { execFile } = require('child_process');
const fs = require('fs');
const { getDB } = require('../config/db');
const SignalLoader = require('./signalLoader');

class SignalGenerator {
    /**
     * Generate signals for a strategy based on its signal_config
     * @param {string} strategyId
     * @returns {Promise<{signals: Array, source: string, error?: string}>}
     */
    static async generate(strategyId) {
        const db = getDB();
        const strategy = db.prepare('SELECT signal_source, signal_config FROM strategies WHERE id = ?').get(strategyId);
        if (!strategy) throw new Error(`Strategy not found: ${strategyId}`);
        
        const config = JSON.parse(strategy.signal_config || '{}');
        const source = strategy.signal_source;
        
        if (source === 'none') {
            return { signals: [], source: 'none' };
        }
        
        if (source === 'top10_csv') {
            // Just read the CSV
            return await this._loadFromCsv(strategyId, config);
        }
        
        if (source === 'python_script') {
            // Run Python script, then read CSV
            return await this._runScriptAndLoad(strategyId, config);
        }
        
        return { signals: [], source: 'unknown', error: `Unknown signal source: ${source}` };
    }
    
    static async _loadFromCsv(strategyId, config) {
        // Use existing signalLoader logic
        const csvPath = config.csv_path || '/git/quant_factors/results/paper_top10.csv';
        // Call signalLoader.loadTop10CSV and insert into signals table
        // Return the loaded signals
        // ... implementation
    }
    
    static async _runScriptAndLoad(strategyId, config) {
        const scriptPath = config.script_path;
        const pythonBin = config.script_env?.PYTHON || 'python3';
        const workdir = config.script_env?.WORKDIR || '/git/quant_factors';
        const csvPath = config.csv_path;
        
        return new Promise((resolve) => {
            execFile(pythonBin, [scriptPath], {
                cwd: workdir,
                timeout: 120000,
                maxBuffer: 1024 * 1024 * 10,
                env: { ...process.env, ...config.script_env },
            }, (error, stdout, stderr) => {
                if (error) {
                    resolve({ signals: [], source: 'python_script', error: error.message, stderr });
                    return;
                }
                // Now read the CSV
                this._loadFromCsv(strategyId, config).then(result => {
                    resolve({ ...result, source: 'python_script', stdout, stderr });
                });
            });
        });
    }
}

module.exports = SignalGenerator;
```

### 2. `server/services/scheduler.js`

```javascript
const cron = require('node-cron');
const { getDB } = require('../config/db');
const SignalGenerator = require('./signalGenerator');
const { rebalance, updateNavSnapshot, checkStopLossTakeProfit } = require('./rebalanceEngine');

let morningTask = null;
let afternoonTask = null;
let running = false;

function isTradingDay(date = new Date()) {
    const day = date.getDay();
    // 0=Sunday, 6=Saturday
    if (day === 0 || day === 6) return false;
    // TODO: add holiday check (could use a holidays table or API)
    return true;
}

function shouldRebalanceToday(rule, date = new Date()) {
    const freq = rule.frequency;
    const dayOfWeek = date.getDay();
    
    if (freq === 'daily') return true;
    
    if (freq === 'weekly') {
        const dayMap = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
        const targetDay = dayMap[rule.day?.toLowerCase()] ?? 1;
        return dayOfWeek === targetDay;
    }
    
    if (freq === 'monthly') {
        const targetDate = rule.day || 1;
        return date.getDate() === targetDate;
    }
    
    return false;
}

async function runStrategyCycle(strategyId, options = {}) {
    const db = getDB();
    const strategy = db.prepare('SELECT * FROM strategies WHERE id = ? AND status = ?').get(strategyId, 'active');
    if (!strategy) return { strategyId, skipped: true, reason: 'not active' };
    
    const rule = JSON.parse(strategy.rebalance_rule || '{}');
    const config = JSON.parse(strategy.signal_config || '{}');
    const forceRebalance = options.forceRebalance || false;
    
    const result = { strategyId, rebalanced: false, trades: 0, nav: null, signalsGenerated: 0, error: null };
    
    try {
        // Step 1: Check if today is a rebalance day
        if (forceRebalance || shouldRebalanceToday(rule)) {
            // Step 2: Generate signals (if not buy-and-hold)
            if (strategy.signal_source !== 'none') {
                const sigResult = await SignalGenerator.generate(strategyId);
                result.signalsGenerated = sigResult.signals?.length || 0;
                if (sigResult.error) {
                    result.error = `Signal generation: ${sigResult.error}`;
                    // Continue with previous signals if available
                }
            }
            
            // Step 3: Execute rebalance
            const rebResult = await rebalance(strategyId, { forceRebalance: true });
            result.rebalanced = true;
            result.trades = rebResult.actions?.length || 0;
            result.nav = rebResult.nav;
        }
    } catch (e) {
        result.error = `Rebalance: ${e.message}`;
    }
    
    return result;
}

async function runAllStrategies() {
    if (running) return { skipped: true, reason: 'already running' };
    running = true;
    
    const db = getDB();
    const strategies = db.prepare('SELECT id FROM strategies WHERE status = ?').all('active');
    const results = [];
    
    for (const { id } of strategies) {
        try {
            const r = await runStrategyCycle(id);
            results.push(r);
        } catch (e) {
            results.push({ strategyId: id, error: e.message });
        }
    }
    
    running = false;
    return { results, timestamp: new Date().toISOString() };
}

async function runNavUpdate() {
    if (running) return { skipped: true, reason: 'already running' };
    running = true;
    
    const db = getDB();
    const strategies = db.prepare('SELECT id FROM strategies WHERE status = ?').all('active');
    const results = [];
    
    for (const { id } of strategies) {
        try {
            // Check stop-loss/take-profit first
            if (typeof checkStopLossTakeProfit === 'function') {
                await checkStopLossTakeProfit(id);
            }
            // Update NAV
            const navResult = await updateNavSnapshot(id);
            results.push({ strategyId: id, nav: navResult });
        } catch (e) {
            results.push({ strategyId: id, error: e.message });
        }
    }
    
    running = false;
    return { results, timestamp: new Date().toISOString() };
}

function start() {
    if (morningTask) return { alreadyRunning: true };
    
    // 09:25 every weekday — generate signals + rebalance
    morningTask = cron.schedule('25 9 * * 1-5', async () => {
        if (!isTradingDay()) return;
        console.log('[Scheduler] Morning run: 09:25');
        try {
            const r = await runAllStrategies();
            console.log('[Scheduler] Morning result:', JSON.stringify(r));
        } catch (e) {
            console.error('[Scheduler] Morning error:', e.message);
        }
    });
    
    // 14:30 every weekday — stop-loss/take-profit + NAV update
    afternoonTask = cron.schedule('30 14 * * 1-5', async () => {
        if (!isTradingDay()) return;
        console.log('[Scheduler] Afternoon run: 14:30');
        try {
            const r = await runNavUpdate();
            console.log('[Scheduler] Afternoon result:', JSON.stringify(r));
        } catch (e) {
            console.error('[Scheduler] Afternoon error:', e.message);
        }
    });
    
    console.log('[Scheduler] Started: morning 09:25, afternoon 14:30');
    return { started: true };
}

function stop() {
    if (morningTask) { morningTask.stop(); morningTask = null; }
    if (afternoonTask) { afternoonTask.stop(); afternoonTask = null; }
    console.log('[Scheduler] Stopped');
    return { stopped: true };
}

function getStatus() {
    return {
        running: morningTask !== null,
        morningTime: '09:25 CST (Mon-Fri)',
        afternoonTime: '14:30 CST (Mon-Fri)',
        isTradingDay: isTradingDay(),
        currentTime: new Date().toISOString(),
    };
}

module.exports = {
    start, stop, getStatus,
    runStrategyCycle, runAllStrategies, runNavUpdate,
    isTradingDay, shouldRebalanceToday,
};
```

## Files to modify

### 3. `server/services/rebalanceEngine.js`

Add two standalone exported functions (if they don't exist):

```javascript
// Export these functions if not already exported
async function checkStopLossTakeProfit(strategyId) {
    // Get current holdings
    // For each holding, check if current price triggers stop_loss or take_profit
    // If triggered, sell the position (T+1 rule: can sell any day)
    // Record transaction with reason='stop_loss' or reason='take_profit'
    // Return { actions: [], checked: n }
}

async function updateNavSnapshot(strategyId) {
    // Get current holdings
    // Fetch latest prices via marketData service
    // Calculate: total_assets = cash + sum(market_value)
    // Insert NAV snapshot
    // Return { total_assets, cash, market_value, position_ratio }
}

module.exports = {
    rebalance, rebalanceAll, getEngineStatus, seedStrategies, backfillNames,
    checkStopLossTakeProfit,    // ADD
    updateNavSnapshot,          // ADD (if not already exported)
};
```

### 4. `server/controllers/engineController.js`

Add scheduler endpoints:

```javascript
const scheduler = require('../services/scheduler');

// GET /api/strategy/engine/scheduler/status
exports.getSchedulerStatus = (req, res) => {
    res.json(scheduler.getStatus());
};

// POST /api/strategy/engine/scheduler/start
exports.startScheduler = (req, res) => {
    res.json(scheduler.start());
};

// POST /api/strategy/engine/scheduler/stop
exports.stopScheduler = (req, res) => {
    res.json(scheduler.stop());
};

// POST /api/strategy/engine/run/:strategyId
exports.runStrategyCycle = async (req, res) => {
    try {
        const result = await scheduler.runStrategyCycle(req.params.strategyId, { forceRebalance: true });
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// POST /api/strategy/engine/run-all
exports.runAllStrategies = async (req, res) => {
    try {
        const result = await scheduler.runAllStrategies();
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};
```

### 5. `server/routes/strategy.js`

Add routes BEFORE `/:strategyId`:

```javascript
router.get('/engine/scheduler/status', engineController.getSchedulerStatus);
router.post('/engine/scheduler/start', engineController.startScheduler);
router.post('/engine/scheduler/stop', engineController.stopScheduler);
router.post('/engine/run/:strategyId', engineController.runStrategyCycle);
router.post('/engine/run-all', engineController.runAllStrategies);
```

### 6. `server/index.js`

Start scheduler on app boot:

```javascript
const scheduler = require('./services/scheduler');
// After app.listen:
scheduler.start();
```

## Important notes

- `node-cron` is already installed
- The Python script for combo_6factor: path `/git/quant_factors/scripts/generate_top10_signal.py`, env PYTHON=`/miniconda3/envs/quant/bin/python3`, WORKDIR=`/git/quant_factors`, CSV output at `/git/quant_factors/results/paper_top10.csv`
- The combo_6factor strategy currently has `signal_source: 'top10_csv'` — change it to `'python_script'` and update `signal_config` to include `script_path`, `script_env`
- For `signal_source: 'none'` strategies (buy and hold), skip signal generation and rebalance — only update NAV
- All functions must handle errors gracefully — one strategy failing should not block others
- Use `console.log` for scheduler events (PM2 logs)
- The `checkStopLossTakeProfit` function must respect T+1: can sell any day, but buys only on rebalance days
- Run `node --test tests/*.test.js` from server dir after changes
- Run `node ./node_modules/vite/bin/vite.js build` from client dir — no frontend changes needed in this task
