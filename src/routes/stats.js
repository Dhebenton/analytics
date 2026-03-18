const { Router } = require('express');
const { clickhouse } = require('../lib/clickhouse');

const router = Router();

// GET /stats/:siteId?from=2024-01-01&to=2024-01-31
router.get('/:siteId', async (req, res) => {
  try {
    const { siteId } = req.params;
    const { from, to, period = '30d' } = req.query;

    let dateFilter;
    if (from && to) {
      dateFilter = `timestamp BETWEEN '${from}' AND '${to} 23:59:59'`;
    } else {
      const days = parseInt(period.replace('d', '')) || 30;
      dateFilter = `timestamp >= now() - INTERVAL ${days} DAY`;
    }

    const prevFilter = from && to
      ? `timestamp BETWEEN date_sub(DAY, dateDiff('day', '${from}', '${to}'), '${from}') AND '${from}'`
      : `timestamp >= now() - INTERVAL ${parseInt(period) * 2 || 60} DAY AND timestamp < now() - INTERVAL ${parseInt(period) || 30} DAY`;

    const metricsQuery = `
      SELECT
        uniq(visitor_id)                                    AS unique_visitors,
        count()                                             AS page_views,
        avg(duration_ms)                                    AS avg_session_ms,
        round(countIf(is_bounce = 1) / count() * 100, 1)   AS bounce_rate,
        countIf(
          referrer LIKE '%google%' OR referrer LIKE '%bing%' OR
          referrer LIKE '%duckduckgo%' OR referrer LIKE '%yahoo%'
        )                                                   AS organic_traffic
      FROM pageviews
      WHERE site_id = '${siteId}'
        AND ${dateFilter}
    `;

    const eventCountQuery = `
      SELECT count() AS event_count
      FROM events
      WHERE site_id = '${siteId}'
        AND ${dateFilter}
    `;

    const prevMetricsQuery = `
      SELECT
        uniq(visitor_id)  AS unique_visitors,
        count()           AS page_views,
        avg(duration_ms)  AS avg_session_ms,
        round(countIf(is_bounce = 1) / count() * 100, 1) AS bounce_rate,
        countIf(
          referrer LIKE '%google%' OR referrer LIKE '%bing%' OR
          referrer LIKE '%duckduckgo%' OR referrer LIKE '%yahoo%'
        )                 AS organic_traffic
      FROM pageviews
      WHERE site_id = '${siteId}'
        AND ${prevFilter}
    `;

    const [metricsResult, eventResult, prevResult] = await Promise.all([
      clickhouse.query({ query: metricsQuery, format: 'JSONEachRow' }),
      clickhouse.query({ query: eventCountQuery, format: 'JSONEachRow' }),
      clickhouse.query({ query: prevMetricsQuery, format: 'JSONEachRow' }),
    ]);

    const metrics = (await metricsResult.json())[0] ?? {};
    const events = (await eventResult.json())[0] ?? {};
    const prev = (await prevResult.json())[0] ?? {};

    function delta(current, previous) {
      if (!previous) return '+0%';
      const pct = ((current - previous) / previous) * 100;
      return `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`;
    }

    function msToReadable(ms) {
      const totalSec = Math.floor(ms / 1000);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      return `${m}m ${s}s`;
    }

    res.json({
      site_id: siteId,
      period: { from, to, preset: period },
      metrics: {
        unique_visitors: {
          value: metrics.unique_visitors ?? 0,
          delta: delta(metrics.unique_visitors, prev.unique_visitors),
        },
        page_views: {
          value: metrics.page_views ?? 0,
          delta: delta(metrics.page_views, prev.page_views),
        },
        session_duration: {
          value: msToReadable(metrics.avg_session_ms ?? 0),
          raw_ms: metrics.avg_session_ms ?? 0,
          delta: delta(metrics.avg_session_ms, prev.avg_session_ms),
        },
        bounce_rate: {
          value: `${metrics.bounce_rate ?? 0}%`,
          raw: metrics.bounce_rate ?? 0,
          delta: delta(metrics.bounce_rate, prev.bounce_rate),
        },
        event_count: {
          value: events.event_count ?? 0,
          delta: '+0%',
        },
        organic_traffic: {
          value: metrics.organic_traffic ?? 0,
          delta: delta(metrics.organic_traffic, prev.organic_traffic),
        },
      },
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /stats/:siteId/timeseries?metric=page_views&period=30d
router.get('/:siteId/timeseries', async (req, res) => {
  try {
    const { siteId } = req.params;
    const { metric = 'page_views', period = '30d' } = req.query;
    const days = parseInt(period.replace('d', '')) || 30;

    const metricExpr = {
      page_views: 'count()',
      unique_visitors: 'uniq(visitor_id)',
      organic_traffic: "countIf(referrer LIKE '%google%' OR referrer LIKE '%bing%')",
      bounce_rate: 'round(countIf(is_bounce = 1) / count() * 100, 1)',
    };

    const expr = metricExpr[metric] ?? 'count()';

    const query = `
      SELECT
        toDate(timestamp)  AS date,
        ${expr}            AS value
      FROM pageviews
      WHERE site_id = '${siteId}'
        AND timestamp >= now() - INTERVAL ${days} DAY
      GROUP BY date
      ORDER BY date ASC
    `;

    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await result.json();

    res.json({ site_id: siteId, metric, data: rows });
  } catch (err) {
    console.error('Timeseries error:', err);
    res.status(500).json({ error: 'Failed to fetch timeseries' });
  }
});

// GET /stats/:siteId/pages?period=30d
router.get('/:siteId/pages', async (req, res) => {
  try {
    const { siteId } = req.params;
    const { period = '30d' } = req.query;
    const days = parseInt(period.replace('d', '')) || 30;

    const query = `
      SELECT
        pathname,
        count() AS value,
        round(count() / sum(count()) OVER () * 100, 1) AS percentage
      FROM pageviews
      WHERE site_id = '${siteId}'
        AND timestamp >= now() - INTERVAL ${days} DAY
      GROUP BY pathname
      ORDER BY value DESC
      LIMIT 10
    `;

    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await result.json();
    res.json({ data: rows });
  } catch (err) {
    console.error('Pages error:', err);
    res.status(500).json({ error: 'Failed to fetch pages' });
  }
});

// GET /stats/:siteId/sources?period=30d
router.get('/:siteId/sources', async (req, res) => {
  try {
    const { siteId } = req.params;
    const { period = '30d' } = req.query;
    const days = parseInt(period.replace('d', '')) || 30;

    const query = `
      SELECT
        domainWithoutWWW(referrer) AS source,
        count() AS value,
        round(count() / sum(count()) OVER () * 100, 1) AS percentage
      FROM pageviews
      WHERE site_id = '${siteId}'
        AND timestamp >= now() - INTERVAL ${days} DAY
      GROUP BY source
      ORDER BY value DESC
      LIMIT 10
    `;

    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await result.json();
    res.json({ data: rows });
  } catch (err) {
    console.error('Sources error:', err);
    res.status(500).json({ error: 'Failed to fetch sources' });
  }
});

module.exports = router;