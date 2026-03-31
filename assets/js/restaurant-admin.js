/**
 * Panel admina — moduł Restauracja (restaurantApi).
 */
(function () {
  const config = window.SREDZKA_CONFIG || {};

  function restaurantApiBase() {
    if (config.restaurantApiBase) {
      return String(config.restaurantApiBase).replace(/\/$/, "");
    }
    if (config.firebaseProjectId) {
      return `https://europe-west1-${config.firebaseProjectId}.cloudfunctions.net/restaurantApi`;
    }
    return "";
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
      throw new Error(data.error || "Błąd API restauracji.");
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

  let restSubTab = "settings";
  let settingsData = {};
  let tablesData = [];
  let reservationsData = [];
  let templatesData = {};
  let countdownTimer = null;

  async function loadSettings() {
    const d = await restaurantApi("admin-settings", { method: "GET" });
    settingsData = d.settings || {};
  }

  async function loadTables() {
    const d = await restaurantApi("admin-tables-list", { method: "GET" });
    tablesData = d.tables || [];
  }

  async function loadReservations(status) {
    const q = status && status !== "all" ? `&status=${encodeURIComponent(status)}` : "";
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

  function renderSettings() {
    const s = settingsData;
    return `
      <div class="hotel-subpanel">
        <h3>Ustawienia restauracji</h3>
        <form id="rest-settings-form" class="stack">
          <div class="field-grid">
            <label>Liczba stolików (docelowa)<input name="tableCount" type="number" min="1" max="200" value="${escapeHtml(String(s.tableCount ?? 5))}" required /></label>
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
    const body = tablesData
      .map(
        (t) => `
      <tr data-id="${escapeHtml(t.id)}">
        <td>${escapeHtml(String(t.number ?? ""))}</td>
        <td>${escapeHtml(t.zone || "")}</td>
        <td>${t.active !== false ? "tak" : "nie"}</td>
        <td>${t.hidden ? "ukryty" : "widoczny"}</td>
        <td>${escapeHtml(t.description || "")}</td>
        <td><button type="button" class="button secondary rest-edit-table" data-id="${escapeHtml(t.id)}">Edytuj</button></td>
      </tr>`
      )
      .join("");
    return `
      <div class="hotel-subpanel">
        <h3>Stoliki (${tablesData.length})</h3>
        <p class="helper">Ukryte stoliki nie biorą udziału w automatycznym przydziale. Zwiększenie liczby stolików w ustawieniach tworzy brakujące numery.</p>
        <div class="table-scroll">
          <table class="hotel-table">
            <thead><tr><th>Nr</th><th>Strefa</th><th>Aktywny</th><th>Widoczność</th><th>Opis</th><th></th></tr></thead>
            <tbody>${body || "<tr><td colspan='6'>Brak</td></tr>"}</tbody>
          </table>
        </div>
      </div>`;
  }

  function renderReservations() {
    const rows = reservationsData
      .map(
        (r) => `
      <tr>
        <td>${escapeHtml(r.humanNumber || r.id)}</td>
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
        <td><button type="button" class="button secondary rest-res-detail" data-id="${escapeHtml(r.id)}">Szczegóły</button></td>
      </tr>`
      )
      .join("");
    return `
      <div class="hotel-subpanel">
        <h3>Rezerwacje restauracji</h3>
        <div class="hotel-filters">
          <button type="button" class="button secondary" id="rest-res-new">Nowa rezerwacja</button>
          <label>Filtr <select id="rest-res-filter">
            <option value="all">Wszystkie</option>
            <option value="pending">Oczekujące</option>
            <option value="confirmed">Zarezerwowane</option>
            <option value="cancelled">Anulowane</option>
            <option value="expired">Wygasłe</option>
            <option value="email_verification_pending">E-mail do potwierdzenia</option>
            <option value="manual_block">Blokady</option>
          </select></label>
          <button type="button" class="button" id="rest-res-refresh">Odśwież</button>
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
        <p class="helper">Zmienne: {{reservationId}}, {{reservationNumber}}, {{fullName}}, {{email}}, {{phone}}, {{date}}, {{timeFrom}}, {{timeTo}}, {{durationHours}}, {{tablesCount}}, {{tablesList}}, {{guestsCount}}, {{joinTables}}, {{customerNote}}, {{adminNote}}, {{confirmationLink}}, {{restaurantName}}</p>
        <div id="rest-template-forms">
          ${keys
            .map(
              (k) => `
            <details class="hotel-template-card">
              <summary>${escapeHtml(k)}</summary>
              <label>Temat<input type="text" data-rest-tpl-key="${escapeHtml(k)}" data-field="subject" value="${escapeHtml(templatesData[k]?.subject || "")}" /></label>
              <label>Treść HTML<textarea data-rest-tpl-key="${escapeHtml(k)}" data-field="bodyHtml" rows="8">${escapeHtml(templatesData[k]?.bodyHtml || "")}</textarea></label>
              <button type="button" class="button rest-save-tpl" data-key="${escapeHtml(k)}">Zapisz szablon</button>
            </details>`
            )
            .join("")}
        </div>
      </div>`;
  }

  function renderBlockForm() {
    return `
      <div class="hotel-subpanel">
        <h3>Ręczna blokada stolików</h3>
        <form id="rest-block-form" class="stack">
          <label>Data<input name="reservationDate" type="date" required /></label>
          <div class="field-grid">
            <label>Od (HH:MM)<input name="startTime" required placeholder="18:00" /></label>
            <label>Do (HH:MM)<input name="endTime" required placeholder="22:00" /></label>
          </div>
          <label>ID stolików (przecinek, np. table-1,table-2)<input name="tableIds" required placeholder="table-1" /></label>
          <label>Notatka<input name="note" /></label>
          <button type="submit" class="button">Utwórz blokadę</button>
        </form>
      </div>`;
  }

  async function renderRestaurantAdminPanel(container, options = {}) {
    if (!container) return;
    if (options.defaultTab) {
      restSubTab = options.defaultTab;
    }
    container.innerHTML = `<p class="status">Ładowanie modułu Restauracja…</p>`;
    try {
      await loadSettings();
      await loadTables();
      await loadReservations("all");
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
      container.innerHTML = `
        <section class="panel col-12">
          <p class="pill">Restauracja</p>
          <h2>Rezerwacje stolików</h2>
          <div class="hotel-nav">
            <button type="button" class="button ${restSubTab === "settings" ? "" : "secondary"}" data-rsub="settings">Ustawienia</button>
            <button type="button" class="button ${restSubTab === "tables" ? "" : "secondary"}" data-rsub="tables">Stoliki</button>
            <button type="button" class="button ${restSubTab === "reservations" ? "" : "secondary"}" data-rsub="reservations">Rezerwacje</button>
            <button type="button" class="button ${restSubTab === "templates" ? "" : "secondary"}" data-rsub="templates">Szablony mailingowe</button>
            <button type="button" class="button ${restSubTab === "block" ? "" : "secondary"}" data-rsub="block">Blokada stolików</button>
          </div>
          <div id="rest-sub-content">${sub[restSubTab]}</div>
        </section>
      `;

      container.querySelectorAll("[data-rsub]").forEach((b) => {
        b.addEventListener("click", async () => {
          restSubTab = b.getAttribute("data-rsub");
          if (restSubTab === "reservations") {
            try {
              await loadReservations(document.querySelector("#rest-res-filter")?.value || "all");
            } catch (err) {
              alert(err.message);
            }
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
        try {
          const out = await restaurantApi("admin-settings-save", {
            method: "PUT",
            body: {
              tableCount: fd.get("tableCount"),
              maxGuestsPerTable: fd.get("maxGuestsPerTable"),
              reservationOpenTime: fd.get("reservationOpenTime"),
              reservationCloseTime: fd.get("reservationCloseTime"),
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

      document.querySelectorAll(".rest-edit-table").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.getAttribute("data-id");
          const t = tablesData.find((x) => x.id === id);
          if (!t) return;
          const zone = prompt("Strefa: sala lub taras", t.zone || "sala");
          if (zone === null) return;
          const active = confirm("Aktywny (uwzględniany w przydziale)?");
          const hidden = confirm("Ukryć przed automatycznym przydziałem?");
          const desc = prompt("Opis (opcjonalnie)", t.description || "");
          try {
            await restaurantApi("admin-table-upsert", {
              method: "PUT",
              body: {
                id,
                number: t.number,
                zone: zone.trim() || "sala",
                active,
                hidden,
                description: desc || "",
                sortOrder: t.sortOrder ?? t.number,
              },
            });
            await loadTables();
            restSubTab = "tables";
            paint();
          } catch (err) {
            alert(err.message);
          }
        });
      });

      document.querySelector("#rest-res-filter")?.addEventListener("change", async () => {
        await loadReservations(document.querySelector("#rest-res-filter").value);
        document.querySelector("#rest-sub-content").innerHTML = renderReservations();
        bindSub();
      });
      document.querySelector("#rest-res-refresh")?.addEventListener("click", async () => {
        await loadReservations(document.querySelector("#rest-res-filter")?.value || "all");
        document.querySelector("#rest-sub-content").innerHTML = renderReservations();
        bindSub();
      });

      document.querySelector("#rest-res-new")?.addEventListener("click", async () => {
        const reservationDate = prompt("Data (YYYY-MM-DD)");
        if (!reservationDate) return;
        const startTime = prompt("Godzina startu (HH:MM)", "18:00");
        if (!startTime) return;
        const durationHours = Number(prompt("Czas trwania (godziny)", "2"));
        if (!durationHours) return;
        const tablesCount = Number(prompt("Liczba stolików", "1"));
        const guestsCount = Number(prompt("Liczba gości", "2"));
        const fullName = prompt("Imię i nazwisko");
        if (!fullName) return;
        const email = prompt("E-mail");
        if (!email) return;
        const phonePrefix = prompt("Prefiks", "+48");
        const phoneNational = prompt("Numer");
        if (!phoneNational) return;
        const st = confirm("OK = oczekująca, Anuluj = od razu zarezerwowana") ? "pending" : "confirmed";
        try {
          await restaurantApi("admin-reservation-create", {
            method: "POST",
            body: {
              reservationDate,
              startTime,
              durationHours,
              tablesCount,
              guestsCount,
              joinTables: false,
              fullName,
              email,
              phonePrefix: phonePrefix || "+48",
              phoneNational,
              customerNote: "",
              adminNote: "",
              status: st,
            },
          });
          alert("Utworzono.");
          await loadReservations(document.querySelector("#rest-res-filter")?.value || "all");
          document.querySelector("#rest-sub-content").innerHTML = renderReservations();
          bindSub();
        } catch (err) {
          alert(err.message);
        }
      });

      document.querySelectorAll(".rest-res-detail").forEach((btn) => {
        btn.addEventListener("click", () => openReservationDetail(btn.getAttribute("data-id")));
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

      document.querySelector("#rest-block-form")?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.target);
        const ids = String(fd.get("tableIds") || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
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

    async function openReservationDetail(id) {
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
      alert(
        `Nr: ${r.humanNumber}\n${r.fullName}\n${r.email}\n${r.reservationDate} ${formatMs(r.startDateTime)} – ${formatMs(r.endDateTime)}\n${r.statusLabel}\nStoliki: ${r.assignedTablesLabel}\nUwagi: ${r.customerNote || ""}\nNotatka admina: ${r.adminNote || ""}`
      );
      const note = prompt("Notatka administratora (zapis)", r.adminNote || "");
      if (note === null) return;
      try {
        await restaurantApi("admin-reservation-update", {
          method: "PATCH",
          body: { id, adminNote: note },
        });
      } catch (err) {
        alert(err.message);
        return;
      }
      if (r.status === "pending") {
        if (confirm("Potwierdzić rezerwację (status: zarezerwowane)?")) {
          try {
            await restaurantApi("admin-reservation-confirm", { method: "POST", body: { id } });
            alert("Potwierdzono — wysłano mail do klienta.");
          } catch (err) {
            alert(err.message);
          }
        } else if (confirm("Anulować rezerwację i zwolnić stoliki?")) {
          try {
            await restaurantApi("admin-reservation-cancel", { method: "POST", body: { id } });
            alert("Anulowano.");
          } catch (err) {
            alert(err.message);
          }
        }
      } else if (r.status === "confirmed" && confirm("Anulować rezerwację?")) {
        try {
          await restaurantApi("admin-reservation-cancel", { method: "POST", body: { id } });
        } catch (err) {
          alert(err.message);
        }
      }
      await loadReservations(document.querySelector("#rest-res-filter")?.value || "all");
      document.querySelector("#rest-sub-content").innerHTML = renderReservations();
      bindSub();
    }

    paint();
  }

  window.renderRestaurantAdminPanel = renderRestaurantAdminPanel;
})();
