# Cline Task 5: Per-Strategy Scheduling

## Project root
`/git/paper-trading`

## Goal

Replace the global fixed 09:25/14:30 scheduler with per-strategy scheduling. Each strategy carries its own `rebalance_time` and `review_time` in `rebalance_rule`. The scheduler runs a single loop every 5 minutes and executes any strategy whose scheduled time matches.

## File to modify: `server/services/scheduler.js`

### New `rebalance_rule` JSON schema (backward compatible — defaults apply if fields missing):

```json
{
  "frequency": "weekly",         // daily | weekly | monthly
  "day": "monday",              // weekly: monday-sunday | monthly: 1-28
  "max_trades": 5,
  "top_k": 10,
  "rebalance_time": "09:25",    // HH:MM — when to generate signals + rebalance
  "review_time": "14:30",       // HH:MM — when to check SL/TP + update NAV
  "review_daily": true          // if true, run review every trading day even if not rebalance day
}
```

Defaults (for existing strategies without these fields):
- `rebalance_time`: "09:25"
- `review_time`: "14:30"
- `review_daily`: true

### New scheduler logic:

Replace the two fixed cron tasks with a single 5-minute interval cron:

```javascript
// Run every 5 minutes on weekdays
cron.schedule('*/5 * * * 1-5', async () => {
    if (!isTradingDay()) return;
    
    const now = new Date();
    const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    
    const db = getDB();
    const strategies = db.prepare('SELECT id, rebalance_rule FROM strategies WHERE status = ?').all('active');
    
    for (const { id, rebalance_rule } of strategies) {
        const rule = JSON.parse(rebalance_rule || '{}');
        const rebalanceTime = rule.rebalance_time || '09:25';
        const reviewTime = rule.review_time || '14:30';
        const reviewDaily = rule.review_daily !== false; // default true
        
        // Check if it's rebalance time AND today is a rebalance day
        if (hhmm === rebalanceTime && shouldRebalanceToday(rule)) {
            console.log(`[Scheduler] Rebalance ${id} at ${hhmm}`);
            try {
                const r = await runStrategyCycle(id, { forceRebalance: true });
                console.log(`[Scheduler] ${id} result:`, JSON.stringify(r));
            } catch(e) {
                console.error(`[Scheduler] ${id} error:`, e.message);
            }
        }
        
        // Check if it's review time
        if (hhmm === reviewTime && (reviewDaily || shouldRebalanceToday(rule))) {
            console.log(`[Scheduler] Review ${id} at ${hhmm}`);
            try {
                if (typeof checkStopLossTakeProfit === 'function') await checkStopLossTakeProfit(id);
                const nav = await updateNavSnapshot(id);
                console.log(`[Scheduler] ${id} NAV:`, JSON.stringify(nav));
            } catch(e) {
                console.error(`[Scheduler] ${id} review error:`, e.message);
            }
        }
    }
});
```

### Keep existing exports

The `start()`, `stop()`, `getStatus()` functions stay the same. `runStrategyCycle()`, `runAllStrategies()`, `runNavUpdate()` stay for manual API triggers.

### Update `getStatus()` to show per-strategy schedule:

```javascript
function getStatus() {
    const db = getDB();
    const strategies = db.prepare('SELECT id, name, rebalance_rule FROM strategies WHERE status = ?').all('active');
    const schedule = strategies.map(s => {
        const rule = JSON.parse(s.rebalance_rule || '{}');
        return {
            id: s.id,
            name: s.name,
            rebalance_time: rule.rebalance_time || '09:25',
            review_time: rule.review_time || '14:30',
            frequency: rule.frequency || 'weekly',
            day: rule.day || 'monday',
            review_daily: rule.review_daily !== false,
        };
    });
    return {
        running: cronTask !== null,
        checkInterval: 'every 5 minutes (weekdays)',
        isTradingDay: isTradingDay(),
        currentTime: new Date().toISOString(),
        strategies: schedule,
    };
}
```

## File to modify: `server/controllers/engineController.js`

No changes needed — existing endpoints still work.

## File to modify: `server/routes/strategy.js`

No changes needed.

## Database update

Update combo_6factor strategy to include the new scheduling fields:

```sql
UPDATE strategies 
SET rebalance_rule = '{"frequency":"weekly","day":"monday","max_trades":5,"top_k":10,"rebalance_time":"09:25","review_time":"14:30","review_daily":true}'
WHERE id = 'combo_6factor';
```

## Tests

Update `tests/api.test.js` and `tests/api-expanded.test.js`:
- The scheduler status test should check for `strategies` array in the response
- Keep `DISABLE_SCHEDULER=true` env var for tests

Run `node --test tests/*.test.js` from server dir to verify.

## Constraints

- Only modify `server/services/scheduler.js` and update DB
- Keep all existing exports and API endpoints working
- Use single cron task (not multiple per-strategy crons) — simpler and more robust
- The 5-minute interval means execution happens within 5 min of the configured time — acceptable for paper trading
- Use a `running` flag to prevent overlapping runs
- Backward compatible: strategies without `rebalance_time`/`review_time` use defaults
