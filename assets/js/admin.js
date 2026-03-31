(function () {
  const config = window.SREDZKA_CONFIG || {};
  const defaultContent = structuredClone(window.SREDZKA_DEFAULT_CONTENT || {});
  const hostname = window.location.hostname;
  const isLocalPreview =
    window.location.protocol === "file:" || hostname === "127.0.0.1" || hostname === "localhost";
  const isGithubPages = hostname.endsWith("github.io");
  const onlineBookingsEnabled = config.enableOnlineBookings === true;
  const fallbackApiBase = isLocalPreview
    ? ""
    : hostname && !isGithubPages
      ? "https://api." + hostname.replace(/^www\./, "")
      : "";
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
    const { idPrefix = "company-opening-hours", intro = "" } = options;
    const schedule = getOpeningHoursEditorState(items);

    return `
      <div class="stack">
        <div>
          <strong>Godziny otwarcia</strong>
          <p class="helper">${escapeHtml(intro || "Kazdy dzien ma osobne pola od i do. Puste pola oznaczaja, ze lokal jest nieczynny.")}</p>
        </div>
        <div class="stack">
          ${schedule
            .map(
              (entry) => `
                <div class="repeater-item opening-hours-day-card">
                  <div class="repeater-head">
                    <strong>${escapeHtml(entry.day)}</strong>
                    <span class="helper">Pozostaw puste, aby oznaczyc dzien jako nieczynny.</span>
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

    content.company.openingHours = normalizeOpeningHours(content.company.openingHours);

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

    if (!content.events) {
      content.events = {};
    }
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

    return content;
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
    capabilities: {
      mediaStorageEnabled: false,
    },
    ui: {
      view: "home",
      topTab: onlineBookingsEnabled ? "rezerwacje" : "hotel",
      tileByTab: {
        rezerwacje: "hotel",
        hotel: "1-osobowe",
        restauracja: "menu",
        przyjecia: "oferta",
        dokumenty: "documents",
        kontakt: "contact",
      },
    },
  };
  const ADMIN_TABS = [
    {
      key: "rezerwacje",
      label: "Rezerwacje",
      description: "Zgloszenia i obsluga rezerwacji z poszczegolnych modulow.",
      tiles: [
        { key: "hotel", label: "Rezerwacja hotel", description: "Rezerwacje pokoi i blokady terminow." },
        { key: "restaurant", label: "Rezerwacja restauracja", description: "Rezerwacje stolikow i blokady." },
        { key: "events", label: "Rezerwacje przyjecia", description: "Zgloszenia sal i rezerwacje eventowe." },
      ],
    },
    {
      key: "hotel",
      label: "Hotel",
      description: "Galerie pokoi i ustawienia formularza hotelowego.",
      tiles: [
        { key: "1-osobowe", label: "1 osobowe", description: "Zdjecia i kolejnosc dla pokoi 1-osobowych." },
        { key: "2-osobowe", label: "2 osobowe", description: "Zdjecia i kolejnosc dla pokoi 2-osobowych." },
        { key: "3-osobowe", label: "3 osobowe", description: "Zdjecia i kolejnosc dla pokoi 3-osobowych." },
        { key: "4-osobowe", label: "4 osobowe", description: "Zdjecia i kolejnosc dla pokoi 4-osobowych." },
        { key: "settings", label: "Ustawienia rezerwacji", description: "Wlaczenie i przerwy w przyjmowaniu rezerwacji." },
      ],
    },
    {
      key: "restauracja",
      label: "Restauracja",
      description: "Menu, galeria, godziny i ustawienia restauracji.",
      tiles: [
        { key: "menu", label: "Menu", description: "Kategorie, pozycje, skladniki i kolejnosc." },
        { key: "gallery", label: "Galeria", description: "Zdjecia restauracji i ich kolejnosc." },
        { key: "orders", label: "Zamowienia / Catering", description: "Edycja tresci modala zamowien i cateringu widocznej na stronie restauracji." },
        { key: "hours", label: "Godziny otwarcia", description: "Dni i godziny widoczne na stronie restauracji." },
        { key: "settings", label: "Ustawienia rezerwacji", description: "Wlaczenie i przerwy w przyjmowaniu rezerwacji." },
      ],
    },
    {
      key: "przyjecia",
      label: "Przyjecia",
      description: "Oferta, sale, galerie, menu okolicznosciowe i ustawienia.",
      tiles: [
        { key: "oferta", label: "Oferta", description: "Edycja tresci kafelka Oferta i modala." },
        { key: "sale", label: "Sale", description: "Nazwy, opisy i pojemnosci sal." },
        { key: "gallery", label: "Galeria", description: "Galerie sal i albumy wydarzen." },
        { key: "menu", label: "Menu okolicznosciowe", description: "Sekcje, pozycje i kolejnosc menu." },
        { key: "settings", label: "Ustawienia rezerwacji", description: "Wlaczenie rezerwacji i blokady terminow sal." },
      ],
    },
    {
      key: "dokumenty",
      label: "Dokumenty",
      description: "Pliki i menu dokumentow.",
      tiles: [
        { key: "documents", label: "Dokumenty", description: "Dodawanie plikow i zarzadzanie menu dokumentow." },
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
  const HOME_TAB_ORDER = ["hotel", "restauracja", "przyjecia", "rezerwacje", "dokumenty", "kontakt"];
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

  async function api(path, options = {}) {
    let response;
    const authHeaders = await getFirebaseAuthHeaders();

    try {
      response = await fetch(state.apiBase + path, {
        ...options,
        credentials: "include",
        headers: {
          ...authHeaders,
          ...(options.headers || {}),
        },
      });
    } catch (error) {
      throw new Error(getConnectionErrorMessage());
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Operacja nie powiodla sie.");
    }

    if (response.status === 204) {
      return null;
    }

    return response.json().catch(() => null);
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
    const stored = state.ui.tileByTab?.[tab.key];
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
    state.ui.view = "section";
    state.ui.topTab = tabKey;
    state.ui.tileByTab[tabKey] = getActiveAdminTile(tabKey);
    renderDashboard();
  }

  function setAdminTile(tabKey, tileKey) {
    dismissMenuEditorModal({ skipRender: true, closeEntirely: true });
    captureDraftIfPossible();
    state.ui.view = "section";
    state.ui.topTab = tabKey;
    state.ui.tileByTab[tabKey] = tileKey;
    renderDashboard();
  }

  function goToAdminHome() {
    dismissMenuEditorModal({ skipRender: true, closeEntirely: true });
    captureDraftIfPossible();
    state.ui.view = "home";
    renderDashboard();
  }

  function renderAdminStageMarkup(tabKey, tileKey) {
    if (tabKey === "rezerwacje" && tileKey === "hotel") {
      return `<div id="admin-panel-hotel" class="admin-hotel-wrap admin-stage-panel col-12"></div>`;
    }
    if (tabKey === "rezerwacje" && tileKey === "restaurant") {
      return `<div id="admin-panel-restaurant" class="admin-hotel-wrap admin-stage-panel col-12"></div>`;
    }
    if (tabKey === "rezerwacje" && tileKey === "events") {
      return `<div id="admin-panel-hall" class="admin-hotel-wrap admin-stage-panel col-12"></div>`;
    }
    if (tabKey === "hotel" && ["1-osobowe", "2-osobowe", "3-osobowe", "4-osobowe"].includes(tileKey)) {
      return `<section class="panel col-12" id="hotel-room-galleries-panel"></section>`;
    }
    if (tabKey === "hotel" && tileKey === "settings") {
      return `<section class="panel col-12" id="hotel-booking-settings-panel"></section>`;
    }
    if (tabKey === "restauracja" && tileKey === "menu") {
      return `<section class="panel col-12" id="restaurant-menu-panel"></section>`;
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
    if (tabKey === "restauracja" && tileKey === "settings") {
      return `<section class="panel col-12" id="restaurant-booking-settings-panel"></section>`;
    }
    if (tabKey === "przyjecia" && tileKey === "oferta") {
      return `<section class="panel col-12" id="events-offer-panel"></section>`;
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
    if (tabKey === "przyjecia" && tileKey === "settings") {
      return `
        <section class="panel col-12" id="events-booking-settings-panel"></section>
        <section class="panel col-12" id="calendar-panel"></section>
      `;
    }
    if (tabKey === "dokumenty") {
      return `<section class="panel col-12" id="documents-panel"></section>`;
    }
    if (tabKey === "kontakt") {
      return `<section class="panel col-12" id="contact-panel"></section>`;
    }
    return `<section class="panel col-12"><p class="status">Brak skonfigurowanego widoku.</p></section>`;
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
            Ten modul probowalby laczyc sie z Firebase Functions, ale w tej konfiguracji strony rezerwacje online sa wylaczone.
          </p>
          <p class="helper">Aby uruchomic ten widok, trzeba wlaczyc <code>enableOnlineBookings</code> i wdrozyc odpowiedni backend rezerwacji.</p>
          <p class="status">${escapeHtml(statusMessage)}</p>
        </div>
      </section>
    `;
  }

  function renderActiveAdminTile(statusMessage = "") {
    const topTab = state.ui.topTab;
    const tileKey = getActiveAdminTile(topTab);

    if (topTab === "rezerwacje") {
      if (!onlineBookingsEnabled) {
        if (tileKey === "hotel") {
          renderOnlineBookingsUnavailable("#admin-panel-hotel", {
            title: "Rezerwacja hotel",
            copy: "Panel obslugi rezerwacji pokoi pojawi sie tutaj po wdrozeniu backendu hotelowego.",
            statusMessage,
          });
        } else if (tileKey === "restaurant") {
          renderOnlineBookingsUnavailable("#admin-panel-restaurant", {
            title: "Rezerwacja restauracja",
            copy: "Panel obslugi rezerwacji stolikow pojawi sie tutaj po wdrozeniu backendu restauracji.",
            statusMessage,
          });
        } else if (tileKey === "events") {
          renderOnlineBookingsUnavailable("#admin-panel-hall", {
            title: "Rezerwacje przyjecia",
            copy: "Panel obslugi zapytan o sale pojawi sie tutaj po wdrozeniu backendu przyjec.",
            statusMessage,
          });
        }
        return;
      }

      const options = { defaultTab: "reservations" };
      if (tileKey === "hotel" && typeof window.renderHotelAdminPanel === "function") {
        window.renderHotelAdminPanel(document.querySelector("#admin-panel-hotel"), options);
      } else if (tileKey === "restaurant" && typeof window.renderRestaurantAdminPanel === "function") {
        window.renderRestaurantAdminPanel(document.querySelector("#admin-panel-restaurant"), options);
      } else if (tileKey === "events" && typeof window.renderHallAdminPanel === "function") {
        window.renderHallAdminPanel(document.querySelector("#admin-panel-hall"), options);
      }
      return;
    }

    if (topTab === "hotel") {
      if (tileKey === "settings") {
        renderHotelBookingSettingsPanel(statusMessage);
      } else {
        renderHotelRoomGalleriesPanel(statusMessage);
      }
      return;
    }

    if (topTab === "restauracja") {
      if (tileKey === "menu") {
        renderRestaurantMenuPanel(statusMessage);
      } else if (tileKey === "gallery") {
        renderRestaurantGalleryPanel(statusMessage);
      } else if (tileKey === "orders") {
        renderRestaurantOrderPanel(statusMessage);
      } else if (tileKey === "hours") {
        renderRestaurantOpeningHoursPanel(statusMessage);
      } else if (tileKey === "settings") {
        renderRestaurantBookingSettingsPanel(statusMessage);
      }
      return;
    }

    if (topTab === "przyjecia") {
      if (tileKey === "oferta") {
        renderEventsOfferPanel(statusMessage);
      } else if (tileKey === "sale") {
        renderEventsHallsPanel(statusMessage);
      } else if (tileKey === "gallery") {
        renderEventsHallGalleriesPanel(statusMessage);
        renderGalleryPanel(statusMessage);
      } else if (tileKey === "menu") {
        renderEventsMenuPanel(statusMessage);
      } else if (tileKey === "settings") {
        renderEventsBookingSettingsPanel(statusMessage);
        renderCalendarPanel(statusMessage);
      }
      return;
    }

    if (topTab === "dokumenty") {
      renderDocumentsPanel(statusMessage);
      return;
    }

    if (topTab === "kontakt") {
      renderContactPanel(statusMessage);
    }
  }

  function renderDashboard() {
    const activeTab = getAdminTabConfig();
    const activeTile = getActiveAdminTile(activeTab.key);
    const inSectionView = state.ui.view === "section";

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
            <div class="admin-global-save-actions" id="admin-global-save-actions">
              <button class="button secondary" id="cancel-content-button" type="button">Anuluj</button>
              <button class="button" id="save-content-button" type="button">Zapisz</button>
            </div>
            <button class="button danger icon-button" id="logout-button" type="button" aria-label="Wyloguj">⎋</button>
          </div>
        </header>
        <section class="admin-workspace">
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
                        <span class="admin-tile-copy">${escapeHtml(tile.description)}</span>
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
              <div class="admin-tile-grid admin-entry-grid" aria-label="Glowne sekcje panelu administracyjnego">
                ${HOME_TAB_ORDER.map((tabKey) => ADMIN_TABS.find((tab) => tab.key === tabKey))
                  .filter(Boolean)
                  .map(
                  (tab) => `
                    <button
                      type="button"
                      class="admin-tile admin-entry-tile"
                      data-admin-entry="${escapeAttribute(tab.key)}"
                    >
                      <span class="admin-tile-title">${escapeHtml(tab.label)}</span>
                      <span class="admin-tile-copy">${escapeHtml(tab.description)}</span>
                    </button>
                  `
                )
                  .join("")}
              </div>
            `
          }
        </section>
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
            <label class="field-full"><span>Haslo pod logo</span><input id="company-tagline" value="${escapeAttribute(content.company.tagline)}" /></label>
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
              <p class="helper">Blokady podstron i przelaczniki rezerwacji.</p>
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
                <strong>Zablokuj Restauracje</strong>
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
            ${onlineBookingsEnabled
              ? ""
              : '<p class="helper">W tej konfiguracji rezerwacje online sa celowo wylaczone. Strona korzysta z Cloudflare Worker i Firebase Auth, bez Firebase Functions.</p>'}
            <label class="checkbox-field">
              <input type="checkbox" id="booking-enable-restaurant" ${content.booking?.restaurant !== false ? "checked" : ""} ${onlineBookingsEnabled ? "" : "disabled"} />
              <span class="checkbox-copy">
                <strong>Restauracja</strong>
                <span>Wlacza formularz rezerwacji stolika.</span>
              </span>
            </label>
            <label class="checkbox-field">
              <input type="checkbox" id="booking-enable-hotel" ${content.booking?.hotel !== false ? "checked" : ""} ${onlineBookingsEnabled ? "" : "disabled"} />
              <span class="checkbox-copy">
                <strong>Hotel</strong>
                <span>Wlacza formularz rezerwacji pokoi.</span>
              </span>
            </label>
            <label class="checkbox-field">
              <input type="checkbox" id="booking-enable-events" ${content.booking?.events !== false ? "checked" : ""} ${onlineBookingsEnabled ? "" : "disabled"} />
              <span class="checkbox-copy">
                <strong>Przyjecia / sale</strong>
                <span>Wlacza formularz zapytania o sale i rezerwacje.</span>
              </span>
            </label>
            <p class="helper" style="margin: 0.75rem 0 0.35rem;">Okresy przerw ustawisz nizej, osobno w panelach: Hotel / Restauracja / Przyjecia.</p>
          </div>
          <div class="panel-note">
            <strong>Uwaga:</strong> czesc pol tresci nizej pochodzi ze starszej wersji panelu. Aktualny front korzysta glownie z blokad sekcji, rezerwacji online, godzin otwarcia, menu, galerii, dokumentow, kalendarza i modala „Oferta”.
          </div>
          <div class="field-grid">
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
              <h3>Restauracja</h3>
              <p class="helper">Sekcje menu i dodatki.</p>
            </div>
          </div>
          <div class="field-grid">
            <label class="field-full"><span>Naglowek</span><input id="restaurant-hero-title" value="${escapeAttribute(content.restaurant.heroTitle)}" /></label>
            <label class="field-full"><span>Opis</span><textarea id="restaurant-hero-text">${escapeHtml(content.restaurant.heroText)}</textarea></label>
            <label class="field-full"><span>Dodatki restauracji, jedna pozycja w linii</span><textarea id="restaurant-extras">${escapeHtml((content.restaurant.extras || []).join("\n"))}</textarea></label>
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
    const companyTagline = getTrimmedValue("#company-tagline");
    if (companyTagline !== null) content.company.tagline = companyTagline;
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
    if (!content.booking) {
      content.booking = {};
    }
    const br = document.querySelector("#booking-enable-restaurant");
    const bh = document.querySelector("#booking-enable-hotel");
    const be = document.querySelector("#booking-enable-events");
    if (onlineBookingsEnabled) {
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
    const restaurantRanges = onlineBookingsEnabled ? collectPauseRanges("restaurant") : [];
    const hotelRanges = onlineBookingsEnabled ? collectPauseRanges("hotel") : [];
    const eventsRanges = onlineBookingsEnabled ? collectPauseRanges("events") : [];
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

    if (document.querySelector("#restaurant-menu-panel")) {
      content.restaurant.menu = collectMenuFromPanel();
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

    if (document.querySelector("#events-menu-panel")) {
      if (!content.events) {
        content.events = {};
      }
      content.events.menu = collectEventsMenuFromPanel();
    }

    if (document.querySelector("#documents-menu-sections-list")) {
      content.documentsMenu = collectDocumentsMenuFromPanel();
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
      if (document.querySelector("#restaurant-menu-panel")) {
        if (!state.content.restaurant) {
          state.content.restaurant = {};
        }
        state.content.restaurant.menu = collectMenuFromPanel();
      }
      if (document.querySelector("#events-menu-panel")) {
        if (!state.content.events) {
          state.content.events = {};
        }
        state.content.events.menu = collectEventsMenuFromPanel();
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
      if (document.querySelector("#restaurant-menu-panel")) {
        if (!content.restaurant) {
          content.restaurant = {};
        }
        content.restaurant.menu = collectMenuFromPanel();
      }
      if (document.querySelector("#events-menu-panel")) {
        if (!content.events) {
          content.events = {};
        }
        content.events.menu = collectEventsMenuFromPanel();
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
      intro,
      enabledId,
      enabledLabel,
      enabledHelp,
      pauseRangesKey,
      pauseLabel,
      statusMessage = "",
      disabled = false,
    } = options;

    const booking = state.content.booking || {};
    const domainKey = String(enabledId || "").replace(/^booking-enable-/, "");
    const isEnabled = booking[domainKey] !== false;

    panel.innerHTML = `
      <p class="pill">Ustawienia rezerwacji</p>
      <h2>${escapeHtml(title)}</h2>
      <p class="section-intro">${escapeHtml(intro)}</p>
      <div class="stack">
        ${disabled ? '<p class="panel-note">W tej konfiguracji rezerwacje online sa globalnie wylaczone. Po wlaczeniu backendu rezerwacji te ustawienia zaczna dzialac.</p>' : ""}
        <label class="checkbox-field">
          <input type="checkbox" id="${escapeAttribute(enabledId)}" ${isEnabled ? "checked" : ""} ${disabled ? "disabled" : ""} />
          <span class="checkbox-copy">
            <strong>${escapeHtml(enabledLabel)}</strong>
            <span>${escapeHtml(enabledHelp)}</span>
          </span>
        </label>
        <p class="helper" style="margin: 0;">Mozesz dodac wiele okresow przerwy. Dni graniczne sa liczone wlacznie.</p>
        ${renderPauseRangesEditorMarkup(domainKey, booking[pauseRangesKey], {
          disabled,
          label: pauseLabel || "Przerwa",
        })}
        <p class="status">${escapeHtml(statusMessage)}</p>
      </div>
    `;

    bindRepeaterButtons();
  }

  function renderHotelBookingSettingsPanel(statusMessage = "") {
    renderDomainBookingSettingsPanel("#hotel-booking-settings-panel", {
      title: "Hotel",
      intro: "Steruj formularzem rezerwacji pokoi i okresami przerwy.",
      enabledId: "booking-enable-hotel",
      enabledLabel: "Hotel - rezerwacja pokoi wlaczona",
      enabledHelp: "Wylacza lub wlacza formularz rezerwacji na stronie hotelu.",
      pauseRangesKey: "hotelPauseRanges",
      pauseLabel: "Hotel",
      statusMessage,
      disabled: !onlineBookingsEnabled,
    });
  }

  function renderRestaurantBookingSettingsPanel(statusMessage = "") {
    renderDomainBookingSettingsPanel("#restaurant-booking-settings-panel", {
      title: "Restauracja",
      intro: "Steruj formularzem rezerwacji stolikow i okresami przerwy.",
      enabledId: "booking-enable-restaurant",
      enabledLabel: "Restauracja - rezerwacja stolika wlaczona",
      enabledHelp: "Wylacza lub wlacza formularz rezerwacji na stronie restauracji.",
      pauseRangesKey: "restaurantPauseRanges",
      pauseLabel: "Restauracja",
      statusMessage,
      disabled: !onlineBookingsEnabled,
    });
  }

  function renderEventsBookingSettingsPanel(statusMessage = "") {
    renderDomainBookingSettingsPanel("#events-booking-settings-panel", {
      title: "Przyjecia",
      intro: "Steruj formularzem zapytan o sale oraz okresami przerwy.",
      enabledId: "booking-enable-events",
      enabledLabel: "Przyjecia / sale - rezerwacja wlaczona",
      enabledHelp: "Wylacza lub wlacza formularz zapytania o sale.",
      pauseRangesKey: "eventsPauseRanges",
      pauseLabel: "Przyjecia / sale",
      statusMessage,
      disabled: !onlineBookingsEnabled,
    });
  }

  function renderRestaurantOpeningHoursPanel(statusMessage = "") {
    const panel = document.querySelector("#restaurant-opening-hours-panel");
    if (!panel) return;

    panel.innerHTML = `
      <p class="pill">Restauracja</p>
      <h2>Godziny otwarcia</h2>
      <p class="section-intro">Te godziny pojawiaja sie w kafelku "Godziny" na stronie restauracji.</p>
      <div class="stack">
        ${renderOpeningHoursEditorMarkup(state.content.company?.openingHours, {
          intro: "Ustaw godzine otwarcia i zamkniecia dla kazdego dnia osobno. Puste pola zapisza dzien jako nieczynny.",
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
      "Dowozimy za darmo w odleglosci do 5 km od restauracji.";

    panel.innerHTML = `
      <p class="pill">Restauracja</p>
      <h2>Zamowienia / Catering</h2>
      <p class="section-intro">Edytuj tresc modala widocznego po kliknieciu kafelka "Zamowienia / Catering" na stronie restauracji.</p>
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
        <p class="helper">Edytor wizualny zapisuje wyglad tresci wyswietlanej w modalu "Zamowienia / Catering".</p>
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
          <label class="field-full"><span>Haslo pod logo</span><input id="company-tagline" value="${escapeAttribute(company.tagline || "")}" /></label>
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
    panel.innerHTML = `
      <p class="pill">Galeria</p>
      <h2>Albumy i zdjecia</h2>
      <p class="section-intro">Dodaj album, potem wgraj zdjecia i ustaw okladke widoczna na stronie.</p>
      ${mediaEnabled ? "" : '<p class="status">Upload galerii jest obecnie niedostepny.</p>'}
      <div class="grid">
        <div class="col-4">
          <div class="repeater-item">
            <h3>Nowy album</h3>
            <form id="album-form" class="stack">
              <label class="field-full"><span>Tytul</span><input name="title" required ${mediaEnabled ? "" : "disabled"} /></label>
              <label class="field-full"><span>Slug</span><input name="slug" placeholder="np-wesele-anna-piotr" required ${mediaEnabled ? "" : "disabled"} /></label>
              <label class="field-full"><span>Opis</span><textarea name="description" ${mediaEnabled ? "" : "disabled"}></textarea></label>
              <button class="button" type="submit" ${mediaEnabled ? "" : "disabled"}>Dodaj album</button>
              <p class="status">${escapeHtml(statusMessage)}</p>
            </form>
          </div>
        </div>
        <div class="col-8">
          <div class="stack">
            ${
              state.galleryAlbums.length
                ? state.galleryAlbums
                    .map(
                      (album) => `
                        <article class="repeater-item">
                          <div class="repeater-head">
                            <div>
                              <h3>${escapeHtml(album.title)}</h3>
                              <p class="helper">${escapeHtml(album.description || "")}</p>
                            </div>
                            <span class="pill">${escapeHtml(album.slug)}</span>
                          </div>
                          <form class="stack" data-upload-album="${album.id}">
                            <label class="field-full">
                              <span>Dodaj zdjecia do albumu</span>
                              <input type="file" name="images" accept="image/*" multiple ${mediaEnabled ? "" : "disabled"} />
                            </label>
                            <button class="button secondary" type="submit" ${mediaEnabled ? "" : "disabled"}>Wgraj zdjecia</button>
                          </form>
                          <div class="thumb-grid">
                            ${
                              album.images && album.images.length
                                ? album.images
                                    .map(
                                      (image) => `
                                        <article class="thumb-card">
                                          <img src="${escapeAttribute(image.url)}" alt="${escapeAttribute(image.alt || album.title)}" />
                                          <div class="inline-actions">
                                            <button class="button secondary" type="button" data-cover-image="${image.id}" ${mediaEnabled ? "" : "disabled"}>Ustaw jako glowne</button>
                                            <button class="button danger" type="button" data-delete-image="${image.id}" ${mediaEnabled ? "" : "disabled"}>Usun</button>
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
                : `<p class="empty">Nie ma jeszcze albumow.</p>`
            }
          </div>
        </div>
      </div>
    `;

    document.querySelector("#album-form").addEventListener("submit", createAlbum);
    panel.querySelectorAll("[data-upload-album]").forEach((form) => {
      form.addEventListener("submit", uploadAlbumImages);
    });
    panel.querySelectorAll("[data-cover-image]").forEach((button) => {
      button.addEventListener("click", () => setCoverImage(button.dataset.coverImage));
    });
    panel.querySelectorAll("[data-delete-image]").forEach((button) => {
      button.addEventListener("click", () => deleteImage(button.dataset.deleteImage));
    });
  }

  async function createAlbum(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    try {
      await api("/api/admin/gallery/albums", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
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

  async function setCoverImage(imageId) {
    await api(`/api/admin/gallery/images/${imageId}/cover`, { method: "POST" });
    await loadDashboard("Okladka albumu zostala zaktualizowana.");
  }

  async function deleteImage(imageId) {
    await api(`/api/admin/gallery/images/${imageId}`, { method: "DELETE" });
    await loadDashboard("Zdjecie zostalo usuniete.");
  }

  function getMenuEditorConfig(kind) {
    if (kind === "restaurant") {
      return {
        panelSelector: "#restaurant-menu-panel",
        pill: "Restauracja",
        title: "Menu Restauracji",
        intro:
          "Najpierw wybierasz kategorie, a potem w modalach przechodzisz do edycji kategorii i pojedynczych produktow.",
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
        "Edycja odbywa sie modalami: lista kategorii na glownej planszy, a szczegoly kategorii i produktow w osobnych oknach.",
      includePrice: false,
      emptyState: "Nie ma jeszcze zadnej kategorii. Dodaj pierwsza i uzupelnij ja w osobnym oknie.",
      categoryLabel: "Kategoria",
      productLabel: "Pozycja",
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

  function getMenuSectionsByKind(kind) {
    if (kind === "restaurant") {
      if (!state.content.restaurant) {
        state.content.restaurant = {};
      }
      if (!Array.isArray(state.content.restaurant.menu)) {
        state.content.restaurant.menu = [];
      }
      state.content.restaurant.menu.forEach(syncMenuEditorSectionSubcategories);
      return state.content.restaurant.menu;
    }

    if (!state.content.events) {
      state.content.events = {};
    }
    if (!Array.isArray(state.content.events.menu)) {
      state.content.events.menu = [];
    }
    state.content.events.menu.forEach(syncMenuEditorSectionSubcategories);
    return state.content.events.menu;
  }

  function createMenuEditorItem(kind, overrides = {}) {
    const baseItem =
      kind === "restaurant"
        ? { name: "", price: "", description: "", ingredients: [] }
        : { name: "", description: "", ingredients: [] };
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
    const explicitSubcategories = Array.isArray(section?.subcategories)
      ? section.subcategories.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    const fallbackSubcategories = items.map((item) => String(item?.subcategory || "").trim()).filter(Boolean);
    const orderedSubcategories = Array.from(new Set([...explicitSubcategories, ...fallbackSubcategories]));
    const groupsByKey = new Map();

    orderedSubcategories.forEach((name) => {
      groupsByKey.set(name, { key: name, name, isUncategorized: false, entries: [] });
    });
    groupsByKey.set("", { key: "", name: "Bez podkategorii", isUncategorized: true, entries: [] });

    items.forEach((item, index) => {
      const key = String(item?.subcategory || "").trim();
      if (!groupsByKey.has(key)) {
        groupsByKey.set(key, { key, name: key || "Bez podkategorii", isUncategorized: !key, entries: [] });
      }
      groupsByKey.get(key).entries.push({ item, index });
    });

    const namedGroups = orderedSubcategories.map((name) => groupsByKey.get(name)).filter(Boolean);
    const uncategorizedGroup = groupsByKey.get("");
    if (uncategorizedGroup?.entries?.length) {
      namedGroups.push(uncategorizedGroup);
    }
    return namedGroups.filter((group) => group.entries.length);
  }

  function getMenuEditorSectionSubcategoryEntries(section) {
    const groups = buildMenuEditorSectionGroups(section);
    const counts = new Map(groups.map((group) => [group.key, group.entries.length]));
    const named = getMenuEditorSectionSubcategories(section).map((name) => ({
      key: name,
      label: name,
      isDefault: false,
      count: counts.get(name) || 0,
    }));
    const uncategorizedCount = counts.get("") || 0;
    return [
      ...named,
      {
        key: "",
        label: "Bez podkategorii",
        isDefault: true,
        count: uncategorizedCount,
      },
    ];
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
    state.ui.menuEditorModal = {
      kind,
      type: "item",
      sectionIndex: resolvedSectionIndex,
      sourceSectionIndex: itemIndex === null ? null : resolvedSectionIndex,
      itemIndex,
      draft: structuredClone(currentItem || createMenuEditorItem(kind)),
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
            <strong>${itemCount}</strong>
            <span>Pozycje</span>
          </div>
          <div class="menu-editor-stat">
            <strong>${subcategoryCount}</strong>
            <span>Podkategorie</span>
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
            <p class="helper">Zmiany lokalne zapiszesz przyciskiem "Zapisz" w gornej belce panelu.</p>
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
            <div class="admin-modal-head">
              <div>
                <p class="pill">${escapeHtml(config.pill)}</p>
                <h3 id="menu-editor-category-create-title">Dodaj kategorie</h3>
                <p class="helper">Nadaj nazwie kategorii, aby pojawila sie na liscie menu.</p>
              </div>
              <button class="button icon-button secondary" type="button" data-menu-modal-close aria-label="Zamknij">×</button>
            </div>
            <p class="status">${escapeHtml(modal.statusMessage || "")}</p>
            <label class="field-full">
              <span>Nazwa kategorii</span>
              <input name="section" value="${escapeAttribute(draft.section || "")}" placeholder="np. Przystawki, Zupy, Dania glowne" />
            </label>
            <div class="admin-modal-footer">
              <button class="button secondary" type="button" data-menu-modal-back>Wroc</button>
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
            <div class="admin-modal-head">
              <div>
                <p class="pill">${escapeHtml(config.pill)}</p>
                <h3 id="menu-editor-subcategory-create-title">Dodaj podkategorie</h3>
                <p class="helper">Podkategorie przypisujesz do jednej kategorii, a potem wybierasz je przy produktach.</p>
              </div>
              <button class="button icon-button secondary" type="button" data-menu-modal-close aria-label="Zamknij">×</button>
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
              <button class="button secondary" type="button" data-menu-modal-back>Wroc</button>
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
            name: activeSubcategory || "Bez podkategorii",
            entries: [],
          };

    return `
      <div class="admin-modal-overlay" data-menu-modal-overlay>
        <section class="admin-modal menu-editor-modal" role="dialog" aria-modal="true" aria-labelledby="menu-editor-section-title">
          <div class="admin-modal-head">
            <div>
              <p class="pill">${escapeHtml(config.pill)}</p>
              <h3 id="menu-editor-section-title">Edycja kategorii</h3>
            </div>
            <button class="button icon-button secondary" type="button" data-menu-modal-close aria-label="Zamknij">×</button>
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
                        (entry, subcategoryIndex) => `
                          <article class="list-item menu-editor-subcategory-card">
                            <div class="list-head">
                              <div>
                                <strong>${escapeHtml(entry.label)}</strong>
                                <p class="helper">${entry.count} ${entry.count === 1 ? "produkt" : "produkty"}${entry.isDefault ? " • domyslna (tylko admin)" : ""}</p>
                              </div>
                              <div class="inline-actions">
                                <button class="button secondary" type="button" data-open-menu-subcategory="${escapeAttribute(entry.key)}">Otworz</button>
                                ${
                                  entry.isDefault
                                    ? ""
                                    : `
                                      <button class="button secondary menu-editor-card-move" type="button" data-move-menu-subcategory-up="${escapeAttribute(entry.key)}" aria-label="Przesun podkategorie wyzej" ${subcategoryIndex === 0 ? "disabled" : ""}>↑</button>
                                      <button class="button secondary menu-editor-card-move" type="button" data-move-menu-subcategory-down="${escapeAttribute(entry.key)}" aria-label="Przesun podkategorie nizej" ${subcategoryIndex === subcategoryEntries.length - 2 ? "disabled" : ""}>↓</button>
                                    `
                                }
                              </div>
                            </div>
                          </article>
                        `
                      )
                      .join("")}
                  </div>
                </div>
              `
              : `
                <div class="menu-editor-subcategory-group-head">
                  <strong>Podkategoria: ${escapeHtml(activeGroup.name)}</strong>
                  <div class="inline-actions">
                    <button class="button secondary" type="button" data-back-to-subcategories>Wroc do podkategorii</button>
                  </div>
                </div>
                <div class="stack menu-editor-product-list">
                  ${
                    activeGroup.entries.length
                      ? activeGroup.entries
                          .map((entry, groupItemIndex) => {
                            const item = entry.item;
                            const itemIndex = entry.index;
                            return `
                              <article class="list-item menu-editor-product-card">
                                <div class="list-head">
                                  <div>
                                    <strong>${escapeHtml(item.name || `${config.productLabel} ${itemIndex + 1}`)}</strong>
                                    <p class="helper">${escapeHtml(buildMenuEditorItemMeta(item, config.includePrice) || "Bez dodatkowych informacji")}</p>
                                  </div>
                                  <div class="inline-actions menu-editor-product-actions">
                                    <button class="button secondary menu-editor-card-move" type="button" data-move-menu-item-up="${itemIndex}" aria-label="Przesun produkt wyzej" ${groupItemIndex === 0 ? "disabled" : ""}>↑</button>
                                    <button class="button secondary menu-editor-card-move" type="button" data-move-menu-item-down="${itemIndex}" aria-label="Przesun produkt nizej" ${groupItemIndex === activeGroup.entries.length - 1 ? "disabled" : ""}>↓</button>
                                    <button class="button secondary" type="button" data-open-menu-item="${itemIndex}">Otworz</button>
                                    <button class="button danger" type="button" data-remove-menu-item="${itemIndex}">Usun</button>
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
                          <p class="helper">Dodaj produkt z glownego przycisku "Dodaj" i przypisz go do tej podkategorii.</p>
                        </div>
                      `
                  }
                </div>
              `
          }
          <div class="admin-modal-footer">
            <button class="button secondary" type="button" data-menu-modal-close>Zamknij</button>
          </div>
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
    const backLabel = modal.returnTo?.type === "section" ? "Wroc do kategorii" : "Wroc";

    return `
      <div class="admin-modal-overlay" data-menu-modal-overlay>
        <section class="admin-modal menu-editor-modal" role="dialog" aria-modal="true" aria-labelledby="menu-editor-item-title">
          <form id="menu-editor-item-form" class="stack">
            <div class="admin-modal-head">
              <div>
                <p class="pill">${escapeHtml(config.pill)}</p>
                <h3 id="menu-editor-item-title">${isNewItem ? "Dodaj produkt" : "Edytuj produkt"}</h3>
                <p class="helper">Po wypelnieniu pol zatwierdz formularz przyciskiem na dole okna.</p>
              </div>
              <button class="button icon-button secondary" type="button" data-menu-modal-back aria-label="Powrot">←</button>
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
              <button class="button secondary" type="button" data-menu-modal-back>${escapeHtml(backLabel)}</button>
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
      });
      root.querySelector("[data-back-to-subcategories]")?.addEventListener("click", () => {
        openMenuEditorSectionModal(modal.kind, modal.sectionIndex, {
          statusMessage: modal.statusMessage || "",
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
    const subcategories = getMenuEditorSectionSubcategories(section);
    const currentIndex = subcategories.indexOf(subcategoryName);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= subcategories.length) return;

    [subcategories[currentIndex], subcategories[targetIndex]] = [subcategories[targetIndex], subcategories[currentIndex]];
    section.subcategories = subcategories;

    const groupedEntries = new Map();
    (section.items || []).forEach((item) => {
      const key = String(item?.subcategory || "").trim();
      if (!groupedEntries.has(key)) {
        groupedEntries.set(key, []);
      }
      groupedEntries.get(key).push(item);
    });
    const uncategorized = groupedEntries.get("") || [];
    const reorderedItems = subcategories.flatMap((name) => groupedEntries.get(name) || []);
    reorderedItems.push(...uncategorized);
    section.items = reorderedItems;

    openMenuEditorSectionModal(kind, sectionIndex, {
      statusMessage: "Kolejnosc podkategorii zostala zaktualizowana.",
    });
    setMenuEditorStatus(kind, "Kolejnosc podkategorii zostala zaktualizowana.");
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
      setMenuEditorStatus(kind, "Produkt zostal dodany.");
      state.ui.menuEditorModal = null;
    } else {
      const sourceSectionIndex =
        typeof modal.sourceSectionIndex === "number" ? modal.sourceSectionIndex : sectionIndex;
      const sourceSection = sections[sourceSectionIndex];
      if (!sourceSection?.items?.[itemIndex]) return;

      if (sourceSectionIndex === targetSectionIndex) {
        sourceSection.items[itemIndex] = item;
      } else {
        sourceSection.items.splice(itemIndex, 1);
        targetSection.items.push(item);
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

  function collectEventsMenuFromPanel() {
    return collectMenuEditorFromPanel("events");
  }

  function renderRestaurantGalleryPanel(statusMessage = "") {
    const panel = document.querySelector("#restaurant-gallery-panel");
    if (!panel) return;
    const gallery = state.content.restaurant?.gallery || [];

    panel.innerHTML = `
      <p class="pill">Restauracja</p>
      <h2>Galeria Restauracji</h2>
      <p class="section-intro">Zarzadzaj zdjeciami galerii restauracji. Mozesz dodawac, usuwac i zmieniac kolejnosc zdjec.</p>
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
                        <img src="${escapeAttribute(image.url || image)}" alt="${escapeAttribute(image.alt || "Restauracja")}" />
                        <div class="inline-actions">
                          <button class="button secondary" type="button" data-move-restaurant-image-up="${index}" ${index === 0 ? 'disabled' : ''}>↑</button>
                          <button class="button secondary" type="button" data-move-restaurant-image-down="${index}" ${index === gallery.length - 1 ? 'disabled' : ''}>↓</button>
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
      const images = await filesToInlineGalleryImages(files, INLINE_IMAGE_MAX_BYTES, "Restauracja");

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
    const activeRoomType = getActiveAdminTile("hotel");
    const visibleRoomTypes = roomTypes.some((roomType) => roomType.key === activeRoomType)
      ? roomTypes.filter((roomType) => roomType.key === activeRoomType)
      : roomTypes;

    panel.innerHTML = `
      <p class="pill">Hotel</p>
      <h2>Galeria Pokoi</h2>
      <p class="section-intro">Zarzadzaj zdjeciami dla wybranego typu pokoju. Mozesz dodawac, usuwac i zmieniac kolejnosc zdjec.</p>
      <p class="status">${escapeHtml(statusMessage)}</p>
      <div class="grid">
        ${visibleRoomTypes
          .map(
            (roomType) => `
              <div class="col-12">
                <div class="repeater-item">
                  <h3>${escapeHtml(roomType.label)}</h3>
                  <form class="stack upload-room-gallery-form" data-upload-room-gallery="${escapeAttribute(roomType.key)}">
                    <label class="field-full">
                      <span>Dodaj zdjecia</span>
                      <input type="file" name="images" accept="image/*" multiple />
                    </label>
                    <button class="button secondary" type="submit">Wgraj zdjecia</button>
                  </form>
                  <div class="thumb-grid" data-room-gallery="${escapeAttribute(roomType.key)}">
                    ${
                      roomGalleries[roomType.key] && roomGalleries[roomType.key].length
                        ? roomGalleries[roomType.key]
                            .map(
                              (image, index) => `
                                <article class="thumb-card">
                                  <img src="${escapeAttribute(image.url || image)}" alt="${escapeAttribute(image.alt || roomType.label)}" />
                                  <div class="inline-actions">
                                    <button class="button secondary" type="button" data-move-up="${roomType.key}" data-index="${index}" ${index === 0 ? 'disabled' : ''}>↑</button>
                                    <button class="button secondary" type="button" data-move-down="${roomType.key}" data-index="${index}" ${index === roomGalleries[roomType.key].length - 1 ? 'disabled' : ''}>↓</button>
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

    panel.querySelectorAll("[data-upload-room-gallery]").forEach((form) => {
      form.addEventListener("submit", (e) => uploadRoomGalleryImages(e, form.dataset.uploadRoomGallery));
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
    const form = event.currentTarget;
    const formData = new FormData(form);
    const files = formData.getAll("images");

    if (files.length === 0 || !files[0].size) {
      const fileInput = form.querySelector('input[name="images"]');
      if (fileInput) {
        fileInput.click();
      } else {
        renderHotelRoomGalleriesPanel("Wybierz pliki do wgrania.");
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
        renderHotelRoomGalleriesPanel("Wybierz pliki do wgrania.");
        return;
      }
      const response = await api(`/api/admin/hotel/room-galleries/${encodeURIComponent(roomType)}/images`, {
        method: "POST",
        body: payload,
      });
      setHotelRoomGalleries(response?.roomGalleries);
      renderHotelRoomGalleriesPanel("Zdjecia zostaly dodane.");
    } catch (error) {
      renderHotelRoomGalleriesPanel(error.message || "Blad podczas wgrywania zdjec.");
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
      renderHotelRoomGalleriesPanel("Zdjecie zostalo usuniete.");
    } catch (error) {
      renderHotelRoomGalleriesPanel(error.message || "Nie udalo sie usunac zdjecia.");
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
      renderHotelRoomGalleriesPanel("Nie udalo sie zmienic kolejnosci. Odswiez panel.");
      return;
    }
    try {
      const response = await api(`/api/admin/hotel/room-galleries/${encodeURIComponent(roomType)}/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageIds }),
      });
      setHotelRoomGalleries(response?.roomGalleries);
      renderHotelRoomGalleriesPanel("Kolejnosc zdjec zostala zmieniona.");
    } catch (error) {
      renderHotelRoomGalleriesPanel(error.message || "Nie udalo sie zmienic kolejnosci zdjec.");
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
                                    <button class="button secondary" type="button" data-move-up-hall="${hallType.key}" data-index="${index}" ${index === 0 ? 'disabled' : ''}>↑</button>
                                    <button class="button secondary" type="button" data-move-down-hall="${hallType.key}" data-index="${index}" ${index === hallGalleries[hallType.key].length - 1 ? 'disabled' : ''}>↓</button>
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
    const documentsMenu = state.content.documentsMenu || { title: "", intro: "", sections: [] };
    const mediaEnabled = state.capabilities?.mediaStorageEnabled === true;
    panel.innerHTML = `
      <p class="pill">Dokumenty</p>
      <h2>Menu i pliki</h2>
      <div class="stack">
        <div class="repeater-item">
          <div class="repeater-head">
            <div>
              <h3>Menu okolicznosciowe</h3>
              <p class="helper">To menu wyswietla sie na stronie dokumentow jako rozwijana sekcja.</p>
            </div>
            <button class="button secondary" type="button" id="add-documents-menu-section">Dodaj sekcje</button>
          </div>
          <div class="field-grid">
            <label class="field-full"><span>Tytul</span><input id="documents-menu-title" value="${escapeAttribute(documentsMenu.title || "")}" /></label>
            <label class="field-full"><span>Wstep</span><textarea id="documents-menu-intro">${escapeHtml(documentsMenu.intro || "")}</textarea></label>
          </div>
          <div id="documents-menu-sections-list" class="repeater-list"></div>
          <div class="inline-actions">
            <button class="button" type="button" id="save-documents-menu">Zapisz menu</button>
          </div>
        </div>
        ${mediaEnabled ? "" : '<p class="status">Upload plikow jest obecnie niedostepny.</p>'}
        <form id="document-form" class="repeater-item">
          <div class="field-grid">
            <label class="field"><span>Tytul</span><input name="title" required ${mediaEnabled ? "" : "disabled"} /></label>
            <label class="field"><span>Plik</span><input name="file" type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required ${mediaEnabled ? "" : "disabled"} /></label>
            <label class="field-full"><span>Opis</span><textarea name="description" ${mediaEnabled ? "" : "disabled"}></textarea></label>
          </div>
          <button class="button" type="submit" ${mediaEnabled ? "" : "disabled"}>Wgraj dokument</button>
          <p class="status">${escapeHtml(statusMessage)}</p>
        </form>
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
                        <a class="button secondary" href="${escapeAttribute(documentEntry.downloadUrl)}" target="_blank" rel="noreferrer">Sprawdz plik</a>
                        <button class="button danger" type="button" data-delete-document="${documentEntry.id}" ${mediaEnabled ? "" : "disabled"}>Usun</button>
                      </div>
                    </article>`
                )
                .join("")
            : `<p class="empty">Brak dokumentow.</p>`
        }
      </div>
    `;

    renderDocumentsMenuSections();
    panel.querySelector("#add-documents-menu-section").addEventListener("click", addDocumentsMenuSection);
    panel.querySelector("#save-documents-menu").addEventListener("click", saveDocumentsMenu);
    document.querySelector("#document-form").addEventListener("submit", uploadDocument);
    panel.querySelectorAll("[data-delete-document]").forEach((button) => {
      button.addEventListener("click", () => deleteDocument(button.dataset.deleteDocument));
    });
  }

  function renderDocumentsMenuSections() {
    const target = document.querySelector("#documents-menu-sections-list");
    if (!target) {
      return;
    }
    target.innerHTML = (state.content.documentsMenu?.sections || [])
      .map(
        (section, index) => `
          <div class="repeater-item">
            <div class="repeater-head">
              <strong>Sekcja ${index + 1}</strong>
              <button class="button danger" type="button" data-remove-documents-menu-section="${index}">Usun</button>
            </div>
            <div class="field-grid">
              <label class="field"><span>Nazwa sekcji</span><input data-documents-menu-title="${index}" value="${escapeAttribute(section.title || "")}" /></label>
              <label class="field-full"><span>Pozycje, jedna w linii</span><textarea data-documents-menu-items="${index}">${escapeHtml((section.items || []).join("\n"))}</textarea></label>
            </div>
          </div>`
      )
      .join("");

    target.querySelectorAll("[data-remove-documents-menu-section]").forEach((button) => {
      button.addEventListener("click", () => removeDocumentsMenuSection(Number(button.dataset.removeDocumentsMenuSection)));
    });
  }

  function collectDocumentsMenuFromPanel() {
    return {
      title: document.querySelector("#documents-menu-title")?.value.trim() || "",
      intro: document.querySelector("#documents-menu-intro")?.value.trim() || "",
      sections: Array.from(document.querySelectorAll("[data-documents-menu-title]")).map((element, index) => ({
        title: element.value.trim(),
        items: (document.querySelector(`[data-documents-menu-items="${index}"]`)?.value || "")
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
      })),
    };
  }

  function addDocumentsMenuSection() {
    state.content.documentsMenu = collectDocumentsMenuFromPanel();
    state.content.documentsMenu.sections.push({ title: "", items: [] });
    renderDocumentsPanel();
    refreshSaveDockVisibility();
  }

  function removeDocumentsMenuSection(index) {
    state.content.documentsMenu = collectDocumentsMenuFromPanel();
    state.content.documentsMenu.sections.splice(index, 1);
    renderDocumentsPanel();
    refreshSaveDockVisibility();
  }

  async function saveDocumentsMenu() {
    state.content.documentsMenu = collectDocumentsMenuFromPanel();
    await saveContent("Menu okolicznosciowe zostalo zapisane.");
  }

  async function uploadDocument(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("file");
    if (!(file instanceof File) || !file.size) {
      renderDocumentsPanel("Wybierz dokument do wgrania.");
      return;
    }
    if (file.size > DOCUMENT_MAX_BYTES) {
      renderDocumentsPanel("Dokument jest zbyt duzy. Maksymalny rozmiar to ok. 1.7 MB.");
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
          throw new Error(data.error || "Nie udalo sie dodac dokumentu.");
        }
      });
      await loadDashboard("Dokument zostal wgrany.");
    } catch (error) {
      renderDocumentsPanel(error.message);
    }
  }

  async function deleteDocument(documentId) {
    await api(`/api/admin/documents/${documentId}`, { method: "DELETE" });
    await loadDashboard("Dokument zostal usuniety.");
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
    state.capabilities = data.capabilities || { mediaStorageEnabled: false };
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
