const express = require('express');
const cors = require('cors');
require('dotenv').config();

const db = require('./db');
const { seedAdminUser, login, authMiddleware } = require('./auth');
const { startController, runReconcileCycle } = require('./controller');

const nodesRouter = require('./routes/nodes');
const deploymentsRouter = require('./routes/deployments');
const podsRouter = require('./routes/pods');
const servicesRouter = require('./routes/services');
const hpaRouter = require('./routes/hpa');
const eventsRouter = require('./routes/events');
const metricsRouter = require('./routes/metrics');
const chaosRouter = require('./routes/chaos');
const imagesRouter = require('./routes/images');

const app = express();
const PORT = process.env.PORT || 4010;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3010';
const TICK_MS = parseInt(process.env.TICK_MS, 10) || 1000;

app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true
}));
app.use(express.json());

// Public health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public auth login
app.post('/api/auth/login', login);

// Protected routes (Bearer token)
app.use('/api', authMiddleware);

// Manual tick endpoint for testing and synchronous cycles
app.post('/api/tick', async (req, res) => {
  try {
    await runReconcileCycle();
    res.json({ message: 'Tick executed successfully' });
  } catch (err) {
    console.error('Tick manual error:', err);
    res.status(500).json({ error: 'Failed to run tick cycle' });
  }
});

// Core API endpoints
app.use('/api/nodes', nodesRouter);
app.use('/api/deployments', deploymentsRouter);
app.use('/api/pods', podsRouter);
app.use('/api/services', servicesRouter);
app.use('/api/hpas', hpaRouter);
app.use('/api/events', eventsRouter);
app.use('/api/metrics', metricsRouter);
app.use('/api/overview', (req, res, next) => {
  req.url = '/overview';
  metricsRouter(req, res, next);
});
app.use('/api/chaos', chaosRouter);
app.use('/api/images', imagesRouter);

// 404 handler for unknown api routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
});

async function start() {
  await db.connectWithRetry();
  await seedAdminUser();
  startController(TICK_MS);

  const server = app.listen(PORT, () => {
    console.log(`Container Orchestrator backend running on port ${PORT}`);
  });
  return server;
}

if (require.main === module) {
  start().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = {
  app,
  start
};
