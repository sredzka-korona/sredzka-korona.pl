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
    hall_pending_client: "Klient — zgłoszenie czeka na decyzję obiektu.",
    hall_pending_admin: "Powiadomienie dla obsługi — nowe zgłoszenie sali.",
    hall_confirmed_client: "Klient — rezerwacja sali zaakceptowana.",
    hall_cancelled_client: "Klient — rezerwacja anulowana.",
    hall_changed_client: "Po edycji zgłoszenia przez admina (opcjonalna wysyłka).",
  };

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
        <td>${escapeHtml(String(r.durationHours ?? ""))}</td>
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
          <button type="button" class="button secondary danger-muted hall-res-cancel" data-id="${escapeHtml(r.id)}">Anuluj</button>
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
        <p class="helper">Zmienne: <code>{{reservationNumber}}</code>, <code>{{fullName}}</code>, <code>{{hallName}}</code>, <code>{{date}}</code>, <code>{{timeFrom}}</code>, <code>{{timeTo}}</code>, <code>{{durationHours}}</code>, <code>{{guestsCount}}</code>, <code>{{eventType}}</code>, <code>{{exclusive}}</code>, <code>{{customerNote}}</code>, <code>{{confirmationLink}}</code>, <code>{{venueName}}</code>.</p>
        <div id="hall-template-forms">
          ${keys
            .map(
              (k) => `
            <details class="hotel-template-card">
              <summary><span class="tpl-key">${escapeHtml(k)}</span>${HALL_TEMPLATE_LABELS[k] ? `<span class="tpl-desc"> — ${escapeHtml(HALL_TEMPLATE_LABELS[k])}</span>` : ""}</summary>
              <label>Temat<input type="text" data-hall-tpl-key="${escapeHtml(k)}" data-field="subject" value="${escapeHtml(templatesData[k]?.subject || "")}" /></label>
              <label>Treść HTML<textarea data-hall-tpl-key="${escapeHtml(k)}" data-field="bodyHtml" rows="10">${escapeHtml(templatesData[k]?.bodyHtml || "")}</textarea></label>
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
        { key: "templates", label: "Szablony mailingowe" },
      ].filter((tab) => !allowedTabs || allowedTabs.includes(tab.key));
      if (!availableTabs.length) {
        container.innerHTML = `<section class="panel col-12"><p class="status">Brak dostepnych widokow tego modulu.</p></section>`;
        return;
      }
      if (!availableTabs.some((tab) => tab.key === hallSubTab)) {
        hallSubTab = availableTabs[0].key;
      }
      container.innerHTML = `
        <section class="panel col-12">
          <p class="pill">Sale</p>
          <h2>Rezerwacje sal</h2>
          <div class="hotel-nav${availableTabs.length === 1 ? " is-single" : ""}">
            ${availableTabs
              .map(
                (tab) =>
                  `<button type="button" class="button ${hallSubTab === tab.key ? "" : "secondary"}" data-hsub="${escapeHtml(tab.key)}">${escapeHtml(tab.label)}</button>`
              )
              .join("")}
          </div>
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
          const bodyEl = document.querySelector(`[data-hall-tpl-key="${key}"][data-field="bodyHtml"]`);
          hallApi("admin-mail-template-save", {
            method: "PUT",
            body: { key, subject: subj?.value || "", bodyHtml: bodyEl?.value || "" },
          })
            .then(() => alert("Zapisano."))
            .catch((err) => alert(err.message));
        });
      });

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
      if (!confirm("Anulować tę rezerwację? Klient może otrzymać e-mail.")) return;
      try {
        await hallApi("admin-reservation-cancel", { method: "POST", body: { id } });
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
              <label class="admin-check-line"><input type="checkbox" name="exclusive" checked /> <span>Sala na wyłączność (tam gdzie dotyczy)</span></label>
              <label>Rodzaj imprezy<input name="eventType" value="Spotkanie" /></label>
              <label>Imię i nazwisko<input name="fullName" required /></label>
              <label>E-mail<input name="email" type="email" required /></label>
              <div class="field-grid">
                <label>Prefiks<input name="phonePrefix" value="+48" /></label>
                <label>Numer<input name="phoneNational" required /></label>
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
      host.querySelectorAll("[data-hall-extra-close]").forEach((b) => b.addEventListener("click", closeHallExtraModal));
      host.querySelector("[data-hall-extra-overlay]")?.addEventListener("click", (ev) => {
        if (ev.target === ev.currentTarget) closeHallExtraModal();
      });
      host.querySelector("#hall-manual-form")?.addEventListener("submit", async (ev) => {
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
              exclusive: fd.get("exclusive") === "on",
              eventType: fd.get("eventType") || "—",
              fullName: fd.get("fullName"),
              email: fd.get("email"),
              phonePrefix: fd.get("phonePrefix") || "+48",
              phoneNational: fd.get("phoneNational"),
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
                  <p class="pill">${escapeHtml(r.humanNumberLabel || r.humanNumber)}</p>
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
              <label class="admin-check-line"><input type="checkbox" name="exclusive" ${r.exclusive ? "checked" : ""} /> <span>Wyłączność</span></label>
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
      host.querySelector("#hall-edit-form")?.addEventListener("submit", async (ev) => {
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
              exclusive: fd.get("exclusive") === "on",
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
