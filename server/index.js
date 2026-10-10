// 清除代理环境变量 (东财API需要直连, Clash代理会导致502)
delete process.env.HTTP_PROXY;
delete process.env.HTTPS_PROXY;
delete process.env.http_proxy;
delete process.env.https_proxy;

const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');

dotenv.config();

// Initialize SQLite database (sync) and seed strategies on first run
const { getDB } = require('./config/db');
const { seedStrategies } = require('./services/rebalanceEngine');
getDB(); // ensure schema + DB created
seedStrategies(); // seed 3 default strategies if table is empty

const app = express();

app.use(cors());
app.use(express.json());

const path = require('path');

// ─── Routes ────────────────────────────────────────────────
// No auth — this is a read-only paper trading tracking dashboard

// Strategy & portfolio tracking API
app.use('/api/strategy', require('./routes/strategy'));

// Market data only (no manual trading, no auth)
// Strip protect middleware — rebuild trade routes without auth
const tradeRouter = express.Router();
const tradeController = require('./controllers/tradeController');
// Only expose read-only market data endpoints (no buy/sell/stop-loss)
tradeRouter.get('/search/:query', tradeController.searchSymbol);
tradeRouter.get('/price/:symbol', tradeController.getPrice);
tradeRouter.get('/candles/:symbol', tradeController.getCandles);
tradeRouter.get('/indices', tradeController.getIndices);
tradeRouter.get('/movers', tradeController.getScreeners);
tradeRouter.get('/profile/:symbol', tradeController.getCompanyProfile);
tradeRouter.get('/financials/:symbol', tradeController.getFinancials);
tradeRouter.get('/news/market', tradeController.getMarketNews);
tradeRouter.get('/news/:symbol', tradeController.getNews);
tradeRouter.get('/recommendations/:symbol', tradeController.getRecommendations);
app.use('/api/trade', tradeRouter);

const PORT = process.env.PORT || 5001;

// Serve frontend static files in production
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
// SPA fallback: all non-API routes return index.html
app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Start internal scheduler on boot (unless disabled for tests)
const scheduler = require('./services/scheduler');
if (process.env.DISABLE_SCHEDULER !== 'true') {
    scheduler.start();
}

module.exports = app;
