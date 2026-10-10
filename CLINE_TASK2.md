# Frontend Audit & Test Expansion Task for Cline

## Project root
`/git/paper-trading`

## Context
The frontend had a runtime error (`ArrowLeftRight is not defined` in StrategyDetail.jsx) caused by a missing import. We need a comprehensive audit of ALL frontend pages/components to catch similar issues, plus expanded test coverage.

## Task 1: Audit all frontend files for import errors

Check every `.jsx` file in `client/src/pages/` and `client/src/components/` for:
1. **Missing imports** — any identifier used in JSX/code but not imported (like the `ArrowLeftRight` bug)
2. **Wrong import names** — imported as one name but used as another
3. **Unused imports** — imported but never used (cleanup, not critical)
4. **Missing export references** — functions/components used from `ui.jsx` or `api.js` that don't exist

Files to check:
- `client/src/pages/StrategyOverview.jsx`
- `client/src/pages/StrategyDetail.jsx`
- `client/src/pages/StrategyCompare.jsx`
- `client/src/pages/StrategyConfig.jsx`
- `client/src/pages/AllPositions.jsx`
- `client/src/pages/AllTransactions.jsx`
- `client/src/pages/Dashboard.jsx`
- `client/src/pages/Markets.jsx`
- `client/src/pages/StockDetail.jsx`
- `client/src/pages/Profile.jsx`
- `client/src/pages/Holdings.jsx`
- `client/src/components/Navbar.jsx`
- `client/src/components/ui.jsx`
- `client/src/components/StockCard.jsx`
- `client/src/components/MarketNews.jsx`
- `client/src/App.jsx`
- `client/src/services/api.js`

For each file:
1. Extract all imported identifiers (from import statements)
2. Extract all used identifiers in the file
3. Report any used-but-not-imported identifiers
4. Fix any issues found

## Task 2: Fix any import errors found

For each issue found in Task 1, fix the import statement in the file. Only change import lines — do not modify component logic.

## Task 3: Expand test suite

Expand `server/tests/api.test.js` (or create `server/tests/api-expanded.test.js`) with these additional test cases:

### Strategy CRUD edge cases
- `POST /api/strategy` without `id` → 400
- `POST /api/strategy` without `name` → 400
- `POST /api/strategy` with duplicate `id` → 409
- `PUT /api/strategy/nonexistent` → 404
- `DELETE /api/strategy/nonexistent` → 404

### Portfolio data with date filters
- `GET /api/strategy/hs300_top50/nav?limit=1` → 200, array length <= 1
- `GET /api/strategy/hs300_top50/transactions?limit=5` → 200, array length <= 5
- `GET /api/strategy/hs300_top50/transactions?side=buy` → 200, all transactions have side='buy'
- `GET /api/strategy/hs300_top50/holdings?date=2026-01-01` → 200, returns array (may be empty)

### Engine endpoints
- `GET /api/strategy/engine/status` → 200, first strategy has all expected fields (id, name, status, totalAssets, cash, positionRatio, holdingCount)
- `GET /api/strategy/compare/all` → 200, first item has all expected fields (id, name, totalAssets, cumulativeReturn, sharpe, maxDrawdown, holdingCount, winRate)

### Backtest endpoints
- `GET /api/strategy/hs300_top50/backtest` → 200, if non-empty, first item has fields (strategy_id, backtest_date, start_date, end_date)
- `GET /api/strategy/hs300_top50/backtest-comparison` → 200, `live` object has fields (totalAssets, cumulativeReturn, sharpe, maxDrawdown, daysElapsed, startDate, endDate, equityCurve)

### Market data
- `GET /api/trade/price/000001.SZ` → 200, has `price` field (may be mock value)
- `GET /api/trade/candles/000001.SZ` → 200, returns array

### Error handling
- `GET /api/strategy/hs300_top50/holdings` → verify Content-Type is application/json
- `GET /api/strategy/nonexistent/holdings` → 200 with empty array (holdings query doesn't 404 on missing strategy)
- `GET /api/strategy/nonexistent/nav` → 200 with empty array

### MCP server tests (if feasible)
- Start MCP server process, send initialize handshake, verify 20 tools listed
- Call `list_strategies` tool, verify 3 strategies returned

## Constraints
- Use `node:test` and `node:assert` only — no external test deps
- Use `fetch()` for HTTP requests
- Tests must clean up after themselves (delete any created test data)
- Tests must be runnable with `node --test tests/` from the server directory
- Do NOT modify existing controller logic or API behavior
- Do NOT modify `index.js` or `db.js`
- For Task 1/2: only fix import statements, do not change component logic
