const nodemailer = require("nodemailer");

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Bezpieczne podstawianie: wartości escapowane do HTML.
 * Zmienne {{name}} — brak eval.
 */
function renderTemplate(template, vars) {
  if (!template) return "";
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    if (v === undefined || v === null) return "";
    return escapeHtml(String(v));
  });
}

const DEFAULT_TEMPLATES = {
  confirm_email: {
    subject: "{{hotelName}} — potwierdź rezerwację ({{reservationNumber}})",
    bodyHtml: `<p>Witaj {{fullName}},</p>
<p>Dziękujemy za zainteresowanie pobytem w {{hotelName}}.</p>
<p>Aby <strong>potwierdzić zgłoszenie</strong>, kliknij w link (ważny 2 godziny):</p>
<p><a href="{{confirmationLink}}">Potwierdź rezerwację</a></p>
<p>Numer: {{reservationNumber}}<br/>
Termin: {{dateFrom}} — {{dateTo}} ({{nights}} nocy)<br/>
Łącznie: {{totalPrice}} PLN</p>
<p>{{roomsList}}</p>
<p>Pozdrawiamy,<br/>{{hotelName}}</p>`,
  },
  pending_client: {
    subject: "{{hotelName}} — rezerwacja oczekuje na akceptację ({{reservationNumber}})",
    bodyHtml: `<p>Witaj {{fullName}},</p>
<p>Twoja rezerwacja została <strong>potwierdzona e-mailem</strong> i ma status <strong>oczekujący na akceptację przez hotel</strong>.</p>
<p>Numer: {{reservationNumber}}<br/>
Termin: {{dateFrom}} — {{dateTo}} ({{nights}} nocy)<br/>
Kwota: {{totalPrice}} PLN</p>
<p>Hotel ma do <strong>3 dni kalendarzowych</strong> na potwierdzenie. Brak odpowiedzi w tym czasie może skutkować automatycznym anulowaniem zgodnie z regulaminem.</p>
<p>{{roomsList}}</p>
<p>{{hotelName}}</p>`,
  },
  pending_admin: {
    subject: "[{{hotelName}}] Nowa rezerwacja oczekująca {{reservationNumber}}",
    bodyHtml: `<p>Nowa rezerwacja wymaga decyzji.</p>
<p><strong>{{fullName}}</strong><br/>{{email}}<br/>{{phone}}</p>
<p>Numer: {{reservationNumber}}<br/>
Termin: {{dateFrom}} — {{dateTo}} ({{nights}} nocy)<br/>
Kwota: {{totalPrice}} PLN</p>
<p>Uwagi klienta: {{customerNote}}</p>
<p>{{roomsList}}</p>`,
  },
  confirmed_client: {
    subject: "{{hotelName}} — rezerwacja potwierdzona ({{reservationNumber}})",
    bodyHtml: `<p>Witaj {{fullName}},</p>
<p>Twoja rezerwacja została <strong>potwierdzona przez hotel</strong>.</p>
<p>Numer: {{reservationNumber}}<br/>
Termin: {{dateFrom}} — {{dateTo}}<br/>
Kwota: {{totalPrice}} PLN</p>
<p>{{roomsList}}</p>
<p>{{hotelName}}</p>`,
  },
  cancelled_client: {
    subject: "{{hotelName}} — rezerwacja anulowana ({{reservationNumber}})",
    bodyHtml: `<p>Witaj {{fullName}},</p>
<p>Twoja rezerwacja <strong>{{reservationNumber}}</strong> została anulowana.</p>
<p>Termin był: {{dateFrom}} — {{dateTo}}</p>
<p>W razie pytań skontaktuj się z recepcją.</p>
<p>{{hotelName}}</p>`,
  },
  expired_pending_client: {
    subject: "{{hotelName}} — rezerwacja wygasła ({{reservationNumber}})",
    bodyHtml: `<p>Witaj {{fullName}},</p>
<p>Rezerwacja <strong>{{reservationNumber}}</strong> wygasła, ponieważ hotel nie potwierdził jej w wymaganym terminie.</p>
<p>Terminy zostały zwolnione. Możesz złożyć nowe zgłoszenie na stronie obiektu.</p>
<p>{{hotelName}}</p>`,
  },
  expired_pending_admin: {
    subject: "[{{hotelName}}] Wygasła rezerwacja oczekująca {{reservationNumber}}",
    bodyHtml: `<p>Rezerwacja {{reservationNumber}} wygasła automatycznie (brak potwierdzenia w ciągu 3 dni kalendarzowych).</p>
<p>Klient: {{fullName}} ({{email}})</p>
<p>Termin: {{dateFrom}} — {{dateTo}}</p>`,
  },
  expired_email_client: {
    subject: "{{hotelName}} — zgłoszenie wygasło (bez potwierdzenia e-mail)",
    bodyHtml: `<p>Witaj {{fullName}},</p>
<p>Nie otrzymaliśmy potwierdzenia e-mailem w ciągu 2 godzin. Zgłoszenie zostało anulowane — terminy nie zostały zablokowane.</p>
<p>{{hotelName}}</p>`,
  },
  cancelled_admin: {
    subject: "[{{hotelName}}] Anulowano rezerwację {{reservationNumber}}",
    bodyHtml: `<p>Rezerwacja {{reservationNumber}} została anulowana.</p>
<p>Klient: {{fullName}} ({{email}})</p>`,
  },
};

const RESTAURANT_DEFAULT_TEMPLATES = {
  restaurant_confirm_email: {
    subject: "{{restaurantName}} — potwierdź rezerwację stolika ({{reservationNumber}})",
    bodyHtml: `<p>Witaj {{fullName}},</p>
<p>Dziękujemy za zainteresowanie rezerwacją stolika w {{restaurantName}}.</p>
<p>Aby <strong>potwierdzić zgłoszenie</strong>, kliknij w link (ważny 2 godziny):</p>
<p><a href="{{confirmationLink}}">Potwierdź rezerwację</a></p>
<p>Numer: {{reservationNumber}}<br/>
{{date}} · {{timeFrom}}–{{timeTo}} ({{durationHours}} h)<br/>
Stoliki: {{tablesCount}} · Goście: {{guestsCount}}</p>
<p>{{tablesList}}</p>
<p>Pozdrawiamy,<br/>{{restaurantName}}</p>`,
  },
  restaurant_pending_client: {
    subject: "{{restaurantName}} — rezerwacja oczekuje na akceptację ({{reservationNumber}})",
    bodyHtml: `<p>Witaj {{fullName}},</p>
<p>Twoja rezerwacja została <strong>potwierdzona e-mailem</strong> i ma status <strong>oczekujący na akceptację przez restaurację</strong>.</p>
<p>Numer: {{reservationNumber}}<br/>
{{date}} · {{timeFrom}}–{{timeTo}}</p>
<p>Stoliki: {{tablesList}} · Goście: {{guestsCount}}</p>
<p>Restauracja ma do <strong>3 dni</strong> na potwierdzenie. Brak odpowiedzi może skutkować automatycznym anulowaniem zgodnie z regulaminem.</p>
<p>{{restaurantName}}</p>`,
  },
  restaurant_pending_admin: {
    subject: "[{{restaurantName}}] Nowa rezerwacja stolika {{reservationNumber}}",
    bodyHtml: `<p>Nowa rezerwacja wymaga decyzji.</p>
<p><strong>{{fullName}}</strong><br/>{{email}}<br/>{{phone}}</p>
<p>Numer: {{reservationNumber}}<br/>
{{date}} · {{timeFrom}}–{{timeTo}} ({{durationHours}} h)</p>
<p>Stoliki: {{tablesList}} · Goście: {{guestsCount}} · Łączenie: {{joinTables}}</p>
<p>Uwagi klienta: {{customerNote}}</p>`,
  },
  restaurant_confirmed_client: {
    subject: "{{restaurantName}} — rezerwacja potwierdzona ({{reservationNumber}})",
    bodyHtml: `<p>Witaj {{fullName}},</p>
<p>Twoja rezerwacja została <strong>potwierdzona przez restaurację</strong>.</p>
<p>Numer: {{reservationNumber}}<br/>
{{date}} · {{timeFrom}}–{{timeTo}}</p>
<p>{{tablesList}}</p>
<p>{{restaurantName}}</p>`,
  },
  restaurant_cancelled_client: {
    subject: "{{restaurantName}} — rezerwacja anulowana ({{reservationNumber}})",
    bodyHtml: `<p>Witaj {{fullName}},</p>
<p>Rezerwacja <strong>{{reservationNumber}}</strong> została anulowana.</p>
<p>Termin: {{date}} · {{timeFrom}}–{{timeTo}}</p>
<p>{{restaurantName}}</p>`,
  },
  restaurant_expired_pending_client: {
    subject: "{{restaurantName}} — rezerwacja wygasła ({{reservationNumber}})",
    bodyHtml: `<p>Witaj {{fullName}},</p>
<p>Rezerwacja <strong>{{reservationNumber}}</strong> wygasła — restauracja nie potwierdziła jej w wymaganym terminie.</p>
<p>Stoliki zostały zwolnione. Możesz złożyć nowe zgłoszenie na stronie.</p>
<p>{{restaurantName}}</p>`,
  },
  restaurant_expired_pending_admin: {
    subject: "[{{restaurantName}}] Wygasła rezerwacja oczekująca {{reservationNumber}}",
    bodyHtml: `<p>Rezerwacja {{reservationNumber}} wygasła automatycznie (brak potwierdzenia w ciągu 3 dni).</p>
<p>Klient: {{fullName}} ({{email}})</p>
<p>Termin: {{date}} · {{timeFrom}}–{{timeTo}}</p>`,
  },
  restaurant_expired_email_client: {
    subject: "{{restaurantName}} — zgłoszenie wygasło (bez potwierdzenia e-mail)",
    bodyHtml: `<p>Witaj {{fullName}},</p>
<p>Nie otrzymaliśmy potwierdzenia e-mailem w ciągu 2 godzin. Zgłoszenie zostało anulowane — stoliki nie zostały zablokowane.</p>
<p>{{restaurantName}}</p>`,
  },
};

const HALL_DEFAULT_TEMPLATES = {
  hall_confirm_email: {
    subject: "{{venueName}} — potwierdź zgłoszenie rezerwacji sali ({{reservationNumber}})",
    bodyHtml: `<p>Witaj {{fullName}},</p>
<p>Dziękujemy za zainteresowanie rezerwacją sali w {{venueName}}.</p>
<p>To jest <strong>zgłoszenie rezerwacyjne</strong> — wycena zostanie ustalona indywidualnie po kontakcie telefonicznym z obiektu.</p>
<p>Aby potwierdzić zgłoszenie e-mailem (ważne 2 godziny), kliknij:</p>
<p><a href="{{confirmationLink}}">Potwierdź zgłoszenie</a></p>
<p>Numer: {{reservationNumber}}<br/>
Sala: {{hallName}}<br/>
{{date}} · {{timeFrom}}–{{timeTo}} ({{durationHours}} h)<br/>
Goście: {{guestsCount}} · {{eventType}}<br/>
Wyłączność: {{exclusive}}</p>
<p>{{venueName}}</p>`,
  },
  hall_pending_client: {
    subject: "{{venueName}} — zgłoszenie oczekuje na decyzję obiektu ({{reservationNumber}})",
    bodyHtml: `<p>Witaj {{fullName}},</p>
<p>Zgłoszenie zostało <strong>potwierdzone linkiem e-mail</strong>. Status: <strong>oczekujące na akceptację przez obiekt</strong>.</p>
<p><strong>Wycena zostanie podana telefonicznie</strong> — obsługa skontaktuje się z Tobą w sprawie kosztów i dalszego potwierdzenia.</p>
<p>Obiekt ma <strong>7 dni</strong> na decyzję (możliwe jest przedłużenie terminu przez obsługę).</p>
<p>Numer: {{reservationNumber}} · {{hallName}}<br/>
{{date}} · {{timeFrom}}–{{timeTo}}</p>
<p>{{venueName}}</p>`,
  },
  hall_pending_admin: {
    subject: "[{{venueName}}] Nowe zgłoszenie sali {{reservationNumber}}",
    bodyHtml: `<p>Nowe zgłoszenie rezerwacji sali wymaga decyzji.</p>
<p><strong>{{fullName}}</strong><br/>{{email}}<br/>{{phone}}</p>
<p>Numer: {{reservationNumber}}<br/>
Sala: {{hallName}} · {{date}} · {{timeFrom}}–{{timeTo}} ({{durationHours}} h)<br/>
Goście: {{guestsCount}} · Wyłączność: {{exclusive}} · 100+: {{fullBlockLabel}}</p>
<p>Rodzaj imprezy: {{eventType}}</p>
<p>Uwagi klienta: {{customerNote}}</p>`,
  },
  hall_confirmed_client: {
    subject: "{{venueName}} — rezerwacja sali potwierdzona ({{reservationNumber}})",
    bodyHtml: `<p>Witaj {{fullName}},</p>
<p>Rezerwacja sali została <strong>potwierdzona przez obiekt</strong> ({{hallName}}).</p>
<p>Termin: {{date}} · {{timeFrom}}–{{timeTo}}</p>
<p>Szczegóły i wycena — zgodnie z ustaleniami telefonicznymi.</p>
<p>{{venueName}}</p>`,
  },
  hall_cancelled_client: {
    subject: "{{venueName}} — rezerwacja sali anulowana ({{reservationNumber}})",
    bodyHtml: `<p>Witaj {{fullName}},</p>
<p>Rezerwacja <strong>{{reservationNumber}}</strong> została anulowana.</p>
<p>Termin: {{date}} · {{hallName}}</p>
<p>{{venueName}}</p>`,
  },
  hall_expired_pending_client: {
    subject: "{{venueName}} — zgłoszenie sali wygasło ({{reservationNumber}})",
    bodyHtml: `<p>Witaj {{fullName}},</p>
<p>Zgłoszenie <strong>{{reservationNumber}}</strong> wygasło — obiekt nie potwierdził rezerwacji w wymaganym terminie.</p>
<p>Możesz złożyć nowe zgłoszenie na stronie.</p>
<p>{{venueName}}</p>`,
  },
  hall_expired_pending_admin: {
    subject: "[{{venueName}}] Wygasła rezerwacja sali {{reservationNumber}}",
    bodyHtml: `<p>Rezerwacja {{reservationNumber}} wygasła automatycznie (brak potwierdzenia w terminie oczekiwania).</p>
<p>Klient: {{fullName}} ({{email}})</p>
<p>{{hallName}} · {{date}} · {{timeFrom}}–{{timeTo}}</p>`,
  },
  hall_expired_email_client: {
    subject: "{{venueName}} — zgłoszenie wygasło (bez potwierdzenia e-mail)",
    bodyHtml: `<p>Witaj {{fullName}},</p>
<p>Nie otrzymaliśmy potwierdzenia e-mailem w ciągu 2 godzin. Zgłoszenie zostało anulowane — termin nie został zablokowany.</p>
<p>{{venueName}}</p>`,
  },
  hall_extended_pending_client: {
    subject: "{{venueName}} — przedłużono termin oczekiwania ({{reservationNumber}})",
    bodyHtml: `<p>Witaj {{fullName}},</p>
<p>Termin oczekiwania na decyzję dotyczącą zgłoszenia <strong>{{reservationNumber}}</strong> został przedłużony do: <strong>{{expiresAt}}</strong>.</p>
<p>{{venueName}}</p>`,
  },
};

async function getMailTemplate(db, key) {
  const snap = await db.collection("hotelMailTemplates").doc(key).get();
  if (!snap.exists) {
    return DEFAULT_TEMPLATES[key] || { subject: "", bodyHtml: "" };
  }
  const d = snap.data();
  return {
    subject: d.subject || DEFAULT_TEMPLATES[key]?.subject || "",
    bodyHtml: d.bodyHtml || DEFAULT_TEMPLATES[key]?.bodyHtml || "",
  };
}

async function getRestaurantMailTemplate(db, key) {
  const snap = await db.collection("restaurantMailTemplates").doc(key).get();
  if (!snap.exists) {
    return RESTAURANT_DEFAULT_TEMPLATES[key] || { subject: "", bodyHtml: "" };
  }
  const d = snap.data();
  return {
    subject: d.subject || RESTAURANT_DEFAULT_TEMPLATES[key]?.subject || "",
    bodyHtml: d.bodyHtml || RESTAURANT_DEFAULT_TEMPLATES[key]?.bodyHtml || "",
  };
}

async function getHallMailTemplate(db, key) {
  const snap = await db.collection("venueMailTemplates").doc(key).get();
  if (!snap.exists) {
    return HALL_DEFAULT_TEMPLATES[key] || { subject: "", bodyHtml: "" };
  }
  const d = snap.data();
  return {
    subject: d.subject || HALL_DEFAULT_TEMPLATES[key]?.subject || "",
    bodyHtml: d.bodyHtml || HALL_DEFAULT_TEMPLATES[key]?.bodyHtml || "",
  };
}

function createTransportFromEnv() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    return null;
  }
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

async function sendMail(envLabel, { to, subject, html, replyTo }) {
  const transporter = createTransportFromEnv();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  if (!transporter || !from) {
    console.warn(
      `[mail:${envLabel}] SMTP nie skonfigurowane (SMTP_HOST, SMTP_USER, SMTP_PASS) — pomijam wysyłkę do ${to}`
    );
    return { skipped: true };
  }
  await transporter.sendMail({
    from,
    to,
    subject,
    html,
    replyTo: replyTo || undefined,
  });
  return { ok: true };
}

module.exports = {
  escapeHtml,
  renderTemplate,
  DEFAULT_TEMPLATES,
  RESTAURANT_DEFAULT_TEMPLATES,
  HALL_DEFAULT_TEMPLATES,
  getMailTemplate,
  getRestaurantMailTemplate,
  getHallMailTemplate,
  sendMail,
};
