(function () {
  const config = window.SREDZKA_CONFIG || {};
  const defaultContent = structuredClone(window.SREDZKA_DEFAULT_CONTENT || {});
  const hostname = window.location.hostname;
  const isLocalPreview =
    window.location.protocol === "file:" || hostname === "127.0.0.1" || hostname === "localhost";
  const isGithubPages = hostname.endsWith("github.io");
  const fallbackApiBase = isLocalPreview
    ? ""
    : hostname && !isGithubPages
      ? "https://api." + hostname.replace(/^www\./, "")
      : "";
  /** Grafik i catering na Workerze: wystarczy `apiBase` w config lub domyślny https://api.domena (bez osobnej flagi). */
  const adminLegacyBookingsEnabled =
    config.enableOnlineBookings === true || Boolean(String(config.apiBase || fallbackApiBase || "").trim());
  const OPENING_HOURS_DAYS = [
    { key: "monday", label: "Poniedziałek", aliases: ["poniedzialek", "poniedziałek"] },
    { key: "tuesday", label: "Wtorek", aliases: ["wtorek"] },
    { key: "wednesday", label: "Środa", aliases: ["sroda", "środa"] },
    { key: "thursday", label: "Czwartek", aliases: ["czwartek"] },
    { key: "friday", label: "Piątek", aliases: ["piatek", "piątek"] },
    { key: "saturday", label: "Sobota", aliases: ["sobota"] },
    { key: "sunday", label: "Niedziela", aliases: ["niedziela"] },
  ];

  function normalizeComparableText(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeOpeningHoursTime(value) {
    const raw = String(value || "").trim().replace(".", ":");
    const match = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
      return "";
    }
    return `${match[1].padStart(2, "0")}:${match[2]}`;
  }

  function resolveOpeningHoursDayIndexes(dayValue) {
    const normalized = normalizeComparableText(dayValue)
      .replace(/[–—]/g, "-")
      .replace(/\s*-\s*/g, "-");

    if (!normalized) {
      return [];
    }

    if (normalized === "codziennie" || normalized === "daily") {
      return OPENING_HOURS_DAYS.map((_, index) => index);
    }

    const aliases = OPENING_HOURS_DAYS.flatMap((day, index) =>
      day.aliases.map((alias) => ({ alias, index }))
    );

    const matchedAlias = aliases.find(({ alias }) => normalized === alias);
    if (matchedAlias) {
      return [matchedAlias.index];
    }

    const rangeMatch = normalized.match(/^(.+?)-(.+)$/);
    if (rangeMatch) {
      const start = aliases.find(({ alias }) => rangeMatch[1].trim() === alias);
      const end = aliases.find(({ alias }) => rangeMatch[2].trim() === alias);
      if (start && end) {
        const from = Math.min(start.index, end.index);
        const to = Math.max(start.index, end.index);
        return OPENING_HOURS_DAYS.slice(from, to + 1).map((_, offset) => from + offset);
      }
    }

    return [];
  }

  function parseOpeningHoursRange(hoursValue) {
    const raw = String(hoursValue || "").trim();
    if (!raw) {
      return { from: "", to: "" };
    }

    const normalized = normalizeComparableText(raw);
    if (["nieczynne", "zamkniete", "zamknięte", "closed"].includes(normalized)) {
      return { from: "", to: "" };
    }

    const match = raw.match(/(\d{1,2}[:.]\d{2})\s*[-–—]\s*(\d{1,2}[:.]\d{2})/);
    if (!match) {
      return { from: "", to: "" };
    }

    return {
      from: normalizeOpeningHoursTime(match[1]),
      to: normalizeOpeningHoursTime(match[2]),
    };
  }

  function normalizeOpeningHours(items) {
    const schedule = OPENING_HOURS_DAYS.map((day) => ({
      day: day.label,
      hours: "Nieczynne",
    }));

    (Array.isArray(items) ? items : []).forEach((item) => {
      const dayValue =
        item && typeof item === "object"
          ? item.day
          : String(item || "")
              .split(":")[0]
              .trim();
      const hoursValue =
        item && typeof item === "object"
          ? item.hours
          : String(item || "")
              .split(":")
              .slice(1)
              .join(":")
              .trim();
      const dayIndexes = resolveOpeningHoursDayIndexes(dayValue);
      const range = parseOpeningHoursRange(hoursValue);
      const normalizedHours =
        range.from && range.to ? `${range.from} - ${range.to}` : "Nieczynne";

      dayIndexes.forEach((dayIndex) => {
        schedule[dayIndex] = {
          day: OPENING_HOURS_DAYS[dayIndex].label,
          hours: normalizedHours,
        };
      });
    });

    return schedule;
  }

  function getOpeningHoursEditorState(items) {
    return normalizeOpeningHours(items).map((entry, index) => {
      const range = parseOpeningHoursRange(entry.hours);
      return {
        index,
        key: OPENING_HOURS_DAYS[index].key,
        day: OPENING_HOURS_DAYS[index].label,
        from: range.from,
        to: range.to,
      };
    });
  }

  function renderOpeningHoursEditorMarkup(items, options = {}) {
    const { idPrefix = "company-opening-hours", intro = "", sectionTitle = "Godziny dowozów" } = options;
    const schedule = getOpeningHoursEditorState(items);

    return `
      <div class="stack">
        <div>
          <strong>${escapeHtml(sectionTitle)}</strong>
          <p class="helper">${escapeHtml(intro || "Każdy dzień ma osobne pola od i do. Puste pola oznaczają dzień bez dowozu.")}</p>
        </div>
        <div class="stack">
          ${schedule
            .map(
              (entry) => `
                <div class="repeater-item opening-hours-day-card">
                  <div class="repeater-head">
                    <strong>${escapeHtml(entry.day)}</strong>
                    <span class="helper">Pozostaw puste, aby oznaczyć dzień bez dowozu.</span>
                  </div>
                  <div class="field-grid">
                    <label class="field">
                      <span>Od</span>
                      <input type="time" id="${escapeAttribute(`${idPrefix}-${entry.key}-from`)}" value="${escapeAttribute(entry.from)}" />
                    </label>
                    <label class="field">
                      <span>Do</span>
                      <input type="time" id="${escapeAttribute(`${idPrefix}-${entry.key}-to`)}" value="${escapeAttribute(entry.to)}" />
                    </label>
                  </div>
                </div>
              `
            )
            .join("")}
        </div>
      </div>
    `;
  }

  function collectOpeningHoursFromEditor(getTrimmedValue, idPrefix = "company-opening-hours") {
    return OPENING_HOURS_DAYS.map((day) => {
      const from = normalizeOpeningHoursTime(getTrimmedValue(`#${idPrefix}-${day.key}-from`) || "");
      const to = normalizeOpeningHoursTime(getTrimmedValue(`#${idPrefix}-${day.key}-to`) || "");
      return {
        day: day.label,
        hours: from && to ? `${from} - ${to}` : "Nieczynne",
      };
    });
  }

  function normalizePauseRanges(value, fallbackFrom = "", fallbackTo = "") {
    const source = Array.isArray(value) ? value : [];
    const ranges = source
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

    if (ranges.length > 0) {
      ranges.sort((a, b) => (a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from)));
      return ranges;
    }

    const from = String(fallbackFrom || "").trim().slice(0, 10);
    const to = String(fallbackTo || "").trim().slice(0, 10);
    if (
      from &&
      to &&
      /^\d{4}-\d{2}-\d{2}$/.test(from) &&
      /^\d{4}-\d{2}-\d{2}$/.test(to)
    ) {
      return from <= to ? [{ from, to }] : [{ from: to, to: from }];
    }
    return [];
  }

  function getTodayIsoDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function filterCurrentAndFuturePauseRanges(ranges) {
    const today = getTodayIsoDate();
    return normalizePauseRanges(ranges).filter((entry) => entry.to >= today);
  }

  function renderPauseRangesListMarkup(domainKey, ranges, { disabled = false } = {}) {
    if (!ranges.length) {
      return `<li class="helper" data-booking-pause-empty="${escapeAttribute(domainKey)}">Brak obecnych i przyszlych zakresow.</li>`;
    }
    return ranges
      .map(
        (entry) => `
          <li class="repeater-item" data-booking-pause-item="${escapeAttribute(domainKey)}">
            <div style="display:flex; justify-content:space-between; gap:0.75rem; align-items:center;">
              <span><strong>${escapeHtml(entry.from)}</strong> - <strong>${escapeHtml(entry.to)}</strong></span>
              <button class="button danger" type="button" data-remove-booking-pause-item ${disabled ? "disabled" : ""}>Usun</button>
            </div>
            <input type="hidden" data-booking-pause-hidden-role="from" value="${escapeAttribute(entry.from)}" />
            <input type="hidden" data-booking-pause-hidden-role="to" value="${escapeAttribute(entry.to)}" />
          </li>
        `
      )
      .join("");
  }

  function renderPauseRangesEditorMarkup(domainKey, ranges, { disabled = false, label = "Przerwy" } = {}) {
    const filtered = filterCurrentAndFuturePauseRanges(ranges);
    return `
      <div class="field-grid" data-booking-pause-controls="${escapeAttribute(domainKey)}">
        <label class="field"><span>${escapeHtml(label + " — od")}</span><input type="date" data-booking-pause-domain="${escapeAttribute(
          domainKey
        )}" data-booking-pause-role="from" ${disabled ? "disabled" : ""} /></label>
        <label class="field"><span>Do</span><input type="date" data-booking-pause-domain="${escapeAttribute(
          domainKey
        )}" data-booking-pause-role="to" ${disabled ? "disabled" : ""} /></label>
        <div class="field" style="display:flex; align-items:flex-end; gap:0.45rem;">
          <button class="button secondary" type="button" data-add-booking-pause-range="${escapeAttribute(
            domainKey
          )}" ${disabled ? "disabled" : ""}>+ Dodaj zakres</button>
        </div>
      </div>
      <ul data-booking-pause-list="${escapeAttribute(domainKey)}" style="list-style:none; padding:0; margin:0.75rem 0 0;">
        ${renderPauseRangesListMarkup(domainKey, filtered, { disabled })}
      </ul>
    `;
  }

  function createPauseRangeListItemElement(domainKey, range, disabled = false) {
    const item = document.createElement("li");
    item.className = "repeater-item";
    item.dataset.bookingPauseItem = domainKey;
    item.innerHTML = `
      <div style="display:flex; justify-content:space-between; gap:0.75rem; align-items:center;">
        <span><strong>${escapeHtml(range.from)}</strong> - <strong>${escapeHtml(range.to)}</strong></span>
        <button class="button danger" type="button" data-remove-booking-pause-item ${disabled ? "disabled" : ""}>Usun</button>
      </div>
      <input type="hidden" data-booking-pause-hidden-role="from" value="${escapeAttribute(range.from)}" />
      <input type="hidden" data-booking-pause-hidden-role="to" value="${escapeAttribute(range.to)}" />
    `;
    return item;
  }

  function normalizeAdminContent(rawContent) {
    const content = structuredClone(rawContent || {});

    if (!content.company) {
      content.company = {};
    }
    if (!content.home) {
      content.home = {};
    }

    content.company.openingHours = normalizeOpeningHours(content.company.openingHours);
    content.home.sectionBlocks = {
      hotel: Boolean(content.home.sectionBlocks?.hotel),
      restaurant: Boolean(content.home.sectionBlocks?.restaurant),
      events: Boolean(content.home.sectionBlocks?.events),
    };
    content.home.sectionMedia = normalizeHomeSectionMedia(content.home.sectionMedia);

    if (!content.restaurant) {
      content.restaurant = {};
    }

    if (!Array.isArray(content.restaurant.menu) && Array.isArray(content.restaurant.menuSections)) {
      content.restaurant.menu = content.restaurant.menuSections.map((section) => ({
        section: section?.title || "",
        items: Array.isArray(section?.items)
          ? section.items
              .map((item) => {
                if (item && typeof item === "object") {
                  const normalizedItem = {
                    name: item.name || "",
                    price: item.price || "",
                    description: item.description || "",
                    ingredients: Array.isArray(item.ingredients) ? item.ingredients : [],
                  };
                  if (item.subcategory) {
                    normalizedItem.subcategory = item.subcategory;
                  }
                  return normalizedItem;
                }
                return {
                  name: String(item || ""),
                  price: "",
                  description: "",
                  ingredients: [],
                };
              })
              .filter((item) => item.name)
          : [],
      }));
    }

    if (!Array.isArray(content.restaurant.menu)) {
      content.restaurant.menu = [];
    }

    if (!content.events) {
      content.events = {};
    }

    if (
      content.restaurant.menu.length === 0 &&
      Array.isArray(content.events.menu) &&
      content.events.menu.length > 0
    ) {
      content.restaurant.menu = structuredClone(content.events.menu);
    }

    content.restaurant.menu.forEach((section) => {
      if (!section || !Array.isArray(section.items)) {
        return;
      }
      section.items.forEach((item) => {
        if (item && typeof item === "object") {
          item.price = String(item.price != null ? item.price : "").trim();
        }
      });
    });

    content.events.menu = structuredClone(content.restaurant.menu);

    content.events.halls = normalizeEventHalls(content.events.halls);
    content.events.hallGalleries = normalizeEventHallGalleries(content.events.hallGalleries);
    if (!content.hotel) {
      content.hotel = {};
    }
    content.hotel.roomGalleries = normalizeHotelRoomGalleries(content.hotel.roomGalleries);
    if (!content.booking || typeof content.booking !== "object") {
      content.booking = {};
    }
    content.booking.restaurantPauseRanges = normalizePauseRanges(
      content.booking.restaurantPauseRanges,
      content.booking.restaurantPauseFrom,
      content.booking.restaurantPauseTo
    );
    content.booking.hotelPauseRanges = normalizePauseRanges(
      content.booking.hotelPauseRanges,
      content.booking.hotelPauseFrom,
      content.booking.hotelPauseTo
    );
    content.booking.eventsPauseRanges = normalizePauseRanges(
      content.booking.eventsPauseRanges,
      content.booking.eventsPauseFrom,
      content.booking.eventsPauseTo
    );
    content.documentsPage = normalizeDocumentsPage(content.documentsPage);

    return content;
  }

  function normalizeDocumentsPage(documentsPage) {
    const source = documentsPage && typeof documentsPage === "object" ? documentsPage : {};
    const mapDocumentsPageDocuments = (rawList) =>
      (Array.isArray(rawList) ? rawList : [])
        .map((doc) => ({
          title: String(doc?.title || "").trim(),
          subtitle: String(doc?.subtitle || "").trim(),
          sections: (Array.isArray(doc?.sections) ? doc.sections : [])
            .map((section) => ({
              title: String(section?.title || "").trim(),
              text: String(section?.text || "").trim(),
            }))
            .filter((section) => section.title || section.text),
        }))
        .filter((doc) => doc.title || doc.subtitle || doc.sections.length);

    let documents = mapDocumentsPageDocuments(source.documents);
    if (!documents.length) {
      documents = mapDocumentsPageDocuments(defaultContent.documentsPage?.documents);
    }
    return { documents };
  }

  function normalizeEventHalls(halls) {
    const hallList = Array.isArray(halls) ? halls : [];
    const byKey = new Map(hallList.map((hall) => [String(hall?.key || "").toLowerCase(), hall || {}]));
    const firstHall = hallList[0] || {};
    const secondHall = hallList[1] || {};
    const largeSource = byKey.get("duza") || byKey.get("duża") || byKey.get("krolewska") || firstHall;
    const smallSource = byKey.get("mala") || byKey.get("mała") || byKey.get("zlota") || secondHall;

    return [
      {
        key: "duza",
        name: String(largeSource?.name || "Sala Duza"),
        capacity: String(largeSource?.capacity || ""),
        description: String(largeSource?.description || ""),
      },
      {
        key: "mala",
        name: String(smallSource?.name || "Sala Mala"),
        capacity: String(smallSource?.capacity || ""),
        description: String(smallSource?.description || ""),
      },
    ];
  }

  function normalizeEventHallGalleries(hallGalleries) {
    const source = hallGalleries && typeof hallGalleries === "object" ? hallGalleries : {};
    return {
      "1": Array.isArray(source["1"]) ? source["1"] : [],
      "2": Array.isArray(source["2"]) ? source["2"] : [],
    };
  }

  function normalizeHotelRoomGalleries(roomGalleries) {
    const source = roomGalleries && typeof roomGalleries === "object" ? roomGalleries : {};
    const normalizeList = (list) =>
      (Array.isArray(list) ? list : [])
        .map((item) => (typeof item === "string" ? { url: item } : item))
        .filter((item) => item && !String(item.url || "").startsWith("data:"));
    return {
      "1-osobowe": normalizeList(source["1-osobowe"]),
      "2-osobowe": normalizeList(source["2-osobowe"]),
      "3-osobowe": normalizeList(source["3-osobowe"]),
      "4-osobowe": normalizeList(source["4-osobowe"]),
    };
  }

  const HOME_SECTION_MEDIA_DEFAULTS = {
    hotel: {
      imageUrl: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1600&q=80",
      imageAlt: "Hotel — Średzka Korona, noclegi Środa Śląska",
      focusX: 50,
      focusY: 50,
      zoom: 1,
    },
    restaurant: {
      imageUrl: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1600&q=80",
      imageAlt: "Catering — Średzka Korona, Środa Śląska",
      focusX: 50,
      focusY: 50,
      zoom: 1,
    },
    events: {
      imageUrl: "https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&w=1600&q=80",
      imageAlt: "Sale na przyjęcia i imprezy okolicznościowe — Średzka Korona",
      focusX: 50,
      focusY: 50,
      zoom: 1,
    },
  };

  function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
  }

  function normalizeHomeSectionMedia(sectionMedia) {
    const source = sectionMedia && typeof sectionMedia === "object" ? sectionMedia : {};
    const out = {};
    ["hotel", "restaurant", "events"].forEach((key) => {
      const fallback = HOME_SECTION_MEDIA_DEFAULTS[key];
      const raw = source[key] || {};
      out[key] = {
        imageUrl: String(raw.imageUrl || fallback.imageUrl || ""),
        imageAlt: String(raw.imageAlt || fallback.imageAlt || ""),
        focusX: clampNumber(raw.focusX, 0, 100, fallback.focusX),
        focusY: clampNumber(raw.focusY, 0, 100, fallback.focusY),
        zoom: clampNumber(raw.zoom, 1, 2.5, fallback.zoom),
      };
    });
    return out;
  }

  const normalizedDefaultContent = normalizeAdminContent(defaultContent);

  const state = {
    apiBase: config.apiBase || fallbackApiBase,
    loggedIn: false,
    content: normalizedDefaultContent,
    lastSavedContent: structuredClone(normalizedDefaultContent),
    documents: [],
    galleryAlbums: [],
    calendarBlocks: [],
    submissions: [],
    notifications: [],
    capabilities: {
      mediaStorageEnabled: false,
    },
    ui: {
      view: "home",
      topTab: "grafik",
      documentsPageEditIndex: null,
      tileByTab: {
        grafik: "overview",
        hotel: "gallery",
        restauracja: "menu",
        przyjecia: "oferta",
        dokumenty: "documents",
        kontakt: "contact",
        powiadomienia: "notifications",
      },
    },
    schedule: {
      monthCursor: getTodayIsoDate().slice(0, 7),
      selectedDate: getTodayIsoDate(),
      allItems: [],
      items: [],
      pendingItems: [],
      tomorrowItems: [],
      upcomingItems: [],
      unconfirmedItems: [],
      roomOptions: [],
      tableOptions: [],
      hallOptions: [],
      cateringRecipients: [],
      countdownTimer: null,
      isLoading: false,
      lastError: "",
      watchTimer: null,
      knownPendingKeys: null,
      watchBaselineReady: false,
      lastLoadedAt: 0,
      registryShowPast: false,
      registryShowCancelledExpired: false,
      registrySearchQuery: "",
    },
  };
  (function warnApiBaseIfMisconfigured() {
    const b = String(state.apiBase || "").trim().toLowerCase();
    if (b.includes("cloudfunctions.net")) {
      console.warn(
        "[Sredzka admin] apiBase wskazuje na Firebase (cloudfunctions.net). Ustaw w config.js adres Workera Cloudflare, np. https://api.sredzka-korona.pl — bez /restaurantApi ani /hotelApi."
      );
    }
  })();
  const SCHEDULE_PENDING_WATCH_MS = 20000;
  const ADMIN_TABS = [
    {
      key: "grafik",
      label: "Grafik",
      description: "Centralny terminarz rezerwacji, akceptacje i szybkie operacje dzienne.",
      tiles: [
        { key: "overview", label: "Grafik", description: "Oczekujące, jutrzejsze i kalendarz wszystkich rezerwacji." },
        { key: "registry", label: "Spis rezerwacji", description: "" },
      ],
    },
    {
      key: "hotel",
      label: "Hotel",
      description: "Zarządzanie pokojami, galerią i ustawieniami modułów hotelu.",
      tiles: [
        { key: "rooms", label: "Pokoje", description: "Konfiguracja pokoi, cen i parametrów rezerwacyjnych." },
        { key: "gallery", label: "Galeria", description: "Wspólna galeria pokoi z podziałem na albumy 1/2/3/4-osobowe." },
        { key: "home", label: "Strona główna", description: "Zdjęcie kafelka Hotel na stronie głównej (pozycja i zoom)." },
        { key: "settings", label: "Ustawienia rezerwacji", description: "Włączenie i przerwy w przyjmowaniu rezerwacji." },
      ],
    },
    {
      key: "restauracja",
      label: "Catering",
      description: "Menu, media, odbiorcy dostaw cateringu oraz ustawienia modułu.",
      tiles: [
        { key: "menu", label: "Menu", description: "Kategorie, pozycje, składniki i kolejność." },
        { key: "gallery", label: "Galeria", description: "Zdjęcia cateringu i ich kolejność." },
        { key: "orders", label: "Zamówienia", description: "Edycja treści modala zamówień widocznej na stronie cateringu." },
        { key: "hours", label: "Godziny dowozów", description: "Dni i przedziały dowozu widoczne w kafelku na stronie cateringu." },
        { key: "recipients", label: "Odbiorcy", description: "Lista odbiorców dostaw: dane kontaktowe i adresowe." },
        { key: "home", label: "Strona główna", description: "Zdjęcie kafelka Catering na stronie głównej (pozycja i zoom)." },
        { key: "settings", label: "Ustawienia rezerwacji", description: "Włączenie i przerwy w przyjmowaniu rezerwacji." },
      ],
    },
    {
      key: "przyjecia",
      label: "Przyjęcia",
      description: "Oferta, galeria, menu oraz konfiguracja rezerwacji i komunikacji.",
      tiles: [
        { key: "oferta", label: "Oferta", description: "Edycja treści kafelka Oferta i modala." },
        { key: "gallery", label: "Galeria", description: "Galerie sal i albumy wydarzeń." },
        { key: "menu", label: "Menu okolicznościowe", description: "Sekcje, pozycje i kolejność menu." },
        { key: "home", label: "Strona główna", description: "Zdjęcie kafelka Przyjęcia na stronie głównej (pozycja i zoom)." },
        { key: "settings", label: "Ustawienia rezerwacji", description: "Włączenie rezerwacji i blokady terminów sal." },
      ],
    },
    {
      key: "powiadomienia",
      label: "Powiadomienia",
      description: "Komunikaty na stronie glownej — widoczne dla gosci w ustalonym czasie.",
      tiles: [
        {
          key: "notifications",
          label: "Powiadomienia",
          description: "Lista, tworzenie, edycja i usuwanie komunikatow przyklejonych do dolu strony glownej.",
        },
        {
          key: "maile",
          label: "Maile",
          description: "Szablony wiadomosci e-mail wysylanych do gosci i obslugi dla hotelu, cateringu i przyjec.",
        },
      ],
    },
    {
      key: "dokumenty",
      label: "Dokumenty",
      description: "Dokumenty podstrony i pliki do pobrania.",
      tiles: [
        { key: "documents", label: "Dokumenty", description: "Edycja tresci dokumentow i zarzadzanie plikami." },
      ],
    },
    {
      key: "kontakt",
      label: "Kontakt",
      description: "Dane kontaktowe widoczne na stronie.",
      tiles: [
        { key: "contact", label: "Dane kontaktowe", description: "Telefon, e-mail, adres i podstawowe dane firmy." },
      ],
    },
  ];
  const HOME_TAB_ORDER = ["hotel", "restauracja", "przyjecia", "powiadomienia", "dokumenty", "kontakt"];
  /** Klucze w content.home.sectionBlocks (true = moduł zablokowany na stronie głównej). */
  const ADMIN_ENTRY_SECTION_BLOCK_KEY = {
    hotel: "hotel",
    restauracja: "restaurant",
    przyjecia: "events",
  };
  const INLINE_IMAGE_MAX_BYTES = 320 * 1024;
  const API_IMAGE_MAX_BYTES = 1_700_000;
  const DOCUMENT_MAX_BYTES = 1_700_000;
  const IMAGE_MAX_DIMENSION = 1600;
  const missingApiConfiguration = !state.apiBase && isGithubPages;

  const app = document.querySelector("#admin-app");
  let scrollIndicator = null;
  let scrollIndicatorThumb = null;
  let scrollIndicatorFrame = 0;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replaceAll("`", "&#96;");
  }

  function sanitizeOfertaEditorHtml(rawHtml) {
    const template = document.createElement("template");
    template.innerHTML = String(rawHtml || "");
    const allowedTags = new Set(["p", "ul", "ol", "li", "strong", "em", "u", "a", "br", "span", "div", "h1", "h2", "h3"]);
    const allowedStyleProps = new Set([
      "text-align",
      "font-size",
      "color",
      "font-weight",
      "font-style",
      "text-decoration",
      "font-family",
    ]);
    const urlPattern = /^(https?:|mailto:|tel:|\/|#)/i;

    const sanitizeStyle = (styleValue) => {
      const normalized = String(styleValue || "")
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const separatorIndex = part.indexOf(":");
          if (separatorIndex === -1) return "";
          const property = part.slice(0, separatorIndex).trim().toLowerCase();
          const value = part.slice(separatorIndex + 1).trim();
          if (!allowedStyleProps.has(property) || !value) return "";
          return `${property}: ${value}`;
        })
        .filter(Boolean);
      return normalized.join("; ");
    };

    const sanitizeNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return;
      if (node.nodeType !== Node.ELEMENT_NODE) {
        node.remove();
        return;
      }
      const tagName = node.tagName.toLowerCase();
      if (tagName === "script" || tagName === "style" || tagName === "iframe" || tagName === "object") {
        node.remove();
        return;
      }
      if (tagName === "b") {
        const strong = document.createElement("strong");
        strong.innerHTML = node.innerHTML;
        node.replaceWith(strong);
        node = strong;
      } else if (tagName === "i") {
        const em = document.createElement("em");
        em.innerHTML = node.innerHTML;
        node.replaceWith(em);
        node = em;
      } else if (tagName === "font") {
        const span = document.createElement("span");
        const styles = [];
        const fontColor = node.getAttribute("color");
        const fontFace = node.getAttribute("face");
        if (fontColor) {
          styles.push(`color: ${fontColor}`);
        }
        if (fontFace) {
          styles.push(`font-family: ${fontFace}`);
        }
        if (styles.length) {
          span.setAttribute("style", styles.join("; "));
        }
        span.innerHTML = node.innerHTML;
        node.replaceWith(span);
        node = span;
      } else if (!allowedTags.has(tagName)) {
        const fragment = document.createDocumentFragment();
        while (node.firstChild) {
          fragment.appendChild(node.firstChild);
        }
        node.replaceWith(fragment);
        return;
      }

      Array.from(node.attributes).forEach((attribute) => {
        const attrName = attribute.name.toLowerCase();
        const attrValue = attribute.value;
        if (attrName === "style") {
          const safeStyle = sanitizeStyle(attrValue);
          if (safeStyle) {
            node.setAttribute("style", safeStyle);
          } else {
            node.removeAttribute("style");
          }
          return;
        }
        if (tagName === "a" && attrName === "href") {
          const safeHref = String(attrValue || "").trim();
          if (!safeHref || !urlPattern.test(safeHref)) {
            node.removeAttribute("href");
          } else {
            node.setAttribute("href", safeHref);
          }
          return;
        }
        if (tagName === "a" && (attrName === "target" || attrName === "rel")) {
          if (attrName === "target" && attrValue !== "_blank") {
            node.removeAttribute("target");
          }
          return;
        }
        node.removeAttribute(attribute.name);
      });

      if (tagName === "a" && node.getAttribute("target") === "_blank") {
        node.setAttribute("rel", "noopener noreferrer");
      }

      Array.from(node.childNodes).forEach(sanitizeNode);
    };

    Array.from(template.content.childNodes).forEach(sanitizeNode);
    return template.innerHTML;
  }

  function applyRichTextFontSize(editor, sizeValue) {
    if (!editor || !sizeValue) return;
    editor.focus();
    document.execCommand("fontSize", false, "7");
    editor.querySelectorAll('font[size="7"]').forEach((fontTag) => {
      const span = document.createElement("span");
      span.style.fontSize = sizeValue;
      span.innerHTML = fontTag.innerHTML;
      fontTag.replaceWith(span);
    });
  }

  function initRichTextEditor({ textareaSelector, editorSelector, toolbarSelector }) {
    const textarea = document.querySelector(textareaSelector);
    const editor = document.querySelector(editorSelector);
    const toolbar = document.querySelector(toolbarSelector);
    if (!textarea || !editor || !toolbar) return;

    const syncToTextarea = () => {
      const sanitized = sanitizeOfertaEditorHtml(editor.innerHTML);
      textarea.value = sanitized;
      if (editor.innerHTML !== sanitized) {
        editor.innerHTML = sanitized;
      }
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    };

    editor.innerHTML = sanitizeOfertaEditorHtml(textarea.value || "");
    if (!editor.innerHTML.trim()) {
      editor.innerHTML = "<p></p>";
    }

    toolbar.querySelectorAll("[data-richtext-command]").forEach((button) => {
      button.addEventListener("click", () => {
        const command = button.dataset.richtextCommand;
        editor.focus();
        if (command === "createLink") {
          const link = window.prompt("Podaj adres linku (https://...):");
          if (link) {
            document.execCommand("createLink", false, link.trim());
          }
        } else {
          document.execCommand(command, false, null);
        }
        syncToTextarea();
      });
    });

    toolbar.querySelectorAll("[data-richtext-block]").forEach((button) => {
      button.addEventListener("click", () => {
        const blockTag = button.dataset.richtextBlock;
        if (!blockTag) return;
        editor.focus();
        document.execCommand("formatBlock", false, blockTag);
        syncToTextarea();
      });
    });

    const fontSizeSelect = toolbar.querySelector("[data-richtext-font-size]");
    if (fontSizeSelect) {
      fontSizeSelect.addEventListener("change", () => {
        const value = fontSizeSelect.value;
        if (!value) return;
        applyRichTextFontSize(editor, value);
        syncToTextarea();
      });
    }

    const colorInput = toolbar.querySelector("[data-richtext-color]");
    if (colorInput) {
      colorInput.addEventListener("input", () => {
        if (!colorInput.value) return;
        editor.focus();
        document.execCommand("foreColor", false, colorInput.value);
        syncToTextarea();
      });
    }

    const fontFamilySelect = toolbar.querySelector("[data-richtext-font-family]");
    if (fontFamilySelect) {
      fontFamilySelect.addEventListener("change", () => {
        const value = fontFamilySelect.value;
        if (!value) return;
        editor.focus();
        document.execCommand("fontName", false, value);
        syncToTextarea();
      });
    }

    editor.addEventListener("input", syncToTextarea);
    editor.addEventListener("blur", syncToTextarea);
    editor.addEventListener("paste", (event) => {
      event.preventDefault();
      const clipboardHtml = event.clipboardData?.getData("text/html");
      const clipboardText = event.clipboardData?.getData("text/plain") || "";
      const safeHtml = sanitizeOfertaEditorHtml(clipboardHtml || clipboardText.replace(/\n/g, "<br>"));
      document.execCommand("insertHTML", false, safeHtml);
      syncToTextarea();
    });
  }

  function initOfertaRichTextEditor() {
    initRichTextEditor({
      textareaSelector: "#events-oferta-modal-html",
      editorSelector: "#events-oferta-modal-editor",
      toolbarSelector: "#events-oferta-editor-toolbar",
    });
  }

  function initRestaurantOrdersRichTextEditor() {
    initRichTextEditor({
      textareaSelector: "#restaurant-orders-info-html",
      editorSelector: "#restaurant-orders-editor",
      toolbarSelector: "#restaurant-orders-editor-toolbar",
    });
  }

  function replaceFileExtension(name, ext) {
    return String(name || "plik")
      .replace(/\.[^/.]+$/, "")
      .concat(ext);
  }

  function readImageElement(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Nie udalo sie odczytac obrazu."));
      };
      img.src = url;
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Nie udalo sie skompresowac obrazu."));
          return;
        }
        resolve(blob);
      }, type, quality);
    });
  }

  async function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Nie udalo sie odczytac obrazu po kompresji."));
      reader.readAsDataURL(blob);
    });
  }

  async function compressImageFile(file, { maxBytes, maxDimension = IMAGE_MAX_DIMENSION } = {}) {
    if (!(file instanceof File) || !String(file.type || "").startsWith("image/")) {
      throw new Error("Wybrany plik nie jest obrazem.");
    }

    const image = await readImageElement(file);
    let scale = Math.min(1, maxDimension / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const qualities = [0.86, 0.78, 0.7, 0.62, 0.55, 0.48, 0.4];
    const outputCandidates = [
      { type: "image/webp", ext: ".webp" },
      { type: "image/jpeg", ext: ".jpg" },
    ];
    let bestBlob = null;
    let bestType = "";
    let bestExt = ".webp";

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
      const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { alpha: true });
      if (!ctx) {
        throw new Error("Przegladarka nie pozwala przygotowac kompresji obrazu.");
      }
      ctx.drawImage(image, 0, 0, width, height);

      for (const output of outputCandidates) {
        for (const quality of qualities) {
          const blob = await canvasToBlob(canvas, output.type, quality);
          if (!bestBlob || blob.size < bestBlob.size) {
            bestBlob = blob;
            bestType = blob.type || output.type;
            bestExt = output.ext;
          }
          if (blob.size <= maxBytes) {
            return new File([blob], replaceFileExtension(file.name, output.ext), { type: blob.type || output.type });
          }
        }
      }

      scale *= 0.75;
    }

    if (bestBlob && bestBlob.size <= maxBytes) {
      return new File([bestBlob], replaceFileExtension(file.name, bestExt), { type: bestType || bestBlob.type });
    }

    throw new Error(`Nie udalo sie zmniejszyc obrazu "${file.name}" do bezpiecznego rozmiaru.`);
  }

  async function filesToInlineGalleryImages(files, maxBytes, fallbackAlt) {
    const compressed = await Promise.all(
      Array.from(files).map((file) => compressImageFile(file, { maxBytes }))
    );
    return Promise.all(
      compressed.map(async (file) => ({
        url: await blobToDataUrl(file),
        alt: file.name.replace(/\.[^/.]+$/, "") || fallbackAlt,
      }))
    );
  }

  function ensureScrollIndicator() {
    if (scrollIndicator && scrollIndicatorThumb) {
      return;
    }

    scrollIndicator = document.createElement("div");
    scrollIndicator.className = "scroll-indicator";
    scrollIndicator.setAttribute("aria-hidden", "true");
    scrollIndicator.innerHTML = `<div class="scroll-indicator-thumb"></div>`;
    document.body.appendChild(scrollIndicator);
    scrollIndicatorThumb = scrollIndicator.querySelector(".scroll-indicator-thumb");
  }

  function updateScrollIndicator() {
    const viewportHeight = window.innerHeight;
    const scrollHeight = document.documentElement.scrollHeight;
    const maxScroll = Math.max(scrollHeight - viewportHeight, 0);

    if (!scrollIndicator || !scrollIndicatorThumb) {
      return;
    }

    if (maxScroll <= 0) {
      scrollIndicator.style.opacity = "0";
      scrollIndicatorThumb.style.transform = "translateY(0)";
      return;
    }

    scrollIndicator.style.opacity = "1";

    const trackHeight = scrollIndicator.clientHeight;
    const thumbHeight = Math.max((viewportHeight / scrollHeight) * trackHeight, 44);
    const maxThumbOffset = Math.max(trackHeight - thumbHeight, 0);
    const scrollRatio = Math.min(Math.max(window.scrollY / maxScroll, 0), 1);
    const thumbOffset = maxThumbOffset * scrollRatio;

    scrollIndicatorThumb.style.height = `${thumbHeight}px`;
    scrollIndicatorThumb.style.transform = `translateY(${thumbOffset}px)`;
  }

  function scheduleScrollIndicatorUpdate() {
    if (scrollIndicatorFrame) {
      return;
    }
    scrollIndicatorFrame = window.requestAnimationFrame(() => {
      scrollIndicatorFrame = 0;
      updateScrollIndicator();
    });
  }

  function initCustomScrollbar() {
    ensureScrollIndicator();

    const resizeObserver = new ResizeObserver(() => {
      scheduleScrollIndicatorUpdate();
    });
    resizeObserver.observe(document.body);
    resizeObserver.observe(document.documentElement);

    const mutationObserver = new MutationObserver(() => {
      scheduleScrollIndicatorUpdate();
    });
    mutationObserver.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
    });

    window.addEventListener("scroll", scheduleScrollIndicatorUpdate, { passive: true });
    window.addEventListener("resize", scheduleScrollIndicatorUpdate);
    window.addEventListener("load", scheduleScrollIndicatorUpdate);
    scheduleScrollIndicatorUpdate();
  }

  function getConnectionErrorMessage() {
    if (window.location.protocol === "file:") {
      return "Panel admina nie dziala z file://. Uruchom lokalny podglad przez npm run preview.";
    }

    if (missingApiConfiguration) {
      return "Brak konfiguracji API. Ustaw apiBase w assets/js/config.js na adres Workera Cloudflare.";
    }

    if (isLocalPreview && !config.apiBase) {
      return "Nie mozna polaczyc z lokalnym API. Uruchom worker na http://127.0.0.1:8787 albo ustaw apiBase w assets/js/config.js.";
    }

    return "Nie mozna polaczyc z API panelu administratora.";
  }

  async function getFirebaseAuthHeaders() {
    if (typeof firebase === "undefined" || !firebase.apps?.length) {
      return {};
    }
    const user = firebase.auth().currentUser;
    if (!user) {
      return {};
    }
    const token = await user.getIdToken();
    return { Authorization: `Bearer ${token}` };
  }

  function rejectMisconfiguredApiBase() {
    const base = String(state.apiBase || "").trim().toLowerCase();
    if (!base) {
      return;
    }
    if (base.includes("cloudfunctions.net")) {
      throw new Error(
        "apiBase wskazuje na Firebase (cloudfunctions.net). Panel dokleja sciezke /api/admin/legacy-bookings/... — Google zwroci HTML 404 (funkcja restaurantApi nie istnieje pod tym adresem). " +
        "Ustaw w assets/js/config.js apiBase na sam adres Workera: https://api.sredzka-korona.pl (bez cloudfunctions.net i bez /restaurantApi). Wdróz strone i odswiez panel (twarde odswiezenie / wyczysc cache)."
      );
    }
  }

  /** HTML 404 z Google przy wywołaniu *.cloudfunctions.net — zła ścieżka albo funkcja niewdrożona. */
  function explainLikelyGoogleFunctions404(status, rawBody) {
    if (status !== 404) {
      return "";
    }
    const t = String(rawBody || "").toLowerCase();
    if (!t.includes("page not found") && !t.includes("requested url was not found")) {
      return "";
    }
    return (
      " To jest odpowiedź Google (Firebase Cloud Functions), nie Workera. " +
      "W assets/js/config.js ustaw apiBase na adres Workera Cloudflare, np. https://api.sredzka-korona.pl — bez cloudfunctions.net i bez /restaurantApi. " +
      "Jeśli rezerwacje są na D1, w Cloudflare (Worker) usuń lub ustaw LEGACY_FIREBASE_BOOKINGS_PROXY na false."
    );
  }

  async function api(path, options = {}) {
    let response;
    const authHeaders = await getFirebaseAuthHeaders();
    rejectMisconfiguredApiBase();

    try {
      response = await fetch(state.apiBase + path, {
        ...options,
        credentials: "include",
        cache: "no-store",
        headers: {
          ...authHeaders,
          ...(options.headers || {}),
        },
      });
    } catch (error) {
      throw new Error(getConnectionErrorMessage());
    }

    if (!response.ok) {
      const raw = await response.text();
      let data = {};
      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch {
          const snippet = raw.replace(/\s+/g, " ").trim().slice(0, 240);
          const head = snippet
            ? `Odpowiedz serwera (HTTP ${response.status}): ${snippet}`
            : `Blad HTTP ${response.status}.`;
          data = {
            error:
              head +
              explainLikelyGoogleFunctions404(response.status, raw) +
              (String(state.apiBase || "").includes("api.sredzka-korona.pl") && response.status === 404
                ? " (Jesli apiBase jest poprawny, w Cloudflare Worker wylacz zmienna LEGACY_FIREBASE_BOOKINGS_PROXY — proxy moze zwracac ten sam HTML z Firebase.)"
                : ""),
          };
        }
      } else {
        data = { error: `Blad HTTP ${response.status} (pusta odpowiedz).` };
      }
      throw new Error(data.error || "Operacja nie powiodla sie.");
    }

    if (response.status === 204) {
      return null;
    }

    return response.json().catch(() => null);
  }

  const SCHEDULE_ACTIVE_STATUSES = new Set(["email_verification_pending", "pending", "confirmed", "manual_block"]);
  const SCHEDULE_POLISH_HOLIDAY_CACHE = new Map();
  const SCHEDULE_SERVICE_LABELS = {
    hotel: "Hotel",
    restaurant: "Catering",
    hall: "Przyjęcia",
  };
  const SCHEDULE_STATUS_LABELS = {
    email_verification_pending: "Do potwierdzenia e-mail",
    pending: "Oczekujące",
    confirmed: "Potwierdzona",
    manual_block: "Blokada",
    cancelled: "Anulowana",
    rejected: "Odrzucona",
    expired: "Wygasłe",
  };

  function scheduleServiceLabel(serviceKey) {
    return SCHEDULE_SERVICE_LABELS[serviceKey] || serviceKey;
  }

  function scheduleServicePillClass(serviceKey) {
    if (serviceKey === "hotel") return "schedule-pill-hotel";
    if (serviceKey === "restaurant") return "schedule-pill-restaurant";
    return "schedule-pill-hall";
  }

  function scheduleStatusLabel(statusValue, fallbackLabel = "") {
    const normalized = String(statusValue || "")
      .trim()
      .toLowerCase();
    if (normalized && SCHEDULE_STATUS_LABELS[normalized]) {
      return SCHEDULE_STATUS_LABELS[normalized];
    }
    if (fallbackLabel) {
      return String(fallbackLabel);
    }
    return normalized || "Nieznany";
  }

  function scheduleStatusPillClass(statusValue) {
    const normalized = String(statusValue || "")
      .trim()
      .toLowerCase();
    if (normalized === "email_verification_pending") return "schedule-status-pending";
    if (normalized === "pending") return "schedule-status-pending";
    if (normalized === "confirmed") return "schedule-status-confirmed";
    if (normalized === "manual_block") return "schedule-status-block";
    if (normalized === "expired") return "schedule-status-expired";
    return "";
  }

  function scheduleIconMarkup(name) {
    const icons = {
      calendar:
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3.5" y="5" width="17" height="15.5" rx="3"></rect><path d="M7.5 3.5v4"></path><path d="M16.5 3.5v4"></path><path d="M3.5 9.5h17"></path></svg>',
      refresh:
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 11a8 8 0 1 0 2 5.2"></path><path d="M20 4v7h-7"></path></svg>',
      close:
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12"></path><path d="M18 6L6 18"></path></svg>',
      trash:
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4.5 7.5h15"></path><path d="M9.5 3.5h5"></path><path d="M8 7.5v11"></path><path d="M16 7.5v11"></path><path d="M6.5 7.5l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12"></path></svg>',
    };
    return `<span class="icon-inline icon-${escapeAttribute(name)}">${icons[name] || ""}</span>`;
  }

  function scheduleEntriesCountLabel(count) {
    const total = Math.max(0, Number(count) || 0);
    if (total === 1) return "1 wpis";
    const mod10 = total % 10;
    const mod100 = total % 100;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
      return `${total} wpisy`;
    }
    return `${total} wpisów`;
  }

  function adminViewsCountLabel(count) {
    const total = Math.max(0, Number(count) || 0);
    if (total === 1) return "1 widok";
    const mod10 = total % 10;
    const mod100 = total % 100;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
      return `${total} widoki`;
    }
    return `${total} widoków`;
  }

  function adminHomeIconMarkup(tabKey) {
    if (tabKey === "grafik") {
      return scheduleIconMarkup("calendar");
    }

    const icons = {
      hotel:
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 18.5V7.5"></path><path d="M4 11.5h16"></path><path d="M20 18.5V9.5a2 2 0 0 0-2-2H6"></path><path d="M7.5 14.5h3"></path><path d="M13.5 14.5h3"></path><path d="M4 18.5h16"></path></svg>',
      restauracja:
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 3.5v7"></path><path d="M10 3.5v7"></path><path d="M7 7h3"></path><path d="M8.5 10.5v10"></path><path d="M16.5 3.5c1.8 1.9 2.4 4.4 1.6 6.6-.5 1.4-1.4 2.5-2.6 3.3v7.1"></path></svg>',
      przyjecia:
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 20.5v-6"></path><path d="M17 20.5v-6"></path><path d="M4 12.5h16"></path><path d="M6 12.5V9.8a2.8 2.8 0 0 1 2.8-2.8h6.4A2.8 2.8 0 0 1 18 9.8v2.7"></path><path d="M12 7V3.5"></path><path d="M9.5 5.5 12 3l2.5 2.5"></path></svg>',
      dokumenty:
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 3.5h7l4 4v13H7z"></path><path d="M14 3.5v4h4"></path><path d="M9.5 12h5"></path><path d="M9.5 15.5h5"></path></svg>',
      kontakt:
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5.5 7.5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2z"></path><path d="M7 8.5 12 12l5-3.5"></path></svg>',
      powiadomienia:
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22z" fill="currentColor"/><path d="M18 16v-5a6 6 0 1 0-12 0v5l-2 2v1h16v-1l-2-2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    };
    return `<span class="icon-inline icon-${escapeAttribute(tabKey)}">${icons[tabKey] || ""}</span>`;
  }

  function renderAdminEntryCard(tab, options = {}) {
    const { featured = false, highlights = [] } = options;
    const tagItems = (Array.isArray(highlights) ? highlights : [])
      .filter(Boolean)
      .slice(0, 3);
    const metaLabel = featured ? "Najważniejszy moduł" : adminViewsCountLabel(tab.tiles.length);
    const featuredModifier = featured ? " admin-entry-tile--featured" : "";
    const blockKey = ADMIN_ENTRY_SECTION_BLOCK_KEY[tab.key] || "";
    const sb = state.content?.home?.sectionBlocks || {};
    const blocked = blockKey ? Boolean(sb[blockKey]) : false;
    const toggleMarkup = blockKey
      ? `
      <button
        type="button"
        class="button admin-entry-visibility-toggle ${blocked ? "admin-entry-visibility-toggle--off" : "admin-entry-visibility-toggle--on"}"
        data-admin-section-visibility="${escapeAttribute(blockKey)}"
        aria-pressed="${blocked ? "false" : "true"}"
        aria-label="${blocked ? "Moduł ukryty na stronie głównej — kliknij, aby włączyć podstronę" : "Moduł widoczny — kliknij, aby wyłączyć podstronę na stronie głównej"}"
        title="${blocked ? "Włącz widoczność modułu" : "Wyłącz widoczność modułu"}"
      >
        ${blocked ? "Włącz" : "Wyłącz"}
      </button>`
      : "";
    return `
      <div class="admin-entry-tile-wrap${featured ? " admin-entry-tile-wrap--featured" : ""}">
        <button
          type="button"
          class="admin-tile admin-entry-tile admin-entry-tile--${escapeAttribute(tab.key)}${featuredModifier}"
          data-admin-entry="${escapeAttribute(tab.key)}"
        >
          <span class="admin-entry-head">
            <span class="admin-entry-icon" aria-hidden="true">${adminHomeIconMarkup(tab.key)}</span>
            <span class="admin-entry-heading">
              <span class="admin-entry-meta">${escapeHtml(metaLabel)}</span>
              <span class="admin-tile-title">${escapeHtml(tab.label)}</span>
            </span>
          </span>
          <span class="admin-tile-copy">${escapeHtml(tab.description)}</span>
          ${
            tagItems.length
              ? `<span class="admin-entry-tags">${tagItems
                  .map((item) => `<span>${escapeHtml(item)}</span>`)
                  .join("")}</span>`
              : ""
          }
        </button>
        ${toggleMarkup}
      </div>
    `;
  }

  function scheduleOverlapWarningMessage(overlapItems) {
    const entries = Array.isArray(overlapItems) ? overlapItems : [];
    if (!entries.length) return "";
    const preview = entries
      .slice(0, 3)
      .map((item) => {
        const title = item.title || item.humanNumberLabel || item.id;
        const from = scheduleFormatDateTime(item.startMs);
        const to = scheduleFormatDateTime(item.endMs);
        return `• ${title} (${from} - ${to})`;
      })
      .join("\n");
    const more = entries.length > 3 ? `\n• ... i ${entries.length - 3} kolejne` : "";
    return `W wybranym terminie istnieją już ${scheduleEntriesCountLabel(entries.length)}.\nBlokada nie anuluje tych rezerwacji, tylko ograniczy kolejne.\n\n${preview}${more}\n\nCzy mimo to utworzyć blokadę?`;
  }

  function scheduleCalculateEasterSunday(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
  }

  function scheduleGetPolishHolidayMap(year) {
    if (SCHEDULE_POLISH_HOLIDAY_CACHE.has(year)) {
      return SCHEDULE_POLISH_HOLIDAY_CACHE.get(year);
    }
    const map = new Map();
    const addHoliday = (date, label) => {
      map.set(scheduleDateToYmd(date), label);
    };
    const easterSunday = scheduleCalculateEasterSunday(year);
    const easterMonday = new Date(easterSunday);
    easterMonday.setDate(easterMonday.getDate() + 1);
    const pentecost = new Date(easterSunday);
    pentecost.setDate(pentecost.getDate() + 49);
    const corpusChristi = new Date(easterSunday);
    corpusChristi.setDate(corpusChristi.getDate() + 60);
    [
      [new Date(year, 0, 1), "Nowy Rok"],
      [new Date(year, 0, 6), "Trzech Króli"],
      [new Date(year, 4, 1), "Święto Pracy"],
      [new Date(year, 4, 3), "Święto Konstytucji 3 Maja"],
      [new Date(year, 7, 15), "Wniebowzięcie NMP"],
      [new Date(year, 10, 1), "Wszystkich Świętych"],
      [new Date(year, 10, 11), "Narodowe Święto Niepodległości"],
      [new Date(year, 11, 25), "Boże Narodzenie"],
      [new Date(year, 11, 26), "Drugi dzień Bożego Narodzenia"],
    ].forEach(([date, label]) => addHoliday(date, label));
    addHoliday(easterSunday, "Wielkanoc");
    addHoliday(easterMonday, "Poniedziałek Wielkanocny");
    addHoliday(pentecost, "Zesłanie Ducha Świętego");
    addHoliday(corpusChristi, "Boże Ciało");
    SCHEDULE_POLISH_HOLIDAY_CACHE.set(year, map);
    return map;
  }

  function scheduleHolidayLabel(ymd) {
    const year = Number(String(ymd || "").slice(0, 4));
    if (!year) return "";
    return scheduleGetPolishHolidayMap(year).get(String(ymd || "").slice(0, 10)) || "";
  }

  function scheduleYmdToDate(ymd) {
    return new Date(`${String(ymd || "").slice(0, 10)}T00:00:00`);
  }

  function scheduleDateToYmd(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function scheduleAddDays(ymd, days) {
    const base = scheduleYmdToDate(ymd);
    base.setDate(base.getDate() + Number(days || 0));
    return scheduleDateToYmd(base);
  }

  function scheduleFormatDateLabel(ymd) {
    if (!ymd) return "—";
    return scheduleYmdToDate(ymd).toLocaleDateString("pl-PL", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  function scheduleFormatDateTime(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return "—";
    return new Date(ms).toLocaleString("pl-PL", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function scheduleFormatTime(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return "—";
    return new Date(ms).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  }

  function scheduleCountdownText(deadlineMs) {
    const target = Number(deadlineMs || 0);
    if (!Number.isFinite(target) || target <= 0) return "—";
    const left = Math.max(0, target - Date.now());
    const totalHours = Math.floor(left / 3600000);
    const minutes = Math.floor((left % 3600000) / 60000);
    const seconds = Math.floor((left % 60000) / 1000);
    return `${totalHours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }

  function scheduleItemDeadlineMs(item) {
    if (!item) return 0;
    if (item.status === "pending") return Number(item.pendingExpiresAt || item.raw?.pendingExpiresAt || 0);
    if (item.status === "email_verification_pending") {
      return Number(item.emailVerificationExpiresAt || item.raw?.emailVerificationExpiresAt || 0);
    }
    return 0;
  }

  function scheduleCountdownInlineMarkup(item) {
    const deadlineMs = scheduleItemDeadlineMs(item);
    if (!deadlineMs) return "";
    return `<p class="helper">Pozostały czas: <strong data-schedule-countdown-deadline="${escapeAttribute(String(deadlineMs))}">${escapeHtml(
      scheduleCountdownText(deadlineMs)
    )}</strong></p>`;
  }

  function refreshScheduleCountdownNodes() {
    document.querySelectorAll("[data-schedule-countdown-deadline]").forEach((node) => {
      const deadlineMs = Number(node.getAttribute("data-schedule-countdown-deadline") || 0);
      node.textContent = scheduleCountdownText(deadlineMs);
    });
  }

  function syncScheduleCountdownTicker() {
    if (state.schedule.countdownTimer) {
      window.clearInterval(state.schedule.countdownTimer);
      state.schedule.countdownTimer = null;
    }
    refreshScheduleCountdownNodes();
    if (!document.querySelector("[data-schedule-countdown-deadline]")) return;
    state.schedule.countdownTimer = window.setInterval(refreshScheduleCountdownNodes, 1000);
  }

  function scheduleFormatCompactDate(ymd) {
    if (!ymd) return "—";
    return scheduleYmdToDate(ymd).toLocaleDateString("pl-PL", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  function scheduleParseMonthCursor(monthCursor) {
    const raw = String(monthCursor || "").split("-");
    let year = Number(raw[0]);
    let month = Number(raw[1]);
    const now = new Date();
    if (!year || year < 1900 || year > 2100) year = now.getFullYear();
    if (!month || month < 1 || month > 12) month = now.getMonth() + 1;
    return { year, month };
  }

  function scheduleCalendarYearBounds(monthCursor) {
    const { year } = scheduleParseMonthCursor(monthCursor);
    const nowY = new Date().getFullYear();
    const yMin = Math.min(year, nowY) - 12;
    const yMax = Math.max(year, nowY) + 6;
    return { yMin, yMax };
  }

  /** Listy miesiąc/rok przez DOM (nie innerHTML), żeby zawsze trafiły do drzewa dokumentu. */
  function scheduleMountCalendarMonthYearPickers(mountEl, monthCursor) {
    if (!mountEl) return;
    const { year, month } = scheduleParseMonthCursor(monthCursor);
    const ym = `${year}-${String(month).padStart(2, "0")}`;
    const { yMin, yMax } = scheduleCalendarYearBounds(ym);
    mountEl.replaceChildren();

    const monthSel = document.createElement("select");
    monthSel.className = "schedule-calendar-select";
    monthSel.setAttribute("data-schedule-calendar-part", "month");
    for (let m = 1; m <= 12; m += 1) {
      const opt = document.createElement("option");
      opt.value = String(m).padStart(2, "0");
      opt.textContent = new Date(2000, m - 1, 1).toLocaleDateString("pl-PL", { month: "long" });
      if (m === month) opt.selected = true;
      monthSel.appendChild(opt);
    }

    const yearSel = document.createElement("select");
    yearSel.className = "schedule-calendar-select";
    yearSel.setAttribute("data-schedule-calendar-part", "year");
    for (let y = yMin; y <= yMax; y += 1) {
      const opt = document.createElement("option");
      opt.value = String(y);
      opt.textContent = String(y);
      if (y === year) opt.selected = true;
      yearSel.appendChild(opt);
    }

    const monthField = document.createElement("label");
    monthField.className = "schedule-calendar-field";
    const monthLegend = document.createElement("span");
    monthLegend.className = "schedule-calendar-field-label";
    monthLegend.textContent = "Miesiąc";
    monthField.append(monthLegend, monthSel);

    const yearField = document.createElement("label");
    yearField.className = "schedule-calendar-field";
    const yearLegend = document.createElement("span");
    yearLegend.className = "schedule-calendar-field-label";
    yearLegend.textContent = "Rok";
    yearField.append(yearLegend, yearSel);

    mountEl.append(monthField, yearField);

    const apply = () => {
      const y = Number(yearSel.value);
      const m = Number(monthSel.value);
      if (!y || !m) return;
      state.schedule.monthCursor = `${y}-${String(m).padStart(2, "0")}`;
      renderSchedulePanel();
    };
    monthSel.addEventListener("change", apply);
    yearSel.addEventListener("change", apply);
  }

  function scheduleShiftMonth(monthCursor, direction) {
    const [year, month] = String(monthCursor || "").split("-").map((value) => Number(value));
    const date = new Date((year || new Date().getFullYear()), (month || 1) - 1, 1);
    date.setMonth(date.getMonth() + Number(direction || 0));
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function scheduleDayBounds(ymd) {
    const start = scheduleYmdToDate(ymd).getTime();
    const end = start + 24 * 60 * 60 * 1000;
    return { start, end };
  }

  function scheduleRangesOverlap(startA, endA, startB, endB) {
    return Number(startA) < Number(endB) && Number(endA) > Number(startB);
  }

  function scheduleItemOnDate(item, ymd) {
    if (!item || !ymd) return false;
    if (item.service === "hotel") {
      return ymd >= item.dateFrom && ymd < item.dateTo;
    }
    const { start, end } = scheduleDayBounds(ymd);
    return scheduleRangesOverlap(item.startMs, item.endMs, start, end);
  }

  function scheduleNormalizeItem(service, row) {
    if (!row || typeof row !== "object") return null;
    if (service === "hotel") {
      const dateFrom = String(row.dateFrom || "").slice(0, 10);
      const dateTo = String(row.dateTo || "").slice(0, 10);
      if (!dateFrom || !dateTo) return null;
      const startMs = scheduleYmdToDate(dateFrom).getTime();
      const endMs = scheduleYmdToDate(dateTo).getTime();
      return {
        key: `${service}:${row.id}`,
        service,
        id: row.id,
        createdAtMs: Number(row.createdAtMs || 0) || null,
        status: row.status,
        statusLabel: scheduleStatusLabel(row.status, row.statusLabel || row.status),
        humanNumberLabel: row.humanNumberLabel || row.id,
        title: row.status === "manual_block" ? "Blokada terminu" : row.customerName || "Rezerwacja hotelowa",
        subtitle: `${dateFrom} - ${dateTo}`,
        dateFrom,
        dateTo,
        startMs,
        endMs,
        resourceIds: Array.isArray(row.roomIds) ? row.roomIds : [],
        pendingExpiresAt: Number(row.pendingExpiresAt || 0) || null,
        emailVerificationExpiresAt: Number(row.emailVerificationExpiresAt || 0) || null,
        raw: row,
      };
    }
    if (service === "restaurant") {
      const startMs = Number(row.startDateTime || 0);
      const endMs = Number(row.endDateTime || 0);
      if (!startMs || !endMs) return null;
      return {
        key: `${service}:${row.id}`,
        service,
        id: row.id,
        createdAtMs: Number(row.createdAtMs || 0) || null,
        status: row.status,
        statusLabel: scheduleStatusLabel(row.status, row.statusLabel || row.status),
        humanNumberLabel: row.humanNumberLabel || row.id,
        title:
          row.status === "manual_block"
            ? "Blokada terminu"
            : row.cateringDelivery && row.recipient && row.recipient.displayName
              ? row.recipient.displayName
              : row.fullName || "Dostawa cateringu",
        subtitle: `${row.reservationDate || ""} ${scheduleFormatTime(startMs)} - ${scheduleFormatTime(endMs)}`.trim(),
        dateFrom: String(row.reservationDate || "").slice(0, 10),
        dateTo: String(row.reservationDate || "").slice(0, 10),
        startMs,
        endMs,
        resourceIds: Array.isArray(row.assignedTableIds) ? row.assignedTableIds : [],
        pendingExpiresAt: Number(row.pendingExpiresAt || 0) || null,
        emailVerificationExpiresAt: Number(row.emailVerificationExpiresAt || 0) || null,
        raw: row,
      };
    }
    const startMs = Number(row.startDateTime || 0);
    const endMs = Number(row.endDateTime || 0);
    if (!startMs || !endMs) return null;
    return {
      key: `${service}:${row.id}`,
      service,
      id: row.id,
      createdAtMs: Number(row.createdAtMs || 0) || null,
      status: row.status,
      statusLabel: scheduleStatusLabel(row.status, row.statusLabel || row.status),
      humanNumberLabel: row.humanNumberLabel || row.id,
      title: row.fullName || row.hallName || "Rezerwacja przyjęcia",
      subtitle: `${row.hallName || ""} • ${row.reservationDate || ""} ${scheduleFormatTime(startMs)} - ${scheduleFormatTime(endMs)}`
        .replace(/^ • /, "")
        .trim(),
      dateFrom: String(row.reservationDate || "").slice(0, 10),
      dateTo: String(row.reservationDate || "").slice(0, 10),
      startMs,
      endMs,
      resourceIds: row.hallId ? [row.hallId] : [],
      pendingExpiresAt: Number(row.pendingExpiresAt || 0) || null,
      emailVerificationExpiresAt: Number(row.emailVerificationExpiresAt || 0) || null,
      raw: row,
    };
  }

  function scheduleFindItem(service, id) {
    return (
      state.schedule.allItems.find((item) => item.service === service && item.id === id) ||
      state.schedule.items.find((item) => item.service === service && item.id === id) ||
      null
    );
  }

  function scheduleItemsForDate(ymd) {
    return state.schedule.items
      .filter((item) => item.status !== "email_verification_pending")
      .filter((item) => scheduleItemOnDate(item, ymd))
      .sort((left, right) => left.startMs - right.startMs);
  }

  async function bookingAdminApi(service, op, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const queryParams = new URLSearchParams({ op: String(op || "").trim() });
    const query = options.query && typeof options.query === "object" ? options.query : {};
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      queryParams.set(key, String(value));
    });
    const path = `/api/admin/legacy-bookings/${encodeURIComponent(service)}?${queryParams.toString()}`;
    const requestOptions = { method };
    const opTrim = String(op || "").trim();
    requestOptions.headers = { "X-Booking-Op": opTrim };
    if (options.body !== undefined) {
      requestOptions.headers["Content-Type"] = "application/json";
      requestOptions.body = JSON.stringify(options.body);
    }
    return api(path, requestOptions);
  }

  function scheduleStopPendingWatch() {
    if (state.schedule.watchTimer) {
      window.clearInterval(state.schedule.watchTimer);
      state.schedule.watchTimer = null;
    }
  }

  function scheduleStartPendingWatch() {
    if (!adminLegacyBookingsEnabled) return;
    if (state.schedule.watchTimer) {
      return;
    }
    state.schedule.knownPendingKeys = null;
    state.schedule.watchBaselineReady = false;
    if (!state.schedule.isLoading && Date.now() - Number(state.schedule.lastLoadedAt || 0) > SCHEDULE_PENDING_WATCH_MS) {
      loadScheduleData({ silent: true });
    }
    state.schedule.watchTimer = window.setInterval(() => {
      if (state.ui.topTab !== "grafik" || state.ui.view !== "section") return;
      if (state.schedule.isLoading) return;
      loadScheduleData({ silent: true, watchPoll: true });
    }, SCHEDULE_PENDING_WATCH_MS);
  }

  function showScheduleToast(message, service, id) {
    let stack = document.getElementById("admin-schedule-toast-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.id = "admin-schedule-toast-stack";
      stack.className = "admin-schedule-toast-stack";
      document.body.appendChild(stack);
    }
    const wrap = document.createElement("div");
    wrap.className = "admin-schedule-toast";
    wrap.setAttribute("role", "status");

    const mainBtn = document.createElement("button");
    mainBtn.type = "button";
    mainBtn.className = "admin-schedule-toast__main";
    const textSpan = document.createElement("span");
    textSpan.className = "admin-schedule-toast__text";
    textSpan.textContent = message;
    const hint = document.createElement("span");
    hint.className = "admin-schedule-toast__hint";
    hint.textContent = "Kliknij, aby otworzyć szczegóły";
    mainBtn.appendChild(textSpan);
    mainBtn.appendChild(hint);
    mainBtn.addEventListener("click", () => {
      openScheduleDetailsModal(service, id);
      wrap.remove();
      if (stack && stack.childElementCount === 0) stack.remove();
    });

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "admin-schedule-toast__close";
    closeBtn.setAttribute("aria-label", "Zamknij");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      wrap.remove();
      if (stack && stack.childElementCount === 0) stack.remove();
    });

    wrap.appendChild(mainBtn);
    wrap.appendChild(closeBtn);
    stack.appendChild(wrap);

    const maxToasts = 4;
    while (stack.children.length > maxToasts) {
      stack.removeChild(stack.firstChild);
    }

    window.setTimeout(() => {
      wrap.classList.add("is-out");
      window.setTimeout(() => {
        wrap.remove();
        if (stack && stack.childElementCount === 0) stack.remove();
      }, 280);
    }, 12000);
  }

  function showAdminFlash(message) {
    let stack = document.getElementById("admin-schedule-toast-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.id = "admin-schedule-toast-stack";
      stack.className = "admin-schedule-toast-stack";
      document.body.appendChild(stack);
    }
    const wrap = document.createElement("div");
    wrap.className = "admin-schedule-toast";
    wrap.setAttribute("role", "status");
    const textSpan = document.createElement("span");
    textSpan.className = "admin-schedule-toast__text";
    textSpan.style.padding = "0.4rem 0.55rem";
    textSpan.textContent = message;
    wrap.appendChild(textSpan);
    stack.appendChild(wrap);
    window.setTimeout(() => {
      wrap.classList.add("is-out");
      window.setTimeout(() => {
        wrap.remove();
        if (stack && stack.childElementCount === 0) stack.remove();
      }, 280);
    }, 2000);
  }

  function scheduleNotifyNewPending(item) {
    if (!item) return;
    const num = String(item.humanNumberLabel || item.id || "").trim() || "—";
    const dayLabel = scheduleFormatCompactDate(item.dateFrom);
    const text = `Zamówienie nr ${num} na dzień ${dayLabel} zostało złożone.`;
    if (typeof window.Notification === "function" && window.Notification.permission === "granted") {
      try {
        const n = new window.Notification("Nowa rezerwacja", {
          body: text,
          tag: `booking-pending-${item.service}-${item.id}`,
        });
        n.onclick = () => {
          window.focus();
          n.close();
          openScheduleDetailsModal(item.service, item.id);
        };
      } catch (_) {
        /* ignore */
      }
    }
    showScheduleToast(text, item.service, item.id);
  }

  async function loadScheduleData({ silent = false, watchPoll = false } = {}) {
    if (!adminLegacyBookingsEnabled) {
      state.schedule.allItems = [];
      state.schedule.items = [];
      state.schedule.pendingItems = [];
      state.schedule.tomorrowItems = [];
      state.schedule.upcomingItems = [];
      state.schedule.unconfirmedItems = [];
      state.schedule.lastError = "";
      return;
    }

    if (!silent) {
      state.schedule.isLoading = true;
      state.schedule.lastError = "";
      if (state.ui.topTab === "grafik" && state.ui.view === "section") {
        renderActiveAdminTile();
      }
    }

    try {
      const [hotelReservations, restaurantReservations, hallReservations, hotelRooms, hallList, cateringRecipientsRes] =
        await Promise.all([
          bookingAdminApi("hotel", "admin-reservations-list", { query: { status: "all" } }),
          bookingAdminApi("restaurant", "admin-reservations-list", { query: { status: "all" } }),
          bookingAdminApi("hall", "admin-reservations-list", { query: { status: "all" } }),
          bookingAdminApi("hotel", "admin-rooms-list"),
          bookingAdminApi("hall", "admin-halls-list"),
          bookingAdminApi("restaurant", "admin-catering-recipients-list"),
        ]);

      const allItems = [
        ...((hotelReservations?.reservations || [])
          .map((row) => scheduleNormalizeItem("hotel", row))
          .filter(Boolean)),
        ...((restaurantReservations?.reservations || [])
          .map((row) => scheduleNormalizeItem("restaurant", row))
          .filter(Boolean)),
        ...((hallReservations?.reservations || [])
          .map((row) => scheduleNormalizeItem("hall", row))
          .filter(Boolean)),
      ];
      const items = allItems
        .filter((item) => SCHEDULE_ACTIVE_STATUSES.has(item.status))
        .sort((left, right) => left.startMs - right.startMs);

      const tomorrow = scheduleAddDays(getTodayIsoDate(), 1);
      const tomorrowStartMs = scheduleYmdToDate(tomorrow).getTime();
      const reservationItems = items.filter((item) => item.status !== "manual_block");
      state.schedule.allItems = allItems
        .slice()
        .sort(
          (left, right) =>
            (Number(right.createdAtMs || 0) - Number(left.createdAtMs || 0)) ||
            (Number(right.startMs || 0) - Number(left.startMs || 0)) ||
            String(right.humanNumberLabel || "").localeCompare(String(left.humanNumberLabel || ""), "pl", { numeric: true })
        );
      state.schedule.items = items;
      state.schedule.pendingItems = reservationItems.filter((item) => item.status === "pending");
      state.schedule.tomorrowItems = reservationItems.filter(
        (item) => item.status !== "email_verification_pending" && scheduleItemOnDate(item, tomorrow)
      );
      state.schedule.upcomingItems = reservationItems
        .filter((item) => item.status !== "email_verification_pending" && item.endMs > tomorrowStartMs)
        .sort((left, right) => left.startMs - right.startMs);
      state.schedule.unconfirmedItems = reservationItems.filter((item) => item.status === "email_verification_pending");
      state.schedule.roomOptions = Array.isArray(hotelRooms?.rooms) ? hotelRooms.rooms : [];
      state.schedule.tableOptions = [];
      state.schedule.hallOptions = Array.isArray(hallList?.halls) ? hallList.halls : [];
      state.schedule.cateringRecipients = Array.isArray(cateringRecipientsRes?.recipients)
        ? cateringRecipientsRes.recipients
        : [];
      state.schedule.lastError = "";

      const pendingList = state.schedule.pendingItems;
      const newSet = new Set(pendingList.map((entry) => `${entry.service}:${entry.id}`));
      const prevKnown = state.schedule.knownPendingKeys;
      const shouldDiff = Boolean(watchPoll && prevKnown && state.schedule.watchBaselineReady);
      if (shouldDiff) {
        pendingList.forEach((entry) => {
          const key = `${entry.service}:${entry.id}`;
          if (!prevKnown.has(key)) {
            scheduleNotifyNewPending(entry);
          }
        });
      }
      state.schedule.knownPendingKeys = newSet;
      if (!watchPoll || !prevKnown) {
        state.schedule.watchBaselineReady = true;
      }
      state.schedule.lastLoadedAt = Date.now();
    } catch (error) {
      state.schedule.allItems = [];
      state.schedule.items = [];
      state.schedule.pendingItems = [];
      state.schedule.tomorrowItems = [];
      state.schedule.upcomingItems = [];
      state.schedule.unconfirmedItems = [];
      state.schedule.cateringRecipients = [];
      state.schedule.lastError = error.message || "Nie udało się pobrać danych grafiku.";
    } finally {
      state.schedule.isLoading = false;
      if (state.ui.topTab === "grafik" && state.ui.view === "section") {
        renderActiveAdminTile();
      }
    }
  }

  function scheduleBuildMonthCells(monthCursor) {
    const [year, month] = String(monthCursor || "").split("-").map((value) => Number(value));
    const monthStart = new Date((year || new Date().getFullYear()), (month || 1) - 1, 1);
    const monthEnd = new Date((year || new Date().getFullYear()), month || 1, 0);
    const firstDayIndex = (monthStart.getDay() + 6) % 7;
    const daysInMonth = monthEnd.getDate();
    const startDate = new Date(monthStart);
    startDate.setDate(monthStart.getDate() - firstDayIndex);
    const totalCells = Math.ceil((firstDayIndex + daysInMonth) / 7) * 7;
    const cells = [];
    for (let index = 0; index < totalCells; index += 1) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + index);
      const ymd = scheduleDateToYmd(date);
      const holidayLabel = scheduleHolidayLabel(ymd);
      const weekday = date.getDay();
      cells.push({
        ymd,
        day: date.getDate(),
        inCurrentMonth: date.getMonth() === monthStart.getMonth(),
        count: scheduleItemsForDate(ymd).length,
        isSaturday: weekday === 6,
        isSunday: weekday === 0,
        isHoliday: Boolean(holidayLabel),
        holidayLabel,
      });
    }
    return cells;
  }

  function scheduleRoomLabels(roomIds) {
    const roomMap = new Map((state.schedule.roomOptions || []).map((room) => [String(room.id), room.name || room.id]));
    return (Array.isArray(roomIds) ? roomIds : [])
      .map((roomId) => roomMap.get(String(roomId)) || String(roomId))
      .filter(Boolean)
      .join(", ");
  }

  function scheduleTableLabels(tableIds) {
    const tableMap = new Map(
      (state.schedule.tableOptions || []).map((table) => [
        String(table.id),
        `Stół ${table.number || table.id}${table.zone ? ` (${table.zone})` : ""}`,
      ])
    );
    return (Array.isArray(tableIds) ? tableIds : [])
      .map((tableId) => tableMap.get(String(tableId)) || String(tableId))
      .filter(Boolean)
      .join(", ");
  }

  function scheduleNoteMarkup(note) {
    return escapeHtml(String(note || "")).replace(/\n/g, "<br>");
  }

  function scheduleDetailSheetRowMarkup(label, value) {
    const raw = value === undefined || value === null ? "" : String(value);
    const display = raw.trim() === "" ? "—" : raw;
    return `
      <div class="schedule-detail-row">
        <span class="schedule-detail-row__label">${escapeHtml(label)}</span>
        <span class="schedule-detail-row__value">${escapeHtml(display)}</span>
      </div>
    `;
  }

  function scheduleDetailSheetCountdownRowMarkup(item, label = "Pozostały czas") {
    const deadlineMs = scheduleItemDeadlineMs(item);
    if (!deadlineMs) return "";
    const text = scheduleCountdownText(deadlineMs);
    return `
      <div class="schedule-detail-row schedule-detail-row--countdown">
        <span class="schedule-detail-row__label">${escapeHtml(label)}</span>
        <span class="schedule-detail-row__value">
          <strong data-schedule-countdown-deadline="${escapeAttribute(String(deadlineMs))}">${escapeHtml(text)}</strong>
        </span>
      </div>
    `;
  }

  function scheduleDetailsSheetWrap(rowsHtml) {
    return `<div class="schedule-details-sheet">${rowsHtml}</div>`;
  }

  function scheduleBooleanLabel(value) {
    return value ? "Tak" : "Nie";
  }

  function scheduleRestaurantPlaceLabel(pref) {
    const p = String(pref || "");
    if (p === "inside") return "W lokalu";
    if (p === "terrace") return "Na tarasie";
    return "Bez preferencji";
  }

  function scheduleNoteCardMarkup(label, value) {
    if (!String(value || "").trim()) return "";
    return `
      <article class="schedule-note-card">
        <span class="schedule-detail-label">${escapeHtml(label)}</span>
        <p>${scheduleNoteMarkup(value)}</p>
      </article>
    `;
  }

  function scheduleCardHeading(item) {
    if (item?.status === "manual_block") return "Blokada";
    const candidate = String(item?.humanNumberLabel || "").trim();
    if (candidate && candidate.length <= 18 && !/^[0-9a-f-]{24,}$/i.test(candidate)) {
      return candidate;
    }
    return "Rezerwacja";
  }

  function scheduleIsPast(item) {
    return Boolean(item?.endMs) && Number(item.endMs) < Date.now();
  }

  function scheduleIsCancelled(item) {
    return String(item?.status || "")
      .trim()
      .toLowerCase() === "cancelled";
  }

  function scheduleIsExpired(item) {
    return String(item?.status || "")
      .trim()
      .toLowerCase() === "expired";
  }

  /** Spis rezerwacji: domyślnie ukrywa przeszłe oraz anulowane/wygasłe; checkboxy w panelu rozszerzają widok. */
  function scheduleRegistryItemMatchesFilters(item) {
    if (!state.schedule.registryShowPast && scheduleIsPast(item)) return false;
    if (
      !state.schedule.registryShowCancelledExpired &&
      (scheduleIsCancelled(item) || scheduleIsExpired(item))
    ) {
      return false;
    }
    return true;
  }

  function scheduleRegistryFilteredItems(items) {
    return (Array.isArray(items) ? items : []).filter(scheduleRegistryItemMatchesFilters);
  }

  function scheduleRegistryDigitsOnly(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function scheduleRegistryItemSearchHaystack(item) {
    const r = item?.raw || {};
    const rec = r.recipient && typeof r.recipient === "object" ? r.recipient : null;
    const parts = [
      item?.humanNumberLabel,
      item?.id,
      r.humanNumber != null ? String(r.humanNumber) : "",
      r.humanYear != null ? String(r.humanYear) : "",
      r.humanSlug,
      r.customerName,
      r.fullName,
      rec?.displayName,
      rec?.contactFirstName,
      rec?.contactLastName,
      rec?.email,
      rec?.phonePrefix,
      rec?.phoneNational,
      r.email,
      r.phone,
      r.phonePrefix,
      r.phoneNational,
      item?.title,
      item?.subtitle,
    ];
    const text = normalizeComparableText(parts.filter(Boolean).join(" "));
    const phoneDigits = scheduleRegistryDigitsOnly(
      [r.phone, r.phonePrefix, r.phoneNational, rec?.phonePrefix, rec?.phoneNational].filter(Boolean).join("")
    );
    return { text, phoneDigits };
  }

  function scheduleRegistryMatchesSearch(item, queryRaw) {
    const q = String(queryRaw || "").trim();
    if (!q) return true;
    const qNorm = normalizeComparableText(q);
    const qDigits = scheduleRegistryDigitsOnly(q);
    const { text, phoneDigits } = scheduleRegistryItemSearchHaystack(item);
    if (qNorm && text.includes(qNorm)) return true;
    if (qDigits.length >= 3 && phoneDigits.includes(qDigits)) return true;
    return false;
  }

  function scheduleRegistryApplySearch(items, queryRaw) {
    return (Array.isArray(items) ? items : []).filter((item) => scheduleRegistryMatchesSearch(item, queryRaw));
  }

  function scheduleRegistryVisibleItems() {
    const filtered = scheduleRegistryFilteredItems(state.schedule.allItems);
    return scheduleRegistryApplySearch(filtered, state.schedule.registrySearchQuery);
  }

  function scheduleRegistryRefreshListBody(panel) {
    if (!panel) return;
    const body = panel.querySelector("[data-schedule-registry-body]");
    if (!body) return;
    const visibleItems = scheduleRegistryVisibleItems();
    const registryCounts = scheduleRegistryDisplayCounts(visibleItems);
    body.innerHTML = scheduleReservationIndexMarkup(visibleItems);
    const pill = panel.querySelector(".schedule-registry-head .pill");
    if (pill) pill.textContent = String(registryCounts.total);
  }

  function scheduleCanCancel(item) {
    const status = String(item?.status || "")
      .trim()
      .toLowerCase();
    if (scheduleIsPast(item)) return false;
    return ["pending", "confirmed", "email_verification_pending"].includes(status);
  }

  function scheduleRegistryItemMarkup(item) {
    const createdLabel = item.createdAtMs ? scheduleFormatDateTime(item.createdAtMs) : "Brak daty utworzenia";
    const registryToneClass = `${scheduleIsPast(item) ? " is-past" : ""}${scheduleIsCancelled(item) ? " is-cancelled" : ""}${
      scheduleIsExpired(item) ? " is-expired" : ""
    }`;
    return `
      <article class="schedule-day-item schedule-registry-item${registryToneClass}">
        <button type="button" class="button secondary schedule-card-action-details" data-schedule-action="details" data-schedule-service="${escapeAttribute(item.service)}" data-schedule-id="${escapeAttribute(item.id)}">Szczegóły</button>
        <div class="schedule-day-item-head">
          <div class="schedule-day-item-meta">
            <strong>${escapeHtml(scheduleCardHeading(item))}</strong>
            <span class="pill schedule-status-pill ${scheduleStatusPillClass(item.status)}">${escapeHtml(item.statusLabel || scheduleStatusLabel(item.status))}</span>
            ${scheduleIsPast(item) ? '<span class="pill schedule-registry-past-pill">Minęła</span>' : ""}
          </div>
        </div>
        <p>${escapeHtml(item.title || "Rezerwacja")}</p>
        <p class="helper">${escapeHtml(item.subtitle || "")}</p>
        <p class="helper">Dodano: ${escapeHtml(createdLabel)}</p>
      </article>
    `;
  }

  function scheduleRegistryColumnMarkup(serviceKey, columnItems) {
    const title = scheduleServiceLabel(serviceKey);
    const count = columnItems.length;
    const body =
      count > 0
        ? `<div class="schedule-day-list schedule-registry-list">${columnItems.map((item) => scheduleRegistryItemMarkup(item)).join("")}</div>`
        : `<p class="empty schedule-registry-column-empty">Brak rezerwacji.</p>`;
    return `
      <div class="schedule-registry-column" data-schedule-registry-service="${escapeAttribute(serviceKey)}">
        <div class="schedule-registry-column-head">
          <h4 class="schedule-registry-column-title">${escapeHtml(title)}</h4>
          <span class="pill">${escapeHtml(String(count))}</span>
        </div>
        ${body}
      </div>
    `;
  }

  /**
   * Spis rezerwacji: jeden wiersz na serię dostaw cateringu.
   * — cateringSeriesId z API (najpewniejsze).
   * — bez niego (np. stare wpisy): ten sam numer „ludzki” cateringu (slug + rok) + odbiorca + godzina + czas trwania
   *   — w D1 ta sama seria cykliczna ma wspólny human_slug / human_year na wszystkich terminach.
   * — dalej: odbiorca + znormalizowana godzina + zaokrąglony czas trwania + uwagi.
   */
  function scheduleRegistryNormalizeHm(hm) {
    const s = String(hm || "").trim();
    const m = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (!m) return s;
    const h = Math.min(23, Math.max(0, Number(m[1])));
    const min = Math.min(59, Math.max(0, Number(m[2])));
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }

  function scheduleRegistryRestaurantSlotDurationHours(item, r) {
    let dur = Number(r?.durationHours);
    if (Number.isFinite(dur) && dur > 0) return dur;
    const sm = Number(item?.startMs);
    const em = Number(item?.endMs);
    if (sm && em && em > sm) return (em - sm) / 3600000;
    return NaN;
  }

  function scheduleRegistryRoundedDurationHours(item, r) {
    const dur = scheduleRegistryRestaurantSlotDurationHours(item, r);
    if (!Number.isFinite(dur) || dur <= 0) return NaN;
    return Math.round(dur * 10000) / 10000;
  }

  function scheduleRegistryRestaurantCycleGroupKey(item) {
    const r = item?.raw || {};
    const sid = String(r.cateringSeriesId || r.catering_series_id || "").trim();
    if (sid) return `series:${sid}`;
    if (!r.cateringDelivery) return `one:${item.id}`;
    const rec = String(r.recipientId || "").trim();
    if (!rec) return `one:${item.id}`;
    const st = scheduleRegistryNormalizeHm(r.startTime || "");
    const dur = scheduleRegistryRoundedDurationHours(item, r);
    if (!st || !Number.isFinite(dur) || dur <= 0) return `one:${item.id}`;
    const slug = String(r.humanSlug || r.human_slug || "").trim();
    const hy = Number(r.humanYear ?? r.human_year);
    if (slug && Number.isInteger(hy) && hy >= 2000 && hy <= 2100) {
      return `cater:${rec}:${st}:${dur}:${slug}:${hy}`;
    }
    const noteKey = normalizeComparableText(
      `${String(r.customerNote || "")}\n${String(r.adminNote || "")}`
    ).slice(0, 200);
    return `slot:${rec}:${st}:${dur}:${noteKey}`;
  }

  /** Dla zgrupowanej serii: najbliższy przyszły termin, inaczej ostatni przeszły — czytelniejszy podtytuł niż „pierwszy kiedykolwiek”. */
  function scheduleRegistryPickSeriesRepresentative(cur, cand) {
    if (!cur) return cand;
    const now = Date.now();
    const curFut = Number(cur.startMs || 0) >= now;
    const candFut = Number(cand.startMs || 0) >= now;
    if (candFut !== curFut) return candFut ? cand : cur;
    if (candFut) return Number(cand.startMs || 0) < Number(cur.startMs || 0) ? cand : cur;
    return Number(cand.startMs || 0) > Number(cur.startMs || 0) ? cand : cur;
  }

  function scheduleDedupeRestaurantRegistryItems(items) {
    const list = Array.isArray(items) ? items : [];
    const counts = new Map();
    for (const item of list) {
      const k = scheduleRegistryRestaurantCycleGroupKey(item);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const repByKey = new Map();
    for (const item of list) {
      const k = scheduleRegistryRestaurantCycleGroupKey(item);
      const cur = repByKey.get(k);
      repByKey.set(k, scheduleRegistryPickSeriesRepresentative(cur, item));
    }
    const out = [];
    for (const [k, rep] of repByKey) {
      const cnt = counts.get(k) || 1;
      if (cnt > 1) {
        out.push({
          ...rep,
          subtitle: `${rep.subtitle} · cykl: ${cnt} terminów`,
        });
      } else {
        out.push(rep);
      }
    }
    return out.sort(
      (a, b) =>
        (Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0)) ||
        (Number(b.startMs || 0) - Number(a.startMs || 0))
    );
  }

  function scheduleRegistryDisplayCounts(items) {
    const hotelItems = items.filter((item) => item.service === "hotel");
    const restaurantRaw = items.filter((item) => item.service === "restaurant");
    const hallItems = items.filter((item) => item.service === "hall");
    const restaurantItems = scheduleDedupeRestaurantRegistryItems(restaurantRaw);
    const total = hotelItems.length + restaurantItems.length + hallItems.length;
    return { hotelItems, restaurantItems, hallItems, total };
  }

  function scheduleReservationIndexMarkup(items) {
    const { hotelItems, restaurantItems, hallItems } = scheduleRegistryDisplayCounts(items);
    return `
      <div class="schedule-registry-columns">
        ${scheduleRegistryColumnMarkup("hotel", hotelItems)}
        ${scheduleRegistryColumnMarkup("restaurant", restaurantItems)}
        ${scheduleRegistryColumnMarkup("hall", hallItems)}
      </div>
    `;
  }

  function scheduleQuickListMarkup(items, emptyText) {
    if (!items.length) {
      return `<p class="empty">${escapeHtml(emptyText)}</p>`;
    }
    return `
      <div class="schedule-quick-list">
        ${items
          .map(
            (item) => `
              <article class="schedule-quick-item">
                <button type="button" class="button secondary schedule-card-action-details" data-schedule-action="details" data-schedule-service="${escapeAttribute(item.service)}" data-schedule-id="${escapeAttribute(item.id)}">Szczegóły</button>
                <div class="schedule-quick-head">
                  <strong>${escapeHtml(scheduleCardHeading(item))}</strong>
                  <span class="pill ${scheduleServicePillClass(item.service)}">${escapeHtml(scheduleServiceLabel(item.service))}</span>
                  <span class="pill schedule-status-pill ${scheduleStatusPillClass(item.status)}">${escapeHtml(item.statusLabel || scheduleStatusLabel(item.status))}</span>
                </div>
                <p>${escapeHtml(item.title || "Rezerwacja")}</p>
                <p class="helper">${escapeHtml(item.subtitle || "")}</p>
                ${scheduleCountdownInlineMarkup(item)}
                ${
                  item.status === "pending"
                    ? `<div class="schedule-card-actions-bottom">
                        <button type="button" class="button secondary danger-muted" data-schedule-action="reject" data-schedule-service="${escapeAttribute(item.service)}" data-schedule-id="${escapeAttribute(item.id)}">Odrzuć</button>
                        <button type="button" class="button secondary schedule-card-action-confirm" data-schedule-action="confirm" data-schedule-service="${escapeAttribute(item.service)}" data-schedule-id="${escapeAttribute(item.id)}">Potwierdź</button>
                      </div>`
                    : ""
                }
              </article>
            `
          )
          .join("")}
      </div>
    `;
  }

  function scheduleItemGroupDate(item, floorYmd = "") {
    if (!item) return "";
    const baseYmd = String(item.dateFrom || "").slice(0, 10) || scheduleDateToYmd(new Date(item.startMs || Date.now()));
    if (floorYmd && item.service === "hotel" && item.dateFrom < floorYmd && item.dateTo > floorYmd) {
      return floorYmd;
    }
    return baseYmd;
  }

  function scheduleGroupItemsByDate(items, floorYmd = "") {
    const groups = [];
    const groupMap = new Map();
    (Array.isArray(items) ? items : []).forEach((item) => {
      const ymd = scheduleItemGroupDate(item, floorYmd);
      if (!groupMap.has(ymd)) {
        const group = { ymd, items: [] };
        groupMap.set(ymd, group);
        groups.push(group);
      }
      groupMap.get(ymd).items.push(item);
    });
    return groups;
  }

  function scheduleTileCountClass(kind, count) {
    if (kind === "unconfirmed") return "schedule-stat-count is-muted";
    if (!(count > 0)) return "schedule-stat-count is-zero";
    if (kind === "pending" && count > 1) return "schedule-stat-count is-danger";
    if (kind === "tomorrow" && count > 1) return "schedule-stat-count is-success";
    return "schedule-stat-count";
  }

  function scheduleSummaryTilesMarkup() {
    const tomorrowYmd = scheduleAddDays(getTodayIsoDate(), 1);
    const tiles = [
      {
        key: "tomorrow",
        title: "Jutrzejsze rezerwacje",
        description: `Na ${scheduleFormatDateLabel(tomorrowYmd)}. Po kliknięciu też kolejne najbliższe terminy.`,
        count: state.schedule.tomorrowItems.length,
      },
      {
        key: "pending",
        title: "Oczekujące na akceptację",
        description: "Rezerwacje czekające na decyzję administratora.",
        count: state.schedule.pendingItems.length,
      },
      {
        key: "unconfirmed",
        title: "Rezerwacje niepotwierdzone",
        description: "Zgłoszenia bez potwierdzenia adresu e-mail.",
        count: state.schedule.unconfirmedItems.length,
      },
    ];
    return `
      <div class="schedule-summary-grid schedule-summary-grid--compact">
        ${tiles
          .map(
            (tile) => `
              <button
                type="button"
                class="schedule-stat-tile schedule-stat-tile--${escapeAttribute(tile.key)}"
                data-schedule-list="${escapeAttribute(tile.key)}"
              >
                <span class="schedule-stat-head">
                  <strong>${escapeHtml(tile.title)}</strong>
                  <span class="${scheduleTileCountClass(tile.key, tile.count)}">${escapeHtml(String(tile.count))}</span>
                </span>
                <span class="schedule-stat-description">${escapeHtml(tile.description)}</span>
              </button>
            `
          )
          .join("")}
      </div>
    `;
  }

  function scheduleListItemDetailsButton(item) {
    return `<button type="button" class="button secondary schedule-card-action-details" data-schedule-action="details" data-schedule-service="${escapeAttribute(item.service)}" data-schedule-id="${escapeAttribute(item.id)}">Szczegóły</button>`;
  }

  function scheduleListItemBottomActionsMarkup(kind, item) {
    if (kind === "pending") {
      const cancelBtn = scheduleCanCancel(item)
        ? `<button type="button" class="button secondary danger-muted schedule-inline-cancel schedule-card-action-cancel" data-schedule-action="cancel" data-schedule-service="${escapeAttribute(item.service)}" data-schedule-id="${escapeAttribute(item.id)}">Odwołaj</button>`
        : "";
      const confirmBtn = `<button type="button" class="button secondary schedule-card-action-confirm" data-schedule-action="confirm" data-schedule-service="${escapeAttribute(item.service)}" data-schedule-id="${escapeAttribute(item.id)}">Potwierdź</button>`;
      return `${cancelBtn}${confirmBtn}`;
    }
    return "";
  }

  function scheduleGroupedListMarkup(items, kind, { emptyText = "", floorYmd = "" } = {}) {
    if (!items.length) {
      return `<p class="empty">${escapeHtml(emptyText)}</p>`;
    }
    return scheduleGroupItemsByDate(items, floorYmd)
      .map(
        (group) => `
          <section class="schedule-modal-list-group">
            <div class="schedule-modal-list-group-head">
              <h4>${escapeHtml(scheduleFormatDateLabel(group.ymd))}</h4>
              <span class="pill">${escapeHtml(String(group.items.length))}</span>
            </div>
            <div class="schedule-day-list">
              ${group.items
                .map((item) => {
                  const bottomActions = scheduleListItemBottomActionsMarkup(kind, item);
                  return `
                    <article class="schedule-day-item schedule-modal-list-item">
                      ${scheduleListItemDetailsButton(item)}
                      <div class="schedule-day-item-head">
                        <div class="schedule-day-item-meta">
                          <strong>${escapeHtml(scheduleCardHeading(item))}</strong>
                          <span class="pill ${scheduleServicePillClass(item.service)}">${escapeHtml(scheduleServiceLabel(item.service))}</span>
                          <span class="pill schedule-status-pill ${scheduleStatusPillClass(item.status)}">${escapeHtml(item.statusLabel || scheduleStatusLabel(item.status))}</span>
                        </div>
                      </div>
                      <p>${escapeHtml(item.title || "Rezerwacja")}</p>
                      <p class="helper">${escapeHtml(item.subtitle || "")}</p>
                      ${scheduleCountdownInlineMarkup(item)}
                      ${bottomActions ? `<div class="schedule-card-actions-bottom">${bottomActions}</div>` : ""}
                    </article>
                  `;
                })
                .join("")}
            </div>
          </section>
        `
      )
      .join("");
  }

  function scheduleListConfig(kind) {
    const tomorrowYmd = scheduleAddDays(getTodayIsoDate(), 1);
    if (kind === "pending") {
      return {
        title: "Oczekujące na akceptację",
        count: state.schedule.pendingItems.length,
        description: "Wszystkie rezerwacje czekające na decyzję administratora.",
        items: state.schedule.pendingItems,
        emptyText: "Brak rezerwacji oczekujących na akceptację.",
        floorYmd: "",
      };
    }
    if (kind === "unconfirmed") {
      return {
        title: "Rezerwacje niepotwierdzone",
        count: state.schedule.unconfirmedItems.length,
        description: "Zgłoszenia, które nie potwierdziły jeszcze adresu e-mail.",
        items: state.schedule.unconfirmedItems,
        emptyText: "Brak niepotwierdzonych rezerwacji.",
        floorYmd: "",
      };
    }
    return {
      title: "Jutrzejsze i najbliższe rezerwacje",
      count: state.schedule.tomorrowItems.length,
      description: `Kafelek pokazuje liczbę pozycji na ${scheduleFormatDateLabel(
        tomorrowYmd
      )}. Lista niżej obejmuje też kolejne najbliższe rezerwacje.`,
      items: state.schedule.upcomingItems,
      emptyText: "Brak jutrzejszych i najbliższych rezerwacji.",
      floorYmd: tomorrowYmd,
    };
  }

  function openScheduleListModal(kind) {
    const config = scheduleListConfig(kind);
    let visibleCount = 10;

    const renderContent = () => {
      const visibleItems = config.items.slice(0, visibleCount);
      return `
        <div class="admin-modal-head">
          <div>
            <p class="pill">${escapeHtml(String(config.count))}</p>
            <h3>${escapeHtml(config.title)}</h3>
            <p class="helper">${escapeHtml(config.description)}</p>
          </div>
          <button type="button" class="button secondary icon-button" data-schedule-modal-close aria-label="Zamknij">${scheduleIconMarkup("close")}</button>
        </div>
        <div class="schedule-modal-list">
          ${scheduleGroupedListMarkup(visibleItems, kind, {
            emptyText: config.emptyText,
            floorYmd: config.floorYmd,
          })}
        </div>
        <div class="admin-modal-footer schedule-modal-footer">
          ${
            visibleCount < config.items.length
              ? `<button type="button" class="button secondary" data-schedule-list-more>Załaduj więcej</button>`
              : `<p class="helper schedule-modal-summary">Pokazano ${escapeHtml(String(visibleItems.length))} z ${escapeHtml(
                  String(config.items.length)
                )} pozycji.</p>`
          }
        </div>
      `;
    };

    openScheduleModal(renderContent(), (mount) => {
      const bindModal = () => {
        mount.querySelectorAll("[data-schedule-modal-close]").forEach((button) => {
          button.addEventListener("click", closeScheduleModal);
        });
        mount.querySelector("[data-schedule-list-more]")?.addEventListener("click", () => {
          visibleCount += 10;
          mount.querySelector(".schedule-modal").innerHTML = renderContent();
          bindModal();
        });
        mount.querySelectorAll("[data-schedule-action]").forEach((button) => {
          button.addEventListener("click", async () => {
            const action = button.dataset.scheduleAction;
            const service = button.dataset.scheduleService;
            const id = button.dataset.scheduleId;
            if (action === "details") {
              openScheduleDetailsModal(service, id);
              return;
            }
            if (action === "confirm") {
              await scheduleConfirmReservation(service, id);
              closeScheduleModal();
              return;
            }
            if (action === "cancel") {
              openScheduleCancelModal(service, id);
            }
          });
        });
      };

      bindModal();
    });
  }

  function renderSchedulePanel(statusMessage = "") {
    const panel = document.querySelector("#schedule-panel");
    if (!panel) return;
    if (!adminLegacyBookingsEnabled) {
      panel.innerHTML = `
        <p class="status">Ten widok wymaga włączenia backendu rezerwacji online.</p>
      `;
      return;
    }

    const selectedDate = state.schedule.selectedDate || getTodayIsoDate();
    state.schedule.selectedDate = selectedDate;
    const monthCursor = state.schedule.monthCursor || selectedDate.slice(0, 7);
    state.schedule.monthCursor = monthCursor;
    const monthCells = scheduleBuildMonthCells(monthCursor);
    const dayItems = scheduleItemsForDate(selectedDate);

    panel.innerHTML = `
      <div class="schedule-shell">
        ${scheduleSummaryTilesMarkup()}
        <section class="schedule-calendar-card">
          <div class="schedule-calendar-head">
            <div class="schedule-calendar-head-spacer" aria-hidden="true"></div>
            <div class="schedule-calendar-nav">
              <button type="button" class="button secondary icon-button" data-schedule-month="-1" aria-label="Poprzedni miesiąc">←</button>
              <div class="schedule-calendar-picker" data-schedule-month-year-mount></div>
              <button type="button" class="button secondary icon-button" data-schedule-month="1" aria-label="Następny miesiąc">→</button>
            </div>
            <button type="button" class="schedule-refresh-button" data-schedule-refresh aria-label="Odśwież">${scheduleIconMarkup("refresh")}</button>
          </div>
          <div class="schedule-weekdays">
            ${[
              { label: "Pon", className: "" },
              { label: "Wt", className: "" },
              { label: "Śr", className: "" },
              { label: "Czw", className: "" },
              { label: "Pt", className: "" },
              { label: "Sob", className: "is-saturday" },
              { label: "Nd", className: "is-sunday" },
            ]
              .map((day) => `<span class="${day.className}">${day.label}</span>`)
              .join("")}
          </div>
          <div class="schedule-calendar-grid">
            ${monthCells
              .map(
                (cell) => `
                  <button
                    type="button"
                    class="schedule-day-cell${cell.inCurrentMonth ? "" : " is-outside"}${cell.count === 0 ? " is-empty" : " has-entries"}${cell.ymd === selectedDate ? " is-selected" : ""}${cell.isSaturday ? " is-saturday" : ""}${cell.isSunday ? " is-sunday" : ""}${cell.isHoliday ? " is-holiday" : ""}"
                    data-schedule-day="${escapeAttribute(cell.ymd)}"
                    title="${escapeAttribute(
                      [scheduleFormatDateLabel(cell.ymd), cell.holidayLabel || "", cell.count > 0 ? scheduleEntriesCountLabel(cell.count) : "Brak wpisów"]
                        .filter(Boolean)
                        .join(" • ")
                    )}"
                  >
                    <span class="schedule-day-number">${escapeHtml(String(cell.day))}</span>
                    ${cell.count > 0 ? '<span class="schedule-day-dot" aria-hidden="true"></span>' : ""}
                    <span class="schedule-day-count">${cell.count > 0 ? scheduleEntriesCountLabel(cell.count) : ""}</span>
                  </button>
                `
              )
              .join("")}
          </div>
        </section>
        <section class="schedule-day-card">
          <div class="schedule-day-head">
            <h3>${escapeHtml(scheduleFormatDateLabel(selectedDate))}</h3>
            <button type="button" class="button" data-schedule-add>+ Dodaj</button>
          </div>
          <div class="schedule-day-list">
            ${
              dayItems.length
                ? dayItems
                    .map(
                      (item) => `
                        <article class="schedule-day-item">
                          ${scheduleListItemDetailsButton(item)}
                          <div class="schedule-day-item-head">
                            <div class="schedule-day-item-meta">
                              <strong>${escapeHtml(scheduleCardHeading(item))}</strong>
                              <span class="pill ${scheduleServicePillClass(item.service)}">${escapeHtml(scheduleServiceLabel(item.service))}</span>
                              <span class="pill schedule-status-pill ${scheduleStatusPillClass(item.status)}">${escapeHtml(item.statusLabel || scheduleStatusLabel(item.status))}</span>
                            </div>
                          </div>
                          <p>${escapeHtml(item.title || "Rezerwacja")}</p>
                          <p class="helper">${escapeHtml(item.subtitle || "")}</p>
                          ${scheduleCountdownInlineMarkup(item)}
                          ${
                            item.status !== "manual_block" && item.status === "pending"
                              ? `<div class="schedule-card-actions-bottom">
                            ${
                              scheduleCanCancel(item)
                                ? `<button type="button" class="button secondary danger-muted schedule-inline-cancel schedule-card-action-cancel" data-schedule-action="cancel" data-schedule-service="${escapeAttribute(item.service)}" data-schedule-id="${escapeAttribute(item.id)}">Odwołaj</button>`
                                : ""
                            }
                            <button type="button" class="button secondary schedule-card-action-confirm" data-schedule-action="confirm" data-schedule-service="${escapeAttribute(item.service)}" data-schedule-id="${escapeAttribute(item.id)}">Potwierdź</button>
                          </div>`
                              : ""
                          }
                        </article>
                      `
                    )
                    .join("")
                : `<p class="empty">Brak rezerwacji i blokad dla tego dnia.</p>`
            }
          </div>
        </section>
      </div>
      <p class="status">${escapeHtml(
        state.schedule.lastError || statusMessage || (state.schedule.isLoading ? "Ładowanie grafiku..." : "")
      )}</p>
    `;

    scheduleMountCalendarMonthYearPickers(panel.querySelector("[data-schedule-month-year-mount]"), monthCursor);

    panel.querySelectorAll("[data-schedule-month]").forEach((button) => {
      button.addEventListener("click", () => {
        state.schedule.monthCursor = scheduleShiftMonth(state.schedule.monthCursor, Number(button.dataset.scheduleMonth || 0));
        renderSchedulePanel();
      });
    });
    panel.querySelectorAll("[data-schedule-day]").forEach((button) => {
      button.addEventListener("click", () => {
        state.schedule.selectedDate = button.dataset.scheduleDay;
        state.schedule.monthCursor = String(button.dataset.scheduleDay || getTodayIsoDate()).slice(0, 7);
        renderSchedulePanel();
      });
    });
    panel.querySelector("[data-schedule-refresh]")?.addEventListener("click", () => {
      loadScheduleData();
    });
    panel.querySelector("[data-schedule-add]")?.addEventListener("click", () => {
      openScheduleCreateModal(state.schedule.selectedDate || getTodayIsoDate());
    });
    panel.querySelectorAll("[data-schedule-list]").forEach((button) => {
      button.addEventListener("click", () => {
        openScheduleListModal(button.dataset.scheduleList || "tomorrow");
      });
    });
    panel.querySelectorAll("[data-schedule-action]").forEach((button) => {
      button.addEventListener("click", () => {
        handleScheduleAction(
          button.dataset.scheduleAction,
          button.dataset.scheduleService,
          button.dataset.scheduleId
        );
      });
    });
    syncScheduleCountdownTicker();
  }

  function renderReservationIndexPanel(statusMessage = "") {
    const panel = document.querySelector("#schedule-panel");
    if (!panel) return;
    if (!adminLegacyBookingsEnabled) {
      panel.innerHTML = `
        <p class="status">Ten widok wymaga włączenia backendu rezerwacji online.</p>
      `;
      return;
    }

    const visibleItems = scheduleRegistryVisibleItems();
    const registryCounts = scheduleRegistryDisplayCounts(visibleItems);
    panel.innerHTML = `
      <div class="schedule-shell">
        <section class="schedule-calendar-card schedule-registry-card">
          <div class="schedule-calendar-head schedule-registry-head">
            <p class="pill">${escapeHtml(String(registryCounts.total))}</p>
            <button type="button" class="schedule-refresh-button" data-schedule-refresh aria-label="Odśwież">${scheduleIconMarkup("refresh")}</button>
          </div>
          <div class="schedule-registry-search">
            <label class="schedule-registry-search-label">
              <span class="schedule-registry-search-label-text">Szukaj</span>
              <input
                type="search"
                class="schedule-registry-search-input"
                data-schedule-registry-search
                placeholder="Numer rezerwacji, imię i nazwisko, e-mail lub telefon…"
                value="${escapeAttribute(state.schedule.registrySearchQuery)}"
                autocomplete="off"
                spellcheck="false"
              />
            </label>
          </div>
          <div class="schedule-registry-filters">
            <label class="admin-check-line">
              <input type="checkbox" data-schedule-registry-show-past ${state.schedule.registryShowPast ? "checked" : ""} />
              <span>Pokaż przeszłe</span>
            </label>
            <label class="admin-check-line">
              <input type="checkbox" data-schedule-registry-show-cancelled ${state.schedule.registryShowCancelledExpired ? "checked" : ""} />
              <span>Pokaż anulowane (wygasłe)</span>
            </label>
          </div>
          <hr class="schedule-registry-divider" aria-hidden="true" />
          ${statusMessage ? `<p class="status">${escapeHtml(statusMessage)}</p>` : ""}
          ${state.schedule.lastError ? `<p class="status">${escapeHtml(state.schedule.lastError)}</p>` : ""}
          <div data-schedule-registry-body>
            ${scheduleReservationIndexMarkup(visibleItems)}
          </div>
        </section>
      </div>
    `;

    const registryCard = panel.querySelector(".schedule-registry-card");
    registryCard?.addEventListener("click", (event) => {
      const details = event.target.closest("[data-schedule-action='details']");
      if (!details || !registryCard.contains(details)) return;
      openScheduleDetailsModal(details.dataset.scheduleService, details.dataset.scheduleId);
    });

    panel.querySelector("[data-schedule-registry-show-past]")?.addEventListener("change", (event) => {
      state.schedule.registryShowPast = Boolean(event.currentTarget.checked);
      renderReservationIndexPanel();
    });
    panel.querySelector("[data-schedule-registry-show-cancelled]")?.addEventListener("change", (event) => {
      state.schedule.registryShowCancelledExpired = Boolean(event.currentTarget.checked);
      renderReservationIndexPanel();
    });
    panel.querySelector("[data-schedule-registry-search]")?.addEventListener("input", (event) => {
      state.schedule.registrySearchQuery = String(event.currentTarget.value || "");
      scheduleRegistryRefreshListBody(panel);
    });
    panel.querySelector("[data-schedule-refresh]")?.addEventListener("click", () => {
      loadScheduleData();
    });
  }

  async function handleScheduleAction(action, service, id) {
    if (!action || !service || !id) return;
    if (action === "details") {
      openScheduleDetailsModal(service, id);
      return;
    }
    if (action === "confirm") {
      await scheduleConfirmReservation(service, id);
      return;
    }
    if (action === "cancel" || action === "reject") {
      openScheduleCancelModal(service, id);
    }
  }

  async function scheduleConfirmReservation(service, id) {
    try {
      await bookingAdminApi(service, "admin-reservation-confirm", { method: "POST", body: { id } });
      await loadScheduleData({ silent: true });
      renderSchedulePanel("Rezerwacja została potwierdzona.");
    } catch (error) {
      renderSchedulePanel(error.message || "Nie udało się potwierdzić rezerwacji.");
    }
  }

  async function scheduleCancelReservation(service, id, cancelReason = "", successMessage = "Rezerwacja została odwołana.") {
    try {
      await bookingAdminApi(service, "admin-reservation-cancel", { method: "POST", body: { id, cancelReason } });
      await loadScheduleData({ silent: true });
      renderSchedulePanel(successMessage);
    } catch (error) {
      renderSchedulePanel(error.message || "Nie udało się anulować rezerwacji.");
    }
  }

  function openScheduleCancelModal(service, id, successMessage = "Rezerwacja została odwołana.") {
    const item = scheduleFindItem(service, id);
    if (!item) return;
    if (item.status === "manual_block") {
      if (!window.confirm("Czy na pewno usunąć tę blokadę?")) return;
      scheduleCancelReservation(item.service, item.id, "", "Blokada została usunięta.");
      return;
    }
    openScheduleModal(
      `
        <div class="admin-modal-head">
          <div>
            <p class="pill ${scheduleServicePillClass(item.service)}">${escapeHtml(scheduleServiceLabel(item.service))}</p>
            <h3>Odwołaj rezerwację</h3>
            <p class="helper">Powód zostanie wysłany do klienta w automatycznym mailu o anulowaniu.</p>
          </div>
          <button type="button" class="button secondary icon-button" data-schedule-modal-close aria-label="Zamknij">${scheduleIconMarkup("close")}</button>
        </div>
        <form class="schedule-cancel-form" data-schedule-cancel-form>
          <label>
            <span>Powód anulowania</span>
            <textarea name="cancelReason" rows="5" maxlength="2000" required placeholder="Podaj powód odwołania rezerwacji."></textarea>
          </label>
          <div class="admin-modal-footer schedule-modal-footer">
            <button type="button" class="button secondary" data-schedule-modal-close>Anuluj</button>
            <button type="submit" class="button danger">Odwołaj rezerwację</button>
          </div>
        </form>
      `,
      (mount) => {
        mount.querySelector("[data-schedule-cancel-form]")?.addEventListener("submit", async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const formData = new FormData(form);
          const cancelReason = String(formData.get("cancelReason") || "").trim();
          if (!cancelReason) {
            form.querySelector("textarea")?.focus();
            return;
          }
          await scheduleCancelReservation(item.service, item.id, cancelReason, successMessage);
          closeScheduleModal();
        });
      }
    );
  }

  function closeScheduleModal() {
    document.querySelector("#schedule-modal-mount")?.remove();
    document.body.classList.remove("admin-modal-open");
    syncScheduleCountdownTicker();
  }

  function openScheduleModal(contentMarkup, bindEvents, options = {}) {
    const closeOnOverlayClick = options.closeOnOverlayClick !== false;
    closeScheduleModal();
    const mount = document.createElement("div");
    mount.id = "schedule-modal-mount";
    mount.innerHTML = `
      <div class="admin-modal-overlay" data-schedule-modal-overlay>
        <section class="admin-modal schedule-modal">${contentMarkup}</section>
      </div>
    `;
    document.body.appendChild(mount);
    document.body.classList.add("admin-modal-open");

    if (closeOnOverlayClick) {
      mount.querySelector("[data-schedule-modal-overlay]")?.addEventListener("click", (event) => {
        if (event.target === event.currentTarget) {
          closeScheduleModal();
        }
      });
    }
    mount.querySelectorAll("[data-schedule-modal-close]").forEach((button) => {
      button.addEventListener("click", closeScheduleModal);
    });
    if (typeof bindEvents === "function") {
      bindEvents(mount);
    }
    syncScheduleCountdownTicker();
  }

  function openScheduleYesNoModal(messageText) {
    const message = escapeHtml(messageText);
    return new Promise((resolve) => {
      openScheduleModal(
        `
        <div class="admin-modal-head">
          <div>
            <p class="pill">Wiadomość e-mail</p>
            <h3>Powiadomienie dla klienta</h3>
          </div>
        </div>
        <p class="helper" style="margin:0 0 1rem;">${message}</p>
        <div class="admin-modal-footer">
          <button type="button" class="button secondary" data-schedule-yes-no="no">Nie</button>
          <button type="button" class="button" data-schedule-yes-no="yes">Tak</button>
        </div>
      `,
        (mount) => {
          const finish = (value) => {
            closeScheduleModal();
            resolve(value);
          };
          mount.querySelector('[data-schedule-yes-no="no"]')?.addEventListener("click", () => finish(false));
          mount.querySelector('[data-schedule-yes-no="yes"]')?.addEventListener("click", () => finish(true));
        },
        { closeOnOverlayClick: false }
      );
    });
  }

  function scheduleReservationDetailsMarkup(item) {
    const isBlock = item.status === "manual_block";
    const rows = [];
    const notes = [];

    if (isBlock) {
      rows.push(scheduleDetailSheetRowMarkup("Obszar", scheduleServiceLabel(item.service)));
      if (item.service === "hotel") {
        rows.push(scheduleDetailSheetRowMarkup("Termin", `${scheduleFormatCompactDate(item.raw.dateFrom)} - ${scheduleFormatCompactDate(item.raw.dateTo)}`));
        rows.push(scheduleDetailSheetRowMarkup("Pokoje", scheduleRoomLabels(item.raw.roomIds || item.resourceIds || []) || "Wskazane pokoje"));
      } else if (item.service === "restaurant") {
        rows.push(scheduleDetailSheetRowMarkup("Termin", `${scheduleFormatDateTime(item.startMs)} - ${scheduleFormatTime(item.endMs)}`));
        if (!item.raw.cateringDelivery) {
          rows.push(
            scheduleDetailSheetRowMarkup(
              "Przydzielone stoliki",
              item.raw.assignedTablesLabel || scheduleTableLabels(item.raw.assignedTableIds || item.resourceIds || []) || "Wskazane stoliki"
            )
          );
        }
      } else {
        rows.push(scheduleDetailSheetRowMarkup("Sala", item.raw.hallName || "Wybrana sala"));
        rows.push(scheduleDetailSheetRowMarkup("Termin", `${scheduleFormatDateTime(item.startMs)} - ${scheduleFormatTime(item.endMs)}`));
      }
      notes.push(
        scheduleNoteCardMarkup(
          "Notatka dla recepcji",
          item.raw.adminNote || "Ta blokada ogranicza nowe rezerwacje w tym terminie."
        )
      );
      return `
        <div class="schedule-details-view is-block">
          <div class="schedule-details-banner">
            <strong>Blokada terminu</strong>
            <p>Ta pozycja nie odwołuje istniejących rezerwacji. Ogranicza tylko kolejne rezerwacje w wybranym zakresie.</p>
          </div>
          ${scheduleDetailsSheetWrap(rows.join(""))}
          ${notes.join("")}
        </div>
      `;
    }

    rows.push(scheduleDetailSheetRowMarkup("Status", item.statusLabel || scheduleStatusLabel(item.status)));
    rows.push(scheduleDetailSheetCountdownRowMarkup(item));
    if (item.service === "hotel") {
      rows.push(scheduleDetailSheetRowMarkup("Termin", `${scheduleFormatCompactDate(item.raw.dateFrom)} - ${scheduleFormatCompactDate(item.raw.dateTo)}`));
      rows.push(scheduleDetailSheetRowMarkup("Pokoje", scheduleRoomLabels(item.raw.roomIds || item.resourceIds || []) || "—"));
      const totalPrice = Number(item.raw.totalPrice);
      if (Number.isFinite(totalPrice) && totalPrice > 0) {
        rows.push(scheduleDetailSheetRowMarkup("Kwota orientacyjna", `${totalPrice.toFixed(2)} PLN`));
      }
      rows.push(scheduleDetailSheetRowMarkup("Klient", item.raw.customerName || "—"));
      rows.push(scheduleDetailSheetRowMarkup("Telefon", item.raw.phone || "—"));
      rows.push(scheduleDetailSheetRowMarkup("E-mail", item.raw.email || "—"));
    } else if (item.service === "restaurant") {
      rows.push(scheduleDetailSheetRowMarkup("Termin", `${scheduleFormatDateTime(item.startMs)} - ${scheduleFormatTime(item.endMs)}`));
      if (item.raw.cateringDelivery) {
        rows.push(scheduleDetailSheetRowMarkup("Typ", "Dostawa cateringu"));
        const r = item.raw.recipient;
        if (r && typeof r === "object") {
          rows.push(scheduleDetailSheetRowMarkup("Nazwa odbiorcy", r.displayName || "—"));
          const person = [r.contactFirstName, r.contactLastName].filter(Boolean).join(" ");
          if (person) rows.push(scheduleDetailSheetRowMarkup("Osoba kontaktowa", person));
          rows.push(scheduleDetailSheetRowMarkup("E-mail", r.email || "—"));
          const phoneLine = `${r.phonePrefix || ""} ${r.phoneNational || ""}`.trim();
          rows.push(scheduleDetailSheetRowMarkup("Telefon", phoneLine || "—"));
          const streetLine = [r.street, r.buildingNumber].filter(Boolean).join(" ");
          if (streetLine) rows.push(scheduleDetailSheetRowMarkup("Ulica i numer", streetLine));
          const cityLine = [r.postalCode, r.city].filter(Boolean).join(" ");
          if (cityLine) rows.push(scheduleDetailSheetRowMarkup("Kod i miejscowość", cityLine));
          if (r.extraInfo) rows.push(scheduleDetailSheetRowMarkup("Dodatkowe informacje", r.extraInfo));
        } else {
          rows.push(scheduleDetailSheetRowMarkup("Odbiorca", "Brak danych odbiorcy w systemie."));
        }
        rows.push(scheduleDetailSheetRowMarkup("Numer rezerwacji", item.humanNumberLabel || item.raw.humanNumberLabel || "—"));
      } else {
        rows.push(
          scheduleDetailSheetRowMarkup(
            "Przydzielone stoliki",
            item.raw.assignedTablesLabel || scheduleTableLabels(item.raw.assignedTableIds || item.resourceIds || []) || "—"
          )
        );
        const tc = item.raw.tablesCount;
        const gc = item.raw.guestsCount;
        const tablesPart =
          tc !== undefined && tc !== null && String(tc).trim() !== ""
            ? `Stoliki (rezerwacja): ${tc}`
            : "Stoliki (rezerwacja): —";
        const guestsPart =
          gc !== undefined && gc !== null && String(gc).trim() !== "" ? `Goście: ${gc}` : "Goście: —";
        const placePart = `Miejsce: ${scheduleRestaurantPlaceLabel(item.raw.placePreference)}`;
        const joinPart = `Łączenie: ${scheduleBooleanLabel(Boolean(item.raw.joinTables))}`;
        rows.push(scheduleDetailSheetRowMarkup("Parametry rezerwacji", `${tablesPart} · ${guestsPart} · ${placePart} · ${joinPart}`));
        rows.push(scheduleDetailSheetRowMarkup("Klient", item.raw.fullName || "—"));
        rows.push(scheduleDetailSheetRowMarkup("Telefon", item.raw.phone || "—"));
        rows.push(scheduleDetailSheetRowMarkup("E-mail", item.raw.email || "—"));
      }
    } else {
      rows.push(scheduleDetailSheetRowMarkup("Sala", item.raw.hallName || "—"));
      rows.push(scheduleDetailSheetRowMarkup("Termin", `${scheduleFormatDateTime(item.startMs)} - ${scheduleFormatTime(item.endMs)}`));
      rows.push(scheduleDetailSheetRowMarkup("Goście", String(item.raw.guestsCount ?? "—")));
      rows.push(scheduleDetailSheetRowMarkup("Rodzaj wydarzenia", item.raw.eventType || "—"));
      const hallKind = String(item.raw.hallKindSnapshot || "").toLowerCase();
      const exc = scheduleBooleanLabel(Boolean(item.raw.exclusive));
      const fb = scheduleBooleanLabel(Boolean(item.raw.fullBlock));
      if (hallKind === "large") {
        rows.push(scheduleDetailSheetRowMarkup("Warunki sali", `Wyłączność: ${exc} · Pełna blokada: ${fb}`));
      } else {
        rows.push(scheduleDetailSheetRowMarkup("Wyłączność sali", exc));
      }
      rows.push(scheduleDetailSheetRowMarkup("Klient", item.raw.fullName || "—"));
      rows.push(scheduleDetailSheetRowMarkup("Telefon", item.raw.phone || "—"));
      rows.push(scheduleDetailSheetRowMarkup("E-mail", item.raw.email || "—"));
    }

    notes.push(scheduleNoteCardMarkup("Uwagi klienta", item.raw.customerNote || ""));
    notes.push(scheduleNoteCardMarkup("Notatka administratora", item.raw.adminNote || ""));
    return `
      <div class="schedule-details-view">
        ${scheduleDetailsSheetWrap(rows.filter(Boolean).join(""))}
        ${notes.join("")}
      </div>
    `;
  }

  function openScheduleDetailsModal(service, id) {
    const item = scheduleFindItem(service, id);
    if (!item) return;
    const isBlock = item.status === "manual_block";
    const canCancelReservation = scheduleCanCancel(item);
    openScheduleModal(
      `
        <div class="admin-modal-head">
          <div>
            <p class="pill ${scheduleServicePillClass(item.service)}">${escapeHtml(scheduleServiceLabel(item.service))}</p>
            <h3>${isBlock ? "Szczegóły blokady" : "Szczegóły rezerwacji"}</h3>
          </div>
          <div class="schedule-modal-head-actions">
            <button type="button" class="button secondary" data-schedule-details-action="edit">Edytuj</button>
            ${
              isBlock || (canCancelReservation && item.status !== "pending")
                ? `<button type="button" class="button secondary danger-muted${isBlock ? " icon-button" : ""}" data-schedule-details-action="delete" aria-label="${escapeAttribute(
                    isBlock ? "Usuń blokadę" : "Odwołaj rezerwację"
                  )}">${isBlock ? scheduleIconMarkup("trash") : "Odwołaj"}</button>`
                : ""
            }
            <button type="button" class="button secondary icon-button" data-schedule-modal-close aria-label="Zamknij">${scheduleIconMarkup("close")}</button>
          </div>
        </div>
        ${scheduleReservationDetailsMarkup(item)}
        ${
          item.status === "pending"
            ? `
        <div class="admin-modal-footer schedule-modal-footer">
          <div class="schedule-details-footer-actions">
            ${
              canCancelReservation
                ? `<button type="button" class="button secondary danger-muted" data-schedule-details-action="delete">Odwołaj</button>`
                : ""
            }
            <button type="button" class="button secondary" data-schedule-details-action="confirm">Potwierdź</button>
          </div>
        </div>`
            : ""
        }
      `,
      (mount) => {
        mount.querySelectorAll("[data-schedule-details-action]").forEach((button) => {
          button.addEventListener("click", async () => {
            const action = button.dataset.scheduleDetailsAction;
            if (action === "edit") {
              openScheduleEditModal(item);
              return;
            }
            if (action === "confirm") {
              await scheduleConfirmReservation(item.service, item.id);
              closeScheduleModal();
              return;
            }
            if (action === "delete") {
              if (isBlock) {
                if (!window.confirm("Czy na pewno usunąć tę blokadę?")) return;
                await scheduleCancelReservation(item.service, item.id, "", "Blokada została usunięta.");
                closeScheduleModal();
                return;
              }
              openScheduleCancelModal(item.service, item.id);
            }
          });
        });
      }
    );
  }

  function scheduleHotelRoomOptionsMarkup(selectedIds) {
    const chosen = new Set(Array.isArray(selectedIds) ? selectedIds.map((id) => String(id)) : []);
    return `
      <fieldset class="admin-room-fieldset">
        <legend>Pokoje</legend>
        <div class="admin-room-checks">
          ${state.schedule.roomOptions
            .map(
              (room) => `
                <label class="admin-check-line">
                  <input type="checkbox" name="roomIds" value="${escapeAttribute(room.id)}" ${chosen.has(String(room.id)) ? "checked" : ""} />
                  <span>${escapeHtml(room.name || room.id)}</span>
                </label>
              `
            )
            .join("")}
        </div>
      </fieldset>
    `;
  }

  const SCHEDULE_CATERING_WEEKDAYS = [
    { value: 1, label: "Poniedziałek" },
    { value: 2, label: "Wtorek" },
    { value: 3, label: "Środa" },
    { value: 4, label: "Czwartek" },
    { value: 5, label: "Piątek" },
    { value: 6, label: "Sobota" },
    { value: 0, label: "Niedziela" },
  ];
  /** Przy tworzeniu dostawy w grafiku — bez pola w formularzu; edycja wpisu nadal pozwala zmienić czas trwania. */
  const SCHEDULE_CATERING_CREATE_DEFAULT_DURATION_HOURS = 1;

  function scheduleCateringRecipientSelectMarkup(selectedId) {
    const list = Array.isArray(state.schedule.cateringRecipients) ? state.schedule.cateringRecipients : [];
    const sel = String(selectedId || "").trim();
    return `
      <label class="field field-grow">
        <span>Odbiorca</span>
        <select name="recipientId" required>
          <option value="">— Wybierz odbiorcę —</option>
          ${list
            .map(
              (r) =>
                `<option value="${escapeAttribute(r.id)}" ${String(r.id) === sel ? "selected" : ""}>${escapeHtml(
                  r.displayName || r.id
                )}</option>`
            )
            .join("")}
        </select>
      </label>
    `;
  }

  function scheduleCateringNewRecipientFieldsetMarkup() {
    return `
      <fieldset id="catering-new-recipient-fieldset" class="catering-new-recipient-fieldset" hidden disabled>
        <legend>Nowy odbiorca</legend>
        <div class="field-grid">
          <label class="field"><span>Nazwa odbiorcy</span><input name="newRecipientDisplayName" autocomplete="organization" /></label>
          <label class="field"><span>Imię</span><input name="newRecipientFirstName" autocomplete="given-name" /></label>
          <label class="field"><span>Nazwisko</span><input name="newRecipientLastName" autocomplete="family-name" /></label>
          <label class="field"><span>E-mail</span><input name="newRecipientEmail" type="email" autocomplete="email" /></label>
          <label class="field"><span>Prefiks tel.</span><input name="newRecipientPhonePrefix" value="+48" /></label>
          <label class="field"><span>Numer telefonu</span><input name="newRecipientPhoneNational" autocomplete="tel-national" /></label>
          <label class="field"><span>Ulica</span><input name="newRecipientStreet" autocomplete="street-address" /></label>
          <label class="field"><span>Nr budynku / lokalu</span><input name="newRecipientBuilding" /></label>
          <label class="field"><span>Kod pocztowy</span><input name="newRecipientPostalCode" autocomplete="postal-code" /></label>
          <label class="field"><span>Miasto</span><input name="newRecipientCity" autocomplete="address-level2" /></label>
          <label class="field-full"><span>Dodatkowe informacje</span><textarea name="newRecipientExtra" rows="2"></textarea></label>
        </div>
        <div class="field-row-btns">
          <button type="button" class="button secondary" data-schedule-cancel-new-catering-recipient>Anuluj</button>
          <button type="button" class="button" data-schedule-save-new-catering-recipient>Zapisz odbiorcę</button>
        </div>
      </fieldset>
    `;
  }

  async function scheduleSaveNewCateringRecipientFromFieldset(fieldset) {
    if (!fieldset) return null;
    const q = (name) => String(fieldset.querySelector(`[name="${name}"]`)?.value || "").trim();
    const body = {
      displayName: q("newRecipientDisplayName"),
      contactFirstName: q("newRecipientFirstName"),
      contactLastName: q("newRecipientLastName"),
      email: q("newRecipientEmail"),
      phonePrefix: q("newRecipientPhonePrefix") || "+48",
      phoneNational: q("newRecipientPhoneNational"),
      street: q("newRecipientStreet"),
      buildingNumber: q("newRecipientBuilding"),
      postalCode: q("newRecipientPostalCode"),
      city: q("newRecipientCity"),
      extraInfo: q("newRecipientExtra"),
    };
    const res = await bookingAdminApi("restaurant", "admin-catering-recipient-save", { method: "PUT", body });
    const rec = res && res.recipient;
    if (!rec || !rec.id) {
      throw new Error((res && res.error) || "Nie udało się zapisać odbiorcy.");
    }
    const list = Array.isArray(state.schedule.cateringRecipients) ? state.schedule.cateringRecipients : [];
    const next = [...list.filter((x) => String(x.id) !== String(rec.id)), rec];
    next.sort((a, b) =>
      String(a.displayName || a.id || "").localeCompare(String(b.displayName || b.id || ""), "pl", {
        sensitivity: "base",
      })
    );
    state.schedule.cateringRecipients = next;
    return rec;
  }

  function scheduleWireCateringRecipientInlinePanel(mount) {
    const fs = mount.querySelector("#catering-new-recipient-fieldset");
    const select = mount.querySelector('select[name="recipientId"]');
    mount.querySelector("[data-schedule-add-catering-recipient]")?.addEventListener("click", () => {
      if (!fs) return;
      fs.hidden = false;
      fs.disabled = false;
    });
    mount.querySelector("[data-schedule-cancel-new-catering-recipient]")?.addEventListener("click", () => {
      if (!fs) return;
      fs.hidden = true;
      fs.disabled = true;
    });
    mount.querySelector("[data-schedule-save-new-catering-recipient]")?.addEventListener("click", async () => {
      try {
        const rec = await scheduleSaveNewCateringRecipientFromFieldset(fs);
        if (select && rec) {
          const exists = Array.from(select.options).some((o) => String(o.value) === String(rec.id));
          if (!exists) {
            const opt = document.createElement("option");
            opt.value = rec.id;
            opt.textContent = rec.displayName || rec.id;
            select.appendChild(opt);
          }
          select.value = String(rec.id);
        }
        if (fs) {
          fs.hidden = true;
          fs.disabled = true;
        }
      } catch (error) {
        window.alert(error.message || "Nie udało się zapisać odbiorcy.");
      }
    });
  }

  function scheduleHallOptionsMarkup(selectedHallId) {
    const current = String(selectedHallId || "");
    return `
      <label class="field">
        <span>Sala</span>
        <select name="hallId" required data-schedule-hall-select>
          ${state.schedule.hallOptions
            .map(
              (hall) =>
                `<option value="${escapeAttribute(hall.id)}" ${current === String(hall.id) ? "selected" : ""}>${escapeHtml(hall.name || hall.id)}</option>`
            )
            .join("")}
        </select>
      </label>
    `;
  }

  function scheduleSelectedHall(selectedHallId) {
    const current = String(selectedHallId || "");
    return state.schedule.hallOptions.find((hall) => String(hall.id) === current) || state.schedule.hallOptions[0] || null;
  }

  function scheduleHallIsSmall(selectedHallId) {
    return String(scheduleSelectedHall(selectedHallId)?.hallKind || "").toLowerCase() === "small";
  }

  function scheduleHallExclusiveFieldMarkup(selectedHallId, selectedValue = "0") {
    if (scheduleHallIsSmall(selectedHallId)) {
      return "";
    }
    return `<label class="field"><span>Na wyłączność</span><select name="exclusive"><option value="0" ${
      String(selectedValue) === "1" ? "" : "selected"
    }>Nie</option><option value="1" ${String(selectedValue) === "1" ? "selected" : ""}>Tak</option></select></label>`;
  }

  function openScheduleEditModal(item) {
    if (!item) return;
    const isBlock = item.status === "manual_block";
    const title =
      isBlock ? "Edycja blokady"
      : item.service === "restaurant" ? "Edycja dostawy cateringu"
      : "Edycja rezerwacji";
    const raw = item.raw || {};
    let fieldsMarkup = "";

    if (isBlock) {
      fieldsMarkup = `
        <label class="field-full">
          <span>Notatka administratora</span>
          <textarea name="adminNote">${escapeHtml(raw.adminNote || "")}</textarea>
        </label>
      `;
    } else if (item.service === "hotel") {
      fieldsMarkup = `
        <div class="field-grid">
          <label class="field"><span>Przyjazd</span><input type="date" name="dateFrom" value="${escapeAttribute(raw.dateFrom || "")}" required /></label>
          <label class="field"><span>Wyjazd</span><input type="date" name="dateTo" value="${escapeAttribute(raw.dateTo || "")}" required /></label>
        </div>
        ${scheduleHotelRoomOptionsMarkup(raw.roomIds || [])}
        <div class="field-grid">
          <label class="field"><span>Imię i nazwisko</span><input name="fullName" value="${escapeAttribute(raw.customerName || "")}" required /></label>
          <label class="field"><span>E-mail</span><input name="email" type="email" value="${escapeAttribute(raw.email || "")}" required /></label>
          <label class="field"><span>Prefiks</span><input name="phonePrefix" value="${escapeAttribute(raw.phonePrefix || "+48")}" required /></label>
          <label class="field"><span>Numer telefonu</span><input name="phoneNational" value="${escapeAttribute(raw.phoneNational || "")}" required /></label>
          <label class="field-full"><span>Uwagi klienta</span><textarea name="customerNote">${escapeHtml(raw.customerNote || "")}</textarea></label>
          <label class="field-full"><span>Notatka administratora</span><textarea name="adminNote">${escapeHtml(raw.adminNote || "")}</textarea></label>
        </div>
      `;
    } else if (item.service === "restaurant") {
      fieldsMarkup = `
        <div class="field-grid">
          <label class="field"><span>Data</span><input type="date" name="reservationDate" value="${escapeAttribute(raw.reservationDate || "")}" required /></label>
          <label class="field"><span>Godzina</span><input type="time" name="startTime" min="00:00" max="23:59" step="60" value="${escapeAttribute(raw.startTime || "")}" required /></label>
          <label class="field"><span>Czas trwania (h)</span><input type="number" step="0.5" min="0.5" name="durationHours" value="${escapeAttribute(String(raw.durationHours || 1))}" required /></label>
        </div>
        <div class="field-grid schedule-catering-recipient-line">
          ${scheduleCateringRecipientSelectMarkup(raw.recipientId || raw.recipient?.id || "")}
          <label class="field schedule-catering-add-recipient-wrap">
            <span class="helper"> </span>
            <button type="button" class="button secondary" data-schedule-add-catering-recipient>Dodaj odbiorcę</button>
          </label>
        </div>
        ${scheduleCateringNewRecipientFieldsetMarkup()}
        <label class="field-full"><span>Opis</span><textarea name="customerNote">${escapeHtml(raw.customerNote || "")}</textarea></label>
        <label class="field-full"><span>Notatka administratora</span><textarea name="adminNote">${escapeHtml(raw.adminNote || "")}</textarea></label>
      `;
    } else {
      fieldsMarkup = `
        <div class="field-grid">
          ${scheduleHallOptionsMarkup(raw.hallId || "")}
          <label class="field"><span>Data</span><input type="date" name="reservationDate" value="${escapeAttribute(raw.reservationDate || "")}" required /></label>
          <label class="field"><span>Start</span><input type="time" name="startTime" min="00:00" max="23:30" step="1800" value="${escapeAttribute(raw.startTime || "")}" required /></label>
          <label class="field"><span>Czas (h)</span><input type="number" step="0.5" min="0.5" name="durationHours" value="${escapeAttribute(String(raw.durationHours || 2))}" required /></label>
          <label class="field"><span>Liczba gości</span><input type="number" min="0" name="guestsCount" value="${escapeAttribute(String(raw.guestsCount || 0))}" required /></label>
          ${scheduleHallExclusiveFieldMarkup(raw.hallId || "", raw.exclusive ? "1" : "0")}
          <label class="field"><span>Typ wydarzenia</span><input name="eventType" value="${escapeAttribute(raw.eventType || "")}" /></label>
          <label class="field"><span>Imię i nazwisko</span><input name="fullName" value="${escapeAttribute(raw.fullName || "")}" required /></label>
          <label class="field"><span>E-mail</span><input name="email" type="email" value="${escapeAttribute(raw.email || "")}" required /></label>
          <label class="field"><span>Prefiks</span><input name="phonePrefix" value="${escapeAttribute(raw.phonePrefix || "+48")}" required /></label>
          <label class="field"><span>Numer telefonu</span><input name="phoneNational" value="${escapeAttribute(raw.phoneNational || "")}" required /></label>
          <label class="field-full"><span>Uwagi klienta</span><textarea name="customerNote">${escapeHtml(raw.customerNote || "")}</textarea></label>
          <label class="field-full"><span>Notatka administratora</span><textarea name="adminNote">${escapeHtml(raw.adminNote || "")}</textarea></label>
        </div>
      `;
    }

    openScheduleModal(
      `
        <form class="stack" id="schedule-edit-form">
          <div class="admin-modal-head">
            <div>
              <p class="pill ${scheduleServicePillClass(item.service)}">${escapeHtml(scheduleServiceLabel(item.service))}</p>
              <h3>${escapeHtml(title)}</h3>
            </div>
            <button type="button" class="button secondary" data-schedule-modal-close>Zamknij</button>
          </div>
          ${fieldsMarkup}
          ${
            isBlock || item.service === "restaurant"
              ? ""
              : `
          <label class="checkbox-field">
            <input type="checkbox" name="notifyClient" />
            <span class="checkbox-copy">
              <strong>Powiadom klienta e-mailem o zmianie</strong>
              <span>Działa, gdy klient ma zapisany adres e-mail.</span>
            </span>
          </label>
          `
          }
          <div class="admin-modal-footer">
            <button type="button" class="button secondary" data-schedule-modal-close>Anuluj</button>
            <button type="submit" class="button">Zapisz</button>
          </div>
        </form>
      `,
      (mount) => {
        if (item.service === "restaurant" && !isBlock) {
          scheduleWireCateringRecipientInlinePanel(mount);
        }
        mount.querySelector("#schedule-edit-form")?.addEventListener("submit", async (event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          const body = {
            id: item.id,
            notifyClient: item.service === "restaurant" ? false : formData.get("notifyClient") === "on",
          };
          if (isBlock) {
            body.adminNote = String(formData.get("adminNote") || "");
          } else if (item.service === "hotel") {
            body.dateFrom = formData.get("dateFrom");
            body.dateTo = formData.get("dateTo");
            body.roomIds = formData.getAll("roomIds");
            body.fullName = formData.get("fullName");
            body.email = formData.get("email");
            body.phonePrefix = formData.get("phonePrefix");
            body.phoneNational = formData.get("phoneNational");
            body.customerNote = formData.get("customerNote") || "";
            body.adminNote = formData.get("adminNote") || "";
          } else if (item.service === "restaurant") {
            body.reservationDate = formData.get("reservationDate");
            body.startTime = formData.get("startTime");
            body.durationHours = Number(formData.get("durationHours") || 0);
            body.recipientId = String(formData.get("recipientId") || "").trim();
            if (!body.recipientId) {
              throw new Error("Wybierz odbiorcę.");
            }
            if (!Number.isFinite(body.durationHours) || body.durationHours <= 0) {
              throw new Error("Podaj poprawny czas trwania (w godzinach).");
            }
            body.customerNote = formData.get("customerNote") || "";
            body.adminNote = formData.get("adminNote") || "";
          } else {
            body.hallId = formData.get("hallId");
            body.reservationDate = formData.get("reservationDate");
            body.startTime = formData.get("startTime");
            body.durationHours = Number(formData.get("durationHours") || 0);
            body.guestsCount = Number(formData.get("guestsCount") || 0);
            body.exclusive = scheduleHallIsSmall(formData.get("hallId")) ? true : formData.get("exclusive") === "1";
            body.eventType = formData.get("eventType") || "";
            body.fullName = formData.get("fullName");
            body.email = formData.get("email");
            body.phonePrefix = formData.get("phonePrefix");
            body.phoneNational = formData.get("phoneNational");
            body.customerNote = formData.get("customerNote") || "";
            body.adminNote = formData.get("adminNote") || "";
          }
          try {
            await bookingAdminApi(item.service, "admin-reservation-update", { method: "PATCH", body });
            closeScheduleModal();
            await loadScheduleData({ silent: true });
            renderSchedulePanel("Zmiany zostały zapisane.");
          } catch (error) {
            window.alert(error.message || "Nie udało się zapisać zmian.");
          }
        });
      },
      { closeOnOverlayClick: false }
    );
  }

  function scheduleBlockOverlapItems(service, startMs, endMs, resourceIds = []) {
    const selectedResources = new Set(resourceIds.map((value) => String(value)));
    return state.schedule.items.filter((item) => {
      if (item.service !== service) return false;
      if (!scheduleRangesOverlap(startMs, endMs, item.startMs, item.endMs)) return false;
      if (service === "hall") {
        return item.resourceIds.some((resourceId) => selectedResources.has(String(resourceId)));
      }
      if (!selectedResources.size) return true;
      return item.resourceIds.some((resourceId) => selectedResources.has(String(resourceId)));
    });
  }

  function openScheduleCreateModal(defaultDate) {
    const model = {
      service: "",
      mode: "reservation",
      date: String(defaultDate || getTodayIsoDate()).slice(0, 10),
      hallId: String(state.schedule.hallOptions[0]?.id || ""),
    };

    const renderContent = () => {
      if (!model.service) {
        return `
          <div class="admin-modal-head">
            <div>
              <p class="pill">Nowy wpis</p>
              <h3>Wybierz obszar rezerwacji</h3>
            </div>
            <button type="button" class="button secondary" data-schedule-modal-close>Zamknij</button>
          </div>
          <div class="schedule-create-services">
            <button type="button" class="schedule-create-service" data-create-service="hotel"><strong>Hotel</strong><span>Pokoje i pobyty.</span></button>
            <button type="button" class="schedule-create-service" data-create-service="restaurant"><strong>Catering</strong><span>Dostawy do odbiorców (terminy i powtórzenia).</span></button>
            <button type="button" class="schedule-create-service" data-create-service="hall"><strong>Przyjęcia</strong><span>Sale i wydarzenia.</span></button>
          </div>
        `;
      }

      const isHotel = model.service === "hotel";
      const isRestaurant = model.service === "restaurant";
      const isHall = model.service === "hall";

      let fields = "";
      if (isHotel) {
        fields =
          model.mode === "block"
            ? `
              <div class="field-grid">
                <label class="field"><span>Od</span><input type="date" name="dateFrom" value="${escapeAttribute(model.date)}" required /></label>
                <label class="field"><span>Do</span><input type="date" name="dateTo" value="${escapeAttribute(scheduleAddDays(model.date, 1))}" required /></label>
              </div>
              ${scheduleHotelRoomOptionsMarkup([])}
              <label class="field-full"><span>Notatka blokady</span><textarea name="note"></textarea></label>
            `
            : `
              <div class="field-grid">
                <label class="field"><span>Przyjazd</span><input type="date" name="dateFrom" value="${escapeAttribute(model.date)}" required /></label>
                <label class="field"><span>Wyjazd</span><input type="date" name="dateTo" value="${escapeAttribute(scheduleAddDays(model.date, 1))}" required /></label>
              </div>
              ${scheduleHotelRoomOptionsMarkup([])}
              <div class="field-grid">
                <label class="field"><span>Imię i nazwisko</span><input name="fullName" required /></label>
                <label class="field"><span>E-mail</span><input name="email" type="email" /></label>
                <label class="field"><span>Prefiks</span><input name="phonePrefix" value="+48" /></label>
                <label class="field"><span>Numer telefonu</span><input name="phoneNational" /></label>
                <label class="field-full"><span>Uwagi klienta</span><textarea name="customerNote"></textarea></label>
              </div>
            `;
      } else if (isRestaurant) {
        fields = `
              <div class="field-grid">
                <label class="field"><span>Data pierwszej dostawy</span><input type="date" name="reservationDate" value="${escapeAttribute(model.date)}" required /></label>
                <label class="field"><span>Godzina</span><input type="time" name="startTime" min="00:00" max="23:59" step="60" value="12:00" required /></label>
              </div>
              <div class="field-grid schedule-catering-recipient-line">
                ${scheduleCateringRecipientSelectMarkup("")}
                <label class="field schedule-catering-add-recipient-wrap">
                  <span class="helper"> </span>
                  <button type="button" class="button secondary" data-schedule-add-catering-recipient>Dodaj odbiorcę</button>
                </label>
              </div>
              ${scheduleCateringNewRecipientFieldsetMarkup()}
              <label class="field-full"><span>Opis</span><textarea name="description" rows="3" placeholder="Treść zamówienia, uwagi do dowozu…"></textarea></label>
              <label class="field-full"><span>Notatka administratora</span><textarea name="adminNoteCreate" rows="2"></textarea></label>
              <label class="field">
                <span>Powtarzanie</span>
                <select name="repeatMode" data-catering-repeat-mode>
                  <option value="none" selected>Jednorazowo</option>
                  <option value="selected_days">W wybrane dni tygodnia</option>
                  <option value="weekly">Co tydzień</option>
                  <option value="biweekly">Co dwa tygodnie</option>
                  <option value="monthly">Co miesiąc</option>
                </select>
              </label>
              <p class="helper" data-catering-repeat-hint-none>
                Jedna dostawa w wybranej dacie i godzinie.
              </p>
              <p class="helper" data-catering-repeat-hint-repeat hidden>
                <strong>Co tydzień / co dwa tygodnie / co miesiąc:</strong> pierwszy termin to data powyżej; kolejne według cyklu aż do daty końca (włącznie). W trybie <strong>bezterminowym</strong> od razu powstaje ok. rok terminów; kolejne uzupełnia automatycznie harmonogram serwera (cron), z wyprzedzeniem ok. roku — bez limitu 5 lat.<br />
                <strong>W wybrane dni:</strong> zaznacz dni tygodnia; pierwsze możliwe terminy liczone są od daty pierwszej dostawy.
              </p>
              <fieldset class="schedule-catering-weekdays-fieldset" data-catering-repeat-weekdays hidden>
                <legend>Dni tygodnia (wiele opcji)</legend>
                <div class="schedule-catering-weekday-grid">
                  ${SCHEDULE_CATERING_WEEKDAYS.map(
                    ({ value, label }) => `
                    <label class="schedule-catering-weekday-item">
                      <input type="checkbox" name="repeatWeekdays" value="${String(value)}" />
                      <span>${escapeHtml(label)}</span>
                    </label>
                  `
                  ).join("")}
                </div>
              </fieldset>
              <div class="stack" data-catering-repeat-end-fields hidden>
                <label class="field field-checkbox">
                  <span>
                    <input type="checkbox" name="repeatIndefinite" value="1" data-catering-repeat-indefinite />
                    Bezterminowo
                  </span>
                </label>
                <label class="field">
                  <span>Do dnia (włącznie)</span>
                  <input type="date" name="repeatUntil" data-catering-repeat-until-input value="${escapeAttribute(model.date)}" />
                </label>
              </div>
        `;
      } else if (isHall) {
        fields =
          model.mode === "block"
            ? `
              <div class="field-grid">
                ${scheduleHallOptionsMarkup(model.hallId || state.schedule.hallOptions[0]?.id || "")}
                <label class="field"><span>Data</span><input type="date" name="reservationDate" value="${escapeAttribute(model.date)}" required /></label>
                <label class="field"><span>Start</span><input type="time" name="startTime" min="00:00" max="23:30" step="1800" value="12:00" required /></label>
                <label class="field"><span>Czas (h)</span><input type="number" step="0.5" min="0.5" name="durationHours" value="3" required /></label>
              </div>
              <label class="field-full"><span>Notatka blokady</span><textarea name="note"></textarea></label>
            `
            : `
              <div class="field-grid">
                ${scheduleHallOptionsMarkup(model.hallId || state.schedule.hallOptions[0]?.id || "")}
                <label class="field"><span>Data</span><input type="date" name="reservationDate" value="${escapeAttribute(model.date)}" required /></label>
                <label class="field"><span>Start</span><input type="time" name="startTime" min="00:00" max="23:30" step="1800" value="12:00" required /></label>
                <label class="field"><span>Czas (h)</span><input type="number" step="0.5" min="0.5" name="durationHours" value="3" required /></label>
                <label class="field"><span>Liczba gości</span><input type="number" min="1" name="guestsCount" value="40" required /></label>
                ${scheduleHallExclusiveFieldMarkup(model.hallId || state.schedule.hallOptions[0]?.id || "", "0")}
                <label class="field"><span>Rodzaj wydarzenia</span><input name="eventType" value="Wydarzenie" /></label>
                <label class="field"><span>Imię i nazwisko</span><input name="fullName" required /></label>
                <label class="field"><span>E-mail</span><input name="email" type="email" /></label>
                <label class="field"><span>Prefiks</span><input name="phonePrefix" value="+48" /></label>
                <label class="field"><span>Numer telefonu</span><input name="phoneNational" /></label>
                <label class="field-full"><span>Uwagi klienta</span><textarea name="customerNote"></textarea></label>
              </div>
            `;
      }

      return `
        <form class="stack" id="schedule-create-form">
          <div class="admin-modal-head">
            <div>
              <p class="pill ${scheduleServicePillClass(model.service)}">${escapeHtml(scheduleServiceLabel(model.service))}</p>
              <h3>${
                model.service === "restaurant"
                  ? "Nowa dostawa cateringu"
                  : model.mode === "block"
                    ? "Nowa blokada"
                    : "Nowa rezerwacja"
              }</h3>
            </div>
            <button type="button" class="button secondary" data-schedule-modal-close>Zamknij</button>
          </div>
          <div class="schedule-create-mode-switch">
            <button type="button" class="button secondary" data-create-back>← Zmień obszar</button>
            <button type="button" class="button ${model.mode === "reservation" ? "" : "secondary"}" data-create-mode="reservation">Rezerwacja</button>
            ${
              model.service === "restaurant"
                ? ""
                : `<button type="button" class="button ${model.mode === "block" ? "" : "secondary"}" data-create-mode="block">Blokada</button>`
            }
          </div>
          ${
            model.mode === "block" && model.service !== "restaurant"
              ? '<p class="helper schedule-block-helper">Blokada nie usuwa istniejących rezerwacji i działa tylko na kolejne próby rezerwacji.</p>'
              : ""
          }
          ${fields}
          <div class="admin-modal-footer">
            <button type="button" class="button secondary" data-schedule-modal-close>Anuluj</button>
            <button type="submit" class="button">Utwórz</button>
          </div>
        </form>
      `;
    };

    const attachEvents = (mount) => {
      mount.querySelectorAll("[data-schedule-modal-close]").forEach((button) => {
        button.addEventListener("click", closeScheduleModal);
      });
      mount.querySelectorAll("[data-create-service]").forEach((button) => {
        button.addEventListener("click", () => {
          model.service = button.dataset.createService;
          if (model.service === "restaurant") {
            model.mode = "reservation";
          }
          rerender();
        });
      });
      mount.querySelectorAll("[data-create-mode]").forEach((button) => {
        button.addEventListener("click", () => {
          model.mode = button.dataset.createMode;
          rerender();
        });
      });
      mount.querySelector("[data-create-back]")?.addEventListener("click", () => {
        model.service = "";
        rerender();
      });
      mount.querySelector("[data-schedule-hall-select]")?.addEventListener("change", (event) => {
        model.hallId = String(event.currentTarget?.value || "");
        rerender();
      });
      const syncCateringRepeatUi = () => {
        const select = mount.querySelector("[data-catering-repeat-mode]");
        const mode = String(select?.value || "none");
        const none = mode === "none";
        mount.querySelector("[data-catering-repeat-end-fields]")?.toggleAttribute("hidden", none);
        mount.querySelector("[data-catering-repeat-weekdays]")?.toggleAttribute("hidden", mode !== "selected_days");
        mount.querySelector("[data-catering-repeat-hint-none]")?.toggleAttribute("hidden", !none);
        mount.querySelector("[data-catering-repeat-hint-repeat]")?.toggleAttribute("hidden", none);
        const untilInput = mount.querySelector("[data-catering-repeat-until-input]");
        const indef = mount.querySelector("[data-catering-repeat-indefinite]");
        if (untilInput) {
          if (none) {
            untilInput.removeAttribute("required");
            untilInput.disabled = false;
          } else {
            const dis = Boolean(indef?.checked);
            untilInput.disabled = dis;
            if (dis) untilInput.removeAttribute("required");
            else untilInput.setAttribute("required", "required");
          }
        }
      };
      mount.querySelector("[data-catering-repeat-mode]")?.addEventListener("change", () => syncCateringRepeatUi());
      mount.querySelector("[data-catering-repeat-indefinite]")?.addEventListener("change", () => syncCateringRepeatUi());
      syncCateringRepeatUi();
      if (model.service === "restaurant" && model.mode === "reservation") {
        scheduleWireCateringRecipientInlinePanel(mount);
      }
      mount.querySelector("#schedule-create-form")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        try {
          let createSuccessMessage = "Nowy wpis został utworzony.";
          let afterCreateEmailPrompt = null;
          if (model.service === "hotel") {
            if (model.mode === "block") {
              const dateFrom = String(formData.get("dateFrom") || "");
              const dateTo = String(formData.get("dateTo") || "");
              const roomIds = formData.getAll("roomIds").map((value) => String(value));
              if (!roomIds.length) throw new Error("Wybierz co najmniej jeden pokój do blokady.");
              const overlapItems = scheduleBlockOverlapItems(
                "hotel",
                scheduleYmdToDate(dateFrom).getTime(),
                scheduleYmdToDate(dateTo).getTime(),
                roomIds
              );
              if (overlapItems.length) {
                const accepted = window.confirm(scheduleOverlapWarningMessage(overlapItems));
                if (!accepted) return;
              }
              await bookingAdminApi("hotel", "admin-manual-block", {
                method: "POST",
                body: { dateFrom, dateTo, roomIds, note: String(formData.get("note") || "") },
              });
            } else {
              const emailTrim = String(formData.get("email") || "").trim();
              const createdHotel = await bookingAdminApi("hotel", "admin-reservation-create", {
                method: "POST",
                body: {
                  dateFrom: formData.get("dateFrom"),
                  dateTo: formData.get("dateTo"),
                  roomIds: formData.getAll("roomIds"),
                  fullName: formData.get("fullName"),
                  email: emailTrim,
                  phonePrefix: String(formData.get("phoneNational") || "").trim()
                    ? String(formData.get("phonePrefix") || "+48").trim()
                    : "",
                  phoneNational: String(formData.get("phoneNational") || "").trim(),
                  customerNote: formData.get("customerNote") || "",
                  adminNote: "",
                  status: "confirmed",
                },
              });
              const newHotelId = String(createdHotel?.reservationId || "").trim();
              if (newHotelId && emailTrim.includes("@")) {
                afterCreateEmailPrompt = {
                  kind: "confirm",
                  service: "hotel",
                  reservationId: newHotelId,
                };
              }
            }
          } else if (model.service === "restaurant") {
            const recipientId = String(formData.get("recipientId") || "").trim();
            if (!recipientId) {
              throw new Error("Wybierz odbiorcę lub dodaj nowego.");
            }
            const durationHours = SCHEDULE_CATERING_CREATE_DEFAULT_DURATION_HOURS;
            const repeatMode = String(formData.get("repeatMode") || "none");
            const repeatIndefinite = formData.get("repeatIndefinite") === "1";
            const repeatUntilRaw = String(formData.get("repeatUntil") || "").trim();
            const repeatWeekdays = formData
              .getAll("repeatWeekdays")
              .map((x) => Number(x))
              .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
            if (repeatMode === "selected_days" && !repeatWeekdays.length) {
              throw new Error("Wybierz co najmniej jeden dzień tygodnia albo zmień tryb powtarzania.");
            }
            if (repeatMode !== "none" && !repeatIndefinite && !repeatUntilRaw) {
              throw new Error("Podaj datę końca powtarzania albo zaznacz „bezterminowo”.");
            }
            const createdOut = await bookingAdminApi("restaurant", "admin-catering-delivery-create", {
              method: "POST",
              body: {
                recipientId,
                reservationDate: formData.get("reservationDate"),
                startTime: formData.get("startTime"),
                durationHours,
                description: String(formData.get("description") || "").trim(),
                adminNote: String(formData.get("adminNoteCreate") || "").trim(),
                repeatMode,
                repeatIndefinite,
                repeatUntil: repeatIndefinite ? undefined : repeatUntilRaw || undefined,
                repeatWeekdays: repeatMode === "selected_days" ? repeatWeekdays : undefined,
                status: "confirmed",
                sendManualCreatedEmail: false,
              },
            });
            const cnt = Number(createdOut?.count);
            if (Number.isFinite(cnt) && cnt > 1) {
              createSuccessMessage = `Utworzono ${cnt} terminów dostawy cateringu.`;
            }
            const cateringIds = Array.isArray(createdOut?.reservationIds)
              ? createdOut.reservationIds.map((x) => String(x || "").trim()).filter(Boolean)
              : [];
            const rec = (state.schedule.cateringRecipients || []).find((r) => r.id === recipientId);
            const recipientEmail = String(rec?.email || "").trim();
            if (cateringIds.length && recipientEmail.includes("@")) {
              afterCreateEmailPrompt = {
                kind: "catering_confirmed",
                reservationIds: cateringIds,
                cateringMailMeta: {
                  repeatMode,
                  repeatWeekdays: repeatMode === "selected_days" ? repeatWeekdays : [],
                  repeatIndefinite,
                  repeatUntil: repeatIndefinite ? "" : repeatUntilRaw,
                },
              };
            }
          } else if (model.service === "hall") {
            if (model.mode === "block") {
              const reservationDate = String(formData.get("reservationDate") || "");
              const startTime = String(formData.get("startTime") || "");
              const durationHours = Number(formData.get("durationHours") || 0);
              const hallId = String(formData.get("hallId") || "");
              const startMs = new Date(`${reservationDate}T${startTime}:00`).getTime();
              const endMs = startMs + durationHours * 60 * 60 * 1000;
              const overlapItems = scheduleBlockOverlapItems("hall", startMs, endMs, [hallId]);
              if (overlapItems.length) {
                const accepted = window.confirm(scheduleOverlapWarningMessage(overlapItems));
                if (!accepted) return;
              }
              await bookingAdminApi("hall", "admin-reservation-create", {
                method: "POST",
                body: {
                  hallId,
                  reservationDate,
                  startTime,
                  durationHours,
                  guestsCount: 0,
                  exclusive: true,
                  eventType: "Blokada",
                  fullName: "Blokada terminu",
                  email: firebase.auth().currentUser?.email || "noreply@local",
                  phonePrefix: "+48",
                  phoneNational: "000000000",
                  customerNote: "",
                  adminNote: String(formData.get("note") || ""),
                  status: "manual_block",
                },
              });
            } else {
              const emailTrimHall = String(formData.get("email") || "").trim();
              const createdHall = await bookingAdminApi("hall", "admin-reservation-create", {
                method: "POST",
                body: {
                  hallId: formData.get("hallId"),
                  reservationDate: formData.get("reservationDate"),
                  startTime: formData.get("startTime"),
                  durationHours: Number(formData.get("durationHours") || 0),
                  guestsCount: Number(formData.get("guestsCount") || 0),
                  exclusive: scheduleHallIsSmall(formData.get("hallId")) ? true : formData.get("exclusive") === "1",
                  eventType: formData.get("eventType") || "Wydarzenie",
                  fullName: formData.get("fullName"),
                  email: emailTrimHall,
                  phonePrefix: String(formData.get("phoneNational") || "").trim()
                    ? String(formData.get("phonePrefix") || "+48").trim()
                    : "",
                  phoneNational: String(formData.get("phoneNational") || "").trim(),
                  customerNote: formData.get("customerNote") || "",
                  adminNote: "",
                  status: "confirmed",
                },
              });
              const newHallId = String(createdHall?.reservationId || "").trim();
              if (newHallId && emailTrimHall.includes("@")) {
                afterCreateEmailPrompt = {
                  kind: "confirm",
                  service: "hall",
                  reservationId: newHallId,
                };
              }
            }
          }

          closeScheduleModal();
          await loadScheduleData({ silent: true });
          let finalPanelMessage = createSuccessMessage;
          if (afterCreateEmailPrompt) {
            const sendIt = await openScheduleYesNoModal(
              "Czy wysłać wiadomość e-mail do klienta o utworzeniu rezerwacji?"
            );
            if (sendIt) {
              try {
                if (afterCreateEmailPrompt.kind === "confirm") {
                  await bookingAdminApi(afterCreateEmailPrompt.service, "admin-reservation-confirm", {
                    method: "POST",
                    body: { id: afterCreateEmailPrompt.reservationId },
                  });
                } else if (afterCreateEmailPrompt.kind === "catering_confirmed") {
                  const m = afterCreateEmailPrompt.cateringMailMeta || {};
                  await bookingAdminApi("restaurant", "admin-catering-delivery-notify-confirmed", {
                    method: "POST",
                    body: {
                      reservationIds: afterCreateEmailPrompt.reservationIds,
                      repeatMode: m.repeatMode,
                      repeatWeekdays: m.repeatWeekdays,
                      repeatIndefinite: m.repeatIndefinite,
                      repeatUntil: m.repeatUntil,
                    },
                  });
                }
                finalPanelMessage = `${createSuccessMessage} Wysłano wiadomość e-mail z potwierdzeniem do klienta.`;
              } catch (mailErr) {
                window.alert(mailErr.message || "Nie udało się wysłać wiadomości e-mail do klienta.");
              }
            }
          }
          renderSchedulePanel(finalPanelMessage);
        } catch (error) {
          window.alert(error.message || "Nie udało się utworzyć wpisu.");
        }
      });
    };

    const rerender = () => {
      const mount = document.querySelector("#schedule-modal-mount");
      if (!mount) return;
      mount.querySelector(".schedule-modal").innerHTML = renderContent();
      attachEvents(mount);
    };

    openScheduleModal(renderContent(), attachEvents, { closeOnOverlayClick: false });
    if (
      (!state.schedule.roomOptions.length || !state.schedule.hallOptions.length) &&
      !state.schedule.isLoading
    ) {
      loadScheduleData({ silent: true }).then(() => {
        rerender();
      });
    }
  }

  function mapFirebaseError(err) {
    const code = err?.code || "";
    if (code === "auth/invalid-email") {
      return "Nieprawidlowy adres e-mail.";
    }
    if (code === "auth/user-disabled") {
      return "To konto zostalo wylaczone.";
    }
    if (
      code === "auth/user-not-found" ||
      code === "auth/wrong-password" ||
      code === "auth/invalid-credential"
    ) {
      return "Nieprawidlowy e-mail lub haslo.";
    }
    if (code === "auth/too-many-requests") {
      return "Zbyt wiele prob logowania. Sprobuj pozniej.";
    }
    if (code === "auth/network-request-failed") {
      return "Brak polaczenia z Firebase. Sprawdz siec.";
    }
    return err?.message || "Logowanie nie powiodlo sie.";
  }

  function renderLogin(errorMessage = "") {
    app.innerHTML = `
      <div class="login-wrap">
        <div class="login-card">
          <img src="../ikony/logo.png" alt="Logo" width="84" height="84" />
          <p class="pill">Panel administratora</p>
          <h1>Logowanie do zarzadzania obiektem</h1>
          <p>Po zalogowaniu mozesz edytowac tresci, galerie, dokumenty, terminy sal i obslugiwac zgloszenia.</p>
          <form id="login-form" class="stack">
            <label class="field-full">
              <span>E-mail</span>
              <input name="email" type="email" autocomplete="username" required />
            </label>
            <label class="field-full">
              <span>Haslo</span>
              <input name="password" type="password" autocomplete="current-password" required />
            </label>
            <button class="button" type="submit">Zaloguj</button>
            <p class="status">${escapeHtml(errorMessage)}</p>
          </form>
        </div>
      </div>
    `;

    scheduleScrollIndicatorUpdate();
    document.querySelector("#login-form").addEventListener("submit", handleLogin);
  }

  function getAdminTabConfig(tabKey = state.ui.topTab) {
    return ADMIN_TABS.find((tab) => tab.key === tabKey) || ADMIN_TABS[0];
  }

  function getActiveAdminTile(tabKey = state.ui.topTab) {
    const tab = getAdminTabConfig(tabKey);
    let stored = state.ui.tileByTab?.[tab.key];
    if (tab.key === "restauracja" && stored === "tables") {
      stored = "recipients";
    }
    return tab.tiles.find((tile) => tile.key === stored)?.key || tab.tiles[0]?.key || "";
  }

  function collectCurrentDraftContent() {
    try {
      return collectContentFromForm();
    } catch (error) {
      return structuredClone(state.content || {});
    }
  }

  function hasUnsavedContentChanges() {
    if (!state.loggedIn) {
      return false;
    }
    const draft = toUnsavedComparableContent(collectCurrentDraftContent());
    const baseline = toUnsavedComparableContent(state.lastSavedContent || state.content);
    return JSON.stringify(draft) !== JSON.stringify(baseline);
  }

  function toUnsavedComparableContent(content) {
    const comparable = normalizeAdminContent(content || {});
    if (comparable.hotel) {
      // Galerie pokoi zapisują się od razu osobnym endpointem, więc nie powinny oznaczać "niezapisanych treści".
      delete comparable.hotel.roomGalleries;
    }
    return comparable;
  }

  function refreshSaveDockVisibility() {
    const dock = document.querySelector("#admin-global-save-actions");
    if (!dock) return;
    const dirty = hasUnsavedContentChanges();
    dock.classList.toggle("is-visible", dirty);
  }

  function bindUnsavedTracking() {
    const stage = document.querySelector(".admin-stage");
    if (!stage) return;
    const handleStageChange = () => {
      refreshSaveDockVisibility();
    };
    stage.addEventListener("input", handleStageChange);
    stage.addEventListener("change", handleStageChange);
    stage.addEventListener("click", () => {
      window.setTimeout(refreshSaveDockVisibility, 0);
    });
  }

  function confirmLeaveIfUnsaved() {
    if (!hasUnsavedContentChanges()) {
      return true;
    }
    return window.confirm("Masz niezapisane zmiany. Czy na pewno chcesz opuscic panel?");
  }

  function setAdminTab(tabKey) {
    dismissMenuEditorModal({ skipRender: true, closeEntirely: true });
    captureDraftIfPossible();
    const previousTab = state.ui.topTab;
    if (previousTab === "dokumenty" && tabKey !== "dokumenty") {
      state.ui.documentsPageEditIndex = null;
    }
    const tab = getAdminTabConfig(tabKey);
    state.ui.view = "section";
    state.ui.topTab = tabKey;
    state.ui.tileByTab[tab.key] = tab.tiles[0]?.key || "";
    renderDashboard();
  }

  function setAdminTile(tabKey, tileKey) {
    dismissMenuEditorModal({ skipRender: true, closeEntirely: true });
    captureDraftIfPossible();
    const previousTab = state.ui.topTab;
    if (previousTab === "dokumenty" && tabKey !== "dokumenty") {
      state.ui.documentsPageEditIndex = null;
    }
    state.ui.view = "section";
    state.ui.topTab = tabKey;
    state.ui.tileByTab[tabKey] = tileKey;
    renderDashboard();
  }

  function goToAdminHome() {
    dismissMenuEditorModal({ skipRender: true, closeEntirely: true });
    captureDraftIfPossible();
    if (state.ui.topTab === "dokumenty") {
      state.ui.documentsPageEditIndex = null;
    }
    state.ui.view = "home";
    renderDashboard();
  }

  function renderAdminStageMarkup(tabKey, tileKey) {
    if (tabKey === "grafik") {
      return `<section class="panel col-12" id="schedule-panel"></section>`;
    }
    if (tabKey === "hotel" && tileKey === "gallery") {
      return `<section class="panel col-12" id="hotel-room-galleries-panel"></section>`;
    }
    if (tabKey === "hotel" && tileKey === "home") {
      return `<section class="panel col-12" id="hotel-home-media-panel"></section>`;
    }
    if (tabKey === "hotel" && tileKey === "rooms") {
      return `<div id="admin-panel-hotel-rooms" class="admin-hotel-wrap admin-stage-panel col-12"></div>`;
    }
    if (tabKey === "hotel" && tileKey === "templates") {
      return `<div id="admin-panel-hotel-templates" class="admin-hotel-wrap admin-stage-panel col-12"></div>`;
    }
    if (tabKey === "hotel" && tileKey === "settings") {
      return `<section class="panel col-12" id="hotel-booking-settings-panel"></section>`;
    }
    if (tabKey === "restauracja" && tileKey === "menu") {
      return `<section class="panel col-12" id="restaurant-menu-panel"></section>`;
    }
    if (tabKey === "restauracja" && tileKey === "home") {
      return `<section class="panel col-12" id="restaurant-home-media-panel"></section>`;
    }
    if (tabKey === "restauracja" && tileKey === "gallery") {
      return `<section class="panel col-12" id="restaurant-gallery-panel"></section>`;
    }
    if (tabKey === "restauracja" && tileKey === "orders") {
      return `<section class="panel col-12" id="restaurant-order-panel"></section>`;
    }
    if (tabKey === "restauracja" && tileKey === "hours") {
      return `<section class="panel col-12" id="restaurant-opening-hours-panel"></section>`;
    }
    if (tabKey === "restauracja" && tileKey === "recipients") {
      return `<div id="admin-panel-catering-recipients" class="admin-hotel-wrap admin-stage-panel col-12"></div>`;
    }
    if (tabKey === "restauracja" && tileKey === "templates") {
      return `<div id="admin-panel-restaurant-templates" class="admin-hotel-wrap admin-stage-panel col-12"></div>`;
    }
    if (tabKey === "restauracja" && tileKey === "settings") {
      return `<section class="panel col-12" id="restaurant-booking-settings-panel"></section>`;
    }
    if (tabKey === "przyjecia" && tileKey === "oferta") {
      return `<section class="panel col-12" id="events-offer-panel"></section>`;
    }
    if (tabKey === "przyjecia" && tileKey === "home") {
      return `<section class="panel col-12" id="events-home-media-panel"></section>`;
    }
    if (tabKey === "przyjecia" && tileKey === "sale") {
      return `<section class="panel col-12" id="events-halls-panel"></section>`;
    }
    if (tabKey === "przyjecia" && tileKey === "gallery") {
      return `
        <section class="panel col-12" id="events-hall-galleries-panel"></section>
        <section class="panel col-12" id="gallery-panel"></section>
      `;
    }
    if (tabKey === "przyjecia" && tileKey === "menu") {
      return `<section class="panel col-12" id="events-menu-panel"></section>`;
    }
    if (tabKey === "przyjecia" && tileKey === "venue") {
      return `<div id="admin-panel-hall-venue" class="admin-hotel-wrap admin-stage-panel col-12"></div>`;
    }
    if (tabKey === "przyjecia" && tileKey === "templates") {
      return `<div id="admin-panel-hall-templates" class="admin-hotel-wrap admin-stage-panel col-12"></div>`;
    }
    if (tabKey === "przyjecia" && tileKey === "settings") {
      return `<section class="panel col-12" id="events-booking-settings-panel"></section>`;
    }
    if (tabKey === "dokumenty") {
      return `<section class="panel col-12" id="documents-panel"></section>`;
    }
    if (tabKey === "kontakt") {
      return `<section class="panel col-12" id="contact-panel"></section>`;
    }
    if (tabKey === "powiadomienia") {
      const tileKey = getActiveAdminTile("powiadomienia");
      if (tileKey === "maile") {
        return `<section class="panel col-12" id="maile-panel"></section>`;
      }
      return `<section class="panel col-12" id="notifications-panel"></section>`;
    }
    return `<section class="panel col-12"><p class="status">Brak skonfigurowanego widoku.</p></section>`;
  }

  async function persistSectionVisibilityToggle(blockKey) {
    captureDraftIfPossible();
    const prevBlocks = structuredClone(state.content.home.sectionBlocks || {});
    const nextBlocks = { ...prevBlocks, [blockKey]: !Boolean(prevBlocks[blockKey]) };
    state.content.home.sectionBlocks = nextBlocks;
    
    // Synchronizuj checkbox w ustawieniach jeśli istnieje
    if (blockKey === 'events') {
      const checkbox = document.querySelector("#section-block-events");
      if (checkbox) {
        checkbox.checked = nextBlocks[blockKey];
      }
    } else if (blockKey === 'hotel') {
      const checkbox = document.querySelector("#section-block-hotel");
      if (checkbox) {
        checkbox.checked = nextBlocks[blockKey];
      }
    } else if (blockKey === 'restaurant') {
      const checkbox = document.querySelector("#section-block-restaurant");
      if (checkbox) {
        checkbox.checked = nextBlocks[blockKey];
      }
    }
    
    // Natychmiastowy render UI bez czekania na zapis
    renderDashboard();
    
    // Optymalny zapis - tylko sectionBlocks
    try {
      const data = await api("/api/admin/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          content: {
            ...state.content,
            home: {
              ...state.content.home,
              sectionBlocks: nextBlocks
            }
          }
        }),
      });
      const normalizedContent = normalizeAdminContent(data.content);
      state.content = normalizedContent;
      state.lastSavedContent = structuredClone(normalizedContent);
      showAdminFlash("Zapisano");
    } catch (error) {
      state.content.home.sectionBlocks = prevBlocks;
      renderDashboard();
      window.alert(error?.message || "Nie udało się zapisać widoczności modułu.");
    }
  }

  function bindAdminNavigation() {
    document.querySelectorAll("[data-admin-tab]").forEach((button) => {
      button.addEventListener("click", () => setAdminTab(button.dataset.adminTab));
    });
    document.querySelectorAll("[data-admin-entry]").forEach((button) => {
      button.addEventListener("click", () => setAdminTab(button.dataset.adminEntry));
    });
    document.querySelectorAll("[data-admin-tile]").forEach((button) => {
      button.addEventListener("click", () => setAdminTile(button.dataset.adminTabKey, button.dataset.adminTile));
    });
    document.querySelectorAll("[data-admin-section-visibility]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const key = String(button.dataset.adminSectionVisibility || "").trim();
        console.log("Toggle clicked, key:", key);
        if (!key) return;
        persistSectionVisibilityToggle(key);
      });
    });
    
    // Synchronizacja checkboxów z toggle buttons
    const sectionBlockEvents = document.querySelector("#section-block-events");
    if (sectionBlockEvents) {
      sectionBlockEvents.addEventListener("change", (event) => {
        persistSectionVisibilityToggle('events');
      });
    }
    
    const sectionBlockHotel = document.querySelector("#section-block-hotel");
    if (sectionBlockHotel) {
      sectionBlockHotel.addEventListener("change", (event) => {
        persistSectionVisibilityToggle('hotel');
      });
    }
    
    const sectionBlockRestaurant = document.querySelector("#section-block-restaurant");
    if (sectionBlockRestaurant) {
      sectionBlockRestaurant.addEventListener("change", (event) => {
        persistSectionVisibilityToggle('restaurant');
      });
    }
    
    const backButton = document.querySelector("#admin-back-button");
    if (backButton) {
      backButton.addEventListener("click", goToAdminHome);
    }
  }

  function renderOnlineBookingsUnavailable(panelSelector, options = {}) {
    const panel = document.querySelector(panelSelector);
    if (!panel) return;
    const { title, copy, statusMessage = "" } = options;
    panel.innerHTML = `
      <section class="panel col-12">
        <p class="pill">Rezerwacje</p>
        <h2>${escapeHtml(title)}</h2>
        <p class="section-intro">${escapeHtml(copy)}</p>
        <div class="stack">
          <p class="panel-note">
            Brak polaczenia z backendem rezerwacji: ustaw w <code>assets/js/config.js</code> adres Workera w polu <code>apiBase</code> albo wlacz <code>enableOnlineBookings: true</code>.
          </p>
          <p class="helper">Panel grafiku i cateringu na D1 wymaga poprawnego <code>apiBase</code> (np. https://api.sredzka-korona.pl), bez cloudfunctions.net.</p>
          <p class="status">${escapeHtml(statusMessage)}</p>
        </div>
      </section>
    `;
  }

  function mountLegacyBookingModule(panelSelector, service, options = {}, statusMessage = "") {
    if (!adminLegacyBookingsEnabled) {
      const titleMap = {
        hotel: "Rezerwacje hotelu",
        restaurant: "Rezerwacje cateringu",
        hall: "Rezerwacje przyjec",
      };
      const copyMap = {
        hotel: "Ten widok wymaga wlaczonego backendu rezerwacji hotelu.",
        restaurant: "Ten widok wymaga wlaczonego backendu rezerwacji cateringu.",
        hall: "Ten widok wymaga wlaczonego backendu rezerwacji przyjec.",
      };
      renderOnlineBookingsUnavailable(panelSelector, {
        title: titleMap[service] || "Rezerwacje",
        copy: copyMap[service] || "Ten widok wymaga wlaczonego backendu rezerwacji.",
        statusMessage,
      });
      return;
    }

    const panel = document.querySelector(panelSelector);
    if (!panel) return;

    if (service === "hotel" && typeof window.renderHotelAdminPanel === "function") {
      window.renderHotelAdminPanel(panel, options);
      return;
    }
    if (service === "restaurant" && typeof window.renderRestaurantAdminPanel === "function") {
      window.renderRestaurantAdminPanel(panel, options);
      return;
    }
    if (service === "hall" && typeof window.renderHallAdminPanel === "function") {
      window.renderHallAdminPanel(panel, options);
      return;
    }
    panel.innerHTML = `<section class="panel col-12"><p class="status">Modul nie jest dostepny.</p></section>`;
  }

  function renderActiveAdminTile(statusMessage = "") {
    const topTab = state.ui.topTab;
    const tileKey = getActiveAdminTile(topTab);

    if (topTab === "grafik") {
      if (tileKey === "registry") {
        renderReservationIndexPanel(statusMessage);
      } else {
        renderSchedulePanel(statusMessage);
      }
      scheduleStartPendingWatch();
      return;
    }

    if (topTab === "hotel") {
      if (tileKey === "home") {
        renderHomeSectionMediaPanel("hotel", "#hotel-home-media-panel", "Hotel", statusMessage);
      } else if (tileKey === "gallery") {
        renderHotelRoomGalleriesPanel(statusMessage);
      } else if (tileKey === "rooms") {
        mountLegacyBookingModule(
          "#admin-panel-hotel-rooms",
          "hotel",
          { defaultTab: "rooms", allowedTabs: ["rooms"] },
          statusMessage
        );
      } else if (tileKey === "templates") {
        mountLegacyBookingModule(
          "#admin-panel-hotel-templates",
          "hotel",
          { defaultTab: "templates", allowedTabs: ["templates"] },
          statusMessage
        );
      } else if (tileKey === "settings") {
        renderHotelBookingSettingsPanel(statusMessage);
      }
      return;
    }

    if (topTab === "restauracja") {
      if (tileKey === "home") {
        renderHomeSectionMediaPanel("restaurant", "#restaurant-home-media-panel", "Catering", statusMessage);
      } else if (tileKey === "menu") {
        renderRestaurantMenuPanel(statusMessage);
      } else if (tileKey === "gallery") {
        renderRestaurantGalleryPanel(statusMessage);
      } else if (tileKey === "orders") {
        renderRestaurantOrderPanel(statusMessage);
      } else if (tileKey === "hours") {
        renderRestaurantOpeningHoursPanel(statusMessage);
      } else if (tileKey === "recipients") {
        renderCateringRecipientsPanel(statusMessage);
      } else if (tileKey === "templates") {
        mountLegacyBookingModule(
          "#admin-panel-restaurant-templates",
          "restaurant",
          {
            defaultTab: "templates",
            allowedTabs: ["templates"],
            restaurantMailTemplateKeyFilter: ["restaurant_confirmed_client"],
          },
          statusMessage
        );
      } else if (tileKey === "settings") {
        renderRestaurantBookingSettingsPanel(statusMessage);
      }
      return;
    }

    if (topTab === "przyjecia") {
      if (tileKey === "home") {
        renderHomeSectionMediaPanel("events", "#events-home-media-panel", "Przyjecia", statusMessage);
      } else if (tileKey === "oferta") {
        renderEventsOfferPanel(statusMessage);
      } else if (tileKey === "sale") {
        renderEventsHallsPanel(statusMessage);
      } else if (tileKey === "gallery") {
        renderEventsHallGalleriesPanel(statusMessage);
        renderGalleryPanel(statusMessage);
      } else if (tileKey === "menu") {
        renderEventsMenuPanel(statusMessage);
      } else if (tileKey === "venue") {
        mountLegacyBookingModule(
          "#admin-panel-hall-venue",
          "hall",
          { defaultTab: "halls", allowedTabs: ["halls"] },
          statusMessage
        );
      } else if (tileKey === "templates") {
        mountLegacyBookingModule(
          "#admin-panel-hall-templates",
          "hall",
          { defaultTab: "templates", allowedTabs: ["templates"] },
          statusMessage
        );
      } else if (tileKey === "settings") {
        renderEventsBookingSettingsPanel(statusMessage);
      }
      return;
    }

    if (topTab === "dokumenty") {
      renderDocumentsPanel(statusMessage);
      return;
    }

    if (topTab === "kontakt") {
      renderContactPanel(statusMessage);
      return;
    }

    if (topTab === "powiadomienia") {
      if (tileKey === "maile") {
        renderMailTemplatesPanel(statusMessage);
      } else {
        renderNotificationsPanel(statusMessage);
      }
      return;
    }
  }

  function renderDashboard() {
    if (!(state.ui.topTab === "grafik" && state.ui.view === "section")) {
      scheduleStopPendingWatch();
    }
    const activeTab = getAdminTabConfig();
    const activeTile = getActiveAdminTile(activeTab.key);
    const inSectionView = state.ui.view === "section";
    const homeTabs = HOME_TAB_ORDER.map((tabKey) => ADMIN_TABS.find((tab) => tab.key === tabKey)).filter(Boolean);
    const primaryHomeTabs = homeTabs.filter((tab) => ["hotel", "restauracja", "przyjecia", "powiadomienia", "dokumenty", "kontakt"].includes(tab.key));
    const secondaryHomeTabs = homeTabs.filter((tab) =>
      false
    );
    const scheduleTab = ADMIN_TABS.find((tab) => tab.key === "grafik");

    app.innerHTML = `
      <div class="admin-shell">
        <header class="admin-topbar admin-topbar-simple">
          <div class="admin-topbar-side">
            ${
              inSectionView
                ? '<button class="button icon-button secondary" id="admin-back-button" type="button" aria-label="Powrot do kafelkow glownych">←</button>'
                : '<span class="admin-topbar-spacer" aria-hidden="true"></span>'
            }
          </div>
          <div class="admin-topbar-center">
            <a href="../index.html" class="admin-brand-link" aria-label="Przejdz do strony glownej Sredzka Korona">
              <span class="admin-brand-text">SREDZKA</span>
              <img class="admin-brand-logo" src="../ikony/logo-korona.png" alt="" aria-hidden="true" />
              <span class="admin-brand-text">KORONA</span>
            </a>
          </div>
          <div class="admin-topbar-side admin-topbar-side-end">
            <button class="button danger icon-button" id="logout-button" type="button" aria-label="Wyloguj">⎋</button>
          </div>
        </header>
        <section class="admin-workspace${inSectionView ? "" : " admin-workspace-home"}">
          ${
            inSectionView
              ? `
              <div class="admin-workspace-head">
                <div>
                  <p class="pill">${escapeHtml(activeTab.label)}</p>
                  <h2>${escapeHtml(activeTab.label)}</h2>
                  <p class="section-intro">${escapeHtml(activeTab.description)}</p>
                </div>
              </div>
              <div class="admin-tile-grid admin-section-tile-grid" style="--tile-count: ${activeTab.tiles.length};" aria-label="Sekcje w module ${escapeAttribute(activeTab.label)}">
                ${activeTab.tiles
                  .map(
                    (tile) => `
                      <button
                        type="button"
                        class="admin-tile${tile.key === activeTile ? " is-active" : ""}"
                        data-admin-tab-key="${escapeAttribute(activeTab.key)}"
                        data-admin-tile="${escapeAttribute(tile.key)}"
                      >
                        <span class="admin-tile-title">${escapeHtml(tile.label)}</span>
                      </button>
                    `
                  )
                  .join("")}
              </div>
              <div class="grid admin-stage">
                ${renderAdminStageMarkup(activeTab.key, activeTile)}
                <div id="admin-modal-root" class="admin-modal-root col-12"></div>
              </div>
            `
              : `
              <div class="admin-home-layout">
                ${
                  scheduleTab
                    ? renderAdminEntryCard(scheduleTab, {
                        featured: true,
                        highlights: ["Akceptacje", "Dzisiejsze terminy", "Kalendarz"],
                      })
                    : ""
                }
                <div class="admin-home-simple-grid" aria-label="Glowne sekcje panelu administracyjnego">
                  ${primaryHomeTabs.map((tab) => renderAdminEntryCard(tab)).join("")}
                </div>
                <div class="admin-home-secondary-grid" aria-label="Pozostale sekcje panelu administracyjnego">
                  ${secondaryHomeTabs.map((tab) => renderAdminEntryCard(tab)).join("")}
                </div>
              </div>
            `
          }
        </section>
        <div class="admin-global-save-actions" id="admin-global-save-actions">
          <button class="button secondary" id="cancel-content-button" type="button">Anuluj</button>
          <button class="button" id="save-content-button" type="button">Zapisz</button>
        </div>
      </div>
    `;

    scheduleScrollIndicatorUpdate();
    const saveButton = document.querySelector("#save-content-button");
    if (saveButton) {
      saveButton.addEventListener("click", () => saveContent());
    }
    const cancelButton = document.querySelector("#cancel-content-button");
    if (cancelButton) {
      cancelButton.addEventListener("click", discardContentChanges);
    }
    document.querySelector("#logout-button").addEventListener("click", logout);
    bindAdminNavigation();
    if (inSectionView) {
      renderActiveAdminTile();
      renderMenuEditorModal();
      bindUnsavedTracking();
    }
    refreshSaveDockVisibility();
  }

  function renderContentPanel(statusMessage = "") {
    const content = state.content;
    const panel = document.querySelector("#content-panel");
    if (!panel) return;
    panel.innerHTML = `
      <p class="pill">Tresci strony</p>
      <h2>Edycja glownej oferty</h2>
      <p class="section-intro">Formularz zapisuje opis firmy, podstrony i sekcje glownych modulow. Pola z wieloma pozycjami obslugiwane sa jako proste karty z przyciskiem dodawania.</p>
      <div class="stack">
        <div class="repeater-item">
          <h3>Dane firmy i hero</h3>
          <div class="field-grid">
            <label class="field"><span>Nazwa</span><input id="company-name" value="${escapeAttribute(content.company.name)}" /></label>
            <label class="field"><span>Telefon</span><input id="company-phone" value="${escapeAttribute(content.company.phone)}" /></label>
            <label class="field"><span>E-mail</span><input id="company-email" value="${escapeAttribute(content.company.email)}" /></label>
            <label class="field"><span>Adres</span><input id="company-address" value="${escapeAttribute(content.company.address)}" /></label>
            <label class="field-full"><span>Naglowek hero</span><input id="company-hero-title" value="${escapeAttribute(content.company.heroTitle)}" /></label>
            <label class="field-full"><span>Tekst hero</span><textarea id="company-hero-text">${escapeHtml(content.company.heroText)}</textarea></label>
            <div class="field-full">
              ${renderOpeningHoursEditorMarkup(content.company.openingHours)}
            </div>
          </div>
        </div>
        <div class="repeater-item">
          <div class="repeater-head">
            <div>
              <h3>Strona glowna</h3>
              <p class="helper">Blokady podstron i przełączniki rezerwacji.</p>
            </div>
          </div>
          <div class="admin-toggle-group" style="margin-bottom: 1rem;">
            <p class="helper">Kafelki na stronie startowej i wejscie na podstrony.</p>
            <label class="checkbox-field">
              <input type="checkbox" id="section-block-hotel" ${content.home.sectionBlocks?.hotel ? "checked" : ""} />
              <span class="checkbox-copy">
                <strong>Zablokuj Hotel</strong>
                <span>Wyszarza kafelek i blokuje wejscie na adres /Hotel/.</span>
              </span>
            </label>
            <label class="checkbox-field">
              <input type="checkbox" id="section-block-restaurant" ${content.home.sectionBlocks?.restaurant ? "checked" : ""} />
              <span class="checkbox-copy">
                <strong>Zablokuj Catering</strong>
                <span>Wyszarza kafelek i blokuje wejscie na adres /Restauracja/.</span>
              </span>
            </label>
            <label class="checkbox-field">
              <input type="checkbox" id="section-block-events" ${content.home.sectionBlocks?.events ? "checked" : ""} />
              <span class="checkbox-copy">
                <strong>Zablokuj Przyjecia</strong>
                <span>Wyszarza kafelek i blokuje wejscie na adres /Przyjec/.</span>
              </span>
            </label>
          </div>
          <div class="admin-toggle-group" style="margin-bottom: 1rem; padding-top: 0.75rem; border-top: 1px solid rgba(200, 170, 120, 0.25);">
            <p class="helper">Rezerwacje online na stronach publicznych.</p>
            ${!adminLegacyBookingsEnabled
              ? '<p class="helper">Brak jawnego <code>apiBase</code> i wylaczony <code>enableOnlineBookings</code> — ustaw adres Workera w <code>config.js</code> lub wlacz flage.</p>'
              : !config.enableOnlineBookings
                ? '<p class="helper">Strona publiczna: moduly rezerwacji sa wylaczone (<code>enableOnlineBookings: false</code> w booking-flags). Grafik w panelu dziala przy ustawionym <code>apiBase</code>.</p>'
                : ""}
            <label class="checkbox-field">
              <input type="checkbox" id="booking-enable-restaurant" ${content.booking?.restaurant !== false ? "checked" : ""} ${adminLegacyBookingsEnabled ? "" : "disabled"} />
              <span class="checkbox-copy">
                <strong>Catering</strong>
                <span>Włącza formularz rezerwacji stolika (gdy kafelek jest widoczny w modalu).</span>
              </span>
            </label>
            <label class="checkbox-field">
              <input type="checkbox" id="booking-enable-hotel" ${content.booking?.hotel !== false ? "checked" : ""} ${adminLegacyBookingsEnabled ? "" : "disabled"} />
              <span class="checkbox-copy">
                <strong>Hotel</strong>
                <span>Włącza formularz rezerwacji pokoi.</span>
              </span>
            </label>
            <label class="checkbox-field">
              <input type="checkbox" id="booking-enable-events" ${content.booking?.events !== false ? "checked" : ""} ${adminLegacyBookingsEnabled ? "" : "disabled"} />
              <span class="checkbox-copy">
                <strong>Przyjecia / sale</strong>
                <span>Włącza formularz zapytania o sale i rezerwacje.</span>
              </span>
            </label>
            <p class="helper" style="margin: 0.75rem 0 0.35rem;">Okresy przerw ustawisz nizej, osobno w panelach: Hotel / Catering / Przyjecia.</p>
          </div>
          <div class="panel-note">
            <strong>Uwaga:</strong> część treści poniżej pochodzi ze starszej wersji panelu. Aktualny front korzysta głównie z blokad sekcji, rezerwacji online, godzin dowozów, menu, galerii, dokumentów, kalendarza i modala „Oferta”.
          </div>
          <div class="field-grid">
            <label class="field-full"><span>Naglowek bloku (np. modal Kontakt)</span><input id="home-about-title" value="${escapeAttribute(content.home.aboutTitle || "")}" /></label>
            <label class="field-full"><span>Opis sekcji</span><textarea id="home-about-text">${escapeHtml(content.home.aboutText)}</textarea></label>
            <label class="field-full"><span>Opis wlasciciela</span><textarea id="home-owner">${escapeHtml(content.home.owner)}</textarea></label>
          </div>
          <div class="stack">
            <div class="repeater-head">
              <strong>Personel</strong>
              <button class="button secondary" type="button" data-add-array="staff">Dodaj osobe/role</button>
            </div>
            <div id="staff-list" class="repeater-list"></div>
            <div class="repeater-head">
              <strong>Opinie</strong>
              <button class="button secondary" type="button" data-add-array="testimonials">Dodaj opinie</button>
            </div>
            <div id="testimonials-list" class="repeater-list"></div>
          </div>
        </div>
        <div class="repeater-item">
          <div class="repeater-head">
            <div>
              <h3>Catering</h3>
              <p class="helper">Sekcje menu i dodatki.</p>
            </div>
          </div>
          <div class="field-grid">
            <label class="field-full"><span>Naglowek</span><input id="restaurant-hero-title" value="${escapeAttribute(content.restaurant.heroTitle)}" /></label>
            <label class="field-full"><span>Opis</span><textarea id="restaurant-hero-text">${escapeHtml(content.restaurant.heroText)}</textarea></label>
            <label class="field-full"><span>Dodatki cateringu, jedna pozycja w linii</span><textarea id="restaurant-extras">${escapeHtml((content.restaurant.extras || []).join("\n"))}</textarea></label>
          </div>
          <div class="repeater-head">
            <strong>Sekcje menu</strong>
            <button class="button secondary" type="button" data-add-array="menuSections">Dodaj sekcje menu</button>
          </div>
          <div id="menu-sections-list" class="repeater-list"></div>
        </div>
        <div class="repeater-item">
          <h3>Hotel</h3>
          <div class="field-grid">
            <label class="field-full"><span>Naglowek</span><input id="hotel-hero-title" value="${escapeAttribute(content.hotel.heroTitle)}" /></label>
            <label class="field-full"><span>Opis</span><textarea id="hotel-hero-text">${escapeHtml(content.hotel.heroText)}</textarea></label>
            <label class="field-full"><span>Udogodnienia hotelu, jedna pozycja w linii</span><textarea id="hotel-amenities">${escapeHtml((content.hotel.amenities || []).join("\n"))}</textarea></label>
          </div>
          <div class="repeater-head">
            <strong>Pokoje</strong>
            <button class="button secondary" type="button" data-add-array="rooms">Dodaj pokoj</button>
          </div>
          <div id="rooms-list" class="repeater-list"></div>
        </div>
        <div class="repeater-item">
          <h3>Przyjecia</h3>
          <div class="field-grid">
            <label class="field-full"><span>Naglowek</span><input id="events-hero-title" value="${escapeAttribute(content.events.heroTitle)}" /></label>
            <label class="field-full"><span>Opis</span><textarea id="events-hero-text">${escapeHtml(content.events.heroText)}</textarea></label>
            <label class="field-full"><span>Pakiety i uslugi przyjec, jedna pozycja w linii</span><textarea id="events-packages">${escapeHtml((content.events.packages || []).join("\n"))}</textarea></label>
            <label class="field-full"><span>Modal Oferta na stronie Przyjecia (HTML wewnatrz okna)</span><textarea id="events-oferta-modal-html" rows="18">${escapeHtml(content.events.ofertaModalBodyHtml || "")}</textarea></label>
            <p class="helper">Dozwolone znaczniki jak na stronie: p, ul, li, strong, a. Pusty tekst przywraca domyslna tresc z szablonu.</p>
          </div>
          <div class="repeater-head">
            <strong>Sale</strong>
            <button class="button secondary" type="button" data-add-array="halls">Dodaj sale</button>
          </div>
          <div id="halls-list" class="repeater-list"></div>
        </div>
        <div class="repeater-item">
          <div class="repeater-head">
            <div>
              <h3>Polecane uslugi</h3>
              <p class="helper">Partnerzy i inni przedsiebiorcy.</p>
            </div>
            <button class="button secondary" type="button" data-add-array="services">Dodaj usluge</button>
          </div>
          <div id="services-list" class="repeater-list"></div>
        </div>
        <p class="status">${escapeHtml(statusMessage)}</p>
      </div>
    `;

    bindRepeaterButtons();
    renderRepeaters();
  }

  function renderRepeaters() {
    renderStaffList();
    renderTestimonialsList();
    renderMenuSectionsList();
    renderRoomsList();
    renderHallsList();
    renderServicesList();
  }

  function renderStaffList() {
    const target = document.querySelector("#staff-list");
    target.innerHTML = state.content.home.staff
      .map(
        (item, index) => `
          <div class="repeater-item">
            <div class="repeater-head">
              <strong>Pozycja ${index + 1}</strong>
              <button class="button danger" type="button" data-remove-array="staff" data-index="${index}">Usun</button>
            </div>
            <label class="field-full">
              <span>Opis</span>
              <textarea data-staff-index="${index}">${escapeHtml(item)}</textarea>
            </label>
          </div>`
      )
      .join("");
  }

  function renderTestimonialsList() {
    const target = document.querySelector("#testimonials-list");
    if (!target) return;
    target.innerHTML = state.content.home.testimonials
      .map(
        (item, index) => `
          <div class="repeater-item">
            <div class="repeater-head">
              <strong>Opinia ${index + 1}</strong>
              <button class="button danger" type="button" data-remove-array="testimonials" data-index="${index}">Usun</button>
            </div>
            <div class="field-grid">
              <label class="field"><span>Autor</span><input data-testimonial-author="${index}" value="${escapeAttribute(item.author)}" /></label>
              <label class="field-full"><span>Tresc</span><textarea data-testimonial-text="${index}">${escapeHtml(item.text)}</textarea></label>
            </div>
          </div>`
      )
      .join("");
  }

  function renderMenuSectionsList() {
    const target = document.querySelector("#menu-sections-list");
    if (!target) return;
    target.innerHTML = state.content.restaurant.menuSections
      .map(
        (section, index) => `
          <div class="repeater-item">
            <div class="repeater-head">
              <strong>Sekcja menu ${index + 1}</strong>
              <button class="button danger" type="button" data-remove-array="menuSections" data-index="${index}">Usun</button>
            </div>
            <div class="field-grid">
              <label class="field"><span>Nazwa sekcji</span><input data-menu-title="${index}" value="${escapeAttribute(section.title)}" /></label>
              <label class="field-full"><span>Pozycje, jedna w linii</span><textarea data-menu-items="${index}">${escapeHtml(section.items.join("\n"))}</textarea></label>
            </div>
          </div>`
      )
      .join("");
  }

  function renderRoomsList() {
    const target = document.querySelector("#rooms-list");
    if (!target) return;
    target.innerHTML = state.content.hotel.rooms
      .map(
        (room, index) => `
          <div class="repeater-item">
            <div class="repeater-head">
              <strong>Pokoj ${index + 1}</strong>
              <button class="button danger" type="button" data-remove-array="rooms" data-index="${index}">Usun</button>
            </div>
            <div class="field-grid">
              <label class="field"><span>Nazwa</span><input data-room-name="${index}" value="${escapeAttribute(room.name)}" /></label>
              <label class="field"><span>Metraz</span><input data-room-size="${index}" value="${escapeAttribute(room.size)}" /></label>
              <label class="field"><span>Dla kogo</span><input data-room-guests="${index}" value="${escapeAttribute(room.guests)}" /></label>
              <label class="field-full"><span>Udogodnienia, jedna w linii</span><textarea data-room-features="${index}">${escapeHtml(room.features.join("\n"))}</textarea></label>
            </div>
          </div>`
      )
      .join("");
  }

  function renderHallsList() {
    const target = document.querySelector("#halls-list");
    if (!target) return;
    const hallLabels = ["Sala duza", "Sala mala"];
    const halls = normalizeEventHalls(state.content.events?.halls);
    target.innerHTML = halls
      .map(
        (hall, index) => `
          <div class="repeater-item">
            <div class="repeater-head">
              <strong>${hallLabels[index] || `Sala ${index + 1}`}</strong>
            </div>
            <div class="field-grid">
              <label class="field"><span>Nazwa</span><input data-hall-name-fixed="${index}" value="${escapeAttribute(hall.name)}" /></label>
              <label class="field"><span>Pojemnosc</span><input data-hall-capacity-fixed="${index}" value="${escapeAttribute(hall.capacity)}" /></label>
              <label class="field-full"><span>Opis</span><textarea data-hall-description-fixed="${index}">${escapeHtml(hall.description)}</textarea></label>
            </div>
          </div>`
      )
      .join("");
  }

  function renderServicesList() {
    const target = document.querySelector("#services-list");
    if (!target) return;
    target.innerHTML = state.content.services
      .map(
        (service, index) => `
          <div class="repeater-item">
            <div class="repeater-head">
              <strong>Usluga ${index + 1}</strong>
              <button class="button danger" type="button" data-remove-array="services" data-index="${index}">Usun</button>
            </div>
            <div class="field-grid">
              <label class="field"><span>Nazwa</span><input data-service-title="${index}" value="${escapeAttribute(service.title)}" /></label>
              <label class="field"><span>Kontakt</span><input data-service-contact="${index}" value="${escapeAttribute(service.contact)}" /></label>
              <label class="field"><span>Link</span><input data-service-link="${index}" value="${escapeAttribute(service.link)}" /></label>
              <label class="field-full"><span>Opis</span><textarea data-service-description="${index}">${escapeHtml(service.description)}</textarea></label>
            </div>
          </div>`
      )
      .join("");
  }

  function bindRepeaterButtons() {
    document.querySelectorAll("[data-add-array]").forEach((button) => {
      if (button.dataset.listenerBound === "1") return;
      button.dataset.listenerBound = "1";
      button.addEventListener("click", () => addArrayItem(button.dataset.addArray));
    });
    document.querySelectorAll("[data-remove-array]").forEach((button) => {
      if (button.dataset.listenerBound === "1") return;
      button.dataset.listenerBound = "1";
      button.addEventListener("click", () => removeArrayItem(button.dataset.removeArray, Number(button.dataset.index)));
    });
    document.querySelectorAll("[data-add-booking-pause-range]").forEach((button) => {
      if (button.dataset.listenerBound === "1") return;
      button.dataset.listenerBound = "1";
      button.addEventListener("click", () => {
        const domainKey = String(button.dataset.addBookingPauseRange || "").trim();
        if (!domainKey) return;
        const list = document.querySelector(`[data-booking-pause-list="${domainKey}"]`);
        if (!list) return;
        const controls = document.querySelector(`[data-booking-pause-controls="${domainKey}"]`);
        if (!controls) return;
        const fromInput = controls.querySelector('[data-booking-pause-role="from"]');
        const toInput = controls.querySelector('[data-booking-pause-role="to"]');
        const candidate = normalizePauseRanges([
          {
            from: fromInput?.value?.trim() || "",
            to: toInput?.value?.trim() || "",
          },
        ])[0];
        if (!candidate) return;
        if (candidate.to < getTodayIsoDate()) {
          if (fromInput) fromInput.value = "";
          if (toInput) toInput.value = "";
          return;
        }
        const duplicates = Array.from(list.querySelectorAll("[data-booking-pause-item]")).some((item) => {
          const from = item.querySelector('[data-booking-pause-hidden-role="from"]')?.value || "";
          const to = item.querySelector('[data-booking-pause-hidden-role="to"]')?.value || "";
          return from === candidate.from && to === candidate.to;
        });
        if (duplicates) return;
        const emptyMessage = list.querySelector(`[data-booking-pause-empty="${domainKey}"]`);
        if (emptyMessage) {
          emptyMessage.remove();
        }
        list.appendChild(createPauseRangeListItemElement(domainKey, candidate, button.disabled));
        bindRepeaterButtons();
        if (fromInput) fromInput.value = "";
        if (toInput) toInput.value = "";
      });
    });
    document.querySelectorAll("[data-remove-booking-pause-item]").forEach((button) => {
      if (button.dataset.listenerBound === "1") return;
      button.dataset.listenerBound = "1";
      button.addEventListener("click", () => {
        const item = button.closest("[data-booking-pause-item]");
        if (!item) return;
        const list = item.parentElement;
        if (!list) return;
        const domainKey = String(item.dataset.bookingPauseItem || "").trim();
        item.remove();
        const hasAnyItems = list.querySelector("[data-booking-pause-item]");
        if (!hasAnyItems && domainKey) {
          list.insertAdjacentHTML(
            "beforeend",
            `<li class="helper" data-booking-pause-empty="${escapeAttribute(domainKey)}">Brak obecnych i przyszlych zakresow.</li>`
          );
        }
      });
    });
  }

  function addArrayItem(type) {
    captureDraftIfPossible();
    if (type === "staff") {
      state.content.home.staff.push("");
    } else if (type === "testimonials") {
      state.content.home.testimonials.push({ author: "", text: "" });
    } else if (type === "menuSections") {
      state.content.restaurant.menuSections.push({ title: "", items: [] });
    } else if (type === "rooms") {
      state.content.hotel.rooms.push({ name: "", size: "", guests: "", features: [] });
    } else if (type === "halls") {
      state.content.events.halls.push({ key: "", name: "", capacity: "", description: "" });
    } else if (type === "services") {
      state.content.services.push({ title: "", description: "", contact: "", link: "" });
    }
    renderDashboard();
  }

  function removeArrayItem(type, index) {
    captureDraftIfPossible();
    if (type === "staff") {
      state.content.home.staff.splice(index, 1);
    } else if (type === "testimonials") {
      state.content.home.testimonials.splice(index, 1);
    } else if (type === "menuSections") {
      state.content.restaurant.menuSections.splice(index, 1);
    } else if (type === "rooms") {
      state.content.hotel.rooms.splice(index, 1);
    } else if (type === "halls") {
      state.content.events.halls.splice(index, 1);
    } else if (type === "services") {
      state.content.services.splice(index, 1);
    }
    renderDashboard();
  }

  function collectContentFromForm() {
    const content = structuredClone(state.content);
    const getTrimmedValue = (selector) => {
      const element = document.querySelector(selector);
      return element ? element.value.trim() : null;
    };

    const companyName = getTrimmedValue("#company-name");
    if (companyName !== null) content.company.name = companyName;
    const companyPhone = getTrimmedValue("#company-phone");
    if (companyPhone !== null) content.company.phone = companyPhone;
    const companyEmail = getTrimmedValue("#company-email");
    if (companyEmail !== null) content.company.email = companyEmail;
    const companyAddress = getTrimmedValue("#company-address");
    if (companyAddress !== null) content.company.address = companyAddress;
    const companyHeroTitle = getTrimmedValue("#company-hero-title");
    if (companyHeroTitle !== null) content.company.heroTitle = companyHeroTitle;
    const companyHeroText = getTrimmedValue("#company-hero-text");
    if (companyHeroText !== null) content.company.heroText = companyHeroText;

    if (document.querySelector("#company-opening-hours-monday-from")) {
      content.company.openingHours = collectOpeningHoursFromEditor(getTrimmedValue);
    } else {
      const openingHoursRaw = getTrimmedValue("#company-opening-hours");
      if (openingHoursRaw !== null) {
        const openingHoursText = openingHoursRaw
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean);
        content.company.openingHours = normalizeOpeningHours(
          openingHoursText.map((item) => {
            const colonIndex = item.indexOf(":");
            if (colonIndex > 0) {
              return {
                day: item.substring(0, colonIndex).trim(),
                hours: item.substring(colonIndex + 1).trim(),
              };
            }
            return item;
          })
        );
      }
    }

    const homeAboutTitle = getTrimmedValue("#home-about-title");
    if (homeAboutTitle !== null) content.home.aboutTitle = homeAboutTitle;
    const homeAboutText = getTrimmedValue("#home-about-text");
    if (homeAboutText !== null) content.home.aboutText = homeAboutText;
    const homeOwner = getTrimmedValue("#home-owner");
    if (homeOwner !== null) content.home.owner = homeOwner;
    const prevBlocks = content.home.sectionBlocks || {};
    const elH = document.querySelector("#section-block-hotel");
    const elR = document.querySelector("#section-block-restaurant");
    const elE = document.querySelector("#section-block-events");
    content.home.sectionBlocks = {
      hotel: elH ? elH.checked : Boolean(prevBlocks.hotel),
      restaurant: elR ? elR.checked : Boolean(prevBlocks.restaurant),
      events: elE ? elE.checked : Boolean(prevBlocks.events),
    };
    content.home.sectionMedia = normalizeHomeSectionMedia(content.home.sectionMedia);
    if (!content.booking) {
      content.booking = {};
    }
    const br = document.querySelector("#booking-enable-restaurant");
    const bh = document.querySelector("#booking-enable-hotel");
    const be = document.querySelector("#booking-enable-events");
    if (adminLegacyBookingsEnabled) {
      content.booking.restaurant = br ? br.checked : content.booking.restaurant !== false;
      content.booking.hotel = bh ? bh.checked : content.booking.hotel !== false;
      content.booking.events = be ? be.checked : content.booking.events !== false;
    } else {
      content.booking.restaurant = false;
      content.booking.hotel = false;
      content.booking.events = false;
    }

    function collectPauseRanges(domainKey) {
      const listItems = Array.from(document.querySelectorAll(`[data-booking-pause-item="${domainKey}"]`));
      const rangesFromList = listItems.map((item) => ({
        from: item.querySelector('[data-booking-pause-hidden-role="from"]')?.value?.trim() || "",
        to: item.querySelector('[data-booking-pause-hidden-role="to"]')?.value?.trim() || "",
      }));
      const controls = document.querySelector(`[data-booking-pause-controls="${domainKey}"]`);
      const draftRange = controls
        ? {
            from: controls.querySelector('[data-booking-pause-role="from"]')?.value?.trim() || "",
            to: controls.querySelector('[data-booking-pause-role="to"]')?.value?.trim() || "",
          }
        : null;
      const allRanges = draftRange ? [...rangesFromList, draftRange] : rangesFromList;
      return filterCurrentAndFuturePauseRanges(allRanges);
    }
    const restaurantRanges = adminLegacyBookingsEnabled ? collectPauseRanges("restaurant") : [];
    const hotelRanges = adminLegacyBookingsEnabled ? collectPauseRanges("hotel") : [];
    const eventsRanges = adminLegacyBookingsEnabled ? collectPauseRanges("events") : [];
    content.booking.restaurantPauseRanges = restaurantRanges;
    content.booking.hotelPauseRanges = hotelRanges;
    content.booking.eventsPauseRanges = eventsRanges;
    const firstRestaurantRange = restaurantRanges[0] || { from: "", to: "" };
    const firstHotelRange = hotelRanges[0] || { from: "", to: "" };
    const firstEventsRange = eventsRanges[0] || { from: "", to: "" };
    content.booking.restaurantPauseFrom = firstRestaurantRange.from;
    content.booking.restaurantPauseTo = firstRestaurantRange.to;
    content.booking.hotelPauseFrom = firstHotelRange.from;
    content.booking.hotelPauseTo = firstHotelRange.to;
    content.booking.eventsPauseFrom = firstEventsRange.from;
    content.booking.eventsPauseTo = firstEventsRange.to;

    if (document.querySelector("[data-staff-index]")) {
      content.home.staff = Array.from(document.querySelectorAll("[data-staff-index]"))
        .map((element) => element.value.trim())
        .filter(Boolean);
    }
    if (document.querySelector("[data-testimonial-author]")) {
      content.home.testimonials = Array.from(document.querySelectorAll("[data-testimonial-author]")).map(
        (element, index) => ({
          author: element.value.trim(),
          text: document.querySelector(`[data-testimonial-text="${index}"]`)?.value.trim() || "",
        })
      );
    }

    const restaurantHeroTitle = getTrimmedValue("#restaurant-hero-title");
    if (restaurantHeroTitle !== null) content.restaurant.heroTitle = restaurantHeroTitle;
    const restaurantHeroText = getTrimmedValue("#restaurant-hero-text");
    if (restaurantHeroText !== null) content.restaurant.heroText = restaurantHeroText;
    const restaurantExtras = getTrimmedValue("#restaurant-extras");
    if (restaurantExtras !== null) {
      content.restaurant.extras = restaurantExtras
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean);
    }
    const restaurantOrdersInfoText = getTrimmedValue("#restaurant-orders-info-html") ?? getTrimmedValue("#restaurant-orders-info-text");
    if (restaurantOrdersInfoText !== null) {
      content.restaurant.ordersInfoText = restaurantOrdersInfoText;
    }

    if (document.querySelector("#restaurant-menu-panel") || document.querySelector("#events-menu-panel")) {
      if (!content.restaurant) {
        content.restaurant = {};
      }
      content.restaurant.menu = collectMenuFromPanel();
      if (!content.events) {
        content.events = {};
      }
      content.events.menu = structuredClone(content.restaurant.menu);
    } else if (document.querySelector("[data-menu-title]")) {
      content.restaurant.menuSections = Array.from(document.querySelectorAll("[data-menu-title]")).map(
        (element, index) => ({
          title: element.value.trim(),
          items: (document.querySelector(`[data-menu-items="${index}"]`)?.value || "")
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean),
        })
      );
    }

    const hotelHeroTitle = getTrimmedValue("#hotel-hero-title");
    if (hotelHeroTitle !== null) content.hotel.heroTitle = hotelHeroTitle;
    const hotelHeroText = getTrimmedValue("#hotel-hero-text");
    if (hotelHeroText !== null) content.hotel.heroText = hotelHeroText;
    const hotelAmenities = getTrimmedValue("#hotel-amenities");
    if (hotelAmenities !== null) {
      content.hotel.amenities = hotelAmenities
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean);
    }
    if (document.querySelector("[data-room-name]")) {
      content.hotel.rooms = Array.from(document.querySelectorAll("[data-room-name]")).map((element, index) => ({
        name: element.value.trim(),
        size: document.querySelector(`[data-room-size="${index}"]`)?.value.trim() || "",
        guests: document.querySelector(`[data-room-guests="${index}"]`)?.value.trim() || "",
        features: (document.querySelector(`[data-room-features="${index}"]`)?.value || "")
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
      }));
    }

    const eventsHeroTitle = getTrimmedValue("#events-hero-title");
    if (eventsHeroTitle !== null) content.events.heroTitle = eventsHeroTitle;
    const eventsHeroText = getTrimmedValue("#events-hero-text");
    if (eventsHeroText !== null) content.events.heroText = eventsHeroText;
    const eventsPackages = getTrimmedValue("#events-packages");
    if (eventsPackages !== null) {
      content.events.packages = eventsPackages
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean);
    }
    const ofertaEl = document.querySelector("#events-oferta-modal-html");
    if (ofertaEl) {
      content.events.ofertaModalBodyHtml = ofertaEl.value;
    }
    if (document.querySelector("[data-hall-name-fixed]")) {
      content.events.halls = [
        {
          key: "duza",
          name: document.querySelector('[data-hall-name-fixed="0"]')?.value.trim() || "Sala Duza",
          capacity: document.querySelector('[data-hall-capacity-fixed="0"]')?.value.trim() || "",
          description: document.querySelector('[data-hall-description-fixed="0"]')?.value.trim() || "",
        },
        {
          key: "mala",
          name: document.querySelector('[data-hall-name-fixed="1"]')?.value.trim() || "Sala Mala",
          capacity: document.querySelector('[data-hall-capacity-fixed="1"]')?.value.trim() || "",
          description: document.querySelector('[data-hall-description-fixed="1"]')?.value.trim() || "",
        },
      ];
    }

    if (document.querySelector("#documents-page-list")) {
      content.documentsPage = collectDocumentsPageFromPanel();
    }

    if (document.querySelector("[data-service-title]")) {
      content.services = Array.from(document.querySelectorAll("[data-service-title]")).map((element, index) => ({
        title: element.value.trim(),
        contact: document.querySelector(`[data-service-contact="${index}"]`)?.value.trim() || "",
        link: document.querySelector(`[data-service-link="${index}"]`)?.value.trim() || "",
        description: document.querySelector(`[data-service-description="${index}"]`)?.value.trim() || "",
      }));
    }

    return content;
  }

  function captureDraftIfPossible() {
    try {
      state.content = collectContentFromForm();
      if (document.querySelector("#restaurant-menu-panel") || document.querySelector("#events-menu-panel")) {
        if (!state.content.restaurant) {
          state.content.restaurant = {};
        }
        state.content.restaurant.menu = collectMenuFromPanel();
        if (!state.content.events) {
          state.content.events = {};
        }
        state.content.events.menu = structuredClone(state.content.restaurant.menu);
      }
    } catch (error) {
      // Ignore incomplete drafts while the panel is rerendering.
    }
  }

  function discardContentChanges() {
    if (!hasUnsavedContentChanges()) {
      return;
    }
    if (!window.confirm("Anulowac wszystkie niezapisane zmiany?")) {
      return;
    }

    dismissMenuEditorModal({ skipRender: true, closeEntirely: true });
    state.content = structuredClone(state.lastSavedContent || state.content);
    renderDashboard();
    if (state.ui.view === "section") {
      renderActiveAdminTile("Niezapisane zmiany zostaly anulowane.");
    }
  }

  async function saveContent(successMessage = "Zmiany zostaly zapisane.") {
    try {
      const content = collectContentFromForm();
      // Zbierz menu z panelu zarządzania menu jeśli istnieje
      if (document.querySelector("#restaurant-menu-panel") || document.querySelector("#events-menu-panel")) {
        if (!content.restaurant) {
          content.restaurant = {};
        }
        content.restaurant.menu = collectMenuFromPanel();
        if (!content.events) {
          content.events = {};
        }
        content.events.menu = structuredClone(content.restaurant.menu);
      }
      // Zbierz galerię restauracji jeśli istnieje
      if (state.content.restaurant?.gallery) {
        if (!content.restaurant) {
          content.restaurant = {};
        }
        content.restaurant.gallery = state.content.restaurant.gallery;
      }
      if (content.hotel) {
        // Zdjecia pokoi sa przechowywane osobno w DB, nie w content_json.
        delete content.hotel.roomGalleries;
      }
      const payload = { content };
      const data = await api("/api/admin/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const normalizedContent = normalizeAdminContent(data.content);
      state.content = normalizedContent;
      state.lastSavedContent = structuredClone(normalizedContent);
      if (state.ui.view === "section") {
        renderActiveAdminTile(successMessage);
      }
      refreshSaveDockVisibility();
    } catch (error) {
      if (state.ui.view === "section") {
        renderActiveAdminTile(error.message);
      }
    }
  }

  function renderDomainBookingSettingsPanel(panelSelector, options = {}) {
    const panel = document.querySelector(panelSelector);
    if (!panel) return;

    const {
      title,
      enabledId,
      toggleLabel,
      pauseRangesKey,
      pauseLabel,
      statusMessage = "",
      disabled = false,
    } = options;

    const booking = state.content.booking || {};
    const domainKey = String(enabledId || "").replace(/^booking-enable-/, "");
    const isEnabled = booking[domainKey] !== false;
    const bookingLabel = toggleLabel || title;

    panel.innerHTML = `
      <p class="pill">Ustawienia rezerwacji</p>
      <h2>${escapeHtml(title)}</h2>
      <div class="stack">
        ${disabled ? '<p class="panel-note">W tej konfiguracji rezerwacje online sa globalnie wylaczone. Po wlaczeniu backendu rezerwacji te ustawienia zaczna dzialac.</p>' : ""}
        <div class="booking-toggle-card ${isEnabled ? "is-enabled" : "is-disabled"}">
          <div class="booking-toggle-copy">
            <strong>Rezerwacja ${escapeHtml(bookingLabel)}</strong>
            <span class="booking-toggle-status ${isEnabled ? "is-enabled" : "is-disabled"}" data-booking-toggle-status="${escapeAttribute(enabledId)}">
              Rezerwacja ${escapeHtml(bookingLabel)} ${isEnabled ? "wlaczona" : "wylaczona"}
            </span>
          </div>
          <input type="checkbox" id="${escapeAttribute(enabledId)}" ${isEnabled ? "checked" : ""} ${disabled ? "disabled" : ""} hidden />
          <button class="button ${isEnabled ? "secondary" : ""}" type="button" data-booking-toggle-button="${escapeAttribute(enabledId)}" ${disabled ? "disabled" : ""}>
            ${isEnabled ? "Wylacz" : "Wlacz"}
          </button>
        </div>
        <div class="stack">
          <strong>Blokada rezerwacji:</strong>
          ${renderPauseRangesEditorMarkup(domainKey, booking[pauseRangesKey], {
            disabled,
            label: pauseLabel || "Przerwa",
          })}
        </div>
        <p class="status">${escapeHtml(statusMessage)}</p>
      </div>
    `;

    const toggleInput = panel.querySelector(`#${enabledId}`);
    const toggleButton = panel.querySelector(`[data-booking-toggle-button="${enabledId}"]`);
    const toggleStatus = panel.querySelector(`[data-booking-toggle-status="${enabledId}"]`);
    const toggleCard = panel.querySelector(".booking-toggle-card");

    const paintToggleState = () => {
      const enabled = Boolean(toggleInput?.checked);
      if (toggleButton) {
        toggleButton.textContent = enabled ? "Wylacz" : "Wlacz";
        toggleButton.classList.toggle("secondary", enabled);
      }
      if (toggleStatus) {
        toggleStatus.textContent = `Rezerwacja ${bookingLabel} ${enabled ? "wlaczona" : "wylaczona"}`;
        toggleStatus.classList.toggle("is-enabled", enabled);
        toggleStatus.classList.toggle("is-disabled", !enabled);
      }
      if (toggleCard) {
        toggleCard.classList.toggle("is-enabled", enabled);
        toggleCard.classList.toggle("is-disabled", !enabled);
      }
    };

    toggleButton?.addEventListener("click", () => {
      if (!toggleInput || toggleInput.disabled) return;
      toggleInput.checked = !toggleInput.checked;
      paintToggleState();
      refreshSaveDockVisibility();
    });
    toggleInput?.addEventListener("change", () => {
      paintToggleState();
      refreshSaveDockVisibility();
    });

    bindRepeaterButtons();
  }

  async function refreshCateringRecipientsState() {
    try {
      const data = await bookingAdminApi("restaurant", "admin-catering-recipients-list");
      state.schedule.cateringRecipients = Array.isArray(data?.recipients) ? data.recipients : [];
    } catch {
      /* grafik może ładować listę osobno */
    }
  }

  function openCateringRecipientEditorModal(initial, onSaved) {
    const r = initial && typeof initial === "object" ? initial : {};
    const isEdit = Boolean(r.id);
    openScheduleModal(
      `
        <form class="stack" id="catering-recipient-editor-form">
          <div class="admin-modal-head">
            <div>
              <p class="pill">Catering</p>
              <h3>${isEdit ? "Edycja odbiorcy" : "Nowy odbiorca"}</h3>
            </div>
            <button type="button" class="button secondary" data-schedule-modal-close>Zamknij</button>
          </div>
          ${isEdit ? `<input type="hidden" name="id" value="${escapeAttribute(String(r.id))}" />` : ""}
          <div class="field-grid">
            <label class="field-full"><span>Nazwa odbiorcy</span><input name="displayName" required value="${escapeAttribute(r.displayName || "")}" /></label>
            <label class="field"><span>Imię</span><input name="contactFirstName" value="${escapeAttribute(r.contactFirstName || "")}" /></label>
            <label class="field"><span>Nazwisko</span><input name="contactLastName" value="${escapeAttribute(r.contactLastName || "")}" /></label>
            <label class="field"><span>E-mail</span><input name="email" type="email" required value="${escapeAttribute(r.email || "")}" /></label>
            <label class="field"><span>Prefiks tel.</span><input name="phonePrefix" value="${escapeAttribute(r.phonePrefix || "+48")}" /></label>
            <label class="field"><span>Numer telefonu</span><input name="phoneNational" value="${escapeAttribute(r.phoneNational || "")}" /></label>
            <label class="field"><span>Ulica</span><input name="street" value="${escapeAttribute(r.street || "")}" /></label>
            <label class="field"><span>Nr budynku / lokalu</span><input name="buildingNumber" value="${escapeAttribute(r.buildingNumber || "")}" /></label>
            <label class="field"><span>Kod pocztowy</span><input name="postalCode" value="${escapeAttribute(r.postalCode || "")}" /></label>
            <label class="field"><span>Miasto</span><input name="city" value="${escapeAttribute(r.city || "")}" /></label>
            <label class="field-full"><span>Dodatkowe informacje</span><textarea name="extraInfo" rows="3">${escapeHtml(r.extraInfo || "")}</textarea></label>
          </div>
          <div class="admin-modal-footer">
            <button type="button" class="button secondary" data-schedule-modal-close>Anuluj</button>
            <button type="submit" class="button">Zapisz</button>
          </div>
        </form>
      `,
      (mount) => {
        mount.querySelector("#catering-recipient-editor-form")?.addEventListener("submit", async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const fd = new FormData(form);
          const body = {
            id: fd.get("id") || undefined,
            displayName: String(fd.get("displayName") || "").trim(),
            contactFirstName: String(fd.get("contactFirstName") || "").trim(),
            contactLastName: String(fd.get("contactLastName") || "").trim(),
            email: String(fd.get("email") || "").trim(),
            phonePrefix: String(fd.get("phonePrefix") || "+48").trim(),
            phoneNational: String(fd.get("phoneNational") || "").trim(),
            street: String(fd.get("street") || "").trim(),
            buildingNumber: String(fd.get("buildingNumber") || "").trim(),
            postalCode: String(fd.get("postalCode") || "").trim(),
            city: String(fd.get("city") || "").trim(),
            extraInfo: String(fd.get("extraInfo") || "").trim(),
          };
          try {
            await bookingAdminApi("restaurant", "admin-catering-recipient-save", { method: "PUT", body });
            closeScheduleModal();
            await refreshCateringRecipientsState();
            if (typeof onSaved === "function") await onSaved();
          } catch (error) {
            window.alert(error.message || "Nie udało się zapisać odbiorcy.");
          }
        });
      },
      { closeOnOverlayClick: false }
    );
  }

  async function renderCateringRecipientsPanel(statusMessage = "") {
    const root = document.querySelector("#admin-panel-catering-recipients");
    if (!root) return;

    if (!adminLegacyBookingsEnabled) {
      renderOnlineBookingsUnavailable("#admin-panel-catering-recipients", {
        title: "Odbiorcy cateringu",
        copy: "Ten widok wymaga włączonego backendu rezerwacji cateringu.",
        statusMessage,
      });
      return;
    }

    root.innerHTML = `<section class="panel col-12"><p class="status">Ładowanie listy odbiorców…</p></section>`;

    const paint = (recipients, message = "") => {
      const list = Array.isArray(recipients) ? recipients : [];
      const rows = list
        .map((rec) => {
          const person = [rec.contactFirstName, rec.contactLastName].filter(Boolean).join(" ");
          const phone = `${rec.phonePrefix || ""} ${rec.phoneNational || ""}`.trim();
          const addr = [rec.street, rec.buildingNumber].filter(Boolean).join(" ");
          const cityLine = [rec.postalCode, rec.city].filter(Boolean).join(" ");
          return `
            <tr>
              <td><strong>${escapeHtml(rec.displayName || rec.id || "—")}</strong></td>
              <td>${escapeHtml(person || "—")}<br /><span class="helper">${escapeHtml(rec.email || "—")}</span><br /><span class="helper">${escapeHtml(phone || "—")}</span></td>
              <td>${escapeHtml(addr || "—")}<br /><span class="helper">${escapeHtml(cityLine || "")}</span></td>
              <td>
                <div class="inline-actions">
                  <button type="button" class="button secondary" data-catering-recipient-edit="${escapeAttribute(rec.id)}">Edytuj</button>
                  <button type="button" class="button danger" data-catering-recipient-delete="${escapeAttribute(rec.id)}">Usuń</button>
                </div>
              </td>
            </tr>
          `;
        })
        .join("");

      root.innerHTML = `
        <section class="panel col-12 catering-recipients-panel">
          <p class="pill">Catering</p>
          <div class="catering-recipients-head">
            <div>
              <h2>Odbiorcy</h2>
              <p class="section-intro">Lista odbiorców dostaw: nazwa firmy lub miejsca, osoba kontaktowa, e-mail, telefon oraz adres. Tych odbiorców wybierasz też w grafiku przy ręcznej rezerwacji dostawy.</p>
            </div>
            <button type="button" class="button" data-catering-recipients-add>Dodaj odbiorcę</button>
          </div>
          <p class="status" data-catering-recipients-status>${escapeHtml(message || statusMessage || "")}</p>
          ${
            list.length
              ? `<div class="table-scroll"><table class="hotel-table"><thead><tr><th>Nazwa</th><th>Kontakt</th><th>Adres</th><th>Akcje</th></tr></thead><tbody>${rows}</tbody></table></div>`
              : `<p class="helper">Brak zapisanych odbiorców. Dodaj pierwszego, aby używać go przy dostawach w grafiku.</p>`
          }
        </section>
      `;

      root.querySelector("[data-catering-recipients-add]")?.addEventListener("click", () => {
        openCateringRecipientEditorModal(null, async () => {
          await renderCateringRecipientsPanel("");
        });
      });

      root.querySelectorAll("[data-catering-recipient-edit]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-catering-recipient-edit");
          const rec = list.find((x) => String(x.id) === String(id));
          if (!rec) return;
          openCateringRecipientEditorModal(rec, async () => {
            await renderCateringRecipientsPanel("");
          });
        });
      });

      root.querySelectorAll("[data-catering-recipient-delete]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.getAttribute("data-catering-recipient-delete");
          if (!id) return;
          if (!window.confirm("Usunąć tego odbiorcę? Nie usuniesz odbiorcy, jeśli ma aktywne lub przyszłe rezerwacje dostawy.")) {
            return;
          }
          try {
            await bookingAdminApi("restaurant", "admin-catering-recipient-delete", {
              method: "DELETE",
              query: { id },
            });
            await refreshCateringRecipientsState();
            await renderCateringRecipientsPanel("Odbiorca został usunięty.");
          } catch (error) {
            window.alert(error.message || "Nie udało się usunąć odbiorcy.");
          }
        });
      });
    };

    try {
      const data = await bookingAdminApi("restaurant", "admin-catering-recipients-list");
      const recipients = data?.recipients || [];
      state.schedule.cateringRecipients = Array.isArray(recipients) ? recipients : [];
      paint(recipients, statusMessage);
    } catch (error) {
      root.innerHTML = `
        <section class="panel col-12">
          <p class="pill">Catering</p>
          <h2>Odbiorcy</h2>
          <p class="status">${escapeHtml(error.message || "Nie udało się pobrać listy odbiorców.")}</p>
          <button type="button" class="button secondary" data-catering-recipients-retry>Spróbuj ponownie</button>
        </section>
      `;
      root.querySelector("[data-catering-recipients-retry]")?.addEventListener("click", () => {
        renderCateringRecipientsPanel("");
      });
    }
  }

  function renderHotelBookingSettingsPanel(statusMessage = "") {
    renderDomainBookingSettingsPanel("#hotel-booking-settings-panel", {
      title: "Hotel",
      enabledId: "booking-enable-hotel",
      toggleLabel: "Hotel",
      pauseRangesKey: "hotelPauseRanges",
      pauseLabel: "Hotel",
      statusMessage,
      disabled: !adminLegacyBookingsEnabled,
    });
  }

  function renderRestaurantBookingSettingsPanel(statusMessage = "") {
    renderDomainBookingSettingsPanel("#restaurant-booking-settings-panel", {
      title: "Catering",
      enabledId: "booking-enable-restaurant",
      toggleLabel: "Catering",
      pauseRangesKey: "restaurantPauseRanges",
      pauseLabel: "Catering",
      statusMessage,
      disabled: !adminLegacyBookingsEnabled,
    });
  }

  function renderEventsBookingSettingsPanel(statusMessage = "") {
    renderDomainBookingSettingsPanel("#events-booking-settings-panel", {
      title: "Przyjecia",
      enabledId: "booking-enable-events",
      toggleLabel: "Przyjecia",
      pauseRangesKey: "eventsPauseRanges",
      pauseLabel: "Przyjecia / sale",
      statusMessage,
      disabled: !adminLegacyBookingsEnabled,
    });
  }

  function renderHomeSectionMediaPanel(sectionKey, panelSelector, panelLabel, statusMessage = "") {
    const panel = document.querySelector(panelSelector);
    if (!panel) return;

    if (!state.content.home) {
      state.content.home = {};
    }
    state.content.home.sectionMedia = normalizeHomeSectionMedia(state.content.home.sectionMedia);
    const media = state.content.home.sectionMedia[sectionKey];
    const defaults = HOME_SECTION_MEDIA_DEFAULTS[sectionKey] || HOME_SECTION_MEDIA_DEFAULTS.hotel;
    const messageId = `home-media-status-${sectionKey}`;

    panel.innerHTML = `
      <p class="pill">${escapeHtml(panelLabel)}</p>
      <h2>Strona glowna</h2>
      <div class="stack home-media-editor">
        <form class="repeater-item upload-room-gallery-form home-media-upload-form" data-home-media-upload-form="${escapeAttribute(sectionKey)}">
          <label class="field-full">
            <span>Nowe zdjecie</span>
            <input type="file" name="image" accept="image/*" required />
          </label>
          <button class="button" type="submit">Wgraj zdjecie</button>
          <button class="button secondary" type="button" data-home-media-reset="${escapeAttribute(sectionKey)}">Przywroc domyslne</button>
        </form>

        <div class="field-grid home-media-controls">
          <label class="field-full">
            <span>Pozycja pozioma (X)</span>
            <div class="home-media-control-pair">
              <input type="range" min="0" max="100" step="1" data-home-media-field="focusX" value="${escapeAttribute(String(clampNumber(media.focusX, 0, 100, defaults.focusX)))}" />
              <input type="number" min="0" max="100" step="1" data-home-media-field="focusX" value="${escapeAttribute(String(clampNumber(media.focusX, 0, 100, defaults.focusX)))}" />
            </div>
          </label>
          <label class="field-full">
            <span>Pozycja pionowa (Y)</span>
            <div class="home-media-control-pair">
              <input type="range" min="0" max="100" step="1" data-home-media-field="focusY" value="${escapeAttribute(String(clampNumber(media.focusY, 0, 100, defaults.focusY)))}" />
              <input type="number" min="0" max="100" step="1" data-home-media-field="focusY" value="${escapeAttribute(String(clampNumber(media.focusY, 0, 100, defaults.focusY)))}" />
            </div>
          </label>
          <label class="field-full">
            <span>Zoom</span>
            <div class="home-media-control-pair">
              <input type="range" min="1" max="2.5" step="0.01" data-home-media-field="zoom" value="${escapeAttribute(String(clampNumber(media.zoom, 1, 2.5, defaults.zoom)))}" />
              <input type="number" min="1" max="2.5" step="0.01" data-home-media-field="zoom" value="${escapeAttribute(String(clampNumber(media.zoom, 1, 2.5, defaults.zoom)))}" />
            </div>
          </label>
        </div>

        <div class="home-media-preview-shell">
          <strong>Podglad kafelka</strong>
          <div class="home-media-preview" id="home-media-preview-${escapeAttribute(sectionKey)}">
            <img src="${escapeAttribute(media.imageUrl || "")}" alt="${escapeAttribute(media.imageAlt || panelLabel)}" />
            <div class="home-media-preview-overlay">${escapeHtml(panelLabel)}</div>
          </div>
        </div>
        <p class="status" id="${escapeAttribute(messageId)}">${escapeHtml(statusMessage)}</p>
      </div>
    `;

    const statusNode = panel.querySelector(`#${messageId}`);
    const preview = panel.querySelector(`#home-media-preview-${sectionKey}`);
    const previewImg = preview?.querySelector("img");

    const setStatus = (text) => {
      if (statusNode) {
        statusNode.textContent = text || "";
      }
    };

    const applyPreview = () => {
      if (!preview) return;
      preview.style.setProperty("--home-media-focus-x", `${clampNumber(media.focusX, 0, 100, defaults.focusX)}%`);
      preview.style.setProperty("--home-media-focus-y", `${clampNumber(media.focusY, 0, 100, defaults.focusY)}%`);
      preview.style.setProperty("--home-media-zoom", String(clampNumber(media.zoom, 1, 2.5, defaults.zoom)));
      if (previewImg) {
        previewImg.src = media.imageUrl || defaults.imageUrl;
        previewImg.alt = media.imageAlt || panelLabel;
      }
    };

    const syncFieldInputs = (field, value) => {
      panel.querySelectorAll(`[data-home-media-field="${field}"]`).forEach((input) => {
        if (input instanceof HTMLInputElement && input.value !== String(value)) {
          input.value = String(value);
        }
      });
    };

    const updateMediaField = (field, rawValue) => {
      if (field === "zoom") {
        media.zoom = clampNumber(rawValue, 1, 2.5, defaults.zoom);
        syncFieldInputs(field, media.zoom);
      } else if (field === "focusX") {
        media.focusX = clampNumber(rawValue, 0, 100, defaults.focusX);
        syncFieldInputs(field, media.focusX);
      } else if (field === "focusY") {
        media.focusY = clampNumber(rawValue, 0, 100, defaults.focusY);
        syncFieldInputs(field, media.focusY);
      }
      refreshSaveDockVisibility();
      applyPreview();
      setStatus("Zmiany sa gotowe do publikacji. Wystarczy uzyc glownego przycisku Zapisz.");
    };

    panel.querySelectorAll('[data-home-media-field="focusX"], [data-home-media-field="focusY"], [data-home-media-field="zoom"]').forEach((input) => {
      input.addEventListener("input", () => {
        updateMediaField(input.getAttribute("data-home-media-field"), input.value);
      });
      input.addEventListener("change", () => {
        updateMediaField(input.getAttribute("data-home-media-field"), input.value);
      });
    });

    panel.querySelector(`[data-home-media-reset="${sectionKey}"]`)?.addEventListener("click", () => {
      media.imageUrl = defaults.imageUrl;
      media.imageAlt = defaults.imageAlt || panelLabel;
      media.focusX = clampNumber(defaults.focusX, 0, 100, defaults.focusX);
      media.focusY = clampNumber(defaults.focusY, 0, 100, defaults.focusY);
      media.zoom = clampNumber(defaults.zoom, 1, 2.5, defaults.zoom);
      syncFieldInputs("focusX", media.focusX);
      syncFieldInputs("focusY", media.focusY);
      syncFieldInputs("zoom", media.zoom);
      refreshSaveDockVisibility();
      applyPreview();
      setStatus("Przywrocono domyslny obraz i kadrowanie. Zapiszesz to glownym przyciskiem Zapisz.");
    });

    panel.querySelector(`[data-home-media-upload-form="${sectionKey}"]`)?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!(form instanceof HTMLFormElement)) return;
      const fileInput = form.querySelector('input[name="image"]');
      const file = fileInput?.files?.[0];
      if (!file) {
        setStatus("Wybierz plik graficzny.");
        return;
      }
      try {
        setStatus("Kompresowanie i przygotowanie zdjecia...");
        const compressed = await compressImageFile(file, { maxBytes: INLINE_IMAGE_MAX_BYTES });
        media.imageUrl = await blobToDataUrl(compressed);
        if (!media.imageAlt) {
          media.imageAlt = defaults.imageAlt || panelLabel;
        }
        refreshSaveDockVisibility();
        applyPreview();
        setStatus("Zdjecie zostalo podmienione. Wystarczy teraz uzyc glownego przycisku Zapisz.");
        form.reset();
      } catch (error) {
        setStatus(error.message || "Nie udalo sie przygotowac zdjecia.");
      }
    });

    applyPreview();
  }

  function renderRestaurantOpeningHoursPanel(statusMessage = "") {
    const panel = document.querySelector("#restaurant-opening-hours-panel");
    if (!panel) return;

    panel.innerHTML = `
      <p class="pill">Catering</p>
      <h2>Godziny dowozów</h2>
      <p class="section-intro">Te godziny pojawiaja sie w kafelku „Godziny dowozów” na stronie cateringu.</p>
      <div class="stack">
        ${renderOpeningHoursEditorMarkup(state.content.company?.openingHours, {
          intro: "Ustaw przedział dowozu (od–do) dla kazdego dnia osobno. Puste pola zapisza dzien bez dowozu.",
        })}
        <p class="status">${escapeHtml(statusMessage)}</p>
      </div>
    `;
  }

  function renderRestaurantOrderPanel(statusMessage = "") {
    const panel = document.querySelector("#restaurant-order-panel");
    if (!panel) return;
    const currentInfoText =
      state.content.restaurant?.ordersInfoText ||
      "<p>Ceny oraz zasady współpracy ustalane indywidualnie.</p><p>Prosimy o kontakt telefoniczny i mailowy lub poprzez formularz kontaktowy.</p>";

    panel.innerHTML = `
      <p class="pill">Catering</p>
      <h2>Zamówienia</h2>
      <p class="section-intro">Edytuj tresc modala widocznego po kliknieciu kafelka "Zamówienia" na stronie cateringu.</p>
      <div class="stack">
        <div class="field-full">
          <span>Tresc modala</span>
          <div class="admin-richtext">
            <div class="admin-richtext-toolbar" id="restaurant-orders-editor-toolbar">
              <button class="button secondary" type="button" data-richtext-command="bold" title="Pogrubienie"><strong>B</strong></button>
              <button class="button secondary" type="button" data-richtext-command="italic" title="Kursywa"><em>I</em></button>
              <button class="button secondary" type="button" data-richtext-command="underline" title="Podkreslenie"><span style="text-decoration: underline;">U</span></button>
              <button class="button secondary" type="button" data-richtext-block="h2" title="Naglowek">H2</button>
              <button class="button secondary" type="button" data-richtext-block="p" title="Akapit">Akapit</button>
              <button class="button secondary" type="button" data-richtext-command="insertUnorderedList" title="Lista punktowana">Lista</button>
              <button class="button secondary" type="button" data-richtext-command="justifyLeft" title="Do lewej">Lewo</button>
              <button class="button secondary" type="button" data-richtext-command="justifyCenter" title="Wysrodkuj">Srodek</button>
              <button class="button secondary" type="button" data-richtext-command="justifyRight" title="Do prawej">Prawo</button>
              <button class="button secondary" type="button" data-richtext-command="createLink" title="Wstaw link">Link</button>
              <label class="admin-richtext-size">
                <span>Rozmiar</span>
                <select data-richtext-font-size>
                  <option value="">--</option>
                  <option value="0.9rem">Maly</option>
                  <option value="1rem">Normalny</option>
                  <option value="1.1rem">Sredni</option>
                  <option value="1.25rem">Duzy</option>
                  <option value="1.5rem">XL</option>
                </select>
              </label>
              <label class="admin-richtext-size">
                <span>Czcionka</span>
                <select data-richtext-font-family>
                  <option value="">--</option>
                  <option value="Manrope, sans-serif">Manrope</option>
                  <option value="'Cormorant Garamond', serif">Cormorant Garamond</option>
                  <option value="Arial, sans-serif">Arial</option>
                  <option value="'Times New Roman', serif">Times New Roman</option>
                </select>
              </label>
              <label class="admin-richtext-size">
                <span>Kolor</span>
                <input type="color" data-richtext-color value="#1f1712" />
              </label>
            </div>
            <div class="admin-richtext-editor" id="restaurant-orders-editor" contenteditable="true"></div>
            <textarea id="restaurant-orders-info-html" rows="10" hidden>${escapeHtml(currentInfoText)}</textarea>
          </div>
        </div>
        <p class="helper">Edytor wizualny zapisuje wyglad tresci wyswietlanej w modalu "Zamowienia i catering".</p>
        <p class="status">${escapeHtml(statusMessage)}</p>
      </div>
    `;
    initRestaurantOrdersRichTextEditor();
  }

  function renderEventsOfferPanel(statusMessage = "") {
    const panel = document.querySelector("#events-offer-panel");
    if (!panel) return;

    panel.innerHTML = `
      <p class="pill">Przyjecia</p>
      <h2>Oferta</h2>
      <p class="section-intro">Edytujesz tresc modala otwieranego z kafelka "Oferta" na stronie Przyjecia.</p>
      <div class="stack">
        <div class="field-full">
          <span>Treść oferty</span>
          <div class="admin-richtext">
            <div class="admin-richtext-toolbar" id="events-oferta-editor-toolbar">
              <button class="button secondary" type="button" data-richtext-command="bold" title="Pogrubienie"><strong>B</strong></button>
              <button class="button secondary" type="button" data-richtext-command="italic" title="Kursywa"><em>I</em></button>
              <button class="button secondary" type="button" data-richtext-command="underline" title="Podkreslenie"><span style="text-decoration: underline;">U</span></button>
              <button class="button secondary" type="button" data-richtext-block="h2" title="Naglowek">H2</button>
              <button class="button secondary" type="button" data-richtext-block="p" title="Akapit">Akapit</button>
              <button class="button secondary" type="button" data-richtext-command="insertUnorderedList" title="Lista punktowana">Lista</button>
              <button class="button secondary" type="button" data-richtext-command="justifyLeft" title="Do lewej">Lewo</button>
              <button class="button secondary" type="button" data-richtext-command="justifyCenter" title="Wysrodkuj">Srodek</button>
              <button class="button secondary" type="button" data-richtext-command="justifyRight" title="Do prawej">Prawo</button>
              <button class="button secondary" type="button" data-richtext-command="createLink" title="Wstaw link">Link</button>
              <label class="admin-richtext-size">
                <span>Rozmiar</span>
                <select data-richtext-font-size>
                  <option value="">--</option>
                  <option value="0.9rem">Maly</option>
                  <option value="1rem">Normalny</option>
                  <option value="1.1rem">Sredni</option>
                  <option value="1.25rem">Duzy</option>
                  <option value="1.5rem">XL</option>
                </select>
              </label>
            </div>
            <div class="admin-richtext-editor" id="events-oferta-modal-editor" contenteditable="true"></div>
            <textarea id="events-oferta-modal-html" rows="18" hidden>${escapeHtml(state.content.events?.ofertaModalBodyHtml || "")}</textarea>
          </div>
        </div>
        <p class="helper">Edytor wizualny zapisuje gotowy wyglad tresci modala "Oferta".</p>
        <p class="status">${escapeHtml(statusMessage)}</p>
      </div>
    `;
    initOfertaRichTextEditor();
  }

  function renderEventsHallsPanel(statusMessage = "") {
    const panel = document.querySelector("#events-halls-panel");
    if (!panel) return;

    panel.innerHTML = `
      <p class="pill">Przyjecia</p>
      <h2>Sale</h2>
      <p class="section-intro">W obiekcie sa dwie sale: duza i mala. Tutaj edytujesz ich nazwy, pojemnosci i opisy.</p>
      <div class="stack">
        <div class="repeater-head"><strong>Lista sal</strong></div>
        <div id="halls-list" class="repeater-list"></div>
        <p class="status">${escapeHtml(statusMessage)}</p>
      </div>
    `;

    bindRepeaterButtons();
    renderHallsList();
  }

  function renderContactPanel(statusMessage = "") {
    const panel = document.querySelector("#contact-panel");
    if (!panel) return;
    const company = state.content.company || {};
    const home = state.content.home || {};

    panel.innerHTML = `
      <p class="pill">Kontakt</p>
      <h2>Dane kontaktowe</h2>
      <p class="section-intro">Te pola zasilaja dane kontaktowe w serwisie i panelu.</p>
      <div class="stack">
        <div class="field-grid">
          <label class="field"><span>Nazwa</span><input id="company-name" value="${escapeAttribute(company.name || "")}" /></label>
          <label class="field"><span>Telefon</span><input id="company-phone" value="${escapeAttribute(company.phone || "")}" /></label>
          <label class="field"><span>E-mail</span><input id="company-email" value="${escapeAttribute(company.email || "")}" /></label>
          <label class="field"><span>Adres</span><input id="company-address" value="${escapeAttribute(company.address || "")}" /></label>
          <label class="field-full"><span>Naglowek sekcji właściciel (modal Kontakt)</span><input id="home-about-title" value="${escapeAttribute(home.aboutTitle || "")}" /></label>
          <label class="field-full"><span>Tekst o firmie (pierwszy akapit)</span><textarea id="home-about-text">${escapeHtml(home.aboutText || "")}</textarea></label>
          <label class="field-full"><span>Tekst o wlascicielu (drugi akapit)</span><textarea id="home-owner">${escapeHtml(home.owner || "")}</textarea></label>
        </div>
        <p class="status">${escapeHtml(statusMessage)}</p>
      </div>
    `;
  }

  function renderSubmissionsPanel() {
    const panel = document.querySelector("#submissions-panel");
    panel.innerHTML = `
      <p class="pill">Formularz kontaktowy</p>
      <h2>Zgloszenia</h2>
      <p class="section-intro">Tutaj wpadaja wiadomosci wyslane przez formularz kontaktowy.</p>
      <div class="stack">
        ${
          state.submissions.length
            ? state.submissions
                .map(
                  (submission) => `
                    <article class="list-item">
                      <div class="list-head">
                        <strong>${escapeHtml(submission.fullName)}</strong>
                        <span class="pill">${escapeHtml(submission.status)}</span>
                      </div>
                      <div class="submission-meta">
                        <span>${escapeHtml(submission.email)}</span>
                        <span>${escapeHtml(submission.phone || "")}</span>
                        <span>${escapeHtml(submission.eventType || "")}</span>
                      </div>
                      <p>${escapeHtml(submission.message)}</p>
                      <p class="helper">${escapeHtml(submission.preferredDate || "")} | ${escapeHtml(submission.createdAt || "")}</p>
                      <div class="inline-actions">
                        <button class="button secondary" type="button" data-submission-status="${submission.id}" data-status="new">Oznacz jako nowe</button>
                        <button class="button" type="button" data-submission-status="${submission.id}" data-status="processed">Oznacz jako obsluzone</button>
                      </div>
                    </article>`
                )
                .join("")
            : `<p class="empty">Brak zgloszen.</p>`
        }
      </div>
    `;
    panel.querySelectorAll("[data-submission-status]").forEach((button) => {
      button.addEventListener("click", () => updateSubmissionStatus(button.dataset.submissionStatus, button.dataset.status));
    });
  }

  async function updateSubmissionStatus(id, status) {
    await api(`/api/admin/submissions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await loadDashboard();
  }

  function renderGalleryPanel(statusMessage = "") {
    const panel = document.querySelector("#gallery-panel");
    if (!panel) return;
    const mediaEnabled = state.capabilities?.mediaStorageEnabled === true;
    const albums = Array.isArray(state.galleryAlbums) ? state.galleryAlbums : [];
    panel.innerHTML = `
      <p class="pill">Imprezy</p>
      <h2>Albumy wydarzen</h2>
      <p class="section-intro">Albumy dodawane tutaj trafiaja do sekcji "Imprezy" w galerii strony Przyjecia. Wystarczy sam tytul albumu.</p>
      ${mediaEnabled ? "" : '<p class="status">Upload galerii jest obecnie niedostepny.</p>'}
      <div class="events-gallery-admin">
        <div class="repeater-item events-gallery-admin__create">
          <h3>Nowy album</h3>
          <p class="helper">Nowe albumy pojawiaja sie w sekcji "Imprezy". Kolejnosc albumow i zdjec ustawiasz przyciskami obok.</p>
          <form id="album-form" class="stack">
            <label class="field-full"><span>Tytul albumu</span><input name="title" required ${mediaEnabled ? "" : "disabled"} /></label>
            <button class="button" type="submit" ${mediaEnabled ? "" : "disabled"}>Dodaj album</button>
          </form>
          <p class="status">${escapeHtml(statusMessage)}</p>
        </div>
        <div class="events-gallery-admin__content stack">
          ${
            albums.length
              ? albums
                  .map(
                    (album, albumIndex) => `
                      <article class="repeater-item events-gallery-album-card">
                        <div class="repeater-head">
                          <div>
                            <h3>${escapeHtml(album.title)}</h3>
                            <p class="helper">${escapeHtml(String(album.images?.length || 0))} zdjec w albumie</p>
                          </div>
                          <div class="inline-actions">
                            <button class="button secondary" type="button" data-move-album="${escapeAttribute(album.id)}" data-direction="-1" aria-label="Przesun album w gore" ${albumIndex === 0 || !mediaEnabled ? "disabled" : ""}>↑</button>
                            <button class="button secondary" type="button" data-move-album="${escapeAttribute(album.id)}" data-direction="1" aria-label="Przesun album w dol" ${albumIndex === albums.length - 1 || !mediaEnabled ? "disabled" : ""}>↓</button>
                            <button class="button danger" type="button" data-delete-album="${escapeAttribute(album.id)}" aria-label="Usun caly album" ${mediaEnabled ? "" : "disabled"}>Usun album</button>
                          </div>
                        </div>
                        <form class="upload-room-gallery-form upload-room-gallery-form--album" data-upload-album="${escapeAttribute(album.id)}">
                          <label class="field field-full upload-room-gallery-picker">
                            <span>Dodaj zdjecia do albumu</span>
                            <input class="upload-room-gallery-picker__input" type="file" name="images" accept="image/*" multiple ${mediaEnabled ? "" : "disabled"} />
                            <span class="upload-room-gallery-picker__surface">
                              <strong class="upload-room-gallery-picker__button">Wybierz pliki</strong>
                              <span class="upload-room-gallery-picker__text" data-gallery-file-label="${escapeAttribute(album.id)}">Nie wybrano jeszcze zadnych plikow.</span>
                            </span>
                          </label>
                          <button class="button secondary" type="submit" ${mediaEnabled ? "" : "disabled"}>Wgraj zdjecia</button>
                        </form>
                        <div class="thumb-grid">
                          ${
                            album.images && album.images.length
                              ? album.images
                                  .map(
                                    (image, imageIndex) => `
                                      <article class="thumb-card">
                                        <img src="${escapeAttribute(image.url)}" alt="${escapeAttribute(image.alt || album.title)}" />
                                        <div class="inline-actions">
                                          <button class="button secondary" type="button" data-move-album-image="${escapeAttribute(album.id)}" data-image-id="${escapeAttribute(image.id)}" data-direction="-1" aria-label="Przesun zdjecie w lewo" ${imageIndex === 0 || !mediaEnabled ? "disabled" : ""}>←</button>
                                          <button class="button secondary" type="button" data-move-album-image="${escapeAttribute(album.id)}" data-image-id="${escapeAttribute(image.id)}" data-direction="1" aria-label="Przesun zdjecie w prawo" ${imageIndex === album.images.length - 1 || !mediaEnabled ? "disabled" : ""}>→</button>
                                          <button class="button danger" type="button" data-delete-image="${escapeAttribute(image.id)}" ${mediaEnabled ? "" : "disabled"}>Usun</button>
                                        </div>
                                      </article>`
                                  )
                                  .join("")
                              : `<p class="empty">Brak zdjec w albumie.</p>`
                          }
                        </div>
                      </article>`
                  )
                  .join("")
              : `<div class="repeater-item"><p class="empty">Nie ma jeszcze albumow wydarzen.</p></div>`
          }
        </div>
      </div>
    `;

    const albumForm = document.querySelector("#album-form");
    albumForm?.addEventListener("submit", createAlbum);
    panel.querySelectorAll("[data-upload-album]").forEach((form) => {
      form.addEventListener("submit", uploadAlbumImages);
      const fileInput = form.querySelector('input[name="images"]');
      const fileLabel = form.querySelector("[data-gallery-file-label]");
      fileInput?.addEventListener("change", () => {
        const count = fileInput.files?.length || 0;
        if (!fileLabel) return;
        if (!count) {
          fileLabel.textContent = "Nie wybrano jeszcze zadnych plikow.";
        } else if (count === 1) {
          fileLabel.textContent = fileInput.files[0]?.name || "Wybrano 1 plik.";
        } else {
          fileLabel.textContent = `Wybrano ${count} pliki do wgrania.`;
        }
      });
    });
    panel.querySelectorAll("[data-move-album]").forEach((button) => {
      button.addEventListener("click", () => moveAlbum(button.dataset.moveAlbum, Number(button.dataset.direction)));
    });
    panel.querySelectorAll("[data-move-album-image]").forEach((button) => {
      button.addEventListener("click", () =>
        moveAlbumImage(button.dataset.moveAlbumImage, button.dataset.imageId, Number(button.dataset.direction))
      );
    });
    panel.querySelectorAll("[data-delete-image]").forEach((button) => {
      button.addEventListener("click", () => deleteImage(button.dataset.deleteImage));
    });
    panel.querySelectorAll("[data-delete-album]").forEach((button) => {
      button.addEventListener("click", () => deleteAlbum(button.dataset.deleteAlbum));
    });
  }

  async function createAlbum(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const title = String(new FormData(form).get("title") || "").trim();
    try {
      await api("/api/admin/gallery/albums", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      form.reset();
      await loadDashboard("Album zostal dodany.");
    } catch (error) {
      renderGalleryPanel(error.message);
    }
  }

  async function uploadAlbumImages(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const albumId = form.dataset.uploadAlbum;
    const rawFormData = new FormData(form);
    const files = rawFormData.getAll("images").filter((entry) => entry instanceof File && entry.size);
    if (!files.length) {
      renderGalleryPanel("Wybierz zdjecia do wgrania.");
      return;
    }
    try {
      const authHeaders = await getFirebaseAuthHeaders();
      const prepared = new FormData();
      const compressed = await Promise.all(
        files.map((file) => compressImageFile(file, { maxBytes: API_IMAGE_MAX_BYTES }))
      );
      compressed.forEach((file) => prepared.append("images", file, file.name));
      await fetch(state.apiBase + `/api/admin/gallery/albums/${albumId}/images`, {
        method: "POST",
        body: prepared,
        credentials: "include",
        headers: authHeaders,
      }).then(async (response) => {
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || "Nie udalo sie wgrac zdjec.");
        }
      });
      await loadDashboard("Zdjecia zostaly wgrane.");
    } catch (error) {
      renderGalleryPanel(error.message);
    }
  }

  async function moveAlbum(albumId, direction) {
    try {
      const albums = Array.isArray(state.galleryAlbums) ? [...state.galleryAlbums] : [];
      const index = albums.findIndex((album) => String(album.id) === String(albumId));
      const nextIndex = index + direction;
      if (index === -1 || nextIndex < 0 || nextIndex >= albums.length) {
        return;
      }
      [albums[index], albums[nextIndex]] = [albums[nextIndex], albums[index]];
      await api("/api/admin/gallery/albums/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ albumIds: albums.map((album) => Number(album.id)) }),
      });
      await loadDashboard("Kolejnosc albumow zostala zmieniona.");
    } catch (error) {
      renderGalleryPanel(error.message || "Nie udalo sie zmienic kolejnosci albumow.");
    }
  }

  async function moveAlbumImage(albumId, imageId, direction) {
    try {
      const album = (state.galleryAlbums || []).find((entry) => String(entry.id) === String(albumId));
      if (!album || !Array.isArray(album.images)) {
        return;
      }
      const images = [...album.images];
      const index = images.findIndex((image) => String(image.id) === String(imageId));
      const nextIndex = index + direction;
      if (index === -1 || nextIndex < 0 || nextIndex >= images.length) {
        return;
      }
      [images[index], images[nextIndex]] = [images[nextIndex], images[index]];
      await api(`/api/admin/gallery/albums/${albumId}/reorder-images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageIds: images.map((image) => Number(image.id)) }),
      });
      await loadDashboard("Kolejnosc zdjec zostala zmieniona.");
    } catch (error) {
      renderGalleryPanel(error.message || "Nie udalo sie zmienic kolejnosci zdjec.");
    }
  }

  async function deleteImage(imageId) {
    await api(`/api/admin/gallery/images/${imageId}`, { method: "DELETE" });
    await loadDashboard("Zdjecie zostalo usuniete.");
  }

  async function deleteAlbum(albumId) {
    if (!window.confirm("Usunac ten album wraz ze wszystkimi zdjeciami? Tej operacji nie da sie cofnac.")) {
      return;
    }
    try {
      await api(`/api/admin/gallery/albums/${albumId}`, { method: "DELETE" });
      await loadDashboard("Album zostal usuniety.");
    } catch (error) {
      renderGalleryPanel(error.message || "Nie udalo sie usunac albumu.");
    }
  }

  function getMenuEditorConfig(kind) {
    if (kind === "restaurant") {
      return {
        panelSelector: "#restaurant-menu-panel",
        pill: "Catering",
        title: "Menu cateringu",
        intro:
          "Wspolna karta z menu na stronie Przyjec — zmiany tutaj i tam sa identyczne. Najpierw wybierasz kategorie, potem edytujesz je i produkty w modalach.",
        includePrice: true,
        emptyState: "Nie ma jeszcze zadnej kategorii. Dodaj pierwsza i uzupelnij ja w osobnym oknie.",
        categoryLabel: "Kategoria",
        productLabel: "Produkt",
      };
    }

    return {
      panelSelector: "#events-menu-panel",
      pill: "Przyjecia",
      title: "Menu okolicznosciowe",
      intro:
        "To samo menu co w zakladce Catering — zmiany tutaj i tam zapisuja jedna wspolna karte (w tym ceny). Edycja modalami: kategorie na planszy, szczegoly w osobnych oknach.",
      includePrice: true,
      emptyState: "Nie ma jeszcze zadnej kategorii. Dodaj pierwsza i uzupelnij ja w osobnym oknie.",
      categoryLabel: "Kategoria",
      productLabel: "Produkt",
    };
  }

  function getMenuEditorRoot(kind) {
    return document.querySelector(getMenuEditorConfig(kind).panelSelector);
  }

  function getMenuEditorState(kind) {
    if (!state.ui.menuEditors) {
      state.ui.menuEditors = {};
    }
    if (!state.ui.menuEditors[kind]) {
      state.ui.menuEditors[kind] = { statusMessage: "" };
    }
    return state.ui.menuEditors[kind];
  }

  function getActiveMenuEditorKind() {
    if (state.ui.view !== "section") return "";
    const topTab = state.ui.topTab;
    const tileKey = getActiveAdminTile(topTab);
    if (topTab === "restauracja" && tileKey === "menu") return "restaurant";
    if (topTab === "przyjecia" && tileKey === "menu") return "events";
    return "";
  }

  const MENU_EDITOR_UNCATEGORIZED_KEY = "__menu_editor_uncategorized__";

  function getMenuSectionsByKind(kind) {
    if (!state.content.restaurant) {
      state.content.restaurant = {};
    }
    if (!Array.isArray(state.content.restaurant.menu)) {
      state.content.restaurant.menu = [];
    }
    state.content.restaurant.menu.forEach((section) => {
      syncMenuEditorSectionSubcategories(section);
      syncMenuEditorSectionSubcategoryOrder(section);
    });
    if (kind === "events") {
      if (!state.content.events) {
        state.content.events = {};
      }
      state.content.events.menu = state.content.restaurant.menu;
    }
    return state.content.restaurant.menu;
  }

  function createMenuEditorItem(kind, overrides = {}) {
    const baseItem = { name: "", price: "", description: "", ingredients: [] };
    return { ...baseItem, ...overrides };
  }

  function getMenuEditorSectionSubcategories(section) {
    return Array.from(
      new Set([
        ...(Array.isArray(section?.subcategories) ? section.subcategories : []),
        ...((section?.items || []).map((item) => item?.subcategory).filter(Boolean)),
      ])
    )
      .map((value) => String(value || "").trim())
      .filter(Boolean);
  }

  function syncMenuEditorSectionSubcategories(section) {
    if (!section || typeof section !== "object") return section;
    const subcategories = getMenuEditorSectionSubcategories(section);
    if (subcategories.length) {
      section.subcategories = subcategories;
    } else {
      delete section.subcategories;
    }
    return section;
  }

  function encodeMenuEditorSubcategoryOrderValue(value) {
    return value === "" ? MENU_EDITOR_UNCATEGORIZED_KEY : value;
  }

  function decodeMenuEditorSubcategoryOrderValue(value) {
    const normalized = String(value || "").trim();
    return normalized === MENU_EDITOR_UNCATEGORIZED_KEY ? "" : normalized;
  }

  function getMenuEditorSectionSubcategoryOrder(section, options = {}) {
    const { includeDefault = true } = options;
    const namedSubcategories = getMenuEditorSectionSubcategories(section);
    const storedOrder = Array.isArray(section?.subcategoryOrder)
      ? section.subcategoryOrder
          .map(decodeMenuEditorSubcategoryOrderValue)
          .filter((value, index, source) => (value === "" ? true : Boolean(value)) && source.indexOf(value) === index)
      : [];
    const ordered = [];

    storedOrder.forEach((value) => {
      if (value === "") {
        if (includeDefault && !ordered.includes("")) {
          ordered.push("");
        }
        return;
      }
      if (namedSubcategories.includes(value) && !ordered.includes(value)) {
        ordered.push(value);
      }
    });

    const defaultIndex = ordered.indexOf("");
    const missingNamed = namedSubcategories.filter((value) => !ordered.includes(value));
    if (defaultIndex >= 0) {
      ordered.splice(defaultIndex, 0, ...missingNamed);
    } else {
      ordered.push(...missingNamed);
    }

    if (includeDefault && !ordered.includes("")) {
      ordered.push("");
    }

    return ordered;
  }

  function syncMenuEditorSectionSubcategoryOrder(section) {
    if (!section || typeof section !== "object") return [];
    const order = getMenuEditorSectionSubcategoryOrder(section);
    if (order.length) {
      section.subcategoryOrder = order.map(encodeMenuEditorSubcategoryOrderValue);
    } else {
      delete section.subcategoryOrder;
    }
    return order;
  }

  function reorderMenuEditorSectionItemsBySubcategoryOrder(section) {
    if (!section || !Array.isArray(section.items)) return;
    const order = syncMenuEditorSectionSubcategoryOrder(section);
    const groupedEntries = new Map();

    section.items.forEach((item) => {
      const key = String(item?.subcategory || "").trim();
      if (!groupedEntries.has(key)) {
        groupedEntries.set(key, []);
      }
      groupedEntries.get(key).push(item);
    });

    section.items = order.flatMap((key) => groupedEntries.get(key) || []);
  }

  function buildMenuEditorSummary(section) {
    const items = Array.isArray(section?.items) ? section.items.length : 0;
    const subcategories = getMenuEditorSectionSubcategories(section).length;
    return `${items} pozycji${subcategories ? ` • ${subcategories} podkategorii` : ""}`;
  }

  function parseMenuEditorIngredients(value) {
    return String(value || "")
      .split(/\r?\n|,|;/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function truncateMenuEditorText(value, maxLength = 150) {
    const text = String(value || "").trim();
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, maxLength - 1).trimEnd()}…`;
  }

  function getMenuEditorStatus(kind) {
    return getMenuEditorState(kind).statusMessage || "";
  }

  function setMenuEditorStatus(kind, message = "") {
    getMenuEditorState(kind).statusMessage = message;
  }

  function getMenuEditorModalState() {
    return state.ui.menuEditorModal || null;
  }

  function getMenuEditorCategoryPreview(section) {
    return (section.items || [])
      .slice(0, 3)
      .map((item) => item?.name)
      .filter(Boolean)
      .join(", ");
  }

  function buildMenuEditorItemMeta(item, includePrice) {
    const parts = [];
    if (includePrice && item?.price) {
      parts.push(item.price);
    }
    if (item?.subcategory) {
      parts.push(item.subcategory);
    }
    if (item?.ingredients?.length) {
      parts.push(`${item.ingredients.length} skladnikow`);
    }
    return parts.join(" • ");
  }

  function getMenuEditorSectionLabel(section, index) {
    return String(section?.section || "").trim() || `Kategoria ${index + 1}`;
  }

  function getMenuEditorCategoryOptions(kind) {
    return getMenuSectionsByKind(kind).map((section, index) => ({
      value: String(index),
      label: getMenuEditorSectionLabel(section, index),
    }));
  }

  function getMenuEditorSubcategoryOptions(kind, sectionIndex) {
    const section = getMenuSectionsByKind(kind)[sectionIndex];
    return getMenuEditorSectionSubcategories(section);
  }

  function buildMenuEditorSectionGroups(section) {
    const items = Array.isArray(section?.items) ? section.items : [];
    const orderedSubcategories = getMenuEditorSectionSubcategoryOrder(section);
    const groupsByKey = new Map();

    orderedSubcategories.forEach((name) => {
      groupsByKey.set(name, {
        key: name,
        name: name || "Inne",
        isUncategorized: name === "",
        entries: [],
      });
    });

    items.forEach((item, index) => {
      const key = String(item?.subcategory || "").trim();
      if (!groupsByKey.has(key)) {
        groupsByKey.set(key, { key, name: key || "Inne", isUncategorized: !key, entries: [] });
      }
      groupsByKey.get(key).entries.push({ item, index });
    });

    return orderedSubcategories.map((name) => groupsByKey.get(name)).filter(Boolean);
  }

  function getMenuEditorSectionSubcategoryEntries(section) {
    const groups = buildMenuEditorSectionGroups(section);
    const counts = new Map(groups.map((group) => [group.key, group.entries.length]));
    return getMenuEditorSectionSubcategoryOrder(section).map((name) => ({
      key: name,
      label: name || "Inne",
      isDefault: name === "",
      count: counts.get(name) || 0,
    }));
  }

  function readMenuEditorItemDraft(kind, form) {
    const formData = new FormData(form);
    const item = createMenuEditorItem(kind, {
      name: String(formData.get("name") || "").trim(),
      description: String(formData.get("description") || "").trim(),
      ingredients: parseMenuEditorIngredients(formData.get("ingredients") || ""),
    });
    if (getMenuEditorConfig(kind).includePrice) {
      item.price = String(formData.get("price") || "").trim();
    }
    const subcategory = String(formData.get("subcategory") || "").trim();
    if (subcategory) {
      item.subcategory = subcategory;
    }
    const rawSectionIndex = String(formData.get("sectionIndex") || "").trim();
    const sectionIndex = rawSectionIndex === "" ? null : Number(rawSectionIndex);
    return {
      item,
      sectionIndex: Number.isInteger(sectionIndex) ? sectionIndex : null,
    };
  }

  function openMenuEditorCreateModal(kind, options = {}) {
    state.ui.menuEditorModal = {
      kind,
      type: "create",
      statusMessage: options.statusMessage || "",
    };
    renderMenuEditorModal();
  }

  function openMenuEditorCategoryCreateModal(kind, options = {}) {
    state.ui.menuEditorModal = {
      kind,
      type: "category-create",
      draft: { section: "" },
      statusMessage: options.statusMessage || "",
      returnTo: options.returnTo || { kind, type: "create" },
    };
    renderMenuEditorModal();
  }

  function openMenuEditorSubcategoryCreateModal(kind, options = {}) {
    const sections = getMenuSectionsByKind(kind);
    state.ui.menuEditorModal = {
      kind,
      type: "subcategory-create",
      draft: {
        name: "",
        sectionIndex:
          typeof options.sectionIndex === "number" && sections[options.sectionIndex]
            ? options.sectionIndex
            : sections.length
              ? 0
              : null,
      },
      statusMessage: options.statusMessage || "",
      returnTo: options.returnTo || { kind, type: "create" },
    };
    renderMenuEditorModal();
  }

  function openMenuEditorSectionModal(kind, sectionIndex, options = {}) {
    state.ui.menuEditorModal = {
      kind,
      type: "section",
      sectionIndex,
      activeSubcategory: typeof options.activeSubcategory === "string" ? options.activeSubcategory : null,
      statusMessage: options.statusMessage || "",
    };
    renderMenuEditorModal();
  }

  function openMenuEditorItemModal(kind, sectionIndex, itemIndex = null, options = {}) {
    const sections = getMenuSectionsByKind(kind);
    const resolvedSectionIndex =
      typeof sectionIndex === "number" && sections[sectionIndex]
        ? sectionIndex
        : sections.length
          ? 0
          : null;
    const section = resolvedSectionIndex === null ? null : sections[resolvedSectionIndex];
    if (!section) return;
    const currentItem = itemIndex === null ? createMenuEditorItem(kind) : section.items?.[itemIndex];
    const draft = structuredClone(currentItem || createMenuEditorItem(kind));
    if (itemIndex === null && typeof options.prefillSubcategory === "string") {
      const sub = options.prefillSubcategory.trim();
      if (sub) {
        draft.subcategory = sub;
      } else {
        delete draft.subcategory;
      }
    }
    state.ui.menuEditorModal = {
      kind,
      type: "item",
      sectionIndex: resolvedSectionIndex,
      sourceSectionIndex: itemIndex === null ? null : resolvedSectionIndex,
      itemIndex,
      draft,
      statusMessage: options.statusMessage || "",
      returnTo: options.returnTo || null,
    };
    renderMenuEditorModal();
  }

  function dismissMenuEditorModal(options = {}) {
    const modal = getMenuEditorModalState();
    if (!modal) return;
    const { skipRender = false } = options;

    state.ui.menuEditorModal = null;
    if (!skipRender) {
      renderMenuEditorPanel(modal.kind);
    }
  }

  function goBackMenuEditorModal() {
    const modal = getMenuEditorModalState();
    if (!modal) return;
    if (modal.type === "section" && typeof modal.activeSubcategory === "string") {
      openMenuEditorSectionModal(modal.kind, modal.sectionIndex, {
        statusMessage: modal.statusMessage || "",
      });
      return;
    }
    const returnTo = modal.returnTo || null;
    if (!returnTo) {
      dismissMenuEditorModal();
      return;
    }
    if (returnTo.type === "create") {
      openMenuEditorCreateModal(returnTo.kind || modal.kind, {
        statusMessage: returnTo.statusMessage || "",
      });
      return;
    }
    if (returnTo.type === "section" && typeof returnTo.sectionIndex === "number") {
      openMenuEditorSectionModal(returnTo.kind || modal.kind, returnTo.sectionIndex, {
        activeSubcategory: typeof returnTo.activeSubcategory === "string" ? returnTo.activeSubcategory : null,
        statusMessage: returnTo.statusMessage || "",
      });
      return;
    }
    dismissMenuEditorModal();
  }

  function renderMenuEditorPanel(kind, statusMessage = "") {
    const config = getMenuEditorConfig(kind);
    const panel = document.querySelector(config.panelSelector);
    if (!panel) return;

    if (typeof statusMessage === "string") {
      setMenuEditorStatus(kind, statusMessage);
    }

    const sections = getMenuSectionsByKind(kind);
    const itemCount = sections.reduce((sum, section) => sum + (section.items || []).length, 0);
    const subcategoryCount = sections.reduce((sum, section) => sum + getMenuEditorSectionSubcategories(section).length, 0);

    panel.innerHTML = `
      <p class="pill">${escapeHtml(config.pill)}</p>
      <h2>${escapeHtml(config.title)}</h2>
      <p class="section-intro">${escapeHtml(config.intro)}</p>
      <div class="menu-editor-toolbar">
        <div class="menu-editor-stats">
          <div class="menu-editor-stat">
            <strong>${sections.length}</strong>
            <span>Kategorie</span>
          </div>
          <div class="menu-editor-stat">
            <strong>${subcategoryCount}</strong>
            <span>Podkategorie</span>
          </div>
          <div class="menu-editor-stat">
            <strong>${itemCount}</strong>
            <span>Pozycje</span>
          </div>
        </div>
        <div class="inline-actions menu-editor-toolbar-actions">
          <button class="button" type="button" data-menu-editor-open-create>Dodaj</button>
        </div>
      </div>
      <p class="status">${escapeHtml(getMenuEditorStatus(kind))}</p>
      <div class="menu-editor-card-grid">
        ${
          sections.length
            ? sections
                .map((section, sectionIndex) => `
                  <article class="menu-editor-card" data-open-menu-section="${sectionIndex}" tabindex="0" role="button" aria-label="Otworz kategorie ${escapeAttribute(getMenuEditorSectionLabel(section, sectionIndex))}">
                    <div class="menu-editor-card-actions">
                      <button
                        class="button secondary menu-editor-card-move"
                        type="button"
                        data-menu-editor-move-section-up="${sectionIndex}"
                        aria-label="Przesun kategorie wyzej"
                        ${sectionIndex === 0 ? "disabled" : ""}
                      >
                        ↑
                      </button>
                      <button
                        class="button secondary menu-editor-card-move"
                        type="button"
                        data-menu-editor-move-section-down="${sectionIndex}"
                        aria-label="Przesun kategorie nizej"
                        ${sectionIndex === sections.length - 1 ? "disabled" : ""}
                      >
                        ↓
                      </button>
                      <button
                        class="button danger menu-editor-card-remove"
                        type="button"
                        data-menu-editor-remove-section="${sectionIndex}"
                        aria-label="Usun kategorie"
                      >
                        Usun
                      </button>
                    </div>
                    <span class="menu-editor-card-label">${escapeHtml(config.categoryLabel)} ${sectionIndex + 1}</span>
                    <strong>${escapeHtml(getMenuEditorSectionLabel(section, sectionIndex))}</strong>
                    <span class="menu-editor-card-meta">${escapeHtml(buildMenuEditorSummary(section))}</span>
                    <span class="menu-editor-card-copy">${escapeHtml(getMenuEditorCategoryPreview(section) || "Kliknij, aby otworzyc te kategorie i zarzadzac produktami.")}</span>
                  </article>
                `)
                .join("")
            : `
              <div class="repeater-item menu-editor-empty-state">
                <strong>Menu jest jeszcze puste</strong>
                <p class="helper">${escapeHtml(config.emptyState)}</p>
                <div class="inline-actions">
                  <button class="button" type="button" data-menu-editor-open-create>Dodaj</button>
                </div>
              </div>
            `
        }
      </div>
    `;

    panel.querySelectorAll("[data-menu-editor-open-create]").forEach((button) => {
      button.addEventListener("click", () => openMenuEditorCreateModal(kind));
    });
    panel.querySelectorAll("[data-open-menu-section]").forEach((button) => {
      button.addEventListener("click", () => openMenuEditorSectionModal(kind, Number(button.dataset.openMenuSection)));
      button.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openMenuEditorSectionModal(kind, Number(button.dataset.openMenuSection));
        }
      });
    });
    panel.querySelectorAll("[data-menu-editor-move-section-up]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        moveMenuEditorSection(kind, Number(button.dataset.menuEditorMoveSectionUp), -1, { reopenModal: false });
      });
    });
    panel.querySelectorAll("[data-menu-editor-move-section-down]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        moveMenuEditorSection(kind, Number(button.dataset.menuEditorMoveSectionDown), 1, { reopenModal: false });
      });
    });
    panel.querySelectorAll("[data-menu-editor-remove-section]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const sectionIndex = Number(button.dataset.menuEditorRemoveSection);
        if (!window.confirm("Usunac cala kategorie razem z jej produktami?")) {
          return;
        }
        removeMenuEditorSection(kind, sectionIndex);
      });
    });
    renderMenuEditorModal();
  }

  function renderMenuEditorCreateModal(modal) {
    const config = getMenuEditorConfig(modal.kind);
    const sections = getMenuSectionsByKind(modal.kind);
    const hasCategories = sections.length > 0;

    return `
      <div class="admin-modal-overlay" data-menu-modal-overlay>
        <section class="admin-modal menu-editor-modal" role="dialog" aria-modal="true" aria-labelledby="menu-editor-create-title">
          <div class="admin-modal-head">
            <div>
              <p class="pill">${escapeHtml(config.pill)}</p>
              <h3 id="menu-editor-create-title">Dodaj element menu</h3>
              <p class="helper">Wybierz, czy chcesz dodac nowa kategorie, podkategorie albo pojedynczy produkt.</p>
            </div>
            <button class="button icon-button secondary" type="button" data-menu-modal-close aria-label="Zamknij">×</button>
          </div>
          <p class="status">${escapeHtml(modal.statusMessage || "")}</p>
          <div class="menu-editor-create-grid">
            <button class="menu-editor-create-option" type="button" data-menu-create-choice="category">
              <strong>Dodaj kategorie</strong>
              <span>Utworz nowa kategorie i nadaj jej nazwe.</span>
            </button>
            <button class="menu-editor-create-option" type="button" data-menu-create-choice="subcategory" ${hasCategories ? "" : "disabled"}>
              <strong>Dodaj podkategorie</strong>
              <span>Podaj nazwe podkategorii i przypisz ja do wybranej kategorii.</span>
            </button>
            <button class="menu-editor-create-option" type="button" data-menu-create-choice="item" ${hasCategories ? "" : "disabled"}>
              <strong>Dodaj produkt</strong>
              <span>Uzupelnij dane produktu i przypisz go do kategorii oraz opcjonalnej podkategorii.</span>
            </button>
          </div>
          ${
            hasCategories
              ? ""
              : `<p class="helper">Najpierw dodaj przynajmniej jedna kategorie, aby przypisywac podkategorie i produkty.</p>`
          }
          <div class="admin-modal-footer">
            <p class="helper">Zmiany lokalne zapiszesz przyciskiem "Zapisz" w dolnym, przypietym pasku akcji.</p>
            <button class="button secondary" type="button" data-menu-modal-close>Zamknij</button>
          </div>
        </section>
      </div>
    `;
  }

  function renderMenuEditorCategoryCreateModal(modal) {
    const config = getMenuEditorConfig(modal.kind);
    const draft = modal.draft || { section: "" };

    return `
      <div class="admin-modal-overlay" data-menu-modal-overlay>
        <section class="admin-modal menu-editor-modal" role="dialog" aria-modal="true" aria-labelledby="menu-editor-category-create-title">
          <form id="menu-editor-category-form" class="stack">
            <div class="admin-modal-head menu-editor-modal-head">
              <button class="button icon-button secondary" type="button" data-menu-modal-back aria-label="Wroc">←</button>
              <div class="menu-editor-modal-title">
                <p class="pill">${escapeHtml(config.pill)}</p>
                <h3 id="menu-editor-category-create-title">Dodaj kategorie</h3>
                <p class="helper">Nadaj nazwie kategorii, aby pojawila sie na liscie menu.</p>
              </div>
            </div>
            <p class="status">${escapeHtml(modal.statusMessage || "")}</p>
            <label class="field-full">
              <span>Nazwa kategorii</span>
              <input name="section" value="${escapeAttribute(draft.section || "")}" placeholder="np. Przystawki, Zupy, Dania glowne" />
            </label>
            <div class="admin-modal-footer">
              <button class="button" type="submit">Dodaj kategorie</button>
            </div>
          </form>
        </section>
      </div>
    `;
  }

  function renderMenuEditorSubcategoryCreateModal(modal) {
    const config = getMenuEditorConfig(modal.kind);
    const categories = getMenuEditorCategoryOptions(modal.kind);
    const draft = modal.draft || { name: "", sectionIndex: null };

    return `
      <div class="admin-modal-overlay" data-menu-modal-overlay>
        <section class="admin-modal menu-editor-modal" role="dialog" aria-modal="true" aria-labelledby="menu-editor-subcategory-create-title">
          <form id="menu-editor-subcategory-form" class="stack">
            <div class="admin-modal-head menu-editor-modal-head">
              <button class="button icon-button secondary" type="button" data-menu-modal-back aria-label="Wroc">←</button>
              <div class="menu-editor-modal-title">
                <p class="pill">${escapeHtml(config.pill)}</p>
                <h3 id="menu-editor-subcategory-create-title">Dodaj podkategorie</h3>
                <p class="helper">Podkategorie przypisujesz do jednej kategorii, a potem wybierasz je przy produktach.</p>
              </div>
            </div>
            <p class="status">${escapeHtml(modal.statusMessage || "")}</p>
            <div class="field-grid">
              <label class="field">
                <span>Kategoria</span>
                <select name="sectionIndex">
                  ${categories
                    .map(
                      (option) => `
                        <option value="${escapeAttribute(option.value)}" ${String(draft.sectionIndex) === option.value ? "selected" : ""}>
                          ${escapeHtml(option.label)}
                        </option>
                      `
                    )
                    .join("")}
                </select>
              </label>
              <label class="field">
                <span>Nazwa podkategorii</span>
                <input name="name" value="${escapeAttribute(draft.name || "")}" placeholder="np. Salaty, Pierogi, Dodatki" />
              </label>
            </div>
            <div class="admin-modal-footer">
              <button class="button" type="submit">Dodaj podkategorie</button>
            </div>
          </form>
        </section>
      </div>
    `;
  }

  function renderMenuEditorSectionModal(modal) {
    const config = getMenuEditorConfig(modal.kind);
    const section = getMenuSectionsByKind(modal.kind)[modal.sectionIndex];
    if (!section) {
      state.ui.menuEditorModal = null;
      return "";
    }
    const subcategoryEntries = getMenuEditorSectionSubcategoryEntries(section);
    const groupedItems = buildMenuEditorSectionGroups(section);
    const activeSubcategory = typeof modal.activeSubcategory === "string" ? modal.activeSubcategory : null;
    const activeGroup =
      activeSubcategory === null
        ? null
        : groupedItems.find((group) => group.key === activeSubcategory) || {
            key: activeSubcategory,
            name: activeSubcategory || "Inne",
            entries: [],
          };

    return `
      <div class="admin-modal-overlay" data-menu-modal-overlay>
        <section class="admin-modal menu-editor-modal" role="dialog" aria-modal="true" aria-labelledby="menu-editor-section-title">
          <div class="admin-modal-head menu-editor-modal-head">
            <button class="button icon-button secondary" type="button" data-menu-modal-back aria-label="Wroc">←</button>
            <div class="menu-editor-modal-title">
              <p class="pill">${escapeHtml(config.pill)}</p>
              <h3 id="menu-editor-section-title">Edycja kategorii</h3>
            </div>
          </div>
          <p class="status">${escapeHtml(modal.statusMessage || "")}</p>
          <label class="field-full">
            <span>Nazwa kategorii</span>
            <input data-menu-modal-section-name value="${escapeAttribute(section.section || "")}" placeholder="np. Przystawki, Zupy, Dania glowne" />
          </label>
          ${
            activeSubcategory === null
              ? `
                <div class="menu-editor-subcategory-strip">
                  <strong>Podkategorie</strong>
                  <div class="stack menu-editor-subcategory-cards">
                    ${subcategoryEntries
                      .map(
                        (entry, subcategoryIndex) => {
                          const canMoveUp = !entry.isDefault && subcategoryIndex > 0;
                          const canMoveDown =
                            !entry.isDefault &&
                            subcategoryIndex < subcategoryEntries.length - 1 &&
                            !subcategoryEntries[subcategoryIndex + 1]?.isDefault;
                          return `
                          <article class="list-item menu-editor-subcategory-card" data-open-menu-subcategory="${escapeAttribute(entry.key)}" tabindex="0" role="button" aria-label="Otworz podkategorie ${escapeAttribute(entry.label)}">
                            <div class="list-head">
                              <div>
                                <strong>${escapeHtml(entry.label)}</strong>
                                <p class="helper">${entry.count} ${entry.count === 1 ? "produkt" : "produkty"}${entry.isDefault ? " • domyslna (tylko admin)" : ""}</p>
                              </div>
                              <div class="inline-actions">
                                ${
                                  entry.isDefault
                                    ? ""
                                    : `<button class="button danger" type="button" data-menu-card-action data-remove-menu-subcategory="${escapeAttribute(entry.key)}" aria-label="Usun podkategorie ${escapeAttribute(entry.label)}">Usun</button>`
                                }
                                <button class="button secondary menu-editor-card-move" type="button" data-menu-card-action data-move-menu-subcategory-up="${escapeAttribute(entry.key)}" aria-label="Przesun podkategorie wyzej" ${canMoveUp ? "" : "disabled"}>↑</button>
                                <button class="button secondary menu-editor-card-move" type="button" data-menu-card-action data-move-menu-subcategory-down="${escapeAttribute(entry.key)}" aria-label="Przesun podkategorie nizej" ${canMoveDown ? "" : "disabled"}>↓</button>
                              </div>
                            </div>
                          </article>
                        `;
                        }
                      )
                      .join("")}
                  </div>
                </div>
              `
              : `
                <div class="menu-editor-subcategory-group-head">
                  <strong>Podkategoria: ${escapeHtml(activeGroup.name)}</strong>
                  <button class="button secondary menu-editor-add-item-in-subcategory" type="button" data-add-menu-item-in-subcategory aria-label="Dodaj produkt w tej podkategorii">+</button>
                </div>
                <div class="stack menu-editor-product-list">
                  ${
                    activeGroup.entries.length
                      ? activeGroup.entries
                          .map((entry, groupItemIndex) => {
                            const item = entry.item;
                            const itemIndex = entry.index;
                            return `
                              <article class="list-item menu-editor-product-card" data-open-menu-item="${itemIndex}" tabindex="0" role="button" aria-label="Otworz produkt ${escapeAttribute(item.name || `${config.productLabel} ${itemIndex + 1}`)}">
                                <div class="list-head">
                                  <div>
                                    <strong>${escapeHtml(item.name || `${config.productLabel} ${itemIndex + 1}`)}</strong>
                                    <p class="helper">${escapeHtml(buildMenuEditorItemMeta(item, config.includePrice) || "Bez dodatkowych informacji")}</p>
                                  </div>
                                  <div class="inline-actions menu-editor-product-actions">
                                    <button class="button secondary menu-editor-card-move" type="button" data-menu-card-action data-move-menu-item-up="${itemIndex}" aria-label="Przesun produkt wyzej" ${groupItemIndex === 0 ? "disabled" : ""}>↑</button>
                                    <button class="button secondary menu-editor-card-move" type="button" data-menu-card-action data-move-menu-item-down="${itemIndex}" aria-label="Przesun produkt nizej" ${groupItemIndex === activeGroup.entries.length - 1 ? "disabled" : ""}>↓</button>
                                    <button class="button danger" type="button" data-menu-card-action data-remove-menu-item="${itemIndex}">Usun</button>
                                  </div>
                                </div>
                                <p>${escapeHtml(truncateMenuEditorText(item.description || "", 180) || "Brak opisu produktu.")}</p>
                                ${item.ingredients?.length ? `<p class="helper">${escapeHtml(item.ingredients.join(", "))}</p>` : ""}
                              </article>
                            `;
                          })
                          .join("")
                      : `
                        <div class="repeater-item menu-editor-empty-state">
                          <strong>Brak produktow w tej podkategorii</strong>
                          <p class="helper">Kliknij plus obok nazwy podkategorii albo uzyj przycisku "Dodaj" na liscie kategorii.</p>
                        </div>
                      `
                  }
                </div>
              `
          }
        </section>
      </div>
    `;
  }

  function renderMenuEditorItemModal(modal) {
    const config = getMenuEditorConfig(modal.kind);
    const isNewItem = modal.itemIndex === null;
    const draft = modal.draft || createMenuEditorItem(modal.kind);
    const categoryOptions = getMenuEditorCategoryOptions(modal.kind);
    const subcategoryOptions =
      typeof modal.sectionIndex === "number" ? getMenuEditorSubcategoryOptions(modal.kind, modal.sectionIndex) : [];

    return `
      <div class="admin-modal-overlay" data-menu-modal-overlay>
        <section class="admin-modal menu-editor-modal" role="dialog" aria-modal="true" aria-labelledby="menu-editor-item-title">
          <form id="menu-editor-item-form" class="stack">
            <div class="admin-modal-head menu-editor-modal-head">
              <button class="button icon-button secondary" type="button" data-menu-modal-back aria-label="Wroc">←</button>
              <div class="menu-editor-modal-title">
                <p class="pill">${escapeHtml(config.pill)}</p>
                <h3 id="menu-editor-item-title">${isNewItem ? "Dodaj produkt" : "Edytuj produkt"}</h3>
                <p class="helper">Po wypelnieniu pol zatwierdz formularz przyciskiem na dole okna.</p>
              </div>
            </div>
            <p class="status">${escapeHtml(modal.statusMessage || "")}</p>
            <div class="field-grid">
              <label class="field-full">
                <span>Nazwa produktu</span>
                <input name="name" value="${escapeAttribute(draft.name || "")}" placeholder="np. Rosol domowy" />
              </label>
              <div class="menu-editor-item-meta-row ${config.includePrice ? "has-price" : ""}">
                <label class="field">
                  <span>Kategoria</span>
                  <select name="sectionIndex">
                    ${categoryOptions
                      .map(
                        (option) => `
                          <option value="${escapeAttribute(option.value)}" ${String(modal.sectionIndex) === option.value ? "selected" : ""}>
                            ${escapeHtml(option.label)}
                          </option>
                        `
                      )
                      .join("")}
                  </select>
                </label>
                <label class="field">
                  <span>Podkategoria</span>
                  <select name="subcategory">
                    <option value="">Brak</option>
                    ${subcategoryOptions
                      .map(
                        (option) => `
                          <option value="${escapeAttribute(option)}" ${option === draft.subcategory ? "selected" : ""}>
                            ${escapeHtml(option)}
                          </option>
                        `
                      )
                      .join("")}
                  </select>
                </label>
                ${
                  config.includePrice
                    ? `
                      <label class="field">
                        <span>Cena</span>
                        <input name="price" value="${escapeAttribute(draft.price || "")}" placeholder="np. 24 zl" />
                      </label>
                    `
                    : ""
                }
              </div>
              <label class="field-full">
                <span>Opis</span>
                <textarea name="description" rows="4" placeholder="Krotki opis produktu">${escapeHtml(draft.description || "")}</textarea>
              </label>
              <label class="field-full">
                <span>Skladniki</span>
                <textarea name="ingredients" rows="4" placeholder="Jeden skladnik w linii lub po przecinku">${escapeHtml((draft.ingredients || []).join("\n"))}</textarea>
              </label>
            </div>
            ${
              subcategoryOptions.length
                ? ""
                : `<p class="helper">Wybrana kategoria nie ma jeszcze podkategorii. Mozesz zostawic opcje "Brak" albo dodac podkategorie z glownego przycisku "Dodaj".</p>`
            }
            <div class="admin-modal-footer">
              <button class="button" type="submit">${isNewItem ? "Dodaj produkt" : "Zapisz produkt"}</button>
            </div>
          </form>
        </section>
      </div>
    `;
  }

  function renderMenuEditorModal() {
    const root = document.querySelector("#admin-modal-root");
    if (!root) return;

    const modal = getMenuEditorModalState();
    const activeKind = getActiveMenuEditorKind();
    if (!modal || !activeKind || modal.kind !== activeKind) {
      root.innerHTML = "";
      document.body.classList.remove("admin-modal-open");
      return;
    }

    if (modal.type === "create") {
      root.innerHTML = renderMenuEditorCreateModal(modal);
    } else if (modal.type === "category-create") {
      root.innerHTML = renderMenuEditorCategoryCreateModal(modal);
    } else if (modal.type === "subcategory-create") {
      root.innerHTML = renderMenuEditorSubcategoryCreateModal(modal);
    } else if (modal.type === "item") {
      root.innerHTML = renderMenuEditorItemModal(modal);
    } else {
      root.innerHTML = renderMenuEditorSectionModal(modal);
    }
    document.body.classList.add("admin-modal-open");

    const overlay = root.querySelector("[data-menu-modal-overlay]");
    overlay?.addEventListener("click", (event) => {
      if (event.target === overlay) {
        dismissMenuEditorModal();
      }
    });

    root.querySelectorAll("[data-menu-modal-close]").forEach((button) => {
      button.addEventListener("click", () => dismissMenuEditorModal());
    });
    root.querySelectorAll("[data-menu-modal-back]").forEach((button) => {
      button.addEventListener("click", () => goBackMenuEditorModal());
    });

    if (modal.type === "create") {
      root.querySelectorAll("[data-menu-create-choice]").forEach((button) => {
        button.addEventListener("click", () => {
          const choice = button.dataset.menuCreateChoice;
          if (choice === "category") {
            openMenuEditorCategoryCreateModal(modal.kind);
            return;
          }
          if (choice === "subcategory") {
            openMenuEditorSubcategoryCreateModal(modal.kind);
            return;
          }
          if (choice === "item") {
            openMenuEditorItemModal(modal.kind, 0, null, {
              returnTo: { kind: modal.kind, type: "create" },
            });
          }
        });
      });
      return;
    }

    if (modal.type === "category-create") {
      root.querySelector("#menu-editor-category-form")?.addEventListener("submit", (event) => {
        event.preventDefault();
        saveMenuEditorCategory(modal.kind);
      });
      return;
    }

    if (modal.type === "subcategory-create") {
      root.querySelector("#menu-editor-subcategory-form")?.addEventListener("submit", (event) => {
        event.preventDefault();
        saveMenuEditorSubcategory(modal.kind);
      });
      return;
    }

    if (modal.type === "section") {
      const section = getMenuSectionsByKind(modal.kind)[modal.sectionIndex];
      root.querySelector("[data-menu-modal-section-name]")?.addEventListener("input", (event) => {
        section.section = event.currentTarget.value;
        refreshSaveDockVisibility();
      });
      root.querySelectorAll("[data-open-menu-subcategory]").forEach((button) => {
        button.addEventListener("click", () => {
          openMenuEditorSectionModal(modal.kind, modal.sectionIndex, {
            activeSubcategory: String(button.dataset.openMenuSubcategory || ""),
          });
        });
        button.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openMenuEditorSectionModal(modal.kind, modal.sectionIndex, {
              activeSubcategory: String(button.dataset.openMenuSubcategory || ""),
            });
          }
        });
      });
      root.querySelectorAll("[data-open-menu-item]").forEach((button) => {
        button.addEventListener("click", () => {
          openMenuEditorItemModal(modal.kind, modal.sectionIndex, Number(button.dataset.openMenuItem), {
            returnTo: {
              kind: modal.kind,
              type: "section",
              sectionIndex: modal.sectionIndex,
              activeSubcategory: typeof modal.activeSubcategory === "string" ? modal.activeSubcategory : null,
            },
          });
        });
        button.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openMenuEditorItemModal(modal.kind, modal.sectionIndex, Number(button.dataset.openMenuItem), {
              returnTo: {
                kind: modal.kind,
                type: "section",
                sectionIndex: modal.sectionIndex,
                activeSubcategory: typeof modal.activeSubcategory === "string" ? modal.activeSubcategory : null,
              },
            });
          }
        });
      });
      root.querySelectorAll("[data-menu-card-action]").forEach((button) => {
        button.addEventListener("click", (event) => {
          event.stopPropagation();
        });
        button.addEventListener("keydown", (event) => {
          event.stopPropagation();
        });
      });
      root.querySelectorAll("[data-remove-menu-item]").forEach((button) => {
        button.addEventListener("click", () => {
          removeMenuEditorItem(modal.kind, modal.sectionIndex, Number(button.dataset.removeMenuItem));
        });
      });
      root.querySelectorAll("[data-move-menu-item-up]").forEach((button) => {
        button.addEventListener("click", () => {
          moveMenuEditorItem(modal.kind, modal.sectionIndex, Number(button.dataset.moveMenuItemUp), -1);
        });
      });
      root.querySelectorAll("[data-move-menu-item-down]").forEach((button) => {
        button.addEventListener("click", () => {
          moveMenuEditorItem(modal.kind, modal.sectionIndex, Number(button.dataset.moveMenuItemDown), 1);
        });
      });
      root.querySelectorAll("[data-move-menu-subcategory-up]").forEach((button) => {
        button.addEventListener("click", () => {
          moveMenuEditorSubcategory(modal.kind, modal.sectionIndex, String(button.dataset.moveMenuSubcategoryUp || ""), -1);
        });
      });
      root.querySelectorAll("[data-move-menu-subcategory-down]").forEach((button) => {
        button.addEventListener("click", () => {
          moveMenuEditorSubcategory(modal.kind, modal.sectionIndex, String(button.dataset.moveMenuSubcategoryDown || ""), 1);
        });
      });
      root.querySelectorAll("[data-remove-menu-subcategory]").forEach((button) => {
        button.addEventListener("click", () => {
          removeMenuEditorSubcategory(modal.kind, modal.sectionIndex, String(button.dataset.removeMenuSubcategory || ""));
        });
      });
      root.querySelector("[data-add-menu-item-in-subcategory]")?.addEventListener("click", () => {
        const sub = typeof modal.activeSubcategory === "string" ? modal.activeSubcategory : "";
        openMenuEditorItemModal(modal.kind, modal.sectionIndex, null, {
          prefillSubcategory: sub,
          returnTo: {
            kind: modal.kind,
            type: "section",
            sectionIndex: modal.sectionIndex,
            activeSubcategory: typeof modal.activeSubcategory === "string" ? modal.activeSubcategory : null,
          },
        });
      });
      return;
    }

    const itemForm = root.querySelector("#menu-editor-item-form");
    itemForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      saveMenuEditorItem(modal.kind, modal.sectionIndex, modal.itemIndex);
    });
    itemForm?.querySelector('[name="sectionIndex"]')?.addEventListener("change", () => {
      const { item, sectionIndex } = readMenuEditorItemDraft(modal.kind, itemForm);
      modal.draft = item;
      modal.sectionIndex = sectionIndex;
      if (sectionIndex === null) {
        modal.statusMessage = "Wybierz kategorie produktu.";
      } else {
        const availableSubcategories = getMenuEditorSubcategoryOptions(modal.kind, sectionIndex);
        if (!availableSubcategories.includes(modal.draft.subcategory || "")) {
          delete modal.draft.subcategory;
        }
        modal.statusMessage = "";
      }
      renderMenuEditorModal();
    });
  }

  function saveMenuEditorCategory(kind) {
    const modal = getMenuEditorModalState();
    const form = document.querySelector("#menu-editor-category-form");
    if (!modal || !form) return;

    const sectionName = String(new FormData(form).get("section") || "").trim();
    if (!sectionName) {
      modal.statusMessage = "Uzupelnij nazwe kategorii.";
      renderMenuEditorModal();
      return;
    }

    const sections = getMenuSectionsByKind(kind);
    sections.push({ section: sectionName, items: [] });
    state.ui.menuEditorModal = null;
    setMenuEditorStatus(kind, "Kategoria zostala dodana.");
    renderMenuEditorPanel(kind);
    refreshSaveDockVisibility();
  }

  function saveMenuEditorSubcategory(kind) {
    const modal = getMenuEditorModalState();
    const form = document.querySelector("#menu-editor-subcategory-form");
    if (!modal || !form) return;

    const formData = new FormData(form);
    const sectionIndex = Number(String(formData.get("sectionIndex") || "").trim());
    const subcategoryName = String(formData.get("name") || "").trim();
    const section = getMenuSectionsByKind(kind)[sectionIndex];

    if (!section) {
      modal.statusMessage = "Wybierz kategorie dla podkategorii.";
      renderMenuEditorModal();
      return;
    }
    if (!subcategoryName) {
      modal.statusMessage = "Uzupelnij nazwe podkategorii.";
      renderMenuEditorModal();
      return;
    }

    const existingSubcategories = getMenuEditorSectionSubcategories(section);
    section.subcategories = existingSubcategories.includes(subcategoryName)
      ? existingSubcategories
      : [...existingSubcategories, subcategoryName];
    const subcategoryOrder = getMenuEditorSectionSubcategoryOrder(section);
    if (!subcategoryOrder.includes(subcategoryName)) {
      const defaultIndex = subcategoryOrder.indexOf("");
      if (defaultIndex >= 0) {
        subcategoryOrder.splice(defaultIndex, 0, subcategoryName);
      } else {
        subcategoryOrder.push(subcategoryName);
      }
      section.subcategoryOrder = subcategoryOrder.map(encodeMenuEditorSubcategoryOrderValue);
    } else {
      syncMenuEditorSectionSubcategoryOrder(section);
    }

    state.ui.menuEditorModal = null;
    setMenuEditorStatus(kind, "Podkategoria zostala dodana.");
    renderMenuEditorPanel(kind);
    refreshSaveDockVisibility();
  }

  function removeMenuEditorSection(kind, index) {
    const sections = getMenuSectionsByKind(kind);
    if (!sections[index]) return;
    sections.splice(index, 1);
    state.ui.menuEditorModal = null;
    setMenuEditorStatus(kind, "Kategoria zostala usunieta.");
    renderMenuEditorPanel(kind);
    refreshSaveDockVisibility();
  }

  function moveMenuEditorSection(kind, index, direction, options = {}) {
    const { reopenModal = true } = options;
    const sections = getMenuSectionsByKind(kind);
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= sections.length) return;
    [sections[index], sections[newIndex]] = [sections[newIndex], sections[index]];
    if (reopenModal) {
      openMenuEditorSectionModal(kind, newIndex, {
        statusMessage: "Kategoria zostala przesunieta.",
      });
    } else {
      state.ui.menuEditorModal = null;
    }
    setMenuEditorStatus(kind, "Kolejnosc kategorii zostala zaktualizowana.");
    renderMenuEditorPanel(kind);
    refreshSaveDockVisibility();
  }

  function removeMenuEditorItem(kind, sectionIndex, itemIndex) {
    const section = getMenuSectionsByKind(kind)[sectionIndex];
    if (!section?.items?.[itemIndex]) return;
    section.items.splice(itemIndex, 1);
    syncMenuEditorSectionSubcategoryOrder(section);
    openMenuEditorSectionModal(kind, sectionIndex, {
      statusMessage: "Produkt zostal usuniety.",
    });
    setMenuEditorStatus(kind, "Produkt zostal usuniety.");
    renderMenuEditorPanel(kind);
    refreshSaveDockVisibility();
  }

  function moveMenuEditorItem(kind, sectionIndex, itemIndex, direction) {
    const section = getMenuSectionsByKind(kind)[sectionIndex];
    if (!section?.items) return;
    const currentItem = section.items[itemIndex];
    if (!currentItem) return;
    const currentSubcategory = String(currentItem.subcategory || "").trim();
    const targetIndex = itemIndex + direction;
    if (targetIndex < 0 || targetIndex >= section.items.length) return;
    const targetItem = section.items[targetIndex];
    const targetSubcategory = String(targetItem?.subcategory || "").trim();
    if (currentSubcategory !== targetSubcategory) return;
    [section.items[itemIndex], section.items[targetIndex]] = [section.items[targetIndex], section.items[itemIndex]];
    openMenuEditorSectionModal(kind, sectionIndex, {
      statusMessage: "Produkt zostal przesuniety.",
    });
    setMenuEditorStatus(kind, "Kolejnosc produktow zostala zaktualizowana.");
    renderMenuEditorPanel(kind);
    refreshSaveDockVisibility();
  }

  function moveMenuEditorSubcategory(kind, sectionIndex, subcategoryName, direction) {
    const section = getMenuSectionsByKind(kind)[sectionIndex];
    if (!section) return;
    const subcategories = getMenuEditorSectionSubcategoryOrder(section);
    if (subcategoryName === "") return;
    const currentIndex = subcategories.indexOf(subcategoryName);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= subcategories.length) return;
    if (subcategories[targetIndex] === "") return;

    [subcategories[currentIndex], subcategories[targetIndex]] = [subcategories[targetIndex], subcategories[currentIndex]];
    section.subcategoryOrder = subcategories.map(encodeMenuEditorSubcategoryOrderValue);
    reorderMenuEditorSectionItemsBySubcategoryOrder(section);

    openMenuEditorSectionModal(kind, sectionIndex, {
      statusMessage: "Kolejnosc podkategorii zostala zaktualizowana.",
    });
    setMenuEditorStatus(kind, "Kolejnosc podkategorii zostala zaktualizowana.");
    renderMenuEditorPanel(kind);
    refreshSaveDockVisibility();
  }

  function removeMenuEditorSubcategory(kind, sectionIndex, subcategoryName) {
    const section = getMenuSectionsByKind(kind)[sectionIndex];
    if (!section) return;
    const name = String(subcategoryName || "").trim();
    if (!name) return;

    const items = Array.isArray(section.items) ? section.items : [];
    const affected = items.filter((item) => String(item?.subcategory || "").trim() === name).length;
    if (affected > 0) {
      const msg =
        affected === 1
          ? "Usunac podkategorie? Jeden produkt trafi do «Inne»."
          : `Usunac podkategorie? ${affected} produktow trafi do «Inne».`;
      if (!window.confirm(msg)) return;
    } else if (!window.confirm("Usunac te podkategorie?")) {
      return;
    }

    items.forEach((item) => {
      if (String(item?.subcategory || "").trim() === name) {
        delete item.subcategory;
      }
    });

    if (Array.isArray(section.subcategories)) {
      section.subcategories = section.subcategories.filter((s) => String(s).trim() !== name);
      if (!section.subcategories.length) {
        delete section.subcategories;
      }
    }

    syncMenuEditorSectionSubcategories(section);
    syncMenuEditorSectionSubcategoryOrder(section);
    reorderMenuEditorSectionItemsBySubcategoryOrder(section);

    openMenuEditorSectionModal(kind, sectionIndex, {
      statusMessage: "Podkategoria zostala usunieta.",
    });
    setMenuEditorStatus(kind, "Podkategoria zostala usunieta.");
    renderMenuEditorPanel(kind);
    refreshSaveDockVisibility();
  }

  function saveMenuEditorItem(kind, sectionIndex, itemIndex) {
    const modal = getMenuEditorModalState();
    const form = document.querySelector("#menu-editor-item-form");
    if (!modal || !form) return;

    const { item, sectionIndex: targetSectionIndex } = readMenuEditorItemDraft(kind, form);
    const sections = getMenuSectionsByKind(kind);
    const targetSection = targetSectionIndex === null ? null : sections[targetSectionIndex];

    if (!item.name) {
      modal.statusMessage = "Uzupelnij nazwe produktu.";
      renderMenuEditorModal();
      return;
    }
    if (!targetSection) {
      modal.statusMessage = "Wybierz kategorie produktu.";
      renderMenuEditorModal();
      return;
    }

    if (item.subcategory) {
      targetSection.subcategories = getMenuEditorSectionSubcategories(targetSection);
      if (!targetSection.subcategories.includes(item.subcategory)) {
        targetSection.subcategories.push(item.subcategory);
      }
    }

    if (!Array.isArray(targetSection.items)) {
      targetSection.items = [];
    }
    if (itemIndex === null || itemIndex === undefined) {
      targetSection.items.push(item);
      reorderMenuEditorSectionItemsBySubcategoryOrder(targetSection);
      setMenuEditorStatus(kind, "Produkt zostal dodany.");
      if (modal.returnTo?.type === "section") {
        openMenuEditorSectionModal(kind, targetSectionIndex, {
          activeSubcategory: typeof modal.returnTo.activeSubcategory === "string" ? modal.returnTo.activeSubcategory : null,
          statusMessage: "Produkt zostal dodany.",
        });
      } else {
        state.ui.menuEditorModal = null;
      }
    } else {
      const sourceSectionIndex =
        typeof modal.sourceSectionIndex === "number" ? modal.sourceSectionIndex : sectionIndex;
      const sourceSection = sections[sourceSectionIndex];
      if (!sourceSection?.items?.[itemIndex]) return;

      if (sourceSectionIndex === targetSectionIndex) {
        sourceSection.items[itemIndex] = item;
        reorderMenuEditorSectionItemsBySubcategoryOrder(sourceSection);
      } else {
        sourceSection.items.splice(itemIndex, 1);
        targetSection.items.push(item);
        syncMenuEditorSectionSubcategoryOrder(sourceSection);
        reorderMenuEditorSectionItemsBySubcategoryOrder(targetSection);
      }
      setMenuEditorStatus(kind, "Produkt zostal zaktualizowany.");
      if (modal.returnTo?.type === "section") {
        openMenuEditorSectionModal(kind, targetSectionIndex, {
          statusMessage: "Produkt zostal zaktualizowany.",
        });
      } else {
        state.ui.menuEditorModal = null;
      }
    }
    renderMenuEditorPanel(kind);
    refreshSaveDockVisibility();
  }

  function collectMenuEditorFromPanel(kind) {
    return structuredClone(getMenuSectionsByKind(kind));
  }

  function renderRestaurantMenuPanel(statusMessage = "") {
    renderMenuEditorPanel("restaurant", statusMessage);
  }

  function collectMenuFromPanel() {
    return collectMenuEditorFromPanel("restaurant");
  }

  function renderEventsMenuPanel(statusMessage = "") {
    renderMenuEditorPanel("events", statusMessage);
  }

  function renderRestaurantGalleryPanel(statusMessage = "") {
    const panel = document.querySelector("#restaurant-gallery-panel");
    if (!panel) return;
    const gallery = state.content.restaurant?.gallery || [];

    panel.innerHTML = `
      <p class="pill">Catering</p>
      <h2>Galeria cateringu</h2>
      <p class="section-intro">Zarzadzaj zdjeciami galerii cateringu. Mozesz dodawac, usuwac i zmieniac kolejnosc zdjec.</p>
      <p class="status">${escapeHtml(statusMessage)}</p>
      <div class="stack">
        <form class="repeater-item" data-upload-restaurant-gallery>
          <label class="field-full">
            <span>Dodaj zdjecia</span>
            <input type="file" name="images" accept="image/*" multiple />
          </label>
          <button class="button secondary" type="submit">Wgraj zdjecia</button>
        </form>
        <div class="thumb-grid" id="restaurant-gallery-thumbs">
          ${
            gallery.length
              ? gallery
                  .map(
                    (image, index) => `
                      <article class="thumb-card">
                        <img src="${escapeAttribute(image.url || image)}" alt="${escapeAttribute(image.alt || "Catering")}" />
                        <div class="inline-actions">
                          <button class="button secondary" type="button" data-move-restaurant-image-up="${index}" aria-label="Przesun w lewo" ${index === 0 ? 'disabled' : ''}>←</button>
                          <button class="button secondary" type="button" data-move-restaurant-image-down="${index}" aria-label="Przesun w prawo" ${index === gallery.length - 1 ? 'disabled' : ''}>→</button>
                          <button class="button danger" type="button" data-remove-restaurant-image="${index}">Usun</button>
                        </div>
                      </article>`
                  )
                  .join("")
              : `<p class="empty">Brak zdjec w galerii.</p>`
          }
        </div>
      </div>
    `;

    panel.querySelector("[data-upload-restaurant-gallery]").addEventListener("submit", uploadRestaurantGalleryImages);
    panel.querySelectorAll("[data-remove-restaurant-image]").forEach((button) => {
      button.addEventListener("click", () => removeRestaurantImage(Number(button.dataset.removeRestaurantImage)));
    });
    panel.querySelectorAll("[data-move-restaurant-image-up]").forEach((button) => {
      button.addEventListener("click", () => moveRestaurantImage(Number(button.dataset.moveRestaurantImageUp), -1));
    });
    panel.querySelectorAll("[data-move-restaurant-image-down]").forEach((button) => {
      button.addEventListener("click", () => moveRestaurantImage(Number(button.dataset.moveRestaurantImageDown), 1));
    });
  }

  async function uploadRestaurantGalleryImages(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const files = formData.getAll("images");

    if (files.length === 0 || !files[0].size) {
      renderRestaurantGalleryPanel("Wybierz pliki do wgrania.");
      return;
    }

    try {
      const images = await filesToInlineGalleryImages(files, INLINE_IMAGE_MAX_BYTES, "Catering");

      if (!state.content.restaurant) {
        state.content.restaurant = {};
      }
      if (!state.content.restaurant.gallery) {
        state.content.restaurant.gallery = [];
      }

      state.content.restaurant.gallery.push(...images);
      await saveContent();
      await loadDashboard("Zdjecia zostaly dodane.");
    } catch (error) {
      renderRestaurantGalleryPanel(error.message || "Blad podczas wgrywania zdjec.");
    }
  }

  async function removeRestaurantImage(index) {
    if (!state.content.restaurant?.gallery) {
      return;
    }
    state.content.restaurant.gallery.splice(index, 1);
    await saveContent();
    await loadDashboard("Zdjecie zostalo usuniete.");
  }

  async function moveRestaurantImage(index, direction) {
    if (!state.content.restaurant?.gallery) {
      return;
    }
    const images = state.content.restaurant.gallery;
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= images.length) {
      return;
    }
    [images[index], images[newIndex]] = [images[newIndex], images[index]];
    await saveContent();
    await loadDashboard("Kolejnosc zdjec zostala zmieniona.");
  }

  function renderHotelRoomGalleriesPanel(statusMessage = "") {
    const panel = document.querySelector("#hotel-room-galleries-panel");
    if (!panel) return;
    const status = typeof statusMessage === "string" ? { tone: statusMessage ? "neutral" : "", text: statusMessage } : {
      tone: statusMessage?.tone || "",
      text: statusMessage?.text || "",
    };
    const roomGalleries = state.content.hotel?.roomGalleries || {
      "1-osobowe": [],
      "2-osobowe": [],
      "3-osobowe": [],
      "4-osobowe": [],
    };

    const roomTypes = [
      { key: "1-osobowe", label: "Pokoje 1-osobowe" },
      { key: "2-osobowe", label: "Pokoje 2-osobowe" },
      { key: "3-osobowe", label: "Pokoje 3-osobowe" },
      { key: "4-osobowe", label: "Pokoje 4-osobowe" },
    ];

    panel.innerHTML = `
      <p class="pill">Hotel</p>
      <h2>Galeria Pokoi</h2>
      <p class="section-intro">Wspolna galeria pokoi. Przy dodawaniu zdjec wskazujesz album (1/2/3/4-osobowe), a nizej zarzadzasz kolejnoscia i usuwaniem.</p>
      <form class="repeater-item upload-room-gallery-form upload-room-gallery-form--album" id="hotel-room-gallery-upload-form">
        <label class="field field-full upload-room-gallery-picker">
          <span>Wgraj zdjecia</span>
          <input class="upload-room-gallery-picker__input" type="file" name="images" accept="image/*" multiple required />
          <span class="upload-room-gallery-picker__surface">
            <strong class="upload-room-gallery-picker__button">Wybierz pliki</strong>
            <span class="upload-room-gallery-picker__text" data-room-gallery-file-label>Nie wybrano jeszcze zadnych plikow.</span>
          </span>
        </label>
        <label class="field upload-room-gallery-form__album">
          <span>Wybierz album</span>
          <select name="roomType" required>
            ${roomTypes
              .map((roomType) => `<option value="${escapeAttribute(roomType.key)}">${escapeHtml(roomType.label)}</option>`)
              .join("")}
          </select>
        </label>
        <button class="button" type="submit">Wgraj</button>
      </form>
      <p class="status${status.tone ? ` status--${escapeAttribute(status.tone)}` : ""}">${escapeHtml(status.text)}</p>
      <div class="grid">
        ${roomTypes
          .map(
            (roomType) => `
              <div class="col-12">
                <div class="repeater-item">
                  <h3>${escapeHtml(roomType.label)}</h3>
                  <div class="thumb-grid" data-room-gallery="${escapeAttribute(roomType.key)}">
                    ${
                      roomGalleries[roomType.key] && roomGalleries[roomType.key].length
                        ? roomGalleries[roomType.key]
                            .map(
                              (image, index) => `
                                <article class="thumb-card">
                                  <img src="${escapeAttribute(image.url || image)}" alt="${escapeAttribute(image.alt || roomType.label)}" />
                                  <div class="inline-actions">
                                    <button class="button secondary" type="button" data-move-up="${roomType.key}" data-index="${index}" aria-label="Przesun w lewo" ${index === 0 ? 'disabled' : ''}>←</button>
                                    <button class="button secondary" type="button" data-move-down="${roomType.key}" data-index="${index}" aria-label="Przesun w prawo" ${index === roomGalleries[roomType.key].length - 1 ? 'disabled' : ''}>→</button>
                                    <button class="button danger" type="button" data-remove-room-image="${roomType.key}" data-index="${index}">Usun</button>
                                  </div>
                                </article>`
                            )
                            .join("")
                        : `<p class="empty">Brak zdjec dla tego typu pokoju.</p>`
                    }
                  </div>
                </div>
              </div>`
          )
          .join("")}
      </div>
    `;

    const uploadForm = panel.querySelector("#hotel-room-gallery-upload-form");
    const fileInput = uploadForm?.querySelector('input[name="images"]');
    const fileLabel = uploadForm?.querySelector("[data-room-gallery-file-label]");
    fileInput?.addEventListener("change", () => {
      const count = fileInput.files?.length || 0;
      if (!fileLabel) return;
      if (!count) {
        fileLabel.textContent = "Nie wybrano jeszcze zadnych plikow.";
      } else if (count === 1) {
        fileLabel.textContent = fileInput.files[0]?.name || "Wybrano 1 plik.";
      } else {
        fileLabel.textContent = `Wybrano ${count} pliki do wgrania.`;
      }
    });

    uploadForm?.addEventListener("submit", (event) => {
      const form = event.currentTarget;
      const selectedRoomType = form?.querySelector('[name="roomType"]')?.value;
      uploadRoomGalleryImages(event, selectedRoomType);
    });

    panel.querySelectorAll("[data-remove-room-image]").forEach((button) => {
      button.addEventListener("click", () => removeRoomImage(button.dataset.removeRoomImage, Number(button.dataset.index)));
    });

    panel.querySelectorAll("[data-move-up]").forEach((button) => {
      button.addEventListener("click", () => moveRoomImage(button.dataset.moveUp, Number(button.dataset.index), -1));
    });

    panel.querySelectorAll("[data-move-down]").forEach((button) => {
      button.addEventListener("click", () => moveRoomImage(button.dataset.moveDown, Number(button.dataset.index), 1));
    });
  }

  function setHotelRoomGalleries(roomGalleries) {
    const normalized = normalizeHotelRoomGalleries(roomGalleries);

    if (!state.content.hotel) {
      state.content.hotel = {};
    }
    state.content.hotel.roomGalleries = structuredClone(normalized);

    if (!state.lastSavedContent) {
      state.lastSavedContent = structuredClone(state.content);
    }
    if (!state.lastSavedContent.hotel) {
      state.lastSavedContent.hotel = {};
    }
    state.lastSavedContent.hotel.roomGalleries = structuredClone(normalized);
    refreshSaveDockVisibility();
  }

  async function uploadRoomGalleryImages(event, roomType) {
    event.preventDefault();
    if (!roomType) {
      renderHotelRoomGalleriesPanel({ tone: "error", text: "Wybierz album docelowy." });
      return;
    }
    const form = event.currentTarget;
    const formData = new FormData(form);
    const files = formData.getAll("images");

    if (files.length === 0 || !files[0].size) {
      const fileInput = form.querySelector('input[name="images"]');
      if (fileInput) {
        fileInput.click();
      } else {
        renderHotelRoomGalleriesPanel({ tone: "error", text: "Wybierz pliki do wgrania." });
      }
      return;
    }

    try {
      const payload = new FormData();
      const compressedFiles = await Promise.all(
        files
          .filter((file) => file instanceof File && file.size)
          .map((file) => compressImageFile(file, { maxBytes: API_IMAGE_MAX_BYTES }))
      );
      compressedFiles.forEach((file) => {
        payload.append("images", file, file.name);
      });
      if (!payload.getAll("images").length) {
        renderHotelRoomGalleriesPanel({ tone: "error", text: "Wybierz pliki do wgrania." });
        return;
      }
      const response = await api(`/api/admin/hotel/room-galleries/${encodeURIComponent(roomType)}/images`, {
        method: "POST",
        body: payload,
      });
      setHotelRoomGalleries(response?.roomGalleries);
      renderHotelRoomGalleriesPanel({ tone: "success", text: "Zdjecia zostaly wgrane poprawnie." });
    } catch (error) {
      renderHotelRoomGalleriesPanel({ tone: "error", text: error.message || "Blad podczas wgrywania zdjec." });
    }
  }

  async function removeRoomImage(roomType, index) {
    const image = state.content.hotel?.roomGalleries?.[roomType]?.[index];
    const imageId = Number(image?.id);
    if (!Number.isInteger(imageId) || imageId <= 0) {
      return;
    }
    try {
      const response = await api(`/api/admin/hotel/room-images/${imageId}`, {
        method: "DELETE",
      });
      setHotelRoomGalleries(response?.roomGalleries);
      renderHotelRoomGalleriesPanel({ tone: "success", text: "Zdjecie zostalo usuniete." });
    } catch (error) {
      renderHotelRoomGalleriesPanel({ tone: "error", text: error.message || "Nie udalo sie usunac zdjecia." });
    }
  }

  async function moveRoomImage(roomType, index, direction) {
    if (!state.content.hotel?.roomGalleries?.[roomType]) {
      return;
    }
    const images = state.content.hotel.roomGalleries[roomType];
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= images.length) {
      return;
    }
    const reordered = [...images];
    [reordered[index], reordered[newIndex]] = [reordered[newIndex], reordered[index]];
    const imageIds = reordered
      .map((entry) => Number(entry?.id))
      .filter((id) => Number.isInteger(id) && id > 0);
    if (imageIds.length !== reordered.length) {
      renderHotelRoomGalleriesPanel({ tone: "error", text: "Nie udalo sie zmienic kolejnosci. Odswiez panel." });
      return;
    }
    try {
      const response = await api(`/api/admin/hotel/room-galleries/${encodeURIComponent(roomType)}/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageIds }),
      });
      setHotelRoomGalleries(response?.roomGalleries);
      renderHotelRoomGalleriesPanel({ tone: "success", text: "Kolejnosc zdjec zostala zmieniona." });
    } catch (error) {
      renderHotelRoomGalleriesPanel({ tone: "error", text: error.message || "Nie udalo sie zmienic kolejnosci zdjec." });
    }
  }

  function renderEventsHallGalleriesPanel(statusMessage = "") {
    const panel = document.querySelector("#events-hall-galleries-panel");
    if (!panel) return;
    const hallGalleries = normalizeEventHallGalleries(state.content.events?.hallGalleries);

    const hallTypes = [
      { key: "1", label: "Sala Duza" },
      { key: "2", label: "Sala Mala" },
    ];

    panel.innerHTML = `
      <p class="pill">Przyjecia</p>
      <h2>Galeria Sal</h2>
      <p class="section-intro">Zarzadzaj zdjeciami dla poszczegolnych sal. Mozesz dodawac, usuwac i zmieniac kolejnosc zdjec.</p>
      <p class="status">${escapeHtml(statusMessage)}</p>
      <div class="grid">
        ${hallTypes
          .map(
            (hallType) => `
              <div class="col-6">
                <div class="repeater-item">
                  <h3>${escapeHtml(hallType.label)}</h3>
                  <form class="stack" data-upload-hall-gallery="${escapeAttribute(hallType.key)}">
                    <label class="field-full">
                      <span>Dodaj zdjecia</span>
                      <input type="file" name="images" accept="image/*" multiple />
                    </label>
                    <button class="button secondary" type="submit">Wgraj zdjecia</button>
                  </form>
                  <div class="thumb-grid" data-hall-gallery="${escapeAttribute(hallType.key)}">
                    ${
                      hallGalleries[hallType.key] && hallGalleries[hallType.key].length
                        ? hallGalleries[hallType.key]
                            .map(
                              (image, index) => `
                                <article class="thumb-card">
                                  <img src="${escapeAttribute(image.url || image)}" alt="${escapeAttribute(image.alt || hallType.label)}" />
                                  <div class="inline-actions">
                                    <button class="button secondary" type="button" data-move-up-hall="${hallType.key}" data-index="${index}" aria-label="Przesun w lewo" ${index === 0 ? 'disabled' : ''}>←</button>
                                    <button class="button secondary" type="button" data-move-down-hall="${hallType.key}" data-index="${index}" aria-label="Przesun w prawo" ${index === hallGalleries[hallType.key].length - 1 ? 'disabled' : ''}>→</button>
                                    <button class="button danger" type="button" data-remove-hall-image="${hallType.key}" data-index="${index}">Usun</button>
                                  </div>
                                </article>`
                            )
                            .join("")
                        : `<p class="empty">Brak zdjec dla tej sali.</p>`
                    }
                  </div>
                </div>
              </div>`
          )
          .join("")}
      </div>
    `;

    panel.querySelectorAll("[data-upload-hall-gallery]").forEach((form) => {
      form.addEventListener("submit", (e) => uploadHallGalleryImages(e, form.dataset.uploadHallGallery));
    });

    panel.querySelectorAll("[data-remove-hall-image]").forEach((button) => {
      button.addEventListener("click", () => removeHallImage(button.dataset.removeHallImage, Number(button.dataset.index)));
    });

    panel.querySelectorAll("[data-move-up-hall]").forEach((button) => {
      button.addEventListener("click", () => moveHallImage(button.dataset.moveUpHall, Number(button.dataset.index), -1));
    });

    panel.querySelectorAll("[data-move-down-hall]").forEach((button) => {
      button.addEventListener("click", () => moveHallImage(button.dataset.moveDownHall, Number(button.dataset.index), 1));
    });
  }

  async function uploadHallGalleryImages(event, hallNumber) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const files = formData.getAll("images");

    if (files.length === 0 || !files[0].size) {
      renderEventsHallGalleriesPanel("Wybierz pliki do wgrania.");
      return;
    }

    try {
      const images = await filesToInlineGalleryImages(files, INLINE_IMAGE_MAX_BYTES, hallNumber);

      if (!state.content.events) {
        state.content.events = {};
      }
      state.content.events.hallGalleries = normalizeEventHallGalleries(state.content.events.hallGalleries);

      if (!state.content.events.hallGalleries[hallNumber]) {
        state.content.events.hallGalleries[hallNumber] = [];
      }

      state.content.events.hallGalleries[hallNumber].push(...images);
      await saveContent();
      await loadDashboard("Zdjecia zostaly dodane.");
    } catch (error) {
      renderEventsHallGalleriesPanel(error.message || "Blad podczas wgrywania zdjec.");
    }
  }

  async function removeHallImage(hallNumber, index) {
    if (!state.content.events?.hallGalleries?.[hallNumber]) {
      return;
    }
    state.content.events.hallGalleries[hallNumber].splice(index, 1);
    await saveContent();
    await loadDashboard("Zdjecie zostalo usuniete.");
  }

  async function moveHallImage(hallNumber, index, direction) {
    if (!state.content.events?.hallGalleries?.[hallNumber]) {
      return;
    }
    const images = state.content.events.hallGalleries[hallNumber];
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= images.length) {
      return;
    }
    [images[index], images[newIndex]] = [images[newIndex], images[index]];
    await saveContent();
    await loadDashboard("Kolejnosc zdjec zostala zmieniona.");
  }

  function renderDocumentsPanel(statusMessage = "") {
    const panel = document.querySelector("#documents-panel");
    if (!panel) return;
    const documentsPage = normalizeDocumentsPage(state.content.documentsPage);
    const mediaEnabled = state.capabilities?.mediaStorageEnabled === true;

    panel.innerHTML = `
      <p class="pill">Dokumenty</p>
      <h2>Dokumenty strony i pliki</h2>
      <div class="stack">
        <!-- Sekcja dokumentów tekstowych na podstronie -->
        <div class="repeater-item">
          <div class="repeater-head">
            <div>
              <h3>Dokumenty wyświetlane na stronie /dokumenty</h3>
              <p class="helper">Dokumenty tekstowe widoczne dla użytkowników na podstronie. Możesz dodać tytuł, podtytuł i sekcje z treścią.</p>
            </div>
            <button class="button" type="button" id="add-documents-page-document">+ Nowy dokument</button>
          </div>
          <div id="documents-page-list" class="repeater-list"></div>
          <div class="inline-actions" id="documents-page-actions" style="display: none;">
            <button class="button" type="button" id="save-documents-page">Zapisz zmiany</button>
          </div>
        </div>

        <!-- Sekcja plików do pobrania -->
        <div class="repeater-item">
          <div class="repeater-head">
            <div>
              <h3>Pliki do pobrania</h3>
              <p class="helper">Pliki PDF, DOC, DOCX dostępne do pobrania przez użytkowników.</p>
            </div>
            <button class="button" type="button" id="open-upload-modal" ${mediaEnabled ? "" : "disabled"}>+ Wgraj plik</button>
          </div>
          ${mediaEnabled ? "" : '<p class="status">Upload plików jest obecnie niedostępny.</p>'}
          <div id="documents-files-list" class="repeater-list">
            ${
              state.documents.length
                ? state.documents
                    .map(
                      (documentEntry) => `
                        <article class="list-item">
                          <div class="list-head">
                            <strong>${escapeHtml(documentEntry.title)}</strong>
                            <span class="pill">${escapeHtml(documentEntry.fileType || "")}</span>
                          </div>
                          <p>${escapeHtml(documentEntry.description || "")}</p>
                          <div class="inline-actions">
                            <a class="button secondary" href="${escapeAttribute(documentEntry.downloadUrl)}" target="_blank" rel="noreferrer">Pobierz plik</a>
                            <button class="button danger" type="button" data-delete-document="${documentEntry.id}" ${mediaEnabled ? "" : "disabled"}>Usuń</button>
                          </div>
                        </article>`
                    )
                    .join("")
                : `<p class="empty">Brak plików.</p>`
            }
          </div>
        </div>
      </div>
      <div id="documents-modal-root"></div>
    `;

    state.content.documentsPage = documentsPage;
    renderDocumentsPageList();
    panel.querySelector("#add-documents-page-document")?.addEventListener("click", openCreateDocumentModal);
    panel.querySelector("#save-documents-page")?.addEventListener("click", saveDocumentsPage);
    panel.querySelector("#open-upload-modal")?.addEventListener("click", openUploadFileModal);
    panel.querySelectorAll("[data-delete-document]").forEach((button) => {
      button.addEventListener("click", () => deleteDocument(button.dataset.deleteDocument));
    });
  }

  function renderDocumentsPageList() {
    const target = document.querySelector("#documents-page-list");
    const actions = document.querySelector("#documents-page-actions");
    if (!target) return;

    const documents = state.content.documentsPage?.documents || [];

    if (documents.length === 0) {
      target.innerHTML = `<p class="empty">Brak dokumentów. Kliknij "+ Nowy dokument", aby dodać pierwszy dokument.</p>`;
      if (actions) actions.style.display = "none";
      return;
    }

    target.innerHTML = documents
      .map((documentEntry, documentIndex) => {
        const rawTitle = String(documentEntry.title || "").trim();
        const displayTitle = rawTitle || `Dokument ${documentIndex + 1} (bez tytułu)`;
        const sectionCount = (documentEntry.sections || []).length;
        return `
        <article class="list-item documents-page-list-row">
          <div class="list-head documents-page-list-head">
            <strong class="documents-page-list-title">${escapeHtml(displayTitle)}</strong>
            <span class="helper">${sectionCount} ${sectionCount === 1 ? "sekcja" : sectionCount < 5 ? "sekcje" : "sekcji"}</span>
          </div>
          <div class="inline-actions">
            <button class="button" type="button" data-edit-doc-page="${documentIndex}">Edytuj</button>
            <button class="button secondary" type="button" data-move-document-up="${documentIndex}" ${documentIndex === 0 ? "disabled" : ""}>↑</button>
            <button class="button secondary" type="button" data-move-document-down="${documentIndex}" ${documentIndex === documents.length - 1 ? "disabled" : ""}>↓</button>
            <button class="button danger" type="button" data-remove-document="${documentIndex}">Usuń</button>
          </div>
        </article>`;
      })
      .join("");

    if (actions) actions.style.display = "flex";

    target.querySelectorAll("[data-edit-doc-page]").forEach((button) => {
      button.addEventListener("click", () => openEditDocumentModal(Number(button.dataset.editDocPage)));
    });

    target.querySelectorAll("[data-remove-document]").forEach((button) => {
      button.addEventListener("click", () => removeDocumentsPageDocument(Number(button.dataset.removeDocument)));
    });

    target.querySelectorAll("[data-move-document-up]").forEach((button) => {
      button.addEventListener("click", () => moveDocumentsPageDocument(Number(button.dataset.moveDocumentUp), -1));
    });

    target.querySelectorAll("[data-move-document-down]").forEach((button) => {
      button.addEventListener("click", () => moveDocumentsPageDocument(Number(button.dataset.moveDocumentDown), 1));
    });
  }

  function collectDocumentsPageFromPanel() {
    return normalizeDocumentsPage(state.content.documentsPage);
  }

  function removeDocumentsPageDocument(index) {
    const docs = state.content.documentsPage?.documents || [];
    docs.splice(index, 1);
    state.content.documentsPage = { documents: docs };
    renderDocumentsPanel();
    refreshSaveDockVisibility();
  }

  function moveDocumentsPageDocument(index, direction) {
    const docs = state.content.documentsPage?.documents || [];
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= docs.length) return;
    [docs[index], docs[nextIndex]] = [docs[nextIndex], docs[index]];
    state.content.documentsPage = { documents: docs };
    renderDocumentsPanel();
    refreshSaveDockVisibility();
  }

  // === MODALE DOKUMENTÓW ===

  function openCreateDocumentModal() {
    const modalRoot = document.querySelector("#documents-modal-root");
    if (!modalRoot) return;

    modalRoot.innerHTML = `
      <div class="admin-modal-overlay" data-doc-modal-overlay>
        <section class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="doc-create-title">
          <div class="admin-modal-head">
            <div>
              <p class="pill">Nowy dokument</p>
              <h3 id="doc-create-title">Utwórz nowy dokument</h3>
              <p class="helper">Dodaj dokument tekstowy, który będzie wyświetlany na podstronie /dokumenty.</p>
            </div>
            <button class="button icon-button secondary" type="button" data-doc-modal-close aria-label="Zamknij">×</button>
          </div>
          <div class="admin-modal-body">
            <div class="field-grid">
              <label class="field-full"><span>Tytuł dokumentu *</span><input id="doc-modal-title" required placeholder="np. Regulamin hotelu" /></label>
              <label class="field-full"><span>Podtytuł (opcjonalnie)</span><input id="doc-modal-subtitle" placeholder="np. Obowiązuje od 01.01.2024" /></label>
            </div>
            <div class="repeater-list" id="doc-modal-sections"></div>
            <div class="inline-actions">
              <button class="button secondary" type="button" id="doc-modal-add-section">+ Dodaj sekcję</button>
            </div>
          </div>
          <div class="admin-modal-footer">
            <button class="button secondary" type="button" data-doc-modal-close>Anuluj</button>
            <button class="button" type="button" id="doc-modal-create">Utwórz dokument</button>
          </div>
        </section>
      </div>
    `;

    document.body.classList.add("admin-modal-open");

    const sections = [];

    function renderSections() {
      const sectionsContainer = modalRoot.querySelector("#doc-modal-sections");
      if (!sectionsContainer) return;

      if (sections.length === 0) {
        sectionsContainer.innerHTML = `<p class="helper">Dodaj przynajmniej jedną sekcję z treścią dokumentu.</p>`;
        return;
      }

      sectionsContainer.innerHTML = sections
        .map((section, index) => `
          <div class="repeater-item">
            <div class="repeater-head">
              <strong>Sekcja ${index + 1}</strong>
              <div class="inline-actions">
                <button class="button secondary" type="button" data-move-section="${index}" data-direction="-1" ${index === 0 ? "disabled" : ""}>↑</button>
                <button class="button secondary" type="button" data-move-section="${index}" data-direction="1" ${index === sections.length - 1 ? "disabled" : ""}>↓</button>
                <button class="button danger" type="button" data-remove-section="${index}">Usuń</button>
              </div>
            </div>
            <div class="field-grid">
              <label class="field-full"><span>Nagłówek sekcji</span><input data-section-title="${index}" value="${escapeAttribute(section.title)}" placeholder="np. §1 Postanowienia ogólne" /></label>
              <label class="field-full"><span>Treść sekcji</span><textarea data-section-text="${index}" rows="4" placeholder="Treść sekcji...">${escapeHtml(section.text)}</textarea></label>
            </div>
          </div>
        `)
        .join("");

      sectionsContainer.querySelectorAll("[data-remove-section]").forEach((btn) => {
        btn.addEventListener("click", () => {
          sections.splice(Number(btn.dataset.removeSection), 1);
          renderSections();
        });
      });

      sectionsContainer.querySelectorAll("[data-move-section]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const index = Number(btn.dataset.moveSection);
          const direction = Number(btn.dataset.direction);
          const newIndex = index + direction;
          if (newIndex >= 0 && newIndex < sections.length) {
            [sections[index], sections[newIndex]] = [sections[newIndex], sections[index]];
            renderSections();
          }
        });
      });
    }

    modalRoot.querySelector("#doc-modal-add-section")?.addEventListener("click", () => {
      sections.push({ title: "", text: "" });
      renderSections();
    });

    modalRoot.querySelector("#doc-modal-create")?.addEventListener("click", () => {
      const title = modalRoot.querySelector("#doc-modal-title")?.value.trim();
      const subtitle = modalRoot.querySelector("#doc-modal-subtitle")?.value.trim() || "";

      if (!title) {
        alert("Podaj tytuł dokumentu.");
        return;
      }

      // Zbierz sekcje z formularza
      const sectionItems = modalRoot.querySelectorAll("#doc-modal-sections .repeater-item");
      const finalSections = [];
      sectionItems.forEach((item, index) => {
        const sectionTitle = item.querySelector(`[data-section-title="${index}"]`)?.value.trim() || "";
        const sectionText = item.querySelector(`[data-section-text="${index}"]`)?.value.trim() || "";
        if (sectionTitle || sectionText) {
          finalSections.push({ title: sectionTitle, text: sectionText });
        }
      });

      // Dodaj dokument do stanu
      const docs = state.content.documentsPage?.documents || [];
      docs.push({ title, subtitle, sections: finalSections });
      state.content.documentsPage = { documents: docs };

      closeDocumentsModal();
      renderDocumentsPanel();
      refreshSaveDockVisibility();
    });

    modalRoot.querySelectorAll("[data-doc-modal-close]").forEach((btn) => {
      btn.addEventListener("click", closeDocumentsModal);
    });

    modalRoot.querySelector("[data-doc-modal-overlay]")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeDocumentsModal();
    });

    renderSections();
  }

  function openEditDocumentModal(documentIndex) {
    const docs = state.content.documentsPage?.documents || [];
    const doc = docs[documentIndex];
    if (!doc) return;

    const modalRoot = document.querySelector("#documents-modal-root");
    if (!modalRoot) return;

    modalRoot.innerHTML = `
      <div class="admin-modal-overlay" data-doc-modal-overlay>
        <section class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="doc-edit-title">
          <div class="admin-modal-head">
            <div>
              <p class="pill">Edycja dokumentu</p>
              <h3 id="doc-edit-title">Edytuj dokument</h3>
              <p class="helper">Zmień treść dokumentu wyświetlanego na podstronie.</p>
            </div>
            <button class="button icon-button secondary" type="button" data-doc-modal-close aria-label="Zamknij">×</button>
          </div>
          <div class="admin-modal-body">
            <div class="field-grid">
              <label class="field-full"><span>Tytuł dokumentu *</span><input id="doc-modal-title" required value="${escapeAttribute(doc.title || "")}" /></label>
              <label class="field-full"><span>Podtytuł (opcjonalnie)</span><input id="doc-modal-subtitle" value="${escapeAttribute(doc.subtitle || "")}" /></label>
            </div>
            <div class="repeater-list" id="doc-modal-sections"></div>
            <div class="inline-actions">
              <button class="button secondary" type="button" id="doc-modal-add-section">+ Dodaj sekcję</button>
            </div>
          </div>
          <div class="admin-modal-footer">
            <button class="button secondary" type="button" data-doc-modal-close>Anuluj</button>
            <button class="button" type="button" id="doc-modal-save">Zapisz zmiany</button>
          </div>
        </section>
      </div>
    `;

    document.body.classList.add("admin-modal-open");

    const sections = structuredClone(doc.sections || []);

    function renderSections() {
      const sectionsContainer = modalRoot.querySelector("#doc-modal-sections");
      if (!sectionsContainer) return;

      if (sections.length === 0) {
        sectionsContainer.innerHTML = `<p class="helper">Brak sekcji. Dodaj przynajmniej jedną sekcję.</p>`;
        return;
      }

      sectionsContainer.innerHTML = sections
        .map((section, index) => `
          <div class="repeater-item">
            <div class="repeater-head">
              <strong>Sekcja ${index + 1}</strong>
              <div class="inline-actions">
                <button class="button secondary" type="button" data-move-section="${index}" data-direction="-1" ${index === 0 ? "disabled" : ""}>↑</button>
                <button class="button secondary" type="button" data-move-section="${index}" data-direction="1" ${index === sections.length - 1 ? "disabled" : ""}>↓</button>
                <button class="button danger" type="button" data-remove-section="${index}">Usuń</button>
              </div>
            </div>
            <div class="field-grid">
              <label class="field-full"><span>Nagłówek sekcji</span><input data-section-title="${index}" value="${escapeAttribute(section.title)}" placeholder="np. §1 Postanowienia ogólne" /></label>
              <label class="field-full"><span>Treść sekcji</span><textarea data-section-text="${index}" rows="4" placeholder="Treść sekcji...">${escapeHtml(section.text)}</textarea></label>
            </div>
          </div>
        `)
        .join("");

      sectionsContainer.querySelectorAll("[data-remove-section]").forEach((btn) => {
        btn.addEventListener("click", () => {
          sections.splice(Number(btn.dataset.removeSection), 1);
          renderSections();
        });
      });

      sectionsContainer.querySelectorAll("[data-move-section]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const index = Number(btn.dataset.moveSection);
          const direction = Number(btn.dataset.direction);
          const newIndex = index + direction;
          if (newIndex >= 0 && newIndex < sections.length) {
            [sections[index], sections[newIndex]] = [sections[newIndex], sections[index]];
            renderSections();
          }
        });
      });
    }

    modalRoot.querySelector("#doc-modal-add-section")?.addEventListener("click", () => {
      sections.push({ title: "", text: "" });
      renderSections();
    });

    modalRoot.querySelector("#doc-modal-save")?.addEventListener("click", () => {
      const title = modalRoot.querySelector("#doc-modal-title")?.value.trim();
      const subtitle = modalRoot.querySelector("#doc-modal-subtitle")?.value.trim() || "";

      if (!title) {
        alert("Podaj tytuł dokumentu.");
        return;
      }

      // Zbierz sekcje z formularza
      const sectionItems = modalRoot.querySelectorAll("#doc-modal-sections .repeater-item");
      const finalSections = [];
      sectionItems.forEach((item, index) => {
        const sectionTitle = item.querySelector(`[data-section-title="${index}"]`)?.value.trim() || "";
        const sectionText = item.querySelector(`[data-section-text="${index}"]`)?.value.trim() || "";
        if (sectionTitle || sectionText) {
          finalSections.push({ title: sectionTitle, text: sectionText });
        }
      });

      // Zaktualizuj dokument w stanie
      docs[documentIndex] = { title, subtitle, sections: finalSections };
      state.content.documentsPage = { documents: docs };

      closeDocumentsModal();
      renderDocumentsPanel();
      refreshSaveDockVisibility();
    });

    modalRoot.querySelectorAll("[data-doc-modal-close]").forEach((btn) => {
      btn.addEventListener("click", closeDocumentsModal);
    });

    modalRoot.querySelector("[data-doc-modal-overlay]")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeDocumentsModal();
    });

    renderSections();
  }

  function openUploadFileModal() {
    const modalRoot = document.querySelector("#documents-modal-root");
    if (!modalRoot) return;

    modalRoot.innerHTML = `
      <div class="admin-modal-overlay" data-doc-modal-overlay>
        <section class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="upload-file-title">
          <div class="admin-modal-head">
            <div>
              <p class="pill">Wgraj plik</p>
              <h3 id="upload-file-title">Wgraj plik do pobrania</h3>
              <p class="helper">Dodaj plik PDF, DOC lub DOCX, który będzie dostępny do pobrania przez użytkowników.</p>
            </div>
            <button class="button icon-button secondary" type="button" data-doc-modal-close aria-label="Zamknij">×</button>
          </div>
          <div class="admin-modal-body">
            <form id="upload-file-form">
              <div class="field-grid">
                <label class="field-full"><span>Tytuł pliku *</span><input name="title" required placeholder="np. Cennik usług 2024" /></label>
                <label class="field-full"><span>Plik *</span><input name="file" type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required /></label>
                <label class="field-full"><span>Opis (opcjonalnie)</span><textarea name="description" rows="3" placeholder="Krótki opis zawartości pliku..."></textarea></label>
              </div>
              <p class="helper">Maksymalny rozmiar pliku: ok. 1.7 MB. Dozwolone formaty: PDF, DOC, DOCX.</p>
            </form>
          </div>
          <div class="admin-modal-footer">
            <button class="button secondary" type="button" data-doc-modal-close>Anuluj</button>
            <button class="button" type="button" id="upload-file-submit">Wgraj plik</button>
          </div>
        </section>
      </div>
    `;

    document.body.classList.add("admin-modal-open");

    modalRoot.querySelector("#upload-file-submit")?.addEventListener("click", async () => {
      const form = modalRoot.querySelector("#upload-file-form");
      const formData = new FormData(form);
      const file = formData.get("file");
      const title = formData.get("title")?.trim();

      if (!title) {
        alert("Podaj tytuł pliku.");
        return;
      }

      if (!(file instanceof File) || !file.size) {
        alert("Wybierz plik do wgrania.");
        return;
      }

      if (file.size > DOCUMENT_MAX_BYTES) {
        alert("Plik jest zbyt duży. Maksymalny rozmiar to ok. 1.7 MB.");
        return;
      }

      try {
        const authHeaders = await getFirebaseAuthHeaders();
        await fetch(state.apiBase + "/api/admin/documents", {
          method: "POST",
          body: formData,
          credentials: "include",
          headers: authHeaders,
        }).then(async (response) => {
          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || "Nie udało się dodać pliku.");
          }
        });
        closeDocumentsModal();
        await loadDashboard("Plik został wgrany.");
      } catch (error) {
        alert(error.message);
      }
    });

    modalRoot.querySelectorAll("[data-doc-modal-close]").forEach((btn) => {
      btn.addEventListener("click", closeDocumentsModal);
    });

    modalRoot.querySelector("[data-doc-modal-overlay]")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeDocumentsModal();
    });
  }

  function closeDocumentsModal() {
    const modalRoot = document.querySelector("#documents-modal-root");
    if (modalRoot) modalRoot.innerHTML = "";
    document.body.classList.remove("admin-modal-open");
  }

  async function saveDocumentsPage() {
    state.content.documentsPage = collectDocumentsPageFromPanel();
    await saveContent("Dokumenty podstrony zostaly zapisane.");
  }

  async function deleteDocument(documentId) {
    await api(`/api/admin/documents/${documentId}`, { method: "DELETE" });
    await loadDashboard("Dokument zostal usuniety.");
  }

  function isoToDatetimeLocalValue(iso) {
    if (!iso) {
      return "";
    }
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return "";
    }
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function datetimeLocalValueToIso(value) {
    const raw = String(value || "").trim();
    if (!raw) {
      return "";
    }
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) {
      return "";
    }
    return d.toISOString();
  }

  function formatNotificationWindowLabel(startsAt, endsAt) {
    const fmt = new Intl.DateTimeFormat("pl-PL", { dateStyle: "short", timeStyle: "short" });
    try {
      return `${fmt.format(new Date(startsAt))} – ${fmt.format(new Date(endsAt))}`;
    } catch {
      return "";
    }
  }

  function isNotificationActiveNow(entry) {
    const now = Date.now();
    const a = Date.parse(entry?.startsAt || "");
    const b = Date.parse(entry?.endsAt || "");
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return false;
    }
    return now >= a && now <= b;
  }

  let mailsSubTab = "hotel";

  function renderMailTemplatesPanel(statusMessage = "") {
    const panel = document.querySelector("#maile-panel");
    if (!panel) return;

    const services = [
      { key: "hotel", label: "Hotel" },
      { key: "restaurant", label: "Catering" },
      { key: "hall", label: "Przyjęcia" },
    ];

    panel.innerHTML = `
      <p class="pill">Komunikacja</p>
      <h2>Szablony mailingowe</h2>
      <p class="helper">Edytuj treść wiadomości wysyłanych do gości i obsługi. Nie usuwaj zmiennych w podwójnych nawiasach klamrowych — np. <code>{{fullName}}</code>, <code>{{reservationNumber}}</code>. System nie pozwoli zapisać szablonu z usuniętą zmienną.</p>
      ${statusMessage ? `<p class="status">${escapeHtml(statusMessage)}</p>` : ""}
      <div class="hotel-nav" id="mail-service-tabs">
        ${services
          .map(
            (s) =>
              `<button type="button" class="button ${mailsSubTab === s.key ? "" : "secondary"}" data-mail-service="${escapeAttribute(s.key)}">${escapeHtml(s.label)}</button>`
          )
          .join("")}
      </div>
      <div id="mail-service-mount"></div>
    `;

    function mountActive() {
      const serviceMap = { hotel: "hotel", restaurant: "restaurant", hall: "hall" };
      const service = serviceMap[mailsSubTab] || "hotel";
      const opts =
        service === "restaurant"
          ? {
              defaultTab: "templates",
              allowedTabs: ["templates"],
              restaurantMailTemplateKeyFilter: ["restaurant_confirmed_client"],
            }
          : { defaultTab: "templates", allowedTabs: ["templates"] };
      mountLegacyBookingModule("#mail-service-mount", service, opts, "");
    }

    panel.querySelectorAll("[data-mail-service]").forEach((btn) => {
      btn.addEventListener("click", () => {
        mailsSubTab = btn.getAttribute("data-mail-service");
        panel.querySelectorAll("[data-mail-service]").forEach((b) => {
          b.classList.toggle("secondary", b.getAttribute("data-mail-service") !== mailsSubTab);
        });
        mountActive();
      });
    });

    mountActive();
  }

  function renderNotificationsPanel(statusMessage = "") {
    const panel = document.querySelector("#notifications-panel");
    if (!panel) {
      return;
    }
    const items = Array.isArray(state.notifications) ? state.notifications : [];
    const sorted = [...items].sort((a, b) => {
      const ao = Number(a?.sortOrder) || 0;
      const bo = Number(b?.sortOrder) || 0;
      if (ao !== bo) {
        return ao - bo;
      }
      return Number(b?.id || 0) - Number(a?.id || 0);
    });
    panel.innerHTML = `
      <p class="pill">Strona glowna</p>
      <h2>Powiadomienia</h2>

      <div class="stack">
        <form id="notification-form" class="repeater-item">
          <input type="hidden" id="notification-record-id" value="" />
          <div class="field-grid">
            <label class="field-full">
              <span>Tytul</span>
              <input id="notification-title" type="text" maxlength="200" required placeholder="np. Zmiana godzin dowozów" />
            </label>
            <label class="field-full">
              <span>Opis</span>
              <textarea id="notification-description" rows="4" maxlength="4000" placeholder="Krotki komunikat dla gosci"></textarea>
            </label>
            <label class="field">
              <span>Od (data i godzina)</span>
              <input id="notification-starts-at" type="datetime-local" required />
            </label>
            <label class="field">
              <span>Do (data i godzina)</span>
              <input id="notification-ends-at" type="datetime-local" required />
            </label>
          </div>
          <div class="inline-actions" style="margin-top:1.5rem;justify-content:flex-end;">
            <button class="button secondary" type="button" id="notification-reset">Nowe (wyczysc formularz)</button>
            <button class="button" type="submit" id="notification-save">Zapisz powiadomienie</button>
          </div>
        </form>
        <p class="status">${escapeHtml(statusMessage)}</p>
        ${
          sorted.length
            ? sorted
                .map(
                  (entry) => `
              <article class="list-item" data-notification-id="${escapeAttribute(String(entry.id))}">
                <div class="list-head">
                  <strong>${escapeHtml(entry.title || "")}</strong>
                  <span class="pill">${isNotificationActiveNow(entry) ? "Aktywne" : "Nieaktywne"}</span>
                </div>
                <p class="helper" style="margin: 0.35rem 0 0.5rem;">${escapeHtml(
                  formatNotificationWindowLabel(entry.startsAt, entry.endsAt)
                )}</p>
                <p>${escapeHtml(entry.description || "")}</p>
                <div class="inline-actions">
                  <button class="button secondary" type="button" data-edit-notification="${escapeAttribute(
                    String(entry.id)
                  )}">Edytuj</button>
                  <button class="button danger" type="button" data-delete-notification="${escapeAttribute(
                    String(entry.id)
                  )}">Usun</button>
                </div>
              </article>`
                )
                .join("")
            : `<p class="empty">Brak powiadomien — dodaj pierwsze powyzej.</p>`
        }
      </div>
    `;

    const form = panel.querySelector("#notification-form");
    const idInput = panel.querySelector("#notification-record-id");
    const titleInput = panel.querySelector("#notification-title");
    const descriptionInput = panel.querySelector("#notification-description");
    const startsInput = panel.querySelector("#notification-starts-at");
    const endsInput = panel.querySelector("#notification-ends-at");

    const fillForm = (entry) => {
      if (!entry) {
        idInput.value = "";
        titleInput.value = "";
        descriptionInput.value = "";
        startsInput.value = "";
        endsInput.value = "";
        return;
      }
      idInput.value = String(entry.id || "");
      titleInput.value = entry.title || "";
      descriptionInput.value = entry.description || "";
      startsInput.value = isoToDatetimeLocalValue(entry.startsAt);
      endsInput.value = isoToDatetimeLocalValue(entry.endsAt);
    };

    panel.querySelector("#notification-reset")?.addEventListener("click", () => fillForm(null));

    panel.querySelectorAll("[data-edit-notification]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = Number(button.dataset.editNotification);
        const entry = sorted.find((item) => Number(item.id) === id);
        if (!entry) {
          return;
        }
        fillForm(entry);
        titleInput?.focus();
      });
    });

    panel.querySelectorAll("[data-delete-notification]").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = Number(button.dataset.deleteNotification);
        if (!Number.isFinite(id) || id <= 0) {
          return;
        }
        if (!window.confirm("Usunac to powiadomienie?")) {
          return;
        }
        try {
          await api(`/api/admin/notifications/${id}`, { method: "DELETE" });
          await loadDashboard("Powiadomienie zostalo usuniete.");
        } catch (error) {
          renderNotificationsPanel(error.message || "Nie udalo sie usunac.");
        }
      });
    });

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const recordId = String(idInput.value || "").trim();
      const payload = {
        title: String(titleInput.value || "").trim(),
        description: String(descriptionInput.value || "").trim(),
        startsAt: datetimeLocalValueToIso(startsInput.value),
        endsAt: datetimeLocalValueToIso(endsInput.value),
      };
      if (!payload.startsAt || !payload.endsAt) {
        renderNotificationsPanel("Uzupelnij date i godzine od oraz do.");
        return;
      }
      try {
        if (recordId) {
          await api(`/api/admin/notifications/${recordId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          await loadDashboard("Powiadomienie zostalo zaktualizowane.");
        } else {
          await api("/api/admin/notifications", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          await loadDashboard("Powiadomienie zostalo dodane.");
        }
      } catch (error) {
        renderNotificationsPanel(error.message || "Nie udalo sie zapisac.");
      }
    });
  }

  function renderCalendarPanel(statusMessage = "") {
    const panel = document.querySelector("#calendar-panel");
    if (!panel) return;
    const halls = Array.isArray(state.content.events?.halls) ? state.content.events.halls : [];
    const largeHall =
      halls.find((hall) => String(hall?.key || "") === "1") ||
      halls.find((hall) => /duza|duża|large/i.test(String(hall?.name || ""))) ||
      halls[0] ||
      null;
    const largeHallKey = largeHall ? String(largeHall.key || "") : "";
    panel.innerHTML = `
      <p class="pill">Kalendarz sal</p>
      <h2>Zarezerwuj termin</h2>
      <div class="stack">
        <form id="calendar-form" class="repeater-item">
          <div class="field-grid">
            <label class="field">
              <span>Sala</span>
              <select name="hallKey" required>
                ${state.content.events.halls
                  .map((hall) => `<option value="${escapeAttribute(hall.key)}">${escapeHtml(hall.name)}</option>`)
                  .join("")}
              </select>
            </label>
            <label class="field"><span>Etykieta</span><input name="label" placeholder="np. Wesele Nowak" required /></label>
            <label class="field"><span>Od</span><input name="startAt" type="datetime-local" required /></label>
            <label class="field"><span>Do</span><input name="endAt" type="datetime-local" required /></label>
            <label class="field" id="calendar-guests-field" style="display:none;">
              <span>Liczba osob (duza sala)</span>
              <input name="guestsCount" type="number" min="1" step="1" placeholder="np. 40" />
            </label>
            <label class="field-full" id="calendar-exclusive-field" style="display:none;">
              <span class="checkbox-field">
                <input name="exclusive" type="checkbox" value="1" />
                <span class="checkbox-copy">
                  <strong>Sala na wylacznosc</strong>
                  <span>Blokuje cala duza sale niezaleznie od liczby osob.</span>
                </span>
              </span>
            </label>
            <label class="field-full"><span>Notatka</span><textarea name="notes"></textarea></label>
          </div>
          <button class="button" type="submit">Zarezerwuj termin</button>
          <p class="status">${escapeHtml(statusMessage)}</p>
        </form>
        ${
          state.calendarBlocks.length
            ? state.calendarBlocks
                .map(
                  (block) => `
                    <article class="list-item">
                      <div class="list-head">
                        <strong>${escapeHtml(block.label)}</strong>
                        <span class="pill">${escapeHtml(block.hallName || block.hallKey)}</span>
                      </div>
                      <p>${escapeHtml(block.startAt)} - ${escapeHtml(block.endAt)}</p>
                      ${
                        Number(block.guestsCount) > 0
                          ? `<p class="helper">Liczba osob: ${escapeHtml(String(block.guestsCount))}${block.exclusive ? " | Sala na wylacznosc: tak" : ""}</p>`
                          : block.exclusive
                            ? `<p class="helper">Sala na wylacznosc: tak</p>`
                            : ""
                      }
                      <p class="helper">${escapeHtml(block.notes || "")}</p>
                      <button class="button danger" type="button" data-delete-block="${block.id}">Usun rezerwacje terminu</button>
                    </article>`
                )
                .join("")
            : `<p class="empty">Brak rezerwacji terminow.</p>`
        }
      </div>
    `;

    const form = document.querySelector("#calendar-form");
    const hallSelect = form?.querySelector('select[name="hallKey"]');
    const guestsField = form?.querySelector("#calendar-guests-field");
    const guestsInput = form?.querySelector('input[name="guestsCount"]');
    const exclusiveField = form?.querySelector("#calendar-exclusive-field");
    const exclusiveInput = form?.querySelector('input[name="exclusive"]');

    const updateCalendarOptionalFields = () => {
      const selectedHallKey = String(hallSelect?.value || "");
      const isLargeHallSelected = Boolean(largeHallKey) && selectedHallKey === largeHallKey;
      if (guestsField) {
        guestsField.style.display = isLargeHallSelected ? "" : "none";
      }
      if (exclusiveField) {
        exclusiveField.style.display = isLargeHallSelected ? "" : "none";
      }
      if (guestsInput) {
        guestsInput.required = isLargeHallSelected;
        if (!isLargeHallSelected) {
          guestsInput.value = "";
        }
      }
      if (exclusiveInput && !isLargeHallSelected) {
        exclusiveInput.checked = false;
      }
    };

    hallSelect?.addEventListener("change", updateCalendarOptionalFields);
    updateCalendarOptionalFields();
    form?.addEventListener("submit", addCalendarBlock);
    panel.querySelectorAll("[data-delete-block]").forEach((button) => {
      button.addEventListener("click", () => deleteCalendarBlock(button.dataset.deleteBlock));
    });
  }

  async function addCalendarBlock(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    payload.exclusive = formData.has("exclusive");
    if (!payload.guestsCount) {
      delete payload.guestsCount;
    }
    try {
      await api("/api/admin/calendar/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await loadDashboard("Termin zostal zarezerwowany.");
    } catch (error) {
      renderCalendarPanel(error.message);
    }
  }

  async function deleteCalendarBlock(blockId) {
    await api(`/api/admin/calendar/blocks/${blockId}`, { method: "DELETE" });
    await loadDashboard("Rezerwacja terminu zostala usunieta.");
  }

  async function handleLogin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = String(form.email.value || "").trim();
    const password = form.password.value;
    try {
      await firebase.auth().signInWithEmailAndPassword(email, password);
      /* Sukces: panel zaladuje sie w onAuthStateChanged po weryfikacji tokenu przez API */
    } catch (error) {
      if (error?.code?.startsWith?.("auth/")) {
        renderLogin(mapFirebaseError(error));
        return;
      }
      renderLogin(error.message || "Logowanie nie powiodlo sie.");
    }
  }

  async function logout() {
    if (!confirmLeaveIfUnsaved()) {
      return;
    }
    try {
      await firebase.auth().signOut();
    } catch (error) {
      /* ignore */
    }
    state.loggedIn = false;
    renderLogin();
  }

  async function loadDashboard(message = "") {
    const data = await api("/api/admin/dashboard");
    const normalizedContent = normalizeAdminContent(data.content);
    state.content = normalizedContent;
    state.lastSavedContent = structuredClone(normalizedContent);
    state.documents = data.documents;
    state.galleryAlbums = data.galleryAlbums;
    state.calendarBlocks = data.calendarBlocks;
    state.submissions = data.submissions;
    state.notifications = Array.isArray(data.notifications) ? data.notifications : [];
    state.capabilities = data.capabilities || { mediaStorageEnabled: false };
    try {
      await loadScheduleData({ silent: true });
    } catch (error) {
      state.schedule.lastError = error.message || "Nie udało się załadować grafiku.";
    }
    renderDashboard();
    if (message) {
      renderActiveAdminTile(message);
    }
  }

  function bootstrap() {
    window.addEventListener("beforeunload", (event) => {
      if (!hasUnsavedContentChanges()) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && getMenuEditorModalState()) {
        dismissMenuEditorModal();
      }
    });

    initCustomScrollbar();

    if (missingApiConfiguration) {
      renderLogin(getConnectionErrorMessage());
      return;
    }

    if (
      typeof firebase === "undefined" ||
      !config.firebaseApiKey ||
      !config.firebaseProjectId
    ) {
      renderLogin(
        "Brak konfiguracji Firebase. Uzupelnij firebaseApiKey, firebaseAuthDomain i firebaseProjectId w pliku assets/js/config.js."
      );
      return;
    }

    if (!firebase.apps.length) {
      firebase.initializeApp({
        apiKey: config.firebaseApiKey,
        authDomain: config.firebaseAuthDomain || `${config.firebaseProjectId}.firebaseapp.com`,
        projectId: config.firebaseProjectId,
      });
    }

    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) {
        state.loggedIn = false;
        renderLogin();
        return;
      }
      try {
        await api("/api/admin/session");
        state.loggedIn = true;
        await loadDashboard();
      } catch (error) {
        try {
          await firebase.auth().signOut();
        } catch (e) {
          /* ignore */
        }
        state.loggedIn = false;
        renderLogin(error.message || "Brak uprawnien administratora.");
      }
    });
  }

  bootstrap();
})();
