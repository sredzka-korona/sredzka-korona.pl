/**
 * Panel admina — moduł Hotel (Firestore przez Cloud Functions hotelApi).
 * Wymaga: firebase (auth), SREDZKA_CONFIG.hotelApiBase lub firebaseProjectId.
 */
(function () {
  const config = window.SREDZKA_CONFIG || {};

  function hotelApiBase() {
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
      throw new Error(data.error || "Błąd API hotelu.");
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

  let hotelSubTab = "rooms";
  let roomsData = [];
  let reservationsData = [];
  let templatesData = {};
  let countdownTimer = null;

  async function loadRooms() {
    const d = await hotelApi("admin-rooms-list", { method: "GET" });
    roomsData = d.rooms || [];
  }

  async function loadReservations(status) {
    const q = status && status !== "all" ? `&status=${encodeURIComponent(status)}` : "";
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
    templatesData = d.templates || {};
  }

  function renderRooms(root) {
    const body = roomsData
      .map(
        (r) => `
      <tr data-id="${escapeHtml(r.id)}">
        <td>${escapeHtml(r.name || r.id)}</td>
        <td>${escapeHtml(String(r.pricePerNight ?? ""))}</td>
        <td>${r.active ? "tak" : "nie"}</td>
        <td><button type="button" class="button secondary hotel-edit-room" data-id="${escapeHtml(r.id)}">Edytuj</button></td>
      </tr>`
      )
      .join("");
    return `
      <div class="hotel-subpanel">
        <h3>Pokoje (${roomsData.length})</h3>
        <p class="helper">Ceny i parametry zapisują się w Firestore — wpływają na nowe rezerwacje.</p>
        <div class="table-scroll">
          <table class="hotel-table">
            <thead><tr><th>Nazwa</th><th>Cena / noc</th><th>Aktywny</th><th></th></tr></thead>
            <tbody>${body || "<tr><td colspan='4'>Brak danych — uruchom seed pokoi.</td></tr>"}</tbody>
          </table>
        </div>
      </div>`;
  }

  function renderReservations(root) {
    const rows = reservationsData
      .map(
        (r) => `
      <tr>
        <td>${escapeHtml(r.humanNumber || r.id)}</td>
        <td>${escapeHtml(r.customerName || "")}</td>
        <td>${escapeHtml(r.statusLabel || r.status)}</td>
        <td>${escapeHtml(r.dateFrom)} → ${escapeHtml(r.dateTo)}</td>
        <td>${escapeHtml(String(r.totalPrice ?? ""))}</td>
        <td class="hotel-countdown" data-pending="${r.pendingExpiresAt || ""}" data-email-exp="${r.emailVerificationExpiresAt || ""}" data-status="${escapeHtml(r.status)}">${r.status === "pending" ? countdown(r.pendingExpiresAt) : r.status === "email_verification_pending" ? countdown(r.emailVerificationExpiresAt) : "—"}</td>
        <td>
          <button type="button" class="button secondary hotel-res-detail" data-id="${escapeHtml(r.id)}">Szczegóły</button>
        </td>
      </tr>`
      )
      .join("");
    return `
      <div class="hotel-subpanel">
        <h3>Rezerwacje</h3>
        <div class="hotel-filters">
          <button type="button" class="button secondary" id="hotel-res-manual-new">Nowa rezerwacja (ręczna)</button>
          <label>Filtr <select id="hotel-res-filter">
            <option value="all">Wszystkie</option>
            <option value="pending">Oczekujące</option>
            <option value="confirmed">Zarezerwowane</option>
            <option value="cancelled">Anulowane</option>
            <option value="expired">Wygasłe</option>
            <option value="email_verification_pending">E-mail do potwierdzenia</option>
            <option value="manual_block">Blokady</option>
          </select></label>
          <button type="button" class="button" id="hotel-res-refresh">Odśwież</button>
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
    const keys = Object.keys(templatesData);
    return `
      <div class="hotel-subpanel">
        <h3>Szablony mailingowe</h3>
        <p class="helper">Zmienne: {{reservationId}}, {{fullName}}, {{email}}, {{phone}}, {{roomsList}}, {{dateFrom}}, {{dateTo}}, {{nights}}, {{totalPrice}}, {{customerNote}}, {{adminNote}}, {{confirmationLink}}, {{hotelName}}, {{reservationNumber}}</p>
        <div id="hotel-template-forms">
          ${keys
            .map(
              (k) => `
            <details class="hotel-template-card">
              <summary>${escapeHtml(k)}</summary>
              <label>Temat<input type="text" data-tpl-key="${escapeHtml(k)}" data-field="subject" value="${escapeHtml(templatesData[k]?.subject || "")}" /></label>
              <label>Treść HTML<textarea data-tpl-key="${escapeHtml(k)}" data-field="bodyHtml" rows="8">${escapeHtml(templatesData[k]?.bodyHtml || "")}</textarea></label>
              <button type="button" class="button hotel-save-tpl" data-key="${escapeHtml(k)}">Zapisz szablon</button>
            </details>`
            )
            .join("")}
        </div>
      </div>`;
  }

  function renderBlockForm() {
    return `
      <div class="hotel-subpanel">
        <h3>Ręczna blokada terminu</h3>
        <form id="hotel-block-form" class="stack">
          <div class="field-grid">
            <label>Od<input name="dateFrom" type="date" required /></label>
            <label>Do<input name="dateTo" type="date" required /></label>
          </div>
          <label>ID pokoi (oddzielone przecinkiem, np. room-01,room-02)<input name="roomIds" required placeholder="room-01" /></label>
          <label>Notatka<input name="note" /></label>
          <button type="submit" class="button">Utwórz blokadę</button>
        </form>
      </div>`;
  }

  async function renderHotelAdminPanel(container, options = {}) {
    if (!container) return;
    if (options.defaultTab) {
      hotelSubTab = options.defaultTab;
    }
    container.innerHTML = `<p class="status">Ładowanie modułu Hotel…</p>`;
    try {
      await loadRooms();
      await loadReservations("all");
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
      container.innerHTML = `
        <section class="panel col-12">
          <p class="pill">Hotel</p>
          <h2>Rezerwacje pokoi i pokoje</h2>
          <div class="hotel-nav">
            <button type="button" class="button ${hotelSubTab === "rooms" ? "" : "secondary"}" data-hsub="rooms">Pokoje</button>
            <button type="button" class="button ${hotelSubTab === "reservations" ? "" : "secondary"}" data-hsub="reservations">Rezerwacje</button>
            <button type="button" class="button ${hotelSubTab === "templates" ? "" : "secondary"}" data-hsub="templates">Szablony mailingowe</button>
            <button type="button" class="button ${hotelSubTab === "block" ? "" : "secondary"}" data-hsub="block">Blokada terminu</button>
          </div>
          <div id="hotel-sub-content">${sub[hotelSubTab]}</div>
        </section>
      `;

      container.querySelectorAll("[data-hsub]").forEach((b) => {
        b.addEventListener("click", async () => {
          hotelSubTab = b.getAttribute("data-hsub");
          if (hotelSubTab === "reservations") {
            try {
              await loadReservations(document.querySelector("#hotel-res-filter")?.value || "all");
            } catch (e) {
              alert(e.message);
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
      document.querySelectorAll(".hotel-edit-room").forEach((btn) => {
        btn.addEventListener("click", () => editRoom(btn.getAttribute("data-id")));
      });
      const filter = document.querySelector("#hotel-res-filter");
      if (filter) {
        filter.addEventListener("change", async () => {
          await loadReservations(filter.value);
          document.querySelector("#hotel-sub-content").innerHTML = renderReservations();
          bindSub();
        });
      }
      document.querySelector("#hotel-res-manual-new")?.addEventListener("click", async () => {
        const dateFrom = prompt("Data przyjazdu (YYYY-MM-DD)");
        if (!dateFrom) return;
        const dateTo = prompt("Data wyjazdu (YYYY-MM-DD)");
        if (!dateTo) return;
        const roomIdsStr = prompt("ID pokoi, przecinek (np. room-01,room-02)");
        if (!roomIdsStr) return;
        const roomIds = roomIdsStr.split(",").map((s) => s.trim()).filter(Boolean);
        const fullName = prompt("Imię i nazwisko");
        if (!fullName) return;
        const email = prompt("E-mail");
        if (!email) return;
        const phonePrefix = prompt("Prefiks telefonu (np. +48)", "+48");
        const phoneNational = prompt("Numer krajowy (bez +)");
        if (!phoneNational) return;
        const customerNote = prompt("Uwagi klienta", "") || "";
        const st = confirm("Status początkowy: OK = oczekujące (pending), Anuluj = od razu zarezerwowane (confirmed)") ? "pending" : "confirmed";
        try {
          await hotelApi("admin-reservation-create", {
            method: "POST",
            body: {
              dateFrom,
              dateTo,
              roomIds,
              fullName,
              email,
              phonePrefix: phonePrefix || "+48",
              phoneNational,
              customerNote,
              status: st,
              adminNote: "",
            },
          });
          alert("Utworzono rezerwację.");
          await loadReservations(document.querySelector("#hotel-res-filter")?.value || "all");
          document.querySelector("#hotel-sub-content").innerHTML = renderReservations();
          bindSub();
        } catch (e) {
          alert(e.message);
        }
      });
      document.querySelector("#hotel-res-refresh")?.addEventListener("click", async () => {
        await loadReservations(document.querySelector("#hotel-res-filter")?.value || "all");
        document.querySelector("#hotel-sub-content").innerHTML = renderReservations();
        bindSub();
      });
      document.querySelectorAll(".hotel-res-detail").forEach((btn) => {
        btn.addEventListener("click", () => openReservationDetail(btn.getAttribute("data-id")));
      });
      document.querySelectorAll(".hotel-save-tpl").forEach((btn) => {
        btn.addEventListener("click", () => saveTemplate(btn.getAttribute("data-key")));
      });
      document.querySelector("#hotel-block-form")?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.target);
        const roomIds = String(fd.get("roomIds") || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
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

    async function editRoom(id) {
      const r = roomsData.find((x) => x.id === id);
      if (!r) return;
      const name = prompt("Nazwa pokoju", r.name || "");
      if (name === null) return;
      const price = prompt("Cena za noc (PLN)", String(r.pricePerNight ?? ""));
      if (price === null) return;
      const maxGuests = prompt("Max. osób", String(r.maxGuests ?? 2));
      const active = confirm("Pokój aktywny (widoczny w wyszukiwarce)?");
      try {
        await hotelApi("admin-room-upsert", {
          method: "PUT",
          body: {
            id,
            name: name.trim(),
            pricePerNight: Number(price),
            maxGuests: Number(maxGuests) || 1,
            bedsSingle: Number(r.bedsSingle ?? 0),
            bedsDouble: Number(r.bedsDouble ?? 1),
            bedsChild: Number(r.bedsChild ?? 0),
            description: r.description || "",
            imageUrls: r.imageUrls || [],
            active,
            sortOrder: r.sortOrder ?? 0,
          },
        });
        await loadRooms();
        hotelSubTab = "rooms";
        paint();
      } catch (e) {
        alert(e.message);
      }
    }

    async function saveTemplate(key) {
      const subj = document.querySelector(`[data-tpl-key="${key}"][data-field="subject"]`);
      const body = document.querySelector(`[data-tpl-key="${key}"][data-field="bodyHtml"]`);
      try {
        await hotelApi("admin-mail-template-save", {
          method: "PUT",
          body: { key, subject: subj?.value || "", bodyHtml: body?.value || "" },
        });
        alert("Zapisano.");
        await loadTemplates();
      } catch (e) {
        alert(e.message);
      }
    }

    async function openReservationDetail(id) {
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
      alert(
        `Nr: ${r.humanNumber}\n${r.customerName}\n${r.email}\n${r.dateFrom} → ${r.dateTo}\n${r.statusLabel}\nKwota: ${r.totalPrice}\nUwagi: ${r.customerNote || ""}`
      );
      const note = prompt("Notatka administratora (zapis)", r.adminNote || "");
      if (note === null) return;
      try {
        await hotelApi("admin-reservation-update", {
          method: "PATCH",
          body: { id, adminNote: note },
        });
      } catch (e) {
        alert(e.message);
        return;
      }
      if (r.status === "pending") {
        if (confirm("Potwierdzić rezerwację (status: zarezerwowane)?")) {
          try {
            await hotelApi("admin-reservation-confirm", { method: "POST", body: { id } });
            alert("Potwierdzono — wysłano mail do klienta.");
          } catch (e) {
            alert(e.message);
          }
        } else if (confirm("Anulować rezerwację i zwolnić terminy?")) {
          try {
            await hotelApi("admin-reservation-cancel", { method: "POST", body: { id } });
            alert("Anulowano.");
          } catch (e) {
            alert(e.message);
          }
        }
      }
      await loadReservations(document.querySelector("#hotel-res-filter")?.value || "all");
      document.querySelector("#hotel-sub-content").innerHTML = renderReservations();
      bindSub();
    }

    paint();
  }

  window.renderHotelAdminPanel = renderHotelAdminPanel;
})();
