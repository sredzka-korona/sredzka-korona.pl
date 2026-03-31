/**
 * Modal rezerwacji stolików — restauracja (Cloud Functions restaurantApi).
 */
(function () {
  const config = window.SREDZKA_CONFIG || {};

  function restaurantApiBase() {
    if (config.restaurantApiBase) {
      return String(config.restaurantApiBase).replace(/\/$/, "");
    }
    if (config.apiBase) {
      return `${String(config.apiBase).replace(/\/$/, "")}/api/public/legacy-bookings/restaurant`;
    }
    if (config.firebaseProjectId) {
      return `https://europe-west1-${config.firebaseProjectId}.cloudfunctions.net/restaurantApi`;
    }
    return "";
  }

  async function api(op, options = {}) {
    const base = restaurantApiBase();
    if (!base) {
      throw new Error("Brak restaurantApiBase / firebaseProjectId w assets/js/config.js");
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
  ];

  const state = {
    step: 1,
    sessionStartedAt: 0,
    publicSettings: null,
    reservationDate: "",
    startTime: "",
    durationHours: 2,
    tablesCount: 1,
    guestsCount: 2,
    joinTables: false,
    customerNote: "",
    customer: {},
  };

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fingerprint() {
    try {
      return btoa(
        `${navigator.userAgent || ""}|${screen?.width || 0}x${screen?.height || ""}|${navigator.language || ""}`
      ).slice(0, 64);
    } catch {
      return "fp";
    }
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
    state.reservationDate = "";
    state.startTime = "";
    state.durationHours = 2;
    state.tablesCount = 1;
    state.guestsCount = 2;
    state.joinTables = false;
    state.customerNote = "";
    state.customer = {};
  }

  function maxGuestsAllowed() {
    const m = Number(state.publicSettings?.maxGuestsPerTable || 4);
    return state.tablesCount * m;
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

  function timeOptionsHtml() {
    const slots = state.publicSettings?.timeSlots || [];
    return slots
      .map(
        (t) =>
          `<option value="${escapeHtml(t)}" ${state.startTime === t ? "selected" : ""}>${escapeHtml(t)}</option>`
      )
      .join("");
  }

  function renderBody() {
    const modal = document.querySelector("#restaurant-booking-modal .booking-modal-inner");
    if (!modal) return;

    if (!checkSession() && state.step < 5) {
      modal.innerHTML = `
        <div class="booking-session-expired">
          <p>Sesja rezerwacji wygasła (limit ok. 30 minut). Rozpocznij od nowa.</p>
          <button type="button" class="booking-btn" id="rb-restart">Zacznij od nowa</button>
        </div>`;
      document.querySelector("#rb-restart")?.addEventListener("click", () => {
        resetState();
        loadSettingsThenRender();
      });
      return;
    }

    let inner = "";
    if (state.step === 1) {
      inner = `
        <h3>Termin</h3>
        <p class="booking-hint">Wybierz datę, godzinę rozpoczęcia i czas trwania rezerwacji.</p>
        <div class="booking-field-grid">
          <label>Data<input type="date" id="rb-date" value="${escapeHtml(state.reservationDate)}" required /></label>
          <label>Godzina rozpoczęcia
            <select id="rb-start">${timeOptionsHtml()}</select>
          </label>
        </div>
        <label>Czas trwania (godziny)
          <select id="rb-duration">
            ${[1, 2, 3, 4, 5, 6]
              .map(
                (h) =>
                  `<option value="${h}" ${Number(state.durationHours) === h ? "selected" : ""}>${h} h</option>`
              )
              .join("")}
          </select>
        </label>
        <p class="booking-error" id="rb-step-error" hidden></p>
        <div class="booking-actions">
          <button type="button" class="booking-btn" id="rb-next-1" disabled>Dalej</button>
        </div>`;
    } else if (state.step === 2) {
      const maxG = maxGuestsAllowed();
      inner = `
        <h3>Parametry rezerwacji</h3>
        <div class="booking-field-grid">
          <label>Liczba stolików<input type="number" id="rb-tables" min="1" max="30" value="${state.tablesCount}" /></label>
          <label>Liczba gości<input type="number" id="rb-guests" min="1" max="${maxG}" value="${state.guestsCount}" /></label>
        </div>
        <p class="booking-hint">Przy obecnych ustawieniach maksymalnie <strong id="rb-max-guests">${maxG}</strong> gości (liczba stolików × max osób przy jednym stoliku).</p>
        <label class="booking-checkbox">
          <input type="checkbox" id="rb-join" ${state.joinTables ? "checked" : ""} />
          <span>Poproszę o połączenie stołów (preferencja organizacyjna)</span>
        </label>
        <label>Uwagi / opis<input type="text" id="rb-note" maxlength="2000" value="${escapeHtml(state.customerNote)}" placeholder="np. okazja, dieta" /></label>
        <p class="booking-error" id="rb-step-error" hidden></p>
        <div class="booking-actions">
          <button type="button" class="booking-btn secondary" id="rb-back-2">Wstecz</button>
          <button type="button" class="booking-btn" id="rb-next-2" disabled>Dalej</button>
        </div>`;
    } else if (state.step === 3) {
      inner = `
        <h3>Dane kontaktowe</h3>
        <form id="rb-form-customer" class="booking-form">
          <input type="text" name="hpCompanyWebsite" id="rb-hp" value="" tabindex="-1" autocomplete="off" class="booking-honeypot" aria-hidden="true" />
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
          <p class="booking-error" id="rb-step-error" hidden></p>
          <div class="booking-actions">
            <button type="button" class="booking-btn secondary" id="rb-back-3">Wstecz</button>
            <button type="submit" class="booking-btn">Dalej</button>
          </div>
        </form>`;
    } else if (state.step === 4) {
      inner = `
        <h3>Podsumowanie</h3>
        <ul class="booking-summary-list">
          <li>Data: ${escapeHtml(state.reservationDate)}</li>
          <li>Godziny: ${escapeHtml(state.startTime)} – (ok. ${state.durationHours} h)</li>
          <li>Stoliki: ${state.tablesCount} · Goście: ${state.guestsCount}</li>
          <li>Łączenie stołów: ${state.joinTables ? "tak" : "nie"}</li>
          ${state.customerNote ? `<li>Uwagi: ${escapeHtml(state.customerNote)}</li>` : ""}
        </ul>
        <p><strong>Dane:</strong> ${escapeHtml(state.customer.fullName || "")}, ${escapeHtml(state.customer.email || "")}</p>
        <label class="booking-terms">
          <input type="checkbox" id="rb-terms" required />
          <span>Zapoznałem/am się z <a href="../dokumenty/index.html#regulamin-rezerwacji-restauracja" target="_blank" rel="noopener">regulaminem rezerwacji restauracji</a>. Oświadczam, że rezerwacja po akceptacji przez restaurację jest zobowiązująca i zobowiązuję się do respektowania warunków lokalu.</span>
        </label>
        <div id="turnstile-slot-restaurant"></div>
        <p class="booking-error" id="rb-step-error" hidden></p>
        <div class="booking-actions">
          <button type="button" class="booking-btn secondary" id="rb-back-4">Wstecz</button>
          <button type="button" class="booking-btn" id="rb-submit">Wyślij i otrzymaj link e-mail</button>
        </div>`;
    } else {
      inner = `
        <div class="booking-success">
          <h3>Wysłano wiadomość</h3>
          <p>Na podany adres e-mail wysłaliśmy <strong>link potwierdzający</strong>. Kliknij w niego w ciągu <strong>2 godzin</strong>.</p>
          <p>Po kliknięciu linku rezerwacja otrzyma status <strong>oczekujące na akceptację przez restaurację</strong> — wtedy stoliki zostaną wstępnie zablokowane.</p>
        </div>
        <div class="booking-actions">
          <button type="button" class="booking-btn" id="rb-close-final">Zamknij</button>
        </div>`;
    }

    modal.innerHTML = `${renderSteps()}${inner}`;
    bindStepHandlers();
  }

  async function loadSettingsThenRender() {
    const modal = document.querySelector("#restaurant-booking-modal .booking-modal-inner");
    if (modal) {
      modal.innerHTML = "<p>Ładowanie…</p>";
    }
    try {
      const data = await api("public-settings", { method: "GET" });
      state.publicSettings = data;
      if (!state.reservationDate) {
        const today = new Date().toISOString().slice(0, 10);
        state.reservationDate = today;
      }
      if (!state.startTime && data.timeSlots?.length) {
        state.startTime = data.timeSlots[0];
      }
      renderBody();
    } catch (e) {
      if (modal) {
        modal.innerHTML = `<p class="booking-error">${escapeHtml(e.message)}</p>`;
      }
    }
  }

  function bindStepHandlers() {
    if (state.step === 1) {
      const dateEl = document.querySelector("#rb-date");
      const startEl = document.querySelector("#rb-start");
      const durEl = document.querySelector("#rb-duration");
      const next = document.querySelector("#rb-next-1");
      const err = document.querySelector("#rb-step-error");

      function validate() {
        const d = dateEl?.value;
        const t = startEl?.value;
        const today = new Date().toISOString().slice(0, 10);
        if (!d || !t) {
          next.disabled = true;
          return;
        }
        if (d < today) {
          err.hidden = false;
          err.textContent = "Data nie może być w przeszłości.";
          next.disabled = true;
          return;
        }
        err.hidden = true;
        next.disabled = false;
      }
      dateEl?.addEventListener("change", validate);
      startEl?.addEventListener("change", validate);
      durEl?.addEventListener("change", () => {
        state.durationHours = Number(durEl.value);
      });
      validate();
      next?.addEventListener("click", async () => {
        state.reservationDate = dateEl.value;
        state.startTime = startEl.value;
        state.durationHours = Number(durEl?.value || 2);
        next.disabled = true;
        err.hidden = true;
        try {
          const chk = await api("public-availability", {
            method: "POST",
            body: {
              reservationDate: state.reservationDate,
              startTime: state.startTime,
              durationHours: state.durationHours,
              tablesCount: state.tablesCount,
              joinTables: state.joinTables,
            },
          });
          if (!chk.available) {
            err.hidden = false;
            err.textContent = "Brak wystarczającej liczby wolnych stolików. Wybierz inny termin.";
            next.disabled = false;
            return;
          }
          state.step = 2;
          renderBody();
        } catch (e) {
          err.hidden = false;
          err.textContent = e.message || "Błąd";
          next.disabled = false;
        }
      });
    }

    if (state.step === 2) {
      const tablesEl = document.querySelector("#rb-tables");
      const guestsEl = document.querySelector("#rb-guests");
      const maxEl = document.querySelector("#rb-max-guests");
      const next = document.querySelector("#rb-next-2");
      const err = document.querySelector("#rb-step-error");

      function refreshMax() {
        state.tablesCount = Math.max(1, Number(tablesEl.value) || 1);
        tablesEl.value = String(state.tablesCount);
        const maxG = maxGuestsAllowed();
        if (maxEl) maxEl.textContent = String(maxG);
        guestsEl.max = maxG;
        if (Number(guestsEl.value) > maxG) {
          guestsEl.value = String(maxG);
        }
        state.guestsCount = Math.max(1, Number(guestsEl.value) || 1);
        guestsEl.min = 1;
        next.disabled = state.guestsCount < 1 || state.guestsCount > maxG || state.tablesCount < 1;
      }
      tablesEl?.addEventListener("input", refreshMax);
      guestsEl?.addEventListener("input", () => {
        state.guestsCount = Number(guestsEl.value);
        refreshMax();
      });
      document.querySelector("#rb-join")?.addEventListener("change", (e) => {
        state.joinTables = e.target.checked;
      });
      document.querySelector("#rb-note")?.addEventListener("change", (e) => {
        state.customerNote = e.target.value.trim();
      });
      refreshMax();
      document.querySelector("#rb-back-2")?.addEventListener("click", () => {
        state.step = 1;
        renderBody();
      });
      next?.addEventListener("click", async () => {
        state.customerNote = document.querySelector("#rb-note")?.value?.trim() || "";
        state.joinTables = document.querySelector("#rb-join")?.checked || false;
        err.hidden = true;
        next.disabled = true;
        try {
          const chk = await api("public-availability", {
            method: "POST",
            body: {
              reservationDate: state.reservationDate,
              startTime: state.startTime,
              durationHours: state.durationHours,
              tablesCount: state.tablesCount,
              joinTables: state.joinTables,
            },
          });
          if (!chk.available) {
            err.hidden = false;
            err.textContent = "Brak wolnych stolików w tym terminie.";
            next.disabled = false;
            return;
          }
          state.step = 3;
          renderBody();
        } catch (e) {
          err.hidden = false;
          err.textContent = e.message || "Błąd";
          next.disabled = false;
        }
      });
    }

    if (state.step === 3) {
      document.querySelector("#rb-back-3")?.addEventListener("click", () => {
        state.step = 2;
        renderBody();
      });
      document.querySelector("#rb-form-customer")?.addEventListener("submit", (ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.currentTarget);
        if (fd.get("hpCompanyWebsite")) return;
        state.customer = {
          fullName: String(fd.get("fullName") || "").trim(),
          email: String(fd.get("email") || "").trim(),
          phonePrefix: String(fd.get("phonePrefix") || "").trim(),
          phoneNational: String(fd.get("phoneNational") || "").trim(),
          hpCompanyWebsite: String(fd.get("hpCompanyWebsite") || "").trim(),
        };
        state.step = 4;
        renderBody();
        loadTurnstileIfNeeded();
      });
    }

    if (state.step === 4) {
      document.querySelector("#rb-back-4")?.addEventListener("click", () => {
        state.step = 3;
        renderBody();
      });
      document.querySelector("#rb-submit")?.addEventListener("click", async () => {
        const terms = document.querySelector("#rb-terms");
        const errEl = document.querySelector("#rb-step-error");
        if (!terms?.checked) {
          errEl.hidden = false;
          errEl.textContent = "Zaakceptuj regulamin.";
          return;
        }
        errEl.hidden = true;
        const btn = document.querySelector("#rb-submit");
        btn.disabled = true;
        let turnstileToken = "";
        if (config.turnstileSiteKey) {
          const inp = document.querySelector("[name='cf-turnstile-response']");
          turnstileToken = inp?.value || "";
          if (!turnstileToken) {
            errEl.hidden = false;
            errEl.textContent = "Potwierdź weryfikację anty-spam.";
            btn.disabled = false;
            return;
          }
        }
        try {
          await api("public-reservation-draft", {
            method: "POST",
            body: {
              reservationDate: state.reservationDate,
              startTime: state.startTime,
              durationHours: state.durationHours,
              tablesCount: state.tablesCount,
              guestsCount: state.guestsCount,
              joinTables: state.joinTables,
              customerNote: state.customerNote,
              fullName: state.customer.fullName,
              email: state.customer.email,
              phonePrefix: state.customer.phonePrefix,
              phoneNational: state.customer.phoneNational,
              termsAccepted: true,
              sessionStartedAt: state.sessionStartedAt,
              hpCompanyWebsite: state.customer.hpCompanyWebsite || "",
              turnstileToken,
              fingerprint: fingerprint(),
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
      document.querySelector("#rb-close-final")?.addEventListener("click", closeModal);
    }
  }

  function loadTurnstileIfNeeded() {
    const slot = document.querySelector("#turnstile-slot-restaurant");
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
    const modal = document.querySelector("#restaurant-booking-modal");
    if (!modal) return;
    modal.classList.add("open");
    const inner = modal.querySelector(".booking-modal-inner");
    if (!inner) return;
    inner.innerHTML = `
      <div class="booking-session-expired">
        <p>Rezerwacje online sa obecnie wstrzymane.</p>
        <p>Aby dokonac rezerwacji, prosimy o kontakt telefoniczny lub przez formularz kontaktowy.</p>
        <button type="button" class="booking-btn" id="rb-close-paused">Zamknij</button>
      </div>`;
    document.querySelector("#rb-close-paused")?.addEventListener("click", closeModal);
  }

  async function openModal() {
    const modal = document.querySelector("#restaurant-booking-modal");
    if (!modal) return;
    const fetchFn = window.SREDZKA_fetchBookingSettings;
    if (typeof fetchFn === "function") {
      try {
        const s = await fetchFn();
        if (s && s.restaurant === false) {
          showBookingPaused();
          return;
        }
      } catch {
        /* kontynuuj normalny przepływ */
      }
    }
    resetState();
    modal.classList.add("open");
    loadSettingsThenRender();
  }

  function closeModal() {
    const modal = document.querySelector("#restaurant-booking-modal");
    if (modal) {
      modal.classList.remove("open");
    }
  }

  function init() {
    document.querySelector("#rb-open-booking")?.addEventListener("click", (e) => {
      e.preventDefault();
      openModal();
    });
    document.querySelector("#restaurant-booking-modal")?.addEventListener("click", (e) => {
      if (e.target.id === "restaurant-booking-modal") {
        closeModal();
      }
    });
    document.addEventListener("click", (e) => {
      if (e.target.matches("#rb-modal-close")) {
        closeModal();
      }
    });
  }

  window.addEventListener("load", init);
})();
