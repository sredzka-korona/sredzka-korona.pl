/**
 * Panel admina — moduł Hotel (API rezerwacji / D1).
 * Wymaga: firebase (auth), SREDZKA_CONFIG.hotelApiBase lub firebaseProjectId.
 */
(function () {
  const config = window.SREDZKA_CONFIG || {};

  function hotelApiBase() {
    if (config.apiBase) {
      return `${String(config.apiBase).replace(/\/$/, "")}/api/admin/legacy-bookings/hotel`;
    }
    if (config.hotelApiBase) {
      return String(config.hotelApiBase).replace(/\/$/, "");
    }
    if (config.firebaseProjectId) {
      return `https://europe-west1-${config.firebaseProjectId}.cloudfunctions.net/hotelApi`;
    }
    return "";
  }

  async function hotelApi(op, options = {}) {
    const base = hotelApiBase();
    if (!base) {
      throw new Error("Brak hotelApiBase / firebaseProjectId.");
    }
    if (typeof firebase === "undefined" || !firebase.auth()?.currentUser) {
      throw new Error("Brak sesji Firebase.");
    }
    const token = await firebase.auth().currentUser.getIdToken();
    const url = new URL(base);
    url.searchParams.set("op", op);
    if (options.query && typeof options.query === "object") {
      Object.entries(options.query).forEach(([key, value]) => {
        if (value === undefined || value === null || value === "") return;
        url.searchParams.set(key, String(value));
      });
    }
    const res = await fetch(url.toString(), {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const raw = await res.text();
    let data = {};
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = {};
      }
    }
    if (!res.ok) {
      throw new Error(data.error || raw || `Błąd API hotelu (${res.status}).`);
    }
    return data;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function parseImageUrlsInput(raw) {
    const s = String(raw ?? "").trim();
    if (!s) return [];
    return s
      .split(/[\n,]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  function formatImageUrlsForInput(urls) {
    if (!Array.isArray(urls) || !urls.length) return "";
    return urls.join("\n");
  }

  let hotelRoomModalKeydownHandler = null;

  function closeHotelRoomModal() {
    document.getElementById("hotel-room-editor-mount")?.remove();
    document.body.classList.remove("admin-modal-open");
    if (hotelRoomModalKeydownHandler) {
      document.removeEventListener("keydown", hotelRoomModalKeydownHandler);
      hotelRoomModalKeydownHandler = null;
    }
  }

  function formatMs(ms) {
    if (!ms) return "—";
    const d = new Date(ms);
    return d.toLocaleString("pl-PL");
  }

  function countdown(ms) {
    if (!ms) return "—";
    const left = ms - Date.now();
    if (left <= 0) return "0:00:00";
    const h = Math.floor(left / 3600000);
    const m = Math.floor((left % 3600000) / 60000);
    const s = Math.floor((left % 60000) / 1000);
    return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  }

  let hotelSubTab = "reservations";
  let hotelResFilter = "active";
  let roomsData = [];
  let reservationsData = [];
  let blockListData = [];
  let templatesData = {};
  let countdownTimer = null;

  const HOTEL_TEMPLATE_LABELS = {
    confirm_email: "Link potwierdzający — pierwszy e-mail po wysłaniu formularza (klient klika, żeby potwierdzić adres e-mail).",
    pending_admin: "Powiadomienie dla obsługi — nowa rezerwacja wymaga decyzji w panelu.",
    confirmed_client: "Klient — rezerwacja zaakceptowana (pokoje zarezerwowane).",
    cancelled_client: "Klient — rezerwacja anulowana przez hotel lub po upływie czasu.",
    changed_client: "Klient — po edycji rezerwacji przez administratora (wysyłane tylko gdy zaznaczysz wysyłkę).",
    expired_pending_client: "Klient — wygasło oczekiwanie na decyzję recepcji.",
    expired_pending_admin: "Obsługa — informacja o automatycznym wygaśnięciu oczekującej rezerwacji.",
    expired_email_client: "Klient — nie potwierdzono adresu e-mail w terminie 2 godzin.",
    cancelled_admin: "Obsługa — informacja o anulowaniu rezerwacji.",
  };

  const HOTEL_TEMPLATE_DEFAULTS = {
    confirm_email: {
      subject: "{{hotelName}} | potwierdzenie adresu e-mail dla rezerwacji {{reservationNumber}}",
      bodyHtml:
        '<p>Dzien dobry {{fullName}},</p><p>Dziekujemy za wyslanie formularza rezerwacji w obiekcie <strong>{{hotelName}}</strong>.</p><p>Aby przekazac zgloszenie do dalszej obslugi, potwierdz adres e-mail:</p><p><a href="{{confirmationLink}}">Potwierdz adres e-mail</a></p><p>Numer rezerwacji: <strong>{{reservationNumber}}</strong><br>Termin pobytu: {{dateFrom}} - {{dateTo}}<br>Pokoje: {{roomsList}}</p><p>Jesli to nie Ty wysylales zgloszenie, zignoruj te wiadomosc.</p>',
      actionLabel: "Potwierdź adres e-mail",
    },
    pending_admin: {
      subject: "[{{hotelName}}] Rezerwacja do decyzji: {{reservationNumber}}",
      bodyHtml:
        "<p>W panelu pojawila sie nowa rezerwacja oczekujaca na akceptacje.</p><p>Numer: <strong>{{reservationNumber}}</strong><br>Klient: {{fullName}}<br>E-mail: {{email}}<br>Telefon: {{phone}}<br>Termin: {{dateFrom}} - {{dateTo}}<br>Pokoje: {{roomsList}}<br>Kwota orientacyjna: {{totalPrice}} PLN</p><p>Uwagi klienta: {{customerNote}}</p>",
    },
    confirmed_client: {
      subject: "{{hotelName}} | rezerwacja {{reservationNumber}} potwierdzona",
      bodyHtml:
        "<p>Dzien dobry {{fullName}},</p><p>Potwierdzamy rezerwacje o numerze <strong>{{reservationNumber}}</strong>.</p><p>Termin pobytu: {{dateFrom}} - {{dateTo}}<br>Liczba noclegow: {{nights}}<br>Pokoje: {{roomsList}}<br>Kwota orientacyjna: {{totalPrice}} PLN</p><p>W razie pytan mozesz odpowiedziec na te wiadomosc lub skontaktowac sie bezposrednio z recepcja.</p>",
    },
    cancelled_client: {
      subject: "{{hotelName}} | anulowanie rezerwacji {{reservationNumber}}",
      bodyHtml:
        "<p>Dzien dobry {{fullName}},</p><p>Informujemy, ze rezerwacja o numerze <strong>{{reservationNumber}}</strong> zostala anulowana.</p><p>Termin pobytu: {{dateFrom}} - {{dateTo}}<br>Pokoje: {{roomsList}}</p><p>Jesli potrzebujesz pomocy przy nowej rezerwacji, skontaktuj sie z recepcja.</p>",
    },
    changed_client: {
      subject: "{{hotelName}} | zmiana rezerwacji {{reservationNumber}}",
      bodyHtml:
        "<p>Dzien dobry {{fullName}},</p><p>Wprowadzilismy zmiany w rezerwacji o numerze <strong>{{reservationNumber}}</strong>.</p><p>Aktualny termin pobytu: {{dateFrom}} - {{dateTo}}<br>Liczba noclegow: {{nights}}<br>Pokoje: {{roomsList}}<br>Kwota orientacyjna: {{totalPrice}} PLN</p><p>Uwagi do rezerwacji: {{customerNote}}</p><p>Jesli chcesz cos doprecyzowac, odpowiedz na te wiadomosc lub skontaktuj sie z recepcja.</p>",
    },
  };

  const LEGACY_HOTEL_TEMPLATE_DEFAULTS = {
    confirm_email: {
      subject: "{{hotelName}} — potwierdź rezerwację ({{reservationNumber}})",
      bodyHtml:
        '<p>Witaj {{fullName}},</p><p>Kliknij link, aby potwierdzić rezerwację:</p><p><a href="{{confirmationLink}}">Potwierdź rezerwację</a></p><p>Numer: {{reservationNumber}}<br>Termin: {{dateFrom}} — {{dateTo}}</p>',
    },
    pending_admin: {
      subject: "[{{hotelName}}] Nowa rezerwacja oczekująca {{reservationNumber}}",
      bodyHtml:
        "<p>Nowa rezerwacja oczekuje na decyzję.</p><p>{{fullName}} · {{email}} · {{phone}}</p><p>{{dateFrom}} — {{dateTo}}</p>",
    },
    confirmed_client: {
      subject: "{{hotelName}} — rezerwacja potwierdzona ({{reservationNumber}})",
      bodyHtml: "<p>Witaj {{fullName}},</p><p>Rezerwacja {{reservationNumber}} została potwierdzona.</p>",
    },
    cancelled_client: {
      subject: "{{hotelName}} — rezerwacja anulowana ({{reservationNumber}})",
      bodyHtml: "<p>Witaj {{fullName}},</p><p>Rezerwacja {{reservationNumber}} została anulowana.</p>",
    },
    changed_client: {
      subject: "{{hotelName}} — zmiana w rezerwacji {{reservationNumber}}",
      bodyHtml:
        "<p>Witaj {{fullName}},</p><p>Wprowadziliśmy zmiany w rezerwacji <strong>{{reservationNumber}}</strong>.</p><p>Termin pobytu: {{dateFrom}} — {{dateTo}} ({{nights}} nocy).<br>Pokoje: {{roomsList}}<br>Kwota orientacyjna: {{totalPrice}} PLN</p><p>{{customerNote}}</p><p>W razie pytań odpowiedz na tę wiadomość lub skontaktuj się z recepcją.</p>",
    },
  };

  const HOTEL_TEMPLATE_PREVIEW_VARS = Object.freeze({
    reservationNumber: "18/2026/HOTEL",
    reservationSubject: "Weekend w apartamencie premium",
    decisionDeadline: "10 maja 2026, godz. 18:00",
    fullName: "Anna Kowalska",
    email: "anna.kowalska@example.com",
    phone: "+48 600 700 800",
    roomsList: "Apartament Premium, Pokój Deluxe",
    dateFrom: "14 maja 2026",
    dateTo: "16 maja 2026",
    nights: "2",
    totalPrice: "1240",
    customerNote: "Prosimy o spokojny pokój i możliwość późniejszego zameldowania około 20:30.",
    adminNote: "Gość preferuje apartament od strony dziedzińca.",
    confirmationLink: "https://www.sredzkakorona.pl/hotel/potwierdzenie?token=podglad",
    hotelName: "Średzka Korona",
  });

  function renderTemplatePreviewString(template, vars) {
    return String(template || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
      const value = vars?.[key];
      if (value === undefined || value === null) return "";
      return escapeHtml(String(value));
    });
  }

  function sanitizeTemplatePreviewHtml(html) {
    return String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, "")
      .replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, ' $1="#"');
  }

  function hotelMailHeaderContext(key) {
    const map = {
      confirm_email: "Potwierdzenie rezerwacji noclegu",
      pending_admin: "Rezerwacja noclegu — powiadomienie dla obsługi",
      confirmed_client: "Potwierdzenie rezerwacji noclegu",
      cancelled_client: "Odwołanie rezerwacji noclegu",
      changed_client: "Zmiana rezerwacji noclegu",
      expired_pending_client: "Wygaśnięcie rezerwacji noclegu",
      expired_pending_admin: "Wygaśnięcie rezerwacji — informacja dla obsługi",
      expired_email_client: "Wygasłe potwierdzenie — rezerwacja noclegu",
      cancelled_admin: "Odwołanie rezerwacji — informacja dla obsługi",
    };
    return map[key] || "Wiadomość o rezerwacji";
  }

  function buildMailPreviewMarkup({ inboxSubject, headerContext, headerNumber, bodyHtml, footerLabel, actionLabel = "" }) {
    const safeBrandName = "Średzka Korona";
    const safeHeaderBrand = "Średzka Korona";
    const safeContext = escapeHtml(headerContext || "");
    const safeNumber = headerNumber ? `nr ${escapeHtml(headerNumber)}` : "";
    const safePreheader = escapeHtml(inboxSubject || safeBrandName);
    const logoUrl = `${window.location.origin}/ikony/logo-korona.png`;
    const enhancedContent = enhancePreviewHtml(bodyHtml);
    const actionTitle = escapeHtml(actionLabel || "Zobacz szczegóły");
    const footerText = escapeHtml(footerLabel || "Strona główna");

    return `
      <div class="mail-preview-shell">
        <div class="mail-preview-note">Podgląd na przykładowych danych. Branding i układ odpowiadają faktycznie wysyłanej wiadomości.</div>
        <div class="mail-preview-inbox-subject">Temat w skrzynce: <strong>${escapeHtml(inboxSubject || "—")}</strong></div>
        <div class="mail-preview-frame" style="background:#f6f1e8;padding:28px 12px;">
          <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${safePreheader}</div>
          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background:#f6f1e8;">
            <tr>
              <td align="center" style="padding:0 12px;">
                <table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;max-width:680px;">
                  <tr>
                    <td align="center" style="padding:0 0 16px 0;">
                      <table cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td style="font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1;letter-spacing:0.28em;color:#7b5a24;font-weight:700;padding-right:10px;">ŚREDZKA</td>
                          <td style="padding:0 2px;">
                            <img src="${logoUrl}" alt="Korona" width="42" height="42" style="display:block;width:42px;height:42px;border:0;" />
                          </td>
                          <td style="font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1;letter-spacing:0.28em;color:#7b5a24;font-weight:700;padding-left:10px;">KORONA</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="background:#ffffff;border:1px solid #e8dcc8;border-radius:22px;padding:34px 32px;box-shadow:0 10px 30px rgba(52,33,14,0.08);">
                      <div style="text-align:center;margin:0 0 22px 0;">
                        <div style="font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.25;color:#1f1712;font-weight:700;">
                          ${safeHeaderBrand}
                        </div>
                        ${safeContext ? `<div style="font-size:17px;line-height:1.4;color:#4a3d32;font-weight:600;margin-top:12px;">${safeContext}</div>` : ""}
                        ${safeNumber ? `<div style="font-size:15px;line-height:1.45;color:#7a6754;margin-top:10px;letter-spacing:0.02em;">${safeNumber}</div>` : ""}
                      </div>
                      ${actionLabel ? `<table cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 26px auto;">
                        <tr>
                          <td style="border-radius:999px;background:#7b5a24;">
                            <a href="#" onclick="return false;" style="display:inline-block;padding:14px 24px;font-size:15px;line-height:1.2;font-weight:700;color:#ffffff;text-decoration:none;">${actionTitle}</a>
                          </td>
                        </tr>
                      </table>` : ""}
                      <div style="font-size:16px;line-height:1.75;color:#3e3125;">
                        ${enhancedContent || "<p>Brak treści wiadomości.</p>"}
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:18px 10px 0 10px;text-align:center;font-size:13px;line-height:1.7;color:#7c6a58;">
                      <div>Wiadomość transakcyjna dotycząca rezerwacji w obiekcie ${safeBrandName}.</div>
                      <div style="padding-top:6px;">Jeśli masz pytania, odpowiedz na tę wiadomość.</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </div>
      </div>`;
  }

  function enhancePreviewHtml(html) {
    return String(html || "")
      .replace(/<a\b([^>]*)>/gi, (match, attrs) => {
        if (/\bstyle\s*=/i.test(attrs)) return `<a${attrs}>`;
        return `<a${attrs} style="color:#7b5a24;font-weight:700;text-decoration:none;border-bottom:1px solid #c8aa78;">`;
      })
      .replace(/<h([1-3])\b([^>]*)>/gi, (match, level, attrs) => {
        if (/\bstyle\s*=/i.test(attrs)) return `<h${level}${attrs}>`;
        const sizes = { 1: "30px", 2: "24px", 3: "20px" };
        return `<h${level}${attrs} style="margin:0 0 18px 0;font-family:Georgia,'Times New Roman',serif;font-size:${sizes[level] || "24px"};line-height:1.2;color:#1f1712;font-weight:700;text-align:center;">`;
      });
  }

  function hotelPreviewActionLabel(key) {
    if (key !== "confirm_email") return "";
    const el = document.querySelector(`[data-tpl-key="${key}"][data-field="actionLabel"]`);
    const v = el && String(el.value || "").trim();
    return v || "Potwierdź adres e-mail";
  }

  function updateHotelTemplatePreview(key) {
    if (!key) return;
    const subjectField = document.querySelector(`[data-tpl-key="${key}"][data-field="subject"]`);
    const editor = document.querySelector(`.wysiwyg-editor[data-tpl-key="${key}"]`);
    const hidden = document.querySelector(`[data-tpl-key="${key}"][data-field="bodyHtml-hidden"]`);
    const previewHost = document.querySelector(`[data-hotel-preview-key="${key}"]`);
    if (!subjectField || !previewHost) return;
    const bodyHtml = editor?.innerHTML || hidden?.value || "";
    const renderedSubject = renderTemplatePreviewString(subjectField.value, HOTEL_TEMPLATE_PREVIEW_VARS);
    const renderedBody = sanitizeTemplatePreviewHtml(
      renderTemplatePreviewString(bodyHtml, HOTEL_TEMPLATE_PREVIEW_VARS)
    );
    previewHost.innerHTML = buildMailPreviewMarkup({
      inboxSubject: renderedSubject,
      headerContext: hotelMailHeaderContext(key),
      headerNumber: HOTEL_TEMPLATE_PREVIEW_VARS.reservationNumber,
      bodyHtml: renderedBody,
      footerLabel: "Hotel Średzka Korona",
      actionLabel: hotelPreviewActionLabel(key),
    });
  }

  function bindHotelTemplatePreviews() {
    const keys = new Set();
    document.querySelectorAll("[data-tpl-key][data-field]").forEach((field) => {
      const key = field.getAttribute("data-tpl-key");
      if (!key) return;
      keys.add(key);
      field.addEventListener("input", () => updateHotelTemplatePreview(key));
    });
    keys.forEach((key) => updateHotelTemplatePreview(key));
  }

  function bindWysiwygEditors() {
    document.querySelectorAll(".wysiwyg-toolbar button[data-cmd]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const cmd = btn.getAttribute("data-cmd");
        const toolbar = btn.closest(".wysiwyg-toolbar");
        const tplKey = toolbar?.getAttribute("data-toolbar-for");
        const editor = document.querySelector(`.wysiwyg-editor[data-tpl-key="${tplKey}"]`);
        if (!editor) return;
        editor.focus();
        if (cmd === "createLink") {
          const url = prompt("Podaj adres URL:", "https://");
          if (url) document.execCommand(cmd, false, url);
        } else {
          document.execCommand(cmd, false, null);
        }
        updateWysiwygHiddenInput(tplKey);
        updateHotelTemplatePreview(tplKey);
      });
    });

    document.querySelectorAll(".wysiwyg-editor[contenteditable]").forEach((editor) => {
      const tplKey = editor.getAttribute("data-tpl-key");
      editor.addEventListener("input", () => {
        updateWysiwygHiddenInput(tplKey);
        updateHotelTemplatePreview(tplKey);
      });
    });
  }

  function updateWysiwygHiddenInput(tplKey) {
    const editor = document.querySelector(`.wysiwyg-editor[data-tpl-key="${tplKey}"]`);
    const hidden = document.querySelector(`[data-tpl-key="${tplKey}"][data-field="bodyHtml-hidden"]`);
    if (editor && hidden) {
      hidden.value = editor.innerHTML;
    }
  }

  function slugifyRoomId(value) {
    const map = { ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ż: "z", ź: "z" };
    return String(value || "")
      .trim()
      .toLowerCase()
      .split("")
      .map((char) => map[char] || char)
      .join("")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  }

  function roomPayload(room, overrides = {}) {
    return {
      id: room.id,
      name: room.name || room.id,
      pricePerNight: Number(room.pricePerNight || 0),
      maxGuests: Math.max(1, toInt(room.maxGuests)),
      bedsSingle: toInt(room.bedsSingle),
      bedsDouble: toInt(room.bedsDouble),
      bedsChild: toInt(room.bedsChild),
      description: String(room.description || ""),
      imageUrls: Array.isArray(room.imageUrls) ? room.imageUrls : [],
      active: room.active !== false,
      sortOrder: Number.isFinite(Number(room.sortOrder)) ? Number(room.sortOrder) : 0,
      ...overrides,
    };
  }

  function normalizeRoomIdentity(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, " ")
      .toLocaleLowerCase("pl-PL");
  }

  function roomDisplayName(roomOrId) {
    if (roomOrId && typeof roomOrId === "object") {
      return String(roomOrId.name || roomOrId.id || "").trim() || "—";
    }
    const currentId = String(roomOrId || "");
    const room = roomsData.find((entry) => String(entry.id) === currentId);
    return String(room?.name || currentId || "").trim() || "—";
  }

  function roomListLabel(roomIds) {
    return (Array.isArray(roomIds) ? roomIds : [])
      .map((roomId) => roomDisplayName(roomId))
      .filter(Boolean)
      .join(", ");
  }

  function isLegacyHotelTemplate(key, template) {
    if (!template) return true;
    const subject = String(template.subject || "").trim();
    const bodyHtml = String(template.bodyHtml || "").trim();
    if (!subject || !bodyHtml) return true;
    const legacy = LEGACY_HOTEL_TEMPLATE_DEFAULTS[key];
    return Boolean(legacy && subject === legacy.subject && bodyHtml === legacy.bodyHtml);
  }

  function mergeHotelTemplates(rawTemplates) {
    const merged = { ...(rawTemplates || {}) };
    Object.entries(HOTEL_TEMPLATE_DEFAULTS).forEach(([key, defaults]) => {
      if (isLegacyHotelTemplate(key, rawTemplates?.[key])) {
        merged[key] = structuredClone(defaults);
        return;
      }
      merged[key] = {
        subject: String(rawTemplates?.[key]?.subject || defaults.subject),
        bodyHtml: String(rawTemplates?.[key]?.bodyHtml || defaults.bodyHtml),
        actionLabel: String(rawTemplates?.[key]?.actionLabel ?? defaults.actionLabel ?? ""),
      };
    });
    return merged;
  }

  async function loadRooms() {
    const d = await hotelApi("admin-rooms-list", { method: "GET" });
    roomsData = d.rooms || [];
  }

  async function loadReservations(status) {
    const mode = status && String(status).length ? status : "active";
    const q = `&status=${encodeURIComponent(mode)}`;
    const base = hotelApiBase();
    const token = await firebase.auth().currentUser.getIdToken();
    const res = await fetch(`${base}?op=admin-reservations-list${q}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || "Błąd");
    reservationsData = d.reservations || [];
  }

  async function loadTemplates() {
    const d = await hotelApi("admin-mail-templates", { method: "GET" });
    const rawTemplates = d.templates || {};
    templatesData = mergeHotelTemplates(rawTemplates);
    const legacyKeys = Object.keys(HOTEL_TEMPLATE_DEFAULTS).filter((key) => isLegacyHotelTemplate(key, rawTemplates[key]));
    if (legacyKeys.length) {
      await Promise.all(
        legacyKeys.map((key) =>
          hotelApi("admin-mail-template-save", {
            method: "PUT",
            body: {
              key,
              subject: templatesData[key].subject,
              bodyHtml: templatesData[key].bodyHtml,
              actionLabel: templatesData[key].actionLabel || "",
            },
          }).catch(() => null)
        )
      );
    }
  }

  async function loadBlockList() {
    const base = hotelApiBase();
    const token = await firebase.auth().currentUser.getIdToken();
    const res = await fetch(`${base}?op=admin-reservations-list&status=${encodeURIComponent("manual_block")}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || "Błąd");
    blockListData = d.reservations || [];
  }

  function toInt(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }

  async function moveRoom(index, direction) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= roomsData.length) return;
    const reordered = [...roomsData];
    [reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
    await Promise.all(
      reordered.map((room, order) =>
        hotelApi("admin-room-upsert", {
          method: "PUT",
          body: roomPayload(room, { sortOrder: order }),
        })
      )
    );
    await loadRooms();
  }

  function renderRooms(root) {
    const body = roomsData
      .map(
        (r, index) => `
      <tr data-id="${escapeHtml(r.id)}">
        <td>
          <strong>${escapeHtml(roomDisplayName(r))}</strong>
          ${r.id !== r.name ? `<div class="helper">ID systemowe: ${escapeHtml(r.id)}</div>` : ""}
        </td>
        <td>${escapeHtml(String(r.pricePerNight ?? ""))}</td>
        <td>${escapeHtml(String(r.maxGuests ?? "—"))}</td>
        <td>${escapeHtml([toInt(r.bedsSingle) && `${toInt(r.bedsSingle)}×1os.`, toInt(r.bedsDouble) && `${toInt(r.bedsDouble)}×2os.`, toInt(r.bedsChild) && `${toInt(r.bedsChild)}×dz.`].filter(Boolean).join(", ") || "—")}</td>
        <td>${r.active !== false ? "tak" : "nie"}</td>
        <td class="admin-row-actions admin-row-actions--room-order">
          <button type="button" class="button secondary hotel-move-room" data-direction="-1" data-index="${index}" aria-label="Przesun pokoj wyzej" title="Przesun wyzej" ${index === 0 ? "disabled" : ""}>↑</button>
          <button type="button" class="button secondary hotel-move-room" data-direction="1" data-index="${index}" aria-label="Przesun pokoj nizej" title="Przesun nizej" ${index === roomsData.length - 1 ? "disabled" : ""}>↓</button>
          <button type="button" class="button secondary hotel-edit-room" data-id="${escapeHtml(r.id)}">Edytuj</button>
          <button type="button" class="button secondary danger-muted hotel-delete-room" data-id="${escapeHtml(r.id)}" data-name="${escapeHtml(roomDisplayName(r))}">Usuń</button>
        </td>
      </tr>`
      )
      .join("");
    return `
      <div class="hotel-subpanel">
        <div class="admin-toolbar-row hotel-rooms-heading">
          <div>
            <h3>Pokoje (${roomsData.length})</h3>
            <p class="helper">Ceny i parametry zapisują się w bazie — wpływają na nowe rezerwacje i widok na stronie.</p>
          </div>
          <div class="admin-toolbar-actions">
            <button type="button" class="button" id="hotel-add-room">Dodaj pokój</button>
          </div>
        </div>
        <div class="table-scroll">
          <table class="hotel-table">
            <thead><tr><th>Nazwa</th><th>Cena / noc</th><th>Max os.</th><th>Łóżka</th><th>Aktywny</th><th></th></tr></thead>
            <tbody>${body || "<tr><td colspan='6'>Brak danych — dodaj pokój lub uruchom seed.</td></tr>"}</tbody>
          </table>
        </div>
      </div>`;
  }

  function renderReservations(root) {
    const rows = reservationsData
      .map(
        (r) => `
      <tr>
        <td>${escapeHtml(r.humanNumberLabel || r.humanNumber || r.id)}</td>
        <td>${escapeHtml(r.customerName || "")}</td>
        <td>${escapeHtml(r.statusLabel || r.status)}</td>
        <td>${escapeHtml(r.dateFrom)} → ${escapeHtml(r.dateTo)}</td>
        <td>${escapeHtml(String(r.totalPrice ?? ""))}</td>
        <td class="hotel-countdown" data-pending="${r.pendingExpiresAt || ""}" data-email-exp="${r.emailVerificationExpiresAt || ""}" data-status="${escapeHtml(r.status)}">${r.status === "pending" ? countdown(r.pendingExpiresAt) : r.status === "email_verification_pending" ? countdown(r.emailVerificationExpiresAt) : "—"}</td>
        <td class="admin-row-actions">
          <button type="button" class="button secondary hotel-res-edit" data-id="${escapeHtml(r.id)}">Edytuj</button>
          <button type="button" class="button secondary danger-muted hotel-res-cancel" data-id="${escapeHtml(r.id)}">Anuluj</button>
        </td>
      </tr>`
      )
      .join("");
    return `
      <div class="hotel-subpanel">
        <h3>Rezerwacje</h3>
        <p class="helper">Domyślnie widać tylko rezerwacje <strong>oczekujące</strong> i <strong>zarezerwowane</strong>, posortowane tak, że najpierw kończące się terminy; najpierw status „Oczekujące”. Pozostałe statusy wybierz z listy.</p>
        <div class="admin-toolbar-row hotel-filters">
          <div class="admin-toolbar-filters">
            <label>Status <select id="hotel-res-filter">
            <option value="active">Aktywne (oczekujące + zarezerwowane)</option>
            <option value="all">Wszystkie statusy</option>
            <option value="pending">Tylko oczekujące</option>
            <option value="confirmed">Tylko zarezerwowane</option>
            <option value="cancelled">Anulowane</option>
            <option value="expired">Wygasłe</option>
            <option value="email_verification_pending">E-mail do potwierdzenia</option>
            <option value="manual_block">Blokady terminów</option>
          </select></label>
          </div>
          <div class="admin-toolbar-actions">
            <button type="button" class="button secondary icon-btn" id="hotel-res-refresh" title="Odśwież listę" aria-label="Odśwież listę">↻</button>
            <button type="button" class="button" id="hotel-res-manual-new">Utwórz rezerwację</button>
          </div>
        </div>
        <div class="table-scroll">
          <table class="hotel-table">
            <thead><tr><th>Nr</th><th>Klient</th><th>Status</th><th>Termin</th><th>Kwota</th><th>Pozostały czas</th><th></th></tr></thead>
            <tbody>${rows || "<tr><td colspan='7'>Brak</td></tr>"}</tbody>
          </table>
        </div>
      </div>`;
  }

  function renderTemplatesEditor() {
    const keys = Object.keys(templatesData || {});
    return `
      <div class="hotel-subpanel">
        <h3>Szablony mailingowe</h3>
        <p class="helper">Zmienne we wszystkich szablonach: <code>{{reservationNumber}}</code> (numer w formacie np. 12/2026/HOTEL), <code>{{reservationSubject}}</code>, <code>{{decisionDeadline}}</code>, <code>{{adminActionLink}}</code>, <code>{{fullName}}</code>, <code>{{email}}</code>, <code>{{phone}}</code>, <code>{{roomsList}}</code>, <code>{{dateFrom}}</code>, <code>{{dateTo}}</code>, <code>{{nights}}</code>, <code>{{totalPrice}}</code>, <code>{{customerNote}}</code>, <code>{{adminNote}}</code>, <code>{{confirmationLink}}</code>, <code>{{hotelName}}</code>.</p>
        <p class="helper">Logo, przycisk akcji i elegancka oprawa wiadomości są dodawane automatycznie podczas wysyłki. W edytorze zmieniasz główną treść maila wewnątrz tego layoutu.</p>
        <p class="helper">Pod każdym szablonem widzisz live preview z przykładowymi danymi gościa. Przycisk akcji pojawia się tylko tam, gdzie system realnie wysyła link. Przy szablonie potwierdzenia adresu e-mail możesz ustawić tekst na przycisku (gdy treść HTML nie zawiera osobnego linku <code>{{confirmationLink}}</code>, przycisk zostanie dodany na podstawie tego pola).</p>
        <div id="hotel-template-forms">
          ${keys
            .map(
              (k) => `
            <details class="hotel-template-card">
              <summary><span class="tpl-key">${escapeHtml(k)}</span>${HOTEL_TEMPLATE_LABELS[k] ? `<span class="tpl-desc"> — ${escapeHtml(HOTEL_TEMPLATE_LABELS[k])}</span>` : ""}</summary>
              <label>Temat<input type="text" data-tpl-key="${escapeHtml(k)}" data-field="subject" value="${escapeHtml(templatesData[k]?.subject || "")}" /></label>
              ${
                k === "confirm_email"
                  ? `<label>Tekst przycisku potwierdzenia<input type="text" data-tpl-key="${escapeHtml(k)}" data-field="actionLabel" value="${escapeHtml(templatesData[k]?.actionLabel || "")}" maxlength="200" placeholder="np. Potwierdź adres e-mail" /></label>`
                  : ""
              }
              <label>Treść HTML (edytuj poniżej)</label>
              <div class="wysiwyg-toolbar" data-toolbar-for="${escapeHtml(k)}">
                <button type="button" data-cmd="bold" title="Pogrubienie"><b>B</b></button>
                <button type="button" data-cmd="italic" title="Kursywa"><i>I</i></button>
                <button type="button" data-cmd="underline" title="Podkreślenie"><u>U</u></button>
                <button type="button" data-cmd="insertUnorderedList" title="Lista punktowana">• Lista</button>
                <button type="button" data-cmd="insertOrderedList" title="Lista numerowana">1. Lista</button>
                <button type="button" data-cmd="createLink" title="Link">🔗 Link</button>
                <button type="button" data-cmd="removeFormat" title="Wyczyść formatowanie">🧹 Wyczyść</button>
              </div>
              <div class="wysiwyg-editor" contenteditable="true" data-tpl-key="${escapeHtml(k)}" data-field="bodyHtml">${templatesData[k]?.bodyHtml || ""}</div>
              <input type="hidden" data-tpl-key="${escapeHtml(k)}" data-field="bodyHtml-hidden" value="${escapeHtml(templatesData[k]?.bodyHtml || "")}" />
              <div class="mail-preview-panel">
                <div class="mail-preview-panel-head">
                  <strong>Podgląd wiadomości</strong>
                  <span class="helper">Układ zbliżony do finalnego maila wysyłanego do klienta.</span>
                </div>
                <div class="mail-preview-render" data-hotel-preview-key="${escapeHtml(k)}"></div>
              </div>
              <button type="button" class="button hotel-save-tpl" data-key="${escapeHtml(k)}">Zapisz szablon</button>
            </details>`
            )
            .join("")}
        </div>
      </div>`;
  }

  function renderBlockForm() {
    const roomChecks = roomsData
      .map(
        (room) => `
      <label class="admin-check-line">
        <input type="checkbox" name="roomId" value="${escapeHtml(room.id)}" />
        <span>${escapeHtml(roomDisplayName(room))}</span>
      </label>`
      )
      .join("");
    const blockRows = blockListData
      .map(
        (b) => `
      <tr>
        <td>${escapeHtml(b.humanNumberLabel || b.humanNumber || b.id)}</td>
        <td>${escapeHtml(b.dateFrom)} → ${escapeHtml(b.dateTo)}</td>
        <td>${escapeHtml(roomListLabel(b.roomIds) || "—")}</td>
        <td>${escapeHtml(b.adminNote || b.customerNote || "—")}</td>
      </tr>`
      )
      .join("");
    return `
      <div class="hotel-subpanel">
        <h3>Blokada terminu</h3>
        <p class="helper">Blokada zapisuje się jako wpis ze statusem „Blokada terminu”: zajmuje wybrane pokoje w kalendarzu (goście nie mogą zarezerwować tych pokoi). To nie jest rezerwacja gościa — służy np. remontowi, pobytowi poza systemem lub pracom.</p>
        <form id="hotel-block-form" class="stack">
          <div class="field-grid">
            <label>Od (dzień przyjazdu)<input name="dateFrom" type="date" required /></label>
            <label>Do (dzień wyjazdu)<input name="dateTo" type="date" required /></label>
          </div>
          <p class="helper">Jeden dzień noclegu: ten sam dzień w obu polach albo np. przyjazd 02.03, wyjazd 03.03. Jeśli wpiszesz ten sam dzień w „Od” i „Do”, system potraktuje to jako jedną noc (wyjazd następnego dnia).</p>
          <fieldset class="admin-room-fieldset">
            <legend>Pokoje do zablokowania</legend>
            <label class="admin-check-line admin-check-all">
              <input type="checkbox" id="hotel-block-all-rooms" />
              <span>Zaznacz / odznacz wszystkie</span>
            </label>
            <div class="admin-room-checks">${roomChecks || "<p class=\"helper\">Brak pokoi — dodaj pokoje w zakładce Pokoje.</p>"}</div>
          </fieldset>
          <label>Notatka (opcjonalnie)<input name="note" placeholder="np. remont, wynajem poza systemem" /></label>
          <button type="submit" class="button">Utwórz blokadę</button>
        </form>
        <h4 class="admin-subheading">Utworzone blokady</h4>
        <div class="table-scroll">
          <table class="hotel-table">
            <thead><tr><th>Nr</th><th>Termin</th><th>Pokoje</th><th>Notatka</th></tr></thead>
            <tbody>${blockRows || "<tr><td colspan='4'>Brak blokad</td></tr>"}</tbody>
          </table>
        </div>
      </div>`;
  }

  async function renderHotelAdminPanel(container, options = {}) {
    if (!container) return;
    if (options.defaultTab) {
      hotelSubTab = options.defaultTab;
    }
    const allowedTabs = Array.isArray(options.allowedTabs) && options.allowedTabs.length
      ? options.allowedTabs.map((tab) => String(tab || "").trim()).filter(Boolean)
      : null;
    container.innerHTML = `<p class="status">Ładowanie modułu Hotel…</p>`;
    try {
      await loadRooms();
      await loadReservations("active");
      await loadTemplates();
    } catch (e) {
      container.innerHTML = `<p class="status">${escapeHtml(e.message)}</p>`;
      return;
    }

    function paint() {
      const sub = {
        rooms: renderRooms(),
        reservations: renderReservations(),
        templates: renderTemplatesEditor(),
        block: renderBlockForm(),
      };
      const availableTabs = [
        { key: "reservations", label: "Rezerwacje" },
        { key: "block", label: "Blokada terminu" },
        { key: "rooms", label: "Pokoje" },
        { key: "templates", label: "Szablony" },
      ].filter((tab) => !allowedTabs || allowedTabs.includes(tab.key));
      if (!availableTabs.length) {
        container.innerHTML = `<section class="panel col-12"><p class="status">Brak dostepnych widokow tego modulu.</p></section>`;
        return;
      }
      if (!availableTabs.some((tab) => tab.key === hotelSubTab)) {
        hotelSubTab = availableTabs[0].key;
      }
      const activeSubTab = availableTabs.find((tab) => tab.key === hotelSubTab) || availableTabs[0];
      container.innerHTML = `
        <section class="panel col-12">
          <p class="pill">Hotel</p>
          <h2>${escapeHtml(availableTabs.length === 1 ? activeSubTab.label : "Rezerwacje pokoi i pokoje")}</h2>
          ${
            availableTabs.length > 1
              ? `<div class="hotel-nav">
                  ${availableTabs
                    .map(
                      (tab) =>
                        `<button type="button" class="button ${hotelSubTab === tab.key ? "" : "secondary"}" data-hsub="${escapeHtml(tab.key)}">${escapeHtml(tab.label)}</button>`
                    )
                    .join("")}
                </div>`
              : ""
          }
          <div id="hotel-sub-content">${sub[hotelSubTab]}</div>
        </section>
      `;

      const filterSel = document.querySelector("#hotel-res-filter");
      if (filterSel) filterSel.value = hotelResFilter;

      container.querySelectorAll("[data-hsub]").forEach((b) => {
        b.addEventListener("click", async () => {
          hotelSubTab = b.getAttribute("data-hsub");
          try {
            if (hotelSubTab === "reservations") {
              await loadReservations(hotelResFilter);
            }
            if (hotelSubTab === "block") {
              await loadBlockList();
            }
          } catch (e) {
            alert(e.message);
          }
          paint();
        });
      });
      bindSub();
    }

    function bindSub() {
      if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
      }
      document.querySelectorAll(".hotel-edit-room").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-id");
          const found = roomsData.find((x) => x.id === id);
          if (found) openRoomEditorModal(found);
        });
      });
      document.querySelectorAll(".hotel-move-room").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            await moveRoom(Number(btn.getAttribute("data-index")), Number(btn.getAttribute("data-direction")));
            hotelSubTab = "rooms";
            paint();
          } catch (error) {
            alert(error.message || "Nie udalo sie zmienic kolejnosci pokojow.");
          }
        });
      });
      document.querySelector("#hotel-add-room")?.addEventListener("click", () => openRoomEditorModal(null));
      document.querySelectorAll(".hotel-delete-room").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.getAttribute("data-id");
          const name = btn.getAttribute("data-name") || id;
          if (!confirm(`Usunąć pokój „${name}”? Nie można tego cofnąć.`)) return;
          try {
            await hotelApi("admin-room-delete", {
              method: "POST",
              body: { id },
            });
            await loadRooms();
            hotelSubTab = "rooms";
            paint();
          } catch (e) {
            alert(e.message);
          }
        });
      });
      const filter = document.querySelector("#hotel-res-filter");
      if (filter) {
        filter.addEventListener("change", async () => {
          hotelResFilter = filter.value;
          await loadReservations(hotelResFilter);
          document.querySelector("#hotel-sub-content").innerHTML = renderReservations();
          const fs = document.querySelector("#hotel-res-filter");
          if (fs) fs.value = hotelResFilter;
          bindSub();
        });
      }
      document.querySelector("#hotel-res-manual-new")?.addEventListener("click", () => openManualReservationModal());
      document.querySelector("#hotel-res-refresh")?.addEventListener("click", async () => {
        await loadReservations(hotelResFilter);
        document.querySelector("#hotel-sub-content").innerHTML = renderReservations();
        const fs = document.querySelector("#hotel-res-filter");
        if (fs) fs.value = hotelResFilter;
        bindSub();
      });
      document.querySelectorAll(".hotel-res-edit").forEach((btn) => {
        btn.addEventListener("click", () => openReservationEditorModal(btn.getAttribute("data-id")));
      });
      document.querySelectorAll(".hotel-res-cancel").forEach((btn) => {
        btn.addEventListener("click", () => quickCancelReservation(btn.getAttribute("data-id")));
      });
      document.querySelectorAll(".hotel-save-tpl").forEach((btn) => {
        btn.addEventListener("click", () => saveTemplate(btn.getAttribute("data-key")));
      });
      bindHotelTemplatePreviews();
      bindWysiwygEditors();
      document.querySelector("#hotel-block-all-rooms")?.addEventListener("change", (ev) => {
        const on = ev.target.checked;
        document.querySelectorAll('#hotel-block-form input[name="roomId"]').forEach((cb) => {
          cb.checked = on;
        });
      });
      document.querySelector("#hotel-block-form")?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.target);
        const roomIds = Array.from(ev.target.querySelectorAll('input[name="roomId"]:checked')).map((cb) => cb.value);
        if (!roomIds.length) {
          alert("Zaznacz co najmniej jeden pokój.");
          return;
        }
        try {
          await hotelApi("admin-manual-block", {
            method: "POST",
            body: {
              dateFrom: fd.get("dateFrom"),
              dateTo: fd.get("dateTo"),
              roomIds,
              note: fd.get("note"),
            },
          });
          alert("Blokada utworzona.");
          ev.target.reset();
          await loadBlockList();
          hotelSubTab = "block";
          paint();
        } catch (e) {
          alert(e.message);
        }
      });

      countdownTimer = setInterval(() => {
        document.querySelectorAll(".hotel-countdown").forEach((el) => {
          const st = el.getAttribute("data-status");
          const p = Number(el.getAttribute("data-pending"));
          const e = Number(el.getAttribute("data-email-exp"));
          if (st === "pending" && p) {
            el.textContent = countdown(p);
          } else if (st === "email_verification_pending" && e) {
            el.textContent = countdown(e);
          }
        });
      }, 1000);
    }

    function openRoomEditorModal(roomOrNull) {
      const isNew = !roomOrNull;
      const r = roomOrNull || {
        id: "",
        name: "",
        pricePerNight: "",
        maxGuests: 2,
        bedsSingle: 0,
        bedsDouble: 1,
        bedsChild: 0,
        description: "",
        imageUrls: [],
        active: true,
        sortOrder: roomsData.length,
      };

      closeHotelRoomModal();

      const host = document.createElement("div");
      host.id = "hotel-room-editor-mount";
      host.innerHTML = `
        <div class="admin-modal-overlay" data-hotel-room-modal-overlay>
          <section class="admin-modal menu-editor-modal hotel-room-editor-modal" role="dialog" aria-modal="true" aria-labelledby="hotel-room-editor-title">
            <form id="hotel-room-editor-form" class="stack">
              <div class="admin-modal-head menu-editor-modal-head">
                <div class="menu-editor-modal-title">
                  <p class="pill">Hotel — pokoje</p>
                  <h3 id="hotel-room-editor-title">${isNew ? "Nowy pokój" : "Edycja pokoju"}</h3>
                  <p class="helper">${
                    isNew
                      ? "ID pokoju zapisze sie tak samo jak wpisana nazwa. To pozwala pracowac na czytelnych nazwach bez technicznego slugowania."
                      : `ID pokoju jest powiazane z istniejacymi rezerwacjami, dlatego dla bezpieczenstwa pozostaje bez zmian: ${escapeHtml(r.id)}`
                  }</p>
                </div>
                <button type="button" class="button secondary" data-hotel-room-modal-close>Zamknij</button>
              </div>
              <p class="status hotel-room-editor-msg" id="hotel-room-editor-msg" hidden></p>
              <div class="field-grid">
                <label class="field-full">
                  <span>ID pokoju</span>
                  <input name="id" value="${escapeHtml(r.id)}" readonly required />
                </label>
                <label class="field-full">
                  <span>Nazwa pokoju</span>
                  <input name="name" value="${escapeHtml(r.name || "")}" required placeholder="np. Pokój dwuosobowy" />
                </label>
                <label class="field">
                  <span>Cena za noc (PLN)</span>
                  <input name="pricePerNight" type="number" step="0.01" min="0" value="${escapeHtml(String(r.pricePerNight ?? ""))}" required />
                </label>
                <label class="field">
                  <span>Maks. gości</span>
                  <input name="maxGuests" type="number" min="1" step="1" value="${escapeHtml(String(r.maxGuests ?? 2))}" required />
                </label>
                <div class="field-full hotel-room-editor-compact-grid">
                  <label class="field">
                    <span>Łóżka 1-os.</span>
                    <input name="bedsSingle" type="number" min="0" step="1" value="${escapeHtml(String(r.bedsSingle ?? 0))}" />
                  </label>
                  <label class="field">
                    <span>Łóżka 2-os.</span>
                    <input name="bedsDouble" type="number" min="0" step="1" value="${escapeHtml(String(r.bedsDouble ?? 0))}" />
                  </label>
                  <label class="field">
                    <span>Łóżka dziecięce</span>
                    <input name="bedsChild" type="number" min="0" step="1" value="${escapeHtml(String(r.bedsChild ?? 0))}" />
                  </label>
                </div>
                <label class="field-full">
                  <span>Opis (strona / rezerwacja)</span>
                  <textarea name="description" rows="4" placeholder="Krótki opis pokoju">${escapeHtml(r.description || "")}</textarea>
                </label>
                <label class="field-full hotel-room-editor-check">
                  <input name="active" type="checkbox" ${r.active !== false ? "checked" : ""} />
                  <span>Pokój aktywny (widoczny przy wyszukiwaniu terminów)</span>
                </label>
              </div>
              <div class="admin-modal-footer hotel-room-editor-footer">
                <button type="button" class="button secondary" data-hotel-room-modal-close>Anuluj</button>
                <button type="submit" class="button">Zapisz</button>
              </div>
            </form>
          </section>
        </div>
      `;

      document.body.appendChild(host);
      document.body.classList.add("admin-modal-open");

      const overlay = host.querySelector("[data-hotel-room-modal-overlay]");
      const idInput = host.querySelector('input[name="id"]');
      const nameInput = host.querySelector('input[name="name"]');
      const showMsg = (text, isError) => {
        const el = host.querySelector("#hotel-room-editor-msg");
        if (!el) return;
        el.hidden = !text;
        el.textContent = text || "";
        el.style.color = isError ? "var(--danger, #c44)" : "";
      };

      overlay?.addEventListener("click", (ev) => {
        if (ev.target === overlay) closeHotelRoomModal();
      });
      host.querySelectorAll("[data-hotel-room-modal-close]").forEach((b) => {
        b.addEventListener("click", () => closeHotelRoomModal());
      });

      hotelRoomModalKeydownHandler = (ev) => {
        if (ev.key === "Escape") {
          ev.preventDefault();
          closeHotelRoomModal();
        }
      };
      document.addEventListener("keydown", hotelRoomModalKeydownHandler);

      const syncIdFromName = () => {
        if (!isNew || !idInput || !nameInput) return;
        idInput.value = String(nameInput.value || "")
          .trim()
          .replace(/\s+/g, " ");
      };
      syncIdFromName();
      nameInput?.addEventListener("input", syncIdFromName);

      host.querySelector("#hotel-room-editor-form")?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        showMsg("", false);
        const fd = new FormData(ev.target);
        const id = String(fd.get("id") || "").trim();
        if (!id) {
          showMsg("Podaj nazwe pokoju.", true);
          return;
        }
        if (id.includes("__")) {
          showMsg('Nazwa pokoju nie moze zawierac ciagu "__".', true);
          return;
        }
        if (
          isNew &&
          roomsData.some((x) => normalizeRoomIdentity(x.id) === normalizeRoomIdentity(id) || normalizeRoomIdentity(x.name) === normalizeRoomIdentity(id))
        ) {
          showMsg("Pokoj o takiej nazwie juz istnieje. Uzyj innej nazwy albo edytuj istniejacy wpis.", true);
          return;
        }
        const pricePerNight = Number(fd.get("pricePerNight"));
        if (!Number.isFinite(pricePerNight) || pricePerNight < 0) {
          showMsg("Niepoprawna cena.", true);
          return;
        }
        try {
          await hotelApi("admin-room-upsert", {
            method: "PUT",
            body: {
              id,
              name: String(fd.get("name") || "").trim(),
              pricePerNight,
              maxGuests: Math.max(1, toInt(fd.get("maxGuests"))),
              bedsSingle: toInt(fd.get("bedsSingle")),
              bedsDouble: toInt(fd.get("bedsDouble")),
              bedsChild: toInt(fd.get("bedsChild")),
              description: String(fd.get("description") || "").trim(),
              imageUrls: Array.isArray(r.imageUrls) ? r.imageUrls : [],
              active: fd.get("active") === "on",
              sortOrder: Number.isFinite(Number(r.sortOrder)) ? Number(r.sortOrder) : roomsData.length,
            },
          });
          closeHotelRoomModal();
          await loadRooms();
          hotelSubTab = "rooms";
          paint();
        } catch (e) {
          showMsg(e.message || "Błąd zapisu.", true);
        }
      });
    }

    async function saveTemplate(key) {
      const subj = document.querySelector(`[data-tpl-key="${key}"][data-field="subject"]`);
      const bodyHidden = document.querySelector(`[data-tpl-key="${key}"][data-field="bodyHtml-hidden"]`);
      const originalBodyHtml = templatesData[key]?.bodyHtml || "";
      const newBodyHtml = bodyHidden?.value || "";
      const originalVars = [...originalBodyHtml.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)].map((m) => m[1]);
      const missing = originalVars.filter((v) => !newBodyHtml.includes(`{{${v}}}`));
      if (missing.length) {
        alert(
          `Nie można zapisać — w treści brakuje zmiennych:\n${missing.map((v) => `{{${v}}}`).join(", ")}\n\nPrzywróć je i spróbuj ponownie.`
        );
        return;
      }
      try {
        await hotelApi("admin-mail-template-save", {
          method: "PUT",
          body: {
            key,
            subject: subj?.value || "",
            bodyHtml: newBodyHtml,
            actionLabel: document.querySelector(`[data-tpl-key="${key}"][data-field="actionLabel"]`)?.value ?? "",
          },
        });
        alert("Zapisano.");
        await loadTemplates();
      } catch (e) {
        alert(e.message);
      }
    }

    function closeHotelExtraModal() {
      document.getElementById("hotel-extra-modal-mount")?.remove();
      document.body.classList.remove("admin-modal-open");
    }

    async function quickCancelReservation(id) {
      const cancelReason = window.prompt("Podaj powód anulowania rezerwacji:");
      if (cancelReason == null) return;
      if (!String(cancelReason).trim()) {
        alert("Powód anulowania jest wymagany.");
        return;
      }
      try {
        await hotelApi("admin-reservation-cancel", { method: "POST", body: { id, cancelReason } });
        await loadReservations(hotelResFilter);
        document.querySelector("#hotel-sub-content").innerHTML = renderReservations();
        const fs = document.querySelector("#hotel-res-filter");
        if (fs) fs.value = hotelResFilter;
        bindSub();
      } catch (e) {
        alert(e.message);
      }
    }

    function openManualReservationModal() {
      closeHotelExtraModal();
      const roomChecks = roomsData
        .map(
          (room) => `
        <label class="admin-check-line">
          <input type="checkbox" name="roomId" value="${escapeHtml(room.id)}" />
          <span>${escapeHtml(room.name || room.id)}</span>
        </label>`
        )
        .join("");
      const host = document.createElement("div");
      host.id = "hotel-extra-modal-mount";
      host.innerHTML = `
        <div class="admin-modal-overlay" data-hotel-extra-overlay>
          <section class="admin-modal menu-editor-modal hotel-room-editor-modal" role="dialog" aria-modal="true">
            <form id="hotel-manual-res-form" class="stack">
              <div class="admin-modal-head menu-editor-modal-head">
                <h3>Utwórz rezerwację</h3>
                <button type="button" class="button secondary" data-hotel-extra-close>Zamknij</button>
              </div>
              <p class="helper">Rezerwacja wprowadzona ręcznie jest od razu <strong>zarezerwowana</strong> (bez e-maila z linkiem potwierdzającym). Możesz zaznaczyć opcję oczekiwania na akceptację poniżej.</p>
              <div class="field-grid">
                <label>Przyjazd<input name="dateFrom" type="date" required /></label>
                <label>Wyjazd<input name="dateTo" type="date" required /></label>
              </div>
              <fieldset class="admin-room-fieldset"><legend>Pokoje</legend>
              <label class="admin-check-line admin-check-all"><input type="checkbox" id="hotel-manual-all-rooms" /><span>Zaznacz / odznacz wszystkie</span></label>
              <div class="admin-room-checks">${roomChecks || "<p class=\"helper\">Brak pokoi w systemie.</p>"}</div></fieldset>
              <label>Imię i nazwisko<input name="fullName" required /></label>
              <label>E-mail<input name="email" type="email" /></label>
              <div class="field-grid">
                <label>Prefiks<input name="phonePrefix" value="+48" /></label>
                <label>Numer telefonu<input name="phoneNational" inputmode="numeric" /></label>
              </div>
              <label>Uwagi klienta<textarea name="customerNote" rows="3"></textarea></label>
              <label class="admin-check-line"><input type="checkbox" name="asPending" /> <span>Oczekuje na akceptację (status „oczekujące”) zamiast od razu „zarezerwowane”</span></label>
              <div class="admin-modal-footer hotel-room-editor-footer">
                <button type="button" class="button secondary" data-hotel-extra-close>Anuluj</button>
                <button type="submit" class="button">Utwórz</button>
              </div>
            </form>
          </section>
        </div>`;
      document.body.appendChild(host);
      document.body.classList.add("admin-modal-open");
      host.querySelector("#hotel-manual-all-rooms")?.addEventListener("change", (ev) => {
        const on = ev.target.checked;
        host.querySelectorAll('#hotel-manual-res-form input[name="roomId"]').forEach((cb) => {
          cb.checked = on;
        });
      });
      host.querySelectorAll("[data-hotel-extra-close]").forEach((b) => b.addEventListener("click", closeHotelExtraModal));
      host.querySelector("[data-hotel-extra-overlay]")?.addEventListener("click", (ev) => {
        if (ev.target === ev.currentTarget) closeHotelExtraModal();
      });
      host.querySelector("#hotel-manual-res-form")?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.target);
        const roomIds = Array.from(ev.target.querySelectorAll('input[name="roomId"]:checked')).map((cb) => cb.value);
        if (!roomIds.length) {
          alert("Wybierz co najmniej jeden pokój.");
          return;
        }
        const status = fd.get("asPending") === "on" ? "pending" : "confirmed";
        try {
          await hotelApi("admin-reservation-create", {
            method: "POST",
            body: {
              dateFrom: fd.get("dateFrom"),
              dateTo: fd.get("dateTo"),
              roomIds,
              fullName: fd.get("fullName"),
              email: String(fd.get("email") || "").trim(),
              phonePrefix: String(fd.get("phoneNational") || "").trim() ? String(fd.get("phonePrefix") || "+48").trim() : "",
              phoneNational: String(fd.get("phoneNational") || "").trim(),
              customerNote: fd.get("customerNote") || "",
              adminNote: "",
              status,
            },
          });
          closeHotelExtraModal();
          await loadReservations(hotelResFilter);
          hotelSubTab = "reservations";
          paint();
        } catch (e) {
          alert(e.message);
        }
      });
    }

    async function openReservationEditorModal(id) {
      const base = hotelApiBase();
      const token = await firebase.auth().currentUser.getIdToken();
      const res = await fetch(`${base}?op=admin-reservation-get&id=${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await res.json();
      if (!res.ok) {
        alert(d.error || "Błąd");
        return;
      }
      const r = d.reservation;
      const reservationNumber = r.humanNumberLabel || r.humanNumber || r.id || "—";
      closeHotelExtraModal();
      const roomChecks = roomsData
        .map((room) => {
          const on = (r.roomIds || []).includes(room.id);
          return `
        <label class="admin-check-line">
          <input type="checkbox" name="roomId" value="${escapeHtml(room.id)}" ${on ? "checked" : ""} />
          <span>${escapeHtml(room.name || room.id)}</span>
        </label>`;
        })
        .join("");
      const host = document.createElement("div");
      host.id = "hotel-extra-modal-mount";
      host.innerHTML = `
        <div class="admin-modal-overlay" data-hotel-extra-overlay>
          <section class="admin-modal menu-editor-modal hotel-room-editor-modal" role="dialog" aria-modal="true">
            <form id="hotel-res-edit-form" class="stack">
              <div class="admin-modal-head menu-editor-modal-head">
                <div>
                  <p class="pill">Rezerwacja ${escapeHtml(reservationNumber)}</p>
                  <h3>Edycja rezerwacji</h3>
                  <p class="helper">Status: ${escapeHtml(r.statusLabel || r.status)}</p>
                </div>
                <button type="button" class="button secondary" data-hotel-extra-close>Zamknij</button>
              </div>
              <div class="field-grid">
                <label>Przyjazd<input name="dateFrom" type="date" value="${escapeHtml(r.dateFrom)}" required /></label>
                <label>Wyjazd<input name="dateTo" type="date" value="${escapeHtml(r.dateTo)}" required /></label>
              </div>
              <fieldset class="admin-room-fieldset"><legend>Pokoje</legend>
              <div class="admin-room-checks">${roomChecks || ""}</div></fieldset>
              <label>Imię i nazwisko<input name="fullName" value="${escapeHtml(r.customerName || "")}" required /></label>
              <label>E-mail<input name="email" type="email" value="${escapeHtml(r.email || "")}" required /></label>
              <div class="field-grid">
                <label>Prefiks<input name="phonePrefix" value="${escapeHtml(r.phonePrefix || "+48")}" /></label>
                <label>Numer<input name="phoneNational" value="${escapeHtml(r.phoneNational || "")}" required /></label>
              </div>
              <label>Uwagi klienta<textarea name="customerNote" rows="3">${escapeHtml(r.customerNote || "")}</textarea></label>
              <label>Notatka wewnętrzna<textarea name="adminNote" rows="2">${escapeHtml(r.adminNote || "")}</textarea></label>
              <div class="admin-modal-footer hotel-room-editor-footer" style="flex-wrap:wrap;gap:0.5rem">
                <button type="button" class="button secondary" data-hotel-extra-close>Anuluj</button>
                ${r.status === "pending" ? `<button type="button" class="button secondary" id="hotel-res-confirm-quick">Potwierdź (zarezerwowane)</button>` : ""}
                <button type="submit" class="button">Zapisz zmiany</button>
              </div>
            </form>
          </section>
        </div>`;
      document.body.appendChild(host);
      document.body.classList.add("admin-modal-open");
      host.querySelectorAll("[data-hotel-extra-close]").forEach((b) => b.addEventListener("click", closeHotelExtraModal));
      host.querySelector("[data-hotel-extra-overlay]")?.addEventListener("click", (ev) => {
        if (ev.target === ev.currentTarget) closeHotelExtraModal();
      });
      host.querySelector("#hotel-res-confirm-quick")?.addEventListener("click", async () => {
        if (!confirm("Potwierdzić rezerwację i wysłać e-mail do klienta?")) return;
        try {
          await hotelApi("admin-reservation-confirm", { method: "POST", body: { id } });
          closeHotelExtraModal();
          await loadReservations(hotelResFilter);
          document.querySelector("#hotel-sub-content").innerHTML = renderReservations();
          const fs = document.querySelector("#hotel-res-filter");
          if (fs) fs.value = hotelResFilter;
          bindSub();
        } catch (e) {
          alert(e.message);
        }
      });
      host.querySelector("#hotel-res-edit-form")?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.target);
        const roomIds = Array.from(ev.target.querySelectorAll('input[name="roomId"]:checked')).map((cb) => cb.value);
        if (!roomIds.length) {
          alert("Wybierz co najmniej jeden pokój.");
          return;
        }
        const notifyClient = confirm(
          "Wysłać do klienta e-mail o zmianie rezerwacji?\n\nOK — tak, wyślij\nAnuluj — nie, tylko zapisz w systemie"
        );
        try {
          await hotelApi("admin-reservation-update", {
            method: "PATCH",
            body: {
              id,
              dateFrom: fd.get("dateFrom"),
              dateTo: fd.get("dateTo"),
              roomIds,
              fullName: fd.get("fullName"),
              email: fd.get("email"),
              phonePrefix: fd.get("phonePrefix") || "+48",
              phoneNational: fd.get("phoneNational"),
              customerNote: fd.get("customerNote") || "",
              adminNote: fd.get("adminNote") || "",
              notifyClient,
            },
          });
          closeHotelExtraModal();
          await loadReservations(hotelResFilter);
          document.querySelector("#hotel-sub-content").innerHTML = renderReservations();
          const fs = document.querySelector("#hotel-res-filter");
          if (fs) fs.value = hotelResFilter;
          bindSub();
        } catch (e) {
          alert(e.message);
        }
      });
    }

    paint();
  }

  window.renderHotelAdminPanel = renderHotelAdminPanel;
})();
