# Paper Trading: Unified Strategy Engine Design

## Goal

Build an internal scheduler + unified strategy execution pipeline inside the paper-trading Node.js app. No external cron. Each strategy carries its own rebalance config (frequency, max trades, top_k) and signal generation config. The system auto-generates signals, scores/ranks stocks, executes rebalances, and records all transactions.

## Current State

- `rebalanceEngine.js` reads signals from CSV, executes trades with A-share rules, updates holdings/transactions/NAV
- `signalLoader.js` loads signals from 3 sources: top10_csv, quantdb_factor, backtest_import
- Signal generation is external: `generate_top10_signal.py` in `/git/quant_factors/scripts/`
- No internal scheduler — rebalance only triggered via API call

## Architecture

### 1. Strategy Config (DB schema, already exists)

`strategies` table has two JSON columns:

#### `rebalance_rule` (JSON)
```json
{
  "frequency": "weekly",       // daily | weekly | monthly
  "day": "monday",             // for weekly: monday/tuesday/... | for monthly: 1-28
  "max_trades": 5,             // max stocks to trade per rebalance
  "rebalance_time": "14:30",   // execute at this time
  "top_k": 10                  // how many stocks to hold
}
```

#### `signal_config` (JSON)
```json
{
  "signal_source": "top10_csv",     // top10_csv | python_script | none
  "csv_path": "/git/quant_factors/results/paper_top10.csv",
  "script_path": "/git/quant_factors/scripts/generate_top10_signal.py",
  "script_env": {                   // env vars for the script
    "PYTHON": "/miniconda3/envs/quant/bin/python3",
    "WORKDIR": "/git/quant_factors"
  },
  "factors": [                       // for documentation/display
    "flow_order_duration_p90",
    "micro_vpin_amount_ratio",
    "rd_factor",
    "micro_liquidity_holden",
    "vol_turnover_concentration",
    "fun_bp"
  ]
}
```

### 2. Internal Scheduler (`server/services/scheduler.js`)

Uses `node-cron` (npm package) to run a daily check.

```
Cron: every day at 09:25 (before market open)
  → For each active strategy:
    → Check if today matches rebalance_rule (frequency + day)
    → If yes:
      → Step 1: Generate signals (call signal generator)
      → Step 2: Execute rebalance (call rebalanceEngine)
    → If no:
      → Skip (stop_loss/take_profit checked separately via daily NAV update)

Cron: every day at 14:30 (before close)
  → For each active strategy:
    → Execute stop_loss/take_profit checks (always runs)
    → Update NAV snapshot
```

### 3. Signal Generation Pipeline (`server/services/signalGenerator.js`)

Unified interface: `generateSignals(strategyId) → Signal[]`

#### Source: `python_script`
1. Read `signal_config.script_path` and `signal_config.script_env`
2. Spawn child process: `PYTHON script_path` with env vars, cwd = WORKDIR
3. Wait for completion (timeout: 120s)
4. Read output CSV at `signal_config.csv_path`
5. Parse into Signal objects: { symbol, rank, score, close, action, weight }
6. Insert into `signals` table

#### Source: `top10_csv`
1. Read CSV at `signal_config.csv_path`
2. Parse into signals (existing signalLoader logic)

#### Source: `none`
- No signal generation (buy and hold strategy)
- Rebalance engine skips buy/sell steps

### 4. Unified Execution Pipeline

```
runStrategyCycle(strategyId):
  1. strategy = getStrategy(strategyId)
  2. rule = JSON.parse(strategy.rebalance_rule)
  3. config = JSON.parse(strategy.signal_config)
  
  4. if shouldRebalanceToday(rule, today):
     a. signals = signalGenerator.generateSignals(strategyId, config)
     b. rebalanceEngine.rebalance(strategyId, { forceRebalance: true })
     c. log: "Rebalanced {strategyId}: {n} trades executed"
  
  5. always:
     a. rebalanceEngine.checkStopLossTakeProfit(strategyId)  // T+1 sells only
     b. rebalanceEngine.updateNavSnapshot(strategyId)         // fetch latest prices, calc NAV
  
  6. return { strategyId, rebalanced, trades, nav }
```

### 5. Scheduler API (engineController)

```
GET  /api/strategy/engine/status          → scheduler status, next run time
POST /api/strategy/engine/scheduler/start  → start internal scheduler
POST /api/strategy/engine/scheduler/stop   → stop scheduler
POST /api/strategy/engine/run/{strategyId} → manually trigger strategy cycle
POST /api/strategy/engine/run-all          → trigger all strategies
```

### 6. Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `server/services/signalGenerator.js` | CREATE | Unified signal generation: python_script, csv, none |
| `server/services/scheduler.js` | CREATE | Internal node-cron scheduler |
| `server/services/rebalanceEngine.js` | MODIFY | Add `checkStopLossTakeProfit()`, `updateNavSnapshot()` as standalone exports |
| `server/controllers/engineController.js` | MODIFY | Add scheduler start/stop/run endpoints |
| `server/routes/strategy.js` | MODIFY | Add scheduler routes |
| `server/index.js` | MODIFY | Start scheduler on app boot |
| `server/package.json` | MODIFY | Add `node-cron` dependency |

### 7. Dependencies

```bash
npm install node-cron
```

### 8. Rebalance Rule Matching Logic

```javascript
function shouldRebalanceToday(rule, date) {
    const freq = rule.frequency;
    const today = new Date(date);
    const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon, ...
    
    if (freq === 'daily') return true;
    
    if (freq === 'weekly') {
        const dayMap = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
        const targetDay = dayMap[rule.day?.toLowerCase()] ?? 1;
        return dayOfWeek === targetDay;
    }
    
    if (freq === 'monthly') {
        const targetDate = rule.day || 1;
        return today.getDate() === targetDate;
    }
    
    return false;
}
```

### 9. Execution Flow Diagram

```
[Scheduler 09:25]
    │
    ├── Strategy A (weekly, monday, top10_csv)
    │   ├── generateSignals() → read CSV → insert signals
    │   ├── rebalance() → sell not-in-signal, buy new signals
    │   └── updateNavSnapshot()
    │
    ├── Strategy B (daily, python_script)
    │   ├── generateSignals() → run Python script → read CSV → insert signals
    │   ├── rebalance() → sell not-in-signal, buy new signals
    │   └── updateNavSnapshot()
    │
    └── Strategy C (none, buy-and-hold)
        └── updateNavSnapshot() only

[Scheduler 14:30]
    │
    └── For all strategies:
        ├── checkStopLossTakeProfit() → sell if SL/TP hit
        └── updateNavSnapshot()
```

### 10. Error Handling

- Python script timeout (120s) → log error, skip rebalance, use previous signals
- Market data API failure → skip NAV update, log error
- Signal CSV not found → log error, skip rebalance
- DB write failure → log error, don't update state
- All errors logged to console + stored in `scheduler_log` table (optional)

## Implementation Notes

- `node-cron` uses 6-field cron expressions: `second minute hour day month dayOfWeek`
- Scheduler should be a singleton, started once on app boot
- Each strategy cycle runs sequentially (not parallel) to avoid DB contention
- Python script execution: use `child_process.execFile` with timeout
- Signal CSV path is read from `signal_config.csv_path` — the Python script must output to this path
