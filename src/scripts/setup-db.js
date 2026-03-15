const { clickhouse } = require('../lib/clickhouse');

async function setup() {
  console.log('Setting up Hypeify analytics schema...');

  await clickhouse.exec({
    query: `CREATE DATABASE IF NOT EXISTS hypeify`,
  });

  await clickhouse.exec({
    query: `
      CREATE TABLE IF NOT EXISTS hypeify.pageviews (
        site_id       String,
        timestamp     DateTime DEFAULT now(),
        session_id    String,
        visitor_id    String,
        pathname      String,
        referrer      String,
        utm_source    String,
        utm_medium    String,
        utm_campaign  String,
        country       String,
        city          String,
        device        String,
        browser       String,
        os            String,
        duration_ms   UInt32,
        is_bounce     UInt8
      )
      ENGINE = MergeTree()
      PARTITION BY toYYYYMM(timestamp)
      ORDER BY (site_id, timestamp)
      TTL timestamp + INTERVAL 2 YEAR;
    `,
  });

  await clickhouse.exec({
    query: `
      CREATE TABLE IF NOT EXISTS hypeify.events (
        site_id    String,
        timestamp  DateTime DEFAULT now(),
        session_id String,
        visitor_id String,
        name       String,
        properties String
      )
      ENGINE = MergeTree()
      PARTITION BY toYYYYMM(timestamp)
      ORDER BY (site_id, timestamp)
      TTL timestamp + INTERVAL 2 YEAR;
    `,
  });

  await clickhouse.exec({
    query: `
      CREATE TABLE IF NOT EXISTS hypeify.daily_stats (
        site_id         String,
        date            Date,
        unique_visitors UInt64,
        pageviews       UInt64,
        sessions        UInt64,
        bounces         UInt64,
        total_duration  UInt64,
        organic_visits  UInt64
      )
      ENGINE = SummingMergeTree()
      PARTITION BY toYYYYMM(date)
      ORDER BY (site_id, date);
    `,
  });

  console.log('✓ Tables created: pageviews, events, daily_stats');
  process.exit(0);
}

setup().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
