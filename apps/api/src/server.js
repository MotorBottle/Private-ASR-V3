require('dotenv').config({ path: '/app/.env' });
require('dotenv').config();

const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const authRoutes = require('./routes/auth');
const recordRoutes = require('./routes/records');
const jobRoutes = require('./routes/jobs');
const { initDatabase } = require('./lib/database');

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);
const allowedOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

app.use(helmet({
  crossOriginResourcePolicy: false
}));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Not allowed by CORS'));
  }
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/api/v1/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'api',
    timestamp: new Date().toISOString()
  });
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/records', recordRoutes);
app.use('/api/v1/jobs', jobRoutes);

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

async function start() {
  await initDatabase();
  app.listen(port, () => {
    console.log(`API listening on ${port}`);
  });
}

start().catch((error) => {
  console.error('Failed to start API:', error);
  process.exit(1);
});
