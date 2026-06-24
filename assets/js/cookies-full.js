/**
 * Średzka Korona - unified cookie banner and panel.
 * Rendered on pages that do not already include the inline homepage version.
 */
(function () {
  'use strict';

  if (window.__sredzkaCookieWidgetMounted) {
    return;
  }
  window.__sredzkaCookieWidgetMounted = true;

  var DOCS_HREF = new URL('../dokumenty/', window.location.href).href;
  var STYLE_ID = 'sredzka-cookie-widget-style';
  var floatBtn = null;
  var overlay = null;
  var banner = null;

  function getChoice() {
    return window.sredzkaCookieConsent ? window.sredzkaCookieConsent.getValidChoice() : null;
  }

  function persistChoice(value, action) {
    var record = window.sredzkaCookieConsent
      ? window.sredzkaCookieConsent.saveChoice(value, action)
      : value;

    if (window.sredzkaGoogleConsent) {
      window.sredzkaGoogleConsent.grant(!!record.analytics, !!record.marketing);
    }
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .cookie-banner {
        position: fixed;
        left: 50%;
        transform: translateX(-50%);
        bottom: 2rem;
        width: min(800px, calc(100vw - 2rem));
        max-width: none;
        z-index: 1002;
        padding: 1rem 1.5rem;
        border: 1px solid var(--line);
        border-radius: var(--radius-xl);
        background: var(--bg-elevated);
        box-shadow: var(--shadow);
        font-family: "Manrope", sans-serif;
        color: var(--text);
        line-height: 1.5;
      }

      .cookie-banner .eyebrow {
        margin: 0 0 1rem;
        color: var(--gold);
        font-size: 0.85rem;
        letter-spacing: 0.15em;
        text-transform: uppercase;
        font-weight: 600;
      }

      .cookie-banner strong {
        display: block;
        font-size: inherit;
        font-weight: 700;
        color: #241b14;
        margin-bottom: 0.5rem;
      }

      .cookie-banner p {
        margin: 0;
        line-height: 1.5;
        color: var(--muted);
        font-size: inherit;
      }

      .cookie-banner .cookie-actions {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
        gap: 0.5rem;
        margin-top: 0.55rem;
      }

      .cookie-banner .cookie-actions .button {
        width: 100%;
        min-width: 0;
        text-align: center;
        padding: 0.58rem 0.85rem;
        font-size: 0.95rem;
      }

      .cookie-banner .button {
        border: 1px solid rgba(200, 170, 120, 0.5);
        border-radius: 999px;
        padding: 0.9rem 1.4rem;
        background: linear-gradient(135deg, rgba(230, 222, 205, 0.95), rgba(225, 215, 195, 0.92));
        color: #2a241c;
        cursor: pointer;
        transition: transform 180ms ease, border-color 180ms ease, background 180ms ease;
      }

      .cookie-banner .button:hover,
      .cookie-banner .button:focus-visible {
        transform: translateY(-2px);
        border-color: rgba(232, 216, 184, 0.95);
        background: linear-gradient(135deg, rgba(240, 235, 225, 0.98), rgba(230, 222, 205, 0.95));
      }

      .cookie-banner .button.secondary {
        background: rgba(255, 252, 247, 0.82);
        color: var(--text);
      }

      .cookie-banner .button.primary {
        background: linear-gradient(135deg, #c9a96e, #b8924a);
        color: #fff;
        border-color: #b8924a;
        font-weight: 600;
        box-shadow: 0 2px 8px rgba(184, 146, 74, 0.35);
      }

      .cookie-banner .button.primary:hover,
      .cookie-banner .button.primary:focus-visible {
        background: linear-gradient(135deg, #d4b87a, #c9a96e);
        border-color: #c9a96e;
        box-shadow: 0 4px 14px rgba(184, 146, 74, 0.5);
      }

      .cookie-float-btn {
        position: fixed;
        top: auto;
        left: 0.5rem;
        right: auto;
        bottom: calc(0.5rem + env(safe-area-inset-bottom, 0px));
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: transparent;
        border: none;
        color: var(--text);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 19px;
        box-shadow: none;
        opacity: 0.65;
        transition: opacity 0.3s ease;
        z-index: 98;
        cursor: pointer;
        padding: 0;
        line-height: 1;
        transform: translateZ(0);
        backface-visibility: hidden;
      }

      .cookie-float-btn:hover {
        transform: none;
        background: transparent;
        opacity: 0.65;
      }

      .cookie-float-btn:active {
        transform: translateZ(0) scale(0.95);
      }

      .cookie-overlay {
        position: fixed;
        inset: 0;
        z-index: 500;
        display: flex;
        align-items: flex-end;
        justify-content: center;
        padding: 16px;
        background: rgba(0, 0, 0, 0.45);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
      }

      .cookie-overlay[aria-hidden="true"] {
        display: none;
      }

      .cookie-overlay[aria-hidden="false"] {
        animation: cookie-fade-in 0.25s ease;
      }

      @keyframes cookie-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      .cookie-panel {
        width: min(800px, 98vw);
        background: var(--bg-elevated);
        border: 1px solid var(--line);
        border-radius: var(--radius-xl);
        padding: 24px;
        box-shadow: 0 -12px 60px rgba(0, 0, 0, 0.18), var(--shadow);
        animation: cookie-slide-up 0.35s ease;
      }

      @keyframes cookie-slide-up {
        from { transform: translateY(40px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }

      .cookie-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 12px;
      }

      .cookie-icon {
        font-size: 28px;
        line-height: 1;
      }

      .cookie-header h2 {
        font-family: 'Cormorant Garamond', serif;
        font-size: 20px;
        font-weight: 700;
        margin: 0;
        color: var(--text);
        letter-spacing: 0.5px;
      }

      .cookie-desc {
        font-size: 13px;
        color: var(--muted);
        line-height: 1.65;
        margin-bottom: 18px;
      }

      .cookie-desc strong {
        color: var(--text);
      }

      .cookie-options {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-bottom: 16px;
      }

      .cookie-option {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        padding: 12px 14px;
        background: rgba(200, 170, 120, 0.04);
        border: 1px solid var(--line);
        border-radius: 16px;
      }

      .cookie-option-info strong {
        font-size: 13px;
        color: var(--text);
        display: block;
        margin-bottom: 2px;
      }

      .cookie-option-info p {
        font-size: 12px;
        color: var(--muted);
        margin: 0;
        line-height: 1.5;
      }

      .cookie-toggle {
        position: relative;
        display: inline-block;
        width: 46px;
        height: 26px;
        flex-shrink: 0;
        cursor: pointer;
      }

      .cookie-toggle input {
        opacity: 0;
        width: 0;
        height: 0;
      }

      .cookie-toggle-slider {
        position: absolute;
        cursor: pointer;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(107, 93, 79, 0.15);
        border-radius: 26px;
        transition: background 0.25s ease;
      }

      .cookie-toggle-slider::before {
        content: "";
        position: absolute;
        height: 20px;
        width: 20px;
        left: 3px;
        bottom: 3px;
        background: #fff;
        border-radius: 50%;
        transition: transform 0.25s ease;
        box-shadow: 0 1px 4px rgba(0,0,0,0.12);
      }

      .cookie-toggle input:checked + .cookie-toggle-slider {
        background: var(--gold);
      }

      .cookie-toggle input:checked + .cookie-toggle-slider::before {
        transform: translateX(20px);
      }

      .cookie-toggle.is-locked {
        cursor: default;
        opacity: 0.75;
      }

      .cookie-toggle.is-locked .cookie-toggle-slider {
        background: rgba(90, 125, 58, 0.18);
      }

      .cookie-toggle.is-locked .cookie-toggle-slider::before {
        background: #f0f4ec;
      }

      .cookie-docs-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 16px;
      }

      .cookie-doc-link {
        font-size: 11px;
        font-weight: 600;
        background: transparent;
        border: 1px solid var(--line);
        color: var(--muted);
        padding: 6px 12px;
        border-radius: 10px;
        text-decoration: none;
        transition: all 0.2s;
        cursor: pointer;
        flex: 1;
        text-align: center;
        min-width: 0;
        font-family: inherit;
      }

      .cookie-doc-link:hover {
        border-color: var(--gold);
        color: var(--text);
        background: rgba(200, 170, 120, 0.06);
      }

      .cookie-actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }

      .cookie-btn {
        flex: 1;
        min-width: 120px;
        padding: 12px 20px;
        border-radius: 14px;
        font-size: 13px;
        font-weight: 700;
        font-family: inherit;
        border: 1px solid;
        cursor: pointer;
        transition: all 0.2s;
        letter-spacing: 0.3px;
      }

      .cookie-btn-save {
        border-color: var(--line);
        background: transparent;
        color: var(--text);
      }

      .cookie-btn-save:hover {
        border-color: var(--gold);
        background: rgba(200, 170, 120, 0.06);
      }

      .cookie-btn-all {
        border-color: var(--gold);
        background: var(--gold);
        color: #fff;
      }

      .cookie-btn-all:hover {
        background: #b8946a;
        box-shadow: 0 2px 16px rgba(168, 137, 90, 0.35);
      }

      @media (max-width: 780px) {
        .cookie-banner {
          left: 1rem;
          right: 1rem;
          bottom: 1rem;
          width: auto;
          transform: none;
          padding: 1.1rem 1.25rem;
        }

        .cookie-banner .cookie-actions {
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
          gap: 0.4rem;
        }

        .cookie-banner .cookie-actions .button {
          padding: 0.55rem 0.65rem;
          font-size: 0.85rem;
        }
      }

      @media (max-width: 820px) {
        .cookie-float-btn {
          left: 0.5rem;
          bottom: calc(0.5rem + env(safe-area-inset-bottom, 0px));
          width: 42px;
          height: 42px;
          font-size: 19px;
        }

        .cookie-panel {
          padding: 18px 14px;
          max-height: 92dvh;
          overflow-y: auto;
        }

        .cookie-docs-row {
          flex-wrap: wrap;
        }

        .cookie-actions {
          flex-direction: row;
          flex-wrap: nowrap;
        }

        .cookie-btn {
          min-width: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function buildFloatButton() {
    floatBtn = document.createElement('button');
    floatBtn.className = 'cookie-float-btn';
    floatBtn.id = 'cookieFloatBtn';
    floatBtn.type = 'button';
    floatBtn.title = 'Ustawienia plików cookie';
    floatBtn.setAttribute('aria-label', 'Zmień ustawienia cookies');
    floatBtn.textContent = '🍪';
    document.body.appendChild(floatBtn);
  }

  function buildPanel() {
    overlay = document.createElement('div');
    overlay.className = 'cookie-overlay';
    overlay.id = 'cookieOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Ustawienia plików cookie');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.hidden = true;

    overlay.innerHTML = `
      <div class="cookie-panel">
        <div class="cookie-header">
          <span class="cookie-icon" aria-hidden="true">🍪</span>
          <h2>Pliki cookie i prywatność</h2>
        </div>
        <p class="cookie-desc">
          Ta strona korzysta z plików cookies niezbędnych do prawidłowego działania oraz — za Twoją zgodą — z cookies analitycznych i marketingowych. Możesz zaakceptować wszystkie, odrzucić opcjonalne albo dostosować ustawienia.
        </p>

        <div class="cookie-options">
          <div class="cookie-option">
            <div class="cookie-option-info">
              <strong>Niezbędne</strong>
              <p>Zawsze aktywne. Techniczne cookies potrzebne do działania strony, bezpieczeństwa, formularzy i zapamiętania zgód.</p>
            </div>
            <label class="cookie-toggle is-locked" aria-label="Niezbędne - zawsze aktywne">
              <input type="checkbox" checked disabled>
              <span class="cookie-toggle-slider"></span>
            </label>
          </div>
          <div class="cookie-option">
            <div class="cookie-option-info">
              <strong>Analityczne</strong>
              <p>Opcjonalne. Np. Google Analytics, statystyki odwiedzin, źródła wejść, zachowanie na stronie.</p>
            </div>
            <label class="cookie-toggle" aria-label="Przełącznik: Analityczne">
              <input type="checkbox" id="cookieToggle_analytics">
              <span class="cookie-toggle-slider"></span>
            </label>
          </div>
          <div class="cookie-option">
            <div class="cookie-option-info">
              <strong>Marketingowe</strong>
              <p>Opcjonalne. Np. Google Ads, remarketing, piksele reklamowe.</p>
            </div>
            <label class="cookie-toggle" aria-label="Przełącznik: Marketingowe">
              <input type="checkbox" id="cookieToggle_marketing">
              <span class="cookie-toggle-slider"></span>
            </label>
          </div>
          <div class="cookie-option">
            <div class="cookie-option-info">
              <strong>Zewnętrzne / multimedialne</strong>
              <p>Opcjonalne. Np. YouTube, Google Maps, osadzone treści społecznościowe.</p>
            </div>
            <label class="cookie-toggle" aria-label="Przełącznik: Zewnętrzne / multimedialne">
              <input type="checkbox" id="cookieToggle_external">
              <span class="cookie-toggle-slider"></span>
            </label>
          </div>
        </div>

        <div class="cookie-docs-row">
          <a class="cookie-doc-link" href="${DOCS_HREF}">Dokumenty: Polityka prywatności i cookies oraz informacja RODO</a>
        </div>

        <div class="cookie-actions">
          <button class="cookie-btn cookie-btn-save" id="cookieSaveSettings" type="button">Zapisz ustawienia</button>
          <button class="cookie-btn cookie-btn-all" id="cookieAcceptAllBtn" type="button">Akceptuję wszystkie</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
  }

  function buildBanner() {
    if (window.sredzkaCookieConsent ? window.sredzkaCookieConsent.hasValidChoice() : getChoice()) {
      return;
    }

    banner = document.createElement('div');
    banner.className = 'cookie-banner';
    banner.innerHTML = `
      <p class="eyebrow">Cookies</p>
      <strong>Pliki cookie i prywatność</strong>
      <p style="margin:0.35rem 0 0; line-height:1.3;">
        Ta strona korzysta z plików cookies niezbędnych do prawidłowego działania oraz — za Twoją zgodą — z cookies analitycznych i marketingowych. Możesz zaakceptować wszystkie, odrzucić opcjonalne albo dostosować ustawienia.
        <span> Więcej informacji: <a href="${DOCS_HREF}" style="color:var(--gold); text-decoration:underline;">Dokumenty</a></span>
      </p>
      <div class="cookie-actions">
        <button class="button secondary" type="button" data-cookie-action="settings">Ustawienia</button>
        <button class="button secondary" type="button" data-cookie-action="necessary-only">Odrzucam opcjonalne</button>
        <button class="button primary" type="button" data-cookie-action="accept-all">Akceptuję wszystkie</button>
      </div>
    `;

    document.body.appendChild(banner);

    banner.querySelectorAll('[data-cookie-action]').forEach(function (button) {
      button.addEventListener('click', function () {
        var action = button.getAttribute('data-cookie-action');
        if (action === 'settings') {
          banner.remove();
          banner = null;
          openCookiePanel();
          return;
        }

        decideAll(action === 'accept-all');
        banner.remove();
        banner = null;
      });
    });
  }

  function updateCookiePanelState() {
    var choice = getChoice();
    ['analytics', 'marketing', 'external'].forEach(function (cat) {
      var toggle = document.getElementById('cookieToggle_' + cat);
      if (toggle) {
        toggle.checked = choice ? !!(cat === 'external' ? choice.external_media : choice[cat]) : false;
      }
    });
  }

  function openCookiePanel() {
    if (!overlay) {
      return;
    }
    updateCookiePanelState();
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
  }

  function closeCookiePanel() {
    if (!overlay) {
      return;
    }
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
  }

  function saveFromPanel() {
    var value = { necessary: true };
    ['analytics', 'marketing', 'external'].forEach(function (cat) {
      var toggle = document.getElementById('cookieToggle_' + cat);
      value[cat] = toggle ? toggle.checked : false;
    });
    persistChoice(value, 'save_preferences');
    closeCookiePanel();
  }

  function decideAll(acceptAll) {
    var value = acceptAll
      ? { necessary: true, analytics: true, marketing: true, external: true }
      : { necessary: true, analytics: false, marketing: false, external: false };
    persistChoice(value, acceptAll ? 'accept_all' : 'reject_all');
    closeCookiePanel();
  }

  function init() {
    injectStyles();
    buildFloatButton();
    buildPanel();
    buildBanner();

    floatBtn.addEventListener('click', openCookiePanel);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        closeCookiePanel();
      }
    });

    var saveBtn = document.getElementById('cookieSaveSettings');
    var acceptBtn = document.getElementById('cookieAcceptAllBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', saveFromPanel);
    }
    if (acceptBtn) {
      acceptBtn.addEventListener('click', function () {
        decideAll(true);
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay && overlay.hidden === false) {
        closeCookiePanel();
      }
    });

    var choice = getChoice();
    if (choice && window.sredzkaGoogleConsent) {
      window.sredzkaGoogleConsent.grant(!!choice.analytics, !!choice.marketing);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
