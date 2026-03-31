/**
 * Ustawienia rezerwacji online z Worker API (/api/public/bootstrap).
 * Bez włączonego backendu rezerwacji wszystkie moduły są wyłączone.
 */
(function () {
  const DEFAULTS = { restaurant: false, hotel: false, events: false };
  const HEALTH_TTL_MS = 5 * 60 * 1000;
  let healthCache = { ts: 0, values: null };

  function publicApiBase() {
    const cfg = window.SREDZKA_CONFIG || {};
    if (cfg.enableOnlineBookings !== true) {
      return "";
    }
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

  /** YYYY-MM-DD, oba ustawione, dzisiaj w [from, to] wlacznie (czas lokalny przegladarki). */
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

  function normalizePauseRanges(ranges, fallbackFrom, fallbackTo) {
    const source = Array.isArray(ranges) ? ranges : [];
    const normalized = source
      .map((entry) => {
        let from = String(entry?.from || "").trim().slice(0, 10);
        let to = String(entry?.to || "").trim().slice(0, 10);
        if (!from || !to) return null;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
        if (from > to) {
          const swap = from;
          from = to;
          to = swap;
        }
        return { from, to };
      })
      .filter(Boolean);
    if (normalized.length > 0) {
      return normalized;
    }
    const from = String(fallbackFrom || "").trim().slice(0, 10);
    const to = String(fallbackTo || "").trim().slice(0, 10);
    if (from && to) {
      return normalizePauseRanges([{ from, to }]);
    }
    return [];
  }

  function isPausedNow(pauseRanges, pauseFrom, pauseTo) {
    const ranges = normalizePauseRanges(pauseRanges, pauseFrom, pauseTo);
    return ranges.some((range) => isInPauseRange(range.from, range.to));
  }

  function effectiveEnabled(moduleEnabled, pauseRanges, pauseFrom, pauseTo) {
    if (moduleEnabled === false) {
      return false;
    }
    if (isPausedNow(pauseRanges, pauseFrom, pauseTo)) {
      return false;
    }
    return true;
  }

  function bookingFnBase(moduleKey) {
    const cfg = window.SREDZKA_CONFIG || {};
    const map = {
      restaurant: { cfgKey: "restaurantApiBase", fnName: "restaurantApi" },
      hotel: { cfgKey: "hotelApiBase", fnName: "hotelApi" },
      events: { cfgKey: "hallApiBase", fnName: "hallApi" },
    };
    const item = map[moduleKey];
    if (!item) return "";
    const explicit = String(cfg[item.cfgKey] || "").trim();
    if (explicit) {
      return explicit.replace(/\/$/, "");
    }
    const projectId = String(cfg.firebaseProjectId || "").trim();
    if (!projectId) return "";
    return `https://europe-west1-${projectId}.cloudfunctions.net/${item.fnName}`;
  }

  async function loadHealthFlags() {
    const now = Date.now();
    if (healthCache.values && now - healthCache.ts < HEALTH_TTL_MS) {
      return healthCache.values;
    }
    const out = { ...DEFAULTS };
    await Promise.all(
      Object.keys(out).map(async (key) => {
        const base = bookingFnBase(key);
        if (!base) {
          out[key] = false;
          return;
        }
        try {
          const r = await fetch(`${base}?op=health`, { method: "GET" });
          out[key] = r.ok;
        } catch {
          out[key] = false;
        }
      })
    );
    healthCache = { ts: now, values: out };
    return out;
  }

  window.SREDZKA_fetchBookingSettings = async function fetchBookingSettings() {
    const cfg = window.SREDZKA_CONFIG || {};
    if (cfg.enableOnlineBookings !== true) {
      return { ...DEFAULTS };
    }
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
      const health = await loadHealthFlags();
      return {
        restaurant:
          health.restaurant &&
          effectiveEnabled(
            b.restaurant !== false,
            b.restaurantPauseRanges,
            b.restaurantPauseFrom,
            b.restaurantPauseTo
          ),
        hotel:
          health.hotel &&
          effectiveEnabled(
            b.hotel !== false,
            b.hotelPauseRanges,
            b.hotelPauseFrom,
            b.hotelPauseTo
          ),
        events:
          health.events &&
          effectiveEnabled(
            b.events !== false,
            b.eventsPauseRanges,
            b.eventsPauseFrom,
            b.eventsPauseTo
          ),
      };
    } catch {
      return { ...DEFAULTS };
    }
  };
})();
