/**
 * Panel admina — moduł Hotel (Firestore przez Cloud Functions hotelApi).
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

  function toInt(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }

  function renderRooms(root) {
    const body = roomsData
      .map(
        (r) => `
      <tr data-id="${escapeHtml(r.id)}">
        <td>${escapeHtml(r.name || r.id)}</td>
        <td>${escapeHtml(String(r.pricePerNight ?? ""))}</td>
        <td>${escapeHtml(String(r.maxGuests ?? "—"))}</td>
        <td>${escapeHtml([toInt(r.bedsSingle) && `${toInt(r.bedsSingle)}×1os.`, toInt(r.bedsDouble) && `${toInt(r.bedsDouble)}×2os.`, toInt(r.bedsChild) && `${toInt(r.bedsChild)}×dz.`].filter(Boolean).join(", ") || "—")}</td>
        <td>${r.active !== false ? "tak" : "nie"}</td>
        <td>${escapeHtml(String(r.sortOrder ?? 0))}</td>
        <td><button type="button" class="button secondary hotel-edit-room" data-id="${escapeHtml(r.id)}">Edytuj</button></td>
      </tr>`
      )
      .join("");
    return `
      <div class="hotel-subpanel">
        <div class="hotel-rooms-heading">
          <div>
            <h3>Pokoje (${roomsData.length})</h3>
            <p class="helper">Ceny i parametry zapisują się w Firestore — wpływają na nowe rezerwacje i widok na stronie.</p>
          </div>
          <button type="button" class="button" id="hotel-add-room">Dodaj pokój</button>
        </div>
        <div class="table-scroll">
          <table class="hotel-table">
            <thead><tr><th>Nazwa</th><th>Cena / noc</th><th>Max os.</th><th>Łóżka</th><th>Aktywny</th><th>Kol.</th><th></th></tr></thead>
            <tbody>${body || "<tr><td colspan='7'>Brak danych — dodaj pokój lub uruchom seed.</td></tr>"}</tbody>
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
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-id");
          const found = roomsData.find((x) => x.id === id);
          if (found) openRoomEditorModal(found);
        });
      });
      document.querySelector("#hotel-add-room")?.addEventListener("click", () => openRoomEditorModal(null));
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
                      ? "Unikalny identyfikator dokumentu (np. room-03). Ten sam ID jest używany w rezerwacjach i blokadach."
                      : `ID dokumentu: ${escapeHtml(r.id)} — nie zmienia się po utworzeniu.`
                  }</p>
                </div>
                <button type="button" class="button secondary" data-hotel-room-modal-close>Zamknij</button>
              </div>
              <p class="status hotel-room-editor-msg" id="hotel-room-editor-msg" hidden></p>
              <div class="field-grid">
                <label class="field-full">
                  <span>ID pokoju (Firestore)</span>
                  <input name="id" value="${escapeHtml(r.id)}" ${isNew ? "" : "readonly"} required pattern="[a-zA-Z0-9_-]+" placeholder="np. room-01" title="Litery, cyfry, myślnik, podkreślenie" autocomplete="off" />
                </label>
                <label class="field-full">
                  <span>Nazwa wyświetlana</span>
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
                <label class="field">
                  <span>Kolejność (sortowanie)</span>
                  <input name="sortOrder" type="number" step="1" value="${escapeHtml(String(r.sortOrder ?? 0))}" />
                </label>
                <label class="field-full">
                  <span>Opis (strona / rezerwacja)</span>
                  <textarea name="description" rows="4" placeholder="Krótki opis pokoju">${escapeHtml(r.description || "")}</textarea>
                </label>
                <label class="field-full">
                  <span>Adresy zdjęć (w osobnych liniach lub po przecinku)</span>
                  <textarea name="imageUrls" rows="3" placeholder="https://...">${escapeHtml(formatImageUrlsForInput(r.imageUrls))}</textarea>
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

      host.querySelector("#hotel-room-editor-form")?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        showMsg("", false);
        const fd = new FormData(ev.target);
        const id = String(fd.get("id") || "").trim();
        if (!id) {
          showMsg("Podaj ID pokoju.", true);
          return;
        }
        if (isNew && roomsData.some((x) => x.id === id)) {
          showMsg("Pokój o tym ID już istnieje — użyj innego identyfikatora albo edytuj istniejący wpis.", true);
          return;
        }
        const pricePerNight = Number(fd.get("pricePerNight"));
        if (!Number.isFinite(pricePerNight) || pricePerNight < 0) {
          showMsg("Niepoprawna cena.", true);
          return;
        }
        const sortOrderRaw = Number(fd.get("sortOrder"));
        const sortOrder = Number.isFinite(sortOrderRaw) ? sortOrderRaw : 0;
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
              imageUrls: parseImageUrlsInput(fd.get("imageUrls")),
              active: fd.get("active") === "on",
              sortOrder,
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
