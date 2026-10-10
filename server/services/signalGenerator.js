/**
 * Signal Generator
 *
 * Unified signal generation interface for all strategy types:
 *   - python_script: run Python script, then read output CSV
 *   - top10_csv:     read CSV directly
 *   - none:          no signals (buy-and-hold)
 *
 * Signals are persisted to the `signals` table for querying/display.
 */

const { execFile } = require('child_process');
const { getDB } = require('../config/db');
const { loadTop10CSV } = require('./signalLoader');

class SignalGenerator {
    /**
     * Generate signals for a strategy based on its signal_config.
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
            return await this._loadFromCsv(strategyId, config);
        }
        if (source === 'python_script') {
            return await this._runScriptAndLoad(strategyId, config);
        }
        return { signals: [], source: 'unknown', error: `Unknown signal source: ${source}` };
    }

    /**
     * Load signals from CSV (top10_csv or python_script output).
     * Persists to the signals table.
     */
    static async _loadFromCsv(strategyId, config) {
        const csvPath = config.csv_path || '/git/quant_factors/results/paper_top10.csv';
        let signals;
        try {
            signals = loadTop10CSV(csvPath);
        } catch (e) {
            return { signals: [], source: 'top10_csv', error: e.message };
        }
        this._persistSignals(strategyId, signals);
        return { signals, source: 'top10_csv' };
    }

    /**
     * Run Python script to generate signals, then load from CSV.
     * Uses execFile with timeout (120s) and env vars from signal_config.script_env.
     */
    static async _runScriptAndLoad(strategyId, config) {
        const scriptPath = config.script_path;
        const pythonBin = config.script_env?.PYTHON || 'python3';
        const workdir = config.script_env?.WORKDIR || '/git/quant_factors';

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
                this._loadFromCsv(strategyId, config).then(result => {
                    resolve({ ...result, source: 'python_script', stdout, stderr });
                });
            });
        });
    }

    /**
     * Persist signals to the signals table (upsert by strategy_id + signal_date + symbol).
     */
    static _persistSignals(strategyId, signals) {
        const db = getDB();
        const today = new Date().toISOString().slice(0, 10);
        const stmt = db.prepare(`
            INSERT INTO signals (strategy_id, signal_date, symbol, name, rank, score, close, action, weight)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(strategy_id, signal_date, symbol) DO UPDATE SET
                name=excluded.name, rank=excluded.rank, score=excluded.score,
                close=excluded.close, action=excluded.action, weight=excluded.weight
        `);
        const tx = db.transaction((sigs) => {
            for (const s of sigs) {
                stmt.run(strategyId, today, s.symbol, s.name || s.symbol,
                    s.rank, s.score, s.close, s.action || 'buy', s.weight);
            }
        });
        tx(signals);
    }
}

module.exports = SignalGenerator;
