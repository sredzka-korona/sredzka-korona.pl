/**
 * Modal rezerwacji sal — hallApi, sesja 30 min, honeypot, Turnstile (opcjonalnie).
 */
(function () {
  const config = window.SREDZKA_CONFIG || {};

  function hallApiBase() {
    if (config.hallApiBase) {
      return String(config.hallApiBase).replace(/\/$/, "");
    }
    if (config.apiBase) {
      return `${String(config.apiBase).replace(/\/$/, "")}/api/public/legacy-bookings/hall`;
    }
    if (config.firebaseProjectId) {
      return `https://europe-west1-${config.firebaseProjectId}.cloudfunctions.net/hallApi`;
    }
    return "";
  }

  async function api(op, options = {}) {
    const base = hallApiBase();
    if (!base) {
      throw new Error("Brak hallApiBase / firebaseProjectId w assets/js/config.js");
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
  const state = {
    step: 1,
    sessionStartedAt: 0,
    halls: [],
    hallId: "",
    hallKind: "",
    hallCapacity: 120,
    reservationDate: "",
    startTime: "12:00",
    durationHours: 2,
    guestsCount: 10,
    maxGuestsAvailable: 120,
    exclusive: false,
    eventType: "",
    customerNote: "",
    customer: {},
    availabilityOk: false,
    turnstileToken: "",
  };

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** Data kalendarzowa zgodna z backendem (Europe/Warsaw). */
  function todayYmdWarsaw() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Warsaw",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const year = parts.find((p) => p.type === "year")?.value || "1970";
    const month = parts.find((p) => p.type === "month")?.value || "01";
    const day = parts.find((p) => p.type === "day")?.value || "01";
    return `${year}-${month}-${day}`;
  }

  const HALL_MIN_ADVANCE_MS = 2 * 60 * 60 * 1000;

  function ymdHmToMsWarsaw(ymd, hm) {
    if (!ymd || !hm || !/^\d{4}-\d{2}-\d{2}$/.test(ymd) || !/^\d{2}:\d{2}$/.test(hm)) return NaN;
    const Y = Number(ymd.slice(0, 4));
    const M = Number(ymd.slice(5, 7));
    const D = Number(ymd.slice(8, 10));
    const h = Number(hm.slice(0, 2));
    const m = Number(hm.slice(3, 5));
    if (![Y, M, D, h, m].every((n) => Number.isFinite(n))) return NaN;
    let utcMs = Date.UTC(Y, M - 1, D, h, m, 0, 0);
    const dtf = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Warsaw",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    for (let k = 0; k < 48; k += 1) {
      const pa = dtf.formatToParts(new Date(utcMs));
      const pv = (type) => pa.find((p) => p.type === type)?.value;
      const y = Number(pv("year"));
      const mo = Number(pv("month"));
      const da = Number(pv("day"));
      const ho = Number(pv("hour"));
      const mi = Number(pv("minute"));
      if (y === Y && mo === M && da === D && ho === h && mi === m) return utcMs;
      utcMs += (h * 60 + m - (ho * 60 + mi)) * 60 * 1000;
    }
    return NaN;
  }

  /** Czy start jest co najmniej 2 h po „teraz” (i nie w przeszłości). */
  function hallReservationStartOk(ymd, hm) {
    const t = ymdHmToMsWarsaw(ymd, hm);
    if (!Number.isFinite(t)) return { ok: false, message: "Nieprawidłowa data lub godzina." };
    const now = Date.now();
    if (t < now - 60 * 1000) return { ok: false, message: "Nie można wybrać terminu z przeszłości." };
    if (t < now + HALL_MIN_ADVANCE_MS) return { ok: false, message: "Wybierz termin co najmniej 2 godziny od teraz." };
    return { ok: true };
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
    state.hallId = "";
    state.hallKind = "";
    state.hallCapacity = 120;
    state.reservationDate = todayYmdWarsaw();
    state.startTime = "12:00";
    state.durationHours = 2;
    state.guestsCount = 10;
    state.maxGuestsAvailable = 120;
    state.exclusive = false;
    state.eventType = "";
    state.customerNote = "";
    state.customer = {};
    state.availabilityOk = false;
    state.turnstileToken = "";
  }

  function timeOptions() {
    const out = [];
    for (let h = 0; h <= 23; h++) {
      for (let m = 0; m < 60; m += 30) {
        out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
      }
    }
    return out;
  }

  function injectStyles() {
    if (document.getElementById("hall-booking-styles")) return;
    const st = document.createElement("style");
    st.id = "hall-booking-styles";
    st.textContent = `
      #hall-booking-modal{
        display:none;
        position:fixed;
        left:0;top:0;right:0;bottom:0;
        width:100%;
        height:100%;
        min-height:100vh;
        min-height:100dvh;
        z-index:20000;
        padding:max(1rem, env(safe-area-inset-top, 0px)) max(1rem, env(safe-area-inset-right, 0px)) max(1rem, env(safe-area-inset-bottom, 0px)) max(1rem, env(safe-area-inset-left, 0px));
        box-sizing:border-box;
        background:rgba(31,23,18,.45);
        backdrop-filter:blur(4px);
        -webkit-backdrop-filter:blur(4px);
        overflow:auto;
        overscroll-behavior:contain;
      }
      #hall-booking-modal.hb-open{
        display:grid;
        place-items:center;
        align-content:center;
      }
      .hb-dialog{
        position:relative;
        width:min(520px, calc(100vw - 2rem));
        max-width:100%;
        max-height:min(92dvh, 900px);
        overflow:auto;
        margin:0 auto;
        -webkit-overflow-scrolling:touch;
        background:#fefcf9;
        border-radius:24px;
        border:1px solid rgba(200,170,120,.35);
        box-shadow:0 24px 60px rgba(0,0,0,.15);
        padding:1.25rem 1.5rem 1.5rem;
      }
      .hb-close{position:absolute;top:.6rem;right:.75rem;border:none;background:transparent;font-size:1.5rem;line-height:1;cursor:pointer;color:#6b5d4f;}
      .hb-steps{display:flex;gap:.35rem;flex-wrap:wrap;margin-bottom:1rem;}
      .hb-step{font-size:.75rem;padding:.2rem .45rem;border-radius:999px;background:rgba(200,170,120,.2);color:#5c4f42;}
      .hb-step.on{background:#c8aa78;color:#1f1712;font-weight:600;}
      .hb-hint{font-size:.9rem;color:#6b5d4f;margin:0 0 1rem;line-height:1.5;}
      .hb-grid{display:grid;grid-template-columns:1fr 1fr;gap:.75rem;}
      @media(max-width:520px){.hb-grid{grid-template-columns:1fr;}}
      .hb-field label{display:block;font-size:.8rem;margin-bottom:.25rem;color:#5c4f42;}
      .hb-field input,.hb-field select,.hb-field textarea{width:100%;padding:.5rem .65rem;border-radius:12px;border:1px solid rgba(200,170,120,.35);background:#fff;}
      .hb-field input.hb-prefix-input{max-width:110px;}
      .hb-cards{display:grid;grid-template-columns:1fr 1fr;gap:.75rem;}
      .hb-card{border:2px solid rgba(200,170,120,.35);border-radius:16px;padding:1rem;cursor:pointer;text-align:center;transition:border-color .15s,background .15s;}
      .hb-card:hover{border-color:#c8aa78;}
      .hb-card.selected{border-color:#8b6914;background:rgba(200,170,120,.12);}
      .hb-card strong{display:block;font-size:1.05rem;margin-bottom:.35rem;}
      .hb-inner{display:flex;flex-direction:column;min-height:min(65vh,620px);}
      .hb-actions{
        display:flex;
        flex-wrap:wrap;
        gap:.5rem;
        margin-top:auto;
        padding-top:1.25rem;
        width:100%;
        justify-content:space-between;
        align-items:center;
        box-sizing:border-box;
      }
      .hb-actions.hb-actions--end{justify-content:flex-end;}
      #hb-cust{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;}
      #hb-cust .hb-actions{margin-top:auto;}
      .hb-btn{border:none;border-radius:999px;padding:.55rem 1.2rem;font-weight:600;cursor:pointer;background:#c8aa78;color:#1f1712;}
      .hb-btn:disabled{opacity:.45;cursor:not-allowed;}
      .hb-btn.sec{background:transparent;border:1px solid rgba(200,170,120,.5);}
      .hb-err{color:#b71c1c;font-size:.85rem;margin:.5rem 0 0;}
      .hb-honeypot{position:absolute;left:-5000px;width:1px;height:1px;opacity:0;}
      .hb-summary{list-style:none;padding:0;margin:0 0 1rem;font-size:.9rem;line-height:1.6;}
      .hb-summary li{padding:.2rem 0;border-bottom:1px solid rgba(200,170,120,.15);}
      .hb-terms{font-size:.82rem;line-height:1.45;color:#4a3f36;}
      .hb-terms a{color:#8b6914;text-decoration:underline;}
      .hb-success h3{margin-top:0;}
      input[type="range"].hb-range{width:100%;}
    `;
    document.head.appendChild(st);
  }

  function renderSteps() {
    const total = 6;
    let html = '<div class="hb-steps">';
    for (let n = 1; n <= total; n++) {
      html += `<span class="hb-step ${state.step === n ? "on" : ""}">${n}</span>`;
    }
    html += "</div>";
    return html;
  }

  function selectedHallLabel() {
    const h = state.halls.find((x) => x.id === state.hallId);
    return h ? `${h.name} (do ${h.capacity} osób)` : "—";
  }

  async function refreshAvailability() {
    if (!state.hallId || !state.reservationDate || !state.startTime) {
      state.availabilityOk = false;
      return;
    }
    try {
      const body = {
        hallId: state.hallId,
        reservationDate: state.reservationDate,
        startTime: state.startTime,
        durationHours: state.durationHours,
        guestsCount: state.hallKind === "large" ? state.guestsCount : 1,
        exclusive: state.hallKind === "large" ? state.exclusive : true,
      };
      const r = await api("public-availability", { method: "POST", body });
      state.availabilityOk = Boolean(r.ok && r.available);
      state.maxGuestsAvailable = Number(r.maxGuests) || 0;
      if (state.hallKind === "large") {
        const cap = Math.min(state.maxGuestsAvailable, state.hallCapacity);
        if (state.guestsCount > cap) state.guestsCount = Math.max(1, cap);
      }
    } catch {
      state.availabilityOk = false;
    }
  }

  function renderBody() {
    const root = document.querySelector("#hall-booking-modal .hb-inner");
    if (!root) return;

    if (!checkSession() && state.step < 6) {
      root.innerHTML = `
        ${renderSteps()}
        <p>Sesja wygasła (limit 30 minut). Rozpocznij od nowa.</p>
        <div class="hb-actions hb-actions--end"><button type="button" class="hb-btn" id="hb-restart">Zacznij od nowa</button></div>`;
      document.getElementById("hb-restart")?.addEventListener("click", () => {
        openModal();
      });
      return;
    }

    let inner = "";
    if (state.step === 1) {
      inner = `
        <h3 style="margin-top:0">Wybór sali</h3>
        <p class="hb-hint">Wybierz salę — warunki i limity są dopasowane do typu sali.</p>
        <div class="hb-cards" id="hb-hall-cards">
          ${state.halls
            .map(
              (h) => `
            <div class="hb-card ${state.hallId === h.id ? "selected" : ""}" data-id="${escapeHtml(h.id)}" data-kind="${escapeHtml(h.hallKind)}" data-cap="${h.capacity}">
              <strong>${escapeHtml(h.name)}</strong>
              <span>do ${h.capacity} osób</span>
            </div>`
            )
            .join("")}
        </div>
        <p class="hb-err" id="hb-e1" hidden></p>
        <div class="hb-actions hb-actions--end">
          <button type="button" class="hb-btn" id="hb-next-1" disabled>Dalej</button>
        </div>`;
    } else if (state.step === 2) {
      if (state.reservationDate < todayYmdWarsaw()) {
        state.reservationDate = todayYmdWarsaw();
      }
      inner = `
        <h3 style="margin-top:0">Termin</h3>
        <p class="hb-hint">Między rezerwacjami obowiązuje przerwa organizacyjna (bufor) — uwzględniamy ją przy sprawdzaniu dostępności. Rezerwacja możliwa co najmniej <strong>2 godziny</strong> do przodu.</p>
        <div class="hb-field">
          <label>Data<input type="date" id="hb-date" min="${escapeHtml(todayYmdWarsaw())}" value="${escapeHtml(state.reservationDate)}" /></label>
        </div>
        <div class="hb-grid">
          <div class="hb-field"><label>Godzina startu<select id="hb-start">${timeOptions()
            .map(
              (t) =>
                `<option value="${t}" ${state.startTime === t ? "selected" : ""}>${t}</option>`
            )
            .join("")}</select></label></div>
          <div class="hb-field">
            <label>Czas trwania (godziny)
              <select id="hb-dur">${[1, 2, 3, 4, 5, 6, 8]
                .map(
                  (h) =>
                    `<option value="${h}" ${Number(state.durationHours) === h ? "selected" : ""}>${h} h</option>`
                )
                .join("")}</select>
            </label>
          </div>
        </div>
        <p class="hb-err" id="hb-e2" hidden></p>
        <div class="hb-actions">
          <button type="button" class="hb-btn sec" id="hb-back-2">Wróć</button>
          <button type="button" class="hb-btn" id="hb-next-2" disabled>Dalej</button>
        </div>`;
    } else if (state.step === 3) {
      const maxG =
        state.hallKind === "small"
          ? Math.min(40, state.hallCapacity)
          : Math.min(state.maxGuestsAvailable || 0, state.hallCapacity);
      inner = `
        <h3 style="margin-top:0">Parametry wydarzenia</h3>
        ${
          state.hallKind === "large"
            ? `<p class="hb-hint">Dostępne miejsca w wybranym terminie: <strong id="hb-max-lbl">${maxG}</strong>. Wycena zostanie ustalona telefonicznie — nie ma stałego cennika online.</p>`
            : ""
        }
        <div class="hb-grid">
          <div class="hb-field"><label>Rodzaj imprezy<input type="text" id="hb-event" maxlength="500" value="${escapeHtml(state.eventType)}" required /></label></div>
          ${
            state.hallKind === "large"
              ? `<div class="hb-field"><label>Liczba gości: <span id="hb-guest-val">${state.guestsCount}</span>
              <input type="range" class="hb-range" id="hb-guests-range" min="1" max="${maxG}" value="${Math.min(state.guestsCount, maxG)}" /></label></div>`
              : `<div class="hb-field"><label>Liczba gości (max 40)<input type="number" id="hb-guests-sm" min="1" max="40" value="${Math.min(state.guestsCount, 40)}" /></label></div>`
          }
        </div>
        <div class="hb-field"><label>Dodatkowe informacje<textarea id="hb-note" rows="3" maxlength="2000" required>${escapeHtml(state.customerNote)}</textarea></label></div>
        ${
          state.hallKind === "large"
            ? `<label class="hb-terms"><input type="checkbox" id="hb-exc" ${state.exclusive ? "checked" : ""} /> Sala na wyłączność (blokuje całą salę niezależnie od liczby osób)</label>`
            : ""
        }
        <p class="hb-err" id="hb-e3" hidden></p>
        <div class="hb-actions">
          <button type="button" class="hb-btn sec" id="hb-back-3">Wróć</button>
          <button type="button" class="hb-btn" id="hb-next-3">Dalej</button>
        </div>`;
    } else if (state.step === 4) {
      inner = `
        <h3 style="margin-top:0">Dane kontaktowe</h3>
        <form id="hb-cust" class="hb-field">
          <input type="text" name="hpCompanyWebsite" class="hb-honeypot" tabindex="-1" autocomplete="off" value="" />
          <label>Imię i nazwisko<input name="fullName" required maxlength="120" /></label>
          <label>E-mail<input name="email" type="email" required /></label>
          <div class="hb-grid">
            <label>Prefiks<input name="phonePrefix" class="hb-prefix-input" type="text" inputmode="tel" autocomplete="tel-country-code" value="+48" required pattern="\\+[0-9]{1,4}" maxlength="5" /></label>
            <label>Numer<input name="phoneNational" inputmode="numeric" required pattern="[0-9]{6,15}" placeholder="np. 501234567" /></label>
          </div>
          <p class="hb-err" id="hb-e4" hidden></p>
          <div class="hb-actions">
            <button type="button" class="hb-btn sec" id="hb-back-4">Wróć</button>
            <button type="submit" class="hb-btn">Dalej</button>
          </div>
        </form>`;
    } else if (state.step === 5) {
      inner = `
        <h3 style="margin-top:0">Podsumowanie</h3>
        <ul class="hb-summary">
          <li><strong>Sala:</strong> ${escapeHtml(selectedHallLabel())}</li>
          <li><strong>Data:</strong> ${escapeHtml(state.reservationDate)}</li>
          <li><strong>Godziny:</strong> ${escapeHtml(state.startTime)} – (ok. ${state.durationHours} h)</li>
          <li><strong>Goście:</strong> ${state.guestsCount}</li>
          <li><strong>Rodzaj imprezy:</strong> ${escapeHtml(state.eventType)}</li>
          ${state.customerNote ? `<li><strong>Uwagi:</strong> ${escapeHtml(state.customerNote)}</li>` : ""}
          ${state.hallKind === "large" && state.exclusive ? `<li><strong>Wyłączność:</strong> tak</li>` : ""}
        </ul>
        <p class="hb-hint"><strong>Obsługa skontaktuje się z zamawiającym telefonicznie w celu podania wyceny i potwierdzenia rezerwacji.</strong> Nie ma stałego cennika online.</p>
        <label class="hb-terms">
          <input type="checkbox" id="hb-terms" required />
          Zapoznałem/am się z <a href="../dokumenty/index.html#regulamin-rezerwacji-sali" target="_blank" rel="noopener">regulaminem rezerwacji sali</a>.
          Przyjmuję do wiadomości, że wycena zostanie podana indywidualnie po kontakcie telefonicznym.
          Rezerwacja jest zgłoszeniem zobowiązującym i wymaga potwierdzenia przez obiekt.
        </label>
        <div id="turnstile-slot-hall"></div>
        <p class="hb-err" id="hb-e5" hidden></p>
        <div class="hb-actions">
          <button type="button" class="hb-btn sec" id="hb-back-5">Wróć</button>
          <button type="button" class="hb-btn" id="hb-submit">Wyślij zgłoszenie</button>
        </div>`;
    } else {
      inner = `
        <div class="hb-success">
          <h3>Wysłano wiadomość</h3>
          <p>Na podany adres e-mail wysłaliśmy <strong>link potwierdzający</strong>. Kliknij w niego w ciągu <strong>2 godzin</strong>.</p>
          <p>Po kliknięciu linku zgłoszenie otrzyma status <strong>oczekujące</strong> — obsługa skontaktuje się telefonicznie w sprawie wyceny i dalszego potwierdzenia.</p>
          <p>Jeśli nie widzisz wiadomości e-mail, sprawdź folder SPAM. W razie problemów skontaktuj się z nami mailowo lub telefonicznie.</p>
        </div>
        <div class="hb-actions hb-actions--end"><button type="button" class="hb-btn" id="hb-close-final">Zamknij</button></div>`;
    }

    root.innerHTML = renderSteps() + inner;
    bindHandlers();
  }

  function bindHandlers() {
    if (state.step === 1) {
      const goToStep2 = () => {
        if (!state.hallId) return;
        state.step = 2;
        renderBody();
      };
      document.querySelectorAll("#hb-hall-cards .hb-card").forEach((el) => {
        el.addEventListener("click", () => {
          state.hallId = el.dataset.id;
          state.hallKind = el.dataset.kind;
          state.hallCapacity = Number(el.dataset.cap) || 40;
          document.querySelectorAll("#hb-hall-cards .hb-card").forEach((c) => c.classList.remove("selected"));
          el.classList.add("selected");
          document.getElementById("hb-next-1").disabled = false;
          goToStep2();
        });
      });
      document.getElementById("hb-next-1")?.addEventListener("click", goToStep2);
    }
    if (state.step === 2) {
      const validate = async () => {
        const err = document.getElementById("hb-e2");
        const next = document.getElementById("hb-next-2");
        const today = todayYmdWarsaw();
        state.reservationDate = document.getElementById("hb-date")?.value || "";
        state.startTime = document.getElementById("hb-start")?.value || "";
        state.durationHours = Number(document.getElementById("hb-dur")?.value || 2);
        if (!state.reservationDate || state.reservationDate < today) {
          err.hidden = false;
          err.textContent = "Wybierz datę nie z przeszłości.";
          next.disabled = true;
          return;
        }
        const startChk = hallReservationStartOk(state.reservationDate, state.startTime);
        if (!startChk.ok) {
          err.hidden = false;
          err.textContent = startChk.message;
          next.disabled = true;
          return;
        }
        err.hidden = true;
        err.textContent = "";
        next.disabled = true;
        try {
          await refreshAvailability();
          if (!state.availabilityOk || (state.hallKind === "large" && state.maxGuestsAvailable < 1)) {
            err.hidden = false;
            err.textContent = "Ten termin nie jest dostępny. Wybierz inną godzinę lub datę.";
            next.disabled = true;
            return;
          }
          err.hidden = true;
          next.disabled = false;
        } catch (e) {
          err.hidden = false;
          err.textContent = e.message || "Błąd sprawdzania dostępności.";
          next.disabled = true;
        }
      };
      document.getElementById("hb-date")?.addEventListener("input", validate);
      document.getElementById("hb-date")?.addEventListener("change", validate);
      document.getElementById("hb-start")?.addEventListener("change", validate);
      document.getElementById("hb-dur")?.addEventListener("change", validate);
      validate();
      document.getElementById("hb-back-2")?.addEventListener("click", () => {
        state.step = 1;
        renderBody();
      });
      document.getElementById("hb-next-2")?.addEventListener("click", async () => {
        const err = document.getElementById("hb-e2");
        state.reservationDate = document.getElementById("hb-date")?.value || "";
        if (state.reservationDate < todayYmdWarsaw()) {
          err.hidden = false;
          err.textContent = "Wybierz datę nie z przeszłości.";
          return;
        }
        const startChkNext = hallReservationStartOk(state.reservationDate, state.startTime);
        if (!startChkNext.ok) {
          err.hidden = false;
          err.textContent = startChkNext.message;
          return;
        }
        await refreshAvailability();
        if (!state.availabilityOk) return;
        if (state.hallKind === "large" && state.maxGuestsAvailable < 1) return;
        state.step = 3;
        renderBody();
      });
    }
    if (state.step === 3) {
      const syncGuests = async () => {
        if (state.hallKind === "small") {
          state.guestsCount = Number(document.getElementById("hb-guests-sm")?.value || 1);
        } else {
          const r = document.getElementById("hb-guests-range");
          state.guestsCount = Number(r?.value || 1);
          const lbl = document.getElementById("hb-guest-val");
          if (lbl) lbl.textContent = String(state.guestsCount);
        }
        state.eventType = document.getElementById("hb-event")?.value || "";
        state.customerNote = document.getElementById("hb-note")?.value || "";
        if (state.hallKind === "large") {
          state.exclusive = document.getElementById("hb-exc")?.checked || false;
        }
        await refreshAvailability();
        if (state.hallKind === "large") {
          const maxG = Math.min(state.maxGuestsAvailable, state.hallCapacity);
          const range = document.getElementById("hb-guests-range");
          if (range) {
            range.max = String(Math.max(1, maxG));
            if (state.guestsCount > maxG) {
              state.guestsCount = maxG;
              range.value = String(maxG);
              document.getElementById("hb-guest-val").textContent = String(maxG);
            }
          }
          document.getElementById("hb-max-lbl").textContent = String(maxG);
        }
      };

      document.getElementById("hb-guests-range")?.addEventListener("input", syncGuests);
      document.getElementById("hb-guests-sm")?.addEventListener("input", syncGuests);
      document.getElementById("hb-event")?.addEventListener("input", syncGuests);
      document.getElementById("hb-note")?.addEventListener("input", syncGuests);
      document.getElementById("hb-exc")?.addEventListener("change", syncGuests);

      const validate = async (showErrors = false) => {
        await syncGuests();
        const err = document.getElementById("hb-e3");
        const next = document.getElementById("hb-next-3");
        if (!String(state.eventType).trim()) {
          err.hidden = !showErrors;
          err.textContent = showErrors ? "Podaj rodzaj imprezy." : "";
          next.disabled = true;
          return;
        }
        if (!String(state.customerNote).trim()) {
          err.hidden = !showErrors;
          err.textContent = showErrors ? "Uzupełnij dodatkowe informacje." : "";
          next.disabled = true;
          return;
        }
        if (state.hallKind === "small" && state.guestsCount > 40) {
          err.hidden = !showErrors;
          err.textContent = showErrors ? "Max 40 osób w małej sali." : "";
          next.disabled = true;
          return;
        }
        if (state.hallKind === "large" && state.guestsCount > state.maxGuestsAvailable) {
          err.hidden = !showErrors;
          err.textContent = showErrors ? "Zmniejsz liczbę gości — brak wolnych miejsc w tym terminie." : "";
          next.disabled = true;
          return;
        }
        err.hidden = true;
        next.disabled = false;
      };

      document.getElementById("hb-next-3")?.addEventListener("click", async () => {
        await validate(true);
        const next = document.getElementById("hb-next-3");
        if (next.disabled) return;
        const startChk3 = hallReservationStartOk(state.reservationDate, state.startTime);
        if (!startChk3.ok) {
          const err = document.getElementById("hb-e3");
          err.hidden = false;
          err.textContent = `${startChk3.message} Wróć do kroku „Termin”.`;
          return;
        }
        state.step = 4;
        renderBody();
      });
      document.getElementById("hb-back-3")?.addEventListener("click", () => {
        state.step = 2;
        renderBody();
      });
      validate(false);
    }
    if (state.step === 4) {
      document.getElementById("hb-cust")?.addEventListener("submit", (ev) => {
        ev.preventDefault();
        if (!ev.currentTarget.reportValidity()) {
          return;
        }
        const fd = new FormData(ev.target);
        state.customer = {
          fullName: String(fd.get("fullName") || "").trim(),
          email: String(fd.get("email") || "").trim(),
          phonePrefix: String(fd.get("phonePrefix") || "").trim(),
          phoneNational: String(fd.get("phoneNational") || "").trim(),
          hpCompanyWebsite: String(fd.get("hpCompanyWebsite") || ""),
        };
        state.step = 5;
        renderBody();
        mountTurnstileIfNeeded();
      });
      document.getElementById("hb-back-4")?.addEventListener("click", () => {
        state.step = 3;
        renderBody();
      });
    }
    if (state.step === 5) {
      mountTurnstileIfNeeded();
      document.getElementById("hb-back-5")?.addEventListener("click", () => {
        state.step = 4;
        renderBody();
      });
      document.getElementById("hb-submit")?.addEventListener("click", async () => {
        const err = document.getElementById("hb-e5");
        if (!document.getElementById("hb-terms")?.checked) {
          err.hidden = false;
          err.textContent = "Wymagana akceptacja oświadczeń.";
          return;
        }
        err.hidden = true;
        const startChk5 = hallReservationStartOk(state.reservationDate, state.startTime);
        if (!startChk5.ok) {
          err.hidden = false;
          err.textContent = `${startChk5.message} Wróć do kroku „Termin”.`;
          return;
        }
        try {
          const siteKey = config.turnstileSiteKey;
          if (siteKey && !state.turnstileToken) {
            err.hidden = false;
            err.textContent = "Potwierdź weryfikację anty-spam.";
            return;
          }
          await api("public-reservation-draft", {
            method: "POST",
            body: {
              hpCompanyWebsite: state.customer.hpCompanyWebsite || "",
              sessionStartedAt: state.sessionStartedAt,
              turnstileToken: state.turnstileToken,
              hallId: state.hallId,
              reservationDate: state.reservationDate,
              startTime: state.startTime,
              durationHours: state.durationHours,
              guestsCount: state.guestsCount,
              exclusive: state.hallKind === "large" ? state.exclusive : true,
              eventType: state.eventType,
              customerNote: state.customerNote,
              fullName: state.customer.fullName,
              email: state.customer.email,
              phonePrefix: state.customer.phonePrefix,
              phoneNational: state.customer.phoneNational,
              termsAccepted: true,
            },
          });
          state.step = 6;
          renderBody();
        } catch (e) {
          err.hidden = false;
          err.textContent = e.message || "Nie udało się wysłać.";
        }
      });
    }
    if (state.step === 6) {
      document.getElementById("hb-close-final")?.addEventListener("click", closeModal);
    }
  }

  function mountTurnstileIfNeeded() {
    const siteKey = config.turnstileSiteKey;
    const slot = document.getElementById("turnstile-slot-hall");
    if (!slot || !siteKey || !window.turnstile) return;
    slot.innerHTML = "";
    window.turnstile.render(slot, {
      sitekey: siteKey,
      callback: (token) => {
        state.turnstileToken = token;
      },
    });
  }

  async function openModal() {
    injectStyles();
    const modal = document.getElementById("hall-booking-modal");
    if (!modal) return;
    const fetchFn = window.SREDZKA_fetchBookingSettings;
    if (typeof fetchFn === "function") {
      try {
        const s = await fetchFn();
        if (s && s.events === false) {
          resetState();
          modal.classList.add("hb-open");
          modal.setAttribute("aria-hidden", "false");
          const root = modal.querySelector(".hb-inner");
          if (root) {
            root.innerHTML = `<div class="hb-success"><p>Rezerwacje online sa obecnie wstrzymane.</p><p>Aby dokonac rezerwacji, prosimy o kontakt telefoniczny lub przez formularz kontaktowy.</p><p><button type="button" class="hb-btn" id="hb-close-paused">Zamknij</button></p></div>`;
            document.getElementById("hb-close-paused")?.addEventListener("click", closeModal);
          }
          return;
        }
      } catch {
        /* kontynuuj normalny przepływ */
      }
    }
    resetState();
    modal.classList.add("hb-open");
    modal.setAttribute("aria-hidden", "false");
    const root = modal.querySelector(".hb-inner");
    if (root) root.innerHTML = "<p>Ładowanie…</p>";
    try {
      const data = await api("public-halls", { method: "GET" });
      state.halls = data.halls || [];
      if (!state.halls.length) {
        root.innerHTML = "<p>Brak aktywnych sal — skontaktuj się z obiektem.</p>";
        return;
      }
      renderBody();
    } catch (e) {
      root.innerHTML = `<p class="hb-err">${escapeHtml(e.message)}</p>`;
    }
  }

  function closeModal() {
    const modal = document.getElementById("hall-booking-modal");
    if (!modal) return;
    modal.classList.remove("hb-open");
    modal.setAttribute("aria-hidden", "true");
  }

  function init() {
    injectStyles();
    /* Delegacja: treść strony (np. #app) może pojawić się po DOMContentLoaded. */
    document.addEventListener("click", (e) => {
      const t = e.target.closest("[data-open-hall-booking]");
      if (t) {
        e.preventDefault();
        openModal();
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const t = e.target.closest("[data-open-hall-booking]");
      if (t) {
        e.preventDefault();
        openModal();
      }
    });
    document.getElementById("hall-booking-modal")?.addEventListener("click", (e) => {
      if (e.target.id === "hall-booking-modal") closeModal();
    });
    document.getElementById("hb-modal-close")?.addEventListener("click", closeModal);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
