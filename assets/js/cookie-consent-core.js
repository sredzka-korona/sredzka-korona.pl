(function () {
  'use strict';

  if (window.sredzkaCookieConsent) {
    return;
  }

  var STORAGE_KEY = 'sredzka-cookies-choice';
  var ANONYMOUS_USER_KEY = 'sredzka-cookies-anonymous-user-id';
  var POLICY_VERSION = '1.0';
  var REALTIME_DATABASE_URL = 'https://sredzka-korona-default-rtdb.europe-west1.firebasedatabase.app';
  var CONSENTS_PATH = 'cookie_consents';

  function createUuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }

    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (char) {
      var value = Math.floor(Math.random() * 16);
      var next = char === 'x' ? value : (value & 0x3) | 0x8;
      return next.toString(16);
    });
  }

  function readJson(key) {
    try {
      return JSON.parse(window.localStorage.getItem(key)) || null;
    } catch (error) {
      return null;
    }
  }

  function writeJson(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {}
  }

  function getAnonymousUserId() {
    var existing = '';
    try {
      existing = window.localStorage.getItem(ANONYMOUS_USER_KEY) || '';
    } catch (error) {}

    if (existing) {
      return existing;
    }

    var next = createUuid();
    try {
      window.localStorage.setItem(ANONYMOUS_USER_KEY, next);
    } catch (error) {}
    return next;
  }

  function getStoredChoice() {
    return readJson(STORAGE_KEY);
  }

  function isCurrentPolicyChoice(choice) {
    return !!(
      choice &&
      choice.policy_version === POLICY_VERSION &&
      choice.consent_id &&
      choice.anonymous_user_id
    );
  }

  function getValidChoice() {
    var choice = getStoredChoice();
    return isCurrentPolicyChoice(choice) ? choice : null;
  }

  function getGoogleConsentState(choice) {
    var analytics = !!(choice && choice.analytics);
    var marketing = !!(choice && choice.marketing);

    return {
      ad_storage: marketing ? 'granted' : 'denied',
      ad_user_data: marketing ? 'granted' : 'denied',
      ad_personalization: marketing ? 'granted' : 'denied',
      analytics_storage: analytics ? 'granted' : 'denied',
    };
  }

  function createRecord(choice, action) {
    var existing = getValidChoice();
    var now = new Date().toISOString();

    return {
      consent_id: existing ? existing.consent_id : createUuid(),
      created_at: existing ? existing.created_at : now,
      updated_at: now,
      policy_version: POLICY_VERSION,
      analytics: !!(choice && choice.analytics),
      marketing: !!(choice && choice.marketing),
      external_media: !!(choice && (choice.external_media || choice.external)),
      action: action || 'save_preferences',
      anonymous_user_id: existing ? existing.anonymous_user_id : getAnonymousUserId(),
    };
  }

  function persistRemote(record) {
    if (typeof window.fetch !== 'function') {
      return;
    }

    var url =
      REALTIME_DATABASE_URL.replace(/\/$/, '') +
      '/' +
      CONSENTS_PATH +
      '/' +
      encodeURIComponent(record.consent_id) +
      '.json';

    window
      .fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(record),
        keepalive: true,
      })
      .catch(function () {});
  }

  function saveChoice(choice, action) {
    var record = createRecord(choice, action);
    writeJson(STORAGE_KEY, record);
    persistRemote(record);
    return record;
  }

  window.sredzkaCookieConsent = {
    policyVersion: POLICY_VERSION,
    storageKey: STORAGE_KEY,
    anonymousUserKey: ANONYMOUS_USER_KEY,
    getStoredChoice: getStoredChoice,
    getValidChoice: getValidChoice,
    hasValidChoice: function () {
      return !!getValidChoice();
    },
    getAnonymousUserId: getAnonymousUserId,
    getGoogleConsentState: getGoogleConsentState,
    saveChoice: saveChoice,
  };
})();
