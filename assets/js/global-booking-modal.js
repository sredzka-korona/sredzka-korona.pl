(function () {
  const config = window.SREDZKA_CONFIG || {};
  const SESSION_MS = 30 * 60 * 1000;
  const SESSION_REFRESH_LEEWAY_MS = 30 * 1000;
  const EMAIL_CONFIRM_MS = 2 * 60 * 60 * 1000;
  const DRAFT_STORAGE_KEY = "sredzka-korona:global-booking-draft:v1";
  const CONTACT_EMAIL = "kontakt@sredzka-korona.pl";
  const PAGE_VISIT_ID =
    window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  /** Podbij przy zmianach w modalu — wymusza odświeżenie cache CSS po wdrożeniu. */
  const GB_MODAL_ASSET_VERSION = "20260403-2";
  const SERVICE_KEYS = ["hotel", "restaurant", "events"];

  const SERVICE_META = {
    hotel: {
      label: "Hotel",
      subtitle: "Pokoje i noclegi",
      apiService: "hotel",
      confirmPath: "../dokumenty/index.html#regulamin-rezerwacji-hotel",
    },
    restaurant: {
      label: "Restauracja",
      subtitle: "Rezerwacja stolika",
      apiService: "restaurant",
      confirmPath: "../dokumenty/index.html#regulamin-rezerwacji-restauracja",
    },
    events: {
      label: "Przyjęcia",
      subtitle: "Sale i wydarzenia",
      apiService: "hall",
      confirmPath: "../dokumenty/index.html#regulamin-rezerwacji-sali",
    },
  };

  const FLOW_BY_SERVICE = {
    hotel: ["service", "hotelDates", "hotelRooms", "personal", "summary", "success"],
    restaurant: ["service", "restaurantDetails", "restaurantDateTime", "personal", "summary", "success"],
    events: ["service", "eventsGuests", "eventsDateTime", "eventsHall", "eventsDetails", "personal", "summary", "success"],
  };
  const RESTAURANT_PLACE_OPTIONS = ["no_preference", "inside", "terrace"];

  const state = {
    isOpen: false,
    step: "service",
    selectedService: "",
    sessionStartedAt: 0,
    bookingFlags: {
      hotel: true,
      restaurant: true,
      events: true,
    },
    error: "",
    submitting: false,
    turnstileToken: "",
    turnstileWidgetId: null,
    turnstileReady: false,
    turnstileFailed: false,
    humanCheck: false,
    countdownUntil: 0,
    countdownTimer: null,
    sessionRefreshTimer: null,
    pendingEmailSent: false,
    termsAccepted: false,
    requiresEmailConfirmation: true,
    /** „7 dni” dla Przyjęć, „3 dni” dla hotelu/restauracji — ustawiane przy wyborze kafelka usługi */
    decisionDaysLabel: "3 dni",
    personal: {
      firstName: "",
      lastName: "",
      email: "",
      phonePrefix: "+48",
      phoneNational: "",
      hpCompanyWebsite: "",
    },
    hotel: {
      dateFrom: "",
      dateTo: "",
      availability: null,
      selectedRoomIds: [],
    },
    restaurant: {
      loading: false,
      calendarLoading: false,
      calendarDays: [],
      calendarMonth: "",
      publicSettings: null,
      reservationDate: "",
      startTime: "",
      durationHours: 2,
      tablesCount: 1,
      guestsCount: 2,
      placePreference: "no_preference",
      joinTables: false,
      customerNote: "",
    },
    events: {
      loading: false,
      calendarLoading: false,
      calendarDays: [],
      calendarMonth: "",
      halls: [],
      reservationDate: "",
      startTime: "12:00",
      durationHours: 4,
      guestsCount: 60,
      hallAvailability: {},
      selectedHallId: "",
      eventType: "",
      customerNote: "",
      exclusive: false,
      durationUnspecified: false,
    },
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;");
  }

  function toInt(value, fallback = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.floor(n);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function todayYmdLocal() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function todayYmdWarsaw() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Warsaw",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const year = parts.find((p) => p.type === "year")?.value || "1970";
    const month = parts.find((p) => p.type === "month")?.value || "01";
    const day = parts.find((p) => p.type === "day")?.value || "01";
    return `${year}-${month}-${day}`;
  }

  const EVENTS_MIN_ADVANCE_MS = 2 * 60 * 60 * 1000;

  function eventsYmdHmToMsWarsaw(ymd, hm) {
    if (!ymd || !hm || !/^\d{4}-\d{2}-\d{2}$/.test(ymd) || !/^\d{2}:\d{2}$/.test(hm)) return NaN;
    const Y = Number(ymd.slice(0, 4));
    const M = Number(ymd.slice(5, 7));
    const D = Number(ymd.slice(8, 10));
    const h = Number(hm.slice(0, 2));
    const m = Number(hm.slice(3, 5));
    if (![Y, M, D, h, m].every((n) => Number.isFinite(n))) return NaN;
    let utcMs = Date.UTC(Y, M - 1, D, h, m, 0, 0);
    const dtf = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Warsaw",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    for (let k = 0; k < 48; k += 1) {
      const pa = dtf.formatToParts(new Date(utcMs));
      const pv = (type) => pa.find((p) => p.type === type)?.value;
      const y = Number(pv("year"));
      const mo = Number(pv("month"));
      const da = Number(pv("day"));
      const ho = Number(pv("hour"));
      const mi = Number(pv("minute"));
      if (y === Y && mo === M && da === D && ho === h && mi === m) return utcMs;
      utcMs += (h * 60 + m - (ho * 60 + mi)) * 60 * 1000;
    }
    return NaN;
  }

  function assertEventsStartOk(ymd, hm) {
    const t = eventsYmdHmToMsWarsaw(ymd, hm);
    if (!Number.isFinite(t)) return { ok: false, message: "Nieprawidłowa data lub godzina." };
    const now = Date.now();
    if (t < now - 60 * 1000) return { ok: false, message: "Nie można wybrać terminu z przeszłości." };
    if (t < now + EVENTS_MIN_ADVANCE_MS) return { ok: false, message: "Wybierz termin co najmniej 2 godziny od teraz." };
    return { ok: true };
  }

  function hmToMinutes(value) {
    const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
    if (!match) return null;
    const hh = Number(match[1]);
    const mm = Number(match[2]);
    if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 24 || mm < 0 || mm > 59) return null;
    if (hh === 24 && mm !== 0) return null;
    return hh * 60 + mm;
  }

  function addDaysYmd(ymd, days) {
    const [year, month, day] = String(ymd || "").split("-").map((part) => Number(part));
    if (![year, month, day].every((part) => Number.isFinite(part))) {
      return String(ymd || "");
    }
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + Number(days || 0));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  }

  function monthCursorFromYmd(ymd) {
    const safe = String(ymd || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(safe)) {
      return `${todayYmdWarsaw().slice(0, 7)}-01`;
    }
    return `${safe.slice(0, 7)}-01`;
  }

  function addMonthsToCursor(cursor, delta) {
    const safe = `${String(cursor || "").slice(0, 7)}-01`;
    const [year, month] = safe.slice(0, 7).split("-").map((part) => Number(part));
    if (![year, month].every((part) => Number.isFinite(part))) {
      return monthCursorFromYmd(todayYmdWarsaw());
    }
    const date = new Date(Date.UTC(year, month - 1, 1));
    date.setUTCMonth(date.getUTCMonth() + Number(delta || 0));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
  }

  function daysInMonth(cursor) {
    const safe = `${String(cursor || "").slice(0, 7)}-01`;
    const [year, month] = safe.slice(0, 7).split("-").map((part) => Number(part));
    if (![year, month].every((part) => Number.isFinite(part))) {
      return 30;
    }
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  function weekdayMondayFirst(ymd) {
    const [year, month, day] = String(ymd || "").split("-").map((part) => Number(part));
    if (![year, month, day].every((part) => Number.isFinite(part))) {
      return 0;
    }
    const weekDay = new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
    return weekDay === 0 ? 6 : weekDay - 1;
  }

  function monthLabel(cursor) {
    const safe = `${String(cursor || "").slice(0, 7)}-01`;
    return new Intl.DateTimeFormat("pl-PL", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${safe}T00:00:00Z`));
  }

  function availabilityDayMap(days) {
    const map = new Map();
    (Array.isArray(days) ? days : []).forEach((day) => {
      if (day?.reservationDate) {
        map.set(String(day.reservationDate), day);
      }
    });
    return map;
  }

  function selectedCalendarDay(days, reservationDate) {
    return availabilityDayMap(days).get(String(reservationDate || "")) || null;
  }

  function syncSelectedTimeWithCalendar(days, selectedDate, currentTime) {
    const day = selectedCalendarDay(days, selectedDate);
    const slots = Array.isArray(day?.slots) ? day.slots : [];
    if (!slots.length) return "";
    if (slots.includes(currentTime)) return currentTime;
    return String(day?.firstTime || slots[0] || "");
  }

  function renderAvailabilityCalendar(prefix, monthCursor, selectedDate, days, loading) {
    const dayMap = availabilityDayMap(days);
    const firstLoaded = Array.isArray(days) && days.length ? String(days[0].reservationDate || "") : "";
    const lastLoaded =
      Array.isArray(days) && days.length ? String(days[days.length - 1].reservationDate || "") : "";
    const currentMonth = `${String(monthCursor || "").slice(0, 7)}-01`;
    const monthDays = daysInMonth(currentMonth);
    const offset = weekdayMondayFirst(currentMonth);
    const previousDisabled = !firstLoaded || addMonthsToCursor(currentMonth, -1) < monthCursorFromYmd(firstLoaded);
    const nextDisabled = !lastLoaded || addMonthsToCursor(currentMonth, 1) > monthCursorFromYmd(lastLoaded);
    const cells = [];
    for (let index = 0; index < 42; index += 1) {
      const dayNumber = index - offset + 1;
      if (dayNumber < 1 || dayNumber > monthDays) {
        cells.push('<span class="gb-calendar-cell gb-calendar-cell--empty" aria-hidden="true"></span>');
        continue;
      }
      const ymd = `${currentMonth.slice(0, 8)}${String(dayNumber).padStart(2, "0")}`;
      const info = dayMap.get(ymd);
      const available = Boolean(info?.available);
      const disabled = !available;
      const classes = [
        "gb-calendar-cell",
        available ? "is-available" : "is-disabled",
        selectedDate === ymd ? "is-selected" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const status = loading ? "..." : available ? `od ${escapeHtml(info?.firstTime || "")}` : "Brak";
      cells.push(`
        <button
          type="button"
          class="${classes}"
          data-calendar-day="${escapeHtml(ymd)}"
          data-calendar-prefix="${escapeHtml(prefix)}"
          ${disabled || loading ? "disabled" : ""}
        >
          <span class="gb-calendar-day-number">${dayNumber}</span>
          <span class="gb-calendar-day-status">${status}</span>
        </button>
      `);
    }
    return `
      <div class="gb-calendar" data-calendar-root="${escapeHtml(prefix)}">
        <div class="gb-calendar-head">
          <button type="button" class="gb-calendar-nav" data-calendar-nav="${escapeHtml(prefix)}:-1" ${previousDisabled || loading ? "disabled" : ""}>‹</button>
          <strong class="gb-calendar-title">${escapeHtml(monthLabel(currentMonth))}</strong>
          <button type="button" class="gb-calendar-nav" data-calendar-nav="${escapeHtml(prefix)}:1" ${nextDisabled || loading ? "disabled" : ""}>›</button>
        </div>
        <div class="gb-calendar-weekdays">
          <span>Pon</span><span>Wt</span><span>Śr</span><span>Czw</span><span>Pt</span><span>Sob</span><span>Nd</span>
        </div>
        <div class="gb-calendar-grid">${cells.join("")}</div>
      </div>
    `;
  }

  function enumerateNights(from, to) {
    const a = new Date(`${from}T12:00:00Z`);
    const b = new Date(`${to}T12:00:00Z`);
    const out = [];
    const cursor = new Date(a);
    while (cursor < b) {
      out.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return out;
  }

  function nightsCount() {
    return enumerateNights(state.hotel.dateFrom, state.hotel.dateTo).length;
  }

  function formatNightCount(count) {
    const safe = Math.max(0, toInt(count, 0));
    const mod10 = safe % 10;
    const mod100 = safe % 100;
    if (safe === 1) return "1 noc";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${safe} noce`;
    return `${safe} nocy`;
  }

  function hotelRoomMap() {
    const map = new Map();
    (state.hotel.availability?.rooms || []).forEach((room) => map.set(room.id, room));
    return map;
  }

  function hotelTotalPrice() {
    const byId = hotelRoomMap();
    const nights = nightsCount();
    let total = 0;
    state.hotel.selectedRoomIds.forEach((id) => {
      const room = byId.get(id);
      total += Number(room?.pricePerNight || 0) * nights;
    });
    return Math.round(total * 100) / 100;
  }

  function hotelBedSummary(room) {
    const single = Math.max(0, toInt(room?.bedsSingle, 0));
    const dbl = Math.max(0, toInt(room?.bedsDouble, 0));
    const child = Math.max(0, toInt(room?.bedsChild, 0));
    const parts = [];
    if (single > 0) parts.push(`${single}x jednoosobowe`);
    if (dbl > 0) parts.push(`${dbl}x dwuosobowe`);
    if (child > 0) parts.push(`${child}x dziecięce`);
    return parts.length ? parts.join(" ") : "Układ łóżek ustalany indywidualnie";
  }

  function fullName() {
    return [state.personal.firstName, state.personal.lastName].map((x) => String(x || "").trim()).filter(Boolean).join(" ");
  }

  function normalizePhonePrefix(value) {
    const cleaned = String(value || "").replace(/[^\d+]/g, "");
    if (!cleaned) return "+48";
    if (cleaned.startsWith("+")) return `+${cleaned.slice(1).replace(/[^\d]/g, "").slice(0, 4)}`;
    return `+${cleaned.replace(/[^\d]/g, "").slice(0, 4)}`;
  }

  function phoneNationalDigits(value) {
    return String(value || "").replace(/[^\d]/g, "");
  }

  function normalizePhoneFields(prefixValue, nationalValue) {
    const prefixRaw = String(prefixValue || "").trim();
    const nationalRaw = String(nationalValue || "").trim();

    if (nationalRaw) {
      return {
        phonePrefix: normalizePhonePrefix(prefixRaw || "+48"),
        phoneNational: nationalRaw,
      };
    }

    const compactPrefix = prefixRaw.replace(/[\s()-]/g, "");
    const digitsOnly = compactPrefix.replace(/[^\d]/g, "");
    const looksLikeWholePhone = digitsOnly.length >= 6;

    if (!looksLikeWholePhone) {
      return {
        phonePrefix: normalizePhonePrefix(prefixRaw || "+48"),
        phoneNational: nationalRaw,
      };
    }

    if (compactPrefix.startsWith("+48") && digitsOnly.length > 2) {
      return {
        phonePrefix: "+48",
        phoneNational: digitsOnly.slice(2),
      };
    }

    if (compactPrefix.startsWith("48") && digitsOnly.length > 9) {
      return {
        phonePrefix: "+48",
        phoneNational: digitsOnly.slice(2),
      };
    }

    return {
      phonePrefix: normalizePhonePrefix("+48"),
      phoneNational: digitsOnly,
    };
  }

  function antiBotVerified() {
    return config.turnstileSiteKey && !state.turnstileFailed ? Boolean(state.turnstileToken) : Boolean(state.humanCheck);
  }

  function getFlow() {
    if (!state.selectedService) return ["service"];
    return FLOW_BY_SERVICE[state.selectedService] || ["service"];
  }

  function stepIndex() {
    return getFlow().indexOf(state.step);
  }

  function isSessionExpired() {
    return !state.sessionStartedAt || Date.now() - state.sessionStartedAt > SESSION_MS;
  }

  function apiBaseFor(serviceKey) {
    const meta = SERVICE_META[serviceKey];
    if (!meta) return "";
    const explicitKey =
      serviceKey === "hotel"
        ? "hotelApiBase"
        : serviceKey === "restaurant"
          ? "restaurantApiBase"
          : "hallApiBase";

    if (config[explicitKey]) {
      return String(config[explicitKey]).replace(/\/$/, "");
    }
    if (config.apiBase) {
      return `${String(config.apiBase).replace(/\/$/, "")}/api/public/legacy-bookings/${meta.apiService}`;
    }
    if (config.firebaseProjectId) {
      const fnName = serviceKey === "hotel" ? "hotelApi" : serviceKey === "restaurant" ? "restaurantApi" : "hallApi";
      return `https://europe-west1-${config.firebaseProjectId}.cloudfunctions.net/${fnName}`;
    }
    return "";
  }

  async function api(serviceKey, op, options = {}) {
    const base = apiBaseFor(serviceKey);
    if (!base) {
      throw new Error("Brak konfiguracji API rezerwacji.");
    }
    const params = new URLSearchParams({ op: String(op || "") });
    if (options.query && typeof options.query === "object") {
      Object.entries(options.query).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
          params.set(key, String(value));
        }
      });
    }
    const url = `${base}?${params.toString()}`;
    const method = String(options.method || "GET").toUpperCase();
    const headers = { ...(options.headers || {}) };
    let body;
    if (options.body !== undefined) {
      body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
      if (!headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "text/plain";
      }
    }

    const res = await fetch(url, {
      method,
      headers,
      body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "Nie udało się połączyć z systemem rezerwacji.");
    }
    return data;
  }

  function ensureCss() {
    if (document.getElementById("gb-modal-css")) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.id = "gb-modal-css";
    const cs = document.currentScript;
    let href;
    if (cs && cs.src) {
      try {
        href = new URL("../css/global-booking-modal.css", cs.src).href;
      } catch {
        href = "/assets/css/global-booking-modal.css";
      }
    } else {
      href = "/assets/css/global-booking-modal.css";
    }
    try {
      const u = new URL(href, window.location.href);
      u.searchParams.set("v", GB_MODAL_ASSET_VERSION);
      link.href = u.href;
    } catch {
      link.href = `${href}${href.includes("?") ? "&" : "?"}v=${encodeURIComponent(GB_MODAL_ASSET_VERSION)}`;
    }
    document.head.appendChild(link);
  }

  function ensureModalMarkup() {
    if (document.getElementById("gb-modal")) return;
    const root = document.createElement("div");
    root.id = "gb-modal";
    root.setAttribute("aria-hidden", "true");
    root.innerHTML = `
      <div class="gb-shell" role="dialog" aria-modal="true" aria-labelledby="gb-title">
        <div class="gb-header">
          <div>
            <h2 class="gb-title" id="gb-title">System Rezerwacji</h2>
          </div>
          <button type="button" class="gb-close" id="gb-close" aria-label="Zamknij">×</button>
        </div>
        <div class="gb-progress" id="gb-progress"></div>
        <div class="gb-body" id="gb-body"></div>
      </div>
    `;
    document.body.appendChild(root);
    root.querySelector("#gb-close")?.addEventListener("click", closeModal);
    root.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest("#gb-restart") : null;
      if (!target) return;
      event.preventDefault();
      void restartBookingFlow();
    });
  }

  function clearCountdown() {
    if (state.countdownTimer) {
      clearInterval(state.countdownTimer);
      state.countdownTimer = null;
    }
  }

  function clearSessionRefreshTimer() {
    if (state.sessionRefreshTimer) {
      clearTimeout(state.sessionRefreshTimer);
      state.sessionRefreshTimer = null;
    }
  }

  function scheduleSessionRefresh() {
    clearSessionRefreshTimer();
    if (!state.isOpen || state.step === "success") return;
    const refreshIn = Math.max(1000, state.sessionStartedAt + SESSION_MS - Date.now() - SESSION_REFRESH_LEEWAY_MS);
    state.sessionRefreshTimer = window.setTimeout(() => {
      if (!state.isOpen || state.step === "success") {
        clearSessionRefreshTimer();
        return;
      }
      state.sessionStartedAt = Date.now();
      persistDraftState();
      scheduleSessionRefresh();
    }, refreshIn);
  }

  function renewSession(options = {}) {
    if (state.step === "success") return;
    state.sessionStartedAt = Date.now();
    if (options.persist !== false) {
      persistDraftState();
    }
    scheduleSessionRefresh();
  }

  async function restartBookingFlow() {
    clearDraftState();
    resetStateForOpen();
    await loadBookingFlags();
    render();
  }

  function resetStateForOpen() {
    clearCountdown();
    clearSessionRefreshTimer();
    state.step = "service";
    state.selectedService = "";
    state.sessionStartedAt = Date.now();
    state.error = "";
    state.submitting = false;
    state.turnstileToken = "";
    state.turnstileWidgetId = null;
    state.turnstileReady = false;
    state.turnstileFailed = false;
    state.humanCheck = false;
    state.countdownUntil = 0;
    state.pendingEmailSent = false;
    state.termsAccepted = false;
    state.requiresEmailConfirmation = true;
    state.decisionDaysLabel = "3 dni";

    state.hotel = {
      dateFrom: "",
      dateTo: "",
      availability: null,
      selectedRoomIds: [],
    };

    state.restaurant = {
      loading: false,
      calendarLoading: false,
      detailsNextPending: false,
      calendarDays: [],
      calendarMonth: todayYmdLocal().slice(0, 7),
      publicSettings: null,
      reservationDate: todayYmdLocal(),
      startTime: "",
      durationHours: 2,
      tablesCount: 1,
      guestsCount: 2,
      placePreference: "no_preference",
      joinTables: false,
      customerNote: "",
    };

    state.events = {
      loading: false,
      calendarLoading: false,
      calendarDays: [],
      calendarMonth: todayYmdWarsaw().slice(0, 7),
      halls: [],
      reservationDate: todayYmdWarsaw(),
      startTime: "12:00",
      durationHours: 4,
      durationUnspecified: false,
      guestsCount: 60,
      hallAvailability: {},
      selectedHallId: "",
      eventType: "",
      customerNote: "",
      exclusive: false,
    };
  }

  function draftStorage() {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  function persistDraftState() {
    const storage = draftStorage();
    if (!storage) return;
    const snapshot = {
      version: 1,
      pageVisitId: PAGE_VISIT_ID,
      savedAt: Date.now(),
      step: state.step,
      selectedService: state.selectedService,
      sessionStartedAt: Number(state.sessionStartedAt || 0),
      countdownUntil: Number(state.countdownUntil || 0),
      pendingEmailSent: Boolean(state.pendingEmailSent),
      termsAccepted: Boolean(state.termsAccepted),
      requiresEmailConfirmation: state.requiresEmailConfirmation !== false,
      decisionDaysLabel: state.decisionDaysLabel === "7 dni" ? "7 dni" : "3 dni",
      personal: state.personal,
      hotel: state.hotel,
      restaurant: { ...state.restaurant, detailsNextPending: false },
      events: state.events,
      humanCheck: Boolean(state.humanCheck),
    };
    try {
      storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      /* ignore quota/storage errors */
    }
  }

  function clearDraftState() {
    const storage = draftStorage();
    if (!storage) return;
    try {
      storage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      /* ignore quota/storage errors */
    }
  }

  function restoreDraftState() {
    const storage = draftStorage();
    if (!storage) return false;
    try {
      const raw = storage.getItem(DRAFT_STORAGE_KEY);
      if (!raw) return false;
      const draft = JSON.parse(raw);
      if (!draft || Number(draft.version) !== 1) return false;
      if (String(draft.pageVisitId || "") !== PAGE_VISIT_ID) {
        clearDraftState();
        return false;
      }

      state.step = cleanStep(draft.step);
      state.selectedService = SERVICE_KEYS.includes(draft.selectedService) ? draft.selectedService : "";
      state.sessionStartedAt = Number(draft.sessionStartedAt || 0);
      state.countdownUntil = Number(draft.countdownUntil || 0);
      state.pendingEmailSent = Boolean(draft.pendingEmailSent);
      state.termsAccepted = Boolean(draft.termsAccepted);
      state.requiresEmailConfirmation = draft.requiresEmailConfirmation !== false;
      state.decisionDaysLabel =
        draft.selectedService === "events" || draft.decisionDaysLabel === "7 dni" ? "7 dni" : "3 dni";
      state.humanCheck = Boolean(draft.humanCheck);
      state.turnstileToken = "";
      state.turnstileWidgetId = null;
      state.turnstileReady = false;
      state.turnstileFailed = false;

      state.personal = {
        firstName: cleanString(draft.personal?.firstName, 60),
        lastName: cleanString(draft.personal?.lastName, 60),
        email: cleanString(draft.personal?.email, 180),
        phonePrefix: normalizePhonePrefix(draft.personal?.phonePrefix || "+48"),
        phoneNational: cleanString(draft.personal?.phoneNational, 24),
        hpCompanyWebsite: cleanString(draft.personal?.hpCompanyWebsite, 200),
      };

      state.hotel = {
        dateFrom: cleanString(draft.hotel?.dateFrom, 10),
        dateTo: cleanString(draft.hotel?.dateTo, 10),
        availability: draft.hotel?.availability && typeof draft.hotel.availability === "object" ? draft.hotel.availability : null,
        selectedRoomIds: Array.isArray(draft.hotel?.selectedRoomIds)
          ? draft.hotel.selectedRoomIds.map((id) => cleanString(id, 80)).filter(Boolean)
          : [],
      };

      state.restaurant = {
        loading: false,
        calendarLoading: false,
        detailsNextPending: false,
        calendarDays: Array.isArray(draft.restaurant?.calendarDays) ? draft.restaurant.calendarDays : [],
        calendarMonth: cleanString(draft.restaurant?.calendarMonth, 7) || todayYmdLocal().slice(0, 7),
        publicSettings: draft.restaurant?.publicSettings && typeof draft.restaurant.publicSettings === "object" ? draft.restaurant.publicSettings : null,
        reservationDate: cleanString(draft.restaurant?.reservationDate, 10) || todayYmdLocal(),
        startTime: cleanString(draft.restaurant?.startTime, 5),
        durationHours: Number(draft.restaurant?.durationHours || 2),
        tablesCount: clamp(toInt(draft.restaurant?.tablesCount, 1), 1, 30),
        guestsCount: clamp(toInt(draft.restaurant?.guestsCount, 2), 1, 300),
        placePreference: RESTAURANT_PLACE_OPTIONS.includes(cleanString(draft.restaurant?.placePreference, 30))
          ? cleanString(draft.restaurant?.placePreference, 30)
          : "no_preference",
        joinTables: Boolean(draft.restaurant?.joinTables),
        customerNote: cleanString(draft.restaurant?.customerNote, 2000),
      };

      state.events = {
        loading: false,
        calendarLoading: false,
        calendarDays: Array.isArray(draft.events?.calendarDays) ? draft.events.calendarDays : [],
        calendarMonth: cleanString(draft.events?.calendarMonth, 7) || todayYmdWarsaw().slice(0, 7),
        halls: Array.isArray(draft.events?.halls) ? draft.events.halls : [],
        reservationDate: cleanString(draft.events?.reservationDate, 10) || todayYmdWarsaw(),
        startTime: cleanString(draft.events?.startTime, 5) || "12:00",
        durationHours: Number(draft.events?.durationHours || 4),
        durationUnspecified: Boolean(draft.events?.durationUnspecified),
        guestsCount: clamp(toInt(draft.events?.guestsCount, 60), 1, 120),
        hallAvailability: draft.events?.hallAvailability && typeof draft.events.hallAvailability === "object" ? draft.events.hallAvailability : {},
        selectedHallId: cleanString(draft.events?.selectedHallId, 80),
        eventType: cleanString(draft.events?.eventType, 500),
        customerNote: cleanString(draft.events?.customerNote, 2000),
        exclusive: Boolean(draft.events?.exclusive),
      };

      if (state.step !== "service" && !state.selectedService) {
        state.step = "service";
      }
      if (state.selectedService) {
        const flow = getFlow();
        if (!flow.includes(state.step)) {
          state.step = flow[0];
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  function cleanStep(step) {
    const allowed = new Set([
      "service",
      "hotelDates",
      "hotelRooms",
      "eventsGuests",
      "restaurantDateTime",
      "restaurantDetails",
      "eventsDateTime",
      "eventsHall",
      "eventsDetails",
      "personal",
      "summary",
      "success",
    ]);
    return allowed.has(String(step || "")) ? String(step) : "service";
  }

  function cleanString(value, max = 2000) {
    return String(value || "").trim().slice(0, max);
  }

  async function loadBookingFlags() {
    const fetchFn = window.SREDZKA_fetchBookingSettings;
    if (typeof fetchFn !== "function") {
      state.bookingFlags = { hotel: true, restaurant: true, events: true };
      return;
    }
    try {
      const flags = await fetchFn();
      state.bookingFlags = {
        hotel: flags?.hotel !== false,
        restaurant: flags?.restaurant !== false,
        events: flags?.events !== false,
      };
    } catch {
      state.bookingFlags = { hotel: true, restaurant: true, events: true };
    }
  }

  function renderProgress() {
    const bar = document.getElementById("gb-progress");
    if (!bar) return;

    if (state.step === "service") {
      bar.innerHTML = "";
      return;
    }

    const flow = getFlow().filter((step) => step !== "service" && step !== "success");
    const current = flow.indexOf(state.step);

    bar.innerHTML = flow
      .map((_, index) => {
        const active = current === index;
        const done = current > index;
        return `<span class="gb-step-dot ${active ? "is-active" : ""} ${done ? "is-done" : ""}">${index + 1}</span>`;
      })
      .join("");
  }

  function restaurantWindow() {
    const openRaw = String(state.restaurant.publicSettings?.reservationOpenTime || "");
    const closeRaw = String(state.restaurant.publicSettings?.reservationCloseTime || "");
    const openMinutes = hmToMinutes(openRaw);
    const closeMinutesRaw = hmToMinutes(closeRaw);
    if (openMinutes == null || closeMinutesRaw == null) return null;
    return {
      openRaw,
      closeRaw,
      openMinutes,
      closeMinutes: closeMinutesRaw <= openMinutes ? closeMinutesRaw + 1440 : closeMinutesRaw,
    };
  }

  function restaurantSlotsForDuration() {
    const slots = Array.isArray(state.restaurant.publicSettings?.timeSlots)
      ? state.restaurant.publicSettings.timeSlots
      : [];
    const window = restaurantWindow();
    if (!window) return slots;
    const durationMinutes = Math.max(30, Math.round(Number(state.restaurant.durationHours || 0) * 60));
    return slots.filter((slot) => {
      const start = hmToMinutes(slot);
      if (start == null) return false;
      return start >= window.openMinutes && start + durationMinutes <= window.closeMinutes;
    });
  }

  function syncRestaurantStartTime() {
    const slots = restaurantSlotsForDuration();
    if (!slots.length) {
      state.restaurant.startTime = "";
      return;
    }
    if (!slots.includes(state.restaurant.startTime)) {
      state.restaurant.startTime = slots[0];
    }
  }

  async function loadRestaurantCalendar(options = {}) {
    state.restaurant.calendarLoading = true;
    if (options.render !== false) {
      render();
    }
    try {
      const data = await api("restaurant", "public-calendar", {
        method: "POST",
        body: {
          startDate: options.startDate || todayYmdWarsaw(),
          reservationDate: options.reservationDate || state.restaurant.reservationDate,
          durationHours: state.restaurant.durationHours,
          tablesCount: state.restaurant.tablesCount,
        },
      });
      state.restaurant.publicSettings = {
        ...(state.restaurant.publicSettings || {}),
        maxGuestsPerTable: Number(data?.maxGuestsPerTable || 4),
        tableCount: Number(data?.tableCount || 0),
        timeSlotMinutes: Number(data?.timeSlotMinutes || 30),
        restaurantName: data?.restaurantName || "Średzka Korona — Restauracja",
      };
      state.restaurant.calendarDays = Array.isArray(data?.days) ? data.days : [];
      const resolvedDate = String(data?.selectedDate || data?.firstAvailableDate || state.restaurant.reservationDate || "");
      state.restaurant.reservationDate = resolvedDate;
      state.restaurant.startTime = syncSelectedTimeWithCalendar(
        state.restaurant.calendarDays,
        resolvedDate,
        state.restaurant.startTime
      );
      state.restaurant.calendarMonth = monthCursorFromYmd(
        resolvedDate || state.restaurant.calendarDays[0]?.reservationDate || todayYmdWarsaw()
      ).slice(0, 7);
      if (!data?.firstAvailableDate) {
        setError("Brak wolnych terminów dla wybranej liczby stolików.");
      } else {
        setError("");
      }
    } catch (error) {
      setError(error?.message || "Nie udało się załadować kalendarza restauracji.");
    } finally {
      state.restaurant.calendarLoading = false;
      if (options.render !== false) {
        render();
      }
    }
  }

  async function ensureEventHallsLoaded() {
    if (state.events.halls.length) return;
    state.events.loading = true;
    render();
    try {
      const data = await api("events", "public-halls", { method: "GET" });
      state.events.halls = Array.isArray(data?.halls) ? data.halls : [];
    } finally {
      state.events.loading = false;
    }
  }

  async function loadEventsCalendar(options = {}) {
    state.events.calendarLoading = true;
    if (options.render !== false) {
      render();
    }
    try {
      const data = await api("events", "public-calendar", {
        method: "POST",
        body: {
          startDate: options.startDate || todayYmdWarsaw(),
          reservationDate: options.reservationDate || state.events.reservationDate,
          durationHours: state.events.durationHours,
          guestsCount: state.events.guestsCount,
        },
      });
      state.events.calendarDays = Array.isArray(data?.days) ? data.days : [];
      const resolvedDate = String(data?.selectedDate || data?.firstAvailableDate || state.events.reservationDate || "");
      state.events.reservationDate = resolvedDate;
      state.events.startTime = syncSelectedTimeWithCalendar(state.events.calendarDays, resolvedDate, state.events.startTime);
      state.events.calendarMonth = monthCursorFromYmd(
        resolvedDate || state.events.calendarDays[0]?.reservationDate || todayYmdWarsaw()
      ).slice(0, 7);
      if (!data?.firstAvailableDate) {
        setError("Brak dostępnych terminów dla podanej liczby gości.");
      } else {
        setError("");
      }
    } catch (error) {
      setError(error?.message || "Nie udało się załadować kalendarza sal.");
    } finally {
      state.events.calendarLoading = false;
      if (options.render !== false) {
        render();
      }
    }
  }

  function eventHallByKind(kind) {
    return state.events.halls.find((hall) => hall.hallKind === kind) || null;
  }

  async function refreshEventHallAvailability() {
    const smallHall = eventHallByKind("small");
    const largeHall = eventHallByKind("large");
    const checks = [];

    state.events.hallAvailability = {};

    if (smallHall) {
      if (state.events.guestsCount > 40) {
        state.events.hallAvailability[smallHall.id] = {
          available: false,
          reason: "Mała sala obsługuje maksymalnie 40 gości.",
          maxGuests: Math.min(40, Number(smallHall.capacity || 40)),
        };
      } else {
        checks.push(
          api("events", "public-availability", {
            method: "POST",
            body: {
              hallId: smallHall.id,
              reservationDate: state.events.reservationDate,
              startTime: state.events.startTime,
              durationHours: state.events.durationHours,
              guestsCount: state.events.guestsCount,
              exclusive: true,
            },
          })
            .then((response) => {
              state.events.hallAvailability[smallHall.id] = {
                available: Boolean(response?.available),
                reason: response?.available ? "" : "Termin jest zajęty lub zablokowany.",
                maxGuests: Number(response?.maxGuests || Math.min(40, Number(smallHall.capacity || 40))),
              };
            })
            .catch(() => {
              state.events.hallAvailability[smallHall.id] = {
                available: false,
                reason: "Nie udało się sprawdzić dostępności.",
                maxGuests: Math.min(40, Number(smallHall.capacity || 40)),
              };
            })
        );
      }
    }

    if (largeHall) {
      checks.push(
        api("events", "public-availability", {
          method: "POST",
          body: {
            hallId: largeHall.id,
            reservationDate: state.events.reservationDate,
            startTime: state.events.startTime,
            durationHours: state.events.durationHours,
            guestsCount: state.events.guestsCount,
            exclusive: false,
          },
        })
          .then((response) => {
            const maxGuests = Number(response?.maxGuests || Number(largeHall.capacity || 120));
            state.events.hallAvailability[largeHall.id] = {
              available: Boolean(response?.available),
              reason: response?.available ? "" : "Brak dostępnej pojemności sali dla tego terminu.",
              maxGuests,
            };
          })
          .catch(() => {
            state.events.hallAvailability[largeHall.id] = {
              available: false,
              reason: "Nie udało się sprawdzić dostępności.",
              maxGuests: Number(largeHall.capacity || 120),
            };
          })
      );
    }

    await Promise.all(checks);

    if (state.events.selectedHallId) {
      const selectedStatus = state.events.hallAvailability[state.events.selectedHallId];
      if (!selectedStatus?.available) {
        state.events.selectedHallId = "";
      }
    }
  }

  async function checkSelectedHallAvailability() {
    const hallId = state.events.selectedHallId;
    if (!hallId) return { ok: false, error: "Wybierz salę." };

    try {
      const response = await api("events", "public-availability", {
        method: "POST",
        body: {
          hallId,
          reservationDate: state.events.reservationDate,
          startTime: state.events.startTime,
          durationHours: state.events.durationHours,
          guestsCount: state.events.guestsCount,
          exclusive: hallId === eventHallByKind("large")?.id ? state.events.exclusive : true,
        },
      });
      if (!response?.available) {
        return { ok: false, error: "Wybrana sala nie jest dostępna dla podanego terminu." };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message || "Nie udało się sprawdzić sali." };
    }
  }

  function formatCountdown(msLeft) {
    const safe = Math.max(0, msLeft);
    const totalSeconds = Math.floor(safe / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function currentStepTitle() {
    const map = {
      service: "System Rezerwacji",
      hotelDates: "Termin pobytu",
      hotelRooms: "Pokoje",
      restaurantDateTime: "Termin",
      restaurantDetails: "Szczegóły",
      eventsGuests: "Liczba Gości",
      eventsDateTime: "Termin",
      eventsHall: "Wybór sali",
      eventsDetails: "Szczegóły wydarzenia",
      personal: "Dane osobowe",
      summary: "Podsumowanie",
      success: "Złożono zapytanie",
    };
    return map[state.step] || "System Rezerwacji";
  }

  function renderServiceStep() {
    return `
      <section>
        <div class="gb-service-tiles">
          ${SERVICE_KEYS.map((serviceKey) => {
            const enabled = state.bookingFlags[serviceKey] !== false;
            const selected = state.selectedService === serviceKey;
            const meta = SERVICE_META[serviceKey];
            return `
              <button
                type="button"
                class="gb-service-tile ${enabled ? "" : "is-disabled"} ${selected ? "is-selected" : ""}"
                data-service-select="${serviceKey}"
                ${enabled ? "" : "disabled"}
              >
                <strong>${escapeHtml(meta.label)}</strong>
                <small>${enabled ? escapeHtml(meta.subtitle) : "Rezerwacje wyłączone"}</small>
              </button>
            `;
          }).join("")}
        </div>
        <p class="gb-error" id="gb-error">${escapeHtml(state.error)}</p>
      </section>
    `;
  }

  function renderHotelDatesStep() {
    return `
      <section>
        <div class="gb-grid-2">
          <label class="gb-field">
            <span>Rezerwacja od</span>
            <input type="date" id="gb-hotel-date-from" min="${escapeHtml(todayYmdLocal())}" value="${escapeHtml(state.hotel.dateFrom)}" required />
          </label>
          <label class="gb-field">
            <span>Rezerwacja do</span>
            <input type="date" id="gb-hotel-date-to" min="${escapeHtml(todayYmdLocal())}" value="${escapeHtml(state.hotel.dateTo)}" required />
          </label>
        </div>
        <div class="gb-actions">
          <button type="button" class="gb-btn gb-btn-secondary" id="gb-back">Wróć</button>
          <button type="button" class="gb-btn gb-btn-primary" id="gb-next">Dalej</button>
        </div>
        <p class="gb-error" id="gb-error">${escapeHtml(state.error)}</p>
      </section>
    `;
  }

  function renderHotelRoomsStep() {
    const rooms = state.hotel.availability?.rooms || [];
    const selectedSet = new Set(state.hotel.selectedRoomIds);
    const nights = nightsCount();

    return `
      <section>
        <div class="gb-room-list">
          ${
            rooms.length
              ? rooms
                  .map((room) => {
                    const isSelected = selectedSet.has(room.id);
                    const unit = Number(room.pricePerNight || 0);
                    const subtotal = (unit * nights).toFixed(2);
                    const guests = Math.max(1, toInt(room.maxGuests, 1));
                    return `
                      <article class="gb-room-card">
                        <div class="gb-room-card-header">
                          <strong class="gb-room-name">${escapeHtml(room.name)}</strong>
                          <div class="gb-room-price-wrap">
                            <span class="gb-room-price">${escapeHtml(unit.toFixed(2))} PLN / noc</span>
                            <small class="gb-room-price-note">${escapeHtml(subtotal)} PLN / za ${escapeHtml(formatNightCount(nights))}</small>
                          </div>
                        </div>
                        <p class="gb-room-line">
                          <span class="gb-room-line-left">
                            <span class="gb-room-icon" aria-hidden="true">👤</span>
                            ${escapeHtml(String(guests))}-osobowy
                          </span>
                        </p>
                        <p class="gb-room-line gb-room-line--beds">
                          <span class="gb-room-line-left">
                            <span class="gb-room-icon" aria-hidden="true">🛏️</span>
                            ${escapeHtml(hotelBedSummary(room))}
                          </span>
                        </p>
                        <div class="gb-room-card-bottom">
                          ${room.description ? `<p class="gb-room-meta">${escapeHtml(room.description)}</p>` : "<span></span>"}
                          <button type="button" class="gb-pill-btn ${isSelected ? "is-active" : ""}" data-toggle-room="${escapeHtml(room.id)}">
                            ${isSelected ? "W koszyku" : "Dodaj do koszyka"}
                          </button>
                        </div>
                      </article>
                    `;
                  })
                  .join("")
              : "<p class=\"gb-hint\">Brak wolnych pokoi w podanym terminie.</p>"
          }
        </div>
        <div class="gb-cart">
          <div class="gb-cart-head">
            <strong>Podsumowanie pobytu</strong>
            <strong class="gb-cart-total">Razem ${escapeHtml(hotelTotalPrice().toFixed(2))} PLN</strong>
          </div>
          <div class="gb-cart-stats">
            <div class="gb-cart-stat">
              <span class="gb-cart-stat-k">Termin pobytu</span>
              <strong class="gb-cart-stat-v">${escapeHtml(state.hotel.dateFrom)} — ${escapeHtml(state.hotel.dateTo)}</strong>
            </div>
            <div class="gb-cart-stat">
              <span class="gb-cart-stat-k">Liczba nocy</span>
              <strong class="gb-cart-stat-v">${escapeHtml(formatNightCount(nights))}</strong>
            </div>
          </div>
          <div class="gb-cart-selection">
            <span class="gb-cart-selection-label">Wybrane pokoje</span>
            ${
              state.hotel.selectedRoomIds.length
                ? `<ul class="gb-cart-room-list">${state.hotel.selectedRoomIds
                    .map((id) => {
                      const room = rooms.find((entry) => entry.id === id);
                      return `<li class="gb-cart-room-item">${escapeHtml(room?.name || id)}</li>`;
                    })
                    .join("")}</ul>`
                : '<p class="gb-cart-empty">Brak wybranych pokoi.</p>'
            }
          </div>
        </div>
        <div class="gb-actions">
          <button type="button" class="gb-btn gb-btn-secondary" id="gb-back">Wróć</button>
          <button type="button" class="gb-btn gb-btn-primary" id="gb-next" ${state.hotel.selectedRoomIds.length ? "" : "disabled"}>Dalej</button>
        </div>
        <p class="gb-error" id="gb-error">${escapeHtml(state.error)}</p>
      </section>
    `;
  }

  function renderRestaurantDateTimeStep() {
    if (state.restaurant.calendarLoading) {
      return `
        <div class="gb-loading-state" role="status" aria-live="polite">
          <span class="gb-loading-spinner" aria-hidden="true"></span>
          <p class="gb-loading-text">Ładowanie...</p>
        </div>
      `;
    }
    const selectedDay = selectedCalendarDay(state.restaurant.calendarDays, state.restaurant.reservationDate);
    const slots = Array.isArray(selectedDay?.slots) ? selectedDay.slots : [];

    return `
      <section class="gb-rest-datetime-step">
        <h3 class="gb-sr-only">Termin</h3>
        <div class="gb-rest-datetime-controls gb-grid-2">
          <label class="gb-field gb-field--time-like">
            <span>Godzina rezerwacji</span>
            <select id="gb-rest-time" ${slots.length ? "" : "disabled"}>
              ${
                slots.length
                  ? slots
                      .map(
                        (slot) =>
                          `<option value="${escapeHtml(slot)}" ${state.restaurant.startTime === slot ? "selected" : ""}>${escapeHtml(slot)}</option>`
                      )
                      .join("")
                  : '<option value="">Brak dostępnych godzin</option>'
              }
            </select>
          </label>
          <label class="gb-field gb-field--time-like">
            <span>Preferowane miejsce</span>
            <select id="gb-rest-place">
              <option value="no_preference" ${state.restaurant.placePreference === "no_preference" ? "selected" : ""}>Brak preferencji</option>
              <option value="inside" ${state.restaurant.placePreference === "inside" ? "selected" : ""}>W lokalu</option>
              <option value="terrace" ${state.restaurant.placePreference === "terrace" ? "selected" : ""}>Na tarasie</option>
            </select>
          </label>
        </div>
        <p class="gb-inline-note gb-rest-place-disclaimer">Nie gwarantujemy stolika w wybranym miejscu.</p>
        <div class="gb-rest-datetime-calendar-wrap">
          ${renderAvailabilityCalendar("restaurant", state.restaurant.calendarMonth, state.restaurant.reservationDate, state.restaurant.calendarDays, state.restaurant.calendarLoading)}
        </div>
        <div class="gb-actions">
          <button type="button" class="gb-btn gb-btn-secondary" id="gb-back">Wróć</button>
          <button type="button" class="gb-btn gb-btn-primary" id="gb-next">Dalej</button>
        </div>
        <p class="gb-error" id="gb-error">${escapeHtml(state.error)}</p>
      </section>
    `;
  }

  function renderRestaurantDetailsStep() {
    const maxGuestsPerTable = Number(state.restaurant.publicSettings?.maxGuestsPerTable || 4);
    const maxTables = Math.max(1, Number(state.restaurant.publicSettings?.tableCount || 30));
    const maxGuests = Math.max(1, maxGuestsPerTable * Number(state.restaurant.tablesCount || 1));
    const locked = Boolean(state.restaurant.detailsNextPending);
    const dis = locked ? " disabled" : "";
    return `
      <section aria-busy="${locked ? "true" : "false"}">
        <h3>Szczegóły</h3>
        <p class="gb-hint">Najpierw określ liczbę stolików i gości. Na tej podstawie pokażemy tylko realnie dostępne dni.</p>
        <div class="gb-rest-details-wrap">
          <div class="gb-rest-details-fields">
            <div class="gb-grid-3">
              <label class="gb-field">
                <span>Liczba stołów</span>
                <input type="number" id="gb-rest-tables" min="1" max="${escapeHtml(String(maxTables))}" value="${escapeHtml(String(state.restaurant.tablesCount))}" required${dis} />
              </label>
              <label class="gb-field">
                <span>Liczba gości</span>
                <input type="number" id="gb-rest-guests" min="1" max="${escapeHtml(String(maxGuests))}" value="${escapeHtml(String(state.restaurant.guestsCount))}" required${dis} />
              </label>
              <label class="gb-field gb-field--time-like">
                <span>Czas rezerwacji</span>
                <select id="gb-rest-duration"${dis}>
                  ${[1, 1.5, 2, 2.5, 3, 4, 5, 6]
                    .map(
                      (h) =>
                        `<option value="${escapeHtml(String(h))}" ${Number(state.restaurant.durationHours) === Number(h) ? "selected" : ""}>${escapeHtml(String(h))} h</option>`
                    )
                    .join("")}
                </select>
              </label>
            </div>
            <div class="gb-rest-step1-foot">
              <div class="gb-rest-step1-notes">
                <p class="gb-inline-note">Maksymalna ilość gości przy jednym stole: <strong id="gb-rest-max">${escapeHtml(String(maxGuestsPerTable))}</strong>.</p>
              </div>
              <label class="gb-check gb-check--rest-join">
                <input type="checkbox" id="gb-rest-join" ${state.restaurant.joinTables ? "checked" : ""}${dis} />
                <span>Prośba o połączenie stołów</span>
              </label>
            </div>
            <label class="gb-field" style="margin-top:0.7rem;">
              <span>Dodatkowe informacje</span>
              <textarea id="gb-rest-note" maxlength="2000"${dis}>${escapeHtml(state.restaurant.customerNote)}</textarea>
            </label>
          </div>
          ${
            locked
              ? `<div class="gb-rest-details-overlay" role="status" aria-live="polite">
            <div class="gb-loading-state gb-loading-state--overlay">
              <span class="gb-loading-spinner" aria-hidden="true"></span>
              <p class="gb-loading-text">Ładowanie dostępnych terminów…</p>
            </div>
          </div>`
              : ""
          }
        </div>
        <div class="gb-actions">
          <button type="button" class="gb-btn gb-btn-secondary" id="gb-back"${dis}>Wróć</button>
          <button type="button" class="gb-btn gb-btn-primary" id="gb-next"${dis}>Dalej</button>
        </div>
        <p class="gb-error" id="gb-error">${escapeHtml(state.error)}</p>
      </section>
    `;
  }

  function renderEventsGuestsStep() {
    const durOpts = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const durSelectHtml = durOpts
      .map(
        (h) =>
          `<option value="${h}" ${!state.events.durationUnspecified && Number(state.events.durationHours) === h ? "selected" : ""}>${h} h</option>`
      )
      .join("");
    const guestsVal = clamp(toInt(state.events.guestsCount, 60), 1, 120);
    return `
      <section>
        <p class="gb-hint" style="margin:0 0 0.75rem;">Najpierw określ liczbę gości i przewidywany czas. Na tej podstawie pokażemy tylko dni, które mogą pomieścić wydarzenie.</p>
        <div class="gb-events-guests-row" role="group" aria-labelledby="gb-events-guests-slider-label">
          <div class="gb-events-guests-col gb-events-guests-col--dur">
            <label class="gb-field">
              <span>Czas rezerwacji (h)</span>
              <select id="gb-events-duration-setup">
                ${durSelectHtml}
                <option value="unspecified" ${state.events.durationUnspecified ? "selected" : ""}>Nie określaj</option>
              </select>
            </label>
          </div>
          <div class="gb-events-guests-col gb-events-guests-col--range">
            <span class="gb-range-label" id="gb-events-guests-slider-label">Liczba gości (1–120)</span>
            <input type="range" id="gb-events-guests-range" min="1" max="120" value="${escapeHtml(String(guestsVal))}" aria-labelledby="gb-events-guests-slider-label" />
          </div>
          <div class="gb-events-guests-col gb-events-guests-col--num">
            <label class="gb-field">
              <span class="gb-events-guests-col-head" aria-hidden="true">&#8203;</span>
              <input type="number" id="gb-events-guests-number" min="1" max="120" value="${escapeHtml(String(guestsVal))}" required aria-labelledby="gb-events-guests-slider-label" />
            </label>
          </div>
        </div>

        <div class="gb-actions">
          <button type="button" class="gb-btn gb-btn-secondary" id="gb-back">Wróć</button>
          <button type="button" class="gb-btn gb-btn-primary" id="gb-next">Dalej</button>
        </div>
        <p class="gb-error" id="gb-error">${escapeHtml(state.error)}</p>
      </section>
    `;
  }

  function renderEventsDateTimeStep() {
    if (state.events.calendarLoading) {
      return `
        <div class="gb-loading-state" role="status" aria-live="polite">
          <span class="gb-loading-spinner" aria-hidden="true"></span>
          <p class="gb-loading-text">Ładowanie...</p>
        </div>
      `;
    }
    const selectedDay = selectedCalendarDay(state.events.calendarDays, state.events.reservationDate);
    const slots = Array.isArray(selectedDay?.slots) ? selectedDay.slots : [];
    return `
      <section>
        <p class="gb-hint" style="margin:0 0 0.75rem;">Termin musi być co najmniej <strong>2 godziny</strong> od teraz (czas Polski). Kalendarz pokazuje tylko dni, które mają wolny slot dla <strong>${escapeHtml(String(state.events.guestsCount))}</strong> gości.</p>
        ${renderAvailabilityCalendar("events", state.events.calendarMonth, state.events.reservationDate, state.events.calendarDays, state.events.calendarLoading)}
        <label class="gb-field gb-field--time-like" style="margin-top:0.85rem;">
          <span>Godzina rezerwacji</span>
          <select id="gb-events-time" ${slots.length ? "" : "disabled"}>
            ${
              slots.length
                ? slots
                    .map(
                      (slot) =>
                        `<option value="${escapeHtml(slot)}" ${state.events.startTime === slot ? "selected" : ""}>${escapeHtml(slot)}</option>`
                    )
                    .join("")
                : '<option value="">Brak dostępnych godzin</option>'
            }
          </select>
        </label>
        <div class="gb-actions">
          <button type="button" class="gb-btn gb-btn-secondary" id="gb-back">Wróć</button>
          <button type="button" class="gb-btn gb-btn-primary" id="gb-next">Dalej</button>
        </div>
        <p class="gb-error" id="gb-error">${escapeHtml(state.error)}</p>
      </section>
    `;
  }

  function renderEventsHallStep() {
    if (state.events.loading) {
      return `<p class="gb-hint">Ładowanie konfiguracji sal…</p>`;
    }
    const smallHall = eventHallByKind("small");
    const largeHall = eventHallByKind("large");

    const smallInfo = smallHall
      ? state.events.hallAvailability[smallHall.id] || { available: false, reason: "Sprawdzanie dostępności…" }
      : { available: false, reason: "Brak skonfigurowanej małej sali." };
    const largeInfo = largeHall
      ? state.events.hallAvailability[largeHall.id] || { available: false, reason: "Sprawdzanie dostępności…" }
      : { available: false, reason: "Brak skonfigurowanej dużej sali." };

    const noHallAvailable = !smallInfo.available && !largeInfo.available;

    return `
      <section>
        <div class="gb-hall-tiles">
          <button
            type="button"
            class="gb-hall-tile ${smallInfo.available ? "" : "is-disabled"} ${state.events.selectedHallId === smallHall?.id ? "is-selected" : ""}"
            data-select-hall="${escapeHtml(smallHall?.id || "")}"
            ${smallInfo.available && smallHall ? "" : "disabled"}
          >
            <strong>${escapeHtml(smallHall?.name || "Sala mała")}</strong>
            <small>${smallInfo.available ? "Dostępna" : escapeHtml(smallInfo.reason || "Niedostępna")}</small>
          </button>

          <button
            type="button"
            class="gb-hall-tile ${largeInfo.available ? "" : "is-disabled"} ${state.events.selectedHallId === largeHall?.id ? "is-selected" : ""}"
            data-select-hall="${escapeHtml(largeHall?.id || "")}"
            ${largeInfo.available && largeHall ? "" : "disabled"}
          >
            <strong>${escapeHtml(largeHall?.name || "Sala duża")}</strong>
            <small>${largeInfo.available ? `Dostępna (wolne miejsca: ${escapeHtml(String(largeInfo.maxGuests || 0))})` : escapeHtml(largeInfo.reason || "Niedostępna")}</small>
          </button>
        </div>

        ${noHallAvailable ? '<p class="gb-inline-note">Brak dostępnej sali dla podanego terminu i liczby gości.</p>' : ""}

        <div class="gb-actions">
          <button type="button" class="gb-btn gb-btn-secondary" id="gb-back">Wróć</button>
          <button type="button" class="gb-btn gb-btn-primary" id="gb-next" ${state.events.selectedHallId ? "" : "disabled"}>Dalej</button>
        </div>
        <p class="gb-error" id="gb-error">${escapeHtml(state.error)}</p>
      </section>
    `;
  }

  function renderEventsDetailsStep() {
    const selectedHall = state.events.halls.find((hall) => hall.id === state.events.selectedHallId);
    const isLarge = selectedHall?.hallKind === "large";
    return `
      <section>
        <p class="gb-hint">Podaj rodzaj imprezy oraz dodatkowe informacje do rezerwacji.</p>
        <div class="gb-grid-2">
          <label class="gb-field">
            <span>Rodzaj imprezy</span>
            <input type="text" id="gb-events-type" maxlength="500" value="${escapeHtml(state.events.eventType)}" required />
          </label>
        </div>
        <label class="gb-field" style="margin-top:0.7rem;">
          <span>Dodatkowe informacje do rezerwacji</span>
          <textarea id="gb-events-note" maxlength="2000" required>${escapeHtml(state.events.customerNote)}</textarea>
        </label>
        ${
          isLarge
            ? `<label class="gb-check"><input type="checkbox" id="gb-events-exclusive" ${state.events.exclusive ? "checked" : ""} /><span>Sala na wyłączność (rezerwuje całą dużą salę, niezależnie od liczby osób)</span></label>`
            : ""
        }
        <div class="gb-actions">
          <button type="button" class="gb-btn gb-btn-secondary" id="gb-back">Wróć</button>
          <button type="button" class="gb-btn gb-btn-primary" id="gb-next">Dalej</button>
        </div>
        <p class="gb-error" id="gb-error">${escapeHtml(state.error)}</p>
      </section>
    `;
  }

  function renderPersonalStep() {
    return `
      <section>
        <h3>Dane osobowe</h3>
        <form id="gb-personal-form">
          <input type="text" name="hpCompanyWebsite" value="${escapeHtml(state.personal.hpCompanyWebsite)}" style="position:absolute;left:-5000px;width:1px;height:1px;opacity:0;" tabindex="-1" autocomplete="off" />

          <div class="gb-grid-2">
            <label class="gb-field">
              <span>Imię</span>
              <input type="text" name="firstName" maxlength="60" value="${escapeHtml(state.personal.firstName)}" autocomplete="given-name" required />
            </label>
            <label class="gb-field">
              <span>Nazwisko</span>
              <input type="text" name="lastName" maxlength="60" value="${escapeHtml(state.personal.lastName)}" autocomplete="family-name" required />
            </label>
          </div>

          <div class="gb-grid-2" style="margin-top:0.75rem;">
            <label class="gb-field">
              <span>Adres e-mail</span>
              <input type="email" name="email" maxlength="180" value="${escapeHtml(state.personal.email)}" autocomplete="email" required />
            </label>
            <div class="gb-phone-row">
              <label class="gb-field">
                <span>Prefiks</span>
                <input type="tel" class="gb-phone-prefix" name="phonePrefix" maxlength="5" value="${escapeHtml(normalizePhonePrefix(state.personal.phonePrefix || "+48"))}" pattern="\\+[0-9]{1,4}" inputmode="tel" autocomplete="tel-country-code" autocapitalize="off" spellcheck="false" required />
              </label>
              <label class="gb-field">
                <span>Numer telefonu</span>
                <input type="tel" name="phoneNational" maxlength="24" value="${escapeHtml(state.personal.phoneNational)}" pattern="[0-9][0-9\\s-]{5,23}" inputmode="tel" autocomplete="tel-national" autocapitalize="off" spellcheck="false" required />
              </label>
            </div>
          </div>

          <div class="gb-actions">
            <button type="button" class="gb-btn gb-btn-secondary" id="gb-back">Wróć</button>
            <button type="submit" class="gb-btn gb-btn-primary">Dalej</button>
          </div>
        </form>
        <p class="gb-error" id="gb-error">${escapeHtml(state.error)}</p>
      </section>
    `;
  }

  function renderSummaryBox() {
    const service = state.selectedService;

    if (service === "hotel") {
      const nights = nightsCount();
      const roomsById = hotelRoomMap();
      const nightsLabel = formatNightCount(nights);
      return `
        <div class="gb-summary-box gb-summary-box--hotel">
          <h3 class="gb-summary-box-title">Podsumowanie pobytu</h3>
          <div class="gb-summary-stat-grid">
            <div class="gb-summary-stat">
              <span class="gb-summary-stat-k">Termin pobytu</span>
              <strong class="gb-summary-stat-v">${escapeHtml(state.hotel.dateFrom)} — ${escapeHtml(state.hotel.dateTo)}</strong>
            </div>
            <div class="gb-summary-stat">
              <span class="gb-summary-stat-k">Liczba nocy</span>
              <strong class="gb-summary-stat-v">${escapeHtml(nightsLabel)}</strong>
            </div>
          </div>
          <div class="gb-summary-section">
            <span class="gb-summary-section-label">Pokoje</span>
          <ul class="gb-summary-room-list">
            ${state.hotel.selectedRoomIds
              .map((id) => {
                const room = roomsById.get(id);
                const unit = Number(room?.pricePerNight || 0);
                const lineTotal = (unit * nights).toFixed(2);
                return `<li class="gb-summary-room-item">
                  <span class="gb-summary-room-name">${escapeHtml(room?.name || id)}</span>
                  <span class="gb-summary-room-prices">
                    <span class="gb-summary-room-unit">${escapeHtml(unit.toFixed(2))} PLN / noc</span>
                    <span class="gb-summary-room-total">${escapeHtml(lineTotal)} PLN</span>
                  </span>
                </li>`;
              })
              .join("")}
          </ul>
          </div>
          <p class="gb-summary-total">Razem ${escapeHtml(hotelTotalPrice().toFixed(2))} PLN</p>
        </div>
      `;
    }

    if (service === "restaurant") {
      return `
        <div class="gb-summary-box">
          <h3 class="gb-summary-box-title">Podsumowanie rezerwacji</h3>
          <ul class="gb-summary-list gb-summary-list--stacked">
            <li class="gb-summary-li"><span class="gb-summary-k">Data</span><span class="gb-summary-v">${escapeHtml(state.restaurant.reservationDate)}</span></li>
            <li class="gb-summary-li"><span class="gb-summary-k">Godzina</span><span class="gb-summary-v">${escapeHtml(state.restaurant.startTime)}</span></li>
            <li class="gb-summary-li"><span class="gb-summary-k">Czas rezerwacji</span><span class="gb-summary-v">${escapeHtml(String(state.restaurant.durationHours))} h</span></li>
            <li class="gb-summary-li"><span class="gb-summary-k">Liczba stołów</span><span class="gb-summary-v">${escapeHtml(String(state.restaurant.tablesCount))}</span></li>
            <li class="gb-summary-li"><span class="gb-summary-k">Liczba gości</span><span class="gb-summary-v">${escapeHtml(String(state.restaurant.guestsCount))}</span></li>
            <li class="gb-summary-li"><span class="gb-summary-k">Miejsce</span><span class="gb-summary-v">${escapeHtml(
              state.restaurant.placePreference === "inside"
                ? "W lokalu"
                : state.restaurant.placePreference === "terrace"
                  ? "Na tarasie"
                  : "Brak preferencji"
            )}</span></li>
            <li class="gb-summary-li"><span class="gb-summary-k">Prośba o połączenie stołów</span><span class="gb-summary-v">${state.restaurant.joinTables ? "tak" : "nie"}</span></li>
            ${state.restaurant.customerNote ? `<li class="gb-summary-li gb-summary-li--block"><span class="gb-summary-k">Dodatkowe informacje</span><span class="gb-summary-v">${escapeHtml(state.restaurant.customerNote)}</span></li>` : ""}
          </ul>
        </div>
      `;
    }

    const selectedHall = state.events.halls.find((hall) => hall.id === state.events.selectedHallId);
    return `
      <div class="gb-summary-box">
        <h3 class="gb-summary-box-title">Podsumowanie zapytania</h3>
        <ul class="gb-summary-list gb-summary-list--stacked">
          <li class="gb-summary-li"><span class="gb-summary-k">Data</span><span class="gb-summary-v">${escapeHtml(state.events.reservationDate)}</span></li>
          <li class="gb-summary-li"><span class="gb-summary-k">Godzina</span><span class="gb-summary-v">${escapeHtml(state.events.startTime)}</span></li>
          <li class="gb-summary-li"><span class="gb-summary-k">Czas rezerwacji</span><span class="gb-summary-v">${state.events.durationUnspecified ? "nie określono" : `${escapeHtml(String(state.events.durationHours))} h`}</span></li>
          <li class="gb-summary-li"><span class="gb-summary-k">Liczba gości</span><span class="gb-summary-v">${escapeHtml(String(state.events.guestsCount))}</span></li>
          <li class="gb-summary-li"><span class="gb-summary-k">Sala</span><span class="gb-summary-v">${escapeHtml(selectedHall?.name || "—")}</span></li>
          <li class="gb-summary-li gb-summary-li--block"><span class="gb-summary-k">Rodzaj imprezy</span><span class="gb-summary-v">${escapeHtml(state.events.eventType)}</span></li>
          <li class="gb-summary-li gb-summary-li--block"><span class="gb-summary-k">Dodatkowe informacje</span><span class="gb-summary-v">${escapeHtml(state.events.customerNote)}</span></li>
          ${selectedHall?.hallKind === "large" ? `<li class="gb-summary-li"><span class="gb-summary-k">Sala na wyłączność</span><span class="gb-summary-v">${state.events.exclusive ? "tak" : "nie"}</span></li>` : ""}
          <li class="gb-summary-li"><span class="gb-summary-k">Koszt</span><span class="gb-summary-v">ustalany indywidualnie</span></li>
        </ul>
      </div>
    `;
  }

  function renderAntiBotSection() {
    if (config.turnstileSiteKey && !state.turnstileFailed) {
      return `
        <div class="gb-antibot-wrap gb-antibot-wrap--turnstile">
          <div id="gb-turnstile-slot"></div>
        </div>
      `;
    }
    return `
      <label class="gb-check gb-antibot-wrap">
        <input type="checkbox" id="gb-human-check" ${state.humanCheck ? "checked" : ""} />
        <span>${config.turnstileSiteKey ? "Potwierdzam, że nie jestem botem (tryb awaryjny)." : "Potwierdzam, że nie jestem botem."}</span>
      </label>
    `;
  }

  function renderSummaryStep() {
    const submitLabel = state.selectedService === "events" ? "Poproś o ofertę" : "Rezerwuj";
    const showSubmitButton = antiBotVerified();
    const decisionDaysLabel =
      state.decisionDaysLabel === "7 dni" || state.selectedService === "events" ? "7 dni" : "3 dni";

    return `
      <section>
        <h3>Podsumowanie</h3>

        <div class="gb-summary-grid">
          <div class="gb-summary-box">
            <h3 class="gb-summary-box-title">Dane kontaktowe</h3>
            <ul class="gb-summary-list gb-summary-list--stacked">
              <li class="gb-summary-li"><span class="gb-summary-k">Imię i nazwisko</span><span class="gb-summary-v">${escapeHtml(fullName())}</span></li>
              <li class="gb-summary-li"><span class="gb-summary-k">E-mail</span><span class="gb-summary-v">${escapeHtml(state.personal.email)}</span></li>
              <li class="gb-summary-li"><span class="gb-summary-k">Telefon</span><span class="gb-summary-v">${escapeHtml(`${state.personal.phonePrefix} ${state.personal.phoneNational}`.trim())}</span></li>
            </ul>
          </div>
          ${renderSummaryBox()}
        </div>

        <label class="gb-check">
          <input type="checkbox" id="gb-terms" ${state.termsAccepted ? "checked" : ""} />
          <span>Akceptuję <a class="gb-link" href="${escapeHtml(SERVICE_META[state.selectedService]?.confirmPath || "#")}" target="_blank" rel="noopener">regulamin rezerwacji</a>, oraz fakt, że moja rezerwacja zostanie rozpatrzona w ciągu ${decisionDaysLabel}.</span>
        </label>

        <div class="gb-actions">
          <button type="button" class="gb-btn gb-btn-secondary" id="gb-back">Wróć</button>
          <div class="gb-submit-slot">
            ${
              showSubmitButton
                ? `<button type="button" class="gb-btn gb-btn-primary" id="gb-submit" ${state.termsAccepted && !state.submitting ? "" : "disabled"}>${escapeHtml(submitLabel)}</button>`
                : renderAntiBotSection()
            }
          </div>
        </div>
        <p class="gb-error" id="gb-error">${escapeHtml(state.error)}</p>
      </section>
    `;
  }

  function renderSuccessStep() {
    const left = state.countdownUntil ? Math.max(0, state.countdownUntil - Date.now()) : EMAIL_CONFIRM_MS;
    const supportNotice =
      '<p class="gb-hint" style="margin-top:0.75rem;">Jeśli nie widzisz wiadomości e-mail, sprawdź folder SPAM. W razie problemów skontaktuj się z nami mailowo lub telefonicznie.</p>';
    const emergencyNotice =
      `<p class="gb-hint" style="margin-top:0.75rem;"><strong>Nie udało się wysłać wiadomości potwierdzającej.</strong> Skontaktuj się z nami natychmiast mailowo: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>`;
    const decisionDaysLabel =
      state.decisionDaysLabel === "7 dni" || state.selectedService === "events" ? "7 dni" : "3 dni";
    return `
      <section>
        <h3>Rezerwacja została zapisana</h3>
        ${
          state.requiresEmailConfirmation
            ? `<div class="gb-success-card">
                <p class="gb-hint">Wysłaliśmy link potwierdzający na Twój adres e-mail. Kliknij go, aby aktywować zgłoszenie.</p>
                <p class="gb-hint" style="margin-top:0.75rem;">Po potwierdzeniu maila rezerwacja zostanie wysłana. Rezerwacja może nie zostać przyjęta. Decyzję wyślemy mailowo w ciągu <strong>${decisionDaysLabel}</strong>.</p>
                ${supportNotice}
                <div class="gb-countdown-footer">
                  <p class="gb-countdown"><strong>Czas na potwierdzenie:</strong> <span id="gb-countdown-value">${escapeHtml(formatCountdown(left))}</span></p>
                </div>
              </div>`
            : `<div class="gb-success-card">
                <p class="gb-hint">Zgłoszenie zostało zapisane, ale system nie potwierdził wysłania maila potwierdzającego.</p>
                <p class="gb-hint" style="margin-top:0.5rem;">Aby obsługa mogła szybko zweryfikować rezerwację, wyślij wiadomość na adres kontaktowy obiektu.</p>
                ${emergencyNotice}
              </div>`
        }

        <div class="gb-actions gb-actions--end">
          <button type="button" class="gb-btn gb-btn-primary" id="gb-close-final">Zamknij</button>
        </div>
      </section>
    `;
  }

  function renderSessionExpired() {
    return `
      <section class="gb-session-expired">
        <h3>Sesja wygasła</h3>
        <p class="gb-hint">Sesja rezerwacji trwa maksymalnie 30 minut. Rozpocznij proces od nowa.</p>
        <div class="gb-actions gb-actions--end">
          <button type="button" class="gb-btn gb-btn-primary" id="gb-restart">Zacznij od nowa</button>
        </div>
      </section>
    `;
  }

  function render() {
    if (!state.isOpen) return;

    const title = document.getElementById("gb-title");
    const body = document.getElementById("gb-body");

    if (!body || !title) return;

    title.textContent = currentStepTitle();

    if (state.step !== "service" && state.step !== "success" && isSessionExpired()) {
      renewSession();
    }

    if (state.step === "service") {
      body.innerHTML = renderServiceStep();
    } else if (state.step === "hotelDates") {
      body.innerHTML = renderHotelDatesStep();
    } else if (state.step === "hotelRooms") {
      body.innerHTML = renderHotelRoomsStep();
    } else if (state.step === "eventsGuests") {
      body.innerHTML = renderEventsGuestsStep();
    } else if (state.step === "restaurantDateTime") {
      body.innerHTML = renderRestaurantDateTimeStep();
    } else if (state.step === "restaurantDetails") {
      body.innerHTML = renderRestaurantDetailsStep();
    } else if (state.step === "eventsDateTime") {
      body.innerHTML = renderEventsDateTimeStep();
    } else if (state.step === "eventsHall") {
      body.innerHTML = renderEventsHallStep();
    } else if (state.step === "eventsDetails") {
      body.innerHTML = renderEventsDetailsStep();
    } else if (state.step === "personal") {
      body.innerHTML = renderPersonalStep();
    } else if (state.step === "summary") {
      body.innerHTML = renderSummaryStep();
    } else if (state.step === "success") {
      body.innerHTML = renderSuccessStep();
    }
    body.classList.toggle("gb-body--summary", state.step === "summary");
    body.classList.toggle("gb-body--restaurant-datetime", state.step === "restaurantDateTime");
    document.querySelector("#gb-modal .gb-shell")?.classList.toggle("gb-shell--rest-datetime", state.step === "restaurantDateTime");

    renderProgress();
    bindCommonHandlers();
    bindLiveDraftHandlers();

    if (state.step === "summary") {
      mountAntiBotHandlers();
    }

    if (state.step === "success") {
      startCountdownTicker();
    }

    scheduleSessionRefresh();
    persistDraftState();
  }

  function setError(message) {
    state.error = message || "";
    const error = document.getElementById("gb-error");
    if (error) {
      error.textContent = state.error;
    }
  }

  function syncCurrentStepFromDom() {
    if (!state.isOpen) return;
    if (state.step === "hotelDates") {
      const fromInput = document.getElementById("gb-hotel-date-from");
      const toInput = document.getElementById("gb-hotel-date-to");
      state.hotel.dateFrom = String(fromInput?.value || state.hotel.dateFrom || "");
      state.hotel.dateTo = String(toInput?.value || state.hotel.dateTo || "");
      return;
    }
    if (state.step === "restaurantDateTime") {
      state.restaurant.startTime = String(document.getElementById("gb-rest-time")?.value || state.restaurant.startTime || "");
      const placePreference = String(document.getElementById("gb-rest-place")?.value || state.restaurant.placePreference || "no_preference");
      state.restaurant.placePreference = RESTAURANT_PLACE_OPTIONS.includes(placePreference) ? placePreference : "no_preference";
      return;
    }
    if (state.step === "restaurantDetails") {
      if (state.restaurant.detailsNextPending) {
        return;
      }
      state.restaurant.tablesCount = clamp(toInt(document.getElementById("gb-rest-tables")?.value || state.restaurant.tablesCount || 1, 1), 1, 30);
      state.restaurant.guestsCount = clamp(toInt(document.getElementById("gb-rest-guests")?.value || state.restaurant.guestsCount || 1, 1), 1, 300);
      state.restaurant.durationHours = Number(document.getElementById("gb-rest-duration")?.value || state.restaurant.durationHours || 2);
      state.restaurant.joinTables = Boolean(document.getElementById("gb-rest-join")?.checked);
      state.restaurant.customerNote = String(document.getElementById("gb-rest-note")?.value || state.restaurant.customerNote || "").trim();
      return;
    }
    if (state.step === "eventsGuests") {
      const durVal = String(document.getElementById("gb-events-duration-setup")?.value || "");
      if (durVal === "unspecified") {
        state.events.durationUnspecified = true;
        state.events.durationHours = 12;
      } else {
        state.events.durationUnspecified = false;
        state.events.durationHours = Number(durVal || state.events.durationHours || 4);
      }
      state.events.guestsCount = clamp(
        toInt(document.getElementById("gb-events-guests-number")?.value || state.events.guestsCount || 60, 60),
        1,
        120
      );
      return;
    }
    if (state.step === "eventsDateTime") {
      state.events.startTime = String(document.getElementById("gb-events-time")?.value || state.events.startTime || "");
      return;
    }
    if (state.step === "eventsDetails") {
      state.events.eventType = String(document.getElementById("gb-events-type")?.value || state.events.eventType || "").trim();
      state.events.customerNote = String(document.getElementById("gb-events-note")?.value || state.events.customerNote || "").trim();
      state.events.exclusive = Boolean(document.getElementById("gb-events-exclusive")?.checked);
      return;
    }
    if (state.step === "personal") {
      state.personal.firstName = String(document.querySelector('[name="firstName"]')?.value || state.personal.firstName || "").trim();
      state.personal.lastName = String(document.querySelector('[name="lastName"]')?.value || state.personal.lastName || "").trim();
      state.personal.email = String(document.querySelector('[name="email"]')?.value || state.personal.email || "").trim();
      const normalizedPhone = normalizePhoneFields(
        document.querySelector('[name="phonePrefix"]')?.value || state.personal.phonePrefix || "+48",
        document.querySelector('[name="phoneNational"]')?.value || state.personal.phoneNational || ""
      );
      state.personal.phonePrefix = normalizedPhone.phonePrefix;
      state.personal.phoneNational = String(normalizedPhone.phoneNational || "").trim();
      state.personal.hpCompanyWebsite = String(document.querySelector('[name="hpCompanyWebsite"]')?.value || state.personal.hpCompanyWebsite || "").trim();
      return;
    }
    if (state.step === "summary") {
      const terms = document.getElementById("gb-terms");
      if (terms) {
        state.termsAccepted = Boolean(terms.checked);
      }
      if (!config.turnstileSiteKey) {
        const human = document.getElementById("gb-human-check");
        if (human) {
          state.humanCheck = Boolean(human.checked);
        }
      }
    }
  }

  function bindLiveDraftHandlers() {
    const body = document.getElementById("gb-body");
    if (!body) return;
    body.querySelectorAll("input, select, textarea").forEach((field) => {
      field.addEventListener("input", () => {
        renewSession({ persist: false });
        syncCurrentStepFromDom();
        persistDraftState();
      });
      field.addEventListener("change", () => {
        renewSession({ persist: false });
        syncCurrentStepFromDom();
        persistDraftState();
      });
    });
  }

  function goBack() {
    renewSession({ persist: false });
    syncCurrentStepFromDom();
    setError("");
    const flow = getFlow();
    const index = flow.indexOf(state.step);
    if (index > 0) {
      state.step = flow[index - 1];
      if (state.step !== "summary") {
        state.turnstileToken = "";
        state.turnstileReady = false;
        state.turnstileFailed = false;
        state.humanCheck = false;
        state.termsAccepted = false;
      }
      render();
    }
  }

  function serviceFromStep(step) {
    if (!step) return "";
    if (step.startsWith("hotel")) return "hotel";
    if (step.startsWith("restaurant")) return "restaurant";
    if (step.startsWith("events")) return "events";
    return "";
  }

  function bindCommonHandlers() {
    if (state.step !== "service" && state.step !== "success" && isSessionExpired()) {
      return;
    }

    if (state.step === "service") {
      document.querySelectorAll("[data-service-select]").forEach((button) => {
        button.addEventListener("click", () => {
          renewSession({ persist: false });
          const service = button.getAttribute("data-service-select");
          if (!service || state.bookingFlags[service] === false) return;
          setError("");
          state.selectedService = service;
          state.decisionDaysLabel = service === "events" ? "7 dni" : "3 dni";
          const flow = getFlow();
          state.step = flow[1] || "summary";
          render();
          if (service === "restaurant") {
            api("restaurant", "public-settings", {
              method: "GET",
              query: { reservationDate: state.restaurant.reservationDate || todayYmdWarsaw() },
            })
              .then((data) => {
                state.restaurant.publicSettings = data;
                render();
              })
              .catch(() => {
                /* fallback to defaults in UI */
              });
          }
        });
      });
      return;
    }

    document.getElementById("gb-back")?.addEventListener("click", goBack);

    document.querySelectorAll("[data-calendar-nav]").forEach((button) => {
      button.addEventListener("click", () => {
        const [prefix, deltaRaw] = String(button.getAttribute("data-calendar-nav") || "").split(":");
        const delta = Number(deltaRaw || 0);
        if (prefix === "restaurant") {
          state.restaurant.calendarMonth = addMonthsToCursor(`${state.restaurant.calendarMonth}-01`, delta).slice(0, 7);
          render();
          return;
        }
        if (prefix === "events") {
          state.events.calendarMonth = addMonthsToCursor(`${state.events.calendarMonth}-01`, delta).slice(0, 7);
          render();
        }
      });
    });

    document.querySelectorAll("[data-calendar-day]").forEach((button) => {
      button.addEventListener("click", () => {
        const ymd = String(button.getAttribute("data-calendar-day") || "");
        const prefix = String(button.getAttribute("data-calendar-prefix") || "");
        if (!ymd) return;
        if (prefix === "restaurant") {
          state.restaurant.reservationDate = ymd;
          state.restaurant.startTime = syncSelectedTimeWithCalendar(
            state.restaurant.calendarDays,
            ymd,
            state.restaurant.startTime
          );
          setError("");
          render();
          return;
        }
        if (prefix === "events") {
          state.events.reservationDate = ymd;
          state.events.startTime = syncSelectedTimeWithCalendar(state.events.calendarDays, ymd, state.events.startTime);
          setError("");
          render();
        }
      });
    });

    if (state.step === "hotelDates") {
      const fromInput = document.getElementById("gb-hotel-date-from");
      const toInput = document.getElementById("gb-hotel-date-to");
      document.getElementById("gb-next")?.addEventListener("click", async () => {
        renewSession({ persist: false });
        const from = String(fromInput?.value || "");
        const to = String(toInput?.value || "");
        const today = todayYmdLocal();

        if (!from || !to) {
          setError("Wypełnij oba pola dat.");
          return;
        }
        if (from < today) {
          setError("Data przyjazdu nie może być w przeszłości.");
          return;
        }
        if (to <= from) {
          setError("Data wyjazdu musi być późniejsza niż data przyjazdu.");
          return;
        }

        setError("");
        try {
          const availability = await api("hotel", "public-availability", {
            method: "POST",
            body: { dateFrom: from, dateTo: to },
          });
          state.hotel.dateFrom = from;
          state.hotel.dateTo = to;
          state.hotel.availability = availability;
          const availableRoomIds = new Set((availability?.rooms || []).map((room) => room.id));
          state.hotel.selectedRoomIds = state.hotel.selectedRoomIds.filter((roomId) => availableRoomIds.has(roomId));

          if (!availability?.rooms?.length) {
            setError("Brak wolnych pokoi w podanym terminie.");
            return;
          }

          state.step = "hotelRooms";
          render();
        } catch (error) {
          setError(error.message || "Nie udało się sprawdzić dostępności pokoi.");
        }
      });
      return;
    }

    if (state.step === "hotelRooms") {
      document.querySelectorAll("[data-toggle-room]").forEach((button) => {
        button.addEventListener("click", () => {
          const roomId = button.getAttribute("data-toggle-room");
          if (!roomId) return;
          const current = new Set(state.hotel.selectedRoomIds);
          if (current.has(roomId)) current.delete(roomId);
          else current.add(roomId);
          state.hotel.selectedRoomIds = Array.from(current);
          setError("");
          render();
        });
      });

      document.getElementById("gb-next")?.addEventListener("click", () => {
        renewSession({ persist: false });
        if (!state.hotel.selectedRoomIds.length) {
          setError("Wybierz przynajmniej jeden pokój.");
          return;
        }
        setError("");
        state.step = "personal";
        render();
      });
      return;
    }

    if (state.step === "restaurantDateTime") {
      const timeInput = document.getElementById("gb-rest-time");
      const placeInput = document.getElementById("gb-rest-place");

      timeInput?.addEventListener("change", () => {
        state.restaurant.startTime = String(timeInput.value || "");
      });
      placeInput?.addEventListener("change", () => {
        const placePreference = String(placeInput.value || "no_preference");
        state.restaurant.placePreference = RESTAURANT_PLACE_OPTIONS.includes(placePreference) ? placePreference : "no_preference";
      });

      document.getElementById("gb-next")?.addEventListener("click", async () => {
        renewSession({ persist: false });
        const dateValue = String(state.restaurant.reservationDate || "");
        const slots = Array.isArray(selectedCalendarDay(state.restaurant.calendarDays, dateValue)?.slots)
          ? selectedCalendarDay(state.restaurant.calendarDays, dateValue).slots
          : [];
        const selectedTime = String(timeInput?.value || "");
        const placePreferenceRaw = String(placeInput?.value || "no_preference");
        state.restaurant.placePreference = RESTAURANT_PLACE_OPTIONS.includes(placePreferenceRaw)
          ? placePreferenceRaw
          : "no_preference";

        state.restaurant.startTime = selectedTime;

        if (!dateValue) {
          setError("Wybierz dostępny dzień.");
          return;
        }
        if (!slots.length || !selectedTime) {
          setError("Brak dostępnych godzin dla wybranego dnia.");
          return;
        }
        if (!slots.includes(selectedTime)) {
          setError("Wybierz godzinę z dostępnej listy.");
          return;
        }

        try {
          const check = await api("restaurant", "public-availability", {
            method: "POST",
            body: {
              reservationDate: state.restaurant.reservationDate,
              startTime: state.restaurant.startTime,
              durationHours: state.restaurant.durationHours,
              tablesCount: state.restaurant.tablesCount,
              joinTables: state.restaurant.joinTables,
            },
          });
          if (!check?.available) {
            setError("Ten termin właśnie przestał być dostępny. Wybierz inny dzień lub godzinę.");
            await loadRestaurantCalendar({ reservationDate: state.restaurant.reservationDate });
            return;
          }
          setError("");
          state.step = "personal";
          render();
        } catch (error) {
          setError(error.message || "Nie udało się sprawdzić dostępności stolików.");
        }
      });
      return;
    }

    if (state.step === "restaurantDetails") {
      const tablesInput = document.getElementById("gb-rest-tables");
      const guestsInput = document.getElementById("gb-rest-guests");
      const durationInput = document.getElementById("gb-rest-duration");
      const joinInput = document.getElementById("gb-rest-join");
      const noteInput = document.getElementById("gb-rest-note");

      const syncGuestsMax = () => {
        const maxGuestsPerTable = Number(state.restaurant.publicSettings?.maxGuestsPerTable || 4);
        const maxTables = Math.max(1, Number(state.restaurant.publicSettings?.tableCount || 30));
        const tablesCount = clamp(toInt(tablesInput?.value || 1, 1), 1, maxTables);
        const maxGuests = Math.max(1, maxGuestsPerTable * tablesCount);
        tablesInput.value = String(tablesCount);
        guestsInput.max = String(maxGuests);
        if (toInt(guestsInput.value, 1) > maxGuests) {
          guestsInput.value = String(maxGuests);
        }
        const marker = document.getElementById("gb-rest-max");
        if (marker) marker.textContent = String(maxGuestsPerTable);
      };

      tablesInput?.addEventListener("input", syncGuestsMax);
      guestsInput?.addEventListener("input", syncGuestsMax);
      syncGuestsMax();

      document.getElementById("gb-next")?.addEventListener("click", async () => {
        renewSession({ persist: false });
        const tablesCount = clamp(toInt(tablesInput?.value || 1, 1), 1, 30);
        const maxGuestsPerTable = Number(state.restaurant.publicSettings?.maxGuestsPerTable || 4);
        const maxGuests = Math.max(1, maxGuestsPerTable * tablesCount);
        const guestsCount = clamp(toInt(guestsInput?.value || 1, 1), 1, maxGuests);

        state.restaurant.tablesCount = tablesCount;
        state.restaurant.guestsCount = guestsCount;
        state.restaurant.durationHours = Number(durationInput?.value || 2);
        state.restaurant.joinTables = Boolean(joinInput?.checked);
        state.restaurant.customerNote = String(noteInput?.value || "").trim();

        if (guestsCount < 1 || guestsCount > maxGuests) {
          setError(`Liczba gości musi mieścić się w zakresie 1–${maxGuests}.`);
          return;
        }

        setError("");
        state.restaurant.detailsNextPending = true;
        render();
        try {
          await loadRestaurantCalendar({
            reservationDate: state.restaurant.reservationDate,
            render: false,
          });
        } finally {
          state.restaurant.detailsNextPending = false;
        }
        if (!state.restaurant.calendarDays.some((day) => day?.available)) {
          render();
          return;
        }
        state.step = "restaurantDateTime";
        render();
      });
      return;
    }

    if (state.step === "eventsGuests") {
      const durationInput = document.getElementById("gb-events-duration-setup");
      const guestsRange = document.getElementById("gb-events-guests-range");
      const guestsNumber = document.getElementById("gb-events-guests-number");

      const syncGuests = (value) => {
        const normalized = clamp(toInt(value, 60), 1, 120);
        guestsRange.value = String(normalized);
        guestsNumber.value = String(normalized);
      };

      guestsRange?.addEventListener("input", () => syncGuests(guestsRange.value));
      guestsNumber?.addEventListener("input", () => syncGuests(guestsNumber.value));

      document.getElementById("gb-next")?.addEventListener("click", async () => {
        renewSession({ persist: false });
        const durVal = String(durationInput?.value || "");
        if (durVal === "unspecified") {
          state.events.durationUnspecified = true;
          state.events.durationHours = 12;
        } else {
          state.events.durationUnspecified = false;
          state.events.durationHours = Number(durVal || 4);
        }
        state.events.guestsCount = clamp(toInt(guestsNumber?.value || 60, 60), 1, 120);
        if (!state.events.durationUnspecified && (!Number.isFinite(state.events.durationHours) || state.events.durationHours <= 0)) {
          setError("Podaj poprawny czas rezerwacji.");
          return;
        }

        setError("");
        await loadEventsCalendar({
          reservationDate: state.events.reservationDate,
        });
        if (!state.events.calendarDays.some((day) => day?.available)) {
          return;
        }
        state.step = "eventsDateTime";
        render();
      });
      return;
    }

    if (state.step === "eventsDateTime") {
      const timeInput = document.getElementById("gb-events-time");

      timeInput?.addEventListener("change", () => {
        state.events.startTime = String(timeInput.value || "");
      });

      document.getElementById("gb-next")?.addEventListener("click", async () => {
        renewSession({ persist: false });
        const dateValue = String(state.events.reservationDate || "");
        const timeValue = String(timeInput?.value || "");
        const slots = Array.isArray(selectedCalendarDay(state.events.calendarDays, dateValue)?.slots)
          ? selectedCalendarDay(state.events.calendarDays, dateValue).slots
          : [];
        if (!dateValue) {
          setError("Wybierz dostępny dzień.");
          return;
        }
        if (!timeValue || !slots.includes(timeValue)) {
          setError("Wybierz godzinę z dostępnej listy.");
          return;
        }
        const startOk = assertEventsStartOk(dateValue, timeValue);
        if (!startOk.ok) {
          setError(startOk.message);
          return;
        }

        state.events.startTime = timeValue;
        setError("");
        await ensureEventHallsLoaded();
        await refreshEventHallAvailability();
        state.step = "eventsHall";
        render();
      });
      return;
    }

    if (state.step === "eventsHall") {
      document.querySelectorAll("[data-select-hall]").forEach((button) => {
        button.addEventListener("click", () => {
          const hallId = button.getAttribute("data-select-hall") || "";
          if (!hallId) return;
          const hallInfo = state.events.hallAvailability[hallId];
          if (!hallInfo?.available) return;
          state.events.selectedHallId = hallId;
          const selectedHall = state.events.halls.find((hall) => hall.id === hallId);
          if (selectedHall?.hallKind !== "large") {
            state.events.exclusive = false;
          }
          render();
        });
      });

      document.getElementById("gb-next")?.addEventListener("click", () => {
        renewSession({ persist: false });
        if (!state.events.selectedHallId) {
          setError("Wybierz dostępną salę.");
          return;
        }
        setError("");
        state.step = "eventsDetails";
        render();
      });
      return;
    }

    if (state.step === "eventsDetails") {
      const typeInput = document.getElementById("gb-events-type");
      const noteInput = document.getElementById("gb-events-note");
      const exclusiveInput = document.getElementById("gb-events-exclusive");

      document.getElementById("gb-next")?.addEventListener("click", async () => {
        renewSession({ persist: false });
        state.events.eventType = String(typeInput?.value || "").trim();
        state.events.customerNote = String(noteInput?.value || "").trim();

        const selectedHall = state.events.halls.find((hall) => hall.id === state.events.selectedHallId);
        state.events.exclusive = selectedHall?.hallKind === "large" ? Boolean(exclusiveInput?.checked) : false;

        if (!state.events.eventType) {
          setError("Podaj rodzaj imprezy.");
          return;
        }
        if (!state.events.customerNote) {
          setError("Uzupełnij dodatkowe informacje do rezerwacji.");
          return;
        }

        const availability = await checkSelectedHallAvailability();
        if (!availability.ok) {
          setError(availability.error || "Sala jest niedostępna.");
          return;
        }

        setError("");
        state.step = "personal";
        render();
      });
      return;
    }

    if (state.step === "personal") {
      const prefixInput = document.querySelector('[name="phonePrefix"]');
      const nationalInput = document.querySelector('[name="phoneNational"]');
      const normalizePhoneInputsInForm = () => {
        if (!(prefixInput instanceof HTMLInputElement) || !(nationalInput instanceof HTMLInputElement)) return;
        const normalized = normalizePhoneFields(prefixInput.value, nationalInput.value);
        prefixInput.value = normalized.phonePrefix;
        nationalInput.value = normalized.phoneNational;
      };

      prefixInput?.addEventListener("change", normalizePhoneInputsInForm);
      prefixInput?.addEventListener("blur", normalizePhoneInputsInForm);

      document.getElementById("gb-personal-form")?.addEventListener("submit", (event) => {
        event.preventDefault();
        renewSession({ persist: false });
        const form = event.currentTarget;
        if (!(form instanceof HTMLFormElement)) return;
        normalizePhoneInputsInForm();
        if (!form.reportValidity()) return;

        const formData = new FormData(form);
        state.personal.firstName = String(formData.get("firstName") || "").trim();
        state.personal.lastName = String(formData.get("lastName") || "").trim();
        state.personal.email = String(formData.get("email") || "").trim();
        const normalizedPhone = normalizePhoneFields(formData.get("phonePrefix") || "+48", formData.get("phoneNational") || "");
        state.personal.phonePrefix = normalizedPhone.phonePrefix;
        state.personal.phoneNational = String(normalizedPhone.phoneNational || "").trim();
        state.personal.hpCompanyWebsite = String(formData.get("hpCompanyWebsite") || "").trim();
        const phoneDigits = phoneNationalDigits(state.personal.phoneNational);

        if (!state.personal.firstName || !state.personal.lastName || !state.personal.email || !state.personal.phoneNational) {
          setError("Wypełnij wszystkie wymagane pola danych osobowych.");
          return;
        }
        if (phoneDigits.length < 6 || phoneDigits.length > 15) {
          setError("Podaj poprawny numer telefonu (6–15 cyfr, spacje i myślniki są dozwolone).");
          return;
        }

        state.turnstileToken = "";
        state.humanCheck = false;
        state.termsAccepted = false;
        setError("");
        state.step = "summary";
        render();
      });
      return;
    }

    if (state.step === "summary") {
      document.getElementById("gb-submit")?.addEventListener("click", submitCurrentReservation);
      return;
    }

    if (state.step === "success") {
      document.getElementById("gb-close-final")?.addEventListener("click", closeModal);
      return;
    }
  }

  function summaryButtonEnabled() {
    if (!state.termsAccepted) return false;
    return antiBotVerified();
  }

  function updateSummarySubmitState() {
    const submit = document.getElementById("gb-submit");
    if (!submit) return;
    submit.disabled = !summaryButtonEnabled() || state.submitting;
  }

  function ensureTurnstileScript() {
    return new Promise((resolve) => {
      if (!config.turnstileSiteKey) {
        resolve(false);
        return;
      }
      if (window.turnstile) {
        resolve(true);
        return;
      }
      if (document.getElementById("gb-turnstile-script")) {
        const poll = window.setInterval(() => {
          if (window.turnstile) {
            window.clearInterval(poll);
            resolve(true);
          }
        }, 120);
        return;
      }
      const script = document.createElement("script");
      script.id = "gb-turnstile-script";
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      script.async = true;
      script.defer = true;
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });
  }

  async function mountAntiBotHandlers() {
    setError(state.error);

    const terms = document.getElementById("gb-terms");
    terms?.addEventListener("change", () => {
      state.termsAccepted = Boolean(terms.checked);
      persistDraftState();
      updateSummarySubmitState();
    });

    if (!config.turnstileSiteKey || state.turnstileFailed) {
      const human = document.getElementById("gb-human-check");
      human?.addEventListener("change", () => {
        state.humanCheck = Boolean(human.checked);
        persistDraftState();
        render();
      });
      updateSummarySubmitState();
      return;
    }

    if (state.turnstileToken) {
      updateSummarySubmitState();
      return;
    }

    const mounted = await ensureTurnstileScript();
    if (!mounted || !window.turnstile) {
      state.turnstileReady = false;
      state.turnstileFailed = true;
      state.humanCheck = false;
      setError("Nie udało się uruchomić weryfikacji antybotowej. Użyj potwierdzenia awaryjnego.");
      persistDraftState();
      render();
      return;
    }

    const slot = document.getElementById("gb-turnstile-slot");
    if (!slot) {
      updateSummarySubmitState();
      return;
    }

    slot.innerHTML = "";
    state.turnstileToken = "";
    state.turnstileReady = true;
    state.turnstileFailed = false;

    try {
      state.turnstileWidgetId = window.turnstile.render(slot, {
        sitekey: config.turnstileSiteKey,
        callback: (token) => {
          state.turnstileToken = String(token || "");
          state.turnstileFailed = false;
          persistDraftState();
          render();
        },
        "expired-callback": () => {
          state.turnstileToken = "";
          persistDraftState();
          updateSummarySubmitState();
        },
        "error-callback": () => {
          state.turnstileToken = "";
          state.turnstileReady = false;
          state.turnstileFailed = true;
          state.humanCheck = false;
          setError("Weryfikacja antybotowa nie powiodła się. Użyj potwierdzenia awaryjnego.");
          persistDraftState();
          render();
        },
      });
    } catch {
      state.turnstileReady = false;
      state.turnstileFailed = true;
      state.humanCheck = false;
      setError("Nie udało się uruchomić weryfikacji antybotowej. Użyj potwierdzenia awaryjnego.");
      persistDraftState();
      render();
      return;
    }

    updateSummarySubmitState();
  }

  function buildPayload() {
    const service = state.selectedService;
    const common = {
      fullName: fullName(),
      email: state.personal.email,
      phonePrefix: state.personal.phonePrefix,
      phoneNational: state.personal.phoneNational,
      termsAccepted: true,
      sessionStartedAt: state.sessionStartedAt,
      hpCompanyWebsite: state.personal.hpCompanyWebsite || "",
      turnstileToken: state.turnstileToken,
    };

    if (service === "hotel") {
      return {
        service,
        payload: {
          ...common,
          dateFrom: state.hotel.dateFrom,
          dateTo: state.hotel.dateTo,
          roomIds: state.hotel.selectedRoomIds.slice(),
          customerNote: "",
        },
      };
    }

    if (service === "restaurant") {
      return {
        service,
        payload: {
          ...common,
          reservationDate: state.restaurant.reservationDate,
          startTime: state.restaurant.startTime,
          durationHours: state.restaurant.durationHours,
          tablesCount: state.restaurant.tablesCount,
          guestsCount: state.restaurant.guestsCount,
          placePreference: state.restaurant.placePreference,
          joinTables: state.restaurant.joinTables,
          customerNote: state.restaurant.customerNote,
        },
      };
    }

    const selectedHall = state.events.halls.find((hall) => hall.id === state.events.selectedHallId);
    const effectiveDuration = state.events.durationUnspecified ? 12 : state.events.durationHours;
    return {
      service,
      payload: {
        ...common,
        hallId: state.events.selectedHallId,
        reservationDate: state.events.reservationDate,
        startTime: state.events.startTime,
        durationHours: effectiveDuration,
        durationUnspecified: Boolean(state.events.durationUnspecified),
        guestsCount: state.events.guestsCount,
        exclusive: selectedHall?.hallKind === "large" ? state.events.exclusive : true,
        eventType: state.events.eventType,
        customerNote: state.events.customerNote,
      },
    };
  }

  async function submitCurrentReservation() {
    if (state.submitting) return;

    if (!state.termsAccepted) {
      setError("Zaakceptuj regulamin, aby kontynuować.");
      return;
    }

    if (state.selectedService === "events") {
      const evOk = assertEventsStartOk(state.events.reservationDate, state.events.startTime);
      if (!evOk.ok) {
        setError(evOk.message);
        return;
      }
    }

    if (config.turnstileSiteKey && !state.turnstileFailed && !antiBotVerified()) {
      setError("Potwierdź weryfikację antybotową.");
      return;
    }

    if ((!config.turnstileSiteKey || state.turnstileFailed) && !antiBotVerified()) {
      setError("Potwierdź, że nie jesteś botem.");
      return;
    }

    renewSession({ persist: false });
    state.submitting = true;
    updateSummarySubmitState();
    setError("");

    try {
      const { service, payload } = buildPayload();
      const response = await api(service, "public-reservation-draft", {
        method: "POST",
        body: payload,
      });

      state.pendingEmailSent = true;
      state.requiresEmailConfirmation = response?.requiresEmailConfirmation !== false;
      state.countdownUntil = state.requiresEmailConfirmation ? Date.now() + EMAIL_CONFIRM_MS : 0;
      state.step = "success";
      state.submitting = false;
      render();
    } catch (error) {
      state.submitting = false;
      if (window.turnstile && config.turnstileSiteKey) {
        try {
          if (state.turnstileWidgetId !== null && state.turnstileWidgetId !== undefined) {
            window.turnstile.reset(state.turnstileWidgetId);
          } else {
            window.turnstile.reset();
          }
        } catch {
          /* bezpieczny fallback */
        }
        state.turnstileToken = "";
        state.turnstileReady = false;
      }
      setError(error.message || "Nie udało się zapisać rezerwacji.");
      updateSummarySubmitState();
    }
  }

  function startCountdownTicker() {
    clearCountdown();
    if (!state.requiresEmailConfirmation || !state.countdownUntil) return;

    const target = document.getElementById("gb-countdown-value");
    if (!target) return;

    const tick = () => {
      const left = Math.max(0, state.countdownUntil - Date.now());
      target.textContent = formatCountdown(left);
    };

    tick();
    state.countdownTimer = window.setInterval(tick, 1000);
  }

  async function openModal() {
    ensureCss();
    ensureModalMarkup();
    const restored = restoreDraftState();
    if (!restored) {
      resetStateForOpen();
    }
    state.isOpen = true;

    const modal = document.getElementById("gb-modal");
    if (!modal) return;

    modal.classList.add("gb-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("gb-modal-open");

    if (state.step !== "success") {
      renewSession();
    }
    await loadBookingFlags();
    if (!state.selectedService && state.step !== "service") {
      state.step = "service";
    }
    if (state.selectedService === "restaurant" && ["restaurantDateTime"].includes(state.step) && !state.restaurant.calendarDays.length) {
      await loadRestaurantCalendar({ render: false, reservationDate: state.restaurant.reservationDate });
    }
    if (state.selectedService === "events") {
      if (["eventsDateTime", "eventsHall", "eventsDetails"].includes(state.step) && !state.events.calendarDays.length) {
        await loadEventsCalendar({ render: false, reservationDate: state.events.reservationDate });
      }
      if (["eventsHall", "eventsDetails"].includes(state.step) && !state.events.halls.length) {
        try {
          await ensureEventHallsLoaded();
        } catch (error) {
          setError(error?.message || "Nie udało się załadować sal.");
        }
      }
      if (state.step === "eventsHall" && state.events.halls.length) {
        await refreshEventHallAvailability();
      }
    }
    render();
  }

  function closeModal() {
    syncCurrentStepFromDom();
    clearCountdown();
    clearSessionRefreshTimer();
    state.isOpen = false;
    state.turnstileToken = "";
    state.turnstileWidgetId = null;
    state.turnstileReady = false;
    state.turnstileFailed = false;
    state.humanCheck = false;

    const modal = document.getElementById("gb-modal");
    if (!modal) return;

    modal.classList.remove("gb-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("gb-modal-open");

    if (state.step === "success") {
      clearDraftState();
      resetStateForOpen();
      return;
    }
    persistDraftState();
  }

  function bindOpeners() {
    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const opener = target.closest("[data-open-global-booking]");
      if (!opener) return;
      event.preventDefault();
      openModal();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.isOpen) {
        closeModal();
        return;
      }
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const opener = target.closest("[data-open-global-booking]");
      if (!opener) return;
      event.preventDefault();
      openModal();
    });
  }

  bindOpeners();
})();
