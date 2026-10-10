/**
 * Internal Scheduler — node-cron based.
 * Single 5-minute loop on weekdays. Each strategy carries its own
 * rebalance_time and review_time in rebalance_rule.
 * Started on boot unless DISABLE_SCHEDULER env var is set.
 */

const cron = require('node-cron');
const { getDB } = require('../config/db');
const SignalGenerator = require('./signalGenerator');
const { rebalance, updateNavSnapshot, checkStopLossTakeProfit } = require('./rebalanceEngine');

let cronTask = null;
let running = false;

function isTradingDay(date = new Date()) {
    const day = date.getDay();
    return day !== 0 && day !== 6;
}

function shouldRebalanceToday(rule, date = new Date()) {
    const freq = rule.frequency;
    const dow = date.getDay();
    if (freq === 'daily') return true;
    if (freq === 'weekly') {
        const map = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
        return dow === (map[rule.day?.toLowerCase()] ?? 1);
    }
    if (freq === 'monthly') return date.getDate() === (rule.day || 1);
    return false;
}

/**
 * Run a full strategy cycle: generate signals (if needed) + rebalance.
 * @param {string} strategyId
 * @param {Object} options — { forceRebalance: boolean }
 */
async function runStrategyCycle(strategyId, options = {}) {
    const db = getDB();
    const strategy = db.prepare('SELECT * FROM strategies WHERE id = ? AND status = ?').get(strategyId, 'active');
    if (!strategy) return { strategyId, skipped: true, reason: 'not active' };
    const rule = JSON.parse(strategy.rebalance_rule || '{}');
    const force = options.forceRebalance || false;
    const result = { strategyId, rebalanced: false, trades: 0, nav: null, signalsGenerated: 0, error: null };
    try {
        if (force || shouldRebalanceToday(rule)) {
            if (strategy.signal_source !== 'none') {
                const sig = await SignalGenerator.generate(strategyId);
                result.signalsGenerated = sig.signals?.length || 0;
                if (sig.error) result.error = `Signal: ${sig.error}`;
            }
            const reb = await rebalance(strategyId, { forceRebalance: true });
            result.rebalanced = true;
            result.trades = reb.actions?.length || 0;
            result.nav = reb.nav;
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
        try { results.push(await runStrategyCycle(id)); }
        catch (e) { results.push({ strategyId: id, error: e.message }); }
    }
    running = false;
    return { results, timestamp: new Date().toISOString() };
}

/**
 * Run stop-loss/take-profit check + NAV update for all active strategies.
 * Called at 14:30 on trading days.
 */
async function runNavUpdate() {
    if (running) return { skipped: true, reason: 'already running' };
    running = true;
    const db = getDB();
    const strategies = db.prepare('SELECT id FROM strategies WHERE status = ?').all('active');
    const results = [];
    for (const { id } of strategies) {
        try {
            if (typeof checkStopLossTakeProfit === 'function') await checkStopLossTakeProfit(id);
            results.push({ strategyId: id, nav: await updateNavSnapshot(id) });
        } catch (e) { results.push({ strategyId: id, error: e.message }); }
    }
    running = false;
    return { results, timestamp: new Date().toISOString() };
}

/**
 * Start the internal scheduler (singleton — no-op if already running).
 * Single 5-minute cron loop on weekdays. Each active strategy is checked
 * against its own rebalance_time / review_time in rebalance_rule.
 */
function start() {
    if (cronTask) return { alreadyRunning: true };
    cronTask = cron.schedule('*/5 * * * 1-5', async () => {
        if (running) return;                 // prevent overlapping runs
        if (!isTradingDay()) return;
        running = true;
        try {
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
                    } catch (e) {
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
                    } catch (e) {
                        console.error(`[Scheduler] ${id} review error:`, e.message);
                    }
                }
            }
        } catch (e) {
            console.error('[Scheduler] loop error:', e.message);
        } finally {
            running = false;
        }
    });
    console.log('[Scheduler] Started: every 5 minutes (weekdays)');
    return { started: true };
}

function stop() {
    if (cronTask) { cronTask.stop(); cronTask = null; }
    console.log('[Scheduler] Stopped');
    return { stopped: true };
}

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

module.exports = {
    start, stop, getStatus,
    runStrategyCycle, runAllStrategies, runNavUpdate,
    isTradingDay, shouldRebalanceToday,
};
