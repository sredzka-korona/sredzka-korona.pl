/**
 * Średzka Korona – Unified Cookies
 * 
 * Samodzielny moduł: banner, floating icon, panel ustawień.
 * Wstrzykuje własne CSS, HTML i logikę – niezależnie od reszty strony.
 * Działa na KAŻDEJ stronie, do czasu podjęcia decyzji przez użytkownika.
 * Panel otwierany z ikony 🍪 jest IDENTYCZNY jak ten otwierany przez "Ustawienia" z banera.
 */
(function () {
  'use strict';

  // ═══════════ STYLES ═══════════
  var css = [
    /* === BANER (pierwszy panel) === */
    '.sk-cookie-banner {',
    '  position: fixed;',
    '  left: 50%;',
    '  transform: translateX(-50%);',
    '  bottom: 2rem;',
    '  width: min(800px, calc(100vw - 2rem));',
    '  max-width: none;',
    '  z-index: 1002;',
    '  padding: 1rem 1.5rem;',
    '  border: 1px solid rgba(200,170,120,0.2);',
    '  border-radius: 28px;',
    '  background: rgba(255,255,255,0.98);',
    '  box-shadow: 0 8px 32px rgba(0,0,0,0.08);',
    '  font-family: "Manrope", sans-serif;',
    '  color: #1f1712;',
    '  line-height: 1.5;',
    '  font-size: 0.95rem;',
    '}',
    '.sk-cookie-banner .sk-cookie-eyebrow {',
    '  font-size: 0.7rem;',
    '  text-transform: uppercase;',
    '  letter-spacing: 0.2em;',
    '  color: #c8aa78;',
    '  margin: 0 0 0.2rem 0;',
    '  font-weight: 700;',
    '}',
    '.sk-cookie-banner .sk-cookie-title {',
    '  display: block;',
    '  font-size: 1.1rem;',
    '  font-weight: 700;',
    '  color: #1f1712;',
    '  margin: 0 0 0.3rem 0;',
    '}',
    '.sk-cookie-banner .sk-cookie-text {',
    '  margin: 0.35rem 0 0;',
    '  line-height: 1.3;',
    '  color: #4a3f35;',
    '  font-size: 0.9rem;',
    '}',
    '.sk-cookie-banner .sk-cookie-text a {',
    '  color: #c8aa78;',
    '  text-decoration: underline;',
    '}',
    '.sk-cookie-banner .sk-cookie-actions {',
    '  display: grid;',
    '  grid-template-columns: minmax(0,1fr) minmax(0,1fr) minmax(0,1fr);',
    '  gap: 0.5rem;',
    '  margin-top: 0.55rem;',
    '}',
    '.sk-cookie-banner .sk-cookie-btn {',
    '  width: 100%;',
    '  min-width: 0;',
    '  text-align: center;',
    '  padding: 0.58rem 0.85rem;',
    '  font-size: 0.95rem;',
    '  border: 1px solid rgba(200,170,120,0.3);',
    '  border-radius: 14px;',
    '  font-weight: 600;',
    '  font-family: inherit;',
    '  cursor: pointer;',
    '  background: transparent;',
    '  color: #1f1712;',
    '  transition: all 0.2s;',
    '  white-space: nowrap;',
    '}',
    '.sk-cookie-banner .sk-cookie-btn:hover {',
    '  border-color: #c8aa78;',
    '  background: rgba(200,170,120,0.06);',
    '}',
    '.sk-cookie-banner .sk-cookie-btn-primary {',
    '  background: #c8aa78;',
    '  border-color: #c8aa78;',
    '  color: #fff;',
    '}',
    '.sk-cookie-banner .sk-cookie-btn-primary:hover {',
    '  background: #b8946a;',
    '  box-shadow: 0 2px 16px rgba(168,137,90,0.35);',
    '}',

    /* === FLOATING ICON 🍪 === */
    '.sk-cookie-float {',
    '  position: fixed;',
    '  left: 0.5rem;',
    '  bottom: calc(0.5rem + env(safe-area-inset-bottom, 0px));',
    '  width: 40px;',
    '  height: 40px;',
    '  border-radius: 50%;',
    '  background: transparent;',
    '  border: none;',
    '  color: #1f1712;',
    '  display: flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '  font-size: 19px;',
    '  opacity: 0.65;',
    '  transition: opacity 0.3s ease;',
    '  z-index: 98;',
    '  cursor: pointer;',
    '  padding: 0;',
    '  line-height: 1;',
    '}',

    /* === OVERLAY === */
    '.sk-cookie-overlay {',
    '  position: fixed;',
    '  inset: 0;',
    '  z-index: 500;',
    '  display: flex;',
    '  align-items: flex-end;',
    '  justify-content: center;',
    '  padding: 16px;',
    '  background: rgba(0,0,0,0.45);',
    '  backdrop-filter: blur(4px);',
    '  -webkit-backdrop-filter: blur(4px);',
    '}',
    '.sk-cookie-overlay[aria-hidden="true"] {',
    '  display: none;',
    '}',
    '.sk-cookie-overlay[aria-hidden="false"] {',
    '  animation: sk-cookie-fade-in 0.25s ease;',
    '}',
    '@keyframes sk-cookie-fade-in {',
    '  from { opacity: 0; }',
    '  to { opacity: 1; }',
    '}',

    /* === PANEL === */
    '.sk-cookie-panel {',
    '  width: min(800px, 98vw);',
    '  background: rgba(255,255,255,0.98);',
    '  border: 1px solid rgba(200,170,120,0.2);',
    '  border-radius: 28px;',
    '  padding: 24px;',
    '  box-shadow: 0 -12px 60px rgba(0,0,0,0.18), 0 8px 32px rgba(0,0,0,0.08);',
    '  animation: sk-cookie-slide-up 0.35s ease;',
    '}',
    '@keyframes sk-cookie-slide-up {',
    '  from { transform: translateY(40px); opacity: 0; }',
    '  to { transform: translateY(0); opacity: 1; }',
    '}',
    '.sk-cookie-header {',
    '  display: flex;',
    '  align-items: center;',
    '  gap: 12px;',
    '  margin-bottom: 12px;',
    '}',
    '.sk-cookie-icon {',
    '  font-size: 28px;',
    '  line-height: 1;',
    '}',
    '.sk-cookie-header h2 {',
    '  font-family: "Cormorant Garamond", serif;',
    '  font-size: 20px;',
    '  font-weight: 700;',
    '  margin: 0;',
    '  color: #1f1712;',
    '  letter-spacing: 0.5px;',
    '}',
    '.sk-cookie-desc {',
    '  font-size: 13px;',
    '  color: #6b5d4f;',
    '  line-height: 1.65;',
    '  margin-bottom: 18px;',
    '}',
    '.sk-cookie-options {',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 10px;',
    '  margin-bottom: 16px;',
    '}',
    '.sk-cookie-option {',
    '  display: flex;',
    '  align-items: center;',
    '  justify-content: space-between;',
    '  gap: 14px;',
    '  padding: 12px 14px;',
    '  background: rgba(200,170,120,0.04);',
    '  border: 1px solid rgba(200,170,120,0.2);',
    '  border-radius: 16px;',
    '}',
    '.sk-cookie-option-info strong {',
    '  font-size: 13px;',
    '  color: #1f1712;',
    '  display: block;',
    '  margin-bottom: 2px;',
    '}',
    '.sk-cookie-option-info p {',
    '  font-size: 12px;',
    '  color: #6b5d4f;',
    '  margin: 0;',
    '  line-height: 1.5;',
    '}',

    /* === TOGGLE === */
    '.sk-cookie-toggle {',
    '  position: relative;',
    '  display: inline-block;',
    '  width: 46px;',
    '  height: 26px;',
    '  flex-shrink: 0;',
    '  cursor: pointer;',
    '}',
    '.sk-cookie-toggle input {',
    '  opacity: 0;',
    '  width: 0;',
    '  height: 0;',
    '}',
    '.sk-cookie-toggle-slider {',
    '  position: absolute;',
    '  cursor: pointer;',
    '  top: 0;',
    '  left: 0;',
    '  right: 0;',
    '  bottom: 0;',
    '  background: rgba(107,93,79,0.15);',
    '  border-radius: 26px;',
    '  transition: background 0.25s ease;',
    '}',
    '.sk-cookie-toggle-slider::before {',
    '  content: "";',
    '  position: absolute;',
    '  height: 20px;',
    '  width: 20px;',
    '  left: 3px;',
    '  bottom: 3px;',
    '  background: #fff;',
    '  border-radius: 50%;',
    '  transition: transform 0.25s ease;',
    '  box-shadow: 0 1px 4px rgba(0,0,0,0.12);',
    '}',
    '.sk-cookie-toggle input:checked + .sk-cookie-toggle-slider {',
    '  background: #c8aa78;',
    '}',
    '.sk-cookie-toggle input:checked + .sk-cookie-toggle-slider::before {',
    '  transform: translateX(20px);',
    '}',
    '.sk-cookie-toggle.is-locked {',
    '  cursor: default;',
    '  opacity: 0.75;',
    '}',
    '.sk-cookie-toggle.is-locked .sk-cookie-toggle-slider {',
    '  background: rgba(90,125,58,0.18);',
    '}',
    '.sk-cookie-toggle.is-locked .sk-cookie-toggle-slider::before {',
    '  background: #f0f4ec;',
    '}',

    /* === DOCS LINK === */
    '.sk-cookie-docs-row {',
    '  display: flex;',
    '  flex-wrap: wrap;',
    '  gap: 8px;',
    '  margin-bottom: 16px;',
    '}',
    '.sk-cookie-doc-link {',
    '  font-size: 11px;',
    '  font-weight: 600;',
    '  background: transparent;',
    '  border: 1px solid rgba(200,170,120,0.2);',
    '  color: #6b5d4f;',
    '  padding: 6px 12px;',
    '  border-radius: 10px;',
    '  text-decoration: none;',
    '  transition: all 0.2s;',
    '  cursor: pointer;',
    '  flex: 1;',
    '  text-align: center;',
    '  min-width: 0;',
    '  font-family: inherit;',
    '}',
    '.sk-cookie-doc-link:hover {',
    '  border-color: #c8aa78;',
    '  color: #1f1712;',
    '  background: rgba(200,170,120,0.06);',
    '}',

    /* === PANEL ACTIONS === */
    '.sk-cookie-panel-actions {',
    '  display: flex;',
    '  gap: 10px;',
    '  flex-wrap: wrap;',
    '}',
    '.sk-cookie-panel-btn {',
    '  flex: 1;',
    '  min-width: 120px;',
    '  padding: 12px 20px;',
    '  border-radius: 14px;',
    '  font-size: 13px;',
    '  font-weight: 700;',
    '  font-family: inherit;',
    '  border: 1px solid;',
    '  cursor: pointer;',
    '  transition: all 0.2s;',
    '  letter-spacing: 0.3px;',
    '  text-align: center;',
    '}',
    '.sk-cookie-panel-btn-save {',
    '  border-color: rgba(200,170,120,0.2);',
    '  background: transparent;',
    '  color: #1f1712;',
    '}',
    '.sk-cookie-panel-btn-save:hover {',
    '  border-color: #c8aa78;',
    '  background: rgba(200,170,120,0.06);',
    '}',
    '.sk-cookie-panel-btn-all {',
    '  border-color: #c8aa78;',
    '  background: #c8aa78;',
    '  color: #fff;',
    '}',
    '.sk-cookie-panel-btn-all:hover {',
    '  background: #b8946a;',
    '  box-shadow: 0 2px 16px rgba(168,137,90,0.35);',
    '}',

    /* === RESPONSIVE === */
    '@media (max-width: 780px) {',
    '  .sk-cookie-banner {',
    '    left: 1rem;',
    '    right: 1rem;',
    '    bottom: 1rem;',
    '    width: auto;',
    '    transform: none;',
    '  }',
    '  .sk-cookie-banner .sk-cookie-actions {',
    '    grid-template-columns: minmax(0,1fr) minmax(0,1fr) minmax(0,1fr);',
    '    gap: 0.4rem;',
    '  }',
    '  .sk-cookie-banner .sk-cookie-btn {',
    '    padding: 0.55rem 0.65rem;',
    '    font-size: 0.85rem;',
    '  }',
    '}',
    '@media (max-width: 820px) {',
    '  .sk-cookie-float {',
    '    left: 0.5rem;',
    '    bottom: calc(0.5rem + env(safe-area-inset-bottom,0px));',
    '    width: 42px;',
    '    height: 42px;',
    '    font-size: 19px;',
    '  }',
    '  .sk-cookie-panel {',
    '    padding: 18px 14px;',
    '    max-height: 92dvh;',
    '    overflow-y: auto;',
    '  }',
    '  .sk-cookie-panel-actions {',
    '    flex-direction: column;',
    '  }',
    '  .sk-cookie-panel-btn {',
    '    min-width: 0;',
    '  }',
    '}',
    '@media (max-width: 400px) {',
    '  .sk-cookie-banner .sk-cookie-actions {',
    '    grid-template-columns: 1fr;',
    '  }',
    '}'
  ].join('\n');

  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ═══════════ HTML: FLOATING ICON ═══════════
  var floatBtn = document.createElement('button');
  floatBtn.className = 'sk-cookie-float';
  floatBtn.type = 'button';
  floatBtn.title = 'Ustawienia plików cookie';
  floatBtn.setAttribute('aria-label', 'Zmień ustawienia cookies');
  floatBtn.textContent = '\uD83C\uDF6A'; // 🍪
  document.body.appendChild(floatBtn);

  // ═══════════ HTML: OVERLAY + PANEL ═══════════
  var overlay = document.createElement('div');
  overlay.className = 'sk-cookie-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Ustawienia plików cookie');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.hidden = true;

  overlay.innerHTML =
    '<div class="sk-cookie-panel">' +
      '<div class="sk-cookie-header">' +
        '<span class="sk-cookie-icon" aria-hidden="true">\uD83C\uDF6A</span>' +
        '<h2>Pliki cookie i prywatność</h2>' +
      '</div>' +
      '<p class="sk-cookie-desc">' +
        'Ta strona korzysta z plików cookies niezbędnych do prawidłowego działania ' +
        'oraz — za Twoją zgodą — z cookies analitycznych i marketingowych. ' +
        'Możesz zaakceptować wszystkie, odrzucić opcjonalne albo dostosować ustawienia.' +
      '</p>' +
      '<div class="sk-cookie-options">' +
        '<div class="sk-cookie-option">' +
          '<div class="sk-cookie-option-info">' +
            '<strong>Niezbędne</strong>' +
            '<p>Zawsze aktywne. Techniczne cookies potrzebne do działania strony, bezpieczeństwa, formularzy i zapamiętania zgód.</p>' +
          '</div>' +
          '<label class="sk-cookie-toggle is-locked" aria-label="Niezbędne — zawsze aktywne">' +
            '<input type="checkbox" checked disabled>' +
            '<span class="sk-cookie-toggle-slider"></span>' +
          '</label>' +
        '</div>' +
        '<div class="sk-cookie-option">' +
          '<div class="sk-cookie-option-info">' +
            '<strong>Analityczne</strong>' +
            '<p>Opcjonalne. Np. Google Analytics, statystyki odwiedzin, źródła wejść, zachowanie na stronie.</p>' +
          '</div>' +
          '<label class="sk-cookie-toggle" aria-label="Przełącznik: Analityczne">' +
            '<input type="checkbox" id="skCookieToggle_analytics">' +
            '<span class="sk-cookie-toggle-slider"></span>' +
          '</label>' +
        '</div>' +
        '<div class="sk-cookie-option">' +
          '<div class="sk-cookie-option-info">' +
            '<strong>Marketingowe</strong>' +
            '<p>Opcjonalne. Np. Google Ads, remarketing, piksele reklamowe.</p>' +
          '</div>' +
          '<label class="sk-cookie-toggle" aria-label="Przełącznik: Marketingowe">' +
            '<input type="checkbox" id="skCookieToggle_marketing">' +
            '<span class="sk-cookie-toggle-slider"></span>' +
          '</label>' +
        '</div>' +
        '<div class="sk-cookie-option">' +
          '<div class="sk-cookie-option-info">' +
            '<strong>Zewnętrzne / multimedialne</strong>' +
            '<p>Opcjonalne. Np. YouTube, Google Maps, osadzone treści społecznościowe.</p>' +
          '</div>' +
          '<label class="sk-cookie-toggle" aria-label="Przełącznik: Zewnętrzne / multimedialne">' +
            '<input type="checkbox" id="skCookieToggle_external">' +
            '<span class="sk-cookie-toggle-slider"></span>' +
          '</label>' +
        '</div>' +
      '</div>' +
      '<div class="sk-cookie-docs-row">' +
        '<a class="sk-cookie-doc-link" href="/dokumenty/">Dokumenty: Polityka prywatności i cookies oraz informacja RODO</a>' +
      '</div>' +
      '<div class="sk-cookie-panel-actions">' +
        '<button class="sk-cookie-panel-btn sk-cookie-panel-btn-save" id="skCookieSaveSettings" type="button">Zapisz ustawienia</button>' +
        '<button class="sk-cookie-panel-btn sk-cookie-panel-btn-all" id="skCookieAcceptAllBtn" type="button">Akceptuję wszystkie</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);

  // ═══════════ LOGIKA ═══════════

  function getChoice() {
    try {
      return JSON.parse(localStorage.getItem('sredzka-cookies-choice')) || null;
    } catch(e) { return null; }
  }

  function saveChoice(value) {
    localStorage.setItem('sredzka-cookies-choice', JSON.stringify(value));
    if (window.sredzkaGoogleConsent) {
      window.sredzkaGoogleConsent.grant(!!value.analytics, !!value.marketing);
    }
  }

  function updatePanelToggles() {
    var choice = getChoice();
    var cats = ['analytics', 'marketing', 'external'];
    for (var i = 0; i < cats.length; i++) {
      var toggle = document.getElementById('skCookieToggle_' + cats[i]);
      if (toggle) {
        toggle.checked = choice ? !!choice[cats[i]] : false;
      }
    }
  }

  function openPanel() {
    updatePanelToggles();
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
  }

  function closePanel() {
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
  }

  function saveFromPanel() {
    var value = { necessary: true };
    var cats = ['analytics', 'marketing', 'external'];
    for (var i = 0; i < cats.length; i++) {
      var toggle = document.getElementById('skCookieToggle_' + cats[i]);
      value[cats[i]] = toggle ? toggle.checked : false;
    }
    saveChoice(value);
    closePanel();
  }

  function decideAll(acceptAll) {
    var value = acceptAll
      ? { necessary: true, analytics: true, marketing: true, external: true }
      : { necessary: true, analytics: false, marketing: false, external: false };
    saveChoice(value);
    closePanel();
  }

  // ═══════════ EVENTY ═══════════

  // Floating icon → open panel
  floatBtn.addEventListener('click', openPanel);

  // Overlay backdrop → close
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) {
      closePanel();
    }
  });

  // Panel buttons
  var saveBtn = document.getElementById('skCookieSaveSettings');
  var acceptBtn = document.getElementById('skCookieAcceptAllBtn');
  if (saveBtn) saveBtn.addEventListener('click', saveFromPanel);
  if (acceptBtn) acceptBtn.addEventListener('click', function() { decideAll(true); });

  // Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && !overlay.hidden) {
      closePanel();
    }
  });

  // Expose globally for external callers
  window.skOpenCookiePanel = openPanel;
  window.skCloseCookiePanel = closePanel;

  // ═══════════ BANER (jeśli brak decyzji) ═══════════
  if (getChoice()) {
    // Decyzja już podjęta — nie pokazuj banera
    return;
  }

  var banner = document.createElement('div');
  banner.className = 'sk-cookie-banner';
  banner.innerHTML =
    '<p class="sk-cookie-eyebrow">Cookies</p>' +
    '<span class="sk-cookie-title">Pliki cookie i prywatność</span>' +
    '<p class="sk-cookie-text">' +
      'Ta strona korzysta z plików cookies niezbędnych do prawidłowego działania ' +
      'oraz — za Twoją zgodą — z cookies analitycznych i marketingowych. ' +
      'Możesz zaakceptować wszystkie, odrzucić opcjonalne albo dostosować ustawienia. ' +
      '<span>Więcej informacji: <a href="/dokumenty/">Dokumenty</a></span>' +
    '</p>' +
    '<div class="sk-cookie-actions">' +
      '<button class="sk-cookie-btn" type="button" data-sk-action="settings">Ustawienia</button>' +
      '<button class="sk-cookie-btn" type="button" data-sk-action="necessary-only">Odrzucam opcjonalne</button>' +
      '<button class="sk-cookie-btn sk-cookie-btn-primary" type="button" data-sk-action="accept-all">Akceptuję wszystkie</button>' +
    '</div>';

  document.body.appendChild(banner);

  // Banner buttons
  var bannerBtns = banner.querySelectorAll('[data-sk-action]');
  for (var i = 0; i < bannerBtns.length; i++) {
    bannerBtns[i].addEventListener('click', function() {
      var action = this.getAttribute('data-sk-action');

      if (action === 'settings') {
        banner.remove();
        openPanel();
        return;
      }

      decideAll(action === 'accept-all');
      banner.remove();
    });
  }

})();
