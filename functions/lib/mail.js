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

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function enhanceFragmentHtml(html) {
  return String(html || "")
    .replace(/<a\b([^>]*)>/gi, (match, attrs) => {
      if (/\bstyle\s*=/i.test(attrs)) return `<a${attrs}>`;
      return `<a${attrs} style="color:#7b5a24;font-weight:700;text-decoration:none;border-bottom:1px solid #c8aa78;">`;
    })
    .replace(/<h([1-3])\b([^>]*)>/gi, (match, level, attrs) => {
      if (/\bstyle\s*=/i.test(attrs)) return `<h${level}${attrs}>`;
      const sizes = { 1: "30px", 2: "24px", 3: "20px" };
      return `<h${level}${attrs} style="margin:0 0 18px 0;font-family:Georgia,'Times New Roman',serif;font-size:${sizes[level] || "24px"};line-height:1.2;color:#1f1712;font-weight:700;text-align:center;">`;
    });
}

function htmlToText(html) {
  if (!html) return "";
  return decodeHtmlEntities(
    String(html)
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<head[\s\S]*?<\/head>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/tr>/gi, "\n")
      .replace(/<\/h[1-6]>/gi, "\n\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<\/li>/gi, "\n")
      .replace(/<a\b[^>]*href=(['"])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (_, __, href, label) => {
        const text = decodeHtmlEntities(String(label || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
        return text ? `${text} (${href})` : href;
      })
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
  )
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function buildBrandedEmail({
  subject,
  htmlFragment,
  brandName = "Średzka Korona",
  serviceLabel = "",
  siteUrl = "",
  serviceUrl = "",
  preheader = "",
  actionUrl = "",
  actionLabel = "",
}) {
  const safeBrandName = escapeHtml(brandName);
  const safeSubject = escapeHtml(subject || brandName);
  const safeServiceLabel = escapeHtml(serviceLabel);
  const safePreheader = escapeHtml(preheader || subject || brandName);
  const safeSiteUrl = String(siteUrl || "").replace(/\/$/, "");
  const safeServiceUrl = String(serviceUrl || "").replace(/\/$/, "");
  const logoUrl = safeSiteUrl ? `${safeSiteUrl}/ikony/logo-korona.png` : "";
  const enhancedContent = enhanceFragmentHtml(htmlFragment);
  const actionHref = actionUrl ? escapeHtml(actionUrl) : "";
  const actionTitle = escapeHtml(actionLabel || "Zobacz szczegóły");
  const footerHref = safeServiceUrl || safeSiteUrl;
  const footerLabel = safeServiceLabel || "Strona główna";

  const html = `<!doctype html>
<html lang="pl">
  <body style="margin:0;padding:0;background-color:#f6f1e8;color:#1f1712;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${safePreheader}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background:#f6f1e8;">
      <tr>
        <td align="center" style="padding:28px 12px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;max-width:680px;">
            <tr>
              <td align="center" style="padding:0 0 16px 0;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1;letter-spacing:0.28em;color:#7b5a24;font-weight:700;padding-right:10px;">ŚREDZKA</td>
                    <td style="padding:0 2px;">${
                      logoUrl
                        ? `<img src="${escapeHtml(logoUrl)}" alt="Korona" width="42" height="42" style="display:block;width:42px;height:42px;border:0;outline:none;text-decoration:none;" />`
                        : `<span style="display:inline-block;font-size:26px;line-height:1;color:#c8aa78;">&#9819;</span>`
                    }</td>
                    <td style="font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1;letter-spacing:0.28em;color:#7b5a24;font-weight:700;padding-left:10px;">KORONA</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:0 18px 18px 18px;font-size:12px;line-height:1.5;letter-spacing:0.18em;text-transform:uppercase;color:#8b7a67;">
                ${safeServiceLabel || "Hotel • Restauracja • Przyjęcia"}
              </td>
            </tr>
            <tr>
              <td style="background:#ffffff;border:1px solid #e8dcc8;border-radius:22px;padding:34px 32px;box-shadow:0 10px 30px rgba(52,33,14,0.08);">
                <div style="font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:1.2;color:#1f1712;font-weight:700;margin:0 0 22px 0;text-align:center;">
                  ${safeSubject}
                </div>
                ${
                  actionHref
                    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 26px auto;">
                        <tr>
                          <td style="border-radius:999px;background:#7b5a24;">
                            <a href="${actionHref}" style="display:inline-block;padding:14px 24px;font-size:15px;line-height:1.2;font-weight:700;color:#ffffff;text-decoration:none;">${actionTitle}</a>
                          </td>
                        </tr>
                      </table>`
                    : ""
                }
                <div style="font-size:16px;line-height:1.75;color:#3e3125;">
                  ${enhancedContent}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 10px 0 10px;text-align:center;font-size:13px;line-height:1.7;color:#7c6a58;">
                <div>Wiadomość transakcyjna dotycząca rezerwacji w obiekcie ${safeBrandName}.</div>
                <div style="padding-top:6px;">
                  ${
                    footerHref
                      ? `<a href="${escapeHtml(footerHref)}" style="color:#7b5a24;text-decoration:none;font-weight:700;">${footerLabel}</a>`
                      : safeBrandName
                  }
                </div>
                <div style="padding-top:6px;">Jeśli masz pytania, odpowiedz na tę wiadomość.</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return {
    html,
    text: htmlToText(`${subject || ""}\n\n${html}`),
  };
}

function isSameTemplateShape(left, right) {
  return (
    String(left?.subject || "").trim() === String(right?.subject || "").trim() &&
    String(left?.bodyHtml || "").trim() === String(right?.bodyHtml || "").trim()
  );
}

function infoCard(title, rows, footerHtml = "") {
  const body = rows
    .filter(([, value]) => String(value ?? "").trim())
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #eadfce;color:#7a6754;font-size:13px;line-height:1.4;width:38%;vertical-align:top;">${label}</td>
          <td style="padding:10px 0;border-bottom:1px solid #eadfce;color:#241914;font-size:15px;line-height:1.5;font-weight:600;vertical-align:top;">${value}</td>
        </tr>`
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:24px 0 22px 0;border:1px solid #eadfce;border-radius:18px;background:#fbf7f1;">
    <tr>
      <td style="padding:18px 20px 8px 20px;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.2;color:#241914;font-weight:700;text-align:center;">${title}</td>
    </tr>
    <tr>
      <td style="padding:0 20px 6px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">${body}</table>
      </td>
    </tr>
    ${
      footerHtml
        ? `<tr>
            <td style="padding:0 20px 20px 20px;color:#5e4b39;font-size:14px;line-height:1.7;text-align:center;">${footerHtml}</td>
          </tr>`
        : ""
    }
  </table>`;
}

function noteCard(html) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:18px 0 0 0;border-left:4px solid #c8aa78;background:#f8f1e5;">
    <tr>
      <td style="padding:16px 18px;color:#4c3b2d;font-size:14px;line-height:1.75;">${html}</td>
    </tr>
  </table>`;
}

function buildHotelDefaultTemplates() {
  return {
    confirm_email: {
      subject: "{{hotelName}} — potwierdzenie adresu e-mail ({{reservationNumber}})",
      bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>dziękujemy za wybór <strong>{{hotelName}}</strong>. Otrzymaliśmy zgłoszenie rezerwacji i przygotowaliśmy jego kompletne podsumowanie.</p>
<p>Aby przekazać rezerwację do dalszej obsługi recepcji, potwierdź adres e-mail. Link pozostaje aktywny przez <strong>2 godziny</strong>.</p>
${infoCard("Podsumowanie pobytu", [
  ["Numer rezerwacji", "{{reservationNumber}}"],
  ["Termin pobytu", "{{dateFrom}} — {{dateTo}}"],
  ["Liczba noclegów", "{{nights}}"],
  ["Wybrane pokoje", "{{roomsList}}"],
  ["Orientacyjna kwota do zapłaty na miejscu", "{{totalPrice}} PLN"],
])}
${noteCard("<strong>Ważne:</strong> potwierdzenie adresu e-mail nie jest jeszcze ostatecznym potwierdzeniem pobytu. Po weryfikacji dostępności recepcja prześle kolejną wiadomość ze statusem rezerwacji.")}
<p>Jeżeli to nie Ty wysyłałeś formularz, zignoruj tę wiadomość.</p>`,
    },
    pending_client: {
      subject: "{{hotelName}} — zgłoszenie oczekuje na decyzję recepcji ({{reservationNumber}})",
      bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>adres e-mail został poprawnie potwierdzony, a zgłoszenie zostało przekazane do recepcji <strong>{{hotelName}}</strong>.</p>
<p>Na tym etapie rezerwacja ma status <strong>oczekująca na akceptację</strong>. Do czasu wysłania finalnego potwierdzenia termin nie jest jeszcze gwarantowany.</p>
${infoCard("Podsumowanie zgłoszenia", [
  ["Numer rezerwacji", "{{reservationNumber}}"],
  ["Termin pobytu", "{{dateFrom}} — {{dateTo}}"],
  ["Liczba noclegów", "{{nights}}"],
  ["Pokoje", "{{roomsList}}"],
  ["Orientacyjna kwota do zapłaty na miejscu", "{{totalPrice}} PLN"],
])}
${noteCard("Recepcja wróci do Ciebie z decyzją możliwie szybko. W razie potrzeby możesz odpowiedzieć na tę wiadomość i doprecyzować szczegóły pobytu.")}`,
    },
    pending_admin: {
      subject: "[{{hotelName}}] Nowa rezerwacja do decyzji: {{reservationNumber}}",
      bodyHtml: `<p>Do panelu wpłynęła nowa rezerwacja wymagająca decyzji recepcji.</p>
${infoCard("Dane rezerwacji", [
  ["Numer rezerwacji", "{{reservationNumber}}"],
  ["Klient", "{{fullName}}"],
  ["E-mail", "{{email}}"],
  ["Telefon", "{{phone}}"],
  ["Termin pobytu", "{{dateFrom}} — {{dateTo}}"],
  ["Liczba noclegów", "{{nights}}"],
  ["Pokoje", "{{roomsList}}"],
  ["Orientacyjna kwota", "{{totalPrice}} PLN"],
  ["Uwagi klienta", "{{customerNote}}"],
])}
${noteCard("Po zatwierdzeniu klient otrzyma wiadomość z potwierdzeniem rezerwacji. Po anulowaniu system może wysłać informację o odrzuceniu zgłoszenia.")}`,
    },
    confirmed_client: {
      subject: "{{hotelName}} — rezerwacja potwierdzona ({{reservationNumber}})",
      bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>z przyjemnością potwierdzamy rezerwację pobytu w <strong>{{hotelName}}</strong>.</p>
${infoCard("Potwierdzony pobyt", [
  ["Numer rezerwacji", "{{reservationNumber}}"],
  ["Termin pobytu", "{{dateFrom}} — {{dateTo}}"],
  ["Liczba noclegów", "{{nights}}"],
  ["Pokoje", "{{roomsList}}"],
  ["Orientacyjna kwota do zapłaty na miejscu", "{{totalPrice}} PLN"],
])}
${noteCard("Jeżeli chcesz doprecyzować godzinę przyjazdu, potrzeby dotyczące pobytu lub inne szczegóły organizacyjne, odpowiedz na tę wiadomość.")}
<p>Dziękujemy za zaufanie i do zobaczenia w {{hotelName}}.</p>`,
    },
    cancelled_client: {
      subject: "{{hotelName}} — anulowanie rezerwacji ({{reservationNumber}})",
      bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>informujemy, że rezerwacja została anulowana.</p>
${infoCard("Anulowane zgłoszenie", [
  ["Numer rezerwacji", "{{reservationNumber}}"],
  ["Pierwotny termin pobytu", "{{dateFrom}} — {{dateTo}}"],
  ["Pokoje", "{{roomsList}}"],
])}
${noteCard("Jeżeli chcesz zarezerwować nowy termin lub potrzebujesz pomocy w ponownym przygotowaniu pobytu, skontaktuj się z recepcją odpowiadając na tę wiadomość.")}`,
    },
    changed_client: {
      subject: "{{hotelName}} — zaktualizowano rezerwację ({{reservationNumber}})",
      bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>wprowadziliśmy zmiany w Twojej rezerwacji. Aktualne dane pobytu znajdują się poniżej.</p>
${infoCard("Aktualne podsumowanie rezerwacji", [
  ["Numer rezerwacji", "{{reservationNumber}}"],
  ["Termin pobytu", "{{dateFrom}} — {{dateTo}}"],
  ["Liczba noclegów", "{{nights}}"],
  ["Pokoje", "{{roomsList}}"],
  ["Orientacyjna kwota do zapłaty na miejscu", "{{totalPrice}} PLN"],
  ["Uwagi do rezerwacji", "{{customerNote}}"],
])}
${noteCard("Jeżeli któraś z powyższych informacji wymaga doprecyzowania, odpowiedz na tę wiadomość. Zespół recepcji wróci do Ciebie możliwie szybko.")}`,
    },
    expired_pending_client: {
      subject: "{{hotelName}} — zgłoszenie wygasło ({{reservationNumber}})",
      bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>rezerwacja nie została potwierdzona w wymaganym czasie i wygasła automatycznie.</p>
${infoCard("Wygasłe zgłoszenie", [
  ["Numer rezerwacji", "{{reservationNumber}}"],
  ["Termin pobytu", "{{dateFrom}} — {{dateTo}}"],
  ["Pokoje", "{{roomsList}}"],
])}
${noteCard("Termin wrócił do puli dostępności. Jeżeli nadal planujesz pobyt, prześlij nowe zgłoszenie lub skontaktuj się bezpośrednio z recepcją.")}`,
    },
    expired_pending_admin: {
      subject: "[{{hotelName}}] Wygasła rezerwacja oczekująca {{reservationNumber}}",
      bodyHtml: `<p>Rezerwacja oczekująca wygasła automatycznie z powodu braku decyzji w wymaganym terminie.</p>
${infoCard("Dane wygasłego zgłoszenia", [
  ["Numer rezerwacji", "{{reservationNumber}}"],
  ["Klient", "{{fullName}}"],
  ["E-mail", "{{email}}"],
  ["Termin pobytu", "{{dateFrom}} — {{dateTo}}"],
  ["Pokoje", "{{roomsList}}"],
])}`,
    },
    expired_email_client: {
      subject: "{{hotelName}} — link potwierdzający wygasł",
      bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>nie otrzymaliśmy potwierdzenia adresu e-mail w ciągu 2 godzin, dlatego zgłoszenie zostało anulowane automatycznie.</p>
${infoCard("Szczegóły zgłoszenia", [
  ["Numer rezerwacji", "{{reservationNumber}}"],
  ["Termin pobytu", "{{dateFrom}} — {{dateTo}}"],
  ["Pokoje", "{{roomsList}}"],
])}
${noteCard("Termin nie został zablokowany i może być już dostępny dla innych gości. Jeśli nadal chcesz zarezerwować pobyt, prześlij formularz ponownie.")}`,
    },
    cancelled_admin: {
      subject: "[{{hotelName}}] Anulowano rezerwację {{reservationNumber}}",
      bodyHtml: `<p>Rezerwacja została anulowana.</p>
${infoCard("Podsumowanie anulowania", [
  ["Numer rezerwacji", "{{reservationNumber}}"],
  ["Klient", "{{fullName}}"],
  ["E-mail", "{{email}}"],
  ["Termin pobytu", "{{dateFrom}} — {{dateTo}}"],
])}`,
    },
  };
}

function buildRestaurantDefaultTemplates() {
  return {
    restaurant_confirm_email: {
      subject: "{{restaurantName}} — potwierdzenie rezerwacji stolika ({{reservationNumber}})",
      bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>dziękujemy za wybór <strong>{{restaurantName}}</strong>. Otrzymaliśmy zgłoszenie rezerwacji stolika i przygotowaliśmy jego podsumowanie.</p>
<p>Aby przekazać rezerwację do obsługi sali, potwierdź adres e-mail. Link pozostaje ważny przez <strong>2 godziny</strong>.</p>
${infoCard("Podsumowanie rezerwacji stolika", [
  ["Numer rezerwacji", "{{reservationNumber}}"],
  ["Data", "{{date}}"],
  ["Godzina", "{{timeFrom}} — {{timeTo}}"],
  ["Liczba gości", "{{guestsCount}}"],
  ["Przydział stolików", "{{tablesList}}"],
])}
${noteCard("Rezerwacja stolika nie wymaga przedpłaty. <strong>Płatność odbywa się na miejscu</strong>, zgodnie z aktualnym menu i zamówieniem złożonym podczas wizyty.")}
<p>Jeżeli to nie Ty wysyłałeś formularz, zignoruj tę wiadomość.</p>`,
    },
    restaurant_pending_client: {
      subject: "{{restaurantName}} — rezerwacja oczekuje na akceptację ({{reservationNumber}})",
      bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>adres e-mail został potwierdzony, a rezerwacja oczekuje teraz na akceptację restauracji.</p>
${infoCard("Twoja rezerwacja", [
  ["Numer rezerwacji", "{{reservationNumber}}"],
  ["Data", "{{date}}"],
  ["Godzina", "{{timeFrom}} — {{timeTo}}"],
  ["Liczba gości", "{{guestsCount}}"],
  ["Przydział stolików", "{{tablesList}}"],
])}
${noteCard("Po zatwierdzeniu otrzymasz osobne potwierdzenie. <strong>Płatność za zamówienie realizowana jest na miejscu</strong>, zgodnie z wybranymi daniami i napojami.")}`,
    },
    restaurant_pending_admin: {
      subject: "[{{restaurantName}}] Nowa rezerwacja stolika {{reservationNumber}}",
      bodyHtml: `<p>Do obsługi wpłynęła nowa rezerwacja stolika wymagająca decyzji.</p>
${infoCard("Szczegóły rezerwacji", [
  ["Numer rezerwacji", "{{reservationNumber}}"],
  ["Klient", "{{fullName}}"],
  ["E-mail", "{{email}}"],
  ["Telefon", "{{phone}}"],
  ["Data", "{{date}}"],
  ["Godzina", "{{timeFrom}} — {{timeTo}}"],
  ["Liczba gości", "{{guestsCount}}"],
  ["Przydział stolików", "{{tablesList}}"],
  ["Łączenie stolików", "{{joinTables}}"],
  ["Uwagi klienta", "{{customerNote}}"],
])}`,
    },
    restaurant_confirmed_client: {
      subject: "{{restaurantName}} — rezerwacja potwierdzona ({{reservationNumber}})",
      bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>z przyjemnością potwierdzamy Twoją rezerwację stolika.</p>
${infoCard("Potwierdzone spotkanie", [
  ["Numer rezerwacji", "{{reservationNumber}}"],
  ["Data", "{{date}}"],
  ["Godzina", "{{timeFrom}} — {{timeTo}}"],
  ["Liczba gości", "{{guestsCount}}"],
  ["Przydział stolików", "{{tablesList}}"],
])}
${noteCard("Rezerwacja nie wymaga przedpłaty. <strong>Płatność następuje na miejscu</strong> według zamówienia i aktualnej karty menu. W przypadku spóźnienia lub zmiany liczby gości prosimy o wcześniejszy kontakt.")}`,
    },
    restaurant_cancelled_client: {
      subject: "{{restaurantName}} — rezerwacja anulowana ({{reservationNumber}})",
      bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>informujemy, że rezerwacja stolika została anulowana.</p>
${infoCard("Anulowana rezerwacja", [
  ["Numer rezerwacji", "{{reservationNumber}}"],
  ["Data", "{{date}}"],
  ["Godzina", "{{timeFrom}} — {{timeTo}}"],
  ["Liczba gości", "{{guestsCount}}"],
])}
${noteCard("Jeśli chcesz zarezerwować inny termin, będzie nam bardzo miło ponownie Cię ugościć. Wystarczy odpowiedzieć na tę wiadomość lub wysłać nowe zgłoszenie.")}`,
    },
    restaurant_changed_client: {
      subject: "{{restaurantName}} — zaktualizowano rezerwację stolika ({{reservationNumber}})",
      bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>wprowadziliśmy zmiany w Twojej rezerwacji. Aktualne szczegóły wizyty znajdują się poniżej.</p>
${infoCard("Aktualne podsumowanie", [
  ["Numer rezerwacji", "{{reservationNumber}}"],
  ["Data", "{{date}}"],
  ["Godzina", "{{timeFrom}} — {{timeTo}}"],
  ["Liczba gości", "{{guestsCount}}"],
  ["Przydział stolików", "{{tablesList}}"],
  ["Uwagi do rezerwacji", "{{customerNote}}"],
])}
${noteCard("<strong>Płatność odbywa się na miejscu</strong>, zgodnie z zamówieniem złożonym podczas wizyty. Jeżeli potrzebujesz doprecyzować szczegóły rezerwacji, odpowiedz na tę wiadomość.")}`,
    },
    restaurant_expired_pending_client: {
      subject: "{{restaurantName}} — rezerwacja wygasła ({{reservationNumber}})",
      bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>rezerwacja wygasła, ponieważ nie została potwierdzona w wymaganym czasie.</p>
${infoCard("Wygasłe zgłoszenie", [
  ["Numer rezerwacji", "{{reservationNumber}}"],
  ["Data", "{{date}}"],
  ["Godzina", "{{timeFrom}} — {{timeTo}}"],
  ["Liczba gości", "{{guestsCount}}"],
])}
${noteCard("Stolik wrócił do puli dostępności. Jeżeli chcesz zarezerwować wizytę ponownie, prześlij nowe zgłoszenie.")}`,
    },
    restaurant_expired_pending_admin: {
      subject: "[{{restaurantName}}] Wygasła rezerwacja {{reservationNumber}}",
      bodyHtml: `<p>Rezerwacja stolika wygasła automatycznie.</p>
${infoCard("Dane wygasłego zgłoszenia", [
  ["Numer rezerwacji", "{{reservationNumber}}"],
  ["Klient", "{{fullName}}"],
  ["E-mail", "{{email}}"],
  ["Data", "{{date}}"],
  ["Godzina", "{{timeFrom}} — {{timeTo}}"],
])}`,
    },
    restaurant_expired_email_client: {
      subject: "{{restaurantName}} — link potwierdzający wygasł",
      bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>nie otrzymaliśmy potwierdzenia adresu e-mail w ciągu 2 godzin, dlatego zgłoszenie zostało anulowane.</p>
${infoCard("Szczegóły zgłoszenia", [
  ["Numer rezerwacji", "{{reservationNumber}}"],
  ["Data", "{{date}}"],
  ["Godzina", "{{timeFrom}} — {{timeTo}}"],
  ["Liczba gości", "{{guestsCount}}"],
])}
${noteCard("Stolik nie został zablokowany. Jeśli nadal chcesz dokonać rezerwacji, prześlij formularz ponownie.")}`,
    },
    rest_confirm_email: null,
    rest_pending_client: null,
    rest_pending_admin: null,
    rest_confirmed_client: null,
    rest_cancelled_client: null,
    rest_changed_client: null,
  };
}

function buildHallDefaultTemplates() {
  return {
    hall_confirm_email: {
      subject: "{{venueName}} — potwierdzenie zgłoszenia rezerwacji sali ({{reservationNumber}})",
      bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>dziękujemy za zainteresowanie organizacją wydarzenia w <strong>{{venueName}}</strong>. Otrzymaliśmy zgłoszenie i przygotowaliśmy jego podsumowanie.</p>
<p>Aby przekazać zgłoszenie do opiekuna rezerwacji, potwierdź adres e-mail. Link pozostaje aktywny przez <strong>2 godziny</strong>.</p>
${infoCard("Podsumowanie zgłoszenia", [
  ["Numer zgłoszenia", "{{reservationNumber}}"],
  ["Sala", "{{hallName}}"],
  ["Data", "{{date}}"],
  ["Godziny", "{{timeFrom}} — {{timeTo}}"],
  ["Liczba gości", "{{guestsCount}}"],
  ["Rodzaj wydarzenia", "{{eventType}}"],
  ["Wyłączność", "{{exclusive}}"],
])}
${noteCard("<strong>Wycena przygotowywana jest indywidualnie</strong> po kontakcie z obsługą obiektu. Szczegóły płatności i harmonogram ustalane są na etapie oferty.")}`,
    },
    hall_pending_client: {
      subject: "{{venueName}} — zgłoszenie oczekuje na decyzję obiektu ({{reservationNumber}})",
      bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>adres e-mail został potwierdzony, a zgłoszenie trafiło do opiekuna rezerwacji.</p>
${infoCard("Twoje zgłoszenie", [
  ["Numer zgłoszenia", "{{reservationNumber}}"],
  ["Sala", "{{hallName}}"],
  ["Data", "{{date}}"],
  ["Godziny", "{{timeFrom}} — {{timeTo}}"],
  ["Liczba gości", "{{guestsCount}}"],
  ["Rodzaj wydarzenia", "{{eventType}}"],
  ["Wyłączność", "{{exclusive}}"],
])}
${noteCard("Obiekt ma do <strong>7 dni</strong> na decyzję. <strong>Wycena ustalana jest indywidualnie</strong> po kontakcie z obsługą i nie jest prezentowana automatycznie w wiadomości.")}`,
    },
    hall_pending_admin: {
      subject: "[{{venueName}}] Nowe zgłoszenie sali {{reservationNumber}}",
      bodyHtml: `<p>Do obsługi wpłynęło nowe zgłoszenie rezerwacji sali.</p>
${infoCard("Szczegóły zgłoszenia", [
  ["Numer zgłoszenia", "{{reservationNumber}}"],
  ["Klient", "{{fullName}}"],
  ["E-mail", "{{email}}"],
  ["Telefon", "{{phone}}"],
  ["Sala", "{{hallName}}"],
  ["Data", "{{date}}"],
  ["Godziny", "{{timeFrom}} — {{timeTo}}"],
  ["Liczba gości", "{{guestsCount}}"],
  ["Rodzaj wydarzenia", "{{eventType}}"],
  ["Wyłączność", "{{exclusive}}"],
  ["Pełna blokada", "{{fullBlockLabel}}"],
  ["Uwagi klienta", "{{customerNote}}"],
])}`,
    },
    hall_confirmed_client: {
      subject: "{{venueName}} — rezerwacja sali potwierdzona ({{reservationNumber}})",
      bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>z przyjemnością potwierdzamy przyjęcie rezerwacji sali.</p>
${infoCard("Potwierdzone wydarzenie", [
  ["Numer zgłoszenia", "{{reservationNumber}}"],
  ["Sala", "{{hallName}}"],
  ["Data", "{{date}}"],
  ["Godziny", "{{timeFrom}} — {{timeTo}}"],
  ["Liczba gości", "{{guestsCount}}"],
  ["Rodzaj wydarzenia", "{{eventType}}"],
])}
${noteCard("Szczegóły organizacyjne, oferta cenowa oraz harmonogram płatności obowiązują zgodnie z indywidualnymi ustaleniami z obsługą obiektu.")}`,
    },
    hall_cancelled_client: {
      subject: "{{venueName}} — rezerwacja sali anulowana ({{reservationNumber}})",
      bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>informujemy, że zgłoszenie rezerwacji sali zostało anulowane.</p>
${infoCard("Anulowane zgłoszenie", [
  ["Numer zgłoszenia", "{{reservationNumber}}"],
  ["Sala", "{{hallName}}"],
  ["Data", "{{date}}"],
  ["Godziny", "{{timeFrom}} — {{timeTo}}"],
  ["Rodzaj wydarzenia", "{{eventType}}"],
])}
${noteCard("Jeżeli chcesz omówić nowy termin lub przygotować świeżą ofertę dla wydarzenia, odpowiedz na tę wiadomość.")}`,
    },
    hall_changed_client: {
      subject: "{{venueName}} — zaktualizowano rezerwację sali ({{reservationNumber}})",
      bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>wprowadziliśmy zmiany w Twoim zgłoszeniu. Aktualne dane wydarzenia znajdują się poniżej.</p>
${infoCard("Aktualne podsumowanie", [
  ["Numer zgłoszenia", "{{reservationNumber}}"],
  ["Sala", "{{hallName}}"],
  ["Data", "{{date}}"],
  ["Godziny", "{{timeFrom}} — {{timeTo}}"],
  ["Liczba gości", "{{guestsCount}}"],
  ["Rodzaj wydarzenia", "{{eventType}}"],
  ["Uwagi do rezerwacji", "{{customerNote}}"],
])}
${noteCard("Wycena i warunki płatności obowiązują zgodnie z indywidualnymi ustaleniami z obsługą obiektu. W razie pytań odpowiedz na tę wiadomość.")}`,
    },
    hall_expired_pending_client: {
      subject: "{{venueName}} — zgłoszenie wygasło ({{reservationNumber}})",
      bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>zgłoszenie wygasło, ponieważ obiekt nie potwierdził rezerwacji w wymaganym czasie.</p>
${infoCard("Wygasłe zgłoszenie", [
  ["Numer zgłoszenia", "{{reservationNumber}}"],
  ["Sala", "{{hallName}}"],
  ["Data", "{{date}}"],
  ["Godziny", "{{timeFrom}} — {{timeTo}}"],
])}
${noteCard("Jeżeli nadal planujesz wydarzenie w tym terminie lub chcesz zaproponować inny termin, skontaktuj się z obiektem.")}`,
    },
    hall_expired_pending_admin: {
      subject: "[{{venueName}}] Wygasła rezerwacja sali {{reservationNumber}}",
      bodyHtml: `<p>Zgłoszenie rezerwacji sali wygasło automatycznie.</p>
${infoCard("Dane wygasłego zgłoszenia", [
  ["Numer zgłoszenia", "{{reservationNumber}}"],
  ["Klient", "{{fullName}}"],
  ["E-mail", "{{email}}"],
  ["Sala", "{{hallName}}"],
  ["Data", "{{date}}"],
  ["Godziny", "{{timeFrom}} — {{timeTo}}"],
])}`,
    },
    hall_expired_email_client: {
      subject: "{{venueName}} — link potwierdzający wygasł",
      bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>nie otrzymaliśmy potwierdzenia adresu e-mail w ciągu 2 godzin, dlatego zgłoszenie zostało anulowane automatycznie.</p>
${infoCard("Szczegóły zgłoszenia", [
  ["Numer zgłoszenia", "{{reservationNumber}}"],
  ["Sala", "{{hallName}}"],
  ["Data", "{{date}}"],
  ["Godziny", "{{timeFrom}} — {{timeTo}}"],
])}
${noteCard("Termin nie został zablokowany. Jeśli nadal chcesz zorganizować wydarzenie w obiekcie, wyślij formularz ponownie.")}`,
    },
    hall_extended_pending_client: {
      subject: "{{venueName}} — przedłużono termin oczekiwania ({{reservationNumber}})",
      bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>termin oczekiwania na decyzję dotyczącą zgłoszenia został przedłużony.</p>
${infoCard("Status zgłoszenia", [
  ["Numer zgłoszenia", "{{reservationNumber}}"],
  ["Sala", "{{hallName}}"],
  ["Data", "{{date}}"],
  ["Godziny", "{{timeFrom}} — {{timeTo}}"],
  ["Nowy termin ważności", "{{expiresAt}}"],
])}
${noteCard("Obsługa obiektu nadal pracuje nad decyzją i wróci z odpowiedzią możliwie szybko.")}`,
    },
  };
}

const LEGACY_DEFAULT_TEMPLATES = {
  confirm_email: {
    subject: "{{hotelName}} — potwierdź rezerwację ({{reservationNumber}})",
    bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>Dziękujemy za wysłanie zapytania rezerwacyjnego do {{hotelName}}.</p>
<p>Aby przekazać zgłoszenie do dalszej obsługi, potwierdź adres e-mail klikając w link ważny przez 2 godziny:</p>
<p><a href="{{confirmationLink}}">Potwierdź rezerwację</a></p>
<p>Numer rezerwacji: <strong>{{reservationNumber}}</strong><br/>
Termin pobytu: {{dateFrom}} — {{dateTo}} ({{nights}} nocy)<br/>
Szacunkowa wartość pobytu: {{totalPrice}} PLN</p>
<p>{{roomsList}}</p>
<p>Jeżeli to nie Ty wysyłałeś formularz, zignoruj tę wiadomość.</p>
<p>Pozdrawiamy,<br/>Recepcja {{hotelName}}</p>`,
  },
  pending_client: {
    subject: "{{hotelName}} — rezerwacja oczekuje na akceptację ({{reservationNumber}})",
    bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>Adres e-mail został potwierdzony, a zgłoszenie <strong>{{reservationNumber}}</strong> trafiło do recepcji.</p>
<p>Status rezerwacji: <strong>oczekuje na akceptację hotelu</strong>.</p>
<p>Termin pobytu: {{dateFrom}} — {{dateTo}} ({{nights}} nocy)<br/>
Szacunkowa kwota: {{totalPrice}} PLN</p>
<p>{{roomsList}}</p>
<p>Po decyzji recepcji wyślemy kolejną wiadomość. Do czasu ostatecznego potwierdzenia rezerwacja nie jest jeszcze gwarantowana.</p>
<p>Pozdrawiamy,<br/>Recepcja {{hotelName}}</p>`,
  },
  pending_admin: {
    subject: "[{{hotelName}}] Nowa rezerwacja oczekująca {{reservationNumber}}",
    bodyHtml: `<p>Nowa rezerwacja oczekuje na decyzję recepcji.</p>
<p><strong>{{fullName}}</strong><br/>{{email}}<br/>{{phone}}</p>
<p>Numer: {{reservationNumber}}<br/>
Termin: {{dateFrom}} — {{dateTo}} ({{nights}} nocy)<br/>
Kwota: {{totalPrice}} PLN</p>
<p>Uwagi klienta: {{customerNote}}</p>
<p>{{roomsList}}</p>`,
  },
  confirmed_client: {
    subject: "{{hotelName}} — rezerwacja potwierdzona ({{reservationNumber}})",
    bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>Potwierdzamy rezerwację pobytu o numerze <strong>{{reservationNumber}}</strong>.</p>
<p>Termin pobytu: {{dateFrom}} — {{dateTo}} ({{nights}} nocy)<br/>
Szacunkowa kwota: {{totalPrice}} PLN</p>
<p>{{roomsList}}</p>
<p>Jeżeli chcesz doprecyzować godzinę przyjazdu lub inne szczegóły pobytu, odpowiedz na tę wiadomość albo skontaktuj się z recepcją.</p>
<p>Pozdrawiamy,<br/>Recepcja {{hotelName}}</p>`,
  },
  cancelled_client: {
    subject: "{{hotelName}} — rezerwacja anulowana ({{reservationNumber}})",
    bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>Informujemy, że rezerwacja <strong>{{reservationNumber}}</strong> została anulowana.</p>
<p>Pierwotny termin pobytu: {{dateFrom}} — {{dateTo}}</p>
<p>Jeżeli chcesz ustalić nowy termin lub wyjaśnić anulowanie, skontaktuj się z recepcją.</p>
<p>Pozdrawiamy,<br/>Recepcja {{hotelName}}</p>`,
  },
  changed_client: {
    subject: "{{hotelName}} — zmiana w rezerwacji {{reservationNumber}}",
    bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>Wprowadziliśmy zmiany w rezerwacji <strong>{{reservationNumber}}</strong>.</p>
<p>Aktualny termin pobytu: {{dateFrom}} — {{dateTo}} ({{nights}} nocy)<br/>
Szacunkowa kwota: {{totalPrice}} PLN</p>
<p>{{roomsList}}</p>
<p>Uwagi do rezerwacji: {{customerNote}}</p>
<p>W razie pytań odpowiedz na tę wiadomość lub skontaktuj się z recepcją.</p>
<p>Pozdrawiamy,<br/>Recepcja {{hotelName}}</p>`,
  },
  expired_pending_client: {
    subject: "{{hotelName}} — rezerwacja wygasła ({{reservationNumber}})",
    bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>Rezerwacja <strong>{{reservationNumber}}</strong> wygasła, ponieważ nie została potwierdzona w wymaganym czasie.</p>
<p>Terminy wróciły do puli dostępności. Jeśli nadal planujesz pobyt, możesz wysłać nowe zgłoszenie.</p>
<p>Pozdrawiamy,<br/>Recepcja {{hotelName}}</p>`,
  },
  expired_pending_admin: {
    subject: "[{{hotelName}}] Wygasła rezerwacja oczekująca {{reservationNumber}}",
    bodyHtml: `<p>Rezerwacja {{reservationNumber}} wygasła automatycznie (brak potwierdzenia w ciągu 3 dni kalendarzowych).</p>
<p>Klient: {{fullName}} ({{email}})</p>
<p>Termin: {{dateFrom}} — {{dateTo}}</p>`,
  },
  expired_email_client: {
    subject: "{{hotelName}} — zgłoszenie wygasło (bez potwierdzenia e-mail)",
    bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>Nie otrzymaliśmy potwierdzenia adresu e-mail w ciągu 2 godzin, dlatego zgłoszenie zostało anulowane.</p>
<p>Terminy nie zostały zablokowane i nadal mogą być dostępne dla innych gości.</p>
<p>Pozdrawiamy,<br/>Recepcja {{hotelName}}</p>`,
  },
  cancelled_admin: {
    subject: "[{{hotelName}}] Anulowano rezerwację {{reservationNumber}}",
    bodyHtml: `<p>Rezerwacja {{reservationNumber}} została anulowana.</p>
<p>Klient: {{fullName}} ({{email}})</p>`,
  },
};

const LEGACY_RESTAURANT_DEFAULT_TEMPLATES = {
  restaurant_confirm_email: {
    subject: "{{restaurantName}} — potwierdź rezerwację stolika ({{reservationNumber}})",
    bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>Dziękujemy za wysłanie rezerwacji stolika do {{restaurantName}}.</p>
<p>Aby przekazać zgłoszenie do obsługi, potwierdź adres e-mail klikając w link ważny przez 2 godziny:</p>
<p><a href="{{confirmationLink}}">Potwierdź rezerwację</a></p>
<p>Numer rezerwacji: <strong>{{reservationNumber}}</strong><br/>
{{date}} · {{timeFrom}}–{{timeTo}} ({{durationHours}} h)<br/>
Liczba gości: {{guestsCount}}</p>
<p>{{tablesList}}</p>
<p>Jeżeli to nie Ty wysyłałeś formularz, zignoruj tę wiadomość.</p>
<p>Pozdrawiamy,<br/>{{restaurantName}}</p>`,
  },
  restaurant_pending_client: {
    subject: "{{restaurantName}} — rezerwacja oczekuje na akceptację ({{reservationNumber}})",
    bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>Adres e-mail został potwierdzony, a zgłoszenie <strong>{{reservationNumber}}</strong> oczekuje teraz na akceptację restauracji.</p>
<p>Numer: {{reservationNumber}}<br/>
{{date}} · {{timeFrom}}–{{timeTo}}</p>
<p>Stoliki: {{tablesList}} · Goście: {{guestsCount}}</p>
<p>Po zatwierdzeniu otrzymasz osobne potwierdzenie. Do tego czasu rezerwacja nie jest jeszcze gwarantowana.</p>
<p>Pozdrawiamy,<br/>{{restaurantName}}</p>`,
  },
  restaurant_pending_admin: {
    subject: "[{{restaurantName}}] Nowa rezerwacja stolika {{reservationNumber}}",
    bodyHtml: `<p>Nowa rezerwacja stolika oczekuje na decyzję obsługi.</p>
<p><strong>{{fullName}}</strong><br/>{{email}}<br/>{{phone}}</p>
<p>Numer: {{reservationNumber}}<br/>
{{date}} · {{timeFrom}}–{{timeTo}} ({{durationHours}} h)</p>
<p>Stoliki: {{tablesList}} · Goście: {{guestsCount}} · Łączenie: {{joinTables}}</p>
<p>Uwagi klienta: {{customerNote}}</p>`,
  },
  restaurant_confirmed_client: {
    subject: "{{restaurantName}} — rezerwacja potwierdzona ({{reservationNumber}})",
    bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>Potwierdzamy rezerwację stolika o numerze <strong>{{reservationNumber}}</strong>.</p>
<p>Numer: {{reservationNumber}}<br/>
{{date}} · {{timeFrom}}–{{timeTo}}</p>
<p>{{tablesList}}</p>
<p>W przypadku spóźnienia lub potrzeby zmiany godziny prosimy o wcześniejszy kontakt z restauracją.</p>
<p>Pozdrawiamy,<br/>{{restaurantName}}</p>`,
  },
  restaurant_cancelled_client: {
    subject: "{{restaurantName}} — rezerwacja anulowana ({{reservationNumber}})",
    bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>Rezerwacja stolika <strong>{{reservationNumber}}</strong> została anulowana.</p>
<p>Termin: {{date}} · {{timeFrom}}–{{timeTo}}</p>
<p>Jeżeli chcesz zarezerwować inny termin, zapraszamy do ponownego kontaktu.</p>
<p>Pozdrawiamy,<br/>{{restaurantName}}</p>`,
  },
  restaurant_changed_client: {
    subject: "{{restaurantName}} — zmiana rezerwacji stolika ({{reservationNumber}})",
    bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>Zaktualizowaliśmy rezerwację <strong>{{reservationNumber}}</strong>.</p>
<p>{{date}} · {{timeFrom}}–{{timeTo}} ({{durationHours}} h)<br/>
Goście: {{guestsCount}}</p>
<p>{{tablesList}}</p>
<p>Uwagi do rezerwacji: {{customerNote}}</p>
<p>W razie pytań odpowiedz na tę wiadomość lub skontaktuj się z restauracją.</p>
<p>Pozdrawiamy,<br/>{{restaurantName}}</p>`,
  },
  restaurant_expired_pending_client: {
    subject: "{{restaurantName}} — rezerwacja wygasła ({{reservationNumber}})",
    bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>Rezerwacja <strong>{{reservationNumber}}</strong> wygasła, ponieważ nie została potwierdzona w wymaganym czasie.</p>
<p>Stoliki zostały zwolnione. Możesz złożyć nowe zgłoszenie na stronie.</p>
<p>Pozdrawiamy,<br/>{{restaurantName}}</p>`,
  },
  restaurant_expired_pending_admin: {
    subject: "[{{restaurantName}}] Wygasła rezerwacja oczekująca {{reservationNumber}}",
    bodyHtml: `<p>Rezerwacja {{reservationNumber}} wygasła automatycznie (brak potwierdzenia w ciągu 3 dni).</p>
<p>Klient: {{fullName}} ({{email}})</p>
<p>Termin: {{date}} · {{timeFrom}}–{{timeTo}}</p>`,
  },
  restaurant_expired_email_client: {
    subject: "{{restaurantName}} — zgłoszenie wygasło (bez potwierdzenia e-mail)",
    bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>Nie otrzymaliśmy potwierdzenia adresu e-mail w ciągu 2 godzin, dlatego zgłoszenie zostało anulowane.</p>
<p>Stoliki nie zostały zablokowane.</p>
<p>Pozdrawiamy,<br/>{{restaurantName}}</p>`,
  },
  rest_confirm_email: {
    subject: "{{restaurantName}} — potwierdź rezerwację stolika ({{reservationNumber}})",
    bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>Dziękujemy za wysłanie rezerwacji stolika do {{restaurantName}}.</p>
<p>Aby przekazać zgłoszenie do obsługi, potwierdź adres e-mail klikając w link ważny przez 2 godziny:</p>
<p><a href="{{confirmationLink}}">Potwierdź rezerwację</a></p>
<p>Numer rezerwacji: <strong>{{reservationNumber}}</strong><br/>
{{date}} · {{timeFrom}}–{{timeTo}} ({{durationHours}} h)<br/>
Liczba gości: {{guestsCount}}</p>
<p>{{tablesList}}</p>
<p>Pozdrawiamy,<br/>{{restaurantName}}</p>`,
  },
  rest_pending_client: {
    subject: "{{restaurantName}} — rezerwacja oczekuje na akceptację ({{reservationNumber}})",
    bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>Adres e-mail został potwierdzony, a zgłoszenie <strong>{{reservationNumber}}</strong> oczekuje teraz na akceptację restauracji.</p>
<p>{{date}} · {{timeFrom}}–{{timeTo}}<br/>
Goście: {{guestsCount}}</p>
<p>{{tablesList}}</p>
<p>Pozdrawiamy,<br/>{{restaurantName}}</p>`,
  },
  rest_pending_admin: {
    subject: "[{{restaurantName}}] Nowa rezerwacja stolika {{reservationNumber}}",
    bodyHtml: `<p>Nowa rezerwacja stolika oczekuje na decyzję obsługi.</p>
<p><strong>{{fullName}}</strong><br/>{{email}}<br/>{{phone}}</p>
<p>{{date}} · {{timeFrom}}–{{timeTo}} ({{durationHours}} h)</p>
<p>{{tablesList}} · Goście: {{guestsCount}} · Łączenie: {{joinTables}}</p>
<p>Uwagi klienta: {{customerNote}}</p>`,
  },
  rest_confirmed_client: {
    subject: "{{restaurantName}} — rezerwacja potwierdzona ({{reservationNumber}})",
    bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>Potwierdzamy rezerwację stolika o numerze <strong>{{reservationNumber}}</strong>.</p>
<p>{{date}} · {{timeFrom}}–{{timeTo}}</p>
<p>{{tablesList}}</p>
<p>Pozdrawiamy,<br/>{{restaurantName}}</p>`,
  },
  rest_cancelled_client: {
    subject: "{{restaurantName}} — rezerwacja anulowana ({{reservationNumber}})",
    bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>Rezerwacja stolika <strong>{{reservationNumber}}</strong> została anulowana.</p>
<p>Termin: {{date}} · {{timeFrom}}–{{timeTo}}</p>
<p>Pozdrawiamy,<br/>{{restaurantName}}</p>`,
  },
  rest_changed_client: {
    subject: "{{restaurantName}} — zmiana rezerwacji stolika ({{reservationNumber}})",
    bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>Zaktualizowaliśmy rezerwację <strong>{{reservationNumber}}</strong>.</p>
<p>{{date}} · {{timeFrom}}–{{timeTo}} ({{durationHours}} h)<br/>
Goście: {{guestsCount}}</p>
<p>{{tablesList}}</p>
<p>Uwagi do rezerwacji: {{customerNote}}</p>
<p>Pozdrawiamy,<br/>{{restaurantName}}</p>`,
  },
};

const LEGACY_HALL_DEFAULT_TEMPLATES = {
  hall_confirm_email: {
    subject: "{{venueName}} — potwierdź zgłoszenie rezerwacji sali ({{reservationNumber}})",
    bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>Dziękujemy za przesłanie zgłoszenia rezerwacji sali w {{venueName}}.</p>
<p>To jest <strong>zgłoszenie rezerwacyjne</strong> — wycena zostanie ustalona indywidualnie po kontakcie telefonicznym z obiektu.</p>
<p>Aby potwierdzić zgłoszenie e-mailem (ważne 2 godziny), kliknij:</p>
<p><a href="{{confirmationLink}}">Potwierdź zgłoszenie</a></p>
<p>Numer: {{reservationNumber}}<br/>
Sala: {{hallName}}<br/>
{{date}} · {{timeFrom}}–{{timeTo}} ({{durationHours}})<br/>
Goście: {{guestsCount}} · {{eventType}}<br/>
Wyłączność: {{exclusive}}</p>
<p>Pozdrawiamy,<br/>{{venueName}}</p>`,
  },
  hall_pending_client: {
    subject: "{{venueName}} — zgłoszenie oczekuje na decyzję obiektu ({{reservationNumber}})",
    bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>Zgłoszenie zostało <strong>potwierdzone linkiem e-mail</strong>. Status: <strong>oczekujące na akceptację przez obiekt</strong>.</p>
<p><strong>Wycena zostanie podana telefonicznie</strong> — obsługa skontaktuje się z Tobą w sprawie kosztów i dalszego potwierdzenia.</p>
<p>Obiekt ma <strong>7 dni</strong> na decyzję (możliwe jest przedłużenie terminu przez obsługę).</p>
<p>Numer: {{reservationNumber}} · {{hallName}}<br/>
{{date}} · {{timeFrom}}–{{timeTo}}</p>
<p>Pozdrawiamy,<br/>{{venueName}}</p>`,
  },
  hall_pending_admin: {
    subject: "[{{venueName}}] Nowe zgłoszenie sali {{reservationNumber}}",
    bodyHtml: `<p>Nowe zgłoszenie rezerwacji sali wymaga decyzji obsługi.</p>
<p><strong>{{fullName}}</strong><br/>{{email}}<br/>{{phone}}</p>
<p>Numer: {{reservationNumber}}<br/>
Sala: {{hallName}} · {{date}} · {{timeFrom}}–{{timeTo}} ({{durationHours}})<br/>
Goście: {{guestsCount}} · Wyłączność: {{exclusive}} · 100+: {{fullBlockLabel}}</p>
<p>Rodzaj imprezy: {{eventType}}</p>
<p>Uwagi klienta: {{customerNote}}</p>`,
  },
  hall_confirmed_client: {
    subject: "{{venueName}} — rezerwacja sali potwierdzona ({{reservationNumber}})",
    bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>Rezerwacja sali została <strong>potwierdzona przez obiekt</strong> ({{hallName}}).</p>
<p>Termin: {{date}} · {{timeFrom}}–{{timeTo}}</p>
<p>Szczegóły i wycena — zgodnie z ustaleniami telefonicznymi.</p>
<p>Pozdrawiamy,<br/>{{venueName}}</p>`,
  },
  hall_cancelled_client: {
    subject: "{{venueName}} — rezerwacja sali anulowana ({{reservationNumber}})",
    bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>Rezerwacja <strong>{{reservationNumber}}</strong> została anulowana.</p>
<p>Termin: {{date}} · {{hallName}}</p>
<p>Jeżeli chcesz ustalić inny termin, skontaktuj się z obiektem.</p>
<p>Pozdrawiamy,<br/>{{venueName}}</p>`,
  },
  hall_changed_client: {
    subject: "{{venueName}} — zmiana rezerwacji sali ({{reservationNumber}})",
    bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>Wprowadziliśmy zmiany w zgłoszeniu <strong>{{reservationNumber}}</strong>.</p>
<p>Sala: {{hallName}}<br/>
Termin: {{date}} · {{timeFrom}}–{{timeTo}} ({{durationHours}})<br/>
Liczba gości: {{guestsCount}}<br/>
Rodzaj wydarzenia: {{eventType}}</p>
<p>Uwagi do rezerwacji: {{customerNote}}</p>
<p>W razie pytań odpowiedz na tę wiadomość lub skontaktuj się z obiektem.</p>
<p>Pozdrawiamy,<br/>{{venueName}}</p>`,
  },
  hall_expired_pending_client: {
    subject: "{{venueName}} — zgłoszenie sali wygasło ({{reservationNumber}})",
    bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>Zgłoszenie <strong>{{reservationNumber}}</strong> wygasło — obiekt nie potwierdził rezerwacji w wymaganym terminie.</p>
<p>Możesz złożyć nowe zgłoszenie na stronie.</p>
<p>Pozdrawiamy,<br/>{{venueName}}</p>`,
  },
  hall_expired_pending_admin: {
    subject: "[{{venueName}}] Wygasła rezerwacja sali {{reservationNumber}}",
    bodyHtml: `<p>Rezerwacja {{reservationNumber}} wygasła automatycznie (brak potwierdzenia w terminie oczekiwania).</p>
<p>Klient: {{fullName}} ({{email}})</p>
<p>{{hallName}} · {{date}} · {{timeFrom}}–{{timeTo}}</p>`,
  },
  hall_expired_email_client: {
    subject: "{{venueName}} — zgłoszenie wygasło (bez potwierdzenia e-mail)",
    bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>Nie otrzymaliśmy potwierdzenia e-mailem w ciągu 2 godzin. Zgłoszenie zostało anulowane — termin nie został zablokowany.</p>
<p>Pozdrawiamy,<br/>{{venueName}}</p>`,
  },
  hall_extended_pending_client: {
    subject: "{{venueName}} — przedłużono termin oczekiwania ({{reservationNumber}})",
    bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>Termin oczekiwania na decyzję dotyczącą zgłoszenia <strong>{{reservationNumber}}</strong> został przedłużony do: <strong>{{expiresAt}}</strong>.</p>
<p>Pozdrawiamy,<br/>{{venueName}}</p>`,
  },
};

const DEFAULT_TEMPLATES = buildHotelDefaultTemplates();
const RESTAURANT_DEFAULT_TEMPLATES_BASE = buildRestaurantDefaultTemplates();
const RESTAURANT_DEFAULT_TEMPLATES = {
  ...RESTAURANT_DEFAULT_TEMPLATES_BASE,
  rest_confirm_email: structuredClone(RESTAURANT_DEFAULT_TEMPLATES_BASE.restaurant_confirm_email),
  rest_pending_client: structuredClone(RESTAURANT_DEFAULT_TEMPLATES_BASE.restaurant_pending_client),
  rest_pending_admin: structuredClone(RESTAURANT_DEFAULT_TEMPLATES_BASE.restaurant_pending_admin),
  rest_confirmed_client: structuredClone(RESTAURANT_DEFAULT_TEMPLATES_BASE.restaurant_confirmed_client),
  rest_cancelled_client: structuredClone(RESTAURANT_DEFAULT_TEMPLATES_BASE.restaurant_cancelled_client),
  rest_changed_client: structuredClone(RESTAURANT_DEFAULT_TEMPLATES_BASE.restaurant_changed_client),
};
const HALL_DEFAULT_TEMPLATES = buildHallDefaultTemplates();

async function getMailTemplate(db, key) {
  const snap = await db.collection("hotelMailTemplates").doc(key).get();
  if (!snap.exists) {
    return DEFAULT_TEMPLATES[key] || { subject: "", bodyHtml: "" };
  }
  const d = snap.data();
  const current = {
    subject: d.subject || "",
    bodyHtml: d.bodyHtml || "",
  };
  if (isSameTemplateShape(current, LEGACY_DEFAULT_TEMPLATES[key])) {
    return DEFAULT_TEMPLATES[key] || current;
  }
  return {
    subject: current.subject || DEFAULT_TEMPLATES[key]?.subject || "",
    bodyHtml: current.bodyHtml || DEFAULT_TEMPLATES[key]?.bodyHtml || "",
  };
}

async function getRestaurantMailTemplate(db, key) {
  const snap = await db.collection("restaurantMailTemplates").doc(key).get();
  if (!snap.exists) {
    return RESTAURANT_DEFAULT_TEMPLATES[key] || { subject: "", bodyHtml: "" };
  }
  const d = snap.data();
  const current = {
    subject: d.subject || "",
    bodyHtml: d.bodyHtml || "",
  };
  if (isSameTemplateShape(current, LEGACY_RESTAURANT_DEFAULT_TEMPLATES[key])) {
    return RESTAURANT_DEFAULT_TEMPLATES[key] || current;
  }
  return {
    subject: current.subject || RESTAURANT_DEFAULT_TEMPLATES[key]?.subject || "",
    bodyHtml: current.bodyHtml || RESTAURANT_DEFAULT_TEMPLATES[key]?.bodyHtml || "",
  };
}

async function getHallMailTemplate(db, key) {
  const snap = await db.collection("venueMailTemplates").doc(key).get();
  if (!snap.exists) {
    return HALL_DEFAULT_TEMPLATES[key] || { subject: "", bodyHtml: "" };
  }
  const d = snap.data();
  const current = {
    subject: d.subject || "",
    bodyHtml: d.bodyHtml || "",
  };
  if (isSameTemplateShape(current, LEGACY_HALL_DEFAULT_TEMPLATES[key])) {
    return HALL_DEFAULT_TEMPLATES[key] || current;
  }
  return {
    subject: current.subject || HALL_DEFAULT_TEMPLATES[key]?.subject || "",
    bodyHtml: current.bodyHtml || HALL_DEFAULT_TEMPLATES[key]?.bodyHtml || "",
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
    text: htmlToText(html),
    replyTo: replyTo || undefined,
    headers: {
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "All",
    },
  });
  return { ok: true };
}

module.exports = {
  escapeHtml,
  renderTemplate,
  htmlToText,
  buildBrandedEmail,
  DEFAULT_TEMPLATES,
  RESTAURANT_DEFAULT_TEMPLATES,
  HALL_DEFAULT_TEMPLATES,
  getMailTemplate,
  getRestaurantMailTemplate,
  getHallMailTemplate,
  sendMail,
};
