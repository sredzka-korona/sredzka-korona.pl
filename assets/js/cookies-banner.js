/**
 * Cookies Banner - samodzielny baner cookies
 * 
 * Działa niezależnie od CSS strony.
 * Sprawdza aktualny rekord zgody i jeśli brak decyzji, pokazuje banner.
 * Po podjęciu decyzji zapisuje ją i wywołuje window.sredzkaGoogleConsent.
 */
(function () {
  'use strict';

  // Nie pokazuj banera jeśli decyzja dla aktualnej wersji polityki już podjęta.
  if (window.sredzkaCookieConsent && window.sredzkaCookieConsent.hasValidChoice()) {
    return;
  }

  // --- Style CSS banera (wstrzyknięte do <head>) ---
  var style = document.createElement('style');
  style.textContent = [
    '.sk-cookie-banner {',
    '  position: fixed;',
    '  left: 1rem;',
    '  right: 1rem;',
    '  bottom: 1rem;',
    '  z-index: 1002;',
    '  max-width: 800px;',
    '  margin: 0 auto;',
    '  padding: 1.25rem 1.5rem;',
    '  border: 1px solid rgba(200,170,120,0.22);',
    '  border-radius: 24px;',
    '  background: rgba(255,255,255,0.98);',
    '  box-shadow: 0 24px 60px rgba(79,55,22,0.18);',
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
    '  margin: 0;',
    '  line-height: 1.5;',
    '  color: #4a3f35;',
    '  font-size: 0.9rem;',
    '}',
    '.sk-cookie-banner .sk-cookie-text a {',
    '  color: #c8aa78;',
    '  text-decoration: underline;',
    '}',
    '.sk-cookie-banner .sk-cookie-actions {',
    '  display: flex;',
    '  flex-wrap: wrap;',
    '  gap: 0.5rem;',
    '  margin-top: 0.8rem;',
    '}',
    '.sk-cookie-banner .sk-cookie-btn {',
    '  flex: 1 1 auto;',
    '  min-width: 100px;',
    '  padding: 0.6rem 1rem;',
    '  border: 1px solid rgba(200,170,120,0.3);',
    '  border-radius: 14px;',
    '  font-size: 0.88rem;',
    '  font-weight: 600;',
    '  font-family: inherit;',
    '  cursor: pointer;',
    '  background: transparent;',
    '  color: #1f1712;',
    '  transition: all 0.2s;',
    '  text-align: center;',
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
    '@media (max-width: 600px) {',
    '  .sk-cookie-banner .sk-cookie-actions {',
    '    flex-direction: column;',
    '  }',
    '  .sk-cookie-banner .sk-cookie-btn {',
    '    width: 100%;',
    '  }',
    '}'
  ].join('\n');
  document.head.appendChild(style);

  // --- Tworzenie banera ---
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

  // --- Funkcja zapisu decyzji ---
  function saveChoice(value, action) {
    var record = window.sredzkaCookieConsent
      ? window.sredzkaCookieConsent.saveChoice(value, action)
      : value;
    if (window.sredzkaGoogleConsent) {
      window.sredzkaGoogleConsent.grant(!!record.analytics, !!record.marketing);
    }
  }

  // --- Obsługa przycisków ---
  var buttons = banner.querySelectorAll('[data-sk-action]');
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener('click', function () {
      var action = this.getAttribute('data-sk-action');

      if (action === 'settings') {
        // Spróbuj otworzyć istniejący panel ustawień cookies
        banner.remove();
        if (typeof openCookiePanel === 'function') {
          openCookiePanel();
        }
        return;
      }

      var value;
      if (action === 'accept-all') {
        value = { necessary: true, analytics: true, marketing: true, external: true };
      } else {
        // necessary-only
        value = { necessary: true, analytics: false, marketing: false, external: false };
      }

      saveChoice(value, action === 'accept-all' ? 'accept_all' : 'reject_all');
      banner.remove();
    });
  }
})();
