# Paper Trading MCP Server — Design Spec

## Overview

A stdio-based MCP server that exposes 20 tools for managing multi-strategy paper trading.
Wraps the Express API at `/git/paper-trading/server/` using direct DB access (better-sqlite3 sync API)
and the rebalance engine. No HTTP calls — direct in-process calls to controllers/engine.

## Location

- Server code: `/git/paper-trading/mcp/index.js`
- Package: `/git/paper-trading/mcp/package.json` (already has @modelcontextprotocol/sdk installed)
- DB: `/git/paper-trading/server/config/db.js` → `getDB()` returns better-sqlite3 instance
- Engine: `/git/paper-trading/server/services/rebalanceEngine.js`
- Signal loader: `/git/paper-trading/server/services/signalLoader.js`

## Tech

- `@modelcontextprotocol/sdk` v1.32.1 (already in node_modules)
- ESM import: `import { Server } from '@modelcontextprotocol/sdk/server/index.js'`
- `import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'`
- Direct require() of better-sqlite3 and server modules (no HTTP)
- The rebalance engine's `rebalance()` and `rebalanceAll()` are async (they call marketData API),
  so tool handlers must be async.

## 20 Tools

### Query Tools (10)

#### 1. list_strategies
- **Params**: none
- **Returns**: Array of all strategies with latest NAV stats (total_assets, daily_return, cumulative_return, max_drawdown, sharpe, holding_count, last_trade_date)
- **Implementation**: Query strategies table + join latest nav_snapshots + count holdings

#### 2. get_strategy_detail
- **Params**: `{ strategy_id: string }`
- **Returns**: Single strategy record + signal_config/rebalance_rule parsed + summary { latestNav, holdingCount, transactionCount }

#### 3. get_nav_curve
- **Params**: `{ strategy_id: string, start_date?: string, end_date?: string, limit?: number }`
- **Returns**: Array of nav_snapshots ordered by trade_date ASC

#### 4. get_holdings
- **Params**: `{ strategy_id: string, date?: string }`
- **Returns**: Array of holdings (latest date or specified date), ordered by market_value DESC

#### 5. get_transactions
- **Params**: `{ strategy_id: string, start_date?: string, end_date?: string, limit?: number, side?: string }`
- **Returns**: Array of transactions ordered by trade_date DESC, default limit 200

#### 6. get_strategy_compare
- **Params**: `{ ids?: string }` — comma-separated strategy IDs, or empty for all active
- **Returns**: Array of comparison objects { id, name, totalAssets, cumulativeReturn, dailyReturn, maxDrawdown, sharpe, positionRatio, holdingCount, transactionCount, turnover, winRate, lastTradeDate }

#### 7. get_positions_overview
- **Params**: none
- **Returns**: All strategies' current holdings combined — [{ strategy_id, strategy_name, symbol, name, quantity, available_quantity, cost_price, current_price, market_value, profit_pct, weight }]

#### 8. get_engine_status
- **Params**: none
- **Returns**: { timestamp, strategyCount, strategies: [{ id, name, status, benchmark, totalAssets, cash, positionRatio, dailyReturn, cumulativeReturn, maxDrawdown, sharpe, holdingCount, lastTradeDate }] }

#### 9. get_backtest_comparison
- **Params**: `{ strategy_id: string }`
- **Returns**: { strategyId, strategyName, benchmark, live: { totalAssets, cumulativeReturn, annualReturn, sharpe, maxDrawdown, winRate, daysElapsed, startDate, endDate, equityCurve }, backtest: [...], delta: { annualReturn, sharpe, maxDrawdown, winRate } | null }

#### 10. get_rebalance_preview
- **Params**: `{ strategy_id: string }`
- **Returns**: Preview of what rebalance would do WITHOUT executing:
  - current holdings
  - latest signals
  - stocks to sell (not in signal list)
  - stocks to buy (in signal list, not held)
  - position discipline check (is Monday? position_ratio >= 0.80?)
  - estimated trades count
- **Implementation**: Load signals + get holdings, compute diff, return without writing to DB

### Update Tools (10)

#### 11. create_strategy
- **Params**: `{ id: string, name: string, description?: string, initial_capital?: number, signal_source?: string, signal_config?: object, rebalance_rule?: object, stop_loss?: number, take_profit?: number, benchmark?: string, status?: string }`
- **Returns**: { id, message: "Strategy created" }
- **Implementation**: INSERT into strategies + init NAV snapshot (cash = initial_capital)

#### 12. update_strategy
- **Params**: `{ strategy_id: string, name?: string, description?: string, initial_capital?: number, signal_source?: string, signal_config?: object, rebalance_rule?: object, stop_loss?: number, take_profit?: number, benchmark?: string, status?: string }`
- **Returns**: { id, message: "Strategy updated" }

#### 13. delete_strategy
- **Params**: `{ strategy_id: string }`
- **Returns**: { id, message: "Strategy and all related data deleted" }
- **Implementation**: DELETE from holdings, transactions, nav_snapshots, signals, backtest_results, strategies

#### 14. import_signals
- **Params**: `{ strategy_id: string, signals: array<{ symbol, name?, rank?, score?, close?, action?, weight? }> }`
- **Returns**: { strategy_id, imported: number }
- **Implementation**: INSERT OR REPLACE into signals table for each signal with today's date

#### 15. import_signals_from_csv
- **Params**: `{ strategy_id: string, csv_path?: string }` — defaults to /git/quant_factors/results/paper_top10.csv
- **Returns**: { strategy_id, imported: number, symbols: string[] }
- **Implementation**: Call signalLoader.loadTop10CSV(csv_path), then insert into signals table

#### 16. import_backtest_result
- **Params**: `{ strategy_id: string, start_date: string, end_date: string, initial_capital?: number, final_value?: number, annual_return?: number, sharpe?: number, max_drawdown?: number, calmar?: number, win_rate?: number, turnover?: number, benchmark_return?: number, excess_return?: number, ir?: number, hit_rate?: number, total_trades?: number, params?: object, equity_curve?: array, monthly_returns?: array }`
- **Returns**: { strategy_id, message: "Backtest result imported" }
- **Implementation**: INSERT into backtest_results with JSON.stringify for params/equity_curve/monthly_returns

#### 17. import_backtest_from_csv
- **Params**: `{ strategy_id: string, csv_path?: string }` — defaults to /git/quant_factors/results/backtest_results.csv
- **Returns**: { strategy_id, imported: number, columns: object }
- **Implementation**: Parse CSV, auto-detect columns, INSERT into backtest_results

#### 18. trigger_rebalance
- **Params**: `{ strategy_id: string, force?: boolean, date?: string }`
- **Returns**: { strategy_id, trade_date, actions: array, nav: object, stats: object }
- **Implementation**: Call rebalanceEngine.rebalance(strategy_id, { forceRebalance, date }) — ASYNC

#### 19. trigger_all_rebalance
- **Params**: `{ force?: boolean, date?: string }`
- **Returns**: { timestamp, total: number, results: array }
- **Implementation**: Call rebalanceEngine.rebalanceAll({ forceRebalance, date }) — ASYNC

#### 20. update_nav_snapshot
- **Params**: `{ strategy_id: string, date?: string }`
- **Returns**: { strategy_id, trade_date, nav: object }
- **Implementation**: Get latest holdings + prices (async marketData call), call rebalanceEngine.snapshotNAV().
  This updates NAV without executing any trades — just refreshes prices and recalculates.

## Server Structure (index.js)

```javascript
#!/usr/bin/env node
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

// ... tool definitions + handlers ...
```

## Key Implementation Notes

1. **ESM/CJS interop**: The MCP SDK is ESM. The server modules are CJS. Use `createRequire` to import CJS modules.
2. **Async tools**: `trigger_rebalance`, `trigger_all_rebalance`, `update_nav_snapshot` call async marketData API.
   Tool handlers must be async functions.
3. **DB access**: Direct `getDB()` calls — no HTTP. Same SQLite file, WAL mode, safe for concurrent reads.
4. **JSON columns**: signal_config, rebalance_rule, params, equity_curve, monthly_returns are JSON strings in DB.
   Use JSON.parse on read, JSON.stringify on write.
5. **Error handling**: Each tool handler wrapped in try/catch, returns `{ content: [{ type: "text", text: JSON.stringify({ error: message }) }] }` on failure.
6. **No auth**: All tools are open — this is a local MCP server for the AI agent.
7. **Seed on startup**: Call `rebalanceEngine.seedStrategies()` on server init to ensure 3 default strategies exist.

## Hermes config

Add to `~/.hermes/config.yaml`:
```yaml
mcp_servers:
  paper-trading:
    command: "node"
    args: ["/git/paper-trading/mcp/index.js"]
    timeout: 60
```

Tool names in Hermes will be prefixed: `mcp_paper_trading_list_strategies`, etc.
