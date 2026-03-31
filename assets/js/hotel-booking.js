/**
 * Modal rezerwacji hotelu — kroki 1–5, sesja 30 min, honeypot, opcjonalnie Turnstile.
 * Backend: Cloud Functions hotelApi (?op=...).
 */
(function () {
  const config = window.SREDZKA_CONFIG || {};

  function hotelApiBase() {
    if (config.hotelApiBase) {
      return String(config.hotelApiBase).replace(/\/$/, "");
    }
    if (config.apiBase) {
      return `${String(config.apiBase).replace(/\/$/, "")}/api/public/legacy-bookings/hotel`;
    }
    if (config.firebaseProjectId) {
      return `https://europe-west1-${config.firebaseProjectId}.cloudfunctions.net/hotelApi`;
    }
    return "";
  }

  async function api(op, options = {}) {
    const base = hotelApiBase();
    if (!base) {
      throw new Error("Brak hotelApiBase / firebaseProjectId w assets/js/config.js");
    }
    const url = `${base}?op=${encodeURIComponent(op)}`;
    const method = String(options.method || "GET").toUpperCase();
    const headers = { ...(options.headers || {}) };
    let body;
    if (options.body !== undefined) {
      body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
      if (!headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "text/plain";
      }
    }
    const init = { method };
    if (Object.keys(headers).length) {
      init.headers = headers;
    }
    if (body !== undefined) {
      init.body = body;
    }
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "Błąd połączenia z serwerem rezerwacji.");
    }
    return data;
  }

  const SESSION_MS = 30 * 60 * 1000;
  const PHONE_PREFIXES = [
    { v: "+48", l: "Polska +48" },
    { v: "+49", l: "Niemcy +49" },
    { v: "+420", l: "Czechy +420" },
    { v: "+43", l: "Austria +43" },
    { v: "+31", l: "Holandia +31" },
    { v: "+32", l: "Belgia +32" },
    { v: "+33", l: "Francja +33" },
    { v: "+44", l: "Wielka Brytania +44" },
    { v: "+1", l: "USA/Kanada +1" },
    { v: "+46", l: "Szwecja +46" },
    { v: "+47", l: "Norwegia +47" },
    { v: "+45", l: "Dania +45" },
  ];

  const state = {
    step: 1,
    sessionStartedAt: 0,
    dateFrom: "",
    dateTo: "",
    availability: null,
    cart: {},
    roomsById: {},
    customer: {},
  };

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function checkSession() {
    if (!state.sessionStartedAt || Date.now() - state.sessionStartedAt > SESSION_MS) {
      return false;
    }
    return true;
  }

  function resetState() {
    state.step = 1;
    state.sessionStartedAt = Date.now();
    state.dateFrom = "";
    state.dateTo = "";
    state.availability = null;
    state.cart = {};
    state.roomsById = {};
    state.customer = {};
  }

  function cartRoomIds() {
    return Object.keys(state.cart).filter((id) => state.cart[id] > 0);
  }

  function cartQty(roomId) {
    return state.cart[roomId] ? 1 : 0;
  }

  function toggleRoom(roomId) {
    if (state.cart[roomId]) {
      delete state.cart[roomId];
    } else {
      state.cart[roomId] = 1;
    }
  }

  function enumerateNights(from, to) {
    const a = new Date(from + "T12:00:00Z");
    const b = new Date(to + "T12:00:00Z");
    const n = [];
    const c = new Date(a);
    while (c < b) {
      n.push(c.toISOString().slice(0, 10));
      c.setUTCDate(c.getUTCDate() + 1);
    }
    return n;
  }

  function nightsCount() {
    return enumerateNights(state.dateFrom, state.dateTo).length;
  }

  function totalPrice() {
    const n = nightsCount();
    let t = 0;
    cartRoomIds().forEach((rid) => {
      const room = state.roomsById[rid];
      if (room) {
        t += Number(room.pricePerNight || 0) * n;
      }
    });
    return Math.round(t * 100) / 100;
  }

  function renderSteps() {
    return `
      <div class="booking-steps" aria-hidden="true">
        ${[1, 2, 3, 4, 5]
          .map(
            (n) =>
              `<span class="booking-step ${state.step === n ? "active" : ""} ${state.step > n ? "done" : ""}">${n}</span>`
          )
          .join("")}
      </div>`;
  }

  function renderBody() {
    const modal = document.querySelector("#booking-modal .booking-modal-inner");
    if (!modal) return;

    if (!checkSession() && state.step < 5) {
      modal.innerHTML = `
        <div class="booking-session-expired">
          <p>Sesja rezerwacji wygasła (limit ok. 30 minut). Rozpocznij od nowa.</p>
          <div class="booking-actions booking-actions--single">
            <button type="button" class="booking-btn" id="booking-restart">Zacznij od nowa</button>
          </div>
        </div>`;
      document.querySelector("#booking-restart")?.addEventListener("click", () => {
        resetState();
        renderBody();
      });
      return;
    }

    let inner = "";
    if (state.step === 1) {
      inner = `
        <h3>Termin pobytu</h3>
        <p class="booking-hint">Przyjazd — pierwszy dzień, wyjazd — dzień opuszczenia pokoju (jak w hotelu).</p>
        <div class="booking-field-grid">
          <label>Od (przyjazd)<input type="date" id="bf-from" value="${escapeHtml(state.dateFrom)}" required /></label>
          <label>Do (wyjazd)<input type="date" id="bf-to" value="${escapeHtml(state.dateTo)}" required /></label>
        </div>
        <p class="booking-error" id="booking-step-error" hidden></p>
        <div class="booking-actions">
          <button type="button" class="booking-btn" id="booking-next-1" disabled>Dalej</button>
        </div>`;
    } else if (state.step === 2) {
      const rooms = state.availability?.rooms || [];
      inner = `
        <h3>Wybór pokoi</h3>
        <p class="booking-hint">Dostępne w całym wybranym terminie. Możesz wybrać kilka pokoi.</p>
        <div class="booking-room-list">
          ${
            rooms.length === 0
              ? "<p>Brak wolnych pokoi w tym terminie.</p>"
              : rooms
                  .map((r) => {
                    const on = cartQty(r.id);
                    return `
              <article class="booking-room-card" data-room-id="${escapeHtml(r.id)}">
                <div>
                  <strong>${escapeHtml(r.name)}</strong>
                  <span class="booking-price">${escapeHtml(r.pricePerNight)} PLN / noc</span>
                  <p class="booking-room-meta">Do ${r.maxGuests} os. · Łóżka: ${r.bedsSingle || 0}×1-os., ${r.bedsDouble || 0}×2-os., ${r.bedsChild || 0} dziec.</p>
                  ${r.description ? `<p class="booking-desc">${escapeHtml(r.description)}</p>` : ""}
                </div>
                <button type="button" class="booking-toggle ${on ? "on" : ""}" data-toggle="${escapeHtml(r.id)}">${on ? "W koszyku" : "Dodaj"}</button>
              </article>`;
                  })
                  .join("")
          }
        </div>
        <div class="booking-cart-summary">
          <strong>Koszyk:</strong> ${cartRoomIds().length ? cartRoomIds().map((id) => state.roomsById[id]?.name || id).join(", ") : "—"}
          <br /><strong>Suma (szacunek):</strong> ${totalPrice()} PLN
        </div>
        <p class="booking-error" id="booking-step-error" hidden></p>
        <div class="booking-actions">
          <button type="button" class="booking-btn secondary" id="booking-back-2">Wstecz</button>
          <button type="button" class="booking-btn" id="booking-next-2" ${cartRoomIds().length ? "" : "disabled"}>Dalej</button>
        </div>`;
    } else if (state.step === 3) {
      inner = `
        <h3>Dane rezerwującego</h3>
        <form id="booking-form-customer" class="booking-form">
          <input type="text" name="hpCompanyWebsite" id="bf-hp" value="" tabindex="-1" autocomplete="off" class="booking-honeypot" aria-hidden="true" />
          <label>Imię i nazwisko<input name="fullName" required maxlength="120" /></label>
          <label>E-mail<input name="email" type="email" required /></label>
          <div class="booking-field-grid">
            <label>Prefiks telefonu
              <select name="phonePrefix" required>
                ${PHONE_PREFIXES.map((p) => `<option value="${escapeHtml(p.v)}">${escapeHtml(p.l)}</option>`).join("")}
              </select>
            </label>
            <label>Numer (bez prefiksu)<input name="phoneNational" inputmode="numeric" required pattern="[0-9]{6,15}" placeholder="np. 501234567" /></label>
          </div>
          <label>Uwagi do rezerwacji<textarea name="customerNote" rows="3" maxlength="2000"></textarea></label>
          <p class="booking-error" id="booking-step-error" hidden></p>
          <div class="booking-actions">
            <button type="button" class="booking-btn secondary" id="booking-back-3">Wstecz</button>
            <button type="submit" class="booking-btn">Dalej</button>
          </div>
        </form>`;
    } else if (state.step === 4) {
      const n = nightsCount();
      const lines = cartRoomIds().map((rid) => {
        const r = state.roomsById[rid];
        const sub = Number(r.pricePerNight) * n;
        return `<li>${escapeHtml(r.name)} — ${sub.toFixed(2)} PLN</li>`;
      });
      inner = `
        <h3>Podsumowanie</h3>
        <ul class="booking-summary-list">${lines.join("")}</ul>
        <p><strong>Termin:</strong> ${escapeHtml(state.dateFrom)} → ${escapeHtml(state.dateTo)} (${n} nocy)</p>
        <p><strong>Łącznie:</strong> ${totalPrice().toFixed(2)} PLN</p>
        <p><strong>Dane:</strong> ${escapeHtml(state.customer.fullName || "")}, ${escapeHtml(state.customer.email || "")}</p>
        <label class="booking-terms">
          <input type="checkbox" id="bf-terms" required />
          <span>Oświadczam, że zapoznałem/am się z <a href="../dokumenty/index.html#regulamin-rezerwacji-hotel" target="_blank" rel="noopener">regulaminem rezerwacji pokoi hotelowych</a>, rozumiem, że po akceptacji przez hotel rezerwacja jest zobowiązująca oraz zobowiązuję się do zapłaty zgodnie z warunkami obiektu.</span>
        </label>
        <div id="turnstile-slot-booking"></div>
        <p class="booking-error" id="booking-step-error" hidden></p>
        <div class="booking-actions">
          <button type="button" class="booking-btn secondary" id="booking-back-4">Wstecz</button>
          <button type="button" class="booking-btn" id="booking-submit">Wyślij i otrzymaj link e-mail</button>
        </div>`;
    } else {
      inner = `
        <div class="booking-success">
          <h3>Wysłano wiadomość</h3>
          <p>Na podany adres e-mail wysłaliśmy <strong>link potwierdzający</strong>. Kliknij w niego w ciągu <strong>2 godzin</strong>, inaczej zgłoszenie wygaśnie i nie zablokuje terminów.</p>
          <p>Po kliknięciu linku rezerwacja otrzyma status <strong>oczekujący na akceptację przez hotel</strong>.</p>
        </div>
        <div class="booking-actions">
          <button type="button" class="booking-btn" id="booking-close-final">Zamknij</button>
        </div>`;
    }

    modal.innerHTML = `
      <div class="booking-step-shell">
        ${renderSteps()}
        ${inner}
      </div>
    `;

    bindStepHandlers();
  }

  function bindStepHandlers() {
    if (state.step === 1) {
      const from = document.querySelector("#bf-from");
      const to = document.querySelector("#bf-to");
      const next = document.querySelector("#booking-next-1");
      const err = document.querySelector("#booking-step-error");
      function validateDates() {
        const f = from?.value;
        const t = to?.value;
        if (!f || !t) {
          next.disabled = true;
          return;
        }
        const today = new Date().toISOString().slice(0, 10);
        if (f < today) {
          err.hidden = false;
          err.textContent = "Data przyjazdu nie może być w przeszłości.";
          next.disabled = true;
          return;
        }
        if (t <= f) {
          err.hidden = false;
          err.textContent = "Wyjazd musi być po dniu przyjazdu (minimum 1 noc).";
          next.disabled = true;
          return;
        }
        err.hidden = true;
        next.disabled = false;
      }
      from?.addEventListener("change", validateDates);
      to?.addEventListener("change", validateDates);
      validateDates();
      next?.addEventListener("click", async () => {
        const errEl = document.querySelector("#booking-step-error");
        next.disabled = true;
        try {
          state.dateFrom = from.value;
          state.dateTo = to.value;
          const data = await api("public-availability", {
            method: "POST",
            body: { dateFrom: state.dateFrom, dateTo: state.dateTo },
          });
          state.availability = data;
          state.roomsById = {};
          (data.rooms || []).forEach((r) => {
            state.roomsById[r.id] = r;
          });
          state.cart = {};
          state.step = 2;
          renderBody();
        } catch (e) {
          errEl.hidden = false;
          errEl.textContent = e.message || "Błąd";
          next.disabled = false;
        }
      });
    }

    if (state.step === 2) {
      document.querySelector("#booking-back-2")?.addEventListener("click", () => {
        state.step = 1;
        renderBody();
      });
      document.querySelectorAll("[data-toggle]").forEach((btn) => {
        btn.addEventListener("click", () => {
          toggleRoom(btn.getAttribute("data-toggle"));
          renderBody();
        });
      });
      document.querySelector("#booking-next-2")?.addEventListener("click", () => {
        if (!cartRoomIds().length) return;
        state.step = 3;
        renderBody();
      });
    }

    if (state.step === 3) {
      document.querySelector("#booking-back-3")?.addEventListener("click", () => {
        state.step = 2;
        renderBody();
      });
      document.querySelector("#booking-form-customer")?.addEventListener("submit", (ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.currentTarget);
        if (fd.get("hpCompanyWebsite")) {
          return;
        }
        state.customer = {
          fullName: String(fd.get("fullName") || "").trim(),
          email: String(fd.get("email") || "").trim(),
          phonePrefix: String(fd.get("phonePrefix") || "").trim(),
          phoneNational: String(fd.get("phoneNational") || "").trim(),
          customerNote: String(fd.get("customerNote") || "").trim(),
          hpCompanyWebsite: String(fd.get("hpCompanyWebsite") || "").trim(),
        };
        state.step = 4;
        renderBody();
        loadTurnstileIfNeeded();
      });
    }

    if (state.step === 4) {
      document.querySelector("#booking-back-4")?.addEventListener("click", () => {
        state.step = 3;
        renderBody();
      });
      document.querySelector("#booking-submit")?.addEventListener("click", async () => {
        const terms = document.querySelector("#bf-terms");
        const errEl = document.querySelector("#booking-step-error");
        if (!terms?.checked) {
          errEl.hidden = false;
          errEl.textContent = "Zaakceptuj regulamin i oświadczenie o płatności.";
          return;
        }
        errEl.hidden = true;
        const btn = document.querySelector("#booking-submit");
        btn.disabled = true;
        let turnstileToken = "";
        if (config.turnstileSiteKey) {
          const inp = document.querySelector("[name='cf-turnstile-response']");
          turnstileToken = inp?.value || "";
          if (!turnstileToken) {
            errEl.hidden = false;
            errEl.textContent = "Potwierdź pole weryfikacji anty-spam.";
            btn.disabled = false;
            return;
          }
        }
        try {
          await api("public-reservation-draft", {
            method: "POST",
            body: {
              dateFrom: state.dateFrom,
              dateTo: state.dateTo,
              roomIds: cartRoomIds(),
              fullName: state.customer.fullName,
              email: state.customer.email,
              phonePrefix: state.customer.phonePrefix,
              phoneNational: state.customer.phoneNational,
              customerNote: state.customer.customerNote,
              termsAccepted: true,
              sessionStartedAt: state.sessionStartedAt,
              hpCompanyWebsite: state.customer.hpCompanyWebsite || "",
              turnstileToken,
            },
          });
          state.step = 5;
          renderBody();
        } catch (e) {
          errEl.hidden = false;
          errEl.textContent = e.message || "Błąd wysyłki.";
          btn.disabled = false;
          if (window.turnstile) {
            window.turnstile.reset();
          }
        }
      });
    }

    if (state.step === 5) {
      document.querySelector("#booking-close-final")?.addEventListener("click", closeModal);
    }
  }

  function loadTurnstileIfNeeded() {
    const slot = document.querySelector("#turnstile-slot-booking");
    if (!slot || !config.turnstileSiteKey) return;
    if (window.turnstile) {
      slot.innerHTML = `<div class="cf-turnstile" data-sitekey="${config.turnstileSiteKey}"></div>`;
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      slot.innerHTML = `<div class="cf-turnstile" data-sitekey="${config.turnstileSiteKey}"></div>`;
    };
    document.head.appendChild(script);
  }

  function showBookingPaused() {
    const modal = document.querySelector("#booking-modal");
    if (!modal) return;
    modal.classList.add("open");
    const inner = modal.querySelector(".booking-modal-inner");
    if (!inner) return;
    inner.innerHTML = `
      <div class="booking-session-expired">
        <p>Rezerwacje online sa obecnie wstrzymane.</p>
        <p>Aby dokonac rezerwacji, prosimy o kontakt telefoniczny lub przez formularz kontaktowy.</p>
        <button type="button" class="booking-btn" id="booking-close-paused">Zamknij</button>
      </div>`;
    document.querySelector("#booking-close-paused")?.addEventListener("click", closeModal);
  }

  async function openModal() {
    const modal = document.querySelector("#booking-modal");
    if (!modal) return;
    const fetchFn = window.SREDZKA_fetchBookingSettings;
    if (typeof fetchFn === "function") {
      try {
        const s = await fetchFn();
        if (s && s.hotel === false) {
          showBookingPaused();
          return;
        }
      } catch {
        /* kontynuuj normalny przepływ */
      }
    }
    resetState();
    modal.classList.add("open");
    renderBody();
  }

  function closeModal() {
    const modal = document.querySelector("#booking-modal");
    if (modal) {
      modal.classList.remove("open");
    }
  }

  function init() {
    document.addEventListener("click", (e) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;

      if (target.closest(".reservation-info")) {
        e.preventDefault();
        openModal();
        return;
      }

      if (target.id === "booking-modal") {
        closeModal();
        return;
      }

      if (target.matches("#booking-modal-close")) {
        closeModal();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;
      if (!target.closest(".reservation-info")) return;
      e.preventDefault();
      openModal();
    });
  }

  /* Strona Hotel buduje DOM asynchronicznie — delegacja zdarzeń jest odporna na opóźniony render */
  init();
})();
