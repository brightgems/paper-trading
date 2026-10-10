# Paper Trading MCP Server

MCP (Model Context Protocol) server for the multi-strategy paper trading tracker. Exposes 20 tools that AI agents can call to query strategy data, import signals and backtest results, trigger rebalances, and manage portfolio state.

## Architecture

```
AI Agent (Claude, Hermes, etc.)
    │  MCP Protocol (stdio)
    ▼
mcp/index.js  ──►  mcp/server.js  ──►  better-sqlite3 (sync)
                         │                  │
                         │                  ▼
                         │       server/data/strategies.db
                         │
                         └──► server/services/rebalanceEngine.js (for trigger_rebalance)
```

The MCP server reads/writes the **same SQLite database** as the Express backend (`server/data/strategies.db`). It uses the `better-sqlite3` sync API for all queries.

## Quick Start

```bash
cd mcp
npm install
node index.js
```

The server communicates over **stdio** — it reads MCP requests from stdin and writes responses to stdout. Logs go to stderr.

## Tools (20)

### Query Tools

| # | Tool | Params | Description |
|---|------|--------|-------------|
| 1 | `list_strategies` | — | All strategies with latest NAV |
| 2 | `get_strategy_detail` | `strategy_id` | Full config + holdings + recent tx + NAV |
| 3 | `get_nav_curve` | `strategy_id`, `start_date?`, `end_date?` | NAV time series |
| 4 | `get_holdings` | `strategy_id`, `trade_date?` | Holdings (latest or by date) |
| 5 | `get_transactions` | `strategy_id`, `start_date?`, `end_date?`, `limit?` | Transaction history |
| 6 | `get_strategy_compare` | — | Compare all active strategies |
| 16 | `get_backtest_comparison` | `strategy_id` | Backtest vs live performance delta |
| 18 | `get_engine_status` | — | Engine + all strategy summary |
| 20 | `get_positions_overview` | `strategy_id?` | Per-strategy holding summaries + aggregates |

### Mutation Tools

| # | Tool | Params | Description |
|---|------|--------|-------------|
| 7 | `create_strategy` | `id`, `name`, `description`, `initial_capital`, `signal_source`, `signal_config`, `rebalance_rule`, `stop_loss`, `take_profit`, `benchmark` | Create new strategy |
| 8 | `update_strategy` | `id` + any subset of create fields | Partial update |
| 19 | `delete_strategy` | `strategy_id` | Delete strategy + all related data (irreversible) |

### Import Tools

| # | Tool | Params | Description |
|---|------|--------|-------------|
| 9 | `import_signals` | `strategy_id`, `signals[]`, `signal_date` | Import signals from JSON array |
| 10 | `import_signals_from_csv` | `strategy_id`, `csv_path`, `signal_date?` | Import signals from CSV file |
| 11 | `import_backtest_result` | `strategy_id`, `start_date`, `end_date`, `initial_capital`, `final_value`, `annual_return`, `sharpe`, `max_drawdown`, `benchmark_return`, `excess_return`, `ir`, `equity_curve[]`, `monthly_returns[]`, `params` | Import single backtest result |
| 12 | `import_backtest_from_csv` | `strategy_id`, `csv_path` | Import backtest results from CSV |

### Action Tools

| # | Tool | Params | Description |
|---|------|--------|-------------|
| 13 | `trigger_rebalance` | `strategy_id`, `trade_date?` | Run rebalance for one strategy |
| 14 | `trigger_all_rebalance` | `trade_date?` | Run rebalance for all active strategies |
| 15 | `get_rebalance_preview` | `strategy_id`, `trade_date?` | Dry-run rebalance (no DB writes) |
| 17 | `update_nav_snapshot` | `strategy_id`, `trade_date` | Recalculate + upsert NAV snapshot |

## Tool Input Schemas

All tool inputs are validated using JSON Schema (via Zod, which the SDK compiles to JSON Schema for the MCP protocol). Each tool's `inputSchema` is auto-exposed in the MCP `tools/list` response.

## Hermes Configuration

Register this MCP server in `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  paper-trading:
    command: node
    args:
      - /git/paper-trading/mcp/index.js
    # Optional: environment variables
    env:
      NODE_PATH: /git/paper-trading/mcp/node_modules
```

After adding the config, restart Hermes. The 20 tools will be available as `paper-trading__list_strategies`, `paper-trading__get_strategy_detail`, etc.

### Claude Desktop Configuration

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "paper-trading": {
      "command": "node",
      "args": ["/git/paper-trading/mcp/index.js"]
    }
  }
}
```

## Usage Examples

### List all strategies

```json
{"tool": "list_strategies", "arguments": {}}
```

### Get strategy detail

```json
{"tool": "get_strategy_detail", "arguments": {"strategy_id": "hs300_top50"}}
```

### Import signals

```json
{
  "tool": "import_signals",
  "arguments": {
    "strategy_id": "hs300_top50",
    "signal_date": "2026-01-15",
    "signals": [
      {"symbol": "600519.SH", "name": "贵州茅台", "rank": 1, "score": 0.85, "close": 1680.0, "action": "buy", "weight": 0.1},
      {"symbol": "000858.SZ", "name": "五粮液", "rank": 2, "score": 0.72, "close": 150.0, "action": "buy", "weight": 0.1}
    ]
  }
}
```

### Create a new strategy

```json
{
  "tool": "create_strategy",
  "arguments": {
    "id": "momentum_top20",
    "name": "动量Top-20",
    "description": "全市场动量因子Top-20策略",
    "initial_capital": 1000000,
    "signal_source": "top10_csv",
    "signal_config": {"csv_path": "/git/quant_factors/results/momentum_top20.csv", "top_k": 20},
    "rebalance_rule": {"frequency": "weekly", "day": "monday", "max_trades": 5},
    "stop_loss": -7.0,
    "take_profit": 20.0,
    "benchmark": "000985.CSI"
  }
}
```

### Trigger rebalance

```json
{"tool": "trigger_rebalance", "arguments": {"strategy_id": "hs300_top50", "trade_date": "2026-01-15"}}
```

### Preview rebalance (dry run)

```json
{"tool": "get_rebalance_preview", "arguments": {"strategy_id": "hs300_top50"}}
```

## File Structure

```
mcp/
├── package.json     # Dependencies: @modelcontextprotocol/sdk, better-sqlite3, zod
├── index.js         # Entry point — creates StdioServerTransport and connects
├── server.js        # McpServer with 20 registered tools
└── README.md        # This file
```

## Database

The server uses the same SQLite database as the Express backend:

- **Path**: `server/data/strategies.db` (resolved via `path.join(__dirname, '..', 'server', 'data', 'strategies.db')`)
- **Tables**: `strategies`, `nav_snapshots`, `holdings`, `transactions`, `signals`, `backtest_results`
- **WAL mode** enabled for concurrent read access with the Express server

## Error Handling

All tools catch errors and return them as MCP error responses:

```json
{
  "content": [{"type": "text", "text": "Strategy not found: invalid_id"}],
  "isError": true
}
```

## Dependencies

- `@modelcontextprotocol/sdk` — MCP protocol implementation
- `better-sqlite3` — Synchronous SQLite driver (same as backend)
- `zod` — Schema validation (compiled to JSON Schema by the SDK)

## Notes

- `trigger_rebalance` and `trigger_all_rebalance` delegate to `server/services/rebalanceEngine.js`, which fetches real-time prices via the market data service. These tools are **async** and may take several seconds.
- `get_rebalance_preview` is a pure read-only dry run — it does NOT fetch live prices or write to the DB. It uses the latest stored prices from holdings.
- `delete_strategy` performs a cascading delete across all 5 related tables. This is irreversible.
