/**
 * Ustawienia rezerwacji online z Worker API (/api/public/bootstrap).
 * Bez apiBase / poza domeną — domyślnie wszystkie moduły włączone (np. lokalny podgląd).
 */
(function () {
  const DEFAULTS = { restaurant: true, hotel: true, events: true };

  function publicApiBase() {
    const cfg = window.SREDZKA_CONFIG || {};
    if (cfg.apiBase) {
      return String(cfg.apiBase).replace(/\/$/, "");
    }
    const hostname = window.location.hostname;
    const protocol = window.location.protocol;
    const isLocal = protocol === "file:" || hostname === "127.0.0.1" || hostname === "localhost";
    const isGithubPages = hostname.endsWith("github.io");
    if (isGithubPages) {
      return "";
    }
    if (isLocal) {
      return "";
    }
    if (hostname) {
      return "https://api." + hostname.replace(/^www\./, "");
    }
    return "";
  }

  function todayYmdLocal() {
    const t = new Date();
    const y = t.getFullYear();
    const mo = String(t.getMonth() + 1).padStart(2, "0");
    const d = String(t.getDate()).padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }

  /** YYYY-MM-DD, oba ustawione, dzisiaj w [from, to] włącznie (czas lokalny przeglądarki). */
  function isInPauseRange(fromStr, toStr) {
    const from = String(fromStr || "").trim();
    const to = String(toStr || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return false;
    }
    if (from > to) {
      return false;
    }
    const today = todayYmdLocal();
    return today >= from && today <= to;
  }

  function effectiveEnabled(moduleEnabled, pauseFrom, pauseTo) {
    if (moduleEnabled === false) {
      return false;
    }
    if (isInPauseRange(pauseFrom, pauseTo)) {
      return false;
    }
    return true;
  }

  window.SREDZKA_fetchBookingSettings = async function fetchBookingSettings() {
    const base = publicApiBase();
    if (!base) {
      return { ...DEFAULTS };
    }
    try {
      const r = await fetch(base + "/api/public/bootstrap");
      if (!r.ok) {
        return { ...DEFAULTS };
      }
      const payload = await r.json();
      const b = payload.content?.booking || {};
      return {
        restaurant: effectiveEnabled(b.restaurant !== false, b.restaurantPauseFrom, b.restaurantPauseTo),
        hotel: effectiveEnabled(b.hotel !== false, b.hotelPauseFrom, b.hotelPauseTo),
        events: effectiveEnabled(b.events !== false, b.eventsPauseFrom, b.eventsPauseTo),
      };
    } catch {
      return { ...DEFAULTS };
    }
  };
})();
