/**
 * Ustawienia rezerwacji online z Worker API (/api/public/bootstrap).
 * Bez włączonego backendu rezerwacji wszystkie moduły są wyłączone.
 */
(function () {
  const DEFAULTS = { restaurant: false, hotel: false, events: false };
  const HEALTH_TTL_MS = 90 * 1000;
  const BOOTSTRAP_TTL_MS = 45 * 1000;
  const BOOTSTRAP_CACHE_KEY = "sredzka-korona:bootstrap-cache:v1";
  let healthCache = { ts: 0, values: null };
  let bootstrapCache = { ts: 0, payload: null };

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

  function sessionStorageSafe() {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  }

  function readBootstrapCache() {
    const now = Date.now();
    if (bootstrapCache.payload && now - bootstrapCache.ts < BOOTSTRAP_TTL_MS) {
      return bootstrapCache.payload;
    }
    const storage = sessionStorageSafe();
    if (!storage) return null;
    try {
      const raw = storage.getItem(BOOTSTRAP_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || now - Number(parsed.ts || 0) >= BOOTSTRAP_TTL_MS || !parsed.payload) {
        return null;
      }
      bootstrapCache = {
        ts: Number(parsed.ts || 0),
        payload: parsed.payload,
      };
      return parsed.payload;
    } catch {
      return null;
    }
  }

  function writeBootstrapCache(payload) {
    const now = Date.now();
    bootstrapCache = { ts: now, payload };
    const storage = sessionStorageSafe();
    if (!storage) return;
    try {
      storage.setItem(
        BOOTSTRAP_CACHE_KEY,
        JSON.stringify({
          ts: now,
          payload,
        })
      );
    } catch {
      /* ignore storage errors */
    }
  }

  function clearBootstrapCache() {
    bootstrapCache = { ts: 0, payload: null };
    const storage = sessionStorageSafe();
    if (!storage) return;
    try {
      storage.removeItem(BOOTSTRAP_CACHE_KEY);
    } catch {
      /* ignore */
    }
  }

  async function loadBootstrapPayload(base, { forceRefresh = false } = {}) {
    if (forceRefresh) {
      clearBootstrapCache();
    } else {
      const cached = readBootstrapCache();
      if (cached) {
        return cached;
      }
    }
    const r = await fetch(base + "/api/public/bootstrap", { cache: "no-store" });
    if (!r.ok) {
      throw new Error("bootstrap unavailable");
    }
    const payload = await r.json();
    writeBootstrapCache(payload);
    return payload;
  }

  function bookingFnBase(moduleKey) {
    const cfg = window.SREDZKA_CONFIG || {};
    const map = {
      restaurant: { cfgKey: "restaurantApiBase", fnName: "restaurantApi", service: "restaurant" },
      hotel: { cfgKey: "hotelApiBase", fnName: "hotelApi", service: "hotel" },
      events: { cfgKey: "hallApiBase", fnName: "hallApi", service: "hall" },
    };
    const item = map[moduleKey];
    if (!item) return "";
    const explicit = String(cfg[item.cfgKey] || "").trim();
    if (explicit) {
      return explicit.replace(/\/$/, "");
    }
    const apiBase = String(cfg.apiBase || "").trim();
    if (apiBase) {
      return `${apiBase.replace(/\/$/, "")}/api/public/legacy-bookings/${item.service}`;
    }
    const projectId = String(cfg.firebaseProjectId || "").trim();
    if (!projectId) return "";
    return `https://europe-west1-${projectId}.cloudfunctions.net/${item.fnName}`;
  }

  async function loadHealthFlags({ forceRefresh = false } = {}) {
    const now = Date.now();
    if (!forceRefresh && healthCache.values && now - healthCache.ts < HEALTH_TTL_MS) {
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
          const r = await fetch(`${base}?op=health`, { method: "GET", cache: "no-store" });
          out[key] = r.ok;
        } catch {
          out[key] = false;
        }
      })
    );
    healthCache = { ts: now, values: out };
    return out;
  }

  window.SREDZKA_fetchBookingSettings = async function fetchBookingSettings(options = {}) {
    const refresh = Boolean(options && options.refresh);
    const cfg = window.SREDZKA_CONFIG || {};
    if (cfg.enableOnlineBookings !== true) {
      return { ...DEFAULTS };
    }
    const base = publicApiBase();
    if (!base) {
      return { ...DEFAULTS };
    }
    try {
      const payload = await loadBootstrapPayload(base, { forceRefresh: refresh });
      const b = payload.content?.booking || {};
      const health = await loadHealthFlags({ forceRefresh: refresh });
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
