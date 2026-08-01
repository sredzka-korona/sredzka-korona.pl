(function initSredzkaAnalytics() {
  'use strict';

  if (window.__sredzkaAnalyticsMounted) return;
  window.__sredzkaAnalyticsMounted = true;

  var SESSION_PREFIX = 'sredzka-page-visit:v1:';
  var config = window.SREDZKA_CONFIG || {};
  var isLocalPreview = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  var apiBase = isLocalPreview ? window.location.origin : String(config.apiBase || '').replace(/\/$/, '');

  function hasAnalyticsConsent() {
    var consent = window.sredzkaCookieConsent;
    var choice = consent && typeof consent.getValidChoice === 'function' ? consent.getValidChoice() : null;
    return Boolean(choice && choice.analytics);
  }

  function normalizePath(value) {
    var path = String(value || '/').split('?')[0].split('#')[0].trim() || '/';
    return '/' + path.replace(/^\/+/, '').replace(/\/{2,}/g, '/');
  }

  function sectionFromPath(path) {
    var first = normalizePath(path).replace(/^\/+/, '').split('/')[0].toLowerCase();
    if (!first || first === 'index.html') return 'home';
    if (first === 'hotel') return 'hotel';
    if (first === 'catering') return 'catering';
    if (first === 'przyjecia') return 'przyjecia';
    if (first === 'kontakt') return 'kontakt';
    if (first === 'dokumenty') return 'dokumenty';
    if (first === 'f-and-q') return 'faq';
    if (first === 'stats' || first === 'admin') return first;
    return 'other';
  }

  function pageFromPath(path, section) {
    var clean = normalizePath(path).replace(/^\/+|\/+$/g, '').replace(/\/index\.html$/i, '');
    if (!clean || clean.toLowerCase() === 'index.html') return 'home';
    return clean || section;
  }

  function cleanLabel(value) {
    return String(value || '')
      .replace(/\s*[|–—-]\s*Średzka Korona.*$/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
  }

  function pageLabel(path, section) {
    var heading = document.querySelector('h1');
    var label = cleanLabel(heading && heading.textContent);
    if (!label) label = cleanLabel(document.title);
    if (label) return label;
    if (section === 'home') return 'Strona główna';
    return pageFromPath(path, section).replace(/[-_/]+/g, ' ').trim();
  }

  function createEventId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }

  function send(type, meta) {
    if (!hasAnalyticsConsent() || !apiBase || typeof window.fetch !== 'function') return false;
    var path = normalizePath(window.location.pathname);
    var section = String((meta && meta.section) || sectionFromPath(path));
    if (section === 'stats' || section === 'admin') return false;

    var payload = {
      clientEventId: createEventId(),
      type: type,
      page: String((meta && meta.page) || pageFromPath(path, section)),
      section: section,
      label: String((meta && meta.label) || pageLabel(path, section)),
      source: String((meta && meta.source) || 'main-site'),
      path: path
    };

    window.fetch(apiBase + '/api/public/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(function () {});
    return true;
  }

  function trackVisit() {
    var path = normalizePath(window.location.pathname);
    var section = sectionFromPath(path);
    if (section === 'stats' || section === 'admin' || !hasAnalyticsConsent()) return;
    var page = pageFromPath(path, section);
    var key = SESSION_PREFIX + page.toLowerCase();
    try {
      if (window.sessionStorage.getItem(key) === '1') return;
      window.sessionStorage.setItem(key, '1');
    } catch (error) {}
    send('visit', { page: page, section: section, label: pageLabel(path, section) });
  }

  window.sredzkaTrackEvent = function (type, meta) {
    return send(String(type || ''), meta || {});
  };
  window.sredzkaTrackContactForm = function (label) {
    return send('contact_form_submit', { label: label || 'Formularz kontaktowy' });
  };

  document.addEventListener('click', function (event) {
    var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!link) return;
    var href = String(link.getAttribute('href') || '').trim();
    var label = cleanLabel(link.getAttribute('aria-label') || link.textContent || href);
    if (/^tel:/i.test(href)) send('contact_phone_click', { label: label || 'Telefon' });
    else if (/^mailto:/i.test(href)) send('contact_email_click', { label: label || 'E-mail' });
    else if (/google\.[^/]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/i.test(href)) send('contact_map_click', { label: label || 'Mapa / adres' });
  }, true);

  window.addEventListener('sredzka:consent-changed', function (event) {
    if (event.detail && event.detail.analytics) trackVisit();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', trackVisit, { once: true });
  else trackVisit();
})();
