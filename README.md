# Paper Trading Simulator

Multi-strategy A-share paper trading simulator with automated rebalance engine, signal-driven portfolio management, and MCP tools for AI-driven strategy validation.

## Overview

A paper trading system for validating quantitative strategies before live deployment. Supports multiple strategies running in parallel with A-share market rules (T+1 settlement, 100-share lot size, commission/stamp tax/transfer fee), automated rebalance with position discipline controls, stop-loss/take-profit monitoring, and NAV tracking with Sharpe ratio and max-drawdown calculation.

Includes an MCP server exposing 20 tools for AI agents to create strategies, import signals, trigger rebalances, and query portfolio performance — enabling a research-to-sim-to-live workflow directly from chat.

## Architecture

```
paper-trading-simulator/
├── server/                    # Node.js Express backend
│   ├── config/db.js           # SQLite schema (better-sqlite3)
│   ├── controllers/
│   │   ├── strategyController.js    # Strategy CRUD
│   │   ├── portfolioController.js   # Holdings, NAV, transactions, backtest
│   │   └── engineController.js      # Rebalance trigger, engine status
│   ├── services/
│   │   ├── rebalanceEngine.js       # Core engine: signals → SL/TP → rebalance → NAV
│   │   ├── signalLoader.js          # CSV/parquet/backtest signal loading
│   │   └── marketData.js            # 东方财富 real-time price API
│   ├── routes/strategy.js           # All API routes
│   └── tests/api.test.js            # 20 test cases (node:test)
├── client/                   # React + Vite frontend
│   └── src/
│       ├── pages/            # StrategyOverview, Detail, Compare, Config, etc.
│       ├── components/       # Navbar, UI helpers, dark theme
│       └── services/api.js   # Axios API client
└── mcp/                      # MCP server (20 tools for AI agents)
    ├── index.js              # ESM MCP server
    └── DESIGN.md             # Tool specifications
```

## Features

- **Multi-strategy tracking** — Run multiple strategies in parallel with independent capital, signals, and NAV
- **A-share rules** — T+1 settlement, 100-share lot size, commission (0.025%, min ¥5), stamp tax (0.1% sell only), transfer fee (0.002% SH only)
- **Automated rebalance** — Signal-driven rebalance with position discipline (≥80% position: Monday only, max 5 trades)
- **Stop loss / take profit** — Always monitored, auto-sells when triggered
- **NAV calculation** — Daily return, cumulative return, max drawdown (running), annualized Sharpe ratio
- **Signal sources** — CSV (top10), quantdb parquet (IC-weighted), backtest import
- **Backtest comparison** — Import backtest results, compare live vs backtest metrics
- **MCP tools** — 20 tools for AI agents to manage everything from chat
- **No auth** — Read-only tracking dashboard, no manual trading

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/strategy` | List all strategies |
| POST | `/api/strategy` | Create strategy |
| GET | `/api/strategy/:id` | Get strategy detail |
| PUT | `/api/strategy/:id` | Update strategy |
| DELETE | `/api/strategy/:id` | Delete strategy |
| GET | `/api/strategy/:id/holdings` | Current holdings |
| GET | `/api/strategy/:id/nav` | NAV snapshots |
| GET | `/api/strategy/:id/transactions` | Transaction history |
| GET | `/api/strategy/:id/signals` | Latest signals |
| GET | `/api/strategy/:id/dashboard` | Full dashboard |
| GET | `/api/strategy/:id/backtest` | Backtest results |
| POST | `/api/strategy/:id/backtest/import` | Import backtest CSV |
| GET | `/api/strategy/:id/backtest-comparison` | Live vs backtest |
| GET | `/api/strategy/compare/all` | Compare all strategies |
| GET | `/api/strategy/engine/status` | Engine status |
| POST | `/api/strategy/engine/rebalance/:id` | Trigger rebalance |
| POST | `/api/strategy/engine/rebalance-all` | Rebalance all |
| GET | `/api/trade/indices` | Market indices |
| GET | `/api/trade/price/:symbol` | Real-time price |

## Seeded Strategies

| ID | Name | Initial Capital | Benchmark | Signal Source |
|----|------|-----------------|-----------|---------------|
| `hs300_top50` | 沪深300 Top-50 | ¥1,000,000 | 000300.SH | top10_csv |
| `all_market_top10` | 全市场 Top-10 | ¥1,000,000 | 000985.CSI | top10_csv |
| `hs300_equal_weight` | 沪深300等权基准 | ¥1,000,000 | 000300.SH | none (buy & hold) |

## Getting Started

```bash
# Backend
cd server
npm install
npm start          # runs on port 5001

# Frontend
cd client
npm install
npm run dev         # Vite dev server

# MCP server (for AI agent integration)
cd mcp
npm install
node index.js       # stdio MCP server

# Tests
cd server
node --test tests/api.test.js
```

## MCP Configuration (Hermes Agent)

```yaml
# ~/.hermes/config.yaml
mcp_servers:
  paper-trading:
    command: "node"
    args: ["/path/to/paper-trading-simulator/mcp/index.js"]
    timeout: 60
```

## Workflow

```
Research (factor mining)  →  Create strategy + import signals  →  Monitor paper trading  →  Validate  →  Live deployment
```

## Tech Stack

- **Backend**: Node.js, Express 5, better-sqlite3 (SQLite WAL)
- **Frontend**: React 19, Vite, ECharts, Tailwind CSS
- **MCP**: @modelcontextprotocol/sdk, stdio transport
- **Market Data**: 东方财富 push2 API
- **Tests**: node:test (zero external deps)
