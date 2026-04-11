(function () {
  const BRAND =
    '<div class="confirm-brand">' +
    '<a href="../index.html" class="confirm-logo-link" aria-label="Średzka Korona — strona główna">' +
    '<span class="confirm-logo-text">ŚREDZKA</span>' +
    '<img class="confirm-logo-img" src="../ikony/logo-korona.png" alt="" width="48" height="48" decoding="async" />' +
    '<span class="confirm-logo-text">KORONA</span>' +
    "</a></div>";
  const CTA =
    '<div class="confirm-actions">' +
    '<a class="confirm-cta" href="../index.html">Wróć na stronę główną <span class="confirm-domain">sredzkakorona.pl</span></a>' +
    "</div>";

  const SERVICE_META = {
    hotel: {
      noun: "rezerwacja hotelowa",
      waitingLabel: "na decyzję recepcji",
      confirmedLabel: "Rezerwacja została potwierdzona",
    },
    restaurant: {
      noun: "rezerwacja stolika",
      waitingLabel: "na decyzję restauracji",
      confirmedLabel: "Rezerwacja została potwierdzona",
    },
    hall: {
      noun: "rezerwacja sali",
      waitingLabel: "na decyzję obiektu",
      confirmedLabel: "Rezerwacja została potwierdzona",
    },
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function apiBaseForService(service) {
    const c = window.SREDZKA_CONFIG || {};
    if (c.apiBase) {
      return `${String(c.apiBase).replace(/\/$/, "")}/api/public/legacy-bookings/${service}`;
    }
    if (service === "hotel" && c.hotelApiBase) return String(c.hotelApiBase).replace(/\/$/, "");
    if (service === "restaurant" && c.restaurantApiBase) return String(c.restaurantApiBase).replace(/\/$/, "");
    if (service === "hall" && c.hallApiBase) return String(c.hallApiBase).replace(/\/$/, "");
    if (c.firebaseProjectId) {
      const fnName = service === "hotel" ? "hotelApi" : service === "restaurant" ? "restaurantApi" : "hallApi";
      return `https://europe-west1-${c.firebaseProjectId}.cloudfunctions.net/${fnName}`;
    }
    return "";
  }

  function renderError(out, title, message) {
    out.innerHTML =
      BRAND +
      `<h1 class="confirm-err-title">${escapeHtml(title)}</h1>` +
      `<p class="confirm-err-text">${escapeHtml(message)}</p>` +
      CTA;
  }

  function renderDetails(details) {
    const rows = Array.isArray(details) ? details : [];
    if (!rows.length) return "";
    return (
      '<div class="confirm-summary">' +
      rows
        .map(
          (row) =>
            '<div class="confirm-summary-row">' +
            `<div class="confirm-summary-label">${escapeHtml(row.label || "")}</div>` +
            `<div class="confirm-summary-value">${escapeHtml(row.value || "")}</div>` +
            "</div>"
        )
        .join("") +
      "</div>"
    );
  }

  function leadText(data, confirmedNow) {
    const meta = SERVICE_META[data.service] || SERVICE_META.hotel;
    if (data.status === "confirmed") {
      return confirmedNow
        ? `Rezerwacja <strong class="confirm-highlight">${escapeHtml(data.reservationNumber || "")}</strong> została właśnie potwierdzona.`
        : `Rezerwacja <strong class="confirm-highlight">${escapeHtml(data.reservationNumber || "")}</strong> jest już potwierdzona.`;
    }
    if (data.status === "pending") {
      return `Ta ${meta.noun} oczekuje ${meta.waitingLabel}. Możesz sprawdzić szczegóły i zatwierdzić ją bez logowania.`;
    }
    if (data.status === "cancelled") {
      return "Ta rezerwacja została już anulowana i nie może zostać potwierdzona z tego linku.";
    }
    if (data.status === "expired") {
      return "Ta rezerwacja wygasła i nie może już zostać potwierdzona z tego linku.";
    }
    return "Ta rezerwacja nie oczekuje już na decyzję.";
  }

  function noteText(data) {
    if (data.status === "pending" && data.decisionDeadline) {
      return `<strong>Termin decyzji:</strong> ${escapeHtml(data.decisionDeadline)}.`;
    }
    if (data.status === "confirmed") {
      return "Klient otrzyma standardowe potwierdzenie e-mailowe po zatwierdzeniu rezerwacji.";
    }
    return "";
  }

  function renderState(out, data, opts) {
    const options = opts || {};
    const confirmedNow = Boolean(options.confirmedNow);
    const showConfirmButton = Boolean(data.canConfirm && data.status === "pending");
    const note = noteText(data);

    out.innerHTML =
      BRAND +
      '<p class="confirm-kicker">Akceptacja rezerwacji</p>' +
      `<h1 class="confirm-title">${escapeHtml(data.status === "confirmed" ? (SERVICE_META[data.service]?.confirmedLabel || "Rezerwacja została potwierdzona") : "Podgląd rezerwacji")}</h1>` +
      `<p class="confirm-lead">${leadText(data, confirmedNow)}</p>` +
      renderDetails(data.details) +
      (note ? `<div class="confirm-note">${note}</div>` : "") +
      (showConfirmButton
        ? '<div class="confirm-action-stack"><button type="button" class="confirm-cta confirm-cta-button" id="confirm-admin-booking">Potwierdź rezerwację</button></div>'
        : "") +
      CTA;

    const button = out.querySelector("#confirm-admin-booking");
    if (!button) return;
    button.addEventListener("click", options.onConfirm);
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Nie udało się pobrać danych rezerwacji.");
    }
    return data;
  }

  async function init() {
    const out = document.querySelector("#out");
    const service = document.body.getAttribute("data-booking-service");
    const token = new URLSearchParams(window.location.search).get("token");
    if (!service || !SERVICE_META[service]) {
      renderError(out, "Konfiguracja", "Brak informacji o typie rezerwacji.");
      return;
    }
    if (service === "restaurant") {
      renderError(out, "Moduł niedostępny", "Rezerwacje cateringu zostały wyłączone.");
      return;
    }
    if (!token) {
      renderError(out, "Brak tokenu", "Link jest niepełny lub nieprawidłowy.");
      return;
    }
    const base = apiBaseForService(service);
    if (!base) {
      renderError(out, "Konfiguracja", "Brak konfiguracji API rezerwacji.");
      return;
    }

    async function loadState() {
      return fetchJson(`${base}?op=public-admin-action-view&token=${encodeURIComponent(token)}`, {
        method: "GET",
      });
    }

    async function confirmReservation(event) {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = "Potwierdzanie...";
      try {
        const data = await fetchJson(`${base}?op=public-admin-action-confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        renderState(out, data, { confirmedNow: true });
      } catch (error) {
        button.disabled = false;
        button.textContent = "Potwierdź rezerwację";
        window.alert(error.message || "Nie udało się potwierdzić rezerwacji.");
      }
    }

    try {
      const data = await loadState();
      renderState(out, data, { onConfirm: confirmReservation });
    } catch (error) {
      renderError(out, "Nie udało się otworzyć rezerwacji", error.message || "Spróbuj ponownie później.");
    }
  }

  init();
})();
