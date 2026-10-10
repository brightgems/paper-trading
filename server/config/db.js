const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'strategies.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

let db;

function getDB() {
    if (!db) {
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        initSchema(db);
    }
    return db;
}

function initSchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS strategies (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            initial_capital REAL NOT NULL DEFAULT 1000000,
            signal_source TEXT NOT NULL DEFAULT 'top10_csv',
            signal_config TEXT DEFAULT '{}',
            rebalance_rule TEXT DEFAULT '{}',
            stop_loss REAL DEFAULT -5.0,
            take_profit REAL DEFAULT 15.0,
            benchmark TEXT DEFAULT '000300.SH',
            status TEXT DEFAULT 'active',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS nav_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            strategy_id TEXT NOT NULL,
            trade_date TEXT NOT NULL,
            total_assets REAL DEFAULT 0,
            cash REAL DEFAULT 0,
            market_value REAL DEFAULT 0,
            position_ratio REAL DEFAULT 0,
            daily_return REAL DEFAULT 0,
            cumulative_return REAL DEFAULT 0,
            benchmark_return REAL DEFAULT 0,
            excess_return REAL DEFAULT 0,
            max_drawdown REAL DEFAULT 0,
            sharpe REAL DEFAULT 0,
            FOREIGN KEY (strategy_id) REFERENCES strategies(id),
            UNIQUE(strategy_id, trade_date)
        );

        CREATE TABLE IF NOT EXISTS holdings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            strategy_id TEXT NOT NULL,
            trade_date TEXT NOT NULL,
            symbol TEXT NOT NULL,
            name TEXT DEFAULT '',
            quantity INTEGER DEFAULT 0,
            available_quantity INTEGER DEFAULT 0,
            cost_price REAL DEFAULT 0,
            current_price REAL DEFAULT 0,
            market_value REAL DEFAULT 0,
            profit_pct REAL DEFAULT 0,
            weight REAL DEFAULT 0,
            FOREIGN KEY (strategy_id) REFERENCES strategies(id)
        );
        CREATE INDEX IF NOT EXISTS idx_holdings_strategy_date ON holdings(strategy_id, trade_date);

        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            strategy_id TEXT NOT NULL,
            trade_date TEXT NOT NULL,
            symbol TEXT NOT NULL,
            name TEXT DEFAULT '',
            side TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            price REAL NOT NULL,
            amount REAL NOT NULL,
            commission REAL DEFAULT 0,
            stamp_tax REAL DEFAULT 0,
            transfer_fee REAL DEFAULT 0,
            reason TEXT DEFAULT 'rebalance',
            signal_rank INTEGER,
            FOREIGN KEY (strategy_id) REFERENCES strategies(id)
        );
        CREATE INDEX IF NOT EXISTS idx_tx_strategy_date ON transactions(strategy_id, trade_date);

        CREATE TABLE IF NOT EXISTS signals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            strategy_id TEXT NOT NULL,
            signal_date TEXT NOT NULL,
            symbol TEXT NOT NULL,
            name TEXT DEFAULT '',
            rank INTEGER,
            score REAL DEFAULT 0,
            close REAL DEFAULT 0,
            action TEXT DEFAULT 'buy',
            weight REAL,
            UNIQUE(strategy_id, signal_date, symbol)
        );
        CREATE INDEX IF NOT EXISTS idx_signals_strategy_date ON signals(strategy_id, signal_date);

        -- 回测结果：用于和模拟盘对比
        CREATE TABLE IF NOT EXISTS backtest_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            strategy_id TEXT NOT NULL,
            backtest_date TEXT NOT NULL,          -- 回测执行日期
            start_date TEXT NOT NULL,              -- 回测起始日
            end_date TEXT NOT NULL,                -- 回测结束日
            initial_capital REAL,
            final_value REAL,
            annual_return REAL,                    -- 年化收益
            sharpe REAL,
            max_drawdown REAL,
            calmar REAL,
            win_rate REAL,
            turnover REAL,                         -- 年换手率
            benchmark_return REAL,                 -- 基准年化
            excess_return REAL,                    -- 超额年化
            ir REAL,                               -- 信息比率
            hit_rate REAL,                         -- 调仓胜率
            total_trades INTEGER,
            params TEXT DEFAULT '{}',              -- 回测参数 JSON
            equity_curve TEXT,                     -- 净值曲线 JSON [{date, value, benchmark}]
            monthly_returns TEXT,                  -- 月度收益 JSON [{month, return}]
            FOREIGN KEY (strategy_id) REFERENCES strategies(id)
        );
        CREATE INDEX IF NOT EXISTS idx_bt_strategy ON backtest_results(strategy_id, backtest_date);
    `);
}

module.exports = { getDB };
