require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { pingClickHouse } = require('./lib/clickhouse');
const collectRouter = require('./routes/collect');
const statsRouter = require('./routes/stats');

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Ingest — receives hits from tracker.js on client sites
app.use('/collect', collectRouter);

// Stats API — serves data to the Hypeify dashboard
app.use('/stats', statsRouter);

async function start() {
  await pingClickHouse();
  app.listen(PORT, () => {
    console.log(`🚀 Hypeify analytics running on port ${PORT}`);
    console.log(`   POST /collect        — ingest pageviews & events`);
    console.log(`   GET  /stats/:siteId  — dashboard metrics`);
    console.log(`   GET  /stats/:siteId/timeseries — graph data`);
  });
}

start().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});

module.exports = app;
