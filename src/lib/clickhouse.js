const { createClient } = require('@clickhouse/client');
require('dotenv').config();

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST ?? 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USERNAME ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
  database: process.env.CLICKHOUSE_DATABASE ?? 'hypeify',
  clickhouse_settings: {
    async_insert: 1,          
    wait_for_async_insert: 0,
  },
});

async function pingClickHouse() {
  const alive = await clickhouse.ping();
  if (!alive) throw new Error('ClickHouse connection failed');
  console.log('✓ ClickHouse connected');
}

module.exports = { clickhouse, pingClickHouse };
