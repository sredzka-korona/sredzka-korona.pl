(function initStatsDashboard() {
  'use strict';

  var config = window.SREDZKA_CONFIG || {};
  var isLocalPreview = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  var apiBase = isLocalPreview ? window.location.origin : String(config.apiBase || '').replace(/\/$/, '');
  var dom = {
    loginWrap: document.getElementById('loginWrap'), loginForm: document.getElementById('loginForm'),
    password: document.getElementById('statsPassword'), loginButton: document.getElementById('loginButton'),
    loginError: document.getElementById('loginError'), captchaWrap: document.getElementById('captchaWrap'),
    captchaHost: document.getElementById('statsTurnstile'), captchaStatus: document.getElementById('captchaStatus'),
    dashboard: document.getElementById('dashboard'), refresh: document.getElementById('refreshButton'),
    logout: document.getElementById('logoutButton'), tabs: document.getElementById('statsTabs'),
    ranges: document.getElementById('rangeButtons'), summaryLine: document.getElementById('summaryLine'),
    metrics: document.getElementById('metrics'), seriesButtons: document.getElementById('seriesButtons'),
    chartHost: document.getElementById('chartHost'), chartTooltip: document.getElementById('chartTooltip'),
    sideSummary: document.getElementById('sideSummary'), eventsHost: document.getElementById('eventsHost'),
    eventsCard: document.getElementById('eventsCard'), summaryDetails: document.getElementById('summaryDetails'),
    summaryPanel: document.getElementById('summaryPanel'), pagesPanel: document.getElementById('pagesPanel'),
    pagesHost: document.getElementById('pagesHost'), pagesSummary: document.getElementById('pagesSummaryLine'),
    sitemapPanel: document.getElementById('sitemapPanel'), sitemapHost: document.getElementById('sitemapHost'),
    sitemapSummary: document.getElementById('sitemapSummaryLine')
  };
  if (!apiBase || !dom.loginForm) return;

  var SERIES = [
    { key: 'visit', label: 'Odwiedziny', color: '#ad7a27' },
    { key: 'phone', label: 'Telefon', color: '#39755a' },
    { key: 'address', label: 'Adres', color: '#4e70a8' },
    { key: 'email', label: 'E-mail', color: '#8259a3' },
    { key: 'form', label: 'Formularz', color: '#c26038' }
  ];
  var EVENT_LABELS = {
    visit: 'Odwiedziny strony', contact_phone_click: 'Kliknięcie w telefon',
    contact_map_click: 'Kliknięcie w adres', contact_email_click: 'Kliknięcie w e-mail',
    contact_form_submit: 'Wysłanie formularza'
  };
  var state = {
    range: '7', data: null, activeTab: 'summary', sitemap: null, captchaRequired: false,
    captchaToken: '', captchaWidget: null, blockedUntil: 0, blockTimer: null,
    visible: { visit: true, phone: true, address: true, email: true, form: true }
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }
  function fmtInt(value) { return new Intl.NumberFormat('pl-PL').format(Number(value) || 0); }
  function fmtPercent(value) { return (Number(value) || 0).toFixed(1).replace('.', ',') + '%'; }
  function fmtDate(value) {
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
  }
  function rangeLabel() {
    return state.range === '7' ? 'ostatnie 7 dni' : state.range === 'miesiac' ? 'ostatnie 30 dni' : state.range === 'rok' ? 'ostatni rok' : 'cała historia';
  }
  async function fetchJson(path, options) {
    var response = await fetch(apiBase + path, Object.assign({ credentials: 'include' }, options || {}));
    var payload = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      var error = new Error(payload.error || 'Żądanie nie powiodło się.');
      error.code = payload.code || '';
      error.retryAfterSeconds = Number(payload.retryAfterSeconds) || 0;
      throw error;
    }
    return payload;
  }
  function setLoggedIn(value) {
    dom.loginWrap.hidden = value;
    dom.dashboard.hidden = !value;
    dom.refresh.hidden = !value;
    dom.logout.hidden = !value;
  }
  function setError(message) { dom.loginError.textContent = message || ''; }
  function setCaptcha(required) {
    state.captchaRequired = Boolean(required);
    dom.captchaWrap.classList.toggle('is-visible', state.captchaRequired);
    if (required) ensureCaptcha();
    else { state.captchaToken = ''; dom.captchaStatus.textContent = ''; }
  }
  function ensureCaptcha(attempt) {
    if (!state.captchaRequired) return;
    if (!window.turnstile || typeof window.turnstile.render !== 'function') {
      if ((attempt || 0) < 30) window.setTimeout(function () { ensureCaptcha((attempt || 0) + 1); }, 200);
      else dom.captchaStatus.textContent = 'Nie udało się załadować CAPTCHA. Odśwież stronę.';
      return;
    }
    if (state.captchaWidget !== null) return;
    var siteKey = String(config.turnstileSiteKey || '');
    if (!siteKey) { dom.captchaStatus.textContent = 'Brak konfiguracji CAPTCHA.'; return; }
    state.captchaWidget = window.turnstile.render(dom.captchaHost, {
      sitekey: siteKey,
      callback: function (token) { state.captchaToken = token; dom.captchaStatus.textContent = ''; },
      'expired-callback': function () { state.captchaToken = ''; dom.captchaStatus.textContent = 'CAPTCHA wygasła.'; },
      'error-callback': function () { state.captchaToken = ''; dom.captchaStatus.textContent = 'Błąd CAPTCHA. Spróbuj ponownie.'; }
    });
  }
  function resetCaptcha() {
    state.captchaToken = '';
    if (state.captchaWidget !== null && window.turnstile) {
      try { window.turnstile.reset(state.captchaWidget); } catch (error) {}
    }
  }
  function startBlock(seconds) {
    state.blockedUntil = Date.now() + Math.max(1, Number(seconds) || 600) * 1000;
    if (state.blockTimer) window.clearInterval(state.blockTimer);
    function update() {
      var left = Math.ceil((state.blockedUntil - Date.now()) / 1000);
      if (left <= 0) { window.clearInterval(state.blockTimer); state.blockTimer = null; state.blockedUntil = 0; setError(''); return; }
      setError('Zbyt wiele błędnych prób. Kolejna próba za ' + left + ' s.');
    }
    update();
    state.blockTimer = window.setInterval(update, 1000);
  }
  async function loadStats() {
    state.data = await fetchJson('/api/stats/data?range=' + encodeURIComponent(state.range));
    setLoggedIn(true); setCaptcha(false); setError(''); render();
  }

  function renderMetrics() {
    var totals = state.data.totals || {};
    var items = [
      ['Odwiedziny strony', totals.visits, '1 wejście na podstronę / sesję'],
      ['Kliknięcia telefonu', totals.phone, 'Linki telefoniczne'],
      ['Kliknięcia adresu', totals.address, 'Otwarcia mapy'],
      ['Kliknięcia e-mail', totals.email, 'Linki e-mail'],
      ['Formularze', totals.form, 'Konwersja: ' + fmtPercent(state.data.conversionRate)]
    ];
    dom.metrics.innerHTML = items.map(function (item) {
      return '<article class="metric"><span>' + escapeHtml(item[0]) + '</span><strong>' + fmtInt(item[1]) + '</strong><small>' + escapeHtml(item[2]) + '</small></article>';
    }).join('');
    dom.summaryLine.textContent = 'Zakres: ' + rangeLabel() + ' • rekordów w bazie: ' + fmtInt(state.data.availableEvents) + ' • odświeżono: ' + fmtDate(state.data.lastUpdatedAt);
    var days = Math.max((state.data.series || []).length, 1);
    dom.sideSummary.innerHTML = [
      ['Łączne akcje kontaktowe', state.data.totalContacts],
      ['Skuteczność formularza', fmtPercent(state.data.conversionRate)],
      ['Średnio odwiedzin / dzień', Math.round((Number(totals.visits) || 0) / days)],
      ['Średnio kontaktów / dzień', Math.round((Number(state.data.totalContacts) || 0) / days)]
    ].map(function (item) { return '<div class="side-item"><span>' + item[0] + '</span><strong>' + (typeof item[1] === 'number' ? fmtInt(item[1]) : item[1]) + '</strong></div>'; }).join('');
  }
  function renderSeriesButtons() {
    dom.seriesButtons.innerHTML = SERIES.map(function (item) {
      return '<button type="button" class="series-button ' + (state.visible[item.key] ? 'is-active' : '') + '" data-series="' + item.key + '"><span class="legend-dot" style="--series-color:' + item.color + '"></span>' + item.label + '</button>';
    }).join('');
  }
  function renderChart() {
    var rows = Array.isArray(state.data.series) ? state.data.series : [];
    if (!rows.length) { dom.chartHost.innerHTML = '<div class="empty">Brak danych do pokazania.</div>'; return; }
    var enabled = SERIES.filter(function (item) { return state.visible[item.key]; });
    var width = 850, height = 320, pad = { top: 18, right: 18, bottom: 35, left: 42 };
    var innerW = width - pad.left - pad.right, innerH = height - pad.top - pad.bottom;
    var max = Math.max.apply(Math, [1].concat(rows.flatMap(function (row) { return enabled.map(function (item) { return Number(row[item.key]) || 0; }); })));
    var step = rows.length > 1 ? innerW / (rows.length - 1) : innerW;
    var grid = Array.from({ length: 5 }, function (_, i) {
      var y = pad.top + innerH * i / 4, value = Math.round(max * (1 - i / 4));
      return '<line x1="' + pad.left + '" y1="' + y + '" x2="' + (width-pad.right) + '" y2="' + y + '" stroke="rgba(119,80,22,.13)"/><text x="' + (pad.left-9) + '" y="' + (y+4) + '" text-anchor="end" fill="#74695d" font-size="11">' + value + '</text>';
    }).join('');
    var labels = rows.map(function (row, i) {
      if (rows.length > 20 && i % Math.ceil(rows.length / 8) !== 0 && i !== rows.length - 1) return '';
      return '<text x="' + (pad.left + step*i) + '" y="' + (height-10) + '" text-anchor="middle" fill="#74695d" font-size="11">' + escapeHtml(row.label) + '</text>';
    }).join('');
    var lines = enabled.map(function (item) {
      var path = rows.map(function (row, i) {
        var x = pad.left + step*i, y = pad.top + innerH - ((Number(row[item.key]) || 0) / max * innerH);
        return (i ? 'L' : 'M') + x + ' ' + y;
      }).join(' ');
      var points = rows.map(function (row, i) {
        var x = pad.left + step*i, y = pad.top + innerH - ((Number(row[item.key]) || 0) / max * innerH);
        return '<circle class="chart-hit" data-index="' + i + '" data-series="' + item.key + '" cx="' + x + '" cy="' + y + '" r="9" fill="transparent"/><circle cx="' + x + '" cy="' + y + '" r="3" fill="' + item.color + '" pointer-events="none"/>';
      }).join('');
      return '<path d="' + path + '" fill="none" stroke="' + item.color + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' + points;
    }).join('');
    dom.chartHost.innerHTML = '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Trend dzienny statystyk">' + grid + labels + lines + '</svg>';
    dom.chartHost.querySelectorAll('.chart-hit').forEach(function (point) {
      point.addEventListener('mouseenter', function () {
        var index = Number(point.dataset.index), series = SERIES.find(function (item) { return item.key === point.dataset.series; }), row = rows[index];
        dom.chartTooltip.innerHTML = '<strong>' + escapeHtml(row.date) + '</strong><br>' + escapeHtml(series.label) + ': ' + fmtInt(row[series.key]);
        var box = point.getBoundingClientRect(), shell = dom.chartTooltip.parentElement.getBoundingClientRect();
        dom.chartTooltip.style.left = Math.max(5, box.left - shell.left - 25) + 'px'; dom.chartTooltip.style.top = Math.max(5, box.top - shell.top - 55) + 'px';
        dom.chartTooltip.classList.add('is-visible');
      });
      point.addEventListener('mouseleave', function () { dom.chartTooltip.classList.remove('is-visible'); });
    });
  }
  function renderEvents() {
    var events = state.data.recentEvents || [];
    if (!events.length) { dom.eventsHost.innerHTML = '<div class="empty">Brak zapisanych zdarzeń.</div>'; return; }
    dom.eventsHost.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Typ</th><th>Kiedy</th><th>Etykieta</th><th>Strona</th></tr></thead><tbody>' + events.map(function (event) {
      return '<tr><td><span class="pill">' + escapeHtml(EVENT_LABELS[event.type] || event.type) + '</span></td><td>' + escapeHtml(fmtDate(event.createdAt)) + '</td><td>' + escapeHtml(event.label || '—') + '</td><td>' + escapeHtml(event.path || event.page || '—') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }
  function renderPages() {
    var sections = state.data.pageBreakdown || [], total = sections.reduce(function (sum, item) { return sum + (Number(item.visits) || 0); }, 0);
    dom.pagesSummary.textContent = 'Zakres: ' + rangeLabel() + ' • łącznie: ' + fmtInt(total) + ' wejść';
    if (!sections.length) { dom.pagesHost.innerHTML = '<div class="empty">Brak wejść na podstrony.</div>'; return; }
    dom.pagesHost.innerHTML = sections.map(function (section) {
      var pages = section.pages || [];
      return '<section class="section-block"><h3>' + escapeHtml(section.label) + ' — ' + fmtInt(section.visits) + '</h3>' + (pages.length ? '<div class="table-wrap"><table><thead><tr><th>Podstrona</th><th>Ścieżka</th><th>Wejścia</th></tr></thead><tbody>' + pages.map(function (page) {
        return '<tr><td>' + escapeHtml(page.label) + '</td><td>' + escapeHtml(page.path || '—') + '</td><td>' + fmtInt(page.visits) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="muted">Brak wejść w tym okresie.</p>') + '</section>';
    }).join('');
  }

  function normalizeUrl(value) { var path = String(value || '/').split('?')[0].split('#')[0]; return path === '/' ? '/' : '/' + path.replace(/^\/+|\/+$/g, '') + '/'; }
  function slugLabel(value) { return String(value || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, function (char) { return char.toUpperCase(); }); }
  function buildTree(items) {
    var root = { segment: '', url: '/', item: null, children: [], map: {} };
    items.forEach(function (item) {
      var url = normalizeUrl(item.url);
      if (url === '/') { root.item = item; return; }
      var node = root, path = '';
      url.split('/').filter(Boolean).forEach(function (segment, index, parts) {
        path += '/' + segment;
        if (!node.map[segment]) { node.map[segment] = { segment: segment, url: path + '/', item: null, children: [], map: {} }; node.children.push(node.map[segment]); }
        node = node.map[segment]; if (index === parts.length - 1) node.item = item;
      });
    });
    return root;
  }
  function renderNode(node) {
    var item = node.item, label = item ? item.label : (node.url === '/' ? 'Strona główna' : slugLabel(node.segment));
    var badges = item ? '<div class="badges"><span class="badge ' + (item.indexed === false ? 'noindex' : '') + '">' + (item.indexed === false ? 'noindex' : 'index') + '</span>' + (item.inSitemap === false ? '<span class="badge out">poza XML</span>' : '') + '</div>' : '';
    return '<li><div class="sitemap-row"><div class="sitemap-title">' + (item ? '<a href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener">' + escapeHtml(label) + '</a>' : '<strong>' + escapeHtml(label) + '</strong>') + '<span class="sitemap-url">' + escapeHtml(node.url) + '</span></div>' + badges + '</div>' + (node.children.length ? '<ul>' + node.children.map(renderNode).join('') + '</ul>' : '') + '</li>';
  }
  async function loadSitemap() {
    if (state.sitemap) return renderSitemap();
    dom.sitemapSummary.textContent = 'Ładowanie mapy strony…'; dom.sitemapHost.innerHTML = '<div class="empty">Pobieram sitemapę…</div>';
    try { state.sitemap = await fetchJson('/api/stats/sitemap'); renderSitemap(); }
    catch (error) { dom.sitemapSummary.textContent = 'Nie udało się pobrać mapy strony.'; dom.sitemapHost.innerHTML = '<div class="empty">' + escapeHtml(error.message) + '</div>'; }
  }
  function renderSitemap() {
    var items = Array.isArray(state.sitemap) ? state.sitemap : [], indexed = items.filter(function (item) { return item.indexed !== false; }).length;
    var outside = items.filter(function (item) { return item.inSitemap === false; }).length;
    dom.sitemapSummary.textContent = 'Łącznie: ' + fmtInt(items.length) + ' • index: ' + fmtInt(indexed) + ' • noindex: ' + fmtInt(items.length-indexed);
    dom.sitemapHost.innerHTML = '<div class="sitemap-summary"><span class="sitemap-stat">Index: ' + indexed + '</span><span class="sitemap-stat">Noindex: ' + (items.length-indexed) + '</span><span class="sitemap-stat">Poza XML: ' + outside + '</span></div><ul class="sitemap-tree">' + renderNode(buildTree(items)) + '</ul>';
  }
  function selectTab(tab) {
    state.activeTab = ['pages','sitemap'].includes(tab) ? tab : 'summary';
    dom.tabs.querySelectorAll('[data-tab]').forEach(function (button) { button.classList.toggle('is-active', button.dataset.tab === state.activeTab); });
    dom.summaryPanel.classList.toggle('is-active', state.activeTab === 'summary');
    dom.pagesPanel.classList.toggle('is-active', state.activeTab === 'pages');
    dom.sitemapPanel.classList.toggle('is-active', state.activeTab === 'sitemap');
    dom.summaryDetails.hidden = state.activeTab !== 'summary'; dom.eventsCard.hidden = state.activeTab !== 'summary';
    if (state.activeTab === 'sitemap') loadSitemap();
  }
  function render() { renderMetrics(); renderSeriesButtons(); renderChart(); renderEvents(); renderPages(); selectTab(state.activeTab); }

  dom.loginForm.addEventListener('submit', async function (event) {
    event.preventDefault(); if (state.blockedUntil > Date.now()) return;
    if (state.captchaRequired && !state.captchaToken) { dom.captchaStatus.textContent = 'Potwierdź CAPTCHA.'; return; }
    dom.loginButton.disabled = true; setError('');
    try {
      await fetchJson('/api/stats/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: dom.password.value, turnstileToken: state.captchaToken }) });
      dom.password.value = ''; await loadStats();
    } catch (error) {
      if (['captcha_required','captcha_invalid'].includes(error.code)) { setCaptcha(true); resetCaptcha(); dom.captchaStatus.textContent = error.message; }
      else if (error.code === 'blocked') { setCaptcha(true); resetCaptcha(); startBlock(error.retryAfterSeconds || 600); }
      else setError(error.message);
    } finally { dom.loginButton.disabled = false; }
  });
  dom.logout.addEventListener('click', async function () { await fetchJson('/api/stats/auth', { method: 'DELETE' }).catch(function () {}); state.data = null; state.sitemap = null; setLoggedIn(false); setError(''); });
  dom.refresh.addEventListener('click', async function () { dom.refresh.disabled = true; try { await loadStats(); } catch (error) { setError(error.message); if (error.message === 'Brak autoryzacji.') setLoggedIn(false); } finally { dom.refresh.disabled = false; } });
  dom.tabs.addEventListener('click', function (event) { var button = event.target.closest('[data-tab]'); if (button) selectTab(button.dataset.tab); });
  dom.ranges.addEventListener('click', async function (event) {
    var button = event.target.closest('[data-range]'); if (!button || button.dataset.range === state.range) return;
    state.range = button.dataset.range; dom.ranges.querySelectorAll('[data-range]').forEach(function (item) { item.classList.toggle('is-active', item === button); });
    try { await loadStats(); } catch (error) { setError(error.message); setLoggedIn(false); }
  });
  dom.seriesButtons.addEventListener('click', function (event) {
    var button = event.target.closest('[data-series]'); if (!button) return;
    var key = button.dataset.series; state.visible[key] = !state.visible[key];
    if (!Object.values(state.visible).some(Boolean)) state.visible[key] = true;
    renderSeriesButtons(); renderChart();
  });

  loadStats().catch(function (error) {
    setLoggedIn(false);
    if (error.message !== 'Brak autoryzacji.') setError(error.message);
  });
})();
