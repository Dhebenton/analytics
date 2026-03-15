(function () {
  var script = document.currentScript;
  var siteId = script && script.getAttribute('data-site');
  var endpoint = 'https://backend.hypeify.io/collect'; // update to your deployed URL

  if (!siteId) {
    console.warn('[Hypeify] Missing data-site attribute');
    return;
  }

  // --- Session & Visitor Identity ---

  function generateId() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function getVisitorId() {
    var id = localStorage.getItem('_hy_vid');
    if (!id) {
      id = generateId();
      localStorage.setItem('_hy_vid', id);
    }
    return id;
  }

  function getSessionId() {
    var key = '_hy_sid';
    var tsKey = '_hy_sts';
    var timeout = 30 * 60 * 1000;
    var now = Date.now();
    var lastTs = parseInt(sessionStorage.getItem(tsKey) || '0');
    var id = sessionStorage.getItem(key);

    if (!id || now - lastTs > timeout) {
      id = generateId();
      sessionStorage.setItem(key, id);
    }
    sessionStorage.setItem(tsKey, String(now));
    return id;
  }

  var visitorId = getVisitorId();
  var sessionId = getSessionId();
  var pageStartTime = Date.now();
  var lastPathname = location.pathname;
  var isFirstPageInSession = !sessionStorage.getItem('_hy_pv_sent');

  // --- Send to Backend ---

  function send(payload) {
     var data = JSON.stringify(
     Object.assign({ site_id: siteId, visitor_id: visitorId, session_id: sessionId }, payload)
     );

     fetch(endpoint, {
     method: 'POST',
     body: data,
     headers: { 'Content-Type': 'application/json' },
     keepalive: true,
     });
     }

  function sendPageview(pathname, isBounce, durationMs) {
    send({
      type: 'pageview',
      pathname: pathname,
      referrer: document.referrer,
      href: location.href,
      duration_ms: durationMs,
      is_bounce: isBounce ? 1 : 0,
    });
    sessionStorage.setItem('_hy_pv_sent', '1');
  }

  // --- Page View Tracking ---

  function trackPageview() {
    var pathname = location.pathname;
    var duration = Date.now() - pageStartTime;
    var isBounce = isFirstPageInSession;

    sendPageview(pathname, isBounce, duration);

    pageStartTime = Date.now();
    lastPathname = pathname;
    isFirstPageInSession = false;
  }

  trackPageview();

  // SPA navigation support
  var originalPushState = history.pushState.bind(history);
  var originalReplaceState = history.replaceState.bind(history);

  history.pushState = function () {
    originalPushState.apply(history, arguments);
    if (location.pathname !== lastPathname) trackPageview();
  };

  history.replaceState = function () {
    originalReplaceState.apply(history, arguments);
    if (location.pathname !== lastPathname) trackPageview();
  };

  window.addEventListener('popstate', function () {
    if (location.pathname !== lastPathname) trackPageview();
  });

  window.addEventListener('beforeunload', function () {
    send({
      type: 'pageview',
      pathname: location.pathname,
      referrer: document.referrer,
      href: location.href,
      duration_ms: Date.now() - pageStartTime,
      is_bounce: isFirstPageInSession ? 1 : 0,
    });
  });

  // --- Custom Event Tracking ---
  // Usage: window.hypeify('event', 'button_click', { label: 'signup' })

  window.hypeify = function (action, name, properties) {
    if (action !== 'event') return;
    send({ type: 'event', name: name, properties: properties || {} });
  };
})();
