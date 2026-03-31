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
        { key: "orders", label: "Zamowienia", description: "Obecny modul zamowien jedzenia i tekst widoczny w kafelku / CTA." },
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
    const allowedStyleProps = new Set(["text-align", "font-size", "color", "font-weight", "font-style", "text-decoration"]);
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

  function applyOfertaFontSize(editor, sizeValue) {
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

  function initOfertaRichTextEditor() {
    const textarea = document.querySelector("#events-oferta-modal-html");
    const editor = document.querySelector("#events-oferta-modal-editor");
    const toolbar = document.querySelector("#events-oferta-editor-toolbar");
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
        applyOfertaFontSize(editor, value);
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

  function hasUnsavedContentChanges() {
    if (!state.loggedIn || state.ui.view !== "section") {
      return false;
    }
    try {
      const draft = collectContentFromForm();
      const baseline = state.lastSavedContent || state.content;
      return JSON.stringify(draft) !== JSON.stringify(baseline);
    } catch (error) {
      return false;
    }
  }

  function refreshSaveDockVisibility() {
    const dock = document.querySelector("#admin-save-dock");
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
    return window.confirm("Masz niezapisane zmiany. Czy na pewno chcesz opuscic ten widok?");
  }

  function setAdminTab(tabKey) {
    if (!confirmLeaveIfUnsaved()) {
      return;
    }
    captureDraftIfPossible();
    state.ui.view = "section";
    state.ui.topTab = tabKey;
    state.ui.tileByTab[tabKey] = getActiveAdminTile(tabKey);
    renderDashboard();
  }

  function setAdminTile(tabKey, tileKey) {
    if (!confirmLeaveIfUnsaved()) {
      return;
    }
    captureDraftIfPossible();
    state.ui.view = "section";
    state.ui.topTab = tabKey;
    state.ui.tileByTab[tabKey] = tileKey;
    renderDashboard();
  }

  function goToAdminHome() {
    if (!confirmLeaveIfUnsaved()) {
      return;
    }
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
              <div class="admin-tile-grid" aria-label="Sekcje w module ${escapeAttribute(activeTab.label)}">
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
              </div>
              <div class="admin-save-dock" id="admin-save-dock">
                <p class="helper">Masz niezapisane zmiany w tej sekcji.</p>
                <button class="button" id="save-content-button" type="button">Zapisz tresci</button>
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
      saveButton.addEventListener("click", saveContent);
    }
    document.querySelector("#logout-button").addEventListener("click", logout);
    bindAdminNavigation();
    if (inSectionView) {
      renderActiveAdminTile();
      bindUnsavedTracking();
      refreshSaveDockVisibility();
    }
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
            <p class="helper" style="margin: 0.75rem 0 0.35rem;">Tymczasowe wstrzymanie rezerwacji (dni wlacznie; puste pola = brak przerwy)</p>
            <div class="field-grid">
              <label class="field"><span>Restauracja — od</span><input type="date" id="booking-restaurant-pause-from" value="${escapeAttribute(content.booking?.restaurantPauseFrom || "")}" ${onlineBookingsEnabled ? "" : "disabled"} /></label>
              <label class="field"><span>do</span><input type="date" id="booking-restaurant-pause-to" value="${escapeAttribute(content.booking?.restaurantPauseTo || "")}" ${onlineBookingsEnabled ? "" : "disabled"} /></label>
              <label class="field"><span>Hotel — od</span><input type="date" id="booking-hotel-pause-from" value="${escapeAttribute(content.booking?.hotelPauseFrom || "")}" ${onlineBookingsEnabled ? "" : "disabled"} /></label>
              <label class="field"><span>do</span><input type="date" id="booking-hotel-pause-to" value="${escapeAttribute(content.booking?.hotelPauseTo || "")}" ${onlineBookingsEnabled ? "" : "disabled"} /></label>
              <label class="field"><span>Przyjecia / sale — od</span><input type="date" id="booking-events-pause-from" value="${escapeAttribute(content.booking?.eventsPauseFrom || "")}" ${onlineBookingsEnabled ? "" : "disabled"} /></label>
              <label class="field"><span>do</span><input type="date" id="booking-events-pause-to" value="${escapeAttribute(content.booking?.eventsPauseTo || "")}" ${onlineBookingsEnabled ? "" : "disabled"} /></label>
            </div>
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
      button.addEventListener("click", () => addArrayItem(button.dataset.addArray));
    });
    document.querySelectorAll("[data-remove-array]").forEach((button) => {
      button.addEventListener("click", () => removeArrayItem(button.dataset.removeArray, Number(button.dataset.index)));
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

    function normalizePausePair(fromId, toId) {
      let f = document.querySelector(fromId)?.value?.trim() || "";
      let t = document.querySelector(toId)?.value?.trim() || "";
      if (f && t && f > t) {
        const x = f;
        f = t;
        t = x;
      }
      return { from: f, to: t };
    }
    const pr = normalizePausePair("#booking-restaurant-pause-from", "#booking-restaurant-pause-to");
    const ph = normalizePausePair("#booking-hotel-pause-from", "#booking-hotel-pause-to");
    const pe = normalizePausePair("#booking-events-pause-from", "#booking-events-pause-to");
    content.booking.restaurantPauseFrom = onlineBookingsEnabled ? pr.from : "";
    content.booking.restaurantPauseTo = onlineBookingsEnabled ? pr.to : "";
    content.booking.hotelPauseFrom = onlineBookingsEnabled ? ph.from : "";
    content.booking.hotelPauseTo = onlineBookingsEnabled ? ph.to : "";
    content.booking.eventsPauseFrom = onlineBookingsEnabled ? pe.from : "";
    content.booking.eventsPauseTo = onlineBookingsEnabled ? pe.to : "";

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
    const restaurantOrdersInfoText = getTrimmedValue("#restaurant-orders-info-text");
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

  async function saveContent() {
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
      const payload = { content };
      const data = await api("/api/admin/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const normalizedContent = normalizeAdminContent(data.content);
      state.content = normalizedContent;
      state.lastSavedContent = structuredClone(normalizedContent);
      renderActiveAdminTile("Zmiany zostaly zapisane.");
      refreshSaveDockVisibility();
    } catch (error) {
      renderActiveAdminTile(error.message);
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
      fromId,
      toId,
      fromKey,
      toKey,
      fromLabel,
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
        <div class="field-grid">
          <label class="field"><span>${escapeHtml(fromLabel)}</span><input type="date" id="${escapeAttribute(fromId)}" value="${escapeAttribute(booking[fromKey] || "")}" ${disabled ? "disabled" : ""} /></label>
          <label class="field"><span>Do</span><input type="date" id="${escapeAttribute(toId)}" value="${escapeAttribute(booking[toKey] || "")}" ${disabled ? "disabled" : ""} /></label>
        </div>
        <p class="status">${escapeHtml(statusMessage)}</p>
      </div>
    `;
  }

  function renderHotelBookingSettingsPanel(statusMessage = "") {
    renderDomainBookingSettingsPanel("#hotel-booking-settings-panel", {
      title: "Hotel",
      intro: "Steruj formularzem rezerwacji pokoi i okresami przerwy.",
      enabledId: "booking-enable-hotel",
      enabledLabel: "Hotel - rezerwacja pokoi wlaczona",
      enabledHelp: "Wylacza lub wlacza formularz rezerwacji na stronie hotelu.",
      fromId: "booking-hotel-pause-from",
      toId: "booking-hotel-pause-to",
      fromKey: "hotelPauseFrom",
      toKey: "hotelPauseTo",
      fromLabel: "Przerwa od",
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
      fromId: "booking-restaurant-pause-from",
      toId: "booking-restaurant-pause-to",
      fromKey: "restaurantPauseFrom",
      toKey: "restaurantPauseTo",
      fromLabel: "Przerwa od",
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
      fromId: "booking-events-pause-from",
      toId: "booking-events-pause-to",
      fromKey: "eventsPauseFrom",
      toKey: "eventsPauseTo",
      fromLabel: "Przerwa od",
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
      <h2>Obecny modul zamowien jedzenia</h2>
      <p class="section-intro">Edytuj tresc widoczna w kafelku "Zamowienia" na stronie restauracji.</p>
      <div class="stack">
        <label class="field-full">
          <span>Tresc kafelka</span>
          <textarea id="restaurant-orders-info-text" rows="4">${escapeHtml(currentInfoText)}</textarea>
        </label>
        <p class="status">${escapeHtml(statusMessage)}</p>
      </div>
    `;
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
        listSelector: "[data-menu-editor-list]",
        pill: "Restauracja",
        title: "Menu Restauracji",
        intro:
          "Uproszczony edytor menu: kategorie rozwijane, pozycje w tabeli i szybkie dodawanie przez wklejenie wielu linii naraz.",
        includePrice: true,
        quickAddHint:
          "Format linii: Nazwa | Cena | Opis | skladnik 1, skladnik 2 | Podkategoria",
        quickAddPlaceholder:
          "Rosol domowy | 19 zl | Bulion z makaronem | makaron, natka pietruszki | Zupy",
        emptyState:
          "Nie ma jeszcze zadnej kategorii. Zacznij od dodania pierwszej kategorii albo wklej pozycje po jej utworzeniu.",
        itemEmptyText: "Ta kategoria nie ma jeszcze pozycji.",
      };
    }

    return {
      panelSelector: "#events-menu-panel",
      listSelector: "[data-menu-editor-list]",
      pill: "Przyjecia",
      title: "Menu okolicznosciowe",
      intro:
        "Edytor dla menu okolicznosciowego bez cen: sekcje sa rozwijane, a pozycje wygodnie edytujesz w jednym miejscu.",
      includePrice: false,
      quickAddHint:
        "Format linii: Nazwa | Opis | skladnik 1, skladnik 2 | Podkategoria",
      quickAddPlaceholder:
        "Pieczony schab w ziolach | Serwowany z sosem pieczeniowym | schab, rozmaryn, demi-glace | Dania glowne",
      emptyState:
        "Nie ma jeszcze zadnej kategorii. Dodaj sekcje i uzupelnij pozycje albo skorzystaj z szybkiego wklejania.",
      itemEmptyText: "Ta kategoria nie ma jeszcze pozycji.",
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
      state.ui.menuEditors[kind] = { openSections: {} };
    }
    return state.ui.menuEditors[kind];
  }

  function getMenuSectionsByKind(kind) {
    if (kind === "restaurant") {
      if (!state.content.restaurant) {
        state.content.restaurant = {};
      }
      if (!Array.isArray(state.content.restaurant.menu)) {
        state.content.restaurant.menu = [];
      }
      return state.content.restaurant.menu;
    }

    if (!state.content.events) {
      state.content.events = {};
    }
    if (!Array.isArray(state.content.events.menu)) {
      state.content.events.menu = [];
    }
    return state.content.events.menu;
  }

  function createMenuEditorItem(kind, overrides = {}) {
    const baseItem =
      kind === "restaurant"
        ? { name: "", price: "", description: "", ingredients: [] }
        : { name: "", description: "", ingredients: [] };
    return { ...baseItem, ...overrides };
  }

  function syncMenuEditorOpenSections(kind) {
    const editorState = getMenuEditorState(kind);
    const sections = getMenuSectionsByKind(kind);
    const nextOpenSections = {};
    sections.forEach((section, index) => {
      const persisted = editorState.openSections[index];
      const hasContent = Boolean(section?.section || (section?.items || []).length);
      nextOpenSections[index] = typeof persisted === "boolean" ? persisted : hasContent || sections.length <= 2;
    });
    editorState.openSections = nextOpenSections;
  }

  function rememberMenuEditorOpenSections(kind) {
    const root = getMenuEditorRoot(kind);
    if (!root) return;
    const editorState = getMenuEditorState(kind);
    root.querySelectorAll("[data-menu-editor-section-index]").forEach((details) => {
      const index = Number(details.getAttribute("data-menu-editor-section-index"));
      if (Number.isNaN(index)) return;
      editorState.openSections[index] = details.open;
    });
  }

  function countMenuEditorSubcategories(items) {
    return new Set((items || []).map((item) => item?.subcategory).filter(Boolean)).size;
  }

  function buildMenuEditorSummary(section) {
    const items = Array.isArray(section?.items) ? section.items.length : 0;
    const subcategories = countMenuEditorSubcategories(section?.items || []);
    return `${items} pozycji${subcategories ? ` • ${subcategories} podkategorii` : ""}`;
  }

  function parseMenuEditorIngredients(value) {
    return String(value || "")
      .split(/\r?\n|,|;/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function parseQuickAddMenuItems(text, kind) {
    const includePrice = getMenuEditorConfig(kind).includePrice;
    return String(text || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split("|").map((part) => part.trim());
        if (includePrice) {
          const [name = "", price = "", description = "", ingredientsText = "", subcategory = ""] = parts;
          if (!name) return null;
          const item = createMenuEditorItem(kind, {
            name,
            price,
            description,
            ingredients: parseMenuEditorIngredients(ingredientsText),
          });
          if (subcategory) {
            item.subcategory = subcategory;
          }
          return item;
        }

        const [name = "", description = "", ingredientsText = "", subcategory = ""] = parts;
        if (!name) return null;
        const item = createMenuEditorItem(kind, {
          name,
          description,
          ingredients: parseMenuEditorIngredients(ingredientsText),
        });
        if (subcategory) {
          item.subcategory = subcategory;
        }
        return item;
      })
      .filter(Boolean);
  }

  function renderMenuEditorPanel(kind, statusMessage = "") {
    const config = getMenuEditorConfig(kind);
    const panel = document.querySelector(config.panelSelector);
    if (!panel) return;

    const sections = getMenuSectionsByKind(kind);
    const itemCount = sections.reduce((sum, section) => sum + (section.items || []).length, 0);
    const subcategoryCount = sections.reduce(
      (sum, section) => sum + countMenuEditorSubcategories(section.items || []),
      0
    );

    syncMenuEditorOpenSections(kind);

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
          <button class="button secondary" type="button" data-menu-editor-expand>Rozwin wszystko</button>
          <button class="button secondary" type="button" data-menu-editor-collapse>Zwin wszystko</button>
          <button class="button" type="button" data-menu-editor-add-section>Dodaj kategorie</button>
        </div>
      </div>
      <p class="status">${escapeHtml(statusMessage)}</p>
      <div class="repeater-list menu-editor-list" data-menu-editor-list></div>
    `;

    renderMenuEditorSectionsList(kind);

    panel.querySelector("[data-menu-editor-add-section]")?.addEventListener("click", () => addMenuEditorSection(kind));
    panel.querySelector("[data-menu-editor-expand]")?.addEventListener("click", () => setMenuEditorSectionsOpen(kind, true));
    panel.querySelector("[data-menu-editor-collapse]")?.addEventListener("click", () => setMenuEditorSectionsOpen(kind, false));
  }

  function renderMenuEditorSectionsList(kind) {
    const config = getMenuEditorConfig(kind);
    const root = getMenuEditorRoot(kind);
    const target = root?.querySelector(config.listSelector);
    if (!target) return;

    const sections = getMenuSectionsByKind(kind);
    const editorState = getMenuEditorState(kind);

    if (!sections.length) {
      target.innerHTML = `
        <div class="repeater-item menu-editor-empty-state">
          <strong>Menu jest jeszcze puste</strong>
          <p class="helper">${escapeHtml(config.emptyState)}</p>
        </div>
      `;
      return;
    }

    target.innerHTML = sections
      .map((section, sectionIndex) => {
        const items = Array.isArray(section.items) ? section.items : [];
        const isOpen = editorState.openSections[sectionIndex] !== false;
        const columnCount = config.includePrice ? 6 : 5;

        return `
          <details class="menu-editor-section" data-menu-editor-section-index="${sectionIndex}" ${isOpen ? "open" : ""}>
            <summary class="menu-editor-summary">
              <div class="menu-editor-summary-copy">
                <span class="menu-editor-summary-label">Kategoria ${sectionIndex + 1}</span>
                <strong>${escapeHtml(section.section || "Nowa kategoria")}</strong>
                <span class="menu-editor-summary-meta">${escapeHtml(buildMenuEditorSummary(section))}</span>
              </div>
            </summary>
            <div class="menu-editor-section-body">
              <div class="inline-actions menu-editor-section-actions">
                <button class="button secondary" type="button" data-move-menu-section-up="${sectionIndex}" ${sectionIndex === 0 ? "disabled" : ""}>Przesun wyzej</button>
                <button class="button secondary" type="button" data-move-menu-section-down="${sectionIndex}" ${sectionIndex === sections.length - 1 ? "disabled" : ""}>Przesun nizej</button>
                <button class="button danger" type="button" data-remove-menu-section="${sectionIndex}">Usun kategorie</button>
              </div>

              <div class="field-grid">
                <label class="field-full">
                  <span>Nazwa kategorii</span>
                  <input data-menu-section-name="${sectionIndex}" value="${escapeAttribute(section.section || "")}" placeholder="np. Przystawki, Zupy, Dania glowne" />
                </label>
              </div>

              <div class="menu-editor-quick-add">
                <div class="menu-editor-quick-add-copy">
                  <strong>Szybkie dodawanie pozycji</strong>
                  <p class="helper">${escapeHtml(config.quickAddHint)}</p>
                  <p class="helper">Kolejnosc podkategorii na stronie wynika z pierwszego wystapienia pozycji z dana nazwa podkategorii.</p>
                </div>
                <label class="field-full">
                  <span>Wklej wiele pozycji naraz</span>
                  <textarea
                    rows="4"
                    data-menu-quick-add="${sectionIndex}"
                    placeholder="${escapeAttribute(config.quickAddPlaceholder)}"
                  ></textarea>
                </label>
                <button class="button secondary" type="button" data-apply-menu-quick-add="${sectionIndex}">Dodaj linie do kategorii</button>
              </div>

              <div class="repeater-head menu-editor-items-head">
                <strong>Pozycje w kategorii</strong>
                <button class="button secondary" type="button" data-add-menu-item="${sectionIndex}">Dodaj pozycje</button>
              </div>

              <div class="table-scroll menu-editor-table-scroll">
                <table class="hotel-table menu-editor-table">
                  <thead>
                    <tr>
                      <th>Nazwa</th>
                      ${config.includePrice ? "<th>Cena</th>" : ""}
                      <th>Podkategoria</th>
                      <th>Opis</th>
                      <th>Skladniki</th>
                      <th>Akcje</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${
                      items.length
                        ? items
                            .map(
                              (item, itemIndex) => `
                                <tr>
                                  <td>
                                    <input data-menu-item-name="${sectionIndex}-${itemIndex}" value="${escapeAttribute(item.name || "")}" placeholder="np. Krem z pomidorow" />
                                  </td>
                                  ${
                                    config.includePrice
                                      ? `<td><input data-menu-item-price="${sectionIndex}-${itemIndex}" value="${escapeAttribute(item.price || "")}" placeholder="np. 24 zl" /></td>`
                                      : ""
                                  }
                                  <td>
                                    <input data-menu-item-subcategory="${sectionIndex}-${itemIndex}" value="${escapeAttribute(item.subcategory || "")}" placeholder="opcjonalnie" />
                                  </td>
                                  <td>
                                    <textarea rows="2" data-menu-item-description="${sectionIndex}-${itemIndex}" placeholder="Krotki opis">${escapeHtml(item.description || "")}</textarea>
                                  </td>
                                  <td>
                                    <input data-menu-item-ingredients="${sectionIndex}-${itemIndex}" value="${escapeAttribute((item.ingredients || []).join(", "))}" placeholder="np. pomidory, bazylia, smietana" />
                                  </td>
                                  <td class="menu-editor-actions-cell">
                                    <div class="menu-editor-row-actions">
                                      <button class="button secondary" type="button" data-move-menu-item-up="${sectionIndex}" data-item-index="${itemIndex}" ${itemIndex === 0 ? "disabled" : ""}>↑</button>
                                      <button class="button secondary" type="button" data-move-menu-item-down="${sectionIndex}" data-item-index="${itemIndex}" ${itemIndex === items.length - 1 ? "disabled" : ""}>↓</button>
                                      <button class="button danger" type="button" data-remove-menu-item="${sectionIndex}" data-item-index="${itemIndex}">Usun</button>
                                    </div>
                                  </td>
                                </tr>
                              `
                            )
                            .join("")
                        : `<tr><td colspan="${columnCount}" class="menu-editor-empty-row">${escapeHtml(config.itemEmptyText)}</td></tr>`
                    }
                  </tbody>
                </table>
              </div>
            </div>
          </details>
        `;
      })
      .join("");

    target.querySelectorAll("[data-menu-editor-section-index]").forEach((details) => {
      details.addEventListener("toggle", () => {
        const index = Number(details.getAttribute("data-menu-editor-section-index"));
        if (Number.isNaN(index)) return;
        getMenuEditorState(kind).openSections[index] = details.open;
      });
    });
    target.querySelectorAll("[data-add-menu-item]").forEach((button) => {
      button.addEventListener("click", () => addMenuEditorItem(kind, Number(button.dataset.addMenuItem)));
    });
    target.querySelectorAll("[data-remove-menu-item]").forEach((button) => {
      button.addEventListener("click", () => removeMenuEditorItem(kind, Number(button.dataset.removeMenuItem), Number(button.dataset.itemIndex)));
    });
    target.querySelectorAll("[data-move-menu-item-up]").forEach((button) => {
      button.addEventListener("click", () => moveMenuEditorItem(kind, Number(button.dataset.moveMenuItemUp), Number(button.dataset.itemIndex), -1));
    });
    target.querySelectorAll("[data-move-menu-item-down]").forEach((button) => {
      button.addEventListener("click", () => moveMenuEditorItem(kind, Number(button.dataset.moveMenuItemDown), Number(button.dataset.itemIndex), 1));
    });
    target.querySelectorAll("[data-remove-menu-section]").forEach((button) => {
      button.addEventListener("click", () => removeMenuEditorSection(kind, Number(button.dataset.removeMenuSection)));
    });
    target.querySelectorAll("[data-move-menu-section-up]").forEach((button) => {
      button.addEventListener("click", () => moveMenuEditorSection(kind, Number(button.dataset.moveMenuSectionUp), -1));
    });
    target.querySelectorAll("[data-move-menu-section-down]").forEach((button) => {
      button.addEventListener("click", () => moveMenuEditorSection(kind, Number(button.dataset.moveMenuSectionDown), 1));
    });
    target.querySelectorAll("[data-apply-menu-quick-add]").forEach((button) => {
      button.addEventListener("click", () => applyQuickAddToMenuSection(kind, Number(button.dataset.applyMenuQuickAdd)));
    });
  }

  function setMenuEditorSectionsOpen(kind, isOpen) {
    const editorState = getMenuEditorState(kind);
    const sections = getMenuSectionsByKind(kind);
    editorState.openSections = sections.reduce((acc, section, index) => {
      acc[index] = isOpen;
      return acc;
    }, {});
    renderMenuEditorPanel(kind);
  }

  function addMenuEditorSection(kind) {
    captureDraftIfPossible();
    rememberMenuEditorOpenSections(kind);
    const sections = getMenuSectionsByKind(kind);
    sections.push({ section: "", items: [] });
    getMenuEditorState(kind).openSections[sections.length - 1] = true;
    renderMenuEditorPanel(kind);
  }

  function removeMenuEditorSection(kind, index) {
    captureDraftIfPossible();
    rememberMenuEditorOpenSections(kind);
    const sections = getMenuSectionsByKind(kind);
    sections.splice(index, 1);
    renderMenuEditorPanel(kind);
  }

  function moveMenuEditorSection(kind, index, direction) {
    captureDraftIfPossible();
    rememberMenuEditorOpenSections(kind);
    const sections = getMenuSectionsByKind(kind);
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= sections.length) return;
    [sections[index], sections[newIndex]] = [sections[newIndex], sections[index]];
    const editorState = getMenuEditorState(kind);
    [editorState.openSections[index], editorState.openSections[newIndex]] = [
      editorState.openSections[newIndex],
      editorState.openSections[index],
    ];
    renderMenuEditorPanel(kind);
  }

  function addMenuEditorItem(kind, sectionIndex) {
    captureDraftIfPossible();
    rememberMenuEditorOpenSections(kind);
    const section = getMenuSectionsByKind(kind)[sectionIndex];
    if (!section) return;
    if (!Array.isArray(section.items)) {
      section.items = [];
    }
    section.items.push(createMenuEditorItem(kind));
    renderMenuEditorPanel(kind);
  }

  function removeMenuEditorItem(kind, sectionIndex, itemIndex) {
    captureDraftIfPossible();
    rememberMenuEditorOpenSections(kind);
    const section = getMenuSectionsByKind(kind)[sectionIndex];
    if (!section?.items) return;
    section.items.splice(itemIndex, 1);
    renderMenuEditorPanel(kind);
  }

  function moveMenuEditorItem(kind, sectionIndex, itemIndex, direction) {
    captureDraftIfPossible();
    rememberMenuEditorOpenSections(kind);
    const section = getMenuSectionsByKind(kind)[sectionIndex];
    if (!section?.items) return;
    const newIndex = itemIndex + direction;
    if (newIndex < 0 || newIndex >= section.items.length) return;
    [section.items[itemIndex], section.items[newIndex]] = [section.items[newIndex], section.items[itemIndex]];
    renderMenuEditorPanel(kind);
  }

  function applyQuickAddToMenuSection(kind, sectionIndex) {
    captureDraftIfPossible();
    rememberMenuEditorOpenSections(kind);
    const root = getMenuEditorRoot(kind);
    const textarea = root?.querySelector(`[data-menu-quick-add="${sectionIndex}"]`);
    const items = parseQuickAddMenuItems(textarea?.value || "", kind);
    if (!items.length) {
      renderMenuEditorPanel(kind, "Nie znaleziono poprawnych linii do dodania.");
      return;
    }
    const section = getMenuSectionsByKind(kind)[sectionIndex];
    if (!section) return;
    if (!Array.isArray(section.items)) {
      section.items = [];
    }
    section.items.push(...items);
    renderMenuEditorPanel(kind, `Dodano ${items.length} pozycji do kategorii.`);
  }

  function collectMenuEditorFromPanel(kind) {
    const root = getMenuEditorRoot(kind);
    if (!root) return [];
    const config = getMenuEditorConfig(kind);
    const includePrice = config.includePrice;
    const itemInputs = Array.from(root.querySelectorAll("[data-menu-item-name]"));

    return Array.from(root.querySelectorAll("[data-menu-section-name]"))
      .map((sectionInput, sectionIndex) => {
        const sectionName = sectionInput.value.trim();
        if (!sectionName) return null;

        const items = itemInputs
          .map((itemInput) => {
            const [rawSectionIndex, rawItemIndex] = String(itemInput.dataset.menuItemName || "")
              .split("-")
              .map(Number);
            if (rawSectionIndex !== sectionIndex || Number.isNaN(rawItemIndex)) {
              return null;
            }

            const name = itemInput.value.trim();
            if (!name) return null;

            const description =
              root.querySelector(`[data-menu-item-description="${sectionIndex}-${rawItemIndex}"]`)?.value.trim() || "";
            const subcategory =
              root.querySelector(`[data-menu-item-subcategory="${sectionIndex}-${rawItemIndex}"]`)?.value.trim() || "";
            const ingredients = parseMenuEditorIngredients(
              root.querySelector(`[data-menu-item-ingredients="${sectionIndex}-${rawItemIndex}"]`)?.value || ""
            );

            const item = createMenuEditorItem(kind, { name, description, ingredients });
            if (includePrice) {
              item.price =
                root.querySelector(`[data-menu-item-price="${sectionIndex}-${rawItemIndex}"]`)?.value.trim() || "";
            }
            if (subcategory) {
              item.subcategory = subcategory;
            } else {
              delete item.subcategory;
            }
            return item;
          })
          .filter(Boolean);

        return { section: sectionName, items };
      })
      .filter(Boolean);
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
                  <form class="stack" data-upload-room-gallery="${escapeAttribute(roomType.key)}">
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

  async function uploadRoomGalleryImages(event, roomType) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const files = formData.getAll("images");

    if (files.length === 0 || !files[0].size) {
      renderHotelRoomGalleriesPanel("Wybierz pliki do wgrania.");
      return;
    }

    try {
      const images = await filesToInlineGalleryImages(files, INLINE_IMAGE_MAX_BYTES, roomType);

      if (!state.content.hotel) {
        state.content.hotel = {};
      }
      if (!state.content.hotel.roomGalleries) {
        state.content.hotel.roomGalleries = {
          "1-osobowe": [],
          "2-osobowe": [],
          "3-osobowe": [],
          "4-osobowe": [],
        };
      }

      if (!state.content.hotel.roomGalleries[roomType]) {
        state.content.hotel.roomGalleries[roomType] = [];
      }

      state.content.hotel.roomGalleries[roomType].push(...images);
      await saveContent();
      await loadDashboard("Zdjecia zostaly dodane.");
    } catch (error) {
      renderHotelRoomGalleriesPanel(error.message || "Blad podczas wgrywania zdjec.");
    }
  }

  async function removeRoomImage(roomType, index) {
    if (!state.content.hotel?.roomGalleries?.[roomType]) {
      return;
    }
    state.content.hotel.roomGalleries[roomType].splice(index, 1);
    await saveContent();
    await loadDashboard("Zdjecie zostalo usuniete.");
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
    [images[index], images[newIndex]] = [images[newIndex], images[index]];
    await saveContent();
    await loadDashboard("Kolejnosc zdjec zostala zmieniona.");
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
  }

  function removeDocumentsMenuSection(index) {
    state.content.documentsMenu = collectDocumentsMenuFromPanel();
    state.content.documentsMenu.sections.splice(index, 1);
    renderDocumentsPanel();
  }

  async function saveDocumentsMenu() {
    try {
      state.content.documentsMenu = collectDocumentsMenuFromPanel();
      const data = await api("/api/admin/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: state.content }),
      });
      const normalizedContent = normalizeAdminContent(data.content);
      state.content = normalizedContent;
      state.lastSavedContent = structuredClone(normalizedContent);
      renderDocumentsPanel("Menu okolicznosciowe zostalo zapisane.");
    } catch (error) {
      renderDocumentsPanel(error.message);
    }
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
    panel.innerHTML = `
      <p class="pill">Kalendarz sal</p>
      <h2>Blokady terminow</h2>
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
            <label class="field-full"><span>Notatka</span><textarea name="notes"></textarea></label>
          </div>
          <button class="button" type="submit">Dodaj blokade</button>
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
                      <p class="helper">${escapeHtml(block.notes || "")}</p>
                      <button class="button danger" type="button" data-delete-block="${block.id}">Usun blokade</button>
                    </article>`
                )
                .join("")
            : `<p class="empty">Brak blokad terminow.</p>`
        }
      </div>
    `;

    document.querySelector("#calendar-form").addEventListener("submit", addCalendarBlock);
    panel.querySelectorAll("[data-delete-block]").forEach((button) => {
      button.addEventListener("click", () => deleteCalendarBlock(button.dataset.deleteBlock));
    });
  }

  async function addCalendarBlock(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    try {
      await api("/api/admin/calendar/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await loadDashboard("Blokada zostala dodana.");
    } catch (error) {
      renderCalendarPanel(error.message);
    }
  }

  async function deleteCalendarBlock(blockId) {
    await api(`/api/admin/calendar/blocks/${blockId}`, { method: "DELETE" });
    await loadDashboard("Blokada zostala usunieta.");
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
