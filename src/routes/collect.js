const { Router } = require('express');
const { UAParser } = require('ua-parser-js');
const { clickhouse } = require('../lib/clickhouse');

const router = Router();

const ORGANIC_SOURCES = ['google', 'bing', 'duckduckgo', 'yahoo', 'ecosia', 'brave'];

function getDevice(type) {
  if (!type) return 'desktop';
  if (type === 'mobile') return 'mobile';
  if (type === 'tablet') return 'tablet';
  return 'desktop';
}

function isOrganic(referrer) {
  try {
    const host = new URL(referrer).hostname.replace('www.', '');
    return ORGANIC_SOURCES.some((s) => host.includes(s));
  } catch {
    return false;
  }
}

function parseUtm(url) {
  try {
    const u = new URL(url);
    return {
      utm_source: u.searchParams.get('utm_source') ?? '',
      utm_medium: u.searchParams.get('utm_medium') ?? '',
      utm_campaign: u.searchParams.get('utm_campaign') ?? '',
    };
  } catch {
    return { utm_source: '', utm_medium: '', utm_campaign: '' };
  }
}

// POST /collect — receives a pageview or event from the tracker script
router.post('/', async (req, res) => {
  try {
    // Handle both application/json and text/plain (sendBeacon sends text/plain)
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({ error: 'Invalid JSON' });
      }
    }

    const {
      type = 'pageview',
      site_id,
      session_id,
      visitor_id,
      pathname,
      referrer = '',
      href,
      duration_ms = 0,
      is_bounce = 1,
      name,
      properties,
    } = body;

    if (!site_id || !session_id || !visitor_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const ua = new UAParser(req.headers['user-agent']);
    const device = getDevice(ua.getDevice().type);
    const browser = ua.getBrowser().name ?? 'Unknown';
    const os = ua.getOS().name ?? 'Unknown';

    const country = req.headers['cf-ipcountry'] ?? '';
    const city = req.headers['cf-ipcity'] ?? '';

    const utm = parseUtm(href ?? '');
    const organic = isOrganic(referrer) ? 1 : 0;

    if (type === 'pageview') {
      await clickhouse.insert({
        table: 'pageviews',
        values: [{
          site_id,
          session_id,
          visitor_id,
          pathname: pathname ?? '/',
          referrer,
          ...utm,
          country,
          city,
          device,
          browser,
          os,
          duration_ms: Number(duration_ms),
          is_bounce: Number(is_bounce),
        }],
        format: 'JSONEachRow',
      });

      await clickhouse.exec({
        query: `
          INSERT INTO daily_stats (site_id, date, unique_visitors, pageviews, sessions, bounces, total_duration, organic_visits)
          VALUES ('${site_id}', today(), 1, 1, 0, ${is_bounce}, ${duration_ms}, ${organic})
        `,
      });
    }

    if (type === 'event') {
      if (!name) return res.status(400).json({ error: 'Event name required' });

      await clickhouse.insert({
        table: 'events',
        values: [{
          site_id,
          session_id,
          visitor_id,
          name,
          properties: properties ? JSON.stringify(properties) : '{}',
        }],
        format: 'JSONEachRow',
      });
    }

    // 1x1 transparent GIF fallback
    res.setHeader('Content-Type', 'image/gif');
    res.send(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
  } catch (err) {
    console.error('Ingest error:', err);
    res.status(500).json({ error: 'Ingest failed' });
  }
});

module.exports = router;
