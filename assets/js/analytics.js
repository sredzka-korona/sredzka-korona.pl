(function initSredzkaAnalytics() {
  'use strict';

  if (window.__sredzkaAnalyticsMounted) return;
  window.__sredzkaAnalyticsMounted = true;

  var SESSION_PREFIX = 'sredzka-page-visit:v1:';
  var config = window.SREDZKA_CONFIG || {};
  var isLocalPreview = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  var apiBase = isLocalPreview ? window.location.origin : String(config.apiBase || '').replace(/\/$/, '');

  function getConsentChoice() {
    var consent = window.sredzkaCookieConsent;
    return consent && typeof consent.getValidChoice === 'function' ? consent.getValidChoice() : null;
  }

  function hasAnalyticsConsent() {
    var choice = getConsentChoice();
    return Boolean(choice && choice.analytics);
  }

  function hasMarketingConsent() {
    var choice = getConsentChoice();
    return Boolean(choice && choice.marketing);
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

  function normalizeSendTo(value) {
    var values = Array.isArray(value) ? value : [value];
    return values.map(function (item) {
      return String(item || '').trim();
    }).filter(function (item) {
      return /^AW-\d+\/[A-Za-z0-9_-]+$/.test(item);
    });
  }

  function sendGoogleEvent(eventName, params, conversionConfigKey, conversionParams) {
    if (typeof window.gtag !== 'function') return false;

    var sent = false;
    var eventParams = Object.assign({}, params || {});

    var analyticsDestination = String(config.googleAnalyticsMeasurementId || '').trim();
    if (hasAnalyticsConsent() && /^G-[A-Z0-9]+$/.test(analyticsDestination)) {
      window.gtag('event', eventName, Object.assign({}, eventParams, {
        send_to: analyticsDestination
      }));
      sent = true;
    }

    var adsConfig = config.googleAdsConversions || {};
    var destinations = normalizeSendTo(adsConfig[conversionConfigKey]);
    if (destinations.length) {
      // Google Ads has built-in Consent Mode checks. With ad_storage denied it
      // sends a cookieless conversion ping instead of storing advertising data.
      // Gating the event here would prevent both direct and modeled measurement.
      window.gtag('event', 'conversion', Object.assign({}, eventParams, conversionParams || {}, {
        send_to: destinations.length === 1 ? destinations[0] : destinations,
        value: 1.0,
        currency: 'PLN'
      }));
      sent = true;
    }

    return sent;
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
    var cleanFormLabel = cleanLabel(label || 'Formularz kontaktowy');
    var internalSent = send('contact_form_submit', { label: cleanFormLabel });
    var googleSent = sendGoogleEvent('generate_lead', {
      method: 'contact_form',
      form_name: cleanFormLabel,
      page_location: window.location.href
    }, 'contactFormSendTo');
    return internalSent || googleSent;
  };

  document.addEventListener('click', function (event) {
    var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!link) return;
    var href = String(link.getAttribute('href') || '').trim();
    var label = cleanLabel(link.getAttribute('aria-label') || link.textContent || href);
    if (/^tel:/i.test(href)) {
      var phoneLabel = label || 'Telefon';
      var phoneDestinations = normalizeSendTo((config.googleAdsConversions || {}).phoneClickSendTo);
      var shouldWaitForAds = hasMarketingConsent() && phoneDestinations.length > 0 && typeof event.preventDefault === 'function';
      var continueToPhone = null;

      if (shouldWaitForAds) {
        event.preventDefault();
        var navigationStarted = false;
        var fallbackTimer = null;
        continueToPhone = function () {
          if (navigationStarted) return;
          navigationStarted = true;
          if (fallbackTimer != null && typeof window.clearTimeout === 'function') {
            window.clearTimeout(fallbackTimer);
          }
          window.location.href = href;
        };
        if (typeof window.setTimeout === 'function') {
          fallbackTimer = window.setTimeout(continueToPhone, 1000);
        }
      }

      send('contact_phone_click', { label: phoneLabel });
      sendGoogleEvent('phone_call_click', {
        method: 'phone',
        link_url: href,
        link_text: phoneLabel,
        page_location: window.location.href
      }, 'phoneClickSendTo', continueToPhone ? {
        event_callback: continueToPhone,
        event_timeout: 1000
      } : null);
    }
    else if (/^mailto:/i.test(href)) {
      var emailLabel = label || 'E-mail';
      send('contact_email_click', { label: emailLabel });
      sendGoogleEvent('email_click', {
        method: 'email',
        link_url: href,
        link_text: emailLabel,
        page_location: window.location.href
      });
    }
    else if (/google\.[^/]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/i.test(href)) send('contact_map_click', { label: label || 'Mapa / adres' });
  }, true);

  window.addEventListener('sredzka:consent-changed', function (event) {
    if (event.detail && event.detail.analytics) trackVisit();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', trackVisit, { once: true });
  else trackVisit();
})();
