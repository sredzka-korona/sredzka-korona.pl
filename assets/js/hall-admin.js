/**
 * Panel admina — moduł Sale (hallApi).
 */
(function () {
  const config = window.SREDZKA_CONFIG || {};

  function hallApiBase() {
    if (config.apiBase) {
      return `${String(config.apiBase).replace(/\/$/, "")}/api/admin/legacy-bookings/hall`;
    }
    if (config.hallApiBase) {
      return String(config.hallApiBase).replace(/\/$/, "");
    }
    if (config.firebaseProjectId) {
      return `https://europe-west1-${config.firebaseProjectId}.cloudfunctions.net/hallApi`;
    }
    return "";
  }

  async function hallApi(op, options = {}) {
    const base = hallApiBase();
    if (!base) {
      throw new Error("Brak hallApiBase / firebaseProjectId.");
    }
    if (typeof firebase === "undefined" || !firebase.auth()?.currentUser) {
      throw new Error("Brak sesji Firebase.");
    }
    const token = await firebase.auth().currentUser.getIdToken();
    const res = await fetch(`${base}?op=${encodeURIComponent(op)}`, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "Błąd API sal.");
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

  let hallSubTab = "reservations";
  let hallResFilter = "active";
  let hallsData = [];
  let reservationsData = [];
  let blockListData = [];
  let templatesData = {};
  let venueSettings = {};
  let countdownTimer = null;

  const HALL_TEMPLATE_LABELS = {
    hall_confirm_email: "E-mail z linkiem po zgłoszeniu z formularza (potwierdzenie adresu).",
    hall_pending_admin: "Powiadomienie dla obsługi — nowe zgłoszenie sali.",
    hall_confirmed_client: "Klient — rezerwacja sali zaakceptowana.",
    hall_cancelled_client: "Klient — rezerwacja anulowana.",
    hall_changed_client: "Po edycji zgłoszenia przez admina (opcjonalna wysyłka).",
    hall_expired_pending_client: "Klient — wygasło oczekiwanie na decyzję obiektu.",
    hall_expired_pending_admin: "Obsługa — informacja o automatycznym wygaśnięciu zgłoszenia.",
    hall_expired_email_client: "Klient — nie potwierdzono adresu e-mail w terminie 2 godzin.",
    hall_extended_pending_client: "Klient — przedłużono termin oczekiwania na decyzję.",
  };

  const HALL_TEMPLATE_PREVIEW_VARS = Object.freeze({
    reservationNumber: "7/2026/PRZYJĘCIA",
    reservationSubject: "Przyjęcie jubileuszowe",
    decisionDeadline: "14 kwietnia 2026, godz. 12:00",
    fullName: "Karolina Zielińska",
    email: "karolina.zielinska@example.com",
    phone: "+48 602 333 444",
    hallName: "Sala Bankietowa",
    date: "30 maja 2026",
    timeFrom: "16:00",
    timeTo: "02:00",
    durationHours: "10",
    guestsCount: "120",
    eventType: "Przyjęcie jubileuszowe",
    exclusive: "Tak",
    customerNote: "Zależy nam na parkiecie tanecznym, spokojnej strefie dla seniorów i oprawie premium.",
    adminNote: "Zapytanie o indywidualne menu i opiekę koordynatora wydarzenia.",
    confirmationLink: "https://www.sredzkakorona.pl/przyjecia/potwierdzenie?token=podglad",
    venueName: "Średzka Korona",
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

  function hallMailHeaderContext(key) {
    const k = String(key || "").replace(/^hall_/i, "");
    const map = {
      confirm_email: "Potwierdzenie rezerwacji sali",
      pending_admin: "Rezerwacja sali — powiadomienie dla obsługi",
      confirmed_client: "Potwierdzenie rezerwacji sali",
      cancelled_client: "Odwołanie rezerwacji sali",
      changed_client: "Zmiana rezerwacji sali",
      expired_pending_client: "Wygaśnięcie rezerwacji sali",
      expired_pending_admin: "Wygaśnięcie rezerwacji — informacja dla obsługi",
      expired_email_client: "Wygasłe potwierdzenie — rezerwacja sali",
      extended_pending_client: "Przedłużenie terminu rezerwacji sali",
    };
    return map[k] || "Wiadomość o rezerwacji";
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

  function hallPreviewActionLabel(key) {
    if (key !== "hall_confirm_email") return "";
    const el = document.querySelector(`[data-hall-tpl-key="${key}"][data-field="actionLabel"]`);
    const v = el && String(el.value || "").trim();
    return v || "Potwierdź zgłoszenie";
  }

  function updateHallTemplatePreview(key) {
    if (!key) return;
    const subjectField = document.querySelector(`[data-hall-tpl-key="${key}"][data-field="subject"]`);
    const editor = document.querySelector(`.wysiwyg-editor[data-hall-tpl-key="${key}"]`);
    const hidden = document.querySelector(`[data-hall-tpl-key="${key}"][data-field="bodyHtml-hidden"]`);
    const previewHost = document.querySelector(`[data-hall-preview-key="${key}"]`);
    if (!subjectField || !previewHost) return;
    const bodyHtml = editor?.innerHTML || hidden?.value || "";
    const renderedSubject = renderTemplatePreviewString(subjectField.value, HALL_TEMPLATE_PREVIEW_VARS);
    const renderedBody = sanitizeTemplatePreviewHtml(
      renderTemplatePreviewString(bodyHtml, HALL_TEMPLATE_PREVIEW_VARS)
    );
    previewHost.innerHTML = buildMailPreviewMarkup({
      inboxSubject: renderedSubject,
      headerContext: hallMailHeaderContext(key),
      headerNumber: HALL_TEMPLATE_PREVIEW_VARS.reservationNumber,
      bodyHtml: renderedBody,
      footerLabel: "Przyjęcia Średzka Korona",
      actionLabel: hallPreviewActionLabel(key),
    });
  }

  function bindHallTemplatePreviews() {
    const keys = new Set();
    document.querySelectorAll("[data-hall-tpl-key][data-field]").forEach((field) => {
      const key = field.getAttribute("data-hall-tpl-key");
      if (!key) return;
      keys.add(key);
      field.addEventListener("input", () => updateHallTemplatePreview(key));
    });
    keys.forEach((key) => updateHallTemplatePreview(key));
  }

  function bindWysiwygEditors() {
    document.querySelectorAll(".wysiwyg-toolbar button[data-cmd]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const cmd = btn.getAttribute("data-cmd");
        const toolbar = btn.closest(".wysiwyg-toolbar");
        const tplKey = toolbar?.getAttribute("data-toolbar-for");
        const editor = document.querySelector(`.wysiwyg-editor[data-hall-tpl-key="${tplKey}"]`);
        if (!editor) return;
        editor.focus();
        if (cmd === "createLink") {
          const url = prompt("Podaj adres URL:", "https://");
          if (url) document.execCommand(cmd, false, url);
        } else {
          document.execCommand(cmd, false, null);
        }
        updateWysiwygHiddenInput(tplKey);
        updateHallTemplatePreview(tplKey);
      });
    });

    document.querySelectorAll(".wysiwyg-editor[contenteditable]").forEach((editor) => {
      const tplKey = editor.getAttribute("data-hall-tpl-key");
      editor.addEventListener("input", () => {
        updateWysiwygHiddenInput(tplKey);
        updateHallTemplatePreview(tplKey);
      });
    });
  }

  function updateWysiwygHiddenInput(tplKey) {
    const editor = document.querySelector(`.wysiwyg-editor[data-hall-tpl-key="${tplKey}"]`);
    const hidden = document.querySelector(`[data-hall-tpl-key="${tplKey}"][data-field="bodyHtml-hidden"]`);
    if (editor && hidden) {
      hidden.value = editor.innerHTML;
    }
  }

  async function loadHalls() {
    const d = await hallApi("admin-halls-list", { method: "GET" });
    hallsData = d.halls || [];
  }

  async function loadReservations(status) {
    const mode = status && String(status).length ? status : "active";
    const q = `&status=${encodeURIComponent(mode)}`;
    const base = hallApiBase();
    const token = await firebase.auth().currentUser.getIdToken();
    const res = await fetch(`${base}?op=admin-reservations-list${q}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || "Błąd");
    reservationsData = d.reservations || [];
  }

  async function loadHallBlockList() {
    const base = hallApiBase();
    const token = await firebase.auth().currentUser.getIdToken();
    const res = await fetch(`${base}?op=admin-reservations-list&status=${encodeURIComponent("manual_block")}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || "Błąd");
    blockListData = d.reservations || [];
  }

  async function loadTemplates() {
    const d = await hallApi("admin-mail-templates", { method: "GET" });
    templatesData = d.templates || {};
  }

  async function loadVenueSettings() {
    const d = await hallApi("admin-venue-settings", { method: "GET" });
    venueSettings = d.settings || {};
  }

  function getHallById(hallId) {
    const current = String(hallId || "");
    return hallsData.find((hall) => String(hall.id) === current) || hallsData[0] || null;
  }

  function hallIsSmall(hallId) {
    return String(getHallById(hallId)?.hallKind || "").toLowerCase() === "small";
  }

  function syncHallExclusiveVisibility(form) {
    if (!(form instanceof HTMLFormElement)) return;
    const hallId = String(form.querySelector('[name="hallId"]')?.value || "");
    const exclusiveField = form.querySelector("[data-hall-exclusive-field]");
    const exclusiveInput = form.querySelector('[name="exclusive"]');
    const isSmall = hallIsSmall(hallId);
    if (exclusiveField) {
      exclusiveField.hidden = isSmall;
    }
    if (exclusiveInput && isSmall) {
      exclusiveInput.checked = true;
    }
  }

  function renderHalls() {
    const body = hallsData
      .map(
        (h) => `
      <tr data-id="${escapeHtml(h.id)}">
        <td>${escapeHtml(h.name || h.id)}</td>
        <td>${escapeHtml(String(h.capacity ?? ""))}</td>
        <td>${escapeHtml(h.hallKind || "")}</td>
        <td>${h.active !== false ? "tak" : "nie"}</td>
        <td>${escapeHtml(String(h.bufferMinutes ?? 60))}</td>
        <td>${escapeHtml(String(h.fullBlockGuestThreshold ?? 100))}</td>
        <td><button type="button" class="button secondary hall-edit" data-id="${escapeHtml(h.id)}">Edytuj</button></td>
      </tr>`
      )
      .join("");
    return `
      <div class="hotel-subpanel">
        <h3>Sale (${hallsData.length})</h3>
        <p class="helper">Pojemność, bufor między rezerwacjami i próg pełnej blokacji (duża sala) wpływają na dostępność.</p>
        <div class="table-scroll">
          <table class="hotel-table">
            <thead><tr><th>Nazwa</th><th>Pojemność</th><th>Typ</th><th>Aktywna</th><th>Bufor (min)</th><th>Próg 100+</th><th></th></tr></thead>
            <tbody>${body || "<tr><td colspan='7'>Brak</td></tr>"}</tbody>
          </table>
        </div>
      </div>`;
  }

  function renderVenueSettings() {
    const s = venueSettings;
    return `
      <div class="hotel-subpanel">
        <h3>Godziny rezerwacji sal (frontend)</h3>
        <form id="hall-venue-form" class="stack">
          <div class="field-grid">
            <label>Od (HH:MM)<input name="hallOpenTime" value="${escapeHtml(s.hallOpenTime || "08:00")}" required /></label>
            <label>Do (HH:MM)<input name="hallCloseTime" value="${escapeHtml(s.hallCloseTime || "23:00")}" required /></label>
          </div>
          <button type="submit" class="button">Zapisz godziny</button>
        </form>
      </div>`;
  }

  function renderReservations() {
    const rows = reservationsData
      .map(
        (r) => `
      <tr>
        <td>${escapeHtml(r.humanNumberLabel || r.humanNumber || r.id)}</td>
        <td>${escapeHtml(r.hallName || "")}</td>
        <td>${escapeHtml(r.reservationDate || "")}</td>
        <td>${formatMs(r.startDateTime)}</td>
        <td>${formatMs(r.endDateTime)}</td>
        <td>${r.durationUnspecified ? "nie określono" : escapeHtml(String(r.durationHours ?? ""))}</td>
        <td>${escapeHtml(String(r.guestsCount ?? ""))}</td>
        <td>${escapeHtml(r.eventType || "")}</td>
        <td>${r.exclusive ? "tak" : "nie"}</td>
        <td>${r.fullBlock ? "tak" : "nie"}</td>
        <td>${r.sharedLarge ? "częściowa" : "—"}</td>
        <td>${escapeHtml(r.fullName || "")}</td>
        <td>${escapeHtml(r.email || "")}</td>
        <td>${escapeHtml(r.phone || "")}</td>
        <td>${escapeHtml(r.customerNote || "")}</td>
        <td>${escapeHtml(r.adminNote || "")}</td>
        <td>${escapeHtml(r.statusLabel || r.status)}</td>
        <td class="hall-countdown" data-pending="${r.pendingExpiresAt || ""}" data-email-exp="${r.emailVerificationExpiresAt || ""}" data-status="${escapeHtml(r.status)}">${r.status === "pending" ? countdown(r.pendingExpiresAt) : r.status === "email_verification_pending" ? countdown(r.emailVerificationExpiresAt) : "—"}</td>
        <td>${r.extendAvailable ? "tak" : "nie"}</td>
        <td>${formatMs(r.createdAtMs)}</td>
        <td class="admin-row-actions">
          <button type="button" class="button secondary hall-res-edit" data-id="${escapeHtml(r.id)}">Edytuj</button>
          ${
            canCancelReservationStatus(r.status)
              ? `<button type="button" class="button secondary danger-muted hall-res-cancel" data-id="${escapeHtml(r.id)}">Anuluj</button>`
              : ""
          }
        </td>
      </tr>`
      )
      .join("");
    return `
      <div class="hotel-subpanel">
        <h3>Rezerwacje sal</h3>
        <p class="helper">Domyślnie widać wpisy <strong>oczekujące</strong> i <strong>zarezerwowane</strong>. Pełna blokada sali (status „Blokada”) służy do zajęcia terminu bez gościa z formularza — np. prace, zamknięcie sali.</p>
        <div class="admin-toolbar-row hotel-filters">
          <div class="admin-toolbar-filters">
            <label>Status <select id="hall-res-filter">
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
            <button type="button" class="button secondary icon-btn" id="hall-res-refresh" title="Odśwież" aria-label="Odśwież">↻</button>
            <button type="button" class="button" id="hall-res-new">Utwórz rezerwację</button>
          </div>
        </div>
        <div class="table-scroll">
          <table class="hotel-table">
            <thead><tr><th>Nr</th><th>Sala</th><th>Data</th><th>Od</th><th>Do</th><th>h</th><th>Goś.</th><th>Impreza</th><th>Wył.</th><th>100+</th><th>Współdz.</th><th>Imię</th><th>E-mail</th><th>Tel</th><th>Uwagi</th><th>Admin</th><th>Status</th><th>Czas</th><th>Przedł.</th><th>Utw.</th><th></th></tr></thead>
            <tbody>${rows || "<tr><td colspan='21'>Brak</td></tr>"}</tbody>
          </table>
        </div>
      </div>`;
  }

  function renderTemplates() {
    const keys = Object.keys(templatesData);
    return `
      <div class="hotel-subpanel">
        <h3>Szablony mailingowe — sale</h3>
        <p class="helper">Zmienne: <code>{{reservationNumber}}</code> (np. 7/2026/PRZYJĘCIA), <code>{{reservationSubject}}</code>, <code>{{decisionDeadline}}</code>, <code>{{adminActionLink}}</code>, <code>{{fullName}}</code>, <code>{{hallName}}</code>, <code>{{date}}</code>, <code>{{timeFrom}}</code>, <code>{{timeTo}}</code>, <code>{{durationHours}}</code>, <code>{{guestsCount}}</code>, <code>{{eventType}}</code>, <code>{{exclusive}}</code>, <code>{{customerNote}}</code>, <code>{{confirmationLink}}</code>, <code>{{venueName}}</code>.</p>
        <p class="helper">Logo, przycisk akcji i premium-layout wiadomości są dodawane automatycznie przy wysyłce. W tym miejscu edytujesz główną treść maila.</p>
        <p class="helper">Podgląd pokazuje ekskluzywną wersję maila dla przyjęć z przykładowym zapytaniem i pełnym brandingiem. Przy szablonie potwierdzenia adresu e-mail możesz ustawić tekst na przycisku (gdy treść nie zawiera linku <code>{{confirmationLink}}</code>, przycisk zostanie zbudowany z tego pola).</p>
        <div id="hall-template-forms">
          ${keys
            .map(
              (k) => `
            <details class="hotel-template-card">
              <summary><span class="tpl-key">${escapeHtml(k)}</span>${HALL_TEMPLATE_LABELS[k] ? `<span class="tpl-desc"> — ${escapeHtml(HALL_TEMPLATE_LABELS[k])}</span>` : ""}</summary>
              <label>Temat<input type="text" data-hall-tpl-key="${escapeHtml(k)}" data-field="subject" value="${escapeHtml(templatesData[k]?.subject || "")}" /></label>
              ${
                k === "hall_confirm_email"
                  ? `<label>Tekst przycisku potwierdzenia<input type="text" data-hall-tpl-key="${escapeHtml(k)}" data-field="actionLabel" value="${escapeHtml(templatesData[k]?.actionLabel || "")}" maxlength="200" placeholder="np. Potwierdź zgłoszenie" /></label>`
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
              <div class="wysiwyg-editor" contenteditable="true" data-hall-tpl-key="${escapeHtml(k)}" data-field="bodyHtml">${templatesData[k]?.bodyHtml || ""}</div>
              <input type="hidden" data-hall-tpl-key="${escapeHtml(k)}" data-field="bodyHtml-hidden" value="${escapeHtml(templatesData[k]?.bodyHtml || "")}" />
              <div class="mail-preview-panel">
                <div class="mail-preview-panel-head">
                  <strong>Podgląd wiadomości</strong>
                  <span class="helper">Wersja z przykładowym zgłoszeniem sali i finalnym layoutem wysyłki.</span>
                </div>
                <div class="mail-preview-render" data-hall-preview-key="${escapeHtml(k)}"></div>
              </div>
              <button type="button" class="button hall-save-tpl" data-key="${escapeHtml(k)}">Zapisz szablon</button>
            </details>`
            )
            .join("")}
        </div>
      </div>`;
  }

  function renderHallBlockForm() {
    const hallOpts = hallsData
      .map((h) => `<option value="${escapeHtml(h.id)}">${escapeHtml(h.name || h.id)}</option>`)
      .join("");
    const blockRows = blockListData
      .map(
        (b) => `
      <tr>
        <td>${escapeHtml(b.humanNumberLabel || b.humanNumber || b.id)}</td>
        <td>${escapeHtml(b.hallName || "")}</td>
        <td>${escapeHtml(b.reservationDate || "")}</td>
        <td>${formatMs(b.startDateTime)} – ${formatMs(b.endDateTime)}</td>
        <td>${escapeHtml(b.adminNote || b.customerNote || "—")}</td>
      </tr>`
      )
      .join("");
    return `
      <div class="hotel-subpanel">
        <h3>Blokada terminu (sala)</h3>
        <p class="helper">Tworzy wpis blokujący salę w wybranym czasie — bez rezerwacji gościa z formularza.</p>
        <form id="hall-block-form" class="stack">
          <label>Sala<select name="hallId" required>${hallOpts || "<option value=\"\">—</option>"}</select></label>
          <label>Data<input name="reservationDate" type="date" required /></label>
          <div class="field-grid">
            <label>Start (HH:MM)<input name="startTime" required placeholder="12:00" /></label>
            <label>Czas trwania (h)<input name="durationHours" type="number" step="0.5" min="0.5" value="3" required /></label>
          </div>
          <label>Notatka<input name="note" /></label>
          <button type="submit" class="button">Utwórz blokadę</button>
        </form>
        <h4 class="admin-subheading">Lista blokad</h4>
        <div class="table-scroll">
          <table class="hotel-table">
            <thead><tr><th>Nr</th><th>Sala</th><th>Data</th><th>Godziny</th><th>Notatka</th></tr></thead>
            <tbody>${blockRows || "<tr><td colspan='5'>Brak</td></tr>"}</tbody>
          </table>
        </div>
      </div>`;
  }

  async function renderHallAdminPanel(container, options = {}) {
    if (!container) return;
    if (options.defaultTab) {
      hallSubTab = options.defaultTab;
    }
    const allowedTabs = Array.isArray(options.allowedTabs) && options.allowedTabs.length
      ? options.allowedTabs.map((tab) => String(tab || "").trim()).filter(Boolean)
      : null;
    container.innerHTML = `<p class="status">Ładowanie modułu Sale…</p>`;
    try {
      await loadHalls();
      await loadReservations("active");
      await loadTemplates();
      await loadVenueSettings();
    } catch (e) {
      container.innerHTML = `<p class="status">${escapeHtml(e.message)}</p>`;
      return;
    }

    function paint() {
      const sub = {
        reservations: renderReservations(),
        block: renderHallBlockForm(),
        halls: renderHalls() + renderVenueSettings(),
        templates: renderTemplates(),
      };
      const availableTabs = [
        { key: "reservations", label: "Rezerwacje" },
        { key: "block", label: "Blokada terminu" },
        { key: "halls", label: "Konfiguracja sal" },
        { key: "templates", label: "Szablony" },
      ].filter((tab) => !allowedTabs || allowedTabs.includes(tab.key));
      if (!availableTabs.length) {
        container.innerHTML = `<section class="panel col-12"><p class="status">Brak dostepnych widokow tego modulu.</p></section>`;
        return;
      }
      if (!availableTabs.some((tab) => tab.key === hallSubTab)) {
        hallSubTab = availableTabs[0].key;
      }
      const activeSubTab = availableTabs.find((tab) => tab.key === hallSubTab) || availableTabs[0];
      container.innerHTML = `
        <section class="panel col-12">
          <p class="pill">Sale</p>
          <h2>${escapeHtml(availableTabs.length === 1 ? activeSubTab.label : "Rezerwacje sal")}</h2>
          ${
            availableTabs.length > 1
              ? `<div class="hotel-nav">
                  ${availableTabs
                    .map(
                      (tab) =>
                        `<button type="button" class="button ${hallSubTab === tab.key ? "" : "secondary"}" data-hsub="${escapeHtml(tab.key)}">${escapeHtml(tab.label)}</button>`
                    )
                    .join("")}
                </div>`
              : ""
          }
          <div id="hall-sub-content">${sub[hallSubTab]}</div>
        </section>
      `;

      const hf = document.querySelector("#hall-res-filter");
      if (hf) hf.value = hallResFilter;

      container.querySelectorAll("[data-hsub]").forEach((b) => {
        b.addEventListener("click", async () => {
          hallSubTab = b.getAttribute("data-hsub");
          try {
            if (hallSubTab === "reservations") await loadReservations(hallResFilter);
            if (hallSubTab === "block") await loadHallBlockList();
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

      document.querySelector("#hall-venue-form")?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.target);
        try {
          await hallApi("admin-venue-settings-save", {
            method: "PUT",
            body: {
              hallOpenTime: fd.get("hallOpenTime"),
              hallCloseTime: fd.get("hallCloseTime"),
            },
          });
          alert("Zapisano godziny.");
          await loadVenueSettings();
        } catch (err) {
          alert(err.message);
        }
      });

      document.querySelectorAll(".hall-edit").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.getAttribute("data-id");
          const h = hallsData.find((x) => x.id === id);
          if (!h) return;
          const name = prompt("Nazwa sali", h.name || "");
          if (name === null) return;
          const cap = Number(prompt("Pojemność", String(h.capacity || 40)));
          const active = confirm("Aktywna (widoczna na froncie)?");
          const bufferMinutes = Number(prompt("Bufor między rezerwacjami (minuty)", String(h.bufferMinutes ?? 60)));
          const fullBlockGuestThreshold = Number(
            prompt("Próg pełnej blokacji dużej sali (goście)", String(h.fullBlockGuestThreshold ?? 100))
          );
          const description = prompt("Opis", h.description || "") || "";
          try {
            await hallApi("admin-hall-upsert", {
              method: "PUT",
              body: {
                id,
                name: name.trim(),
                capacity: cap,
                active,
                bufferMinutes,
                fullBlockGuestThreshold,
                description,
                hallKind: h.hallKind,
                exclusiveRule: h.exclusiveRule,
                sortOrder: h.sortOrder ?? 1,
              },
            });
            await loadHalls();
            hallSubTab = "halls";
            paint();
          } catch (err) {
            alert(err.message);
          }
        });
      });

      document.querySelector("#hall-res-filter")?.addEventListener("change", async () => {
        hallResFilter = document.querySelector("#hall-res-filter").value;
        await loadReservations(hallResFilter);
        document.querySelector("#hall-sub-content").innerHTML =
          hallSubTab === "reservations" ? renderReservations() : "";
        const hf = document.querySelector("#hall-res-filter");
        if (hf) hf.value = hallResFilter;
        bindSub();
      });
      document.querySelector("#hall-res-refresh")?.addEventListener("click", async () => {
        await loadReservations(hallResFilter);
        document.querySelector("#hall-sub-content").innerHTML =
          hallSubTab === "reservations" ? renderReservations() : "";
        const hf = document.querySelector("#hall-res-filter");
        if (hf) hf.value = hallResFilter;
        bindSub();
      });

      document.querySelector("#hall-res-new")?.addEventListener("click", () => openManualHallModal());

      document.querySelectorAll(".hall-res-edit").forEach((btn) => {
        btn.addEventListener("click", () => openHallEditorModal(btn.getAttribute("data-id")));
      });
      document.querySelectorAll(".hall-res-cancel").forEach((btn) => {
        btn.addEventListener("click", () => quickCancelHall(btn.getAttribute("data-id")));
      });

      document.querySelector("#hall-block-form")?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.target);
        try {
          await hallApi("admin-reservation-create", {
            method: "POST",
            body: {
              hallId: fd.get("hallId"),
              reservationDate: fd.get("reservationDate"),
              startTime: fd.get("startTime"),
              durationHours: Number(fd.get("durationHours")),
              guestsCount: 0,
              exclusive: true,
              eventType: "Blokada terminu",
              fullName: "Blokada terminu",
              email: firebase.auth().currentUser?.email || "noreply@local",
              phonePrefix: "+48",
              phoneNational: "501234567",
              customerNote: "",
              adminNote: fd.get("note") || "",
              status: "manual_block",
            },
          });
          alert("Blokada utworzona.");
          ev.target.reset();
          await loadHallBlockList();
          hallSubTab = "block";
          paint();
        } catch (err) {
          alert(err.message);
        }
      });

      document.querySelectorAll(".hall-save-tpl").forEach((btn) => {
        btn.addEventListener("click", () => {
          const key = btn.getAttribute("data-key");
          const subj = document.querySelector(`[data-hall-tpl-key="${key}"][data-field="subject"]`);
          const bodyHidden = document.querySelector(`[data-hall-tpl-key="${key}"][data-field="bodyHtml-hidden"]`);
          const newBodyHtml = bodyHidden?.value || "";
          hallApi("admin-mail-template-save", {
            method: "PUT",
            body: {
              key,
              subject: subj?.value || "",
              bodyHtml: newBodyHtml,
              actionLabel: document.querySelector(`[data-hall-tpl-key="${key}"][data-field="actionLabel"]`)?.value ?? "",
            },
          })
            .then(() => alert("Zapisano."))
            .catch((err) => alert(err.message));
        });
      });
      bindHallTemplatePreviews();
      bindWysiwygEditors();

      countdownTimer = setInterval(() => {
        document.querySelectorAll(".hall-countdown").forEach((el) => {
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

    function closeHallExtraModal() {
      document.getElementById("hall-extra-modal-mount")?.remove();
      document.body.classList.remove("admin-modal-open");
    }

    async function quickCancelHall(id) {
      const cancelReason = window.prompt("Podaj powód anulowania rezerwacji:");
      if (cancelReason == null) return;
      if (!String(cancelReason).trim()) {
        alert("Powód anulowania jest wymagany.");
        return;
      }
      try {
        await hallApi("admin-reservation-cancel", { method: "POST", body: { id, cancelReason } });
        await loadReservations(hallResFilter);
        document.querySelector("#hall-sub-content").innerHTML = renderReservations();
        const hf = document.querySelector("#hall-res-filter");
        if (hf) hf.value = hallResFilter;
        bindSub();
      } catch (err) {
        alert(err.message);
      }
    }

    function openManualHallModal() {
      closeHallExtraModal();
      const hallOpts = hallsData
        .map((h) => `<option value="${escapeHtml(h.id)}">${escapeHtml(h.name || h.id)}</option>`)
        .join("");
      const host = document.createElement("div");
      host.id = "hall-extra-modal-mount";
      host.innerHTML = `
        <div class="admin-modal-overlay" data-hall-extra-overlay>
          <section class="admin-modal menu-editor-modal hotel-room-editor-modal" role="dialog" aria-modal="true">
            <form id="hall-manual-form" class="stack">
              <div class="admin-modal-head menu-editor-modal-head">
                <h3>Utwórz rezerwację</h3>
                <button type="button" class="button secondary" data-hall-extra-close>Zamknij</button>
              </div>
              <p class="helper">Domyślnie status <strong>zarezerwowane</strong>. Odznacz, aby utworzyć jako oczekujące na akceptację.</p>
              <label>Sala<select name="hallId" required>${hallOpts}</select></label>
              <label>Data<input name="reservationDate" type="date" required /></label>
              <div class="field-grid">
                <label>Start (HH:MM)<input name="startTime" required placeholder="12:00" /></label>
                <label>Czas (h)<input name="durationHours" type="number" step="0.5" min="0.5" value="3" required /></label>
              </div>
              <label>Goście<input name="guestsCount" type="number" min="1" value="20" required /></label>
              <label class="admin-check-line" data-hall-exclusive-field><input type="checkbox" name="exclusive" checked /> <span>Sala na wyłączność (tam gdzie dotyczy)</span></label>
              <label>Rodzaj imprezy<input name="eventType" value="Spotkanie" /></label>
              <label>Imię i nazwisko<input name="fullName" required /></label>
              <label>E-mail<input name="email" type="email" /></label>
              <div class="field-grid">
                <label>Prefiks<input name="phonePrefix" value="+48" /></label>
                <label>Numer<input name="phoneNational" /></label>
              </div>
              <label>Uwagi<textarea name="customerNote" rows="2"></textarea></label>
              <label class="admin-check-line"><input type="checkbox" name="asPending" /> <span>Oczekuje na akceptację</span></label>
              <div class="admin-modal-footer hotel-room-editor-footer">
                <button type="button" class="button secondary" data-hall-extra-close>Anuluj</button>
                <button type="submit" class="button">Utwórz</button>
              </div>
            </form>
          </section>
        </div>`;
      document.body.appendChild(host);
      document.body.classList.add("admin-modal-open");
      const form = host.querySelector("#hall-manual-form");
      syncHallExclusiveVisibility(form);
      form?.querySelector('[name="hallId"]')?.addEventListener("change", () => syncHallExclusiveVisibility(form));
      host.querySelectorAll("[data-hall-extra-close]").forEach((b) => b.addEventListener("click", closeHallExtraModal));
      host.querySelector("[data-hall-extra-overlay]")?.addEventListener("click", (ev) => {
        if (ev.target === ev.currentTarget) closeHallExtraModal();
      });
      form?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.target);
        const status = fd.get("asPending") === "on" ? "pending" : "confirmed";
        try {
          await hallApi("admin-reservation-create", {
            method: "POST",
            body: {
              hallId: fd.get("hallId"),
              reservationDate: fd.get("reservationDate"),
              startTime: fd.get("startTime"),
              durationHours: Number(fd.get("durationHours")),
              guestsCount: Number(fd.get("guestsCount")),
              exclusive: hallIsSmall(fd.get("hallId")) ? true : fd.get("exclusive") === "on",
              eventType: fd.get("eventType") || "—",
              fullName: fd.get("fullName"),
              email: String(fd.get("email") || "").trim(),
              phonePrefix: String(fd.get("phoneNational") || "").trim() ? String(fd.get("phonePrefix") || "+48").trim() : "",
              phoneNational: String(fd.get("phoneNational") || "").trim(),
              customerNote: fd.get("customerNote") || "",
              adminNote: "",
              status,
            },
          });
          closeHallExtraModal();
          await loadReservations(hallResFilter);
          hallSubTab = "reservations";
          paint();
        } catch (err) {
          alert(err.message);
        }
      });
    }

    async function openHallEditorModal(id) {
      const base = hallApiBase();
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
      closeHallExtraModal();
      const hallOpts = hallsData
        .map((h) => `<option value="${escapeHtml(h.id)}" ${h.id === r.hallId ? "selected" : ""}>${escapeHtml(h.name || h.id)}</option>`)
        .join("");
      const host = document.createElement("div");
      host.id = "hall-extra-modal-mount";
      host.innerHTML = `
        <div class="admin-modal-overlay" data-hall-extra-overlay>
          <section class="admin-modal menu-editor-modal hotel-room-editor-modal" role="dialog" aria-modal="true">
            <form id="hall-edit-form" class="stack">
              <div class="admin-modal-head menu-editor-modal-head">
                <div>
                  <p class="pill">${escapeHtml(reservationNumber)}</p>
                  <h3>Edycja</h3>
                  <p class="helper">${escapeHtml(r.statusLabel || r.status)}</p>
                </div>
                <button type="button" class="button secondary" data-hall-extra-close>Zamknij</button>
              </div>
              <label>Sala<select name="hallId" required>${hallOpts}</select></label>
              <label>Data<input name="reservationDate" type="date" value="${escapeHtml(r.reservationDate || "")}" required /></label>
              <div class="field-grid">
                <label>Start<input name="startTime" value="${escapeHtml(r.startTime || "")}" required /></label>
                <label>Czas (h)<input name="durationHours" type="number" step="0.5" min="0.5" value="${escapeHtml(String(r.durationHours || 2))}" required /></label>
              </div>
              <label>Goście<input name="guestsCount" type="number" min="0" value="${escapeHtml(String(r.guestsCount ?? 0))}" required /></label>
              <label class="admin-check-line" data-hall-exclusive-field><input type="checkbox" name="exclusive" ${r.exclusive ? "checked" : ""} /> <span>Wyłączność</span></label>
              <label>Impreza<input name="eventType" value="${escapeHtml(r.eventType || "")}" /></label>
              <label>Imię i nazwisko<input name="fullName" value="${escapeHtml(r.fullName || "")}" required /></label>
              <label>E-mail<input name="email" type="email" value="${escapeHtml(r.email || "")}" required /></label>
              <div class="field-grid">
                <label>Prefiks<input name="phonePrefix" value="${escapeHtml(r.phonePrefix || "+48")}" /></label>
                <label>Numer<input name="phoneNational" value="${escapeHtml(r.phoneNational || "")}" required /></label>
              </div>
              <label>Uwagi<textarea name="customerNote" rows="2">${escapeHtml(r.customerNote || "")}</textarea></label>
              <label>Notatka<textarea name="adminNote" rows="2">${escapeHtml(r.adminNote || "")}</textarea></label>
              <div class="admin-modal-footer hotel-room-editor-footer" style="flex-wrap:wrap;gap:0.5rem">
                <button type="button" class="button secondary" data-hall-extra-close>Anuluj</button>
                ${r.status === "pending" && r.extendAvailable ? `<button type="button" class="button secondary" id="hall-extend-pending">Przedłuż oczekiwanie (+7 dni)</button>` : ""}
                ${r.status === "pending" ? `<button type="button" class="button secondary" id="hall-confirm-quick">Potwierdź</button>` : ""}
                <button type="submit" class="button">Zapisz zmiany</button>
              </div>
            </form>
          </section>
        </div>`;
      document.body.appendChild(host);
      document.body.classList.add("admin-modal-open");
      const form = host.querySelector("#hall-edit-form");
      syncHallExclusiveVisibility(form);
      form?.querySelector('[name="hallId"]')?.addEventListener("change", () => syncHallExclusiveVisibility(form));
      host.querySelectorAll("[data-hall-extra-close]").forEach((b) => b.addEventListener("click", closeHallExtraModal));
      host.querySelector("[data-hall-extra-overlay]")?.addEventListener("click", (ev) => {
        if (ev.target === ev.currentTarget) closeHallExtraModal();
      });
      host.querySelector("#hall-extend-pending")?.addEventListener("click", async () => {
        try {
          await hallApi("admin-extend-pending", { method: "POST", body: { id } });
          alert("Przedłużono.");
          closeHallExtraModal();
          await loadReservations(hallResFilter);
          document.querySelector("#hall-sub-content").innerHTML = renderReservations();
          const hf = document.querySelector("#hall-res-filter");
          if (hf) hf.value = hallResFilter;
          bindSub();
        } catch (err) {
          alert(err.message);
        }
      });
      host.querySelector("#hall-confirm-quick")?.addEventListener("click", async () => {
        if (!confirm("Potwierdzić i wysłać e-mail?")) return;
        try {
          await hallApi("admin-reservation-confirm", { method: "POST", body: { id } });
          closeHallExtraModal();
          await loadReservations(hallResFilter);
          document.querySelector("#hall-sub-content").innerHTML = renderReservations();
          const hf = document.querySelector("#hall-res-filter");
          if (hf) hf.value = hallResFilter;
          bindSub();
        } catch (err) {
          alert(err.message);
        }
      });
      form?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.target);
        const notifyClient = confirm("Wysłać e-mail o zmianach do klienta?\n\nOK — tak\nAnuluj — nie");
        try {
          await hallApi("admin-reservation-update", {
            method: "PATCH",
            body: {
              id,
              hallId: fd.get("hallId"),
              reservationDate: fd.get("reservationDate"),
              startTime: fd.get("startTime"),
              durationHours: Number(fd.get("durationHours")),
              guestsCount: Number(fd.get("guestsCount")),
              exclusive: hallIsSmall(fd.get("hallId")) ? true : fd.get("exclusive") === "on",
              eventType: fd.get("eventType") || "",
              fullName: fd.get("fullName"),
              email: fd.get("email"),
              phonePrefix: fd.get("phonePrefix") || "+48",
              phoneNational: fd.get("phoneNational"),
              customerNote: fd.get("customerNote") || "",
              adminNote: fd.get("adminNote") || "",
              notifyClient,
            },
          });
          closeHallExtraModal();
          await loadReservations(hallResFilter);
          document.querySelector("#hall-sub-content").innerHTML = renderReservations();
          const hf = document.querySelector("#hall-res-filter");
          if (hf) hf.value = hallResFilter;
          bindSub();
        } catch (err) {
          alert(err.message);
        }
      });
    }

    paint();
  }

  window.renderHallAdminPanel = renderHallAdminPanel;
})();
