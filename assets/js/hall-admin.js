/**
 * Panel admina — moduł Sale (hallApi).
 */
(function () {
  const config = window.SREDZKA_CONFIG || {};

  function hallApiBase() {
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

  let hallSubTab = "halls";
  let hallsData = [];
  let reservationsData = [];
  let templatesData = {};
  let venueSettings = {};
  let countdownTimer = null;

  async function loadHalls() {
    const d = await hallApi("admin-halls-list", { method: "GET" });
    hallsData = d.halls || [];
  }

  async function loadReservations(status) {
    const q = status && status !== "all" ? `&status=${encodeURIComponent(status)}` : "";
    const base = hallApiBase();
    const token = await firebase.auth().currentUser.getIdToken();
    const res = await fetch(`${base}?op=admin-reservations-list${q}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || "Błąd");
    reservationsData = d.reservations || [];
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
        <td>${escapeHtml(r.humanNumber || r.id)}</td>
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
        <td><button type="button" class="button secondary hall-res-detail" data-id="${escapeHtml(r.id)}">Szczegóły</button></td>
      </tr>`
      )
      .join("");
    return `
      <div class="hotel-subpanel">
        <h3>Rezerwacje sal</h3>
        <div class="hotel-filters">
          <button type="button" class="button secondary" id="hall-res-new">Nowa / blokada</button>
          <label>Filtr <select id="hall-res-filter">
            <option value="all">Wszystkie</option>
            <option value="pending">Oczekujące</option>
            <option value="confirmed">Zarezerwowane</option>
            <option value="cancelled">Anulowane</option>
            <option value="expired">Wygasłe</option>
            <option value="email_verification_pending">E-mail do potwierdzenia</option>
            <option value="manual_block">Blokady</option>
          </select></label>
          <button type="button" class="button" id="hall-res-refresh">Odśwież</button>
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
        <p class="helper">Zmienne: {{reservationId}}, {{reservationNumber}}, {{fullName}}, {{email}}, {{phone}}, {{hallName}}, {{date}}, {{timeFrom}}, {{timeTo}}, {{durationHours}}, {{guestsCount}}, {{eventType}}, {{exclusive}}, {{fullBlockLabel}}, {{customerNote}}, {{adminNote}}, {{confirmationLink}}, {{venueName}}, {{expiresAt}}</p>
        <div id="hall-template-forms">
          ${keys
            .map(
              (k) => `
            <details class="hotel-template-card">
              <summary>${escapeHtml(k)}</summary>
              <label>Temat<input type="text" data-hall-tpl-key="${escapeHtml(k)}" data-field="subject" value="${escapeHtml(templatesData[k]?.subject || "")}" /></label>
              <label>Treść HTML<textarea data-hall-tpl-key="${escapeHtml(k)}" data-field="bodyHtml" rows="8">${escapeHtml(templatesData[k]?.bodyHtml || "")}</textarea></label>
              <button type="button" class="button hall-save-tpl" data-key="${escapeHtml(k)}">Zapisz szablon</button>
            </details>`
            )
            .join("")}
        </div>
      </div>`;
  }

  async function renderHallAdminPanel(container) {
    if (!container) return;
    container.innerHTML = `<p class="status">Ładowanie modułu Sale…</p>`;
    try {
      await loadHalls();
      await loadReservations("all");
      await loadTemplates();
      await loadVenueSettings();
    } catch (e) {
      container.innerHTML = `<p class="status">${escapeHtml(e.message)}</p>`;
      return;
    }

    function paint() {
      const sub = {
        halls: renderHalls() + renderVenueSettings(),
        reservations: renderReservations(),
        templates: renderTemplates(),
      };
      container.innerHTML = `
        <section class="panel col-12">
          <p class="pill">Sale</p>
          <h2>Rezerwacje sal</h2>
          <div class="hotel-nav">
            <button type="button" class="button ${hallSubTab === "halls" ? "" : "secondary"}" data-hsub="halls">Konfiguracja sal</button>
            <button type="button" class="button ${hallSubTab === "reservations" ? "" : "secondary"}" data-hsub="reservations">Rezerwacje</button>
            <button type="button" class="button ${hallSubTab === "templates" ? "" : "secondary"}" data-hsub="templates">Szablony mailingowe</button>
          </div>
          <div id="hall-sub-content">${sub[hallSubTab]}</div>
        </section>
      `;

      container.querySelectorAll("[data-hsub]").forEach((b) => {
        b.addEventListener("click", async () => {
          hallSubTab = b.getAttribute("data-hsub");
          if (hallSubTab === "reservations") {
            try {
              await loadReservations(document.querySelector("#hall-res-filter")?.value || "all");
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
        await loadReservations(document.querySelector("#hall-res-filter").value);
        document.querySelector("#hall-sub-content").innerHTML =
          hallSubTab === "reservations" ? renderReservations() : "";
        bindSub();
      });
      document.querySelector("#hall-res-refresh")?.addEventListener("click", async () => {
        await loadReservations(document.querySelector("#hall-res-filter")?.value || "all");
        document.querySelector("#hall-sub-content").innerHTML =
          hallSubTab === "reservations" ? renderReservations() : "";
        bindSub();
      });

      document.querySelector("#hall-res-new")?.addEventListener("click", async () => {
        const hallId = prompt("ID sali (hall-small / hall-large)", "hall-large");
        if (!hallId) return;
        const reservationDate = prompt("Data (YYYY-MM-DD)");
        if (!reservationDate) return;
        const startTime = prompt("Start (HH:MM)", "12:00");
        if (!startTime) return;
        const durationHours = Number(prompt("Godziny", "3"));
        if (!durationHours) return;
        const block = confirm("OK = blokada terminu (bez gości), Anuluj = zwykła rezerwacja ręczna");
        if (block) {
          try {
            await hallApi("admin-reservation-create", {
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
                phoneNational: "501234567",
                customerNote: "",
                adminNote: prompt("Notatka blokady", "") || "",
                status: "manual_block",
              },
            });
            alert("Utworzono blokadę.");
          } catch (err) {
            alert(err.message);
          }
        } else {
          const guestsCount = Number(prompt("Liczba gości", "50"));
          const exclusive = confirm("Sala na wyłączność?");
          const fullName = prompt("Imię i nazwisko");
          if (!fullName) return;
          const email = prompt("E-mail");
          if (!email) return;
          const phonePrefix = prompt("Prefiks", "+48");
          const phoneNational = prompt("Numer");
          if (!phoneNational) return;
          const eventType = prompt("Rodzaj imprezy", "Spotkanie") || "—";
          const st = confirm("OK = oczekująca, Anuluj = od razu zarezerwowana") ? "pending" : "confirmed";
          try {
            await hallApi("admin-reservation-create", {
              method: "POST",
              body: {
                hallId,
                reservationDate,
                startTime,
                durationHours,
                guestsCount,
                exclusive,
                eventType,
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
          } catch (err) {
            alert(err.message);
          }
        }
        await loadReservations(document.querySelector("#hall-res-filter")?.value || "all");
        document.querySelector("#hall-sub-content").innerHTML = renderReservations();
        bindSub();
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

      document.querySelectorAll(".hall-res-detail").forEach((btn) => {
        btn.addEventListener("click", () => openReservationDetail(btn.getAttribute("data-id")));
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

    async function openReservationDetail(id) {
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
      alert(
        `Nr: ${r.humanNumber}\n${r.fullName}\n${r.email}\n${r.reservationDate} ${formatMs(r.startDateTime)} – ${formatMs(r.endDateTime)}\n${r.statusLabel}\nWyłączność: ${r.exclusive}\nGoście: ${r.guestsCount}\n${r.eventType}\nUwagi: ${r.customerNote || ""}\nNotatka admina: ${r.adminNote || ""}`
      );
      const note = prompt("Notatka administratora (zapis)", r.adminNote || "");
      if (note === null) return;
      try {
        await hallApi("admin-reservation-update", {
          method: "PATCH",
          body: { id, adminNote: note },
        });
      } catch (err) {
        alert(err.message);
        return;
      }
      if (r.status === "pending") {
        if (r.extendAvailable && confirm('Przedłużyć termin oczekiwania o 7 dni?')) {
          try {
            await hallApi("admin-extend-pending", { method: "POST", body: { id } });
            alert("Przedłużono.");
            await loadReservations(document.querySelector("#hall-res-filter")?.value || "all");
            document.querySelector("#hall-sub-content").innerHTML = renderReservations();
            bindSub();
            return;
          } catch (err) {
            alert(err.message);
          }
        }
        if (confirm("Potwierdzić rezerwację (status: zarezerwowane)?")) {
          try {
            await hallApi("admin-reservation-confirm", { method: "POST", body: { id } });
            alert("Potwierdzono — wysłano mail do klienta.");
          } catch (err) {
            alert(err.message);
          }
        } else if (confirm("Anulować rezerwację?")) {
          try {
            await hallApi("admin-reservation-cancel", { method: "POST", body: { id } });
            alert("Anulowano.");
          } catch (err) {
            alert(err.message);
          }
        }
      } else if (r.status === "confirmed" && confirm("Anulować rezerwację?")) {
        try {
          await hallApi("admin-reservation-cancel", { method: "POST", body: { id } });
        } catch (err) {
          alert(err.message);
        }
      }
      await loadReservations(document.querySelector("#hall-res-filter")?.value || "all");
      document.querySelector("#hall-sub-content").innerHTML = renderReservations();
      bindSub();
    }

    paint();
  }

  window.renderHallAdminPanel = renderHallAdminPanel;
})();
