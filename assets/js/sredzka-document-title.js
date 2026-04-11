/**
 * Utrzymuje document.title zgodny z atrybutem data-sredzka-title na <html>.
 * Chroni przed nadpisaniem przez skrypty zewnętrzne / heurystyki przeglądarki.
 */
(function () {
  "use strict";
  var locked = document.documentElement.getAttribute("data-sredzka-title");
  if (!locked) return;

  function sync() {
    if (document.title !== locked) {
      document.title = locked;
    }
  }

  sync();

  var titleEl = document.querySelector("title");
  if (titleEl && typeof MutationObserver !== "undefined") {
    new MutationObserver(sync).observe(titleEl, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  window.addEventListener("load", sync);
  document.addEventListener("visibilitychange", sync);
})();
