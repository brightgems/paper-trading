/**
 * Signal Loader
 * Loads trading signals from three sources:
 *   1. top10_csv      — read /git/quant_factors/results/paper_top10.csv
 *   2. quantdb_factor — read factor parquet from quantdb, IC-weighted scoring, top-K
 *   3. backtest_import — import historical signal series from a backtest CSV
 */

const fs = require('fs');
const path = require('path');

const CSV_PATH = '/git/quant_factors/results/paper_top10.csv';
const BACKTEST_DIR = '/git/quant_factors/results';

// ─── helpers ────────────────────────────────────────────────

function parseCSVLine(line) {
    // Minimal CSV parser — handles quoted fields with commas
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

function parseCSVFile(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`CSV file not found: ${filePath}`);
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n').filter(l => l.trim());
    if (lines.length < 2) return { headers: [], rows: [] };
    const headers = parseCSVLine(lines[0]);
    const rows = lines.slice(1).map(line => {
        const vals = parseCSVLine(line);
        const obj = {};
        headers.forEach((h, i) => { obj[h] = vals[i] !== undefined ? vals[i] : ''; });
        return obj;
    });
    return { headers, rows };
}

// ─── top10_csv ──────────────────────────────────────────────

/**
 * Load signals from paper_top10.csv
 * Expected columns: symbol, close, rank  (date column optional)
 * @returns {Array<{symbol, name, rank, score, close, action, weight}>}
 */
function loadTop10CSV(csvPath = CSV_PATH) {
    const { rows } = parseCSVFile(csvPath);
    const signals = rows.map((row, idx) => {
        const symbol = (row.symbol || '').trim();
        if (!symbol) return null;
        const rank = parseInt(row.rank) || (idx + 1);
        const close = parseFloat(row.close) || 0;
        // Equal weight for top-10
        const weight = 1 / rows.filter(r => r.symbol).length;
        return {
            symbol,
            name: row.name || row.symbol || symbol,
            rank,
            score: 1 / rank,          // inverse rank as score
            close,
            action: 'buy',
            weight: parseFloat(weight.toFixed(4)),
        };
    }).filter(Boolean);
    return signals;
}

// ─── quantdb_factor ─────────────────────────────────────────

/**
 * Load signals from quantdb parquet via Python subprocess.
 * Expects signal_config: { parquet_path, factor_cols[], ic_weights{}, top_k }
 * Falls back to top10_csv if parquet unavailable.
 * @returns {Array<{symbol, name, rank, score, close, action, weight}>}
 */
function loadQuantdbFactor(signalConfig = {}) {
    const { parquet_path, factor_cols = [], ic_weights = {}, top_k = 10 } = signalConfig;
    if (!parquet_path || !fs.existsSync(parquet_path)) {
        console.warn('[signalLoader] parquet_path missing or not found, falling back to top10_csv');
        return loadTop10CSV();
    }

    // Build a Python script that reads parquet and outputs JSON
    const colList = factor_cols.length ? factor_cols : [];
    const weightDict = JSON.stringify(ic_weights);
    const pyScript = `
import json, sys
try:
    import pandas as pd
    df = pd.read_parquet('${parquet_path.replace(/'/g, "\\'")}')
    cols = ${JSON.stringify(colList)}
    weights = json.loads('${weightDict.replace(/'/g, "\\'")}')
    if not cols:
        cols = [c for c in df.columns if c not in ('symbol','date','close')]
    # IC-weighted score
    score = pd.Series(0.0, index=df.index)
    for c in cols:
        w = weights.get(c, 1.0 / max(len(cols), 1))
        score += df[c].fillna(0) * w
    df['score'] = score
    # Rank descending
    df = df.sort_values('score', ascending=False).head(${top_k})
    results = []
    for i, (_, row) in enumerate(df.iterrows()):
        results.append({
            'symbol': str(row.get('symbol', '')),
            'name': str(row.get('name', row.get('symbol', ''))),
            'rank': i + 1,
            'score': float(row['score']),
            'close': float(row.get('close', 0)),
            'action': 'buy',
            'weight': float(1.0 / ${top_k})
        })
    print(json.dumps(results))
except Exception as e:
    print(json.dumps({'error': str(e)}))
`;

    try {
        const { execSync } = require('child_process');
        const output = execSync(`python3 -c "${pyScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
            timeout: 30000,
            encoding: 'utf-8',
        });
        const parsed = JSON.parse(output.trim());
        if (parsed.error) {
            console.warn(`[signalLoader] Python error: ${parsed.error}, falling back to top10_csv`);
            return loadTop10CSV();
        }
        return parsed;
    } catch (e) {
        console.warn(`[signalLoader] quantdb load failed: ${e.message}, falling back to top10_csv`);
        return loadTop10CSV();
    }
}

// ─── backtest_import ────────────────────────────────────────

/**
 * Import historical signal series from a backtest CSV.
 * Expected: a CSV with columns including date, symbol (and optionally rank/score/close).
 * Returns { date → [signals] } map for replay.
 *
 * @param {string} csvPath — path to the backtest CSV
 * @returns {Object<string, Array>} — { 'YYYY-MM-DD': [{symbol, rank, ...}] }
 */
function loadBacktestImport(csvPath) {
    if (!csvPath) {
        // Auto-detect from BACKTEST_DIR
        const candidate = path.join(BACKTEST_DIR, 'backtest_results.csv');
        if (fs.existsSync(candidate)) csvPath = candidate;
        else throw new Error('No backtest CSV path provided and auto-detect failed');
    }
    const { headers, rows } = parseCSVFile(csvPath);

    // Find date column (flexible naming)
    const dateCol = headers.find(h => /date|日期|trade_date/i.test(h));
    const symCol = headers.find(h => /symbol|code|stock|股票/i.test(h));
    const rankCol = headers.find(h => /rank/i.test(h));
    const closeCol = headers.find(h => /close|price/i.test(h));

    if (!dateCol || !symCol) {
        throw new Error(`Backtest CSV must have date and symbol columns. Found headers: ${headers.join(', ')}`);
    }

    const byDate = {};
    for (const row of rows) {
        const date = (row[dateCol] || '').trim();
        const symbol = (row[symCol] || '').trim();
        if (!date || !symbol) continue;

        if (!byDate[date]) byDate[date] = [];
        byDate[date].push({
            symbol,
            name: symbol,
            rank: rankCol ? parseInt(row[rankCol]) || (byDate[date].length + 1) : (byDate[date].length + 1),
            score: 0,
            close: closeCol ? parseFloat(row[closeCol]) || 0 : 0,
            action: 'buy',
            weight: 0.1,
        });
    }

    // Sort each date's signals by rank
    for (const date of Object.keys(byDate)) {
        byDate[date].sort((a, b) => a.rank - b.rank);
        const n = byDate[date].length;
        byDate[date].forEach((s, i) => {
            s.weight = parseFloat((1 / n).toFixed(4));
        });
    }

    return byDate;
}

// ─── dispatcher ─────────────────────────────────────────────

/**
 * Load signals based on strategy's signal_source and signal_config.
 * @param {string} source — 'top10_csv' | 'quantdb_factor' | 'backtest_import' | 'none'
 * @param {Object} config — signal_config JSON
 * @returns {Array|Object} — signal array (for top10_csv/quantdb_factor) or date→signals map (for backtest_import)
 */
function loadSignals(source, config = {}) {
    switch (source) {
        case 'top10_csv':
            return loadTop10CSV(config.csv_path || CSV_PATH);
        case 'quantdb_factor':
            return loadQuantdbFactor(config);
        case 'backtest_import':
            return loadBacktestImport(config.csv_path);
        case 'none':
            return [];
        default:
            console.warn(`[signalLoader] Unknown signal_source: ${source}, returning empty`);
            return [];
    }
}

module.exports = {
    loadSignals,
    loadTop10CSV,
    loadQuantdbFactor,
    loadBacktestImport,
    parseCSVFile,
    CSV_PATH,
    BACKTEST_DIR,
};
