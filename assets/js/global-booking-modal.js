(function () {
  const config = window.SREDZKA_CONFIG || {};
  const SESSION_MS = 30 * 60 * 1000;
  const SESSION_REFRESH_LEEWAY_MS = 30 * 1000;
  const EMAIL_CONFIRM_MS = 2 * 60 * 60 * 1000;
  const DRAFT_STORAGE_KEY = "sredzka-korona:global-booking-draft:v1";
  const PAGE_VISIT_ID =
    window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
      label: "Przyjecia",
      subtitle: "Sale i wydarzenia",
      apiService: "hall",
      confirmPath: "../dokumenty/index.html#regulamin-rezerwacji-sali",
    },
  };

  const FLOW_BY_SERVICE = {
    hotel: ["service", "hotelDates", "hotelRooms", "personal", "summary", "success"],
    restaurant: ["service", "restaurantDateTime", "restaurantDetails", "personal", "summary", "success"],
    events: ["service", "eventsDateTime", "eventsHall", "eventsDetails", "personal", "summary", "success"],
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
    humanCheck: false,
    countdownUntil: 0,
    countdownTimer: null,
    sessionRefreshTimer: null,
    pendingEmailSent: false,
    termsAccepted: false,
    requiresEmailConfirmation: true,
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

  function hmToMinutes(value) {
    const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
    if (!match) return null;
    const hh = Number(match[1]);
    const mm = Number(match[2]);
    if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 24 || mm < 0 || mm > 59) return null;
    if (hh === 24 && mm !== 0) return null;
    return hh * 60 + mm;
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

  function antiBotVerified() {
    return config.turnstileSiteKey ? Boolean(state.turnstileToken) : Boolean(state.humanCheck);
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
      throw new Error(data.error || "Nie udalo sie polaczyc z systemem rezerwacji.");
    }
    return data;
  }

  function ensureCss() {
    if (document.getElementById("gb-modal-css")) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.id = "gb-modal-css";
    const cs = document.currentScript;
    if (cs && cs.src) {
      try {
        link.href = new URL("../css/global-booking-modal.css", cs.src).href;
      } catch {
        link.href = "/assets/css/global-booking-modal.css";
      }
    } else {
      link.href = "/assets/css/global-booking-modal.css";
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
    state.humanCheck = false;
    state.countdownUntil = 0;
    state.pendingEmailSent = false;
    state.termsAccepted = false;
    state.requiresEmailConfirmation = true;

    state.hotel = {
      dateFrom: "",
      dateTo: "",
      availability: null,
      selectedRoomIds: [],
    };

    state.restaurant = {
      loading: false,
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
      halls: [],
      reservationDate: todayYmdLocal(),
      startTime: "12:00",
      durationHours: 4,
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
      personal: state.personal,
      hotel: state.hotel,
      restaurant: state.restaurant,
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
      state.humanCheck = Boolean(draft.humanCheck);
      state.turnstileToken = "";
      state.turnstileWidgetId = null;

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
        halls: Array.isArray(draft.events?.halls) ? draft.events.halls : [],
        reservationDate: cleanString(draft.events?.reservationDate, 10) || todayYmdLocal(),
        startTime: cleanString(draft.events?.startTime, 5) || "12:00",
        durationHours: Number(draft.events?.durationHours || 4),
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

  async function loadRestaurantSettingsForDate(dateValue) {
    state.restaurant.loading = true;
    render();
    try {
      const data = await api("restaurant", "public-settings", {
        method: "GET",
        query: { reservationDate: dateValue },
      });
      state.restaurant.publicSettings = data;
      state.restaurant.reservationDate = data?.selectedDate || dateValue;
      syncRestaurantStartTime();
    } finally {
      state.restaurant.loading = false;
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
          reason: "Mala sala obsluguje maksymalnie 40 gosci.",
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
                reason: response?.available ? "" : "Termin jest zajety lub zablokowany.",
                maxGuests: Number(response?.maxGuests || Math.min(40, Number(smallHall.capacity || 40))),
              };
            })
            .catch(() => {
              state.events.hallAvailability[smallHall.id] = {
                available: false,
                reason: "Nie udalo sie sprawdzic dostepnosci.",
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
              reason: response?.available ? "" : "Brak dostepnej pojemnosci sali dla tego terminu.",
              maxGuests,
            };
          })
          .catch(() => {
            state.events.hallAvailability[largeHall.id] = {
              available: false,
              reason: "Nie udalo sie sprawdzic dostepnosci.",
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
    if (!hallId) return { ok: false, error: "Wybierz sale." };

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
        return { ok: false, error: "Wybrana sala nie jest dostepna dla podanego terminu." };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message || "Nie udalo sie sprawdzic sali." };
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
      hotelDates: "Hotel - termin pobytu",
      hotelRooms: "Hotel - pokoje",
      restaurantDateTime: "Restauracja - termin",
      restaurantDetails: "SZCZEGÓŁY",
      eventsDateTime: "Przyjecia - termin i liczba gosci",
      eventsHall: "Przyjecia - wybor sali",
      eventsDetails: "Przyjecia - szczegoly wydarzenia",
      personal: "Dane osobowe",
      summary: "Podsumowanie",
      success: "Potwierdzenie wysylki",
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
                <small>${enabled ? escapeHtml(meta.subtitle) : "Rezerwacje wylaczone"}</small>
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
          <button type="button" class="gb-btn gb-btn-secondary" id="gb-back">Wroc</button>
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
                        <strong class="gb-room-name">${escapeHtml(room.name)}</strong>
                        <p class="gb-room-line">
                          <span class="gb-room-line-left">
                            <span class="gb-room-icon" aria-hidden="true">👤</span>
                            ${escapeHtml(String(guests))} osobowy
                          </span>
                        </p>
                        <div class="gb-room-line gb-room-line--beds">
                          <span class="gb-room-line-left">
                            <span class="gb-room-icon" aria-hidden="true">🛏️</span>
                            ${escapeHtml(hotelBedSummary(room))}
                          </span>
                          <button type="button" class="gb-pill-btn ${isSelected ? "is-active" : ""}" data-toggle-room="${escapeHtml(room.id)}">
                            ${isSelected ? "W koszyku" : "Dodaj do koszyka"}
                          </button>
                        </div>
                        <div class="gb-room-price-wrap">
                          <span class="gb-room-price">${escapeHtml(unit.toFixed(2))} PLN / noc</span>
                          <small class="gb-room-price-note">${escapeHtml(subtotal)} PLN / za ${escapeHtml(String(nights))} nocy</small>
                        </div>
                        ${room.description ? `<p class="gb-room-meta">${escapeHtml(room.description)}</p>` : ""}
                      </article>
                    `;
                  })
                  .join("")
              : "<p class=\"gb-hint\">Brak wolnych pokoi w podanym terminie.</p>"
          }
        </div>
        <div class="gb-cart">
          <strong>Wybrane pokoje:</strong>
          ${
            state.hotel.selectedRoomIds.length
              ? `<ul>${state.hotel.selectedRoomIds
                  .map((id) => {
                    const room = rooms.find((entry) => entry.id === id);
                    return `<li>${escapeHtml(room?.name || id)}</li>`;
                  })
                  .join("")}</ul>`
              : " <span>brak</span>"
          }
          <div class="gb-cart-total-row">
            <span><strong>Liczba nocy:</strong> ${escapeHtml(String(nights))}</span>
            <strong class="gb-cart-total">Razem ${escapeHtml(hotelTotalPrice().toFixed(2))} PLN</strong>
          </div>
        </div>
        <div class="gb-actions">
          <button type="button" class="gb-btn gb-btn-secondary" id="gb-back">Wroc</button>
          <button type="button" class="gb-btn gb-btn-primary" id="gb-next" ${state.hotel.selectedRoomIds.length ? "" : "disabled"}>Dalej</button>
        </div>
        <p class="gb-error" id="gb-error">${escapeHtml(state.error)}</p>
      </section>
    `;
  }

  function renderRestaurantDateTimeStep() {
    if (state.restaurant.loading) {
      return `<p class="gb-hint">Ladowanie godzin otwarcia i dostepnych slotow...</p>`;
    }

    const slots = restaurantSlotsForDuration();
    const dayWindow = restaurantWindow();
    const dayHint = state.restaurant.publicSettings?.closedForDay
      ? "Restauracja jest nieczynna w wybranym dniu."
      : dayWindow
        ? `Godziny otwarcia dla tego dnia: ${dayWindow.openRaw}-${dayWindow.closeRaw}.`
        : "";

    return `
      <section>
        <h3>Restauracja - data, godzina i czas</h3>
        <p class="gb-hint">Godzina musi pokrywac sie z godzinami otwarcia restauracji.</p>
        ${dayHint ? `<p class="gb-inline-note">${escapeHtml(dayHint)}</p>` : ""}
        <div class="gb-grid-3">
          <label class="gb-field">
            <span>Data rezerwacji</span>
            <input type="date" id="gb-rest-date" min="${escapeHtml(todayYmdLocal())}" value="${escapeHtml(state.restaurant.reservationDate)}" required />
          </label>
          <label class="gb-field">
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
                  : '<option value="">Brak dostepnych godzin</option>'
              }
            </select>
          </label>
          <label class="gb-field">
            <span>Czas rezerwacji</span>
            <select id="gb-rest-duration">
              ${[1, 1.5, 2, 2.5, 3, 4, 5, 6]
                .map(
                  (h) =>
                    `<option value="${escapeHtml(String(h))}" ${Number(state.restaurant.durationHours) === Number(h) ? "selected" : ""}>${escapeHtml(String(h))} h</option>`
                )
                .join("")}
            </select>
          </label>
        </div>
        <div class="gb-actions">
          <button type="button" class="gb-btn gb-btn-secondary" id="gb-back">Wroc</button>
          <button type="button" class="gb-btn gb-btn-primary" id="gb-next">Dalej</button>
        </div>
        <p class="gb-error" id="gb-error">${escapeHtml(state.error)}</p>
      </section>
    `;
  }

  function renderRestaurantDetailsStep() {
    const maxGuestsPerTable = Number(state.restaurant.publicSettings?.maxGuestsPerTable || 4);
    const maxGuests = Math.max(1, maxGuestsPerTable * Number(state.restaurant.tablesCount || 1));
    return `
      <section>
        <h3>SZCZEGÓŁY</h3>
        <div class="gb-grid-3">
          <label class="gb-field">
            <span>Liczba stolow</span>
            <input type="number" id="gb-rest-tables" min="1" max="30" value="${escapeHtml(String(state.restaurant.tablesCount))}" required />
          </label>
          <label class="gb-field">
            <span>Liczba gosci</span>
            <input type="number" id="gb-rest-guests" min="1" max="${escapeHtml(String(maxGuests))}" value="${escapeHtml(String(state.restaurant.guestsCount))}" required />
          </label>
          <label class="gb-field">
            <span>Miejsce</span>
            <select id="gb-rest-place">
              <option value="no_preference" ${state.restaurant.placePreference === "no_preference" ? "selected" : ""}>Brak preferencji</option>
              <option value="inside" ${state.restaurant.placePreference === "inside" ? "selected" : ""}>W lokalu</option>
              <option value="terrace" ${state.restaurant.placePreference === "terrace" ? "selected" : ""}>Na tarasie</option>
            </select>
          </label>
        </div>
        <p class="gb-inline-note">Maksymalna liczba gosci dla aktualnych ustawien: <strong id="gb-rest-max">${escapeHtml(String(maxGuests))}</strong>.</p>
        <label class="gb-check">
          <input type="checkbox" id="gb-rest-join" ${state.restaurant.joinTables ? "checked" : ""} />
          <span>Prosba o polaczenie stolow (opcja)</span>
        </label>
        <label class="gb-field" style="margin-top:0.7rem;">
          <span>Dodatkowe informacje (opcja)</span>
          <textarea id="gb-rest-note" maxlength="2000">${escapeHtml(state.restaurant.customerNote)}</textarea>
        </label>
        <div class="gb-actions">
          <button type="button" class="gb-btn gb-btn-secondary" id="gb-back">Wroc</button>
          <button type="button" class="gb-btn gb-btn-primary" id="gb-next">Dalej</button>
        </div>
        <p class="gb-error" id="gb-error">${escapeHtml(state.error)}</p>
      </section>
    `;
  }

  function renderEventsDateTimeStep() {
    return `
      <section>
        <h3>Przyjecia - termin i liczba gosci</h3>
        <div class="gb-grid-3">
          <label class="gb-field">
            <span>Data rezerwacji</span>
            <input type="date" id="gb-events-date" min="${escapeHtml(todayYmdLocal())}" value="${escapeHtml(state.events.reservationDate)}" required />
          </label>
          <label class="gb-field">
            <span>Godzina rezerwacji</span>
            <input type="time" id="gb-events-time" value="${escapeHtml(state.events.startTime)}" required />
          </label>
          <label class="gb-field">
            <span>Czas rezerwacji (h)</span>
            <select id="gb-events-duration">
              ${[1, 2, 3, 4, 5, 6, 8]
                .map(
                  (h) =>
                    `<option value="${h}" ${Number(state.events.durationHours) === h ? "selected" : ""}>${h} h</option>`
                )
                .join("")}
            </select>
          </label>
        </div>

        <div class="gb-range-wrap" style="margin-top:0.75rem;">
          <span class="gb-range-label">Liczba gosci (1-120, domyslnie 60)</span>
          <div class="gb-range-pair">
            <input type="range" id="gb-events-guests-range" min="1" max="120" value="${escapeHtml(String(clamp(toInt(state.events.guestsCount, 60), 1, 120)))}" />
            <input type="number" id="gb-events-guests-number" min="1" max="120" value="${escapeHtml(String(clamp(toInt(state.events.guestsCount, 60), 1, 120)))}" required />
          </div>
        </div>

        <div class="gb-actions">
          <button type="button" class="gb-btn gb-btn-secondary" id="gb-back">Wroc</button>
          <button type="button" class="gb-btn gb-btn-primary" id="gb-next">Dalej</button>
        </div>
        <p class="gb-error" id="gb-error">${escapeHtml(state.error)}</p>
      </section>
    `;
  }

  function renderEventsHallStep() {
    if (state.events.loading) {
      return `<p class="gb-hint">Ladowanie konfiguracji sal...</p>`;
    }
    const smallHall = eventHallByKind("small");
    const largeHall = eventHallByKind("large");

    const smallInfo = smallHall
      ? state.events.hallAvailability[smallHall.id] || { available: false, reason: "Sprawdzanie dostepnosci..." }
      : { available: false, reason: "Brak skonfigurowanej malej sali." };
    const largeInfo = largeHall
      ? state.events.hallAvailability[largeHall.id] || { available: false, reason: "Sprawdzanie dostepnosci..." }
      : { available: false, reason: "Brak skonfigurowanej duzej sali." };

    const noHallAvailable = !smallInfo.available && !largeInfo.available;

    return `
      <section>
        <h3>Przyjecia - wybor sali</h3>
        <p class="gb-hint">Mala sala: tylko na wylacznosc do 40 osob. Duza sala: wspoldzielona do sumy 120 osob, chyba ze zaznaczysz wylacznosc.</p>
        <div class="gb-hall-tiles">
          <button
            type="button"
            class="gb-hall-tile ${smallInfo.available ? "" : "is-disabled"} ${state.events.selectedHallId === smallHall?.id ? "is-selected" : ""}"
            data-select-hall="${escapeHtml(smallHall?.id || "")}"
            ${smallInfo.available && smallHall ? "" : "disabled"}
          >
            <strong>${escapeHtml(smallHall?.name || "Sala mala")}</strong>
            <small>${smallInfo.available ? "Dostepna" : escapeHtml(smallInfo.reason || "Niedostepna")}</small>
          </button>

          <button
            type="button"
            class="gb-hall-tile ${largeInfo.available ? "" : "is-disabled"} ${state.events.selectedHallId === largeHall?.id ? "is-selected" : ""}"
            data-select-hall="${escapeHtml(largeHall?.id || "")}"
            ${largeInfo.available && largeHall ? "" : "disabled"}
          >
            <strong>${escapeHtml(largeHall?.name || "Sala duza")}</strong>
            <small>${largeInfo.available ? `Dostepna (wolne miejsca: ${escapeHtml(String(largeInfo.maxGuests || 0))})` : escapeHtml(largeInfo.reason || "Niedostepna")}</small>
          </button>
        </div>

        ${noHallAvailable ? '<p class="gb-inline-note">Brak dostepnej sali dla podanego terminu i liczby gosci.</p>' : ""}

        <div class="gb-actions">
          <button type="button" class="gb-btn gb-btn-secondary" id="gb-back">Wroc</button>
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
        <h3>Przyjecia - szczegoly wydarzenia</h3>
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
            ? `<label class="gb-check"><input type="checkbox" id="gb-events-exclusive" ${state.events.exclusive ? "checked" : ""} /><span>Sala na wylacznosc (rezerwuje cala duza sale, niezaleznie od liczby osob)</span></label>`
            : ""
        }
        <div class="gb-actions">
          <button type="button" class="gb-btn gb-btn-secondary" id="gb-back">Wroc</button>
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
              <input type="text" name="firstName" maxlength="60" value="${escapeHtml(state.personal.firstName)}" required />
            </label>
            <label class="gb-field">
              <span>Nazwisko</span>
              <input type="text" name="lastName" maxlength="60" value="${escapeHtml(state.personal.lastName)}" required />
            </label>
          </div>

          <div class="gb-grid-2" style="margin-top:0.75rem;">
            <label class="gb-field">
              <span>Adres e-mail</span>
              <input type="email" name="email" maxlength="180" value="${escapeHtml(state.personal.email)}" required />
            </label>
            <div class="gb-phone-row">
              <label class="gb-field">
                <span>Prefiks</span>
                <input type="text" class="gb-phone-prefix" name="phonePrefix" maxlength="5" value="${escapeHtml(normalizePhonePrefix(state.personal.phonePrefix || "+48"))}" pattern="\\+[0-9]{1,4}" inputmode="tel" required />
              </label>
              <label class="gb-field">
                <span>Numer telefonu</span>
                <input type="text" name="phoneNational" maxlength="24" value="${escapeHtml(state.personal.phoneNational)}" pattern="[0-9][0-9\\s-]{5,23}" inputmode="tel" required />
              </label>
            </div>
          </div>

          <div class="gb-actions">
            <button type="button" class="gb-btn gb-btn-secondary" id="gb-back">Wroc</button>
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
      return `
        <div class="gb-summary-box gb-summary-box--hotel">
          <h3 style="margin-bottom:0.3rem;">Podsumowanie</h3>
          <ul class="gb-summary-list">
            <li><strong>Termin:</strong> ${escapeHtml(state.hotel.dateFrom)} - ${escapeHtml(state.hotel.dateTo)} (${escapeHtml(String(nights))} nocy)</li>
            ${state.hotel.selectedRoomIds
              .map((id) => {
                const room = roomsById.get(id);
                const unit = Number(room?.pricePerNight || 0);
                const lineTotal = (unit * nights).toFixed(2);
                return `<li><strong>${escapeHtml(room?.name || id)}</strong> — ${escapeHtml(unit.toFixed(2))} PLN / noc — ${escapeHtml(lineTotal)} PLN</li>`;
              })
              .join("")}
          </ul>
          <p class="gb-summary-total">Razem ${escapeHtml(hotelTotalPrice().toFixed(2))} PLN</p>
        </div>
      `;
    }

    if (service === "restaurant") {
      return `
        <div class="gb-summary-box">
          <h3 style="margin-bottom:0.3rem;">Podsumowanie - Restauracja</h3>
          <ul class="gb-summary-list">
            <li><strong>Data:</strong> ${escapeHtml(state.restaurant.reservationDate)}</li>
            <li><strong>Godzina:</strong> ${escapeHtml(state.restaurant.startTime)}</li>
            <li><strong>Czas rezerwacji:</strong> ${escapeHtml(String(state.restaurant.durationHours))} h</li>
            <li><strong>Liczba stolow:</strong> ${escapeHtml(String(state.restaurant.tablesCount))}</li>
            <li><strong>Liczba gosci:</strong> ${escapeHtml(String(state.restaurant.guestsCount))}</li>
            <li><strong>Miejsce:</strong> ${escapeHtml(
              state.restaurant.placePreference === "inside"
                ? "W lokalu"
                : state.restaurant.placePreference === "terrace"
                  ? "Na tarasie"
                  : "Brak preferencji"
            )}</li>
            <li><strong>Prosba o polaczenie stolow:</strong> ${state.restaurant.joinTables ? "tak" : "nie"}</li>
            ${state.restaurant.customerNote ? `<li><strong>Dodatkowe informacje:</strong> ${escapeHtml(state.restaurant.customerNote)}</li>` : ""}
          </ul>
        </div>
      `;
    }

    const selectedHall = state.events.halls.find((hall) => hall.id === state.events.selectedHallId);
    return `
      <div class="gb-summary-box">
        <h3 style="margin-bottom:0.3rem;">Podsumowanie - Przyjecia</h3>
        <ul class="gb-summary-list">
          <li><strong>Data:</strong> ${escapeHtml(state.events.reservationDate)}</li>
          <li><strong>Godzina:</strong> ${escapeHtml(state.events.startTime)}</li>
          <li><strong>Czas rezerwacji:</strong> ${escapeHtml(String(state.events.durationHours))} h</li>
          <li><strong>Liczba gosci:</strong> ${escapeHtml(String(state.events.guestsCount))}</li>
          <li><strong>Sala:</strong> ${escapeHtml(selectedHall?.name || "-")}</li>
          <li><strong>Rodzaj imprezy:</strong> ${escapeHtml(state.events.eventType)}</li>
          <li><strong>Dodatkowe informacje:</strong> ${escapeHtml(state.events.customerNote)}</li>
          ${selectedHall?.hallKind === "large" ? `<li><strong>Sala na wylacznosc:</strong> ${state.events.exclusive ? "tak" : "nie"}</li>` : ""}
          <li><strong>Koszt:</strong> ustalany indywidualnie.</li>
        </ul>
      </div>
    `;
  }

  function renderAntiBotSection() {
    if (config.turnstileSiteKey) {
      return `<div class="gb-antibot-wrap"><div id="gb-turnstile-slot"></div></div>`;
    }
    return `
      <label class="gb-check gb-antibot-wrap">
        <input type="checkbox" id="gb-human-check" ${state.humanCheck ? "checked" : ""} />
        <span>Potwierdzam, ze nie jestem botem.</span>
      </label>
    `;
  }

  function renderSummaryStep() {
    const submitLabel = state.selectedService === "events" ? "Poproś o ofertę" : "Rezerwuj";
    const showSubmitButton = antiBotVerified();

    return `
      <section>
        <h3>Podsumowanie</h3>

        <div class="gb-summary-grid">
          <div class="gb-summary-box">
            <h3 style="margin-bottom:0.3rem;">Dane zamawiającego</h3>
            <ul class="gb-summary-list">
              <li><strong>Imię i nazwisko:</strong> ${escapeHtml(fullName())}</li>
              <li><strong>E-mail:</strong> ${escapeHtml(state.personal.email)}</li>
              <li><strong>Telefon:</strong> ${escapeHtml(`${state.personal.phonePrefix} ${state.personal.phoneNational}`.trim())}</li>
            </ul>
          </div>
          ${renderSummaryBox()}
        </div>

        <label class="gb-check">
          <input type="checkbox" id="gb-terms" ${state.termsAccepted ? "checked" : ""} />
          <span>Akceptuję <a class="gb-link" href="${escapeHtml(SERVICE_META[state.selectedService]?.confirmPath || "#")}" target="_blank" rel="noopener">regulamin rezerwacji</a>, oraz fakt, że moja rezerwacja zostanie rozpatrzona w ciągu 3 dni.</span>
        </label>

        <div class="gb-actions">
          <button type="button" class="gb-btn gb-btn-secondary" id="gb-back">Wroc</button>
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
    return `
      <section>
        <h3>Rezerwacja została zapisana</h3>
        ${
          state.requiresEmailConfirmation
            ? `<div class="gb-success-card">
                <p class="gb-hint">Wysłaliśmy link potwierdzający na Twój adres e-mail. Kliknij go, aby aktywować zgłoszenie.</p>
                <p class="gb-countdown"><strong>Czas na potwierdzenie:</strong> <span id="gb-countdown-value">${escapeHtml(formatCountdown(left))}</span></p>
                <p class="gb-hint" style="margin-top:0.75rem;">Po potwierdzeniu maila rezerwacja przejdzie na status <strong>oczekująca</strong>. Decyzję o przyjęciu lub odrzuceniu wyślemy e-mailowo w ciągu <strong>3 dni</strong>. Rezerwacja może nie zostać przyjęta.</p>
                ${supportNotice}
              </div>`
            : `<div class="gb-success-card">
                <p class="gb-hint">Zgłoszenie trafiło już do kolejki oczekującej. Mail potwierdzający nie był wymagany dla tego zgłoszenia.</p>
                <p class="gb-hint" style="margin-top:0.5rem;">Decyzję o przyjęciu lub odrzuceniu otrzymasz e-mailowo w ciągu <strong>3 dni</strong>. Rezerwacja może nie zostać przyjęta.</p>
                ${supportNotice}
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
        <h3>Sesja wygasla</h3>
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
      state.restaurant.reservationDate = String(document.getElementById("gb-rest-date")?.value || state.restaurant.reservationDate || "");
      state.restaurant.startTime = String(document.getElementById("gb-rest-time")?.value || state.restaurant.startTime || "");
      state.restaurant.durationHours = Number(document.getElementById("gb-rest-duration")?.value || state.restaurant.durationHours || 2);
      return;
    }
    if (state.step === "restaurantDetails") {
      state.restaurant.tablesCount = clamp(toInt(document.getElementById("gb-rest-tables")?.value || state.restaurant.tablesCount || 1, 1), 1, 30);
      state.restaurant.guestsCount = clamp(toInt(document.getElementById("gb-rest-guests")?.value || state.restaurant.guestsCount || 1, 1), 1, 300);
      const placePreference = String(document.getElementById("gb-rest-place")?.value || state.restaurant.placePreference || "no_preference");
      state.restaurant.placePreference = RESTAURANT_PLACE_OPTIONS.includes(placePreference) ? placePreference : "no_preference";
      state.restaurant.joinTables = Boolean(document.getElementById("gb-rest-join")?.checked);
      state.restaurant.customerNote = String(document.getElementById("gb-rest-note")?.value || state.restaurant.customerNote || "").trim();
      return;
    }
    if (state.step === "eventsDateTime") {
      state.events.reservationDate = String(document.getElementById("gb-events-date")?.value || state.events.reservationDate || "");
      state.events.startTime = String(document.getElementById("gb-events-time")?.value || state.events.startTime || "");
      state.events.durationHours = Number(document.getElementById("gb-events-duration")?.value || state.events.durationHours || 4);
      state.events.guestsCount = clamp(toInt(document.getElementById("gb-events-guests-number")?.value || state.events.guestsCount || 60, 60), 1, 120);
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
      state.personal.phonePrefix = normalizePhonePrefix(document.querySelector('[name="phonePrefix"]')?.value || state.personal.phonePrefix || "+48");
      state.personal.phoneNational = String(document.querySelector('[name="phoneNational"]')?.value || state.personal.phoneNational || "").trim();
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
        button.addEventListener("click", async () => {
          renewSession({ persist: false });
          const service = button.getAttribute("data-service-select");
          if (!service || state.bookingFlags[service] === false) return;
          setError("");
          state.selectedService = service;
          const flow = getFlow();
          state.step = flow[1] || "summary";

          if (service === "restaurant") {
            await loadRestaurantSettingsForDate(state.restaurant.reservationDate || todayYmdLocal());
          }
          if (service === "events") {
            await ensureEventHallsLoaded();
          }
          render();
        });
      });
      return;
    }

    document.getElementById("gb-back")?.addEventListener("click", goBack);

    if (state.step === "hotelDates") {
      const fromInput = document.getElementById("gb-hotel-date-from");
      const toInput = document.getElementById("gb-hotel-date-to");
      document.getElementById("gb-next")?.addEventListener("click", async () => {
        renewSession({ persist: false });
        const from = String(fromInput?.value || "");
        const to = String(toInput?.value || "");
        const today = todayYmdLocal();

        if (!from || !to) {
          setError("Wypelnij oba pola dat.");
          return;
        }
        if (from < today) {
          setError("Data przyjazdu nie moze byc w przeszlosci.");
          return;
        }
        if (to <= from) {
          setError("Data wyjazdu musi byc pozniejsza niz data przyjazdu.");
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
          setError(error.message || "Nie udalo sie sprawdzic dostepnosci pokoi.");
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
          setError("Wybierz przynajmniej jeden pokoj.");
          return;
        }
        setError("");
        state.step = "personal";
        render();
      });
      return;
    }

    if (state.step === "restaurantDateTime") {
      const dateInput = document.getElementById("gb-rest-date");
      const timeInput = document.getElementById("gb-rest-time");
      const durationInput = document.getElementById("gb-rest-duration");

      dateInput?.addEventListener("change", async () => {
        state.restaurant.reservationDate = String(dateInput.value || "");
        setError("");
        await loadRestaurantSettingsForDate(state.restaurant.reservationDate || todayYmdLocal());
        render();
      });

      durationInput?.addEventListener("change", () => {
        state.restaurant.durationHours = Number(durationInput.value || 2);
        syncRestaurantStartTime();
        render();
      });

      timeInput?.addEventListener("change", () => {
        state.restaurant.startTime = String(timeInput.value || "");
      });

      document.getElementById("gb-next")?.addEventListener("click", () => {
        renewSession({ persist: false });
        const dateValue = String(dateInput?.value || "");
        const slots = restaurantSlotsForDuration();
        const selectedTime = String(timeInput?.value || "");
        const today = todayYmdLocal();

        state.restaurant.reservationDate = dateValue;
        state.restaurant.startTime = selectedTime;
        state.restaurant.durationHours = Number(durationInput?.value || 2);

        if (!dateValue || dateValue < today) {
          setError("Wybierz poprawna date (nie moze byc z przeszlosci).");
          return;
        }
        if (!slots.length || !selectedTime) {
          setError("Brak dostepnych godzin dla wybranego dnia i czasu trwania.");
          return;
        }
        if (!slots.includes(selectedTime)) {
          setError("Wybrana godzina nie miesci sie w godzinach otwarcia.");
          return;
        }

        setError("");
        state.step = "restaurantDetails";
        render();
      });
      return;
    }

    if (state.step === "restaurantDetails") {
      const tablesInput = document.getElementById("gb-rest-tables");
      const guestsInput = document.getElementById("gb-rest-guests");
      const placeInput = document.getElementById("gb-rest-place");
      const joinInput = document.getElementById("gb-rest-join");
      const noteInput = document.getElementById("gb-rest-note");

      const syncGuestsMax = () => {
        const maxGuestsPerTable = Number(state.restaurant.publicSettings?.maxGuestsPerTable || 4);
        const tablesCount = clamp(toInt(tablesInput?.value || 1, 1), 1, 30);
        const maxGuests = Math.max(1, maxGuestsPerTable * tablesCount);
        tablesInput.value = String(tablesCount);
        guestsInput.max = String(maxGuests);
        if (toInt(guestsInput.value, 1) > maxGuests) {
          guestsInput.value = String(maxGuests);
        }
        const marker = document.getElementById("gb-rest-max");
        if (marker) marker.textContent = String(maxGuests);
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
        const placePreference = String(placeInput?.value || "no_preference");
        state.restaurant.placePreference = RESTAURANT_PLACE_OPTIONS.includes(placePreference) ? placePreference : "no_preference";
        state.restaurant.joinTables = Boolean(joinInput?.checked);
        state.restaurant.customerNote = String(noteInput?.value || "").trim();

        if (guestsCount < 1 || guestsCount > maxGuests) {
          setError(`Liczba gosci musi miescic sie w zakresie 1-${maxGuests}.`);
          return;
        }

        setError("");

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
            setError("Brak wystarczajacej liczby wolnych stolikow w tym terminie.");
            return;
          }
          state.step = "personal";
          render();
        } catch (error) {
          setError(error.message || "Nie udalo sie sprawdzic dostepnosci stolikow.");
        }
      });
      return;
    }

    if (state.step === "eventsDateTime") {
      const dateInput = document.getElementById("gb-events-date");
      const timeInput = document.getElementById("gb-events-time");
      const durationInput = document.getElementById("gb-events-duration");
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
        const dateValue = String(dateInput?.value || "");
        const timeValue = String(timeInput?.value || "");
        const today = todayYmdLocal();

        state.events.reservationDate = dateValue;
        state.events.startTime = timeValue;
        state.events.durationHours = Number(durationInput?.value || 4);
        state.events.guestsCount = clamp(toInt(guestsNumber?.value || 60, 60), 1, 120);

        if (!dateValue || dateValue < today) {
          setError("Data rezerwacji nie moze byc z przeszlosci.");
          return;
        }
        if (!timeValue || hmToMinutes(timeValue) == null) {
          setError("Podaj poprawna godzine rezerwacji.");
          return;
        }
        if (!Number.isFinite(state.events.durationHours) || state.events.durationHours <= 0) {
          setError("Podaj poprawny czas rezerwacji.");
          return;
        }

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
          setError("Wybierz dostepna sale.");
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
          setError("Uzupelnij dodatkowe informacje do rezerwacji.");
          return;
        }

        const availability = await checkSelectedHallAvailability();
        if (!availability.ok) {
          setError(availability.error || "Sala jest niedostepna.");
          return;
        }

        setError("");
        state.step = "personal";
        render();
      });
      return;
    }

    if (state.step === "personal") {
      document.getElementById("gb-personal-form")?.addEventListener("submit", (event) => {
        event.preventDefault();
        renewSession({ persist: false });
        const form = event.currentTarget;
        if (!(form instanceof HTMLFormElement)) return;
        if (!form.reportValidity()) return;

        const formData = new FormData(form);
        state.personal.firstName = String(formData.get("firstName") || "").trim();
        state.personal.lastName = String(formData.get("lastName") || "").trim();
        state.personal.email = String(formData.get("email") || "").trim();
        state.personal.phonePrefix = normalizePhonePrefix(formData.get("phonePrefix") || "+48");
        state.personal.phoneNational = String(formData.get("phoneNational") || "").trim();
        state.personal.hpCompanyWebsite = String(formData.get("hpCompanyWebsite") || "").trim();
        const phoneDigits = phoneNationalDigits(state.personal.phoneNational);

        if (!state.personal.firstName || !state.personal.lastName || !state.personal.email || !state.personal.phoneNational) {
          setError("Wypelnij wszystkie wymagane pola danych osobowych.");
          return;
        }
        if (phoneDigits.length < 6 || phoneDigits.length > 15) {
          setError("Podaj poprawny numer telefonu (6-15 cyfr, spacje i myslniki sa dozwolone).");
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

    if (!config.turnstileSiteKey) {
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
      setError("Nie udalo sie uruchomic weryfikacji anty-bot. Sprobuj ponownie.");
      updateSummarySubmitState();
      return;
    }

    const slot = document.getElementById("gb-turnstile-slot");
    if (!slot) {
      updateSummarySubmitState();
      return;
    }

    slot.innerHTML = "";
    state.turnstileToken = "";

    try {
      state.turnstileWidgetId = window.turnstile.render(slot, {
        sitekey: config.turnstileSiteKey,
        callback: (token) => {
          state.turnstileToken = String(token || "");
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
          setError("Weryfikacja anty-bot nie powiodla sie. Sprobuj ponownie.");
          persistDraftState();
          updateSummarySubmitState();
        },
      });
    } catch {
      setError("Nie udalo sie uruchomic weryfikacji anty-bot.");
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
    return {
      service,
      payload: {
        ...common,
        hallId: state.events.selectedHallId,
        reservationDate: state.events.reservationDate,
        startTime: state.events.startTime,
        durationHours: state.events.durationHours,
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
      setError("Zaakceptuj regulamin, aby kontynuowac.");
      return;
    }

    if (config.turnstileSiteKey && !antiBotVerified()) {
      setError("Potwierdz weryfikacje anty-bot.");
      return;
    }

    if (!config.turnstileSiteKey && !antiBotVerified()) {
      setError("Potwierdz, ze nie jestes botem.");
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
      }
      setError(error.message || "Nie udalo sie zapisac rezerwacji.");
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
    render();
  }

  function closeModal() {
    syncCurrentStepFromDom();
    clearCountdown();
    clearSessionRefreshTimer();
    state.isOpen = false;
    state.turnstileToken = "";
    state.turnstileWidgetId = null;
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
