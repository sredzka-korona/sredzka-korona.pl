/**
 * Panel admina — moduł Catering / restauracja (restaurantApi).
 */
(function () {
  const config = window.SREDZKA_CONFIG || {};
  const CATERING_CREATE_DEFAULT_DURATION_HOURS = 1;

  function restaurantApiBase() {
    if (config.apiBase) {
      return `${String(config.apiBase).replace(/\/$/, "")}/api/admin/legacy-bookings/restaurant`;
    }
    if (config.restaurantApiBase) {
      return String(config.restaurantApiBase).replace(/\/$/, "");
    }
    if (config.firebaseProjectId) {
      return `https://europe-west1-${config.firebaseProjectId}.cloudfunctions.net/restaurantApi`;
    }
    return "";
  }

  function restaurantDirectApiBase() {
    if (config.restaurantApiBase) {
      return String(config.restaurantApiBase).replace(/\/$/, "");
    }
    if (config.firebaseProjectId) {
      return `https://europe-west1-${config.firebaseProjectId}.cloudfunctions.net/restaurantApi`;
    }
    return "";
  }

  async function performRestaurantApiRequest(base, token, op, options = {}) {
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
        "X-Booking-Op": op,
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
        data = { _nonJson: raw.slice(0, 400) };
      }
    }
    return { res, data };
  }

  function shouldRetryRestaurantViaDirectApi(base, directBase, res, data) {
    if (!base || !directBase || base === directBase) return false;
    if (String(base).includes("/legacy-bookings/")) return false;
    if (res.ok) return false;
    if (res.status !== 404) return false;
    const nonJson = String(data?._nonJson || "");
    return /404|page not found|requested url was not found/i.test(nonJson);
  }

  async function restaurantApi(op, options = {}) {
    const base = restaurantApiBase();
    if (!base) {
      throw new Error("Brak restaurantApiBase / firebaseProjectId.");
    }
    if (typeof firebase === "undefined" || !firebase.auth()?.currentUser) {
      throw new Error("Brak sesji Firebase.");
    }
    const token = await firebase.auth().currentUser.getIdToken();
    let { res, data } = await performRestaurantApiRequest(base, token, op, options);
    const directBase = restaurantDirectApiBase();
    if (shouldRetryRestaurantViaDirectApi(base, directBase, res, data)) {
      ({ res, data } = await performRestaurantApiRequest(directBase, token, op, options));
    }
    if (!res.ok) {
      let hint =
        data.error ||
        data.message ||
        (data._nonJson ? `Odpowiedź serwera (${res.status}): ${data._nonJson}` : "");
      const raw = String(data._nonJson || "");
      if (
        res.status === 404 &&
        /page not found|requested url was not found/i.test(raw) &&
        !hint.includes("LEGACY_FIREBASE")
      ) {
        hint +=
          " To jest typowa odpowiedź Google (Firebase), gdy wywołano zły URL albo funkcja restaurantApi nie jest wdrożona. " +
          "Używaj apiBase = adres Workera (https://api.sredzka-korona.pl), nie cloudfunctions.net. Na Workerze z D1 wyłącz LEGACY_FIREBASE_BOOKINGS_PROXY.";
      }
      throw new Error(hint || `Błąd API cateringu (HTTP ${res.status}).`);
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

  function formatMs(ms) {
    if (!ms) return "—";
    return new Date(ms).toLocaleString("pl-PL");
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

  function canCancelReservationStatus(status) {
    return ["pending", "confirmed", "email_verification_pending"].includes(String(status || "").trim().toLowerCase());
  }

  function parseTimeToMinutes(value) {
    const match = String(value || "").trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  let restSubTab = "deliveries";
  let restTemplateKeyFilter = null;
  let restResFilter = "active";
  let reservationsData = [];
  let recipientsData = [];
  let templatesData = {};
  let countdownTimer = null;

  const REST_TEMPLATE_LABELS = {
    restaurant_confirm_email: "Odbiorca — potwierdzenie e-mail (przy ewentualnym publicznym zgłoszeniu).",
    rest_confirm_email: "To samo (alternatywny klucz szablonu).",
    restaurant_pending_admin: "Obsługa — nowe zgłoszenie dostawy cateringu.",
    rest_pending_admin: "To samo — wariant skrócony.",
    restaurant_confirmed_client:
      "Mail do odbiorcy po utworzeniu dostawy / potwierdzeniu — ten sam szablon co przy wysyłce z grafiku (termin, cykl, odbiorca: {{cateringWhenHtml}} itd.).",
    rest_confirmed_client: "Kopia techniczna — synchronizowana z powyższym przy zapisie; w wysyłce używany jest klucz restaurant_confirmed_client.",
    restaurant_cancelled_client: "Odbiorca — anulowana dostawa (opcjonalnie; osobny szablon).",
    rest_cancelled_client: "To samo — wariant skrócony.",
    restaurant_changed_client: "(Nieużywane — edycja nie wysyła maila do odbiorcy.)",
    rest_changed_client: "(Nieużywane.)",
    restaurant_expired_pending_client: "Odbiorca — wygasłe oczekiwanie na decyzję.",
    restaurant_expired_pending_admin: "Obsługa — automatyczne wygaśnięcie zgłoszenia.",
    restaurant_expired_email_client: "Odbiorca — niepotwierdzony e-mail w 2 godziny.",
  };

  const REST_TEMPLATE_PREVIEW_VARS = Object.freeze({
    reservationNumber: "firma-przyklad/CATERING/2026",
    reservationSubject: "Dostawa cateringu",
    decisionDeadline: "6 maja 2026, godz. 16:00",
    fullName: "Marek Nowak",
    email: "marek.nowak@example.com",
    phone: "+48 601 222 333",
    date: "8 maja 2026",
    timeFrom: "19:00",
    timeTo: "22:00",
    durationHours: "3",
    tablesList: "—",
    guestsCount: "6",
    customerNote: "Zestaw lunchowy dla 12 osób, bez orzechów.",
    confirmationLink: "https://www.sredzkakorona.pl/restauracja/potwierdzenie?token=podglad",
    restaurantName: "Średzka Korona — Catering",
  });

  const REST_CATERING_TEMPLATE_PREVIEW_EXTRA = Object.freeze({
    cateringWhenHtml:
      '<table role="presentation" width="100%"><tr><td style="padding:8px 0;"><strong>Termin (przykład):</strong> pierwsza data 2026-05-08, godz. 12:00</td></tr></table>',
    cateringCycleHtml:
      '<table role="presentation" width="100%"><tr><td style="padding:8px 0;"><strong>Cykl:</strong> np. jednorazowo lub co tydzień do 2026-12-31</td></tr></table>',
    cateringRecipientHtml:
      '<table role="presentation" width="100%"><tr><td style="padding:8px 0;"><strong>Odbiorca:</strong> Przykładowa firma · kontakt@example.com</td></tr></table>',
    cateringDescriptionHtml: "",
    cateringWhenPlain: "Pierwsza data: 2026-05-08, godzina: 12:00 | Cykl: Dostawa jednorazowa (bez powtarzania).",
  });

  function renderTemplatePreviewString(template, vars) {
    const rawHtmlKeys = new Set([
      "cateringWhenHtml",
      "cateringCycleHtml",
      "cateringRecipientHtml",
      "cateringDescriptionHtml",
    ]);
    return String(template || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
      const value = vars?.[key];
      if (value === undefined || value === null) return "";
      if (rawHtmlKeys.has(key)) return String(value);
      return escapeHtml(String(value));
    });
  }

  function sanitizeTemplatePreviewHtml(html) {
    return String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, "")
      .replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, ' $1="#"');
  }

  function restaurantMailHeaderContext(key) {
    const k = String(key || "")
      .replace(/^restaurant_/i, "")
      .replace(/^rest_/i, "");
    const map = {
      confirm_email: "Potwierdzenie — dostawa cateringu",
      pending_admin: "Catering — powiadomienie dla obsługi",
      confirmed_client: "Przyjęcie rezerwacji dostawy cateringu (jedyny mail z blokami termin/cykl/odbiorca)",
      cancelled_client: "Anulowanie dostawy cateringu",
      changed_client: "Szablon zmiany (niewysyłany do odbiorcy)",
      expired_pending_client: "Wygasłe zgłoszenie cateringu",
      expired_pending_admin: "Catering — informacja dla obsługi",
      expired_email_client: "Wygasłe potwierdzenie — catering",
    };
    return map[k] || "Wiadomość — catering";
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

  function isRestaurantConfirmTemplateKey(key) {
    return key === "restaurant_confirm_email" || key === "rest_confirm_email";
  }

  function restaurantPreviewActionLabel(key) {
    if (key === "restaurant_confirmed_client" || key === "rest_confirmed_client") return "";
    if (!isRestaurantConfirmTemplateKey(key)) return "";
    const el = document.querySelector(`[data-rest-tpl-key="${key}"][data-field="actionLabel"]`);
    const v = el && String(el.value || "").trim();
    return v || "Potwierdź adres e-mail";
  }

  function updateRestaurantTemplatePreview(key) {
    if (!key) return;
    const subjectField = document.querySelector(`[data-rest-tpl-key="${key}"][data-field="subject"]`);
    const editor = document.querySelector(`.wysiwyg-editor[data-rest-tpl-key="${key}"]`);
    const hidden = document.querySelector(`[data-rest-tpl-key="${key}"][data-field="bodyHtml-hidden"]`);
    const previewHost = document.querySelector(`[data-rest-preview-key="${key}"]`);
    if (!subjectField || !previewHost) return;
    const bodyHtml = editor?.innerHTML || hidden?.value || "";
    const useCateringBlocksPreview =
      String(key || "").startsWith("catering_") ||
      key === "restaurant_confirmed_client" ||
      key === "rest_confirmed_client";
    const previewVars =
      useCateringBlocksPreview ?
        { ...REST_TEMPLATE_PREVIEW_VARS, ...REST_CATERING_TEMPLATE_PREVIEW_EXTRA }
      : REST_TEMPLATE_PREVIEW_VARS;
    const renderedSubject = renderTemplatePreviewString(subjectField.value, previewVars);
    const renderedBody = sanitizeTemplatePreviewHtml(renderTemplatePreviewString(bodyHtml, previewVars));
    previewHost.innerHTML = buildMailPreviewMarkup({
      inboxSubject: renderedSubject,
      headerContext: restaurantMailHeaderContext(key),
      headerNumber: REST_TEMPLATE_PREVIEW_VARS.reservationNumber,
      bodyHtml: renderedBody,
      footerLabel: "Catering Średzka Korona",
      actionLabel: restaurantPreviewActionLabel(key),
    });
  }

  function bindRestaurantTemplatePreviews() {
    const keys = new Set();
    document.querySelectorAll("[data-rest-tpl-key][data-field]").forEach((field) => {
      const key = field.getAttribute("data-rest-tpl-key");
      if (!key) return;
      keys.add(key);
      field.addEventListener("input", () => updateRestaurantTemplatePreview(key));
    });
    keys.forEach((key) => updateRestaurantTemplatePreview(key));
  }

  function bindWysiwygEditors() {
    document.querySelectorAll(".wysiwyg-toolbar button[data-cmd]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const cmd = btn.getAttribute("data-cmd");
        const toolbar = btn.closest(".wysiwyg-toolbar");
        const tplKey = toolbar?.getAttribute("data-toolbar-for");
        const editor = document.querySelector(`.wysiwyg-editor[data-rest-tpl-key="${tplKey}"]`);
        if (!editor) return;
        editor.focus();
        if (cmd === "createLink") {
          const url = prompt("Podaj adres URL:", "https://");
          if (url) document.execCommand(cmd, false, url);
        } else {
          document.execCommand(cmd, false, null);
        }
        updateWysiwygHiddenInput(tplKey);
        updateRestaurantTemplatePreview(tplKey);
      });
    });

    document.querySelectorAll(".wysiwyg-editor[contenteditable]").forEach((editor) => {
      const tplKey = editor.getAttribute("data-rest-tpl-key");
      editor.addEventListener("input", () => {
        updateWysiwygHiddenInput(tplKey);
        updateRestaurantTemplatePreview(tplKey);
      });
    });
  }

  function updateWysiwygHiddenInput(tplKey) {
    const editor = document.querySelector(`.wysiwyg-editor[data-rest-tpl-key="${tplKey}"]`);
    const hidden = document.querySelector(`[data-rest-tpl-key="${tplKey}"][data-field="bodyHtml-hidden"]`);
    if (editor && hidden) {
      hidden.value = editor.innerHTML;
    }
  }

  async function loadCateringRecipients() {
    const d = await restaurantApi("admin-catering-recipients-list", { method: "GET" });
    recipientsData = d.recipients || [];
  }

  async function loadReservations(status) {
    const mode = status && String(status).length ? status : "active";
    const q = `&status=${encodeURIComponent(mode)}`;
    const base = restaurantApiBase();
    const token = await firebase.auth().currentUser.getIdToken();
    const res = await fetch(`${base}?op=admin-reservations-list${q}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || "Błąd");
    reservationsData = d.reservations || [];
  }

  async function loadTemplates() {
    const d = await restaurantApi("admin-mail-templates", { method: "GET" });
    templatesData = d.templates || {};
  }

  function renderDeliveries() {
    const rows = reservationsData
      .map((r) => {
        const recipientLabel =
          r.recipient && typeof r.recipient === "object" ? r.recipient.displayName || r.recipient.id || "—" : "—";
        return `
      <tr>
        <td>${escapeHtml(r.humanNumberLabel || r.humanNumber || r.id)}</td>
        <td>${escapeHtml(recipientLabel)}</td>
        <td>${escapeHtml(r.reservationDate || "")}</td>
        <td>${formatMs(r.startDateTime)}</td>
        <td>${formatMs(r.endDateTime)}</td>
        <td>${escapeHtml(String(r.durationHours ?? ""))}</td>
        <td class="rest-cell-note">${escapeHtml((r.customerNote || "").slice(0, 80))}${(r.customerNote || "").length > 80 ? "…" : ""}</td>
        <td>${escapeHtml(r.email || "")}</td>
        <td>${escapeHtml(r.phone || "")}</td>
        <td class="rest-countdown" data-pending="${r.pendingExpiresAt || ""}" data-email-exp="${r.emailVerificationExpiresAt || ""}" data-status="${escapeHtml(r.status)}">${r.status === "pending" ? countdown(r.pendingExpiresAt) : r.status === "email_verification_pending" ? countdown(r.emailVerificationExpiresAt) : "—"}</td>
        <td>${escapeHtml(r.statusLabel || r.status)}</td>
        <td>${formatMs(r.createdAtMs)}</td>
        <td class="admin-row-actions">
          <button type="button" class="button secondary rest-res-edit" data-id="${escapeHtml(r.id)}">Edytuj</button>
          ${
            canCancelReservationStatus(r.status)
              ? `<button type="button" class="button secondary danger-muted rest-res-cancel" data-id="${escapeHtml(r.id)}">Anuluj</button>`
              : ""
          }
        </td>
      </tr>`;
      })
      .join("");
    return `
      <div class="hotel-subpanel">
        <h3>Terminy dostaw cateringu</h3>
        <p class="helper">Lista pokazuje wyłącznie <strong>dostawy</strong> (wpisy z odbiorcą). Planowanie serii i powtórzeń — w <strong>Grafiku</strong> (nowy wpis → Catering). Odbiorców edytujesz w zakładce Catering → Odbiorcy.</p>
        <div class="admin-toolbar-row hotel-filters">
          <div class="admin-toolbar-filters">
            <label>Status <select id="rest-res-filter">
            <option value="active">Aktywne (oczekujące + potwierdzone)</option>
            <option value="all">Wszystkie statusy</option>
            <option value="pending">Tylko oczekujące</option>
            <option value="confirmed">Tylko potwierdzone</option>
            <option value="cancelled">Anulowane</option>
            <option value="expired">Wygasłe</option>
            <option value="email_verification_pending">E-mail do potwierdzenia</option>
          </select></label>
          </div>
          <div class="admin-toolbar-actions">
            <button type="button" class="button secondary icon-btn" id="rest-res-refresh" title="Odśwież" aria-label="Odśwież">↻</button>
            <button type="button" class="button" id="rest-res-new">Nowa dostawa (jeden termin)</button>
          </div>
        </div>
        <div class="table-scroll">
          <table class="hotel-table">
            <thead><tr><th>Numer</th><th>Odbiorca</th><th>Data</th><th>Od</th><th>Do</th><th>h</th><th>Opis</th><th>E-mail</th><th>Tel</th><th>Limit</th><th>Status</th><th>Utw.</th><th></th></tr></thead>
            <tbody>${rows || "<tr><td colspan='13'>Brak wpisów.</td></tr>"}</tbody>
          </table>
        </div>
      </div>`;
  }

  function renderTemplates() {
    const allKeys = Object.keys(templatesData);
    const keys =
      Array.isArray(restTemplateKeyFilter) && restTemplateKeyFilter.length ?
        allKeys.filter((k) => restTemplateKeyFilter.includes(k))
      : allKeys;
    const helperBlock =
      Array.isArray(restTemplateKeyFilter) && restTemplateKeyFilter.length ?
        `<p class="helper">Ten widok pokazuje szablon <strong>jedynej wiadomości do odbiorcy</strong> — o przyjęciu rezerwacji dostawy (po utworzeniu w grafiku / panelu, po potwierdzeniu oczekującej lub z pytania po zapisie w grafiku).</p>
        <p class="helper">Zmienne: <code>{{fullName}}</code>, <code>{{restaurantName}}</code>, <code>{{reservationNumber}}</code> oraz bloki HTML: <code>{{cateringWhenHtml}}</code> (pierwsza data i godzina dostawy, ewent. lista terminów), <code>{{cateringCycleHtml}}</code> (jednorazowo / co ile / do kiedy), <code>{{cateringRecipientHtml}}</code>, <code>{{cateringDescriptionHtml}}</code> (opis zamówienia — może być pusty).</p>`
      : `<p class="helper">Zmienne m.in.: <code>{{reservationNumber}}</code> (np. slug/CATERING/rok), <code>{{fullName}}</code>, <code>{{email}}</code>, <code>{{phone}}</code>, <code>{{date}}</code>, <code>{{timeFrom}}</code>, <code>{{timeTo}}</code>, <code>{{customerNote}}</code>, <code>{{restaurantName}}</code>.</p>`;
    return `
      <div class="hotel-subpanel">
        <h3>Szablony mailingowe — catering</h3>
        ${helperBlock}
        <p class="helper">Logo, przycisk akcji i premium-layout wiadomości są dodawane automatycznie przy wysyłce. W polu poniżej edytujesz główną treść maila.</p>
        <p class="helper">Podgląd pokazuje wiadomość z przykładowymi danymi dostawy. Przy szablonie z <code>{{confirmationLink}}</code> możesz ustawić tekst przycisku w polu poniżej.</p>
        <div id="rest-template-forms">
          ${keys
            .map(
              (k) => `
            <details class="hotel-template-card">
              <summary><span class="tpl-key">${escapeHtml(k)}</span>${REST_TEMPLATE_LABELS[k] ? `<span class="tpl-desc"> — ${escapeHtml(REST_TEMPLATE_LABELS[k])}</span>` : ""}</summary>
              <label>Temat<input type="text" data-rest-tpl-key="${escapeHtml(k)}" data-field="subject" value="${escapeHtml(templatesData[k]?.subject || "")}" /></label>
              ${
                isRestaurantConfirmTemplateKey(k)
                  ? `<label>Tekst przycisku potwierdzenia<input type="text" data-rest-tpl-key="${escapeHtml(k)}" data-field="actionLabel" value="${escapeHtml(templatesData[k]?.actionLabel || "")}" maxlength="200" placeholder="np. Potwierdź adres e-mail" /></label>`
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
              <div class="wysiwyg-editor" contenteditable="true" data-rest-tpl-key="${escapeHtml(k)}" data-field="bodyHtml">${templatesData[k]?.bodyHtml || ""}</div>
              <input type="hidden" data-rest-tpl-key="${escapeHtml(k)}" data-field="bodyHtml-hidden" value="${escapeHtml(templatesData[k]?.bodyHtml || "")}" />
              <div class="mail-preview-panel">
                <div class="mail-preview-panel-head">
                  <strong>Podgląd wiadomości</strong>
                  <span class="helper">${
                    String(k || "").startsWith("catering_") ||
                    k === "restaurant_confirmed_client" ||
                    k === "rest_confirmed_client"
                      ? "Przykładowy mail o przyjęciu: bloki termin, cykl, odbiorca — jak w wysyłce."
                    : "Wersja z przykładowymi danymi dostawy."
                  }</span>
                </div>
                <div class="mail-preview-render" data-rest-preview-key="${escapeHtml(k)}"></div>
              </div>
              <button type="button" class="button rest-save-tpl" data-key="${escapeHtml(k)}">Zapisz szablon</button>
            </details>`
            )
            .join("")}
        </div>
      </div>`;
  }

  async function renderRestaurantAdminPanel(container, options = {}) {
    if (!container) return;
    if (options.defaultTab) {
      const raw = String(options.defaultTab || "").trim();
      restSubTab = raw === "reservations" ? "deliveries" : raw;
    }
    const allowedTabs = Array.isArray(options.allowedTabs) && options.allowedTabs.length
      ? options.allowedTabs.map((tab) => String(tab || "").trim()).filter(Boolean)
      : null;
    restTemplateKeyFilter =
      Array.isArray(options.restaurantMailTemplateKeyFilter) && options.restaurantMailTemplateKeyFilter.length ?
        options.restaurantMailTemplateKeyFilter
      : null;
    container.innerHTML = `<p class="status">Ładowanie modułu Catering…</p>`;
    const templatesOnly =
      Array.isArray(allowedTabs) &&
      allowedTabs.length === 1 &&
      String(allowedTabs[0] || "").trim() === "templates";
    try {
      if (!templatesOnly) {
        await loadReservations("active");
        await loadCateringRecipients();
      }
      await loadTemplates();
    } catch (e) {
      container.innerHTML = `<p class="status">${escapeHtml(e.message)}</p>`;
      return;
    }

    function paint() {
      const sub = {
        deliveries: renderDeliveries(),
        templates: renderTemplates(),
      };
      const availableTabs = [
        { key: "deliveries", label: "Dostawy" },
        { key: "templates", label: "Szablony e-mail" },
      ].filter((tab) => !allowedTabs || allowedTabs.includes(tab.key));
      if (!availableTabs.length) {
        container.innerHTML = `<section class="panel col-12"><p class="status">Brak dostepnych widokow tego modulu.</p></section>`;
        return;
      }
      if (!availableTabs.some((tab) => tab.key === restSubTab)) {
        restSubTab = availableTabs[0].key;
      }
      const activeSubTab = availableTabs.find((tab) => tab.key === restSubTab) || availableTabs[0];
      container.innerHTML = `
        <section class="panel col-12">
          <p class="pill">Catering</p>
          <h2>${escapeHtml(availableTabs.length === 1 ? activeSubTab.label : "Dostawy cateringu")}</h2>
          ${
            availableTabs.length > 1
              ? `<div class="hotel-nav">
                  ${availableTabs
                    .map(
                      (tab) =>
                        `<button type="button" class="button ${restSubTab === tab.key ? "" : "secondary"}" data-rsub="${escapeHtml(tab.key)}">${escapeHtml(tab.label)}</button>`
                    )
                    .join("")}
                </div>`
              : ""
          }
          <div id="rest-sub-content">${sub[restSubTab]}</div>
        </section>
      `;

      const fs = document.querySelector("#rest-res-filter");
      if (fs) fs.value = restResFilter;

      container.querySelectorAll("[data-rsub]").forEach((b) => {
        b.addEventListener("click", async () => {
          restSubTab = b.getAttribute("data-rsub");
          try {
            if (restSubTab === "deliveries") {
              await loadReservations(restResFilter);
              await loadCateringRecipients();
            }
          } catch (err) {
            alert(err.message);
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

      document.querySelector("#rest-res-filter")?.addEventListener("change", async () => {
        restResFilter = document.querySelector("#rest-res-filter").value;
        await loadReservations(restResFilter);
        document.querySelector("#rest-sub-content").innerHTML = renderDeliveries();
        const f = document.querySelector("#rest-res-filter");
        if (f) f.value = restResFilter;
        bindSub();
      });
      document.querySelector("#rest-res-refresh")?.addEventListener("click", async () => {
        await loadReservations(restResFilter);
        await loadCateringRecipients();
        document.querySelector("#rest-sub-content").innerHTML = renderDeliveries();
        const f = document.querySelector("#rest-res-filter");
        if (f) f.value = restResFilter;
        bindSub();
      });

      document.querySelector("#rest-res-new")?.addEventListener("click", () => openSingleCateringDeliveryModal());

      document.querySelectorAll(".rest-res-edit").forEach((btn) => {
        btn.addEventListener("click", () => openRestaurantEditorModal(btn.getAttribute("data-id")));
      });
      document.querySelectorAll(".rest-res-cancel").forEach((btn) => {
        btn.addEventListener("click", () => quickCancelRestaurant(btn.getAttribute("data-id")));
      });

      document.querySelectorAll(".rest-save-tpl").forEach((btn) => {
        btn.addEventListener("click", () => {
          const key = btn.getAttribute("data-key");
          const subj = document.querySelector(`[data-rest-tpl-key="${key}"][data-field="subject"]`);
          const bodyHidden = document.querySelector(`[data-rest-tpl-key="${key}"][data-field="bodyHtml-hidden"]`);
          const newBodyHtml = bodyHidden?.value || "";
          restaurantApi("admin-mail-template-save", {
            method: "POST",
            body: {
              key,
              subject: subj?.value || "",
              bodyHtml: newBodyHtml,
              actionLabel: document.querySelector(`[data-rest-tpl-key="${key}"][data-field="actionLabel"]`)?.value ?? "",
            },
          })
            .then(() => alert("Zapisano."))
            .catch((err) => alert(err.message));
        });
      });
      bindRestaurantTemplatePreviews();
      bindWysiwygEditors();

      countdownTimer = setInterval(() => {
        document.querySelectorAll(".rest-countdown").forEach((el) => {
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

    function closeRestExtraModal() {
      document.getElementById("rest-extra-modal-mount")?.remove();
      document.body.classList.remove("admin-modal-open");
    }

    function openRestYesNoModal(messageText) {
      return new Promise((resolve) => {
        const wrap = document.createElement("div");
        wrap.id = "rest-extra-modal-mount";
        const msg = escapeHtml(messageText);
        wrap.innerHTML = `
        <div class="admin-modal-overlay" data-rest-yes-no-overlay>
          <section class="admin-modal menu-editor-modal hotel-room-editor-modal" role="dialog" aria-modal="true">
            <div class="admin-modal-head menu-editor-modal-head">
              <h3>Powiadomienie dla klienta</h3>
            </div>
            <p class="helper">${msg}</p>
            <div class="admin-modal-footer hotel-room-editor-footer">
              <button type="button" class="button secondary" data-rest-yes-no="no">Nie</button>
              <button type="button" class="button" data-rest-yes-no="yes">Tak</button>
            </div>
          </section>
        </div>`;
        document.body.appendChild(wrap);
        document.body.classList.add("admin-modal-open");
        const done = (value) => {
          wrap.remove();
          if (!document.getElementById("rest-extra-modal-mount")) {
            document.body.classList.remove("admin-modal-open");
          }
          resolve(value);
        };
        wrap.querySelector('[data-rest-yes-no="no"]')?.addEventListener("click", () => done(false));
        wrap.querySelector('[data-rest-yes-no="yes"]')?.addEventListener("click", () => done(true));
        wrap.querySelector("[data-rest-yes-no-overlay]")?.addEventListener("click", (ev) => {
          if (ev.target === ev.currentTarget) done(false);
        });
      });
    }

    function cateringRecipientOptionsMarkup(selectedId) {
      const list = Array.isArray(recipientsData) ? recipientsData : [];
      if (!list.length) {
        return `<p class="helper">Brak odbiorców — dodaj ich w zakładce Catering → Odbiorcy, potem odśwież ten widok.</p>`;
      }
      return `<label>Odbiorca<select name="recipientId" required>
        <option value="">— wybierz —</option>
        ${list
          .map(
            (rec) =>
              `<option value="${escapeHtml(rec.id)}" ${String(rec.id) === String(selectedId || "") ? "selected" : ""}>${escapeHtml(rec.displayName || rec.id)}</option>`
          )
          .join("")}
      </select></label>`;
    }

    async function quickCancelRestaurant(id) {
      const cancelReason = window.prompt("Podaj powód anulowania dostawy:");
      if (cancelReason == null) return;
      if (!String(cancelReason).trim()) {
        alert("Powód anulowania jest wymagany.");
        return;
      }
      try {
        await restaurantApi("admin-reservation-cancel", { method: "POST", body: { id, cancelReason } });
        await loadReservations(restResFilter);
        document.querySelector("#rest-sub-content").innerHTML = renderDeliveries();
        const f = document.querySelector("#rest-res-filter");
        if (f) f.value = restResFilter;
        bindSub();
      } catch (err) {
        alert(err.message);
      }
    }

    async function openSingleCateringDeliveryModal() {
      await loadCateringRecipients();
      if (!Array.isArray(recipientsData) || !recipientsData.length) {
        alert("Najpierw dodaj co najmniej jednego odbiorcę (Catering → Odbiorcy).");
        return;
      }
      closeRestExtraModal();
      const host = document.createElement("div");
      host.id = "rest-extra-modal-mount";
      host.innerHTML = `
        <div class="admin-modal-overlay" data-rest-extra-overlay>
          <section class="admin-modal menu-editor-modal hotel-room-editor-modal" role="dialog" aria-modal="true">
            <form id="rest-manual-form" class="stack">
              <div class="admin-modal-head menu-editor-modal-head">
                <h3>Nowa dostawa (jeden termin)</h3>
                <button type="button" class="button secondary" data-rest-extra-close>Zamknij</button>
              </div>
              <p class="helper">Serię terminów lub powtarzanie ustawisz w <strong>Grafiku</strong> → nowy wpis → Catering.</p>
              ${cateringRecipientOptionsMarkup("")}
              <label>Data<input name="reservationDate" type="date" required /></label>
              <label>Godzina dostawy<input name="startTime" type="time" min="00:00" max="23:59" step="60" required /></label>
              <label>Opis / zamówienie<textarea name="description" rows="3"></textarea></label>
              <label>Notatka wewn.<textarea name="adminNote" rows="2"></textarea></label>
              <label class="admin-check-line"><input type="checkbox" name="asPending" /> <span>Oczekuje na akceptację</span></label>
              <label class="admin-check-line"><input type="checkbox" name="sendInfoEmail" checked /> <span>Wyślij e-mail o przyjęciu rezerwacji (termin, godzina, cykl, odbiorca)</span></label>
              <div class="admin-modal-footer hotel-room-editor-footer">
                <button type="button" class="button secondary" data-rest-extra-close>Anuluj</button>
                <button type="submit" class="button">Zapisz</button>
              </div>
            </form>
          </section>
        </div>`;
      document.body.appendChild(host);
      document.body.classList.add("admin-modal-open");
      host.querySelectorAll("[data-rest-extra-close]").forEach((b) => b.addEventListener("click", closeRestExtraModal));
      host.querySelector("[data-rest-extra-overlay]")?.addEventListener("click", (ev) => {
        if (ev.target === ev.currentTarget) closeRestExtraModal();
      });
      host.querySelector("#rest-manual-form")?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.target);
        const status = fd.get("asPending") === "on" ? "pending" : "confirmed";
        const recipientId = String(fd.get("recipientId") || "").trim();
        if (!recipientId) {
          alert("Wybierz odbiorcę.");
          return;
        }
        try {
          await restaurantApi("admin-catering-delivery-create", {
            method: "POST",
            body: {
              recipientId,
              reservationDate: fd.get("reservationDate"),
              startTime: fd.get("startTime"),
              durationHours: CATERING_CREATE_DEFAULT_DURATION_HOURS,
              description: String(fd.get("description") || "").trim(),
              adminNote: String(fd.get("adminNote") || "").trim(),
              repeatMode: "none",
              status,
              sendManualCreatedEmail: fd.get("sendInfoEmail") === "on",
            },
          });
          closeRestExtraModal();
          await loadReservations(restResFilter);
          await loadCateringRecipients();
          restSubTab = "deliveries";
          paint();
        } catch (err) {
          alert(err.message);
        }
      });
    }

    async function openRestaurantEditorModal(id) {
      await loadCateringRecipients();
      const base = restaurantApiBase();
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
      const recipientId = r.recipientId || "";
      if (!Array.isArray(recipientsData) || !recipientsData.length) {
        alert("Brak odbiorców — dodaj ich w zakładce Catering → Odbiorcy.");
        return;
      }
      closeRestExtraModal();
      const host = document.createElement("div");
      host.id = "rest-extra-modal-mount";
      host.innerHTML = `
        <div class="admin-modal-overlay" data-rest-extra-overlay>
          <section class="admin-modal menu-editor-modal hotel-room-editor-modal" role="dialog" aria-modal="true">
            <form id="rest-edit-form" class="stack">
              <div class="admin-modal-head menu-editor-modal-head">
                <div>
                  <p class="pill">${escapeHtml(reservationNumber)}</p>
                  <h3>Edycja dostawy</h3>
                  <p class="helper">${escapeHtml(r.statusLabel || r.status)} · ${escapeHtml(r.email || "—")}</p>
                </div>
                <button type="button" class="button secondary" data-rest-extra-close>Zamknij</button>
              </div>
              ${cateringRecipientOptionsMarkup(recipientId)}
              <label>Data<input name="reservationDate" type="date" value="${escapeHtml(r.reservationDate || "")}" required /></label>
              <label>Godzina (HH:MM)<input name="startTime" value="${escapeHtml(r.startTime || "")}" required /></label>
              <label>Czas trwania (h)<input name="durationHours" type="number" step="0.5" min="0.5" value="${escapeHtml(String(r.durationHours || 1))}" required /></label>
              <label>Opis / zamówienie<textarea name="description" rows="3">${escapeHtml(r.customerNote || "")}</textarea></label>
              <label>Notatka wewn.<textarea name="adminNote" rows="2">${escapeHtml(r.adminNote || "")}</textarea></label>
              <div class="admin-modal-footer hotel-room-editor-footer" style="flex-wrap:wrap;gap:0.5rem">
                <button type="button" class="button secondary" data-rest-extra-close>Anuluj</button>
                ${r.status === "pending" ? `<button type="button" class="button secondary" id="rest-confirm-quick">Potwierdź</button>` : ""}
                <button type="submit" class="button">Zapisz zmiany</button>
              </div>
            </form>
          </section>
        </div>`;
      document.body.appendChild(host);
      document.body.classList.add("admin-modal-open");
      host.querySelectorAll("[data-rest-extra-close]").forEach((b) => b.addEventListener("click", closeRestExtraModal));
      host.querySelector("[data-rest-extra-overlay]")?.addEventListener("click", (ev) => {
        if (ev.target === ev.currentTarget) closeRestExtraModal();
      });
      host.querySelector("#rest-confirm-quick")?.addEventListener("click", async () => {
        if (!confirm("Potwierdzić dostawę i wysłać e-mail do odbiorcy?")) return;
        try {
          await restaurantApi("admin-reservation-confirm", { method: "POST", body: { id } });
          closeRestExtraModal();
          await loadReservations(restResFilter);
          document.querySelector("#rest-sub-content").innerHTML = renderDeliveries();
          const f = document.querySelector("#rest-res-filter");
          if (f) f.value = restResFilter;
          bindSub();
        } catch (err) {
          alert(err.message);
        }
      });
      host.querySelector("#rest-edit-form")?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.target);
        const nextRecipient = String(fd.get("recipientId") || "").trim();
        if (!nextRecipient) {
          alert("Wybierz odbiorcę.");
          return;
        }
        try {
          await restaurantApi("admin-reservation-update", {
            method: "PATCH",
            body: {
              id,
              recipientId: nextRecipient,
              reservationDate: fd.get("reservationDate"),
              startTime: fd.get("startTime"),
              durationHours: Number(fd.get("durationHours")),
              customerNote: String(fd.get("description") || "").trim(),
              adminNote: String(fd.get("adminNote") || "").trim(),
              notifyClient: false,
            },
          });
          closeRestExtraModal();
          await loadReservations(restResFilter);
          await loadCateringRecipients();
          document.querySelector("#rest-sub-content").innerHTML = renderDeliveries();
          const f = document.querySelector("#rest-res-filter");
          if (f) f.value = restResFilter;
          bindSub();
        } catch (err) {
          alert(err.message);
        }
      });
    }

    paint();
  }

  window.renderRestaurantAdminPanel = renderRestaurantAdminPanel;
})();
