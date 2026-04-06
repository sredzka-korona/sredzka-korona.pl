/**
 * Modal rezerwacji stolików — restauracja (Cloud Functions restaurantApi).
 */
(function () {
  const config = window.SREDZKA_CONFIG || {};
  const CONTACT_EMAIL = "kontakt@sredzka-korona.pl";

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
    const query = options.query && typeof options.query === "object" ? options.query : null;
    const params = new URLSearchParams({ op: String(op || "") });
    if (query) {
      Object.entries(query).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
          params.set(key, String(value));
        }
      });
    }
    const url = `${base}?${params.toString()}`;
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
    requiresEmailConfirmation: true,
  };

  function todayYmdLocal() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function hmToMinutes(value) {
    const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
    if (!match) return null;
    const hh = Number(match[1]);
    const mm = Number(match[2]);
    if (Number.isNaN(hh) || Number.isNaN(mm) || hh < 0 || hh > 24 || mm < 0 || mm > 59) return null;
    if (hh === 24 && mm !== 0) return null;
    return hh * 60 + mm;
  }

  function getDayWindow() {
    const openRaw = state.publicSettings?.reservationOpenTime || "";
    const closeRaw = state.publicSettings?.reservationCloseTime || "";
    const openMinutes = hmToMinutes(openRaw);
    const closeMinutesRaw = hmToMinutes(closeRaw);
    if (openMinutes == null || closeMinutesRaw == null) return null;
    return {
      openMinutes,
      closeMinutes: closeMinutesRaw <= openMinutes ? closeMinutesRaw + 1440 : closeMinutesRaw,
      openRaw,
      closeRaw,
    };
  }

  function durationAwareSlots() {
    const baseSlots = Array.isArray(state.publicSettings?.timeSlots) ? state.publicSettings.timeSlots : [];
    const window = getDayWindow();
    if (!window) return baseSlots;
    const durationMinutes = Math.max(1, Math.round(Number(state.durationHours || 0) * 60));
    return baseSlots.filter((slot) => {
      const startMinutes = hmToMinutes(slot);
      if (startMinutes == null) return false;
      return startMinutes >= window.openMinutes && startMinutes + durationMinutes <= window.closeMinutes;
    });
  }

  function syncStartTimeWithSlots() {
    const slots = durationAwareSlots();
    if (!slots.length) {
      state.startTime = "";
      return;
    }
    if (!slots.includes(state.startTime)) {
      state.startTime = slots[0];
    }
  }

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
    state.requiresEmailConfirmation = true;
  }

  function maxGuestsAllowed() {
    const m = Number(state.publicSettings?.maxGuestsPerTable || 4);
    return state.tablesCount * m;
  }

  function maxTablesAllowed() {
    return Math.max(0, Number(state.publicSettings?.tableCount || 0));
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
    const slots = durationAwareSlots();
    if (!slots.length) {
      return `<option value="">Brak dostępnych godzin</option>`;
    }
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
      const slots = durationAwareSlots();
      const dayWindow = getDayWindow();
      const dayHoursLabel =
        state.publicSettings?.closedForDay
          ? "Restauracja jest nieczynna w wybranym dniu."
          : dayWindow
            ? `Godziny dla wybranego dnia: ${dayWindow.openRaw}-${dayWindow.closeRaw}.`
            : "";
      inner = `
        <h3>Termin</h3>
        <p class="booking-hint">Wybierz datę, godzinę rozpoczęcia i czas trwania rezerwacji.</p>
        ${dayHoursLabel ? `<p class="booking-hint">${escapeHtml(dayHoursLabel)}</p>` : ""}
        <div class="booking-field-grid">
          <label>Data<input type="date" id="rb-date" value="${escapeHtml(state.reservationDate)}" required /></label>
          <label>Godzina rozpoczęcia
            <select id="rb-start" ${slots.length ? "" : "disabled"}>${timeOptionsHtml()}</select>
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
      const maxTables = maxTablesAllowed();
      inner = `
        <h3>Parametry rezerwacji</h3>
        <div class="booking-field-grid">
          <label>Liczba stolików<input type="number" id="rb-tables" min="1" max="${maxTables}" value="${Math.min(Math.max(1, state.tablesCount), Math.max(1, maxTables))}" ${maxTables ? "" : "disabled"} /></label>
          <label>Liczba gości<input type="number" id="rb-guests" min="1" max="${maxG}" value="${state.guestsCount}" /></label>
        </div>
        <p class="booking-hint">Aktywnych stolików: <strong id="rb-max-tables">${maxTables}</strong>. Przy obecnych ustawieniach maksymalnie <strong id="rb-max-guests">${maxG}</strong> gości (liczba stolików × max osób przy jednym stoliku).</p>
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
      inner = state.requiresEmailConfirmation
        ? `
        <div class="booking-success">
          <h3>Wysłano wiadomość</h3>
          <p>Na podany adres e-mail wysłaliśmy <strong>link potwierdzający</strong>. Kliknij w niego w ciągu <strong>2 godzin</strong>.</p>
          <p>Po kliknięciu linku rezerwacja otrzyma status <strong>oczekujące na akceptację przez restaurację</strong> — wtedy stoliki zostaną wstępnie zablokowane.</p>
          <p>Jeśli nie widzisz wiadomości e-mail, sprawdź folder SPAM. W razie problemów skontaktuj się z nami mailowo lub telefonicznie.</p>
        </div>
        <div class="booking-actions">
          <button type="button" class="booking-btn" id="rb-close-final">Zamknij</button>
        </div>`
        : `
        <div class="booking-success booking-success--warning">
          <h3>Nie udało się wysłać e-maila</h3>
          <p>Nie udało się wysłać wiadomości potwierdzającej do tej rezerwacji stolika.</p>
          <p><strong>Skontaktuj się z nami natychmiast mailowo:</strong> <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
          <p>Zgłoszenie zostało zapisane w systemie jako oczekujące, ale wymaga ręcznej weryfikacji przez obsługę.</p>
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
      if (!state.reservationDate) {
        state.reservationDate = todayYmdLocal();
      }
      const data = await api("public-settings", {
        method: "GET",
        query: { reservationDate: state.reservationDate },
      });
      state.publicSettings = data;
      if (data.selectedDate) {
        state.reservationDate = String(data.selectedDate);
      }
      syncStartTimeWithSlots();
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
        const today = todayYmdLocal();
        const slots = durationAwareSlots();
        if (!d || !slots.length || !t) {
          if (d && !slots.length) {
            err.hidden = false;
            err.textContent = state.publicSettings?.closedForDay
              ? "Restauracja jest nieczynna w wybranym dniu."
              : "Brak dostępnych godzin dla wybranego czasu trwania.";
          } else {
            err.hidden = true;
          }
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
      dateEl?.addEventListener("change", async () => {
        state.reservationDate = dateEl.value || "";
        try {
          const data = await api("public-settings", {
            method: "GET",
            query: { reservationDate: state.reservationDate },
          });
          state.publicSettings = data;
          if (data.selectedDate) {
            state.reservationDate = String(data.selectedDate);
          }
          syncStartTimeWithSlots();
          renderBody();
        } catch (e) {
          err.hidden = false;
          err.textContent = e.message || "Nie udało się odświeżyć godzin.";
        }
      });
      startEl?.addEventListener("change", validate);
      durEl?.addEventListener("change", () => {
        state.durationHours = Number(durEl.value);
        syncStartTimeWithSlots();
        renderBody();
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
      const maxTablesEl = document.querySelector("#rb-max-tables");
      const next = document.querySelector("#rb-next-2");
      const err = document.querySelector("#rb-step-error");

      function refreshMax() {
        const maxTables = maxTablesAllowed();
        if (maxTablesEl) maxTablesEl.textContent = String(maxTables);
        state.tablesCount = Math.max(1, Math.min(maxTables || 1, Number(tablesEl.value) || 1));
        tablesEl.value = String(state.tablesCount);
        const maxG = maxGuestsAllowed();
        if (maxEl) maxEl.textContent = String(maxG);
        guestsEl.max = maxG;
        if (Number(guestsEl.value) > maxG) {
          guestsEl.value = String(maxG);
        }
        state.guestsCount = Math.max(1, Number(guestsEl.value) || 1);
        guestsEl.min = 1;
        if (!maxTables) {
          err.hidden = false;
          err.textContent = "Rezerwacje stolików są obecnie niedostępne, bo nie ma aktywnych stolików.";
          next.disabled = true;
          return;
        }
        err.hidden = true;
        next.disabled = state.guestsCount < 1 || state.guestsCount > maxG || state.tablesCount < 1 || state.tablesCount > maxTables;
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
          const response = await api("public-reservation-draft", {
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
          state.requiresEmailConfirmation = response?.requiresEmailConfirmation !== false;
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
        const s = await fetchFn({ refresh: true });
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
    document.addEventListener("click", (e) => {
      const target = e.target;
      if (target instanceof Element && target.closest("#rb-open-booking")) {
        e.preventDefault();
        openModal();
        return;
      }
      if (target instanceof Element && target.id === "restaurant-booking-modal") {
        closeModal();
        return;
      }
      if (target instanceof Element && target.matches("#rb-modal-close")) {
        closeModal();
      }
    });
  }

  window.addEventListener("load", init);
})();
