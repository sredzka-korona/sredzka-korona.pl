/**
 * Panel admina — moduł Restauracja (restaurantApi).
 */
(function () {
  const config = window.SREDZKA_CONFIG || {};

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
      const hint =
        data.error ||
        data.message ||
        (data._nonJson ? `Odpowiedź serwera (${res.status}): ${data._nonJson}` : "");
      throw new Error(hint || `Błąd API restauracji (HTTP ${res.status}).`);
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

  function parseTimeToMinutes(value) {
    const match = String(value || "").trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  let restSubTab = "reservations";
  let restResFilter = "active";
  let settingsData = {};
  let tablesData = [];
  let reservationsData = [];
  let blockListData = [];
  let templatesData = {};
  let countdownTimer = null;

  const REST_TEMPLATE_LABELS = {
    restaurant_confirm_email: "Link potwierdzający adres e-mail po wysłaniu formularza rezerwacji stolika.",
    rest_confirm_email: "To samo co powyżej (alternatywny klucz szablonu).",
    restaurant_pending_admin: "Powiadomienie dla obsługi — nowa rezerwacja stolika.",
    rest_pending_admin: "To samo — wariant skrócony.",
    restaurant_confirmed_client: "Klient — stolik potwierdzony.",
    rest_confirmed_client: "To samo — wariant skrócony.",
    restaurant_cancelled_client: "Klient — rezerwacja anulowana.",
    rest_cancelled_client: "To samo — wariant skrócony.",
    restaurant_changed_client: "Po edycji rezerwacji przez admina (opcjonalna wysyłka).",
    rest_changed_client: "To samo — wariant skrócony.",
    restaurant_expired_pending_client: "Klient — wygasło oczekiwanie na decyzję restauracji.",
    restaurant_expired_pending_admin: "Obsługa — informacja o automatycznym wygaśnięciu rezerwacji.",
    restaurant_expired_email_client: "Klient — nie potwierdzono adresu e-mail w terminie 2 godzin.",
  };

  const REST_TEMPLATE_PREVIEW_VARS = Object.freeze({
    reservationNumber: "5/2026/RESTAURACJA",
    reservationSubject: "Kolacja degustacyjna",
    decisionDeadline: "6 maja 2026, godz. 16:00",
    fullName: "Marek Nowak",
    email: "marek.nowak@example.com",
    phone: "+48 601 222 333",
    date: "8 maja 2026",
    timeFrom: "19:00",
    timeTo: "22:00",
    durationHours: "3",
    tablesList: "Stolik 4 i 5",
    guestsCount: "6",
    customerNote: "Prosimy o spokojne miejsce, krzesełko dla dziecka i możliwość wniesienia tortu.",
    confirmationLink: "https://www.sredzkakorona.pl/restauracja/potwierdzenie?token=podglad",
    restaurantName: "Restauracja Średzka Korona",
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

  function restaurantMailHeaderContext(key) {
    const k = String(key || "")
      .replace(/^restaurant_/i, "")
      .replace(/^rest_/i, "");
    const map = {
      confirm_email: "Potwierdzenie rezerwacji stolika",
      pending_admin: "Rezerwacja stolika — powiadomienie dla obsługi",
      confirmed_client: "Potwierdzenie rezerwacji stolika",
      cancelled_client: "Odwołanie rezerwacji stolika",
      changed_client: "Zmiana rezerwacji stolika",
      expired_pending_client: "Wygaśnięcie rezerwacji stolika",
      expired_pending_admin: "Wygaśnięcie rezerwacji — informacja dla obsługi",
      expired_email_client: "Wygasłe potwierdzenie — rezerwacja stolika",
    };
    return map[k] || "Wiadomość o rezerwacji";
  }

  function buildMailPreviewMarkup({ inboxSubject, headerContext, headerNumber, bodyHtml, footerLabel, actionLabel = "" }) {
    return `
      <div class="mail-preview-shell">
        <div class="mail-preview-note">Podgląd na przykładowych danych. Branding i układ odpowiadają faktycznie wysyłanej wiadomości.</div>
        <div class="mail-preview-inbox-subject">Temat w skrzynce: <strong>${escapeHtml(inboxSubject || "—")}</strong></div>
        <div class="mail-preview-frame">
          <div class="mail-preview-canvas">
            <div class="mail-preview-brand" aria-label="Średzka Korona">
              <span>ŚREDZKA</span>
              <img src="/ikony/logo-korona.png" alt="Korona" width="42" height="42" />
              <span>KORONA</span>
            </div>
            <div class="mail-preview-card">
              <div class="mail-preview-header-stack">
                <div class="mail-preview-header-brand">Średzka Korona</div>
                <div class="mail-preview-header-context">${escapeHtml(headerContext || "")}</div>
                <div class="mail-preview-header-number">nr ${escapeHtml(headerNumber || "")}</div>
              </div>
              ${actionLabel ? `<a class="mail-preview-button" href="#" onclick="return false;">${escapeHtml(actionLabel)}</a>` : ""}
              <div class="mail-preview-body">${bodyHtml || "<p>Brak treści wiadomości.</p>"}</div>
            </div>
            <div class="mail-preview-footer">
              <div>Wiadomość transakcyjna dotycząca rezerwacji w obiekcie Średzka Korona.</div>
              <div class="mail-preview-footer-link">${escapeHtml(footerLabel)}</div>
              <div>Jeśli masz pytania, odpowiedz na tę wiadomość.</div>
            </div>
          </div>
        </div>
      </div>`;
  }

  function restaurantPreviewActionLabel(key) {
    return key === "restaurant_confirm_email" || key === "rest_confirm_email"
      ? "Potwierdź adres e-mail"
      : "";
  }

  function updateRestaurantTemplatePreview(key) {
    if (!key) return;
    const subjectField = document.querySelector(`[data-rest-tpl-key="${key}"][data-field="subject"]`);
    const bodyField = document.querySelector(`[data-rest-tpl-key="${key}"][data-field="bodyHtml"]`);
    const previewHost = document.querySelector(`[data-rest-preview-key="${key}"]`);
    if (!subjectField || !bodyField || !previewHost) return;
    const renderedSubject = renderTemplatePreviewString(subjectField.value, REST_TEMPLATE_PREVIEW_VARS);
    const renderedBody = sanitizeTemplatePreviewHtml(
      renderTemplatePreviewString(bodyField.value, REST_TEMPLATE_PREVIEW_VARS)
    );
    previewHost.innerHTML = buildMailPreviewMarkup({
      inboxSubject: renderedSubject,
      headerContext: restaurantMailHeaderContext(key),
      headerNumber: REST_TEMPLATE_PREVIEW_VARS.reservationNumber,
      bodyHtml: renderedBody,
      footerLabel: "Restauracja Średzka Korona",
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

  async function loadSettings() {
    const d = await restaurantApi("admin-settings", { method: "GET" });
    settingsData = d.settings || {};
  }

  async function loadTables() {
    const d = await restaurantApi("admin-tables-list", { method: "GET" });
    tablesData = d.tables || [];
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

  async function loadBlockList() {
    const base = restaurantApiBase();
    const token = await firebase.auth().currentUser.getIdToken();
    const res = await fetch(`${base}?op=admin-reservations-list&status=${encodeURIComponent("manual_block")}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || "Błąd");
    blockListData = d.reservations || [];
  }

  async function loadTemplates() {
    const d = await restaurantApi("admin-mail-templates", { method: "GET" });
    templatesData = d.templates || {};
  }

  function currentRestaurantTableCount() {
    return Math.max(0, Array.isArray(tablesData) ? tablesData.length : 0);
  }

  function currentRestaurantTableLimit() {
    return Math.max(0, currentRestaurantTableCount() || Number(settingsData.tableCount || 0) || 0);
  }

  function renderSettings() {
    const s = settingsData;
    return `
      <div class="hotel-subpanel">
        <h3>Ustawienia restauracji</h3>
        <p class="helper">Aktualnie aktywnych stolików: <strong>${currentRestaurantTableCount()}</strong>. Dodawanie i usuwanie stolików znajdziesz w zakładce „Stoliki”.</p>
        <form id="rest-settings-form" class="stack">
          <div class="field-grid">
            <label>Max osób przy 1 stoliku<input name="maxGuestsPerTable" type="number" min="1" max="50" value="${escapeHtml(String(s.maxGuestsPerTable ?? 4))}" required /></label>
            <label>Rezerwacje od (HH:MM)<input name="reservationOpenTime" value="${escapeHtml(s.reservationOpenTime || "12:00")}" required /></label>
            <label>Rezerwacje do (HH:MM)<input name="reservationCloseTime" value="${escapeHtml(s.reservationCloseTime || "22:00")}" required /></label>
            <label>Krok slotów (minuty)
              <select name="timeSlotMinutes">
                <option value="15" ${Number(s.timeSlotMinutes) === 15 ? "selected" : ""}>15</option>
                <option value="30" ${Number(s.timeSlotMinutes) !== 15 ? "selected" : ""}>30</option>
                <option value="60" ${Number(s.timeSlotMinutes) === 60 ? "selected" : ""}>60</option>
              </select>
            </label>
          </div>
          <button type="submit" class="button">Zapisz ustawienia</button>
        </form>
        <p class="helper" id="rest-settings-warn"></p>
      </div>`;
  }

  function renderTables() {
    const activeCount = currentRestaurantTableCount();
    const body = tablesData
      .map(
        (t) => `
      <tr data-id="${escapeHtml(t.id)}">
        <td>${escapeHtml(String(t.number ?? ""))}</td>
        <td>Aktywny</td>
        <td><button type="button" class="button secondary rest-remove-table" data-id="${escapeHtml(t.id)}" data-number="${escapeHtml(String(t.number ?? ""))}">Usuń</button></td>
      </tr>`
      )
      .join("");
    return `
      <div class="hotel-subpanel">
        <div class="admin-toolbar-row hotel-filters">
          <div class="admin-toolbar-filters">
            <h3>Stoliki (${activeCount})</h3>
          </div>
          <div class="admin-toolbar-actions">
            <button type="button" class="button" id="rest-table-add">Dodaj stolik</button>
          </div>
        </div>
        <p class="helper">Tutaj zarządzasz wyłącznie liczbą dostępnych stolików. Każda aktywna rezerwacja odejmuje tyle stolików z puli, ile została zarezerwowana.</p>
        <div class="table-scroll">
          <table class="hotel-table">
            <thead><tr><th>Nr</th><th>Status</th><th></th></tr></thead>
            <tbody>${body || "<tr><td colspan='3'>Brak aktywnych stolików.</td></tr>"}</tbody>
          </table>
        </div>
      </div>`;
  }

  function renderReservations() {
    const rows = reservationsData
      .map(
        (r) => `
      <tr>
        <td>${escapeHtml(r.humanNumberLabel || r.humanNumber || r.id)}</td>
        <td>${escapeHtml(r.reservationDate || "")}</td>
        <td>${formatMs(r.startDateTime)}</td>
        <td>${formatMs(r.endDateTime)}</td>
        <td>${escapeHtml(String(r.durationHours ?? ""))}</td>
        <td>${escapeHtml(String(r.tablesCount ?? ""))}</td>
        <td>${escapeHtml(r.assignedTablesLabel || "—")}</td>
        <td>${escapeHtml(String(r.guestsCount ?? ""))}</td>
        <td>${r.joinTables ? "tak" : "nie"}</td>
        <td>${escapeHtml(r.fullName || "")}</td>
        <td>${escapeHtml(r.email || "")}</td>
        <td>${escapeHtml(r.phone || "")}</td>
        <td class="rest-countdown" data-pending="${r.pendingExpiresAt || ""}" data-email-exp="${r.emailVerificationExpiresAt || ""}" data-status="${escapeHtml(r.status)}">${r.status === "pending" ? countdown(r.pendingExpiresAt) : r.status === "email_verification_pending" ? countdown(r.emailVerificationExpiresAt) : "—"}</td>
        <td>${escapeHtml(r.statusLabel || r.status)}</td>
        <td>${formatMs(r.createdAtMs)}</td>
        <td class="admin-row-actions">
          <button type="button" class="button secondary rest-res-edit" data-id="${escapeHtml(r.id)}">Edytuj</button>
          <button type="button" class="button secondary danger-muted rest-res-cancel" data-id="${escapeHtml(r.id)}">Anuluj</button>
        </td>
      </tr>`
      )
      .join("");
    return `
      <div class="hotel-subpanel">
        <h3>Rezerwacje restauracji</h3>
        <p class="helper">Domyślnie: rezerwacje <strong>oczekujące</strong> i <strong>zarezerwowane</strong>. Pozostałe statusy — z listy.</p>
        <div class="admin-toolbar-row hotel-filters">
          <div class="admin-toolbar-filters">
            <label>Status <select id="rest-res-filter">
            <option value="active">Aktywne (oczekujące + zarezerwowane)</option>
            <option value="all">Wszystkie statusy</option>
            <option value="pending">Tylko oczekujące</option>
            <option value="confirmed">Tylko zarezerwowane</option>
            <option value="cancelled">Anulowane</option>
            <option value="expired">Wygasłe</option>
            <option value="email_verification_pending">E-mail do potwierdzenia</option>
            <option value="manual_block">Blokady stolików</option>
          </select></label>
          </div>
          <div class="admin-toolbar-actions">
            <button type="button" class="button secondary icon-btn" id="rest-res-refresh" title="Odśwież" aria-label="Odśwież">↻</button>
            <button type="button" class="button" id="rest-res-new">Utwórz rezerwację</button>
          </div>
        </div>
        <div class="table-scroll">
          <table class="hotel-table">
            <thead><tr><th>Nr</th><th>Data</th><th>Od</th><th>Do</th><th>h</th><th>Stol.</th><th>Przydział</th><th>Goś.</th><th>Łącz.</th><th>Imię</th><th>E-mail</th><th>Tel</th><th>Czas</th><th>Status</th><th>Utw.</th><th></th></tr></thead>
            <tbody>${rows || "<tr><td colspan='16'>Brak</td></tr>"}</tbody>
          </table>
        </div>
      </div>`;
  }

  function renderTemplates() {
    const keys = Object.keys(templatesData);
    return `
      <div class="hotel-subpanel">
        <h3>Szablony mailingowe — restauracja</h3>
        <p class="helper">Zmienne: <code>{{reservationNumber}}</code> (np. 5/2026/RESTAURACJA), <code>{{reservationSubject}}</code>, <code>{{decisionDeadline}}</code>, <code>{{adminActionLink}}</code>, <code>{{fullName}}</code>, <code>{{email}}</code>, <code>{{phone}}</code>, <code>{{date}}</code>, <code>{{timeFrom}}</code>, <code>{{timeTo}}</code>, <code>{{durationHours}}</code>, <code>{{tablesList}}</code>, <code>{{guestsCount}}</code>, <code>{{customerNote}}</code>, <code>{{confirmationLink}}</code>, <code>{{restaurantName}}</code>.</p>
        <p class="helper">Logo, przycisk akcji i premium-layout wiadomości są dodawane automatycznie przy wysyłce. W polu poniżej edytujesz główną treść maila.</p>
        <p class="helper">Podgląd pokazuje od razu, jak mail będzie wyglądał po podstawieniu danych rezerwacji restauracyjnej.</p>
        <div id="rest-template-forms">
          ${keys
            .map(
              (k) => `
            <details class="hotel-template-card">
              <summary><span class="tpl-key">${escapeHtml(k)}</span>${REST_TEMPLATE_LABELS[k] ? `<span class="tpl-desc"> — ${escapeHtml(REST_TEMPLATE_LABELS[k])}</span>` : ""}</summary>
              <label>Temat<input type="text" data-rest-tpl-key="${escapeHtml(k)}" data-field="subject" value="${escapeHtml(templatesData[k]?.subject || "")}" /></label>
              <label>Treść HTML<textarea data-rest-tpl-key="${escapeHtml(k)}" data-field="bodyHtml" rows="18">${escapeHtml(templatesData[k]?.bodyHtml || "")}</textarea></label>
              <div class="mail-preview-panel">
                <div class="mail-preview-panel-head">
                  <strong>Podgląd wiadomości</strong>
                  <span class="helper">Wersja z przykładową rezerwacją stolika i realnym brandingiem.</span>
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

  function renderBlockForm() {
    const tableChecks = tablesData
      .map(
        (t) => `
      <label class="admin-check-line">
        <input type="checkbox" name="tableId" value="${escapeHtml(t.id)}" />
        <span>Stół ${escapeHtml(String(t.number))}</span>
      </label>`
      )
      .join("");
    const blockRows = blockListData
      .map(
        (b) => `
      <tr>
        <td>${escapeHtml(b.humanNumberLabel || b.humanNumber || b.id)}</td>
        <td>${escapeHtml(b.reservationDate || "")}</td>
        <td>${formatMs(b.startDateTime)} – ${formatMs(b.endDateTime)}</td>
        <td>${escapeHtml(b.assignedTablesLabel || "—")}</td>
        <td>${escapeHtml(b.adminNote || b.customerNote || "—")}</td>
      </tr>`
      )
      .join("");
    return `
      <div class="hotel-subpanel">
        <h3>Blokada stolików</h3>
        <p class="helper">Blokada zajmuje wybrane stoliki w wybranym przedziale czasu (wpis ze statusem „Blokada” — np. impreza zamknięta, serwis). To nie jest rezerwacja gościa z formularza.</p>
        <form id="rest-block-form" class="stack">
          <label>Data<input name="reservationDate" type="date" required /></label>
          <div class="field-grid">
            <label>Od (HH:MM)<input name="startTime" required placeholder="18:00" /></label>
            <label>Do (HH:MM)<input name="endTime" required placeholder="22:00" /></label>
          </div>
          <fieldset class="admin-room-fieldset">
            <legend>Stoliki</legend>
            <label class="admin-check-line admin-check-all">
              <input type="checkbox" id="rest-block-all-tables" />
              <span>Zaznacz / odznacz wszystkie</span>
            </label>
            <div class="admin-room-checks">${tableChecks || "<p class=\"helper\">Brak stolików — dodaj je w zakładce Stoliki.</p>"}</div>
          </fieldset>
          <label>Notatka<input name="note" placeholder="np. wieczór zamknięty" /></label>
          <button type="submit" class="button">Utwórz blokadę</button>
        </form>
        <h4 class="admin-subheading">Utworzone blokady</h4>
        <div class="table-scroll">
          <table class="hotel-table">
            <thead><tr><th>Nr</th><th>Data</th><th>Godziny</th><th>Stoliki</th><th>Notatka</th></tr></thead>
            <tbody>${blockRows || "<tr><td colspan='5'>Brak</td></tr>"}</tbody>
          </table>
        </div>
      </div>`;
  }

  async function renderRestaurantAdminPanel(container, options = {}) {
    if (!container) return;
    if (options.defaultTab) {
      restSubTab = options.defaultTab;
    }
    const allowedTabs = Array.isArray(options.allowedTabs) && options.allowedTabs.length
      ? options.allowedTabs.map((tab) => String(tab || "").trim()).filter(Boolean)
      : null;
    container.innerHTML = `<p class="status">Ładowanie modułu Restauracja…</p>`;
    try {
      await loadSettings();
      await loadTables();
      await loadReservations("active");
      await loadTemplates();
    } catch (e) {
      container.innerHTML = `<p class="status">${escapeHtml(e.message)}</p>`;
      return;
    }

    function paint() {
      const sub = {
        settings: renderSettings(),
        tables: renderTables(),
        reservations: renderReservations(),
        templates: renderTemplates(),
        block: renderBlockForm(),
      };
      const availableTabs = [
        { key: "reservations", label: "Rezerwacje" },
        { key: "block", label: "Blokada stolików" },
        { key: "tables", label: "Stoliki" },
        { key: "settings", label: "Ustawienia" },
        { key: "templates", label: "Szablony mailingowe" },
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
          <p class="pill">Restauracja</p>
          <h2>${escapeHtml(availableTabs.length === 1 ? activeSubTab.label : "Rezerwacje stolików")}</h2>
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
            if (restSubTab === "reservations") await loadReservations(restResFilter);
            if (restSubTab === "block") await loadBlockList();
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

      document.querySelector("#rest-settings-form")?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.target);
        const warn = document.querySelector("#rest-settings-warn");
        const openTime = String(fd.get("reservationOpenTime") || "").trim();
        const closeTime = String(fd.get("reservationCloseTime") || "").trim();
        const openMinutes = parseTimeToMinutes(openTime);
        const closeMinutes = parseTimeToMinutes(closeTime);
        if (openMinutes == null || closeMinutes == null) {
          if (warn) warn.textContent = "Podaj godziny w formacie HH:MM.";
          alert("Podaj godziny w formacie HH:MM.");
          return;
        }
        if (openMinutes > closeMinutes) {
          if (warn) warn.textContent = "Godzina otwarcia nie może być później niż godzina zamknięcia.";
          alert("Godzina otwarcia nie może być później niż godzina zamknięcia.");
          return;
        }
        try {
          const out = await restaurantApi("admin-settings-save", {
            method: "PUT",
            body: {
              maxGuestsPerTable: fd.get("maxGuestsPerTable"),
              reservationOpenTime: openTime,
              reservationCloseTime: closeTime,
              timeSlotMinutes: fd.get("timeSlotMinutes"),
            },
          });
          warn.textContent = (out.warnings && out.warnings.length) ? out.warnings.join(" ") : "Zapisano.";
          await loadSettings();
          await loadTables();
        } catch (err) {
          alert(err.message);
        }
      });

      document.querySelector("#rest-table-add")?.addEventListener("click", async () => {
        try {
          await restaurantApi("admin-table-create", { method: "POST" });
          await loadSettings();
          await loadTables();
          restSubTab = "tables";
          paint();
        } catch (err) {
          alert(err.message);
        }
      });

      document.querySelectorAll(".rest-remove-table").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.getAttribute("data-id");
          const number = btn.getAttribute("data-number");
          if (!id) return;
          if (!confirm(`Usunąć stolik ${number}? Operacja zostanie zablokowana, jeśli stolik ma przyszłą rezerwację lub blokadę.`)) {
            return;
          }
          try {
            await restaurantApi("admin-table-delete", {
              method: "POST",
              body: { id },
            });
            await loadSettings();
            await loadTables();
            restSubTab = "tables";
            paint();
          } catch (err) {
            alert(err.message);
          }
        });
      });

      document.querySelector("#rest-res-filter")?.addEventListener("change", async () => {
        restResFilter = document.querySelector("#rest-res-filter").value;
        await loadReservations(restResFilter);
        document.querySelector("#rest-sub-content").innerHTML = renderReservations();
        const f = document.querySelector("#rest-res-filter");
        if (f) f.value = restResFilter;
        bindSub();
      });
      document.querySelector("#rest-res-refresh")?.addEventListener("click", async () => {
        await loadReservations(restResFilter);
        document.querySelector("#rest-sub-content").innerHTML = renderReservations();
        const f = document.querySelector("#rest-res-filter");
        if (f) f.value = restResFilter;
        bindSub();
      });

      document.querySelector("#rest-res-new")?.addEventListener("click", () => openManualRestaurantModal());

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
          const bodyEl = document.querySelector(`[data-rest-tpl-key="${key}"][data-field="bodyHtml"]`);
          restaurantApi("admin-mail-template-save", {
            method: "PUT",
            body: { key, subject: subj?.value || "", bodyHtml: bodyEl?.value || "" },
          })
            .then(() => alert("Zapisano."))
            .catch((err) => alert(err.message));
        });
      });
      bindRestaurantTemplatePreviews();

      document.querySelector("#rest-block-all-tables")?.addEventListener("change", (ev) => {
        const on = ev.target.checked;
        document.querySelectorAll('#rest-block-form input[name="tableId"]').forEach((cb) => {
          cb.checked = on;
        });
      });
      document.querySelector("#rest-block-form")?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.target);
        const ids = Array.from(ev.target.querySelectorAll('input[name="tableId"]:checked')).map((cb) => cb.value);
        if (!ids.length) {
          alert("Zaznacz co najmniej jeden stolik.");
          return;
        }
        try {
          await restaurantApi("admin-manual-block", {
            method: "POST",
            body: {
              reservationDate: fd.get("reservationDate"),
              startTime: fd.get("startTime"),
              endTime: fd.get("endTime"),
              tableIds: ids,
              note: fd.get("note"),
            },
          });
          alert("Blokada utworzona.");
          ev.target.reset();
          await loadBlockList();
          restSubTab = "block";
          paint();
        } catch (err) {
          alert(err.message);
        }
      });

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

    async function quickCancelRestaurant(id) {
      const cancelReason = window.prompt("Podaj powód anulowania rezerwacji:");
      if (cancelReason == null) return;
      if (!String(cancelReason).trim()) {
        alert("Powód anulowania jest wymagany.");
        return;
      }
      try {
        await restaurantApi("admin-reservation-cancel", { method: "POST", body: { id, cancelReason } });
        await loadReservations(restResFilter);
        document.querySelector("#rest-sub-content").innerHTML = renderReservations();
        const f = document.querySelector("#rest-res-filter");
        if (f) f.value = restResFilter;
        bindSub();
      } catch (err) {
        alert(err.message);
      }
    }

    function openManualRestaurantModal() {
      const tableLimit = currentRestaurantTableLimit();
      if (!tableLimit) {
        alert("Brak aktywnych stolików. Najpierw dodaj stolik w zakładce Stoliki.");
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
                <h3>Utwórz rezerwację</h3>
                <button type="button" class="button secondary" data-rest-extra-close>Zamknij</button>
              </div>
              <p class="helper">Domyślnie od razu <strong>zarezerwowana</strong>. Zaznacz niżej, jeśli ma czekać na akceptację.</p>
              <label>Data<input name="reservationDate" type="date" required /></label>
              <label>Start (HH:MM)<input name="startTime" required placeholder="18:00" /></label>
              <label>Czas trwania (h)<input name="durationHours" type="number" step="0.5" min="0.5" value="2" required /></label>
              <div class="field-grid">
                <label>Liczba stolików<input name="tablesCount" type="number" min="1" max="${escapeHtml(String(tableLimit))}" value="1" required /></label>
                <label>Liczba gości<input name="guestsCount" type="number" min="1" value="2" required /></label>
              </div>
              <p class="helper">Maksymalnie ${tableLimit} stolików w jednej rezerwacji, bo tyle jest teraz aktywnych.</p>
              <label class="admin-check-line"><input type="checkbox" name="joinTables" /> <span>Łączyć stoliki (jeśli możliwe)</span></label>
              <label>Imię i nazwisko<input name="fullName" required /></label>
              <label>E-mail<input name="email" type="email" /></label>
              <div class="field-grid">
                <label>Prefiks<input name="phonePrefix" value="+48" /></label>
                <label>Numer<input name="phoneNational" /></label>
              </div>
              <label>Uwagi<textarea name="customerNote" rows="2"></textarea></label>
              <label class="admin-check-line"><input type="checkbox" name="asPending" /> <span>Oczekuje na akceptację</span></label>
              <div class="admin-modal-footer hotel-room-editor-footer">
                <button type="button" class="button secondary" data-rest-extra-close>Anuluj</button>
                <button type="submit" class="button">Utwórz</button>
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
        const tablesCount = Number(fd.get("tablesCount") || 1);
        if (tablesCount > tableLimit) {
          alert(`Możesz wybrać maksymalnie ${tableLimit} stolików.`);
          return;
        }
        try {
          await restaurantApi("admin-reservation-create", {
            method: "POST",
            body: {
              reservationDate: fd.get("reservationDate"),
              startTime: fd.get("startTime"),
              durationHours: Number(fd.get("durationHours")),
              tablesCount,
              guestsCount: Number(fd.get("guestsCount")),
              joinTables: fd.get("joinTables") === "on",
              fullName: fd.get("fullName"),
              email: String(fd.get("email") || "").trim(),
              phonePrefix: String(fd.get("phoneNational") || "").trim() ? String(fd.get("phonePrefix") || "+48").trim() : "",
              phoneNational: String(fd.get("phoneNational") || "").trim(),
              customerNote: fd.get("customerNote") || "",
              adminNote: "",
              status,
            },
          });
          closeRestExtraModal();
          await loadReservations(restResFilter);
          restSubTab = "reservations";
          paint();
        } catch (err) {
          alert(err.message);
        }
      });
    }

    async function openRestaurantEditorModal(id) {
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
      const tableLimit = currentRestaurantTableLimit();
      if (!tableLimit) {
        alert("Brak aktywnych stolików. Najpierw dodaj stolik w zakładce Stoliki.");
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
                  <h3>Edycja rezerwacji</h3>
                  <p class="helper">${escapeHtml(r.statusLabel || r.status)} · Stoliki: ${escapeHtml(r.assignedTablesLabel || "—")}</p>
                </div>
                <button type="button" class="button secondary" data-rest-extra-close>Zamknij</button>
              </div>
              <label>Data<input name="reservationDate" type="date" value="${escapeHtml(r.reservationDate || "")}" required /></label>
              <label>Start (HH:MM)<input name="startTime" value="${escapeHtml(r.startTime || "")}" required /></label>
              <label>Czas trwania (h)<input name="durationHours" type="number" step="0.5" min="0.5" value="${escapeHtml(String(r.durationHours || 2))}" required /></label>
              <div class="field-grid">
                <label>Liczba stolików<input name="tablesCount" type="number" min="1" max="${escapeHtml(String(tableLimit))}" value="${escapeHtml(String(r.tablesCount || 1))}" required /></label>
                <label>Goście<input name="guestsCount" type="number" min="1" value="${escapeHtml(String(r.guestsCount || 1))}" required /></label>
              </div>
              <p class="helper">Aktualnie aktywnych stolików: ${tableLimit}.</p>
              <label class="admin-check-line"><input type="checkbox" name="joinTables" ${r.joinTables ? "checked" : ""} /> <span>Łączyć stoliki</span></label>
              <label>Imię i nazwisko<input name="fullName" value="${escapeHtml(r.fullName || "")}" required /></label>
              <label>E-mail<input name="email" type="email" value="${escapeHtml(r.email || "")}" required /></label>
              <div class="field-grid">
                <label>Prefiks<input name="phonePrefix" value="${escapeHtml(r.phonePrefix || "+48")}" /></label>
                <label>Numer<input name="phoneNational" value="${escapeHtml(r.phoneNational || "")}" required /></label>
              </div>
              <label>Uwagi<textarea name="customerNote" rows="2">${escapeHtml(r.customerNote || "")}</textarea></label>
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
        if (!confirm("Potwierdzić i wysłać e-mail do klienta?")) return;
        try {
          await restaurantApi("admin-reservation-confirm", { method: "POST", body: { id } });
          closeRestExtraModal();
          await loadReservations(restResFilter);
          document.querySelector("#rest-sub-content").innerHTML = renderReservations();
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
        const tablesCount = Number(fd.get("tablesCount") || 1);
        if (tablesCount > tableLimit) {
          alert(`Możesz wybrać maksymalnie ${tableLimit} stolików.`);
          return;
        }
        const notifyClient = confirm(
          "Wysłać e-mail o zmianach do klienta?\n\nOK — tak\nAnuluj — tylko zapis"
        );
        try {
          await restaurantApi("admin-reservation-update", {
            method: "PATCH",
            body: {
              id,
              reservationDate: fd.get("reservationDate"),
              startTime: fd.get("startTime"),
              durationHours: Number(fd.get("durationHours")),
              tablesCount,
              guestsCount: Number(fd.get("guestsCount")),
              joinTables: fd.get("joinTables") === "on",
              fullName: fd.get("fullName"),
              email: fd.get("email"),
              phonePrefix: fd.get("phonePrefix") || "+48",
              phoneNational: fd.get("phoneNational"),
              customerNote: fd.get("customerNote") || "",
              adminNote: fd.get("adminNote") || "",
              notifyClient,
            },
          });
          closeRestExtraModal();
          await loadReservations(restResFilter);
          document.querySelector("#rest-sub-content").innerHTML = renderReservations();
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
