import { connect } from "cloudflare:sockets";

const SESSION_MS = 30 * 60 * 1000;
const EMAIL_LINK_MS = 2 * 60 * 60 * 1000;
const ADMIN_ACTION_LINK_MS = 3 * 24 * 60 * 60 * 1000;
const HOTEL_PENDING_MS = 3 * 24 * 60 * 60 * 1000;
const RESTAURANT_PENDING_MS = 3 * 24 * 60 * 60 * 1000;
const HALL_PENDING_MS = 7 * 24 * 60 * 60 * 1000;
const HALL_EXTEND_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;

const STATUS_LABELS = {
  email_verification_pending: "Do potwierdzenia e-mail (2h)",
  pending: "Oczekujące na decyzję",
  confirmed: "Potwierdzone / zarezerwowane",
  cancelled: "Anulowane",
  expired: "Wygasłe",
  manual_block: "Blokada terminu (admin)",
};

const BLOCKING_STATUSES = ["pending", "confirmed", "manual_block"];
const RESTAURANT_CLEANUP_BUFFER_MINUTES = 30;

let schemaReadyPromise = null;

const SMTP_REQUIRED_FIELDS = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"];

function hasSmtpConfig(env) {
  return SMTP_REQUIRED_FIELDS.every((key) => cleanString(env[key], 500));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderTemplate(template, vars) {
  if (!template) return "";
  const rawHtmlKeys = new Set(["cateringWhenHtml", "cateringRecipientHtml", "cateringDescriptionHtml"]);
  return String(template).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const value = vars?.[key];
    if (value === undefined || value === null) return "";
    if (rawHtmlKeys.has(key)) return String(value);
    return escapeHtml(String(value));
  });
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeRenderedReservationSubject(subject, vars, row) {
  const rendered = String(subject || "");
  const formattedNumber = cleanString(vars?.reservationNumber, 200);
  if (!formattedNumber) return rendered;
  if (rendered.includes(formattedNumber)) return rendered;
  const rawNumber = cleanString(row?.human_number, 80);
  if (!rawNumber || rawNumber === formattedNumber) return rendered;
  const rawPattern = new RegExp(`(^|[^\\d])(${escapeRegExp(rawNumber)})(?=[^\\d]|$)`);
  return rendered.replace(rawPattern, (_, prefix) => `${prefix}${formattedNumber}`);
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

function actionButtonHtml(href, label) {
  const safeHref = escapeHtml(href || "");
  const safeLabel = escapeHtml(label || "Potwierdz");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:14px auto 18px auto;">
    <tr>
      <td style="border-radius:999px;background:#7b5a24;text-align:center;">
        <a href="${safeHref}" style="display:inline-block;padding:14px 30px;font-size:17px;line-height:1.2;font-weight:700;color:#ffffff;text-decoration:none;">${safeLabel}</a>
      </td>
    </tr>
  </table>`;
}

function normalizeLinkForCompare(value) {
  return decodeHtmlEntities(String(value || "")).trim();
}

function injectInlineActionButton(html, actionUrl, options = {}) {
  const preferredLabel = cleanString(options.preferredLabel, 200);
  const target = normalizeLinkForCompare(actionUrl);
  if (!target) return String(html || "");
  const source = String(html || "");
  let replaced = false;
  const out = source.replace(/<p\b[^>]*>\s*<a\b([^>]*)>([\s\S]*?)<\/a>\s*<\/p>/gi, (match, attrs, labelHtml) => {
    const hrefMatch = String(attrs || "").match(/\bhref\s*=\s*(["'])(.*?)\1/i);
    if (!hrefMatch) return match;
    const href = normalizeLinkForCompare(hrefMatch[2]);
    if (href !== target) return match;
    replaced = true;
    const fromLink = decodeHtmlEntities(String(labelHtml || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    const label = (preferredLabel || fromLink || "Potwierdz").trim();
    return actionButtonHtml(target, label);
  });
  if (replaced) return out;
  if (preferredLabel) {
    return `${source}\n${actionButtonHtml(target, preferredLabel)}`;
  }
  return source;
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

function normalizeMailHeaderKey(service, key) {
  let k = cleanString(key, 160);
  if (service === "restaurant") {
    k = k.replace(/^restaurant_/i, "").replace(/^rest_/i, "");
  } else if (service === "hall") {
    k = k.replace(/^hall_/i, "");
  }
  return k;
}

function mailHeaderSecondLine(service, eventKey) {
  const k = normalizeMailHeaderKey(service, eventKey);
  const hotel = {
    confirm_email: "Potwierdzenie rezerwacji noclegu",
    pending_admin: "Rezerwacja noclegu — powiadomienie dla obsługi",
    confirmed_client: "Potwierdzenie rezerwacji noclegu",
    cancelled_client: "Odwołanie rezerwacji noclegu",
    changed_client: "Zmiana rezerwacji noclegu",
    expired_pending_client: "Wygaśnięcie rezerwacji noclegu",
    expired_pending_admin: "Wygaśnięcie rezerwacji — informacja dla obsługi",
    expired_email_client: "Wygasłe potwierdzenie — rezerwacja noclegu",
    cancelled_admin: "Odwołanie rezerwacji — informacja dla obsługi",
  };
  const restaurant = {
    confirm_email: "Potwierdzenie rezerwacji stolika",
    pending_admin: "Rezerwacja stolika — powiadomienie dla obsługi",
    confirmed_client: "Potwierdzenie rezerwacji stolika",
    cancelled_client: "Odwołanie rezerwacji stolika",
    changed_client: "Zmiana rezerwacji stolika",
    expired_pending_client: "Wygaśnięcie rezerwacji stolika",
    expired_pending_admin: "Wygaśnięcie rezerwacji — informacja dla obsługi",
    expired_email_client: "Wygasłe potwierdzenie — rezerwacja stolika",
    catering_manual_created_client: "Dostawa cateringu — utworzono rezerwację",
  };
  const hall = {
    confirm_email: "Potwierdzenie rezerwacji sali",
    pending_admin: "Rezerwacja sali — powiadomienie dla obsługi",
    confirmed_client: "Potwierdzenie rezerwacji sali",
    cancelled_client: "Odwołanie rezerwacji sali",
    changed_client: "Zmiana rezerwacji sali",
    expired_pending_client: "Wygaśnięcie rezerwacji sali",
    expired_pending_admin: "Wygaśnięcie rezerwacji — informacja dla obsługi",
    expired_email_client: "Wygasłe potwierdzenie — rezerwacja sali",
    extended_pending_client: "Przedłużenie terminu rezerwacji sali",
  };
  const map = service === "hotel" ? hotel : service === "restaurant" ? restaurant : hall;
  return map[k] || "Wiadomość o rezerwacji";
}

function buildBrandedEmail({
  subject,
  htmlFragment,
  brandName = "Średzka Korona",
  headerBrandLine = "Średzka Korona",
  headerContextLine = "",
  headerNumberLine = "",
  serviceLabel = "",
  siteUrl = "",
  serviceUrl = "",
  preheader = "",
  actionUrl = "",
  actionLabel = "",
}) {
  const safeBrandName = escapeHtml(brandName);
  const safeHeaderBrand = escapeHtml(headerBrandLine || "Średzka Korona");
  const safeContext = escapeHtml(headerContextLine || "");
  const safeNumber = escapeHtml(headerNumberLine || "");
  const safeServiceLabel = escapeHtml(serviceLabel);
  const safePreheader = escapeHtml(preheader || subject || brandName);
  const cleanSiteUrl = String(siteUrl || "").replace(/\/$/, "");
  const cleanServiceUrl = String(serviceUrl || "").replace(/\/$/, "");
  const logoUrl = cleanSiteUrl ? `${cleanSiteUrl}/ikony/logo-korona.png` : "";
  const enhancedContent = enhanceFragmentHtml(htmlFragment);
  const actionHref = actionUrl ? escapeHtml(actionUrl) : "";
  const actionTitle = escapeHtml(actionLabel || "Zobacz szczegóły");
  const footerHref = cleanServiceUrl || cleanSiteUrl;
  const footerLabel = safeServiceLabel || "Strona główna";

  const html = `<!doctype html>
<html lang="pl">
  <body style="margin:0;padding:0;background-color:#f6f1e8;color:#1f1712;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${safePreheader}</div>
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
              <td style="background:#ffffff;border-radius:22px;padding:34px 32px;box-shadow:0 10px 30px rgba(52,33,14,0.08);">
                <div style="text-align:center;margin:0 0 22px 0;">
                  <div style="font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.25;color:#1f1712;font-weight:700;">
                    ${safeHeaderBrand}
                  </div>
                  ${
                    safeContext
                      ? `<div style="font-size:17px;line-height:1.4;color:#4a3d32;font-weight:600;margin-top:12px;">${safeContext}</div>`
                      : ""
                  }
                  ${
                    safeNumber
                      ? `<div style="font-size:15px;line-height:1.45;color:#7a6754;margin-top:10px;letter-spacing:0.02em;">${safeNumber}</div>`
                      : ""
                  }
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

function base64Utf8(value) {
  const bytes = new TextEncoder().encode(String(value ?? ""));
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function toMimeHeader(value) {
  const input = String(value ?? "");
  return /^[\x20-\x7E]*$/.test(input) ? input : `=?UTF-8?B?${base64Utf8(input)}?=`;
}

function formatAddressHeader(rawValue) {
  const raw = cleanString(rawValue, 500);
  const match = raw.match(/^(.*)<([^>]+)>\s*$/);
  if (!match) return raw;
  const display = cleanString(match[1], 200).replace(/^"+|"+$/g, "").trim();
  const email = cleanString(match[2], 320);
  if (!email) return raw;
  if (!display) return email;
  return `${toMimeHeader(display)} <${email}>`;
}

function base64Lines(value, lineLen = 76) {
  const raw = base64Utf8(value);
  const out = [];
  for (let i = 0; i < raw.length; i += lineLen) {
    out.push(raw.slice(i, i + lineLen));
  }
  return out.join("\r\n");
}

function normalizeCrlf(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "\r\n");
}

function publicSiteUrl(env, request) {
  const explicit = cleanString(env.PUBLIC_SITE_URL, 1000).replace(/\/$/, "");
  if (explicit) return explicit;
  const origin = new URL(request.url).origin;
  const host = new URL(origin).hostname;
  if (host.startsWith("api.")) {
    return `https://${host.slice(4)}`;
  }
  return origin;
}

function serviceConfirmPath(service) {
  if (service === "hotel") return "/Hotel/potwierdzenie.html";
  if (service === "restaurant") return "/Restauracja/potwierdzenie.html";
  return "/Przyjec/potwierdzenie.html";
}

function serviceAdminActionPath(service) {
  if (service === "hotel") return "/Hotel/akceptacja.html";
  if (service === "restaurant") return "/Restauracja/akceptacja.html";
  return "/Przyjec/akceptacja.html";
}

function buildConfirmationLink(env, request, service, token) {
  const base = publicSiteUrl(env, request);
  return `${base}${serviceConfirmPath(service)}?token=${encodeURIComponent(token)}`;
}

function buildAdminActionLink(env, request, service, token) {
  const base = publicSiteUrl(env, request);
  return `${base}${serviceAdminActionPath(service)}?token=${encodeURIComponent(token)}`;
}

function serviceLandingPath(service) {
  if (service === "hotel") return "/Hotel/";
  if (service === "restaurant") return "/Restauracja/";
  return "/Przyjec/";
}

function serviceLabel(service) {
  if (service === "hotel") return "Hotel";
  if (service === "restaurant") return "Restauracja";
  return "Przyjęcia i sale";
}

function reservationTableName(service) {
  if (service === "hotel") return "hotel_reservations";
  if (service === "restaurant") return "restaurant_reservations";
  return "venue_reservations";
}

function splitLines(raw) {
  return String(raw || "").split(/\r?\n/).filter((line) => line !== "");
}

function extractEmailAddress(value) {
  const v = cleanString(value, 500);
  const m = v.match(/<([^>]+)>/);
  return cleanString(m ? m[1] : v, 320);
}

function emailDomain(address) {
  const at = String(address || "").lastIndexOf("@");
  if (at < 0) return "";
  return String(address || "")
    .slice(at + 1)
    .trim()
    .toLowerCase();
}

function isExactDomain(address, domain) {
  const d = cleanString(domain, 200).toLowerCase();
  if (!d) return false;
  return emailDomain(address) === d;
}

function isLikelyDeliverableEmail(address) {
  const normalized = cleanString(address, 320).toLowerCase();
  if (!normalized || !normalized.includes("@")) return false;
  const domain = emailDomain(normalized);
  if (!domain || domain === "local" || domain === "localhost") return false;
  return domain.includes(".");
}

function isClientFacingMailEvent(eventKey) {
  const key = cleanString(eventKey, 120);
  return key === "confirm_email" || key.endsWith("_client");
}

function resolveSmtpFromHeader(env, user) {
  const requiredDomain = cleanString(env.MAIL_FROM_DOMAIN, 200).toLowerCase() || "sredzka-korona.pl";
  const preferredRaw = cleanString(env.SMTP_FROM, 500);
  const preferredEmail = extractEmailAddress(preferredRaw);
  if (preferredEmail && isExactDomain(preferredEmail, requiredDomain)) {
    return preferredRaw || preferredEmail;
  }

  const userEmail = extractEmailAddress(user);
  if (userEmail && isExactDomain(userEmail, requiredDomain)) {
    return user;
  }

  const fallbackRaw = cleanString(env.MAIL_FROM_FALLBACK, 500) || `Sredzka Korona <kontakt@${requiredDomain}>`;
  const fallbackEmail = extractEmailAddress(fallbackRaw);
  if (fallbackEmail && isExactDomain(fallbackEmail, requiredDomain)) {
    return fallbackRaw;
  }

  return preferredRaw || user || fallbackRaw;
}

function readShadowCopyConfig(env) {
  const recipient = cleanString(env.MAIL_SHADOW_TO, 320).toLowerCase();
  const untilMs = Number(env.MAIL_SHADOW_UNTIL_MS || 0);
  const active = recipient.includes("@") && Number.isFinite(untilMs) && untilMs > 0 && nowMs() <= untilMs;
  return { active, recipient, untilMs };
}

function createSmtpLineReader(readable) {
  const decoder = new TextDecoder();
  const reader = readable.getReader();
  let buf = "";
  return async function readLine() {
    while (true) {
      const idx = buf.indexOf("\n");
      if (idx >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, "");
        buf = buf.slice(idx + 1);
        return line;
      }
      const chunk = await reader.read();
      if (chunk.done) {
        if (buf) {
          const last = buf.replace(/\r$/, "");
          buf = "";
          return last;
        }
        return null;
      }
      buf += decoder.decode(chunk.value, { stream: true });
    }
  };
}

async function smtpReadResponse(readLine) {
  const lines = [];
  while (true) {
    const line = await readLine();
    if (line == null) {
      throw new Error("SMTP: połączenie zamknięte przez serwer.");
    }
    lines.push(line);
    if (/^\d{3} /.test(line)) {
      break;
    }
  }
  const code = Number(lines[lines.length - 1].slice(0, 3));
  return { code, lines };
}

async function smtpExpect(readLine, allowedCodes, context) {
  const res = await smtpReadResponse(readLine);
  if (!allowedCodes.includes(res.code)) {
    throw new Error(`SMTP: ${context}. Odpowiedź: ${res.lines.join(" | ")}`);
  }
  return res;
}

async function smtpWrite(writer, line) {
  const payload = `${line}\r\n`;
  await writer.write(new TextEncoder().encode(payload));
}

async function sendMailViaSmtp(env, { to, subject, html, text, replyTo }) {
  if (!hasSmtpConfig(env)) {
    return { skipped: true };
  }
  const host = cleanString(env.SMTP_HOST, 500);
  const port = Number(env.SMTP_PORT || "465");
  const user = cleanString(env.SMTP_USER, 500);
  const pass = cleanString(env.SMTP_PASS, 500);
  const from = resolveSmtpFromHeader(env, user);
  const fromAddress = extractEmailAddress(from);
  const toAddress = cleanString(to, 500);
  if (!toAddress) {
    return { skipped: true };
  }

  const socket = connect({ hostname: host, port }, { secureTransport: "on" });
  const readLine = createSmtpLineReader(socket.readable);
  const writer = socket.writable.getWriter();

  try {
    await smtpExpect(readLine, [220], "serwer nie przyjął połączenia");
    await smtpWrite(writer, `EHLO ${cleanString(env.SMTP_EHLO_HOST, 200) || "sredzka-korona.pl"}`);
    await smtpExpect(readLine, [250], "EHLO odrzucone");

    await smtpWrite(writer, "AUTH LOGIN");
    await smtpExpect(readLine, [334], "AUTH LOGIN odrzucone");
    await smtpWrite(writer, btoa(user));
    await smtpExpect(readLine, [334], "SMTP nie poprosił o hasło");
    await smtpWrite(writer, btoa(pass));
    await smtpExpect(readLine, [235], "logowanie SMTP nieudane");

    await smtpWrite(writer, `MAIL FROM:<${fromAddress}>`);
    await smtpExpect(readLine, [250], "MAIL FROM odrzucone");
    await smtpWrite(writer, `RCPT TO:<${toAddress}>`);
    await smtpExpect(readLine, [250, 251], "RCPT TO odrzucone");

    await smtpWrite(writer, "DATA");
    await smtpExpect(readLine, [354], "DATA odrzucone");

    const htmlNormalized = normalizeCrlf(html || "");
    const html64 = base64Lines(htmlNormalized);
    const messageId = `<${crypto.randomUUID()}@${cleanString(env.SMTP_EHLO_HOST, 200) || "sredzka-korona.pl"}>`;
    const headers = [
      `From: ${formatAddressHeader(from)}`,
      `To: ${toAddress}`,
      `Subject: ${toMimeHeader(subject || "")}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: ${messageId}`,
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "Auto-Submitted: auto-generated",
      "X-Auto-Response-Suppress: All",
      replyTo ? `Reply-To: ${toMimeHeader(replyTo)}` : null,
      "",
      html64,
      ".",
    ]
      .filter(Boolean)
      .join("\r\n");
    await writer.write(new TextEncoder().encode(`${headers}\r\n`));
    const accepted = await smtpExpect(readLine, [250], "wiadomość nie została przyjęta");

    await smtpWrite(writer, "QUIT");
    await smtpExpect(readLine, [221], "QUIT odrzucone");
    return {
      ok: true,
      smtpAccepted: (accepted?.lines || []).join(" | "),
      messageId,
      envelopeFrom: fromAddress,
    };
  } finally {
    try {
      writer.releaseLock();
    } catch {}
    try {
      await socket.close();
    } catch {}
  }
}

function isSmtpAuthFailure(error) {
  const msg = String(error?.message || error || "").toLowerCase();
  return msg.includes("authentication failed") || msg.includes("logowanie smtp nieudane") || msg.includes(" 535 ");
}

async function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendMailViaSmtpWithRetry(env, payload, options = {}) {
  const retries = Number(options.retries ?? 1);
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await sendMailViaSmtp(env, payload);
    } catch (error) {
      lastError = error;
      const canRetry = attempt < retries && isSmtpAuthFailure(error);
      if (!canRetry) throw error;
      await sleepMs(400);
    }
  }
  throw lastError || new Error("SMTP retry failed");
}

function nowMs() {
  return Date.now();
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toJson(value) {
  return JSON.stringify(value ?? null);
}

function cleanString(value, maxLen = 5000) {
  return String(value || "").trim().slice(0, maxLen);
}

function isYmd(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function isHm(value) {
  return /^\d{2}:\d{2}$/.test(String(value || ""));
}

/** Start imprezy na sali: co 30 min, 00:00 … 23:30 (zgodnie z frontendem). */
function isHallStartSlotHm(value) {
  if (!isHm(value)) return false;
  const hh = toInt(String(value).slice(0, 2), -1);
  const mm = toInt(String(value).slice(3, 5), -1);
  return hh >= 0 && hh <= 23 && (mm === 0 || mm === 30);
}

function assertHallStartSlotTime(startTime) {
  if (!isHallStartSlotHm(startTime)) {
    throw new Error("Godzina rozpoczęcia musi być od 00:00 do 23:30, co 30 minut.");
  }
}

function nightsCount(dateFrom, dateTo) {
  const [fy, fm, fd] = String(dateFrom).split("-").map((x) => Number(x));
  const [ty, tm, td] = String(dateTo).split("-").map((x) => Number(x));
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.max(0, Math.round((to - from) / 86400000));
}

function ymdHmToMs(ymd, hm) {
  if (!isYmd(ymd) || !isHm(hm)) return NaN;
  const [y, m, d] = String(ymd).split("-").map((x) => Number(x));
  const [hh, mm] = String(hm).split(":").map((x) => Number(x));
  return Date.UTC(y, m - 1, d, hh, mm, 0, 0);
}

/** Jak ymdHmToMs, ale dla czasu lokalnego Europe/Warsaw (zgodnie z modułem sal w Firebase). */
const HALL_MIN_ADVANCE_MS = 2 * 60 * 60 * 1000;
const RESTAURANT_MIN_ADVANCE_MS = 2 * 60 * 60 * 1000;

function ymdHmToMsWarsaw(ymd, hm) {
  if (!isYmd(ymd) || !isHm(hm)) return NaN;
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
    const parts = dtf.formatToParts(new Date(utcMs));
    const pv = (type) => parts.find((p) => p.type === type)?.value;
    const y = Number(pv("year"));
    const mo = Number(pv("month"));
    const da = Number(pv("day"));
    const ho = Number(pv("hour"));
    const mi = Number(pv("minute"));
    if (y === Y && mo === M && da === D && ho === h && mi === m) {
      return utcMs;
    }
    utcMs += (h * 60 + m - (ho * 60 + mi)) * 60 * 1000;
  }
  return NaN;
}

function todayYmdInWarsaw() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value || "1970";
  const month = parts.find((part) => part.type === "month")?.value || "01";
  const day = parts.find((part) => part.type === "day")?.value || "01";
  return `${year}-${month}-${day}`;
}

function assertRestaurantStartLeadTime(reservationDate, startTime, now = Date.now()) {
  const startMs = ymdHmToMsWarsaw(reservationDate, startTime);
  if (!Number.isFinite(startMs)) {
    throw new Error("Nieprawidłowa data lub godzina.");
  }
  if (startMs < now - 60 * 1000) {
    throw new Error("Nie można wybrać terminu z przeszłości.");
  }
  if (reservationDate === todayYmdInWarsaw() && startMs < now + RESTAURANT_MIN_ADVANCE_MS) {
    throw new Error("Wybierz godzinę co najmniej 2 godziny od teraz.");
  }
  return startMs;
}

function formatHm(ms) {
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleTimeString("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/Warsaw",
  });
}

function formatDateTimeWarsaw(ms) {
  if (!Number.isFinite(Number(ms))) return "";
  return new Intl.DateTimeFormat("pl-PL", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(Number(ms)));
}

function randomToken() {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  let out = "";
  arr.forEach((b) => {
    out += b.toString(16).padStart(2, "0");
  });
  return out;
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(String(text || ""));
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let out = "";
  bytes.forEach((b) => {
    out += b.toString(16).padStart(2, "0");
  });
  return out;
}

function normalizePhone(prefix, national) {
  const p = cleanString(prefix || "+48", 8);
  const n = cleanString(national || "", 32).replace(/[^\d]/g, "");
  return {
    prefix: p,
    national: n,
    e164: `${p}${n}`,
  };
}

function reservationTypeLabel(service) {
  if (service === "hotel") return "HOTEL";
  if (service === "restaurant") return "CATERING";
  return "PRZYJĘCIA";
}

function legacyReservationOffsets(service) {
  if (service === "hotel") return [1000];
  if (service === "restaurant") return [3000, 2000];
  if (service === "hall") return [3000, 2000];
  return [];
}

function normalizeLegacyReservationSequence(sequence, service) {
  const numeric = Number(sequence);
  if (!Number.isInteger(numeric) || numeric <= 0) return 0;
  const normalizedService = cleanString(service, 40).toLowerCase();
  for (const offset of legacyReservationOffsets(normalizedService)) {
    if (numeric > offset && numeric < offset + 1000) {
      return numeric - offset;
    }
  }
  return numeric;
}

function reservationSubjectLabel(service, row) {
  if (service === "hotel") return "Pobyt hotelowy";
  if (service === "restaurant") return "Rezerwacja stolika";
  const hallName = cleanString(row?.hall_name_snapshot || row?.hallName || row?.hall_id || row?.hallId, 200);
  const eventType = cleanString(row?.event_type || row?.eventType, 200);
  if (hallName && eventType) return `Rezerwacja sali ${hallName} (${eventType})`;
  if (hallName) return `Rezerwacja sali ${hallName}`;
  if (eventType) return `Rezerwacja sali (${eventType})`;
  return "Rezerwacja sali";
}

function yearFromMsWarsaw(ms) {
  let t = Number(ms);
  if (!Number.isFinite(t) || t <= 0) return new Date().getFullYear();
  if (t < 1e12) t *= 1000;
  return Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric" }).format(new Date(t))
  );
}

function extractReservationSequenceAndYear(rawValue, service = "") {
  const raw = cleanString(rawValue, 120);
  if (!raw) return { sequence: null, year: null };

  const modern = raw.match(/^(\d+)\/(\d{4})\/(?:HOTEL|RESTAURACJA|CATERING|PRZYJ(?:Ę|E)CIA)$/u);
  if (modern) {
    return {
      sequence: normalizeLegacyReservationSequence(Number(modern[1]), service),
      year: Number(modern[2]),
    };
  }

  const legacy = raw.match(/^[A-Z]{2}-(\d{4})-(\d+)$/u);
  if (legacy) {
    return {
      sequence: normalizeLegacyReservationSequence(Number(legacy[2]), service),
      year: Number(legacy[1]),
    };
  }

  if (/^\d+$/u.test(raw)) {
    return {
      sequence: normalizeLegacyReservationSequence(Number(raw), service),
      year: null,
    };
  }
  return { sequence: null, year: null };
}

function addOneDayYmd(ymd) {
  const s = String(ymd || "");
  const [y, m, d] = s.split("-").map((x) => Number(x));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return s;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function addDaysYmd(ymd, days) {
  let out = String(ymd || "");
  const total = Math.max(0, toInt(days, 0));
  for (let index = 0; index < total; index += 1) {
    out = addOneDayYmd(out);
  }
  return out;
}

function addMonthsYmd(ymd, months) {
  const s = String(ymd || "");
  const [y, m, d] = s.split("-").map((x) => Number(x));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return s;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCMonth(dt.getUTCMonth() + Number(months || 0));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function addYearsYmd(ymd, years) {
  const s = String(ymd || "");
  const [y, m, d] = s.split("-").map((x) => Number(x));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return s;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCFullYear(dt.getUTCFullYear() + Number(years || 0));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

const RESTAURANT_PUBLIC_CALENDAR_DAYS = 31;
const HALL_PUBLIC_CALENDAR_DAYS = 1096;
const PUBLIC_CALENDAR_STEP_MINUTES = 30;

async function existingReservationCountForYear(env, service, year) {
  const y = Number(year);
  const table = reservationTableName(service);
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS total
     FROM ${table}
     WHERE human_year = ?`
  )
    .bind(y)
    .first();
  return Number(row?.total || 0);
}

async function maxHumanSequenceForYear(env, service, year) {
  const y = Number(year);
  const table = reservationTableName(service);
  const rows = await env.DB.prepare(
    `SELECT human_number
     FROM ${table}
     WHERE human_year = ?`
  )
    .bind(y)
    .all();
  let maxSequence = 0;
  for (const row of rows.results || []) {
    const normalized = normalizeLegacyReservationSequence(row?.human_number, service);
    if (normalized > maxSequence) maxSequence = normalized;
  }
  return maxSequence;
}

async function nextHumanSequenceForYear(env, service, year) {
  const y = Number(year);
  if (!Number.isFinite(y) || y < 2000 || y > 2100) {
    throw new Error("Nieprawidłowy rok numeracji.");
  }
  const normalizedService = cleanString(service, 40).toLowerCase() || "hotel";
  const key = `reservation_human_seq_${normalizedService}_${y}`;
  const existing = await env.DB.prepare("SELECT value FROM booking_counters WHERE key = ?")
    .bind(key)
    .first();
  const existingValue = Number(existing?.value || 0);
  if (existing && existingValue >= 1000) {
    const [existingCount, maxHuman] = await Promise.all([
      existingReservationCountForYear(env, normalizedService, y),
      maxHumanSequenceForYear(env, normalizedService, y),
    ]);
    const repairedCounterValue = Math.max(existingCount, maxHuman, 0);
    if (repairedCounterValue < 1000) {
      await env.DB.prepare("UPDATE booking_counters SET value = ? WHERE key = ?")
        .bind(repairedCounterValue, key)
        .run();
    }
  }
  let startingValue = 1;
  if (!existing) {
    const [existingCount, maxHuman] = await Promise.all([
      existingReservationCountForYear(env, normalizedService, y),
      maxHumanSequenceForYear(env, normalizedService, y),
    ]);
    startingValue = Math.max(existingCount, maxHuman, 0) + 1;
  }
  const row = await env.DB.prepare(
    `INSERT INTO booking_counters (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = booking_counters.value + 1
     RETURNING value`
  )
    .bind(key, startingValue)
    .first();
  return Number(row?.value || startingValue);
}

function formatHumanReservationNumber(row, service) {
  if (!row) return "";
  if (service === "restaurant" && Number(row.catering_delivery) === 1) {
    const slug = cleanString(row.human_slug ?? row.humanSlug, 80);
    const explicitYear = Number(row.human_year ?? row.humanYear);
    const inferredYear =
      Number.isInteger(explicitYear) && explicitYear >= 2000 && explicitYear <= 2100
        ? explicitYear
        : yearFromMsWarsaw(row.created_at ?? row.createdAtMs ?? row.start_ms ?? row.startDateTime);
    if (slug && Number.isInteger(inferredYear) && inferredYear >= 2000 && inferredYear <= 2100) {
      return `${slug}/CATERING/${inferredYear}`;
    }
  }
  const rawValue = row.human_number ?? row.humanNumber ?? row.humanNumberLabel;
  const rawText = cleanString(rawValue, 120);
  if (!rawText) return "";

  const parsed = extractReservationSequenceAndYear(rawText, service);
  const explicitYear = Number(row.human_year ?? row.humanYear);
  const inferredYear =
    Number.isInteger(explicitYear) && explicitYear >= 2000 && explicitYear <= 2100
      ? explicitYear
      : yearFromMsWarsaw(row.created_at ?? row.createdAtMs ?? row.start_ms ?? row.startDateTime);

  if (parsed.sequence && Number.isInteger(inferredYear) && inferredYear >= 2000 && inferredYear <= 2100) {
    return `${parsed.sequence}/${inferredYear}/${reservationTypeLabel(service)}`;
  }

  return rawText;
}

function reservationNumberForRow(row, service) {
  const formatted = formatHumanReservationNumber(row, service);
  if (formatted) return formatted;
  return cleanString(row?.id, 120);
}

async function readBody(request) {
  const txt = await request.text();
  if (!txt) return {};
  try {
    return JSON.parse(txt);
  } catch {
    return {};
  }
}

function assertSession(sessionStartedAt) {
  const started = Number(sessionStartedAt || 0);
  if (!started || nowMs() - started > SESSION_MS) {
    throw new Error("Sesja rezerwacji wygasła (30 min). Rozpocznij od nowa.");
  }
}

function assertTerms(accepted) {
  if (!accepted) {
    throw new Error("Wymagana akceptacja regulaminu.");
  }
}

function assertDateRange(dateFrom, dateTo) {
  if (!isYmd(dateFrom) || !isYmd(dateTo)) {
    throw new Error("Nieprawidłowy zakres dat.");
  }
  if (dateTo <= dateFrom) {
    throw new Error("Wyjazd musi być po dniu przyjazdu.");
  }
  const today = todayYmdInWarsaw();
  const maxHotelDate = addYearsYmd(today, 1);
  if (dateFrom > maxHotelDate || dateTo > maxHotelDate) {
    throw new Error("Rezerwację hotelu można złożyć maksymalnie na rok do przodu.");
  }
}

function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

function toInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function between(value, min, max) {
  return value >= min && value <= max;
}

async function ensureSchema(env) {
  if (schemaReadyPromise) return schemaReadyPromise;
  schemaReadyPromise = (async () => {
    const stmts = [
      `CREATE TABLE IF NOT EXISTS booking_counters (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS booking_mail_templates (
        service TEXT NOT NULL,
        key TEXT NOT NULL,
        subject TEXT NOT NULL,
        body_html TEXT NOT NULL,
        action_label TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (service, key)
      )`,
      `CREATE TABLE IF NOT EXISTS booking_mail_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service TEXT NOT NULL,
        event_key TEXT NOT NULL,
        reservation_id TEXT,
        recipient TEXT NOT NULL,
        envelope_from TEXT NOT NULL DEFAULT '',
        subject TEXT NOT NULL,
        status TEXT NOT NULL,
        message_id TEXT NOT NULL DEFAULT '',
        smtp_accepted TEXT NOT NULL DEFAULT '',
        error TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_mail_audit_created_at ON booking_mail_audit(created_at DESC)`,
      `CREATE TABLE IF NOT EXISTS hotel_rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        price_per_night REAL NOT NULL DEFAULT 0,
        max_guests INTEGER NOT NULL DEFAULT 2,
        beds_single INTEGER NOT NULL DEFAULT 0,
        beds_double INTEGER NOT NULL DEFAULT 1,
        beds_child INTEGER NOT NULL DEFAULT 0,
        description TEXT NOT NULL DEFAULT '',
        image_urls_json TEXT NOT NULL DEFAULT '[]',
        active INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS hotel_reservations (
        id TEXT PRIMARY KEY,
        human_number INTEGER NOT NULL,
        status TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone_prefix TEXT NOT NULL DEFAULT '',
        phone_national TEXT NOT NULL DEFAULT '',
        phone_e164 TEXT NOT NULL DEFAULT '',
        date_from TEXT NOT NULL,
        date_to TEXT NOT NULL,
        total_price REAL NOT NULL DEFAULT 0,
        customer_note TEXT NOT NULL DEFAULT '',
        admin_note TEXT NOT NULL DEFAULT '',
        room_ids_json TEXT NOT NULL DEFAULT '[]',
        confirmation_token_hash TEXT,
        admin_action_token_hash TEXT,
        admin_action_expires_at INTEGER,
        email_verification_expires_at INTEGER,
        pending_expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_hotel_res_status_dates
        ON hotel_reservations(status, date_from, date_to)`,
      `CREATE TABLE IF NOT EXISTS restaurant_settings (
        id TEXT PRIMARY KEY,
        table_count INTEGER NOT NULL,
        max_guests_per_table INTEGER NOT NULL,
        reservation_open_time TEXT NOT NULL,
        reservation_close_time TEXT NOT NULL,
        time_slot_minutes INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS restaurant_tables (
        id TEXT PRIMARY KEY,
        number INTEGER NOT NULL,
        zone TEXT NOT NULL DEFAULT 'sala',
        active INTEGER NOT NULL DEFAULT 1,
        hidden INTEGER NOT NULL DEFAULT 0,
        description TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS restaurant_reservations (
        id TEXT PRIMARY KEY,
        human_number INTEGER NOT NULL,
        status TEXT NOT NULL,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone_prefix TEXT NOT NULL DEFAULT '',
        phone_national TEXT NOT NULL DEFAULT '',
        phone_e164 TEXT NOT NULL DEFAULT '',
        reservation_date TEXT NOT NULL,
        start_time TEXT NOT NULL,
        duration_hours REAL NOT NULL,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        tables_count INTEGER NOT NULL,
        guests_count INTEGER NOT NULL,
        join_tables INTEGER NOT NULL DEFAULT 0,
        place_preference TEXT NOT NULL DEFAULT 'no_preference',
        assigned_table_ids_json TEXT NOT NULL DEFAULT '[]',
        customer_note TEXT NOT NULL DEFAULT '',
        admin_note TEXT NOT NULL DEFAULT '',
        cleanup_buffer_minutes INTEGER NOT NULL DEFAULT 30,
        confirmation_token_hash TEXT,
        admin_action_token_hash TEXT,
        admin_action_expires_at INTEGER,
        email_verification_expires_at INTEGER,
        pending_expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_rest_res_status_time
        ON restaurant_reservations(status, start_ms, end_ms)`,
      `CREATE TABLE IF NOT EXISTS venue_settings (
        id TEXT PRIMARY KEY,
        hall_open_time TEXT NOT NULL,
        hall_close_time TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS venue_halls (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        capacity INTEGER NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        hall_kind TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        exclusive_rule TEXT NOT NULL DEFAULT 'optional',
        buffer_minutes INTEGER NOT NULL DEFAULT 60,
        full_block_guest_threshold INTEGER NOT NULL DEFAULT 100,
        sort_order INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS venue_reservations (
        id TEXT PRIMARY KEY,
        human_number INTEGER NOT NULL,
        status TEXT NOT NULL,
        hall_id TEXT NOT NULL,
        hall_name_snapshot TEXT NOT NULL,
        hall_kind_snapshot TEXT NOT NULL,
        full_block_guest_threshold_snap INTEGER NOT NULL DEFAULT 100,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone_prefix TEXT NOT NULL DEFAULT '',
        phone_national TEXT NOT NULL DEFAULT '',
        phone_e164 TEXT NOT NULL DEFAULT '',
        reservation_date TEXT NOT NULL,
        start_time TEXT NOT NULL,
        duration_hours REAL NOT NULL,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        start_time_label TEXT NOT NULL DEFAULT '',
        end_time_label TEXT NOT NULL DEFAULT '',
        guests_count INTEGER NOT NULL DEFAULT 0,
        exclusive INTEGER NOT NULL DEFAULT 0,
        full_block INTEGER NOT NULL DEFAULT 0,
        event_type TEXT NOT NULL DEFAULT '',
        customer_note TEXT NOT NULL DEFAULT '',
        admin_note TEXT NOT NULL DEFAULT '',
        confirmation_token_hash TEXT,
        admin_action_token_hash TEXT,
        admin_action_expires_at INTEGER,
        email_verification_expires_at INTEGER,
        pending_expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_venue_res_status_time
        ON venue_reservations(status, hall_id, start_ms, end_ms)`,
      `CREATE TABLE IF NOT EXISTS site_notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        starts_at TEXT NOT NULL,
        ends_at TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_site_notifications_window
        ON site_notifications(starts_at, ends_at)`,
    ];
    for (const sql of stmts) {
      await env.DB.prepare(sql).run();
    }
    await migrateMailAuditSchema(env);
    await migrateRestaurantPlacePreference(env);
    await migrateBookingMailTemplatesActionLabel(env);
    await seedDefaults(env);
    await migrateHumanYearAndTemplates(env);
    await migrateCateringDeliverySchema(env);
  })();
  return schemaReadyPromise;
}

async function migrateCateringDeliverySchema(env) {
  await env.DB
    .prepare(
      `CREATE TABLE IF NOT EXISTS catering_recipients (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        contact_first_name TEXT NOT NULL DEFAULT '',
        contact_last_name TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL,
        phone_prefix TEXT NOT NULL DEFAULT '+48',
        phone_national TEXT NOT NULL DEFAULT '',
        phone_e164 TEXT NOT NULL DEFAULT '',
        street TEXT NOT NULL DEFAULT '',
        building_number TEXT NOT NULL DEFAULT '',
        postal_code TEXT NOT NULL DEFAULT '',
        city TEXT NOT NULL DEFAULT '',
        extra_info TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`
    )
    .run();
  const cols = [
    ["recipient_id", "TEXT"],
    ["catering_delivery", "INTEGER NOT NULL DEFAULT 0"],
    ["human_slug", "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [name, def] of cols) {
    try {
      await env.DB.prepare(`ALTER TABLE restaurant_reservations ADD COLUMN ${name} ${def}`).run();
    } catch {
      /* kolumna już istnieje */
    }
  }
}

function slugifyForHumanNumber(rawName) {
  const mapPl = {
    ą: "a",
    ć: "c",
    ę: "e",
    ł: "l",
    ń: "n",
    ó: "o",
    ś: "s",
    ź: "z",
    ż: "z",
  };
  let s = cleanString(rawName, 200).toLowerCase();
  let out = "";
  for (const ch of s) {
    const lower = ch.toLowerCase();
    if (mapPl[lower]) {
      out += mapPl[lower];
    } else if (/[a-z0-9]/u.test(ch)) {
      out += ch;
    } else if (/[\s._-]/u.test(ch)) {
      out += "_";
    }
  }
  out = out.replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (out.length > 48) out = out.slice(0, 48).replace(/_+$/g, "");
  return out;
}

async function allocateCateringHumanSlug(env, displayName, year, excludeReservationId = null) {
  const y = Number(year);
  const base = slugifyForHumanNumber(displayName);
  if (!base) {
    throw new Error("Nazwa odbiorcy nie nadaje się do numeru rezerwacji — użyj liter lub cyfr.");
  }
  const ex = cleanString(excludeReservationId, 80) || null;
  for (let n = 0; n < 500; n += 1) {
    const candidate = cleanString(n === 0 ? base : `${base}-${n}`, 80);
    let clashSql =
      "SELECT id FROM restaurant_reservations WHERE human_year = ? AND human_slug = ? AND catering_delivery = 1";
    const clashBinds = [y, candidate];
    if (ex) {
      clashSql += " AND id != ?";
      clashBinds.push(ex);
    }
    clashSql += " LIMIT 1";
    const clash = await env.DB.prepare(clashSql).bind(...clashBinds).first();
    if (!clash) return candidate;
  }
  throw new Error("Nie udało się nadać unikalnego numeru rezerwacji.");
}

function mapCateringRecipientApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.display_name || "",
    contactFirstName: row.contact_first_name || "",
    contactLastName: row.contact_last_name || "",
    email: row.email || "",
    phonePrefix: row.phone_prefix || "+48",
    phoneNational: row.phone_national || "",
    street: row.street || "",
    buildingNumber: row.building_number || "",
    postalCode: row.postal_code || "",
    city: row.city || "",
    extraInfo: row.extra_info || "",
  };
}

async function getCateringRecipientRow(env, id) {
  const rid = cleanString(id, 80);
  if (!rid) return null;
  return env.DB.prepare("SELECT * FROM catering_recipients WHERE id = ?").bind(rid).first();
}

async function listCateringRecipients(env) {
  const out = await env.DB.prepare(
    "SELECT * FROM catering_recipients ORDER BY display_name COLLATE NOCASE ASC, id ASC LIMIT 500"
  ).all();
  return (out.results || []).map(mapCateringRecipientApi);
}

async function upsertCateringRecipient(env, body) {
  const now = nowMs();
  const id = cleanString(body.id, 80) || crypto.randomUUID();
  const displayName = cleanString(body.displayName, 200);
  if (!displayName) throw new Error("Podaj nazwę odbiorcy.");
  const email = cleanString(body.email, 180).toLowerCase();
  if (!email || !email.includes("@")) throw new Error("Podaj prawidłowy e-mail odbiorcy.");
  const phone = normalizePhone(body.phonePrefix, body.phoneNational);
  const row = {
    display_name: displayName,
    contact_first_name: cleanString(body.contactFirstName, 80),
    contact_last_name: cleanString(body.contactLastName, 80),
    email,
    phone_prefix: phone.prefix,
    phone_national: phone.national,
    phone_e164: phone.e164,
    street: cleanString(body.street, 200),
    building_number: cleanString(body.buildingNumber, 80),
    postal_code: cleanString(body.postalCode, 16),
    city: cleanString(body.city, 120),
    extra_info: cleanString(body.extraInfo, 2000),
    updated_at: now,
  };
  const existing = await env.DB.prepare("SELECT id FROM catering_recipients WHERE id = ?").bind(id).first();
  if (existing) {
    await env.DB.prepare(
      `UPDATE catering_recipients SET
        display_name=?, contact_first_name=?, contact_last_name=?, email=?,
        phone_prefix=?, phone_national=?, phone_e164=?,
        street=?, building_number=?, postal_code=?, city=?, extra_info=?, updated_at=?
       WHERE id=?`
    )
      .bind(
        row.display_name,
        row.contact_first_name,
        row.contact_last_name,
        row.email,
        row.phone_prefix,
        row.phone_national,
        row.phone_e164,
        row.street,
        row.building_number,
        row.postal_code,
        row.city,
        row.extra_info,
        row.updated_at,
        id
      )
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO catering_recipients (
        id, display_name, contact_first_name, contact_last_name, email,
        phone_prefix, phone_national, phone_e164,
        street, building_number, postal_code, city, extra_info, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        row.display_name,
        row.contact_first_name,
        row.contact_last_name,
        row.email,
        row.phone_prefix,
        row.phone_national,
        row.phone_e164,
        row.street,
        row.building_number,
        row.postal_code,
        row.city,
        row.extra_info,
        now,
        now
      )
      .run();
  }
  const saved = await getCateringRecipientRow(env, id);
  return mapCateringRecipientApi(saved);
}

const MAX_CATERING_REPEAT_OCCURRENCES = 250;
const CATERING_INDEFINITE_UNTIL_YEARS = 5;

function cateringDateFromYmd(ymd) {
  const [y, m, d] = String(ymd).split("-").map((x) => Number(x));
  const dt = new Date(y, m - 1, d);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function cateringYmdFromDate(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function cateringAddOneCalendarMonth(dt) {
  const y = dt.getFullYear();
  const m = dt.getMonth();
  const day = dt.getDate();
  const nm = m + 1;
  const ny = nm > 11 ? y + 1 : y;
  const nmonth = nm > 11 ? 0 : nm;
  const lastDay = new Date(ny, nmonth + 1, 0).getDate();
  const nd = Math.min(day, lastDay);
  return new Date(ny, nmonth, nd);
}

function cateringEffectiveRepeatUntil(reservationDate, repeatUntilRaw, repeatIndefinite) {
  const u = cleanString(repeatUntilRaw, 10);
  if (repeatIndefinite || !u) {
    const start = cateringDateFromYmd(reservationDate);
    if (!start) throw new Error("Nieprawidłowa data pierwszej dostawy.");
    const end = new Date(start);
    end.setFullYear(end.getFullYear() + CATERING_INDEFINITE_UNTIL_YEARS);
    return cateringYmdFromDate(end);
  }
  return u;
}

/**
 * repeatMode: none | selected_days | weekly | biweekly | monthly
 * Dla selected_days: repeatWeekdays = tablica 0–6 (0=niedziela … 6=sobota), jak w Date.getDay().
 */
function expandCateringRepeatDates(reservationDate, repeatMode, repeatWeekday, repeatUntilRaw, options = {}) {
  const repeatIndefinite = Boolean(options.repeatIndefinite);
  const repeatWeekdays = Array.isArray(options.repeatWeekdays) ? options.repeatWeekdays : [];
  const rd = cleanString(reservationDate, 10);
  if (!isYmd(rd)) throw new Error("Nieprawidłowa data pierwszej dostawy.");
  const mode = cleanString(repeatMode, 24).toLowerCase();
  if (!mode || mode === "none") {
    return [rd];
  }
  const until = cateringEffectiveRepeatUntil(rd, repeatUntilRaw, repeatIndefinite);
  if (until.localeCompare(rd) < 0) {
    throw new Error("Data końca powtarzania nie może być wcześniejsza od pierwszej dostawy.");
  }
  const endD = cateringDateFromYmd(until);
  if (!endD) throw new Error("Nieprawidłowa data końca powtarzania.");
  const dates = [];

  if (mode === "selected_days") {
    const set = new Set(
      repeatWeekdays.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
    );
    if (!set.size) throw new Error("Wybierz co najmniej jeden dzień tygodnia.");
    let cur = cateringDateFromYmd(rd);
    if (!cur) throw new Error("Nieprawidłowa data pierwszej dostawy.");
    while (cur <= endD && dates.length < MAX_CATERING_REPEAT_OCCURRENCES) {
      if (set.has(cur.getDay())) {
        dates.push(cateringYmdFromDate(cur));
      }
      cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
    }
    if (!dates.length) throw new Error("Brak terminów w podanym zakresie.");
    return dates;
  }

  if (mode === "weekly") {
    let cur = cateringDateFromYmd(rd);
    if (!cur) throw new Error("Nieprawidłowa data pierwszej dostawy.");
    while (cur <= endD && dates.length < MAX_CATERING_REPEAT_OCCURRENCES) {
      dates.push(cateringYmdFromDate(cur));
      cur.setDate(cur.getDate() + 7);
    }
    if (!dates.length) throw new Error("Brak terminów w podanym zakresie.");
    return dates;
  }

  if (mode === "biweekly") {
    let cur = cateringDateFromYmd(rd);
    if (!cur) throw new Error("Nieprawidłowa data pierwszej dostawy.");
    while (cur <= endD && dates.length < MAX_CATERING_REPEAT_OCCURRENCES) {
      dates.push(cateringYmdFromDate(cur));
      cur.setDate(cur.getDate() + 14);
    }
    if (!dates.length) throw new Error("Brak terminów w podanym zakresie.");
    return dates;
  }

  if (mode === "monthly") {
    let cur = cateringDateFromYmd(rd);
    if (!cur) throw new Error("Nieprawidłowa data pierwszej dostawy.");
    while (cur <= endD && dates.length < MAX_CATERING_REPEAT_OCCURRENCES) {
      dates.push(cateringYmdFromDate(cur));
      cur = cateringAddOneCalendarMonth(cur);
    }
    if (!dates.length) throw new Error("Brak terminów w podanym zakresie.");
    return dates;
  }

  throw new Error("Nieobsługiwany tryb powtarzania.");
}

async function migrateBookingMailTemplatesActionLabel(env) {
  try {
    await env.DB.prepare(`ALTER TABLE booking_mail_templates ADD COLUMN action_label TEXT NOT NULL DEFAULT ''`).run();
  } catch {
    /* kolumna już istnieje */
  }
}

async function migrateMailAuditSchema(env) {
  const cols = [
    ["envelope_from", "TEXT NOT NULL DEFAULT ''"],
    ["message_id", "TEXT NOT NULL DEFAULT ''"],
    ["smtp_accepted", "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [name, type] of cols) {
    try {
      await env.DB.prepare(`ALTER TABLE booking_mail_audit ADD COLUMN ${name} ${type}`).run();
    } catch {
      /* kolumna już istnieje */
    }
  }
}

async function migrateRestaurantPlacePreference(env) {
  try {
    await env.DB
      .prepare(`ALTER TABLE restaurant_reservations ADD COLUMN place_preference TEXT NOT NULL DEFAULT 'no_preference'`)
      .run();
  } catch {
    /* kolumna już istnieje */
  }
}

async function migrateHumanYearAndTemplates(env) {
  for (const tbl of ["hotel_reservations", "restaurant_reservations", "venue_reservations"]) {
    try {
      await env.DB.prepare(`ALTER TABLE ${tbl} ADD COLUMN human_year INTEGER`).run();
    } catch {
      /* kolumna już istnieje */
    }
    try {
      await env.DB.prepare(`ALTER TABLE ${tbl} ADD COLUMN admin_action_token_hash TEXT`).run();
    } catch {
      /* kolumna już istnieje */
    }
    try {
      await env.DB.prepare(`ALTER TABLE ${tbl} ADD COLUMN admin_action_expires_at INTEGER`).run();
    } catch {
      /* kolumna już istnieje */
    }
  }
  await env.DB.prepare(
    `UPDATE hotel_reservations SET human_year = CAST(strftime('%Y', created_at/1000, 'unixepoch') AS INTEGER)
     WHERE human_year IS NULL`
  ).run();
  await env.DB.prepare(
    `UPDATE restaurant_reservations SET human_year = CAST(strftime('%Y', created_at/1000, 'unixepoch') AS INTEGER)
     WHERE human_year IS NULL`
  ).run();
  await env.DB.prepare(
    `UPDATE venue_reservations SET human_year = CAST(strftime('%Y', created_at/1000, 'unixepoch') AS INTEGER)
     WHERE human_year IS NULL`
  ).run();

  const now = nowMs();
  const adminLinkCeiling = now + ADMIN_ACTION_LINK_MS;
  for (const tbl of ["hotel_reservations", "restaurant_reservations", "venue_reservations"]) {
    await env.DB.prepare(
      `UPDATE ${tbl}
       SET admin_action_expires_at = CASE
         WHEN pending_expires_at IS NOT NULL THEN MIN(pending_expires_at, ?)
         ELSE ?
       END
       WHERE admin_action_token_hash IS NOT NULL
         AND admin_action_expires_at IS NULL`
    )
      .bind(adminLinkCeiling, adminLinkCeiling)
      .run();
  }

  const services = ["hotel", "restaurant", "hall"];
  for (const service of services) {
    const defaults = defaultTemplateMap(service);
    const existing = await env.DB.prepare("SELECT key FROM booking_mail_templates WHERE service = ?")
      .bind(service)
      .all();
    const have = new Set((existing.results || []).map((r) => r.key));
    for (const [key, val] of Object.entries(defaults)) {
      if (have.has(key)) continue;
      await env.DB.prepare(
        "INSERT INTO booking_mail_templates (service, key, subject, body_html, action_label, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
        .bind(service, key, val.subject, val.bodyHtml, cleanString(val.actionLabel, 200), now)
        .run();
    }
  }
}

async function seedDefaults(env) {
  const now = nowMs();
  const roomCount = await env.DB.prepare("SELECT COUNT(*) AS c FROM hotel_rooms").first();
  if (!Number(roomCount?.c)) {
    const inserts = [];
    for (let i = 1; i <= 14; i += 1) {
      const id = `room-${String(i).padStart(2, "0")}`;
      const name = `Pokoj ${String(i).padStart(2, "0")}`;
      inserts.push(
        env.DB.prepare(
          "INSERT INTO hotel_rooms (id, name, price_per_night, max_guests, beds_single, beds_double, beds_child, description, image_urls_json, active, sort_order, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)"
        )
          .bind(id, name, 250, 2, 0, 1, 0, "", "[]", i, now)
          .run()
      );
    }
    await Promise.all(inserts);
  }

  const rs = await env.DB.prepare("SELECT COUNT(*) AS c FROM restaurant_settings").first();
  if (!Number(rs?.c)) {
    await env.DB.prepare(
      "INSERT INTO restaurant_settings (id, table_count, max_guests_per_table, reservation_open_time, reservation_close_time, time_slot_minutes, updated_at) VALUES ('default', 5, 4, '12:00', '22:00', 30, ?)"
    )
      .bind(now)
      .run();
  }
  const rt = await env.DB.prepare("SELECT COUNT(*) AS c FROM restaurant_tables").first();
  if (!Number(rt?.c)) {
    const inserts = [];
    for (let i = 1; i <= 5; i += 1) {
      inserts.push(
        env.DB.prepare(
          "INSERT INTO restaurant_tables (id, number, zone, active, hidden, description, sort_order, updated_at) VALUES (?, ?, 'sala', 1, 0, '', ?, ?)"
        )
          .bind(`table-${i}`, i, i, now)
          .run()
      );
    }
    await Promise.all(inserts);
  }

  const vs = await env.DB.prepare("SELECT COUNT(*) AS c FROM venue_settings").first();
  if (!Number(vs?.c)) {
    await env.DB.prepare(
      "INSERT INTO venue_settings (id, hall_open_time, hall_close_time, updated_at) VALUES ('default', '08:00', '23:00', ?)"
    )
      .bind(now)
      .run();
  }
  const vh = await env.DB.prepare("SELECT COUNT(*) AS c FROM venue_halls").first();
  if (!Number(vh?.c)) {
    await env.DB.prepare(
      "INSERT INTO venue_halls (id, name, capacity, active, hall_kind, description, exclusive_rule, buffer_minutes, full_block_guest_threshold, sort_order, updated_at) VALUES ('hall-small', 'Sala mala', 40, 1, 'small', 'Sala kameralna — wylacznosc.', 'always', 60, 100, 1, ?)"
    )
      .bind(now)
      .run();
    await env.DB.prepare(
      "INSERT INTO venue_halls (id, name, capacity, active, hall_kind, description, exclusive_rule, buffer_minutes, full_block_guest_threshold, sort_order, updated_at) VALUES ('hall-large', 'Sala duza', 120, 1, 'large', 'Sala duza — mozliwosc wspoldzielenia.', 'optional', 60, 100, 2, ?)"
    )
      .bind(now)
      .run();
  }
}

function maintenanceRequestLike(env) {
  const fallbackUrl = cleanString(env.PUBLIC_SITE_URL, 1000) || "https://example.com";
  return { url: fallbackUrl };
}

/** Powiadomienie klienta o wygaśnięciu linku weryfikacji e-mail (np. ścieżka kliknięcia w wygasły link). */
async function notifyEmailVerificationExpiredClient(env, requestLike, service, row) {
  const eventKey =
    service === "restaurant"
      ? "restaurant_expired_email_client"
      : service === "hall"
        ? "hall_expired_email_client"
        : "expired_email_client";
  try {
    await sendTemplatedBookingMail(env, requestLike, {
      service,
      eventKey,
      row: { ...row, status: "expired", pending_expires_at: null },
      to: row.email || "",
    });
  } catch (error) {
    console.error(`${service} ${eventKey} (wygasły link potwierdzenia) mail error:`, error);
  }
}

async function expireGroupAndNotify(env, { service, table, initialStatus, expiresColumn, clientEventKey, notifyAdmin }) {
  const now = nowMs();
  const rows = await env.DB.prepare(
    `SELECT * FROM ${table}
     WHERE status = ?
       AND ${expiresColumn} IS NOT NULL
       AND ${expiresColumn} < ?`
  )
    .bind(initialStatus, now)
    .all();
  const expiredRows = rows.results || [];
  if (!expiredRows.length) {
    return 0;
  }
  const requestLike = maintenanceRequestLike(env);
  const adminRecipients = notifyAdmin ? parseAdminNotifyEmails(env) : [];
  let changed = 0;
  const maxClientMailAttempts = 3;
  for (const row of expiredRows) {
    const update = await env.DB.prepare(
      `UPDATE ${table}
       SET status='expired', admin_action_token_hash=NULL, admin_action_expires_at=NULL, pending_expires_at=NULL, updated_at=?
       WHERE id = ? AND status = ?`
    )
      .bind(now, row.id, initialStatus)
      .run();
    const rowChanged = Number(update.meta?.changes || 0);
    if (!rowChanged) {
      continue;
    }
    changed += rowChanged;
    const rowForMail = { ...row, status: "expired", pending_expires_at: null };
    const clientPayload = {
      service,
      eventKey: clientEventKey,
      row: rowForMail,
      to: row.email || "",
    };
    for (let attempt = 1; attempt <= maxClientMailAttempts; attempt += 1) {
      try {
        await sendTemplatedBookingMail(env, requestLike, clientPayload);
        break;
      } catch (error) {
        console.error(
          `${service} ${clientEventKey} mail error (próba ${attempt}/${maxClientMailAttempts}):`,
          error
        );
        if (attempt < maxClientMailAttempts) {
          await sleepMs(500 * attempt);
        }
      }
    }
    if (adminRecipients.length) {
      for (const adminEmail of adminRecipients) {
        try {
          await sendTemplatedBookingMail(env, requestLike, {
            service,
            eventKey: `${service === "restaurant" ? "restaurant_" : service === "hall" ? "hall_" : ""}expired_pending_admin`,
            row: { ...row, status: "expired", pending_expires_at: null },
            to: adminEmail,
          });
        } catch (error) {
          console.error(`${service} expired_pending_admin mail error:`, error);
        }
      }
    }
  }
  return changed;
}

async function expireReservations(env) {
  const hotelEmail = await expireGroupAndNotify(env, {
    service: "hotel",
    table: "hotel_reservations",
    initialStatus: "email_verification_pending",
    expiresColumn: "email_verification_expires_at",
    clientEventKey: "expired_email_client",
    notifyAdmin: false,
  });
  const hotelPending = await expireGroupAndNotify(env, {
    service: "hotel",
    table: "hotel_reservations",
    initialStatus: "pending",
    expiresColumn: "pending_expires_at",
    clientEventKey: "expired_pending_client",
    notifyAdmin: true,
  });
  const restaurantEmail = await expireGroupAndNotify(env, {
    service: "restaurant",
    table: "restaurant_reservations",
    initialStatus: "email_verification_pending",
    expiresColumn: "email_verification_expires_at",
    clientEventKey: "restaurant_expired_email_client",
    notifyAdmin: false,
  });
  const restaurantPending = await expireGroupAndNotify(env, {
    service: "restaurant",
    table: "restaurant_reservations",
    initialStatus: "pending",
    expiresColumn: "pending_expires_at",
    clientEventKey: "restaurant_expired_pending_client",
    notifyAdmin: true,
  });
  const venueEmail = await expireGroupAndNotify(env, {
    service: "hall",
    table: "venue_reservations",
    initialStatus: "email_verification_pending",
    expiresColumn: "email_verification_expires_at",
    clientEventKey: "hall_expired_email_client",
    notifyAdmin: false,
  });
  const venuePending = await expireGroupAndNotify(env, {
    service: "hall",
    table: "venue_reservations",
    initialStatus: "pending",
    expiresColumn: "pending_expires_at",
    clientEventKey: "hall_expired_pending_client",
    notifyAdmin: true,
  });
  return {
    hotel: {
      emailVerification: hotelEmail,
      pending: hotelPending,
    },
    restaurant: {
      emailVerification: restaurantEmail,
      pending: restaurantPending,
    },
    hall: {
      emailVerification: venueEmail,
      pending: venuePending,
    },
  };
}

async function hotelRooms(env) {
  const out = await env.DB.prepare(
    "SELECT id, name, price_per_night AS pricePerNight, max_guests AS maxGuests, beds_single AS bedsSingle, beds_double AS bedsDouble, beds_child AS bedsChild, description, image_urls_json AS imageUrlsJson, active, sort_order AS sortOrder FROM hotel_rooms ORDER BY sort_order ASC, id ASC"
  ).all();
  return (out.results || []).map((r) => ({
    id: r.id,
    name: r.name,
    pricePerNight: Number(r.pricePerNight || 0),
    maxGuests: Number(r.maxGuests || 1),
    bedsSingle: Number(r.bedsSingle || 0),
    bedsDouble: Number(r.bedsDouble || 0),
    bedsChild: Number(r.bedsChild || 0),
    description: r.description || "",
    imageUrls: parseJson(r.imageUrlsJson, []),
    active: Boolean(r.active),
    sortOrder: Number(r.sortOrder || 0),
  }));
}

async function assertHotelRoomDeletable(env, roomId) {
  const rid = cleanString(roomId, 80);
  if (!rid) throw new Error("Brak ID pokoju.");
  const rows = await env.DB.prepare(
    `SELECT room_ids_json AS roomIdsJson FROM hotel_reservations
     WHERE status IN ('email_verification_pending','pending','confirmed','manual_block')`
  ).all();
  for (const row of rows.results || []) {
    const ids = parseJson(row.roomIdsJson, []);
    if (ids.includes(rid)) {
      throw new Error(
        "Nie można usunąć pokoju — jest używany w aktywnej rezerwacji lub blokadzie. Usuń pokój z rezerwacji lub anuluj wpis, potem spróbuj ponownie."
      );
    }
  }
}

async function hotelBlockingReservations(env, dateFrom, dateTo, excludeId = null) {
  const rows = await env.DB.prepare(
    `SELECT id, room_ids_json AS roomIdsJson FROM hotel_reservations
     WHERE status IN ('email_verification_pending','pending','confirmed','manual_block')
       AND date_from < ?
       AND date_to > ?
       ${excludeId ? "AND id != ?" : ""}`
  )
    .bind(...(excludeId ? [dateTo, dateFrom, excludeId] : [dateTo, dateFrom]))
    .all();
  return (rows.results || []).map((r) => ({
    id: r.id,
    roomIds: parseJson(r.roomIdsJson, []),
  }));
}

async function hotelAvailability(env, dateFrom, dateTo, excludeId = null) {
  assertDateRange(dateFrom, dateTo);
  const rooms = (await hotelRooms(env)).filter((r) => r.active);
  const blocked = await hotelBlockingReservations(env, dateFrom, dateTo, excludeId);
  const blockedSet = new Set();
  blocked.forEach((b) => {
    (b.roomIds || []).forEach((id) => blockedSet.add(id));
  });
  const available = rooms.filter((r) => !blockedSet.has(r.id));
  return {
    dateFrom,
    dateTo,
    nights: nightsCount(dateFrom, dateTo),
    availableRoomIds: available.map((r) => r.id),
    rooms: available,
  };
}

async function assertHotelRoomIdsAvailable(env, roomIds, dateFrom, dateTo, excludeId = null) {
  const availability = await hotelAvailability(env, dateFrom, dateTo, excludeId);
  const avail = new Set(availability.availableRoomIds);
  const requested = Array.isArray(roomIds)
    ? roomIds.map((x) => cleanString(x, 80)).filter(Boolean)
    : [];
  if (!requested.length) {
    throw new Error("Wybierz co najmniej jeden pokój.");
  }
  for (const id of requested) {
    if (!avail.has(id)) {
      throw new Error("Wybrany termin nie jest dostępny dla wszystkich pokoi.");
    }
  }
  return { availability, requested };
}

async function createHotelReservation(env, payload, options = {}) {
  const now = nowMs();
  const id = crypto.randomUUID();
  const humanYear = yearFromMsWarsaw(now);
  const humanNumber = await nextHumanSequenceForYear(env, "hotel", humanYear);
  const phone = normalizePhone(payload.phonePrefix, payload.phoneNational);
  const roomIds = Array.isArray(payload.roomIds) ? payload.roomIds.map((x) => cleanString(x, 80)).filter(Boolean) : [];
  const dateFrom = cleanString(payload.dateFrom, 10);
  const dateTo = cleanString(payload.dateTo, 10);
  assertDateRange(dateFrom, dateTo);
  let requested = [];
  if (options.skipAvailabilityCheck) {
    const rooms = await hotelRooms(env);
    const roomIdsSet = new Set(rooms.map((room) => room.id));
    requested = roomIds.filter((roomId) => roomIdsSet.has(roomId));
    if (!requested.length) {
      throw new Error("Wybrane pokoje nie istnieją.");
    }
  } else {
    const availability = await assertHotelRoomIdsAvailable(env, roomIds, dateFrom, dateTo, options.excludeId || null);
    requested = availability.requested;
  }

  const activeRooms = await hotelRooms(env);
  const byId = new Map(activeRooms.map((r) => [r.id, r]));
  const nights = nightsCount(dateFrom, dateTo);
  let totalPrice = 0;
  requested.forEach((rid) => {
    const room = byId.get(rid);
    totalPrice += Number(room?.pricePerNight || 0) * nights;
  });

  const token = options.withConfirmationToken ? randomToken() : "";
  const tokenHash = token ? await sha256Hex(token) : null;
  const status = options.status || "email_verification_pending";
  const emailExp = status === "email_verification_pending" ? now + EMAIL_LINK_MS : null;
  const pendingExp = status === "pending" ? now + HOTEL_PENDING_MS : null;
  await env.DB.prepare(
    `INSERT INTO hotel_reservations (
      id, human_number, human_year, status, customer_name, email, phone_prefix, phone_national, phone_e164,
      date_from, date_to, total_price, customer_note, admin_note, room_ids_json,
      confirmation_token_hash, email_verification_expires_at, pending_expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      humanNumber,
      humanYear,
      status,
      cleanString(payload.fullName || payload.customerName || "Gość", 120),
      cleanString(payload.email, 180).toLowerCase(),
      phone.prefix,
      phone.national,
      phone.e164,
      dateFrom,
      dateTo,
      totalPrice,
      cleanString(payload.customerNote, 2000),
      cleanString(payload.adminNote, 2000),
      toJson(requested),
      tokenHash,
      emailExp,
      pendingExp,
      now,
      now
    )
    .run();

  return { id, humanNumber, token, totalPrice };
}

async function getHotelReservation(env, id) {
  const row = await env.DB.prepare(
    "SELECT * FROM hotel_reservations WHERE id = ?"
  )
    .bind(id)
    .first();
  if (!row) return null;
  return row;
}

function mapHotelReservation(row) {
  const roomIds = parseJson(row.room_ids_json, []);
  return {
    id: row.id,
    humanNumber: row.human_number,
    humanYear: row.human_year != null ? Number(row.human_year) : null,
    humanNumberLabel: formatHumanReservationNumber(row, "hotel"),
    customerName: row.customer_name,
    email: row.email,
    phonePrefix: row.phone_prefix || "",
    phoneNational: row.phone_national || "",
    phone: `${row.phone_prefix || ""} ${row.phone_national || ""}`.trim(),
    status: row.status,
    statusLabel: statusLabel(row.status),
    dateFrom: row.date_from,
    dateTo: row.date_to,
    totalPrice: Number(row.total_price || 0),
    customerNote: row.customer_note || "",
    adminNote: row.admin_note || "",
    roomIds,
    pendingExpiresAt: row.pending_expires_at || null,
    emailVerificationExpiresAt: row.email_verification_expires_at || null,
    createdAtMs: Number(row.created_at || 0),
  };
}

async function loadRestaurantSettings(env) {
  const row = await env.DB.prepare(
    "SELECT table_count AS tableCount, max_guests_per_table AS maxGuestsPerTable, reservation_open_time AS reservationOpenTime, reservation_close_time AS reservationCloseTime, time_slot_minutes AS timeSlotMinutes FROM restaurant_settings WHERE id='default'"
  ).first();
  return row || {
    tableCount: 5,
    maxGuestsPerTable: 4,
    reservationOpenTime: "12:00",
    reservationCloseTime: "22:00",
    timeSlotMinutes: 30,
  };
}

function normalizeComparableText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHmLabel(minutes) {
  const normalized = ((Number(minutes) % 1440) + 1440) % 1440;
  const hh = Math.floor(normalized / 60);
  const mm = normalized % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function parseHmToMinutes(value, { allow24 = false } = {}) {
  const raw = String(value || "").trim().replace(".", ":");
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (Number.isNaN(hh) || Number.isNaN(mm) || mm < 0 || mm > 59) {
    return null;
  }
  if (hh === 24 && mm === 0 && allow24) {
    return 1440;
  }
  if (hh < 0 || hh > 23) {
    return null;
  }
  return hh * 60 + mm;
}

function resolveOpeningHoursDayIndexes(dayValue) {
  const OPENING_HOURS_DAY_ALIASES = [
    ["monday", "poniedzialek", "poniedziałek"],
    ["tuesday", "wtorek"],
    ["wednesday", "sroda", "środa"],
    ["thursday", "czwartek"],
    ["friday", "piatek", "piątek"],
    ["saturday", "sobota"],
    ["sunday", "niedziela"],
  ];
  const normalized = normalizeComparableText(dayValue)
    .replace(/[–—]/g, "-")
    .replace(/\s*-\s*/g, "-");
  if (!normalized) return [];
  if (normalized === "codziennie" || normalized === "daily") {
    return [0, 1, 2, 3, 4, 5, 6];
  }

  const aliasToIndex = new Map();
  OPENING_HOURS_DAY_ALIASES.forEach((aliases, index) => {
    aliases.forEach((alias) => aliasToIndex.set(alias, index));
  });
  if (aliasToIndex.has(normalized)) {
    return [aliasToIndex.get(normalized)];
  }

  const rangeMatch = normalized.match(/^(.+?)-(.+)$/);
  if (rangeMatch) {
    const from = aliasToIndex.get(rangeMatch[1]?.trim());
    const to = aliasToIndex.get(rangeMatch[2]?.trim());
    if (from == null || to == null) return [];
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
  }
  return [];
}

function parseOpeningHoursRange(hoursValue) {
  const raw = String(hoursValue || "").trim();
  if (!raw) {
    return { closed: true };
  }
  const normalized = normalizeComparableText(raw);
  if (["nieczynne", "zamkniete", "zamknięte", "closed"].includes(normalized)) {
    return { closed: true };
  }
  const match = raw.match(/(\d{1,2}[:.]\d{2})\s*[-–—]\s*(\d{1,2}[:.]\d{2})/);
  if (!match) {
    return { closed: true };
  }
  const openMinutes = parseHmToMinutes(match[1], { allow24: false });
  const closeMinutesRaw = parseHmToMinutes(match[2], { allow24: true });
  if (openMinutes == null || closeMinutesRaw == null) {
    return { closed: true };
  }
  const closeMinutes = closeMinutesRaw <= openMinutes ? closeMinutesRaw + 1440 : closeMinutesRaw;
  return {
    closed: false,
    openMinutes,
    closeMinutes,
    openLabel: normalizeHmLabel(openMinutes),
    closeLabel: normalizeHmLabel(closeMinutesRaw),
  };
}

function weekdayIndexMondayFirst(reservationDate) {
  if (!isYmd(reservationDate)) return null;
  const [y, m, d] = reservationDate.split("-").map((part) => Number(part));
  const jsDay = new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0)).getUTCDay(); // 0..6, 0=niedziela
  return jsDay === 0 ? 6 : jsDay - 1; // 0..6, 0=poniedzialek
}

function resolveOpeningHoursWindowForDate(openingHours, reservationDate) {
  const targetDayIndex = weekdayIndexMondayFirst(reservationDate);
  if (targetDayIndex == null) {
    return null;
  }
  if (!Array.isArray(openingHours) || !openingHours.length) {
    return null;
  }

  const dayWindows = new Map();
  for (const item of openingHours) {
    const dayValue =
      item && typeof item === "object"
        ? item.day
        : String(item || "")
            .split(":")[0]
            .trim();
    const hoursValue =
      item && typeof item === "object"
        ? item.hours
        : String(item || "")
            .split(":")
            .slice(1)
            .join(":")
            .trim();
    const dayIndexes = resolveOpeningHoursDayIndexes(dayValue);
    const range = parseOpeningHoursRange(hoursValue);
    dayIndexes.forEach((index) => dayWindows.set(index, range));
  }

  const dayRange = dayWindows.get(targetDayIndex);
  if (!dayRange) return null;
  if (dayRange.closed) {
    return { closed: true, source: "company" };
  }
  return { ...dayRange, source: "company" };
}

async function loadCompanyOpeningHours(env) {
  const row = await env.DB.prepare("SELECT content_json FROM site_content WHERE id = 1").first();
  if (!row?.content_json) {
    return null;
  }
  const parsed = parseJson(row.content_json, null);
  const openingHours = parsed?.company?.openingHours;
  return Array.isArray(openingHours) ? openingHours : null;
}

function fallbackWindowFromSettings(settings) {
  const openMinutes = parseHmToMinutes(settings?.reservationOpenTime || "12:00", { allow24: false });
  const closeMinutesRaw = parseHmToMinutes(settings?.reservationCloseTime || "22:00", { allow24: true });
  const normalizedOpen = openMinutes == null ? 12 * 60 : openMinutes;
  const normalizedCloseRaw = closeMinutesRaw == null ? 22 * 60 : closeMinutesRaw;
  const normalizedClose =
    normalizedCloseRaw <= normalizedOpen ? normalizedCloseRaw + 1440 : normalizedCloseRaw;
  return {
    closed: false,
    openMinutes: normalizedOpen,
    closeMinutes: normalizedClose,
    openLabel: normalizeHmLabel(normalizedOpen),
    closeLabel: normalizeHmLabel(normalizedCloseRaw),
    source: "settings",
  };
}

async function resolveRestaurantWindowForDate(env, settings, reservationDate, preloadedOpeningHours) {
  const openingHours =
    preloadedOpeningHours !== undefined ? preloadedOpeningHours : await loadCompanyOpeningHours(env);
  const dynamic = resolveOpeningHoursWindowForDate(openingHours, reservationDate);
  if (dynamic) {
    return dynamic;
  }
  return fallbackWindowFromSettings(settings);
}

function buildTimeSlotsFromMinutes(openMinutes, closeMinutes, stepMinutes) {
  if (!Number.isFinite(openMinutes) || !Number.isFinite(closeMinutes) || closeMinutes <= openMinutes) {
    return [];
  }
  // W formularzu `reservationDate + HH:MM` nie reprezentujemy startu po północy kolejnego dnia.
  const latestStartBoundary = Math.min(closeMinutes, 1440);
  const step = Math.max(15, Number(stepMinutes || 30));
  const out = [];
  for (let m = openMinutes; m < latestStartBoundary; m += step) {
    out.push(normalizeHmLabel(m));
  }
  return out;
}

async function restaurantTables(env, includeHidden = false) {
  const out = await env.DB.prepare(
    "SELECT id, number, zone, active, hidden, description, sort_order AS sortOrder FROM restaurant_tables ORDER BY sort_order ASC, number ASC"
  ).all();
  return (out.results || [])
    .map((t) => ({
      id: t.id,
      number: Number(t.number || 0),
      zone: t.zone || "sala",
      active: Boolean(t.active),
      hidden: Boolean(t.hidden),
      description: t.description || "",
      sortOrder: Number(t.sortOrder || 0),
    }))
    .filter((t) => t.active && (includeHidden || !t.hidden));
}

async function restaurantBlockingRows(env, startMs, endMs, excludeId = null) {
  const rows = await env.DB.prepare(
    `SELECT id, start_ms AS startMs, end_ms AS endMs,
            tables_count AS tablesCount,
            cleanup_buffer_minutes AS cleanupBufferMinutes,
            assigned_table_ids_json AS assignedTableIdsJson
     FROM restaurant_reservations
     WHERE status IN ('email_verification_pending','pending','confirmed','manual_block')
       AND start_ms < ?
       AND (end_ms + (COALESCE(cleanup_buffer_minutes, ${RESTAURANT_CLEANUP_BUFFER_MINUTES}) * 60000)) > ?
       ${excludeId ? "AND id != ?" : ""}`
  )
    .bind(...(excludeId ? [endMs, startMs, excludeId] : [endMs, startMs]))
    .all();
  return (rows.results || []).map((r) => ({
    id: r.id,
    startMs: Number(r.startMs || 0),
    endMs: Number(r.endMs || 0),
    tablesCount: Math.max(0, Number(r.tablesCount || 0)),
    cleanupBufferMinutes: Number(r.cleanupBufferMinutes || RESTAURANT_CLEANUP_BUFFER_MINUTES),
    tableIds: parseJson(r.assignedTableIdsJson, []),
  }));
}

function restaurantReservationBlockEndMs(row) {
  const endMs = Number(row?.endMs || 0);
  const cleanupBufferMinutes = Number(row?.cleanupBufferMinutes || RESTAURANT_CLEANUP_BUFFER_MINUTES);
  return endMs + Math.max(0, cleanupBufferMinutes) * 60 * 1000;
}

async function restaurantAvailableTableIds(env, startMs, endMs, tablesNeeded, excludeId = null) {
  const allTables = await restaurantTables(env, false);
  const blockedRows = await restaurantBlockingRows(env, startMs, endMs, excludeId);
  const blocked = new Set();
  let anonymousReservedCount = 0;
  blockedRows.forEach((r) => {
    (r.tableIds || []).forEach((id) => blocked.add(id));
    anonymousReservedCount += Math.max(0, Number(r.tablesCount || 0) - Number((r.tableIds || []).length || 0));
  });
  const free = allTables
    .filter((t) => !blocked.has(t.id))
    .map((t) => t.id)
    .slice(Math.max(0, anonymousReservedCount));
  return free.slice(0, Math.max(0, Number(tablesNeeded || 1)));
}

function restaurantWindowWithinDay(dayWindow, startTime, durationHours) {
  const startMinutes = toInt(startTime.slice(0, 2), 0) * 60 + toInt(startTime.slice(3, 5), 0);
  const endMinutes = startMinutes + Math.round(Number(durationHours || 0) * 60);
  if (startMinutes < dayWindow.openMinutes || endMinutes > dayWindow.closeMinutes) {
    throw new Error(`Rezerwacje tylko w godzinach ${dayWindow.openLabel}-${dayWindow.closeLabel}.`);
  }
  return { startMinutes, endMinutes };
}

function restaurantFreeTableCount(blockingRows, startMs, endMs, allTableIds) {
  const blocked = new Set();
  let anonymousReservedCount = 0;
  for (const row of blockingRows || []) {
    if (!(startMs < restaurantReservationBlockEndMs(row) && endMs > Number(row.startMs || 0))) {
      continue;
    }
    for (const tableId of row.tableIds || []) {
      blocked.add(tableId);
    }
    anonymousReservedCount += Math.max(0, Number(row.tablesCount || 0) - Number((row.tableIds || []).length || 0));
  }
  return Math.max(0, allTableIds.length - blocked.size - anonymousReservedCount);
}

async function restaurantAvailabilityForSlot(env, settings, allTables, payload, excludeId = null, slotOptions = {}) {
  const reservationDate = cleanString(payload.reservationDate, 10);
  const startTime = cleanString(payload.startTime, 5);
  const durationHours = Number(payload.durationHours || 2);
  const tablesCount = Math.max(1, toInt(payload.tablesCount, 1));
  const skipPublicBookingRules = Boolean(slotOptions.skipPublicBookingRules);
  if (!isYmd(reservationDate) || !isHm(startTime)) {
    throw new Error("Nieprawidłowa data lub godzina.");
  }
  const today = todayYmdInWarsaw();
  const maxRestaurantDate = addMonthsYmd(today, 1);
  if (!skipPublicBookingRules && reservationDate > maxRestaurantDate) {
    throw new Error("Rezerwację stolika można złożyć maksymalnie na miesiąc do przodu.");
  }
  if (!Number.isFinite(durationHours) || durationHours <= 0) {
    throw new Error("Nieprawidłowy czas trwania.");
  }
  const dayWindow = await resolveRestaurantWindowForDate(env, settings, reservationDate);
  if (!skipPublicBookingRules) {
    if (dayWindow.closed) {
      throw new Error("Restauracja jest nieczynna w wybranym dniu.");
    }
    assertRestaurantStartLeadTime(reservationDate, startTime);
    restaurantWindowWithinDay(dayWindow, startTime, durationHours);
  }
  const startMs = ymdHmToMs(reservationDate, startTime);
  const endMs = startMs + durationHours * 3600000;
  const availableIds = await restaurantAvailableTableIds(env, startMs, endMs, tablesCount, excludeId);
  const ok = availableIds.length >= tablesCount;
  return {
    ok,
    availableIds,
    startMs,
    endMs,
    settings,
    reservationDate,
    startTime,
    durationHours,
    tablesCount,
    dayWindow,
    totalTableCount: allTables.length,
  };
}

async function restaurantAvailableSlotsForDate(env, options) {
  const settings = options?.settings || (await loadRestaurantSettings(env));
  const allTables = Array.isArray(options?.tables) ? options.tables : await restaurantTables(env, false);
  const reservationDate = cleanString(options?.reservationDate, 10);
  const durationHours = Number(options?.durationHours || 2);
  const tablesCount = Math.max(1, toInt(options?.tablesCount, 1));
  const excludeId = cleanString(options?.excludeId, 80) || null;
  if (!isYmd(reservationDate)) {
    throw new Error("Nieprawidłowa data.");
  }
  if (!Number.isFinite(durationHours) || durationHours <= 0) {
    throw new Error("Nieprawidłowy czas trwania.");
  }
  const dayWindow = await resolveRestaurantWindowForDate(
    env,
    settings,
    reservationDate,
    options?.preloadedOpeningHours
  );
  if (dayWindow.closed) {
    return {
      reservationDate,
      closed: true,
      available: false,
      slots: [],
      firstTime: "",
      reservationOpenTime: "",
      reservationCloseTime: "",
    };
  }
  if (!allTables.length || tablesCount > allTables.length) {
    return {
      reservationDate,
      closed: false,
      available: false,
      slots: [],
      firstTime: "",
      reservationOpenTime: dayWindow.openLabel,
      reservationCloseTime: dayWindow.closeLabel,
    };
  }
  const rawSlots = buildTimeSlotsFromMinutes(dayWindow.openMinutes, dayWindow.closeMinutes, settings.timeSlotMinutes).filter((slot) => {
    try {
      assertRestaurantStartLeadTime(reservationDate, slot);
      restaurantWindowWithinDay(dayWindow, slot, durationHours);
      return true;
    } catch {
      return false;
    }
  });
  if (!rawSlots.length) {
    return {
      reservationDate,
      closed: false,
      available: false,
      slots: [],
      firstTime: "",
      reservationOpenTime: dayWindow.openLabel,
      reservationCloseTime: dayWindow.closeLabel,
    };
  }
  const queryStartMs = ymdHmToMs(reservationDate, rawSlots[0]);
  const queryEndMs = ymdHmToMs(reservationDate, rawSlots[rawSlots.length - 1]) + durationHours * 3600000;
  let blockingRows;
  if (options?.globalBlockingRows != null) {
    blockingRows = options.globalBlockingRows;
    if (excludeId) {
      blockingRows = blockingRows.filter((r) => r.id !== excludeId);
    }
  } else {
    blockingRows = await restaurantBlockingRows(env, queryStartMs, queryEndMs, excludeId);
  }
  const allTableIds = allTables.map((table) => table.id);
  const slots = rawSlots.filter((slot) => {
    const startMs = ymdHmToMs(reservationDate, slot);
    const endMs = startMs + durationHours * 3600000;
    return restaurantFreeTableCount(blockingRows, startMs, endMs, allTableIds) >= tablesCount;
  });
  return {
    reservationDate,
    closed: false,
    available: slots.length > 0,
    slots,
    firstTime: slots[0] || "",
    reservationOpenTime: dayWindow.openLabel,
    reservationCloseTime: dayWindow.closeLabel,
  };
}

async function restaurantCalendarAvailability(env, payload = {}) {
  const settings = await loadRestaurantSettings(env);
  const tables = await restaurantTables(env, false);
  const openingHours = await loadCompanyOpeningHours(env);
  const requestedDate = cleanString(payload.reservationDate, 10);
  const startDateRaw = cleanString(payload.startDate, 10);
  const today = todayYmdInWarsaw();
  const startDate = isYmd(startDateRaw) && startDateRaw >= today ? startDateRaw : today;
  const durationHours = Number(payload.durationHours || 2);
  const tablesCount = Math.max(1, toInt(payload.tablesCount, 1));
  const maxRestaurantDate = addMonthsYmd(today, 1);
  const requestedWindowEnd = addDaysYmd(startDate, RESTAURANT_PUBLIC_CALENDAR_DAYS - 1);
  const lastCalendarDay = requestedWindowEnd > maxRestaurantDate ? maxRestaurantDate : requestedWindowEnd;
  const calendarDays = Math.max(1, nightsCount(startDate, addOneDayYmd(lastCalendarDay)));
  const durationMs = Math.ceil(Math.max(Number(durationHours) || 2, 1)) * 3600000;
  const globalStartMs = ymdHmToMs(startDate, "00:00");
  const globalEndMs = ymdHmToMs(addDaysYmd(lastCalendarDay, 1), "23:59") + durationMs;
  const globalBlockingRows = await restaurantBlockingRows(env, globalStartMs, globalEndMs, null);
  const slotOpts = {
    settings,
    tables,
    durationHours,
    tablesCount,
    preloadedOpeningHours: openingHours,
    globalBlockingRows,
  };
  const dayTasks = [];
  for (let offset = 0; offset < calendarDays; offset += 1) {
    const currentDate = addDaysYmd(startDate, offset);
    dayTasks.push(restaurantAvailableSlotsForDate(env, { ...slotOpts, reservationDate: currentDate }));
  }
  const days = await Promise.all(dayTasks);
  let firstAvailableDate = "";
  let firstAvailableTime = "";
  for (const day of days) {
    if (!firstAvailableDate && day.available) {
      firstAvailableDate = day.reservationDate;
      firstAvailableTime = day.firstTime || "";
    }
  }
  const requestedAvailable = days.find((day) => day.reservationDate === requestedDate && day.available);
  const selectedDay =
    requestedAvailable ||
    days.find((day) => day.reservationDate === firstAvailableDate) ||
    days.find((day) => day.reservationDate === requestedDate) ||
    days[0] ||
    null;
  return {
    maxGuestsPerTable: Number(settings.maxGuestsPerTable || 4),
    tableCount: tables.length,
    timeSlotMinutes: Number(settings.timeSlotMinutes || 30),
    restaurantName: "Średzka Korona — Restauracja",
    selectedDate: selectedDay?.reservationDate || requestedDate || startDate,
    selectedSlots: Array.isArray(selectedDay?.slots) ? selectedDay.slots : [],
    firstAvailableDate,
    firstAvailableTime,
    days,
  };
}

async function assertRestaurantAvailability(env, payload, excludeId = null, options = {}) {
  const settings = await loadRestaurantSettings(env);
  const allTables = await restaurantTables(env, false);
  return restaurantAvailabilityForSlot(env, settings, allTables, payload, excludeId, options);
}

const RESTAURANT_PLACE_PREFS = new Set(["no_preference", "inside", "terrace"]);

function normalizeRestaurantPlacePreference(value) {
  const v = cleanString(value, 30);
  return RESTAURANT_PLACE_PREFS.has(v) ? v : "no_preference";
}

function restaurantPlacePreferenceLabel(pref) {
  const p = normalizeRestaurantPlacePreference(pref);
  if (p === "inside") return "W lokalu";
  if (p === "terrace") return "Na tarasie";
  return "Bez preferencji";
}

function mapRestaurantReservation(row, tableMap, recipientRow = null) {
  const ids = parseJson(row.assigned_table_ids_json, []);
  const labels = ids
    .map((id) => {
      const t = tableMap.get(id);
      return t ? `${t.number} (${t.zone || "sala"})` : id;
    })
    .join(", ");
  const recipient = row.recipient_id ? mapCateringRecipientApi(recipientRow) : null;
  return {
    id: row.id,
    humanNumber: row.human_number,
    humanYear: row.human_year != null ? Number(row.human_year) : null,
    humanSlug: row.human_slug || "",
    humanNumberLabel: formatHumanReservationNumber(row, "restaurant"),
    fullName: row.full_name,
    email: row.email,
    phonePrefix: row.phone_prefix || "",
    phoneNational: row.phone_national || "",
    phone: `${row.phone_prefix || ""} ${row.phone_national || ""}`.trim(),
    status: row.status,
    statusLabel: statusLabel(row.status),
    reservationDate: row.reservation_date,
    startTime: row.start_time || "",
    startDateTime: Number(row.start_ms || 0),
    endDateTime: Number(row.end_ms || 0),
    durationHours: Number(row.duration_hours || 0),
    tablesCount: Number(row.tables_count || 0),
    assignedTableIds: ids,
    assignedTablesLabel: labels,
    guestsCount: Number(row.guests_count || 0),
    joinTables: Boolean(row.join_tables),
    placePreference: normalizeRestaurantPlacePreference(row.place_preference),
    customerNote: row.customer_note || "",
    adminNote: row.admin_note || "",
    pendingExpiresAt: row.pending_expires_at || null,
    emailVerificationExpiresAt: row.email_verification_expires_at || null,
    createdAtMs: Number(row.created_at || 0),
    cleanupBufferMinutes: Number(row.cleanup_buffer_minutes || 30),
    cateringDelivery: Boolean(Number(row.catering_delivery)),
    recipientId: row.recipient_id || null,
    recipient,
  };
}

async function createRestaurantReservation(env, payload, options = {}) {
  const now = nowMs();
  const cateringDelivery = Boolean(options.cateringDelivery);
  if (cateringDelivery) {
    options.skipAvailabilityCheck = true;
    options.skipPublicBookingRules = true;
    if (payload.tablesCount == null) payload.tablesCount = 1;
    if (payload.guestsCount == null) payload.guestsCount = 1;
  }
  let availability;
  if (options.skipAvailabilityCheck) {
    const reservationDate = cleanString(payload.reservationDate, 10);
    const startTime = cleanString(payload.startTime, 5);
    const durationHours = Number(payload.durationHours || 2);
    const tablesCount = Math.max(1, toInt(payload.tablesCount, 1));
    if (!isYmd(reservationDate) || !isHm(startTime)) {
      throw new Error("Nieprawidłowa data lub godzina.");
    }
    if (!Number.isFinite(durationHours) || durationHours <= 0) {
      throw new Error("Nieprawidłowy czas trwania.");
    }
    const startMs = ymdHmToMs(reservationDate, startTime);
    const endMs = startMs + durationHours * 3600000;
    availability = {
      ok: true,
      availableIds: [],
      startMs,
      endMs,
      settings: await loadRestaurantSettings(env),
      reservationDate,
      startTime,
      durationHours,
      tablesCount,
      dayWindow: { closed: false },
    };
  } else {
    availability = await assertRestaurantAvailability(env, payload, options.excludeId || null, {
      skipPublicBookingRules: Boolean(options.skipPublicBookingRules),
    });
    if (!availability.ok) {
      throw new Error("Brak wolnych stolików w wybranym terminie.");
    }
  }
  const settings = availability.settings;
  const tablesCount = availability.tablesCount;
  const guestsCount = Math.max(1, toInt(payload.guestsCount, 1));
  const maxGuests = Math.max(1, toInt(settings.maxGuestsPerTable, 4)) * tablesCount;
  if (!cateringDelivery && guestsCount > maxGuests) {
    throw new Error(`Maksymalnie ${maxGuests} gości przy ${tablesCount} stolikach.`);
  }
  const id = crypto.randomUUID();
  let humanYear = yearFromMsWarsaw(now);
  let humanNumber;
  let humanSlug = "";
  let recipientIdForInsert = null;
  if (cateringDelivery) {
    const rec = await getCateringRecipientRow(env, cleanString(options.recipientId, 80));
    if (!rec) throw new Error("Nie znaleziono odbiorcy.");
    recipientIdForInsert = rec.id;
    humanNumber = 0;
    humanYear = yearFromMsWarsaw(availability.startMs);
    humanSlug = await allocateCateringHumanSlug(env, rec.display_name, humanYear);
    payload.fullName = rec.display_name;
    payload.email = rec.email;
    payload.phonePrefix = rec.phone_prefix;
    payload.phoneNational = rec.phone_national;
    payload.joinTables = false;
    payload.placePreference = "no_preference";
  } else {
    humanNumber = await nextHumanSequenceForYear(env, "restaurant", humanYear);
  }
  const phone = normalizePhone(payload.phonePrefix, payload.phoneNational);
  const token = options.withConfirmationToken ? randomToken() : "";
  const tokenHash = token ? await sha256Hex(token) : null;
  const status = options.status || "email_verification_pending";
  const assigned = cateringDelivery
    ? []
    : Array.isArray(options.assignedTableIds) && options.assignedTableIds.length
      ? options.assignedTableIds
      : Array.isArray(availability.availableIds)
        ? availability.availableIds.slice(0, tablesCount)
        : [];
  const emailExp = status === "email_verification_pending" ? now + EMAIL_LINK_MS : null;
  const pendingExp = status === "pending" ? now + RESTAURANT_PENDING_MS : null;
  const placePreference = normalizeRestaurantPlacePreference(payload.placePreference);
  await env.DB.prepare(
    `INSERT INTO restaurant_reservations (
      id, human_number, human_year, status, full_name, email, phone_prefix, phone_national, phone_e164,
      reservation_date, start_time, duration_hours, start_ms, end_ms, tables_count, guests_count, join_tables, place_preference,
      assigned_table_ids_json, customer_note, admin_note, cleanup_buffer_minutes,
      confirmation_token_hash, email_verification_expires_at, pending_expires_at, created_at, updated_at,
      recipient_id, catering_delivery, human_slug
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      humanNumber,
      humanYear,
      status,
      cleanString(payload.fullName, 120),
      cleanString(payload.email, 180).toLowerCase(),
      phone.prefix,
      phone.national,
      phone.e164,
      availability.reservationDate,
      availability.startTime,
      availability.durationHours,
      availability.startMs,
      availability.endMs,
      tablesCount,
      guestsCount,
      payload.joinTables ? 1 : 0,
      placePreference,
      toJson(assigned),
      cleanString(payload.customerNote, 2000),
      cleanString(payload.adminNote, 2000),
      30,
      tokenHash,
      emailExp,
      pendingExp,
      now,
      now,
      recipientIdForInsert,
      cateringDelivery ? 1 : 0,
      cleanString(cateringDelivery ? humanSlug : "", 80)
    )
    .run();
  return { id, humanNumber, humanSlug, token, availability };
}

async function venueHalls(env) {
  const out = await env.DB.prepare(
    "SELECT id, name, capacity, active, hall_kind AS hallKind, description, exclusive_rule AS exclusiveRule, buffer_minutes AS bufferMinutes, full_block_guest_threshold AS fullBlockGuestThreshold, sort_order AS sortOrder FROM venue_halls ORDER BY sort_order ASC, id ASC"
  ).all();
  return (out.results || []).map((h) => ({
    id: h.id,
    name: h.name,
    capacity: Number(h.capacity || 0),
    active: Boolean(h.active),
    hallKind: h.hallKind || "large",
    description: h.description || "",
    exclusiveRule: h.exclusiveRule || "optional",
    bufferMinutes: Number(h.bufferMinutes || 60),
    fullBlockGuestThreshold: Number(h.fullBlockGuestThreshold || 100),
    sortOrder: Number(h.sortOrder || 0),
  }));
}

function hallFullBlock(hall, guestsCount, exclusive) {
  const thr = Number(hall.fullBlockGuestThreshold || 100);
  return Boolean(exclusive) || Number(guestsCount || 0) >= thr;
}

async function hallReservationRows(env, hallId, excludeId = null) {
  const rows = await env.DB.prepare(
    `SELECT id, reservation_date AS reservationDate, guests_count AS guestsCount, exclusive, full_block AS fullBlock, start_ms AS startMs, end_ms AS endMs
     FROM venue_reservations
     WHERE hall_id = ?
       AND status IN ('email_verification_pending','pending','confirmed','manual_block')
       ${excludeId ? "AND id != ?" : ""}`
  )
    .bind(...(excludeId ? [hallId, excludeId] : [hallId]))
    .all();
  return (rows.results || []).map((row) => ({
    id: row.id,
    reservationDate: cleanString(row.reservationDate, 10),
    guestsCount: Number(row.guestsCount || 0),
    exclusive: Boolean(row.exclusive),
    fullBlock: Boolean(row.fullBlock),
    startMs: Number(row.startMs || 0),
    endMs: Number(row.endMs || 0),
  }));
}

function hallAvailabilityFromRows(hall, rows, payload) {
  const startMs = Number(payload.startMs || 0);
  const endMs = Number(payload.endMs || 0);
  const reservationDate = cleanString(payload.reservationDate, 10);
  const guestsCount = Math.max(0, toInt(payload.guestsCount, hall.hallKind === "small" ? 1 : 10));
  const exclusive = hall.hallKind === "small" ? true : Boolean(payload.exclusive);
  const fullBlock = hallFullBlock(hall, guestsCount, exclusive);
  let usedGuests = 0;
  for (const row of rows || []) {
    if (cleanString(row.reservationDate, 10) !== reservationDate) continue;
    const existingFull = Boolean(row.fullBlock) || Boolean(row.exclusive);
    if (hall.hallKind === "small") {
      return { ok: false, available: false, maxGuests: 0, hall, startMs, endMs, guestsCount, exclusive, fullBlock };
    }
    if (fullBlock || existingFull) {
      return { ok: false, available: false, maxGuests: 0, hall, startMs, endMs, guestsCount, exclusive, fullBlock };
    }
    usedGuests += Number(row.guestsCount || 0);
  }
  if (hall.hallKind === "small") {
    const max = Math.min(40, Number(hall.capacity || 40));
    return {
      ok: guestsCount > 0 && guestsCount <= max,
      available: guestsCount > 0 && guestsCount <= max,
      maxGuests: max,
      hall,
      startMs,
      endMs,
      guestsCount,
      exclusive: true,
      fullBlock: true,
    };
  }
  const maxGuests = Math.max(0, Number(hall.capacity || 0) - usedGuests);
  const available = fullBlock ? maxGuests > 0 : guestsCount <= maxGuests && maxGuests > 0;
  return { ok: available, available, maxGuests, hall, startMs, endMs, guestsCount, exclusive, fullBlock };
}

async function hallAvailabilityAtSlot(env, hall, payload, excludeId = null, options = {}) {
  const reservationDate = cleanString(payload.reservationDate, 10);
  const startTime = cleanString(payload.startTime, 5);
  const durationHours = Number(payload.durationHours || 2);
  const skipPublicBookingRules = Boolean(options.skipPublicBookingRules);
  if (!isYmd(reservationDate) || !isHm(startTime) || !Number.isFinite(durationHours) || durationHours <= 0) {
    throw new Error("Nieprawidłowa data lub godzina.");
  }
  assertHallStartSlotTime(startTime);
  const today = todayYmdInWarsaw();
  const maxHallDate = addYearsYmd(today, 3);
  if (!skipPublicBookingRules && reservationDate > maxHallDate) {
    throw new Error("Rezerwację sali można złożyć maksymalnie na 3 lata do przodu.");
  }
  if (!skipPublicBookingRules && reservationDate < today) {
    throw new Error("Nie można rezerwować terminu z przeszłości.");
  }
  const startMs = ymdHmToMsWarsaw(reservationDate, startTime);
  const endMs = startMs + durationHours * 3600000;
  if (!Number.isFinite(startMs)) throw new Error("Nieprawidłowa data lub godzina.");
  const rows = Array.isArray(options.rows) ? options.rows : await hallReservationRows(env, hall.id, excludeId);
  return hallAvailabilityFromRows(hall, rows, {
    ...payload,
    startMs,
    endMs,
  });
}

function dayCapacityForSmallHall(hall, rows, reservationDate) {
  const capacity = Math.min(40, Number(hall?.capacity || 40));
  const hasBlocking = (rows || []).some((row) => cleanString(row.reservationDate, 10) === reservationDate);
  return hasBlocking ? 0 : capacity;
}

function dayCapacityForLargeHall(hall, rows, reservationDate) {
  const capacity = Math.max(0, Number(hall?.capacity || 120));
  let usedGuests = 0;
  for (const row of rows || []) {
    if (cleanString(row.reservationDate, 10) !== reservationDate) continue;
    if (Boolean(row.fullBlock) || Boolean(row.exclusive)) {
      return 0;
    }
    usedGuests += Math.max(0, Number(row.guestsCount || 0));
  }
  return Math.max(0, capacity - usedGuests);
}

function pickSmallHall(halls) {
  return (
    (halls || []).find((hall) => hall.hallKind === "small") ||
    (halls || []).find((hall) => Number(hall.capacity || 0) <= 40) ||
    null
  );
}

function pickLargeHall(halls) {
  return (
    (halls || []).find((hall) => hall.hallKind === "large") ||
    (halls || [])
      .filter((hall) => Number(hall.capacity || 0) > 40)
      .sort((a, b) => Number(b.capacity || 0) - Number(a.capacity || 0))[0] ||
    null
  );
}

async function hallCalendarAvailability(env, payload = {}) {
  const halls = (await venueHalls(env)).filter((hall) => hall.active);
  const requestedDate = cleanString(payload.reservationDate, 10);
  const startDateRaw = cleanString(payload.startDate, 10);
  const today = todayYmdInWarsaw();
  const startDate = isYmd(startDateRaw) && startDateRaw >= today ? startDateRaw : today;
  const durationHours = Number(payload.durationHours || 4);
  const guestsCount = Math.max(1, toInt(payload.guestsCount, 10));
  const rowsByHallId = new Map();
  await Promise.all(
    halls.map(async (hall) => {
      rowsByHallId.set(hall.id, await hallReservationRows(env, hall.id, null));
    })
  );
  const days = [];
  let firstAvailableDate = "";
  const smallHall = pickSmallHall(halls);
  const largeHall = pickLargeHall(halls);
  const maxHallDate = addYearsYmd(today, 3);
  const requestedWindowEnd = addDaysYmd(startDate, HALL_PUBLIC_CALENDAR_DAYS - 1);
  const lastCalendarDay = requestedWindowEnd > maxHallDate ? maxHallDate : requestedWindowEnd;
  const calendarDays = Math.max(1, nightsCount(startDate, addOneDayYmd(lastCalendarDay)));
  for (let offset = 0; offset < calendarDays; offset += 1) {
    const reservationDate = addDaysYmd(startDate, offset);
    const smallRemaining = smallHall
      ? dayCapacityForSmallHall(smallHall, rowsByHallId.get(smallHall.id) || [], reservationDate)
      : 0;
    const largeRemaining = largeHall
      ? dayCapacityForLargeHall(largeHall, rowsByHallId.get(largeHall.id) || [], reservationDate)
      : 0;
    const smallFits = smallRemaining > 0 && guestsCount <= smallRemaining;
    const largeFits = largeRemaining > 0 && guestsCount <= largeRemaining;
    const dayAvailable = smallFits || largeFits;
    const day = {
      reservationDate,
      closed: false,
      available: dayAvailable,
      slots: [],
      firstTime: "",
      smallRemaining,
      largeRemaining,
    };
    days.push(day);
    if (!firstAvailableDate && day.available) {
      firstAvailableDate = reservationDate;
    }
  }
  const requestedAvailable = days.find((day) => day.reservationDate === requestedDate && day.available);
  const selectedDay =
    requestedAvailable ||
    days.find((day) => day.reservationDate === firstAvailableDate) ||
    days.find((day) => day.reservationDate === requestedDate) ||
    days[0] ||
    null;
  return {
    selectedDate: selectedDay?.reservationDate || requestedDate || startDate,
    selectedSlots: [],
    firstAvailableDate,
    firstAvailableTime: "",
    days,
  };
}

async function hallAvailability(env, payload, excludeId = null, options = {}) {
  const halls = await venueHalls(env);
  const hall = halls.find((h) => h.id === cleanString(payload.hallId, 80) && h.active);
  if (!hall) throw new Error("Sala niedostępna.");
  return hallAvailabilityAtSlot(env, hall, payload, excludeId, options);
}

async function createHallReservation(env, payload, options = {}) {
  const now = nowMs();
  let avail;
  if (options.skipAvailabilityCheck) {
    const halls = await venueHalls(env);
    const hall = halls.find((entry) => entry.id === cleanString(payload.hallId, 80));
    if (!hall) {
      throw new Error("Sala niedostępna.");
    }
    const reservationDate = cleanString(payload.reservationDate, 10);
    const startTime = cleanString(payload.startTime, 5);
    const durationHours = Number(payload.durationHours || 2);
    if (!isYmd(reservationDate) || !isHm(startTime) || !Number.isFinite(durationHours) || durationHours <= 0) {
      throw new Error("Nieprawidłowa data lub godzina.");
    }
    assertHallStartSlotTime(startTime);
    const startMs = ymdHmToMsWarsaw(reservationDate, startTime);
    const endMs = startMs + durationHours * 3600000;
    const guestsCount = Math.max(0, toInt(payload.guestsCount, hall.hallKind === "small" ? 1 : 10));
    const exclusive = hall.hallKind === "small" ? true : Boolean(payload.exclusive);
    const fullBlock = hallFullBlock(hall, guestsCount, exclusive);
    avail = { ok: true, hall, startMs, endMs, guestsCount, exclusive, fullBlock };
  } else {
    avail = await hallAvailability(env, payload, options.excludeId || null, {
      skipMinAdvance: Boolean(options.skipMinAdvance),
      skipPublicBookingRules: Boolean(options.skipPublicBookingRules),
    });
    if (!avail.ok) {
      throw new Error("Termin niedostępny.");
    }
  }
  const id = crypto.randomUUID();
  const humanYear = yearFromMsWarsaw(now);
  const humanNumber = await nextHumanSequenceForYear(env, "hall", humanYear);
  const phone = normalizePhone(payload.phonePrefix, payload.phoneNational);
  const token = options.withConfirmationToken ? randomToken() : "";
  const tokenHash = token ? await sha256Hex(token) : null;
  const status = options.status || "email_verification_pending";
  const emailExp = status === "email_verification_pending" ? now + EMAIL_LINK_MS : null;
  const pendingExp = status === "pending" ? now + HALL_PENDING_MS : null;
  await env.DB.prepare(
    `INSERT INTO venue_reservations (
      id, human_number, human_year, status, hall_id, hall_name_snapshot, hall_kind_snapshot, full_block_guest_threshold_snap,
      full_name, email, phone_prefix, phone_national, phone_e164,
      reservation_date, start_time, duration_hours, start_ms, end_ms, start_time_label, end_time_label,
      guests_count, exclusive, full_block, event_type, customer_note, admin_note,
      confirmation_token_hash, email_verification_expires_at, pending_expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      humanNumber,
      humanYear,
      status,
      avail.hall.id,
      avail.hall.name,
      avail.hall.hallKind,
      avail.hall.fullBlockGuestThreshold,
      cleanString(payload.fullName, 120),
      cleanString(payload.email, 180).toLowerCase(),
      phone.prefix,
      phone.national,
      phone.e164,
      cleanString(payload.reservationDate, 10),
      cleanString(payload.startTime, 5),
      Number(payload.durationHours || 2),
      avail.startMs,
      avail.endMs,
      formatHm(avail.startMs),
      formatHm(avail.endMs),
      Number(avail.guestsCount || 0),
      avail.exclusive ? 1 : 0,
      avail.fullBlock ? 1 : 0,
      cleanString(payload.eventType, 500),
      cleanString(payload.customerNote, 2000),
      cleanString(payload.adminNote, 2000),
      tokenHash,
      emailExp,
      pendingExp,
      now,
      now
    )
    .run();
  return { id, humanNumber, token, avail };
}

function mapHallReservation(row, hallMap) {
  const hall = hallMap.get(row.hall_id) || null;
  const threshold = Number(row.full_block_guest_threshold_snap || hall?.fullBlockGuestThreshold || 100);
  const fullBlock = Boolean(row.full_block) || Boolean(row.exclusive) || Number(row.guests_count || 0) >= threshold;
  const sharedLarge = (row.hall_kind_snapshot || hall?.hallKind) === "large" && !fullBlock;
  const pendingExp = row.pending_expires_at || null;
  let extendAvailable = false;
  if (row.status === "pending" && pendingExp) {
    const left = Number(pendingExp) - nowMs();
    extendAvailable = left <= HALL_EXTEND_THRESHOLD_MS && left > 0;
  }
  return {
    id: row.id,
    humanNumber: row.human_number,
    humanYear: row.human_year != null ? Number(row.human_year) : null,
    humanNumberLabel: formatHumanReservationNumber(row, "hall"),
    phonePrefix: row.phone_prefix || "",
    phoneNational: row.phone_national || "",
    hallId: row.hall_id,
    hallName: row.hall_name_snapshot || hall?.name || row.hall_id,
    hallKindSnapshot: row.hall_kind_snapshot,
    fullName: row.full_name,
    email: row.email,
    phone: `${row.phone_prefix || ""} ${row.phone_national || ""}`.trim(),
    status: row.status,
    statusLabel: statusLabel(row.status),
    reservationDate: row.reservation_date,
    startTime: row.start_time,
    durationHours: Number(row.duration_hours || 0),
    startDateTime: Number(row.start_ms || 0),
    endDateTime: Number(row.end_ms || 0),
    guestsCount: Number(row.guests_count || 0),
    exclusive: Boolean(row.exclusive),
    fullBlock,
    sharedLarge,
    eventType: row.event_type || "",
    customerNote: row.customer_note || "",
    adminNote: row.admin_note || "",
    pendingExpiresAt: pendingExp,
    emailVerificationExpiresAt: row.email_verification_expires_at || null,
    extendAvailable,
    createdAtMs: Number(row.created_at || 0),
    blockStartMs: null,
    blockEndMs: null,
  };
}

function legacyDefaultTemplateMap(service) {
  if (service === "hotel") {
    return {
      confirm_email: {
        subject: "{{hotelName}} | potwierdzenie adresu e-mail dla rezerwacji {{reservationNumber}}",
        bodyHtml:
          '<p>Dzien dobry {{fullName}},</p><p>Dziekujemy za wyslanie zapytania rezerwacyjnego do <strong>{{hotelName}}</strong>.</p><p>Aby przekazac zgloszenie do dalszej obslugi, potwierdz adres e-mail:</p><p><a href="{{confirmationLink}}">Potwierdz adres e-mail</a></p><p>Numer rezerwacji: <strong>{{reservationNumber}}</strong><br>Termin pobytu: {{dateFrom}} - {{dateTo}}<br>Zameldowanie: od 14:00, wymeldowanie: do 11:00<br>Pokoje: {{roomsList}}<br>Szacunkowa kwota: {{totalPrice}} PLN</p><p>Jesli to nie Ty wysylales zgloszenie, zignoruj te wiadomosc.</p><p>Pozdrawiamy,<br>Recepcja {{hotelName}}</p>',
      },
      pending_admin: {
        subject: "[{{hotelName}}] Rezerwacja do decyzji: {{reservationNumber}}",
        bodyHtml:
          "<p>W panelu pojawila sie nowa rezerwacja oczekujaca na akceptacje.</p><p>Numer: <strong>{{reservationNumber}}</strong><br>Dotyczy: {{reservationSubject}}<br>Decyzja do: {{decisionDeadline}}<br>Klient: {{fullName}}<br>E-mail: {{email}}<br>Telefon: {{phone}}<br>Termin: {{dateFrom}} - {{dateTo}}<br>Pokoje: {{roomsList}}<br>Kwota orientacyjna: {{totalPrice}} PLN</p><p>Uwagi klienta: {{customerNote}}</p>",
      },
      confirmed_client: {
        subject: "{{hotelName}} | rezerwacja {{reservationNumber}} potwierdzona",
        bodyHtml:
          "<p>Dzien dobry {{fullName}},</p><p>Potwierdzamy rezerwacje o numerze <strong>{{reservationNumber}}</strong>.</p><p>Termin pobytu: {{dateFrom}} - {{dateTo}}<br>Zameldowanie: od 14:00, wymeldowanie: do 11:00<br>Liczba noclegow: {{nights}}<br>Pokoje: {{roomsList}}<br>Kwota orientacyjna: {{totalPrice}} PLN</p><p>W razie pytan mozesz odpowiedziec na te wiadomosc lub skontaktowac sie bezposrednio z recepcja.</p><p>Pozdrawiamy,<br>Recepcja {{hotelName}}</p>",
      },
      cancelled_client: {
        subject: "{{hotelName}} | anulowanie rezerwacji {{reservationNumber}}",
        bodyHtml:
          "<p>Dzien dobry {{fullName}},</p><p>Informujemy, ze rezerwacja o numerze <strong>{{reservationNumber}}</strong> zostala anulowana.</p><p>Termin pobytu: {{dateFrom}} - {{dateTo}}<br>Pokoje: {{roomsList}}</p><p>Jesli potrzebujesz pomocy przy nowej rezerwacji, skontaktuj sie z recepcja.</p><p>Pozdrawiamy,<br>Recepcja {{hotelName}}</p>",
      },
      changed_client: {
        subject: "{{hotelName}} | zmiana rezerwacji {{reservationNumber}}",
        bodyHtml:
          "<p>Dzien dobry {{fullName}},</p><p>Wprowadzilismy zmiany w rezerwacji o numerze <strong>{{reservationNumber}}</strong>.</p><p>Aktualny termin pobytu: {{dateFrom}} - {{dateTo}}<br>Zameldowanie: od 14:00, wymeldowanie: do 11:00<br>Liczba noclegow: {{nights}}<br>Pokoje: {{roomsList}}<br>Kwota orientacyjna: {{totalPrice}} PLN</p><p>Uwagi do rezerwacji: {{customerNote}}</p><p>Jesli chcesz cos doprecyzowac, odpowiedz na te wiadomosc lub skontaktuj sie z recepcja.</p><p>Pozdrawiamy,<br>Recepcja {{hotelName}}</p>",
      },
    };
  }
  if (service === "restaurant") {
    return {
      restaurant_confirm_email: {
        subject: "{{restaurantName}} — potwierdź rezerwację stolika ({{reservationNumber}})",
        bodyHtml:
          '<p>Dzien dobry {{fullName}},</p><p>Dziekujemy za wyslanie rezerwacji stolika do {{restaurantName}}.</p><p>Aby przekazac zgloszenie do obslugi, potwierdz adres e-mail:</p><p><a href="{{confirmationLink}}">Potwierdz rezerwacje</a></p><p>Numer rezerwacji: <strong>{{reservationNumber}}</strong><br>{{date}} · {{timeFrom}}–{{timeTo}} ({{durationHours}} h)<br>Gosci: {{guestsCount}}</p><p>{{tablesList}}</p><p>Pozdrawiamy,<br>{{restaurantName}}</p>',
      },
      restaurant_pending_admin: {
        subject: "[{{restaurantName}}] Nowa rezerwacja stolika {{reservationNumber}}",
        bodyHtml:
          "<p>Nowa rezerwacja stolika oczekuje na decyzje obslugi.</p><p>Dotyczy: {{reservationSubject}}<br>Decyzja do: {{decisionDeadline}}</p><p>{{fullName}} · {{email}} · {{phone}}</p><p>{{date}} · {{timeFrom}}–{{timeTo}} ({{durationHours}} h)</p><p>{{tablesList}} · Gosci: {{guestsCount}} · Laczenie: {{joinTables}} · Miejsce: {{placePreference}}</p><p>Uwagi klienta: {{customerNote}}</p>",
      },
      restaurant_confirmed_client: {
        subject: "{{restaurantName}} — rezerwacja potwierdzona ({{reservationNumber}})",
        bodyHtml:
          "<p>Dzien dobry {{fullName}},</p><p>Potwierdzamy rezerwacje stolika o numerze <strong>{{reservationNumber}}</strong>.</p><p>{{date}} · {{timeFrom}}–{{timeTo}}</p><p>{{tablesList}}</p><p>W przypadku spoznienia lub potrzeby zmiany godziny prosimy o wczesniejszy kontakt z restauracja.</p><p>Pozdrawiamy,<br>{{restaurantName}}</p>",
      },
      restaurant_cancelled_client: {
        subject: "{{restaurantName}} — rezerwacja anulowana ({{reservationNumber}})",
        bodyHtml:
          "<p>Dzien dobry {{fullName}},</p><p>Rezerwacja stolika <strong>{{reservationNumber}}</strong> zostala anulowana.</p><p>Termin: {{date}} · {{timeFrom}}–{{timeTo}}</p><p>Jesli chcesz zarezerwowac inny termin, zapraszamy do ponownego kontaktu.</p><p>Pozdrawiamy,<br>{{restaurantName}}</p>",
      },
      rest_confirm_email: {
        subject: "{{restaurantName}} — potwierdź rezerwację stolika ({{reservationNumber}})",
        bodyHtml:
          '<p>Dzien dobry {{fullName}},</p><p>Dziekujemy za wyslanie rezerwacji stolika do {{restaurantName}}.</p><p>Aby przekazac zgloszenie do obslugi, potwierdz adres e-mail:</p><p><a href="{{confirmationLink}}">Potwierdz rezerwacje</a></p><p>Numer rezerwacji: <strong>{{reservationNumber}}</strong><br>{{date}} · {{timeFrom}}–{{timeTo}} ({{durationHours}} h)<br>Gosci: {{guestsCount}}</p><p>{{tablesList}}</p><p>Pozdrawiamy,<br>{{restaurantName}}</p>',
      },
      rest_pending_admin: {
        subject: "[{{restaurantName}}] Nowa rezerwacja stolika {{reservationNumber}}",
        bodyHtml:
          "<p>Nowa rezerwacja stolika oczekuje na decyzje obslugi.</p><p>Dotyczy: {{reservationSubject}}<br>Decyzja do: {{decisionDeadline}}</p><p>{{fullName}} · {{email}} · {{phone}}</p><p>{{date}} · {{timeFrom}}–{{timeTo}} ({{durationHours}} h)</p><p>{{tablesList}} · Gosci: {{guestsCount}} · Laczenie: {{joinTables}} · Miejsce: {{placePreference}}</p><p>Uwagi klienta: {{customerNote}}</p>",
      },
      rest_confirmed_client: {
        subject: "{{restaurantName}} — rezerwacja potwierdzona ({{reservationNumber}})",
        bodyHtml:
          "<p>Dzien dobry {{fullName}},</p><p>Potwierdzamy rezerwacje stolika o numerze <strong>{{reservationNumber}}</strong>.</p><p>{{date}} · {{timeFrom}}–{{timeTo}}</p><p>{{tablesList}}</p><p>Pozdrawiamy,<br>{{restaurantName}}</p>",
      },
      rest_cancelled_client: {
        subject: "{{restaurantName}} — rezerwacja anulowana ({{reservationNumber}})",
        bodyHtml:
          "<p>Dzien dobry {{fullName}},</p><p>Rezerwacja stolika <strong>{{reservationNumber}}</strong> zostala anulowana.</p><p>Termin: {{date}} · {{timeFrom}}–{{timeTo}}</p><p>Pozdrawiamy,<br>{{restaurantName}}</p>",
      },
      restaurant_changed_client: {
        subject: "{{restaurantName}} — zmiana rezerwacji stolika {{reservationNumber}}",
        bodyHtml:
          "<p>Dzien dobry {{fullName}},</p><p>Zaktualizowalismy rezerwacje <strong>{{reservationNumber}}</strong>.</p><p>Data: {{date}}<br>Godziny: {{timeFrom}}–{{timeTo}} ({{durationHours}} h)<br>Stoliki: {{tablesList}}<br>Liczba gosci: {{guestsCount}}<br>Laczenie stolikow: {{joinTables}}<br>Preferencja miejsca: {{placePreference}}</p><p>Uwagi do rezerwacji: {{customerNote}}</p><p>W razie pytan odpowiedz na te wiadomosc.</p><p>Pozdrawiamy,<br>{{restaurantName}}</p>",
      },
      rest_changed_client: {
        subject: "{{restaurantName}} — zmiana rezerwacji stolika {{reservationNumber}}",
        bodyHtml:
          "<p>Dzien dobry {{fullName}},</p><p>Zaktualizowalismy rezerwacje <strong>{{reservationNumber}}</strong>.</p><p>Data: {{date}} · {{timeFrom}}–{{timeTo}}<br>Gosci: {{guestsCount}}</p><p>{{tablesList}}</p><p>Pozdrawiamy,<br>{{restaurantName}}</p>",
      },
    };
  }
  return {
    hall_confirm_email: {
      subject: "{{venueName}} — potwierdź zgłoszenie rezerwacji sali ({{reservationNumber}})",
      bodyHtml:
        '<p>Dzien dobry {{fullName}},</p><p>Dziekujemy za przeslanie zgloszenia rezerwacji sali do {{venueName}}.</p><p>To jest zgloszenie rezerwacyjne, a wycena zostanie ustalona indywidualnie po kontakcie z obiektem.</p><p>Aby potwierdzic zgloszenie, kliknij w link:</p><p><a href="{{confirmationLink}}">Potwierdz zgloszenie</a></p><p>Numer: <strong>{{reservationNumber}}</strong><br>Sala: {{hallName}}<br>{{date}} · {{timeFrom}}–{{timeTo}} ({{durationHours}} h)<br>Gosci: {{guestsCount}} · {{eventType}}<br>Wylacznosc: {{exclusive}}</p><p>Pozdrawiamy,<br>{{venueName}}</p>',
    },
    hall_pending_admin: {
      subject: "[{{venueName}}] Nowe zgłoszenie sali {{reservationNumber}}",
      bodyHtml:
        "<p>Nowe zgloszenie rezerwacji sali oczekuje na decyzje obslugi.</p><p>Dotyczy: {{reservationSubject}}<br>Decyzja do: {{decisionDeadline}}</p><p>{{fullName}} · {{email}} · {{phone}}</p><p>Numer: {{reservationNumber}}</p><p>Sala: {{hallName}} · {{date}} · {{timeFrom}}–{{timeTo}} ({{durationHours}} h)</p><p>Gosci: {{guestsCount}} · Wylacznosc: {{exclusive}} · 100+: {{fullBlockLabel}}</p><p>Rodzaj imprezy: {{eventType}}</p><p>Uwagi klienta: {{customerNote}}</p>",
    },
    hall_confirmed_client: {
      subject: "{{venueName}} — rezerwacja sali potwierdzona ({{reservationNumber}})",
      bodyHtml:
        "<p>Dzien dobry {{fullName}},</p><p>Potwierdzamy rezerwacje sali <strong>{{hallName}}</strong> o numerze <strong>{{reservationNumber}}</strong>.</p><p>Termin: {{date}} · {{timeFrom}}–{{timeTo}}</p><p>Szczegoly i wycena - zgodnie z ustaleniami z obsluga obiektu.</p><p>Pozdrawiamy,<br>{{venueName}}</p>",
    },
    hall_cancelled_client: {
      subject: "{{venueName}} — rezerwacja sali anulowana ({{reservationNumber}})",
      bodyHtml:
        "<p>Dzien dobry {{fullName}},</p><p>Rezerwacja sali <strong>{{reservationNumber}}</strong> zostala anulowana.</p><p>Termin: {{date}} · {{hallName}}</p><p>Jesli chcesz ustalic inny termin, skontaktuj sie z obiektem.</p><p>Pozdrawiamy,<br>{{venueName}}</p>",
    },
    hall_changed_client: {
      subject: "{{venueName}} — zmiana rezerwacji sali {{reservationNumber}}",
      bodyHtml:
        "<p>Dzien dobry {{fullName}},</p><p>Wprowadzilismy zmiany w rezerwacji sali <strong>{{reservationNumber}}</strong>.</p><p>Sala: {{hallName}}<br>Data: {{date}}<br>Godziny: {{timeFrom}}–{{timeTo}} ({{durationHours}} h)<br>Gosci: {{guestsCount}}<br>Impreza: {{eventType}}</p><p>Uwagi do rezerwacji: {{customerNote}}</p><p>W razie pytan odpowiedz na te wiadomosc lub skontaktuj sie z obiektem.</p><p>Pozdrawiamy,<br>{{venueName}}</p>",
    },
  };
}

function ultraLegacyDefaultTemplateMap(service) {
  if (service !== "hotel") return {};
  return {
    confirm_email: {
      subject: "{{hotelName}} — potwierdź rezerwację ({{reservationNumber}})",
      bodyHtml:
        '<p>Witaj {{fullName}},</p><p>Kliknij link, aby potwierdzić rezerwację:</p><p><a href="{{confirmationLink}}">Potwierdź rezerwację</a></p><p>Numer: {{reservationNumber}}<br>Termin: {{dateFrom}} — {{dateTo}}</p>',
    },
    pending_admin: {
      subject: "[{{hotelName}}] Nowa rezerwacja oczekująca {{reservationNumber}}",
      bodyHtml:
        "<p>Nowa rezerwacja oczekuje na decyzję.</p><p>{{fullName}} · {{email}} · {{phone}}</p><p>{{dateFrom}} — {{dateTo}}</p>",
    },
    confirmed_client: {
      subject: "{{hotelName}} — rezerwacja potwierdzona ({{reservationNumber}})",
      bodyHtml:
        "<p>Witaj {{fullName}},</p><p>Rezerwacja {{reservationNumber}} została potwierdzona.</p><p>Zameldowanie: od 14:00. Wymeldowanie: do 11:00.</p>",
    },
    cancelled_client: {
      subject: "{{hotelName}} — rezerwacja anulowana ({{reservationNumber}})",
      bodyHtml: "<p>Witaj {{fullName}},</p><p>Rezerwacja {{reservationNumber}} została anulowana.</p>",
    },
    changed_client: {
      subject: "{{hotelName}} — zmiana w rezerwacji {{reservationNumber}}",
      bodyHtml:
        "<p>Witaj {{fullName}},</p><p>Wprowadziliśmy zmiany w rezerwacji <strong>{{reservationNumber}}</strong>.</p><p>Termin pobytu: {{dateFrom}} — {{dateTo}} ({{nights}} nocy).<br>Pokoje: {{roomsList}}<br>Kwota orientacyjna: {{totalPrice}} PLN</p><p>{{customerNote}}</p><p>W razie pytań odpowiedz na tę wiadomość lub skontaktuj się z recepcją.</p>",
    },
  };
}

function matchesAnyTemplateShape(current, candidates) {
  return (Array.isArray(candidates) ? candidates : []).filter(Boolean).some((candidate) => isSameTemplateShape(current, candidate));
}

function buildHotelDefaultTemplates() {
  return {
    confirm_email: {
      subject: "Potwierdzenie adresu e-mail ({{reservationNumber}})",
      bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>dziękujemy za wybór <strong>{{hotelName}}</strong>. Otrzymaliśmy zgłoszenie rezerwacji i przygotowaliśmy jego kompletne podsumowanie.</p>
<p>Aby przekazać rezerwację do dalszej obsługi recepcji, potwierdź adres e-mail. Link pozostaje aktywny przez <strong>2 godziny</strong>.</p>
${infoCard("Podsumowanie pobytu", [
  ["Numer rezerwacji", "{{reservationNumber}}"],
  ["Termin pobytu", "{{dateFrom}} — {{dateTo}}"],
  ["Zameldowanie", "od 14:00"],
  ["Wymeldowanie", "do 11:00"],
  ["Liczba noclegów", "{{nights}}"],
  ["Wybrane pokoje", "{{roomsList}}"],
  ["Orientacyjna kwota do zapłaty na miejscu", "{{totalPrice}} PLN"],
  ["Dodatkowy opis do rezerwacji", "{{customerNote}}"],
])}
${noteCard("<strong>Ważne:</strong> potwierdzenie adresu e-mail nie jest jeszcze ostatecznym potwierdzeniem pobytu. Po weryfikacji dostępności recepcja prześle kolejną wiadomość ze statusem rezerwacji.")}
<p>Jeżeli to nie Ty wysyłałeś formularz, zignoruj tę wiadomość.</p>`,
      actionLabel: "Potwierdź adres e-mail",
    },
    pending_admin: {
      subject: "Nowa rezerwacja do decyzji ({{reservationNumber}})",
      bodyHtml: `<p>Do panelu wpłynęła nowa rezerwacja wymagająca decyzji recepcji.</p>
${infoCard("Dane rezerwacji", [
  ["Numer rezerwacji", "{{reservationNumber}}"],
  ["Dotyczy", "{{reservationSubject}}"],
  ["Decyzja do", "{{decisionDeadline}}"],
  ["Klient", "{{fullName}}"],
  ["E-mail", "{{email}}"],
  ["Telefon", "{{phone}}"],
  ["Termin pobytu", "{{dateFrom}} — {{dateTo}}"],
  ["Zameldowanie", "od 14:00"],
  ["Wymeldowanie", "do 11:00"],
  ["Liczba noclegów", "{{nights}}"],
  ["Pokoje", "{{roomsList}}"],
  ["Orientacyjna kwota", "{{totalPrice}} PLN"],
  ["Uwagi klienta", "{{customerNote}}"],
])}`,
    },
    confirmed_client: {
      subject: "Rezerwacja pobytu potwierdzona ({{reservationNumber}})",
      bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>z przyjemnością potwierdzamy rezerwację pobytu w <strong>{{hotelName}}</strong>.</p>
${infoCard("Potwierdzony pobyt", [
  ["Numer rezerwacji", "{{reservationNumber}}"],
  ["Termin pobytu", "{{dateFrom}} — {{dateTo}}"],
  ["Zameldowanie", "od 14:00"],
  ["Wymeldowanie", "do 11:00"],
  ["Liczba noclegów", "{{nights}}"],
  ["Pokoje", "{{roomsList}}"],
  ["Orientacyjna kwota do zapłaty na miejscu", "{{totalPrice}} PLN"],
  ["Dodatkowy opis do rezerwacji", "{{customerNote}}"],
])}
${noteCard("Jeżeli chcesz doprecyzować godzinę przyjazdu, potrzeby dotyczące pobytu lub inne szczegóły organizacyjne, odpowiedz na tę wiadomość.")}
<p>Dziękujemy za zaufanie i do zobaczenia w {{hotelName}}.</p>`,
    },
    cancelled_client: {
      subject: "Anulowanie rezerwacji pobytu ({{reservationNumber}})",
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
      subject: "Zaktualizowano rezerwację pobytu ({{reservationNumber}})",
      bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>wprowadziliśmy zmiany w Twojej rezerwacji. Aktualne dane pobytu znajdują się poniżej.</p>
${infoCard("Aktualne podsumowanie rezerwacji", [
  ["Numer rezerwacji", "{{reservationNumber}}"],
  ["Termin pobytu", "{{dateFrom}} — {{dateTo}}"],
  ["Zameldowanie", "od 14:00"],
  ["Wymeldowanie", "do 11:00"],
  ["Liczba noclegów", "{{nights}}"],
  ["Pokoje", "{{roomsList}}"],
  ["Orientacyjna kwota do zapłaty na miejscu", "{{totalPrice}} PLN"],
  ["Uwagi do rezerwacji", "{{customerNote}}"],
])}
${noteCard("Jeżeli któraś z powyższych informacji wymaga doprecyzowania, odpowiedz na tę wiadomość. Zespół recepcji wróci do Ciebie możliwie szybko.")}`,
    },
    expired_pending_client: {
      subject: "Zgłoszenie wygasło ({{reservationNumber}})",
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
      subject: "Wygasła rezerwacja oczekująca ({{reservationNumber}})",
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
      subject: "Link potwierdzający wygasł",
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
      subject: "Anulowano rezerwację ({{reservationNumber}})",
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
  const base = {
    restaurant_confirm_email: {
      subject: "Potwierdzenie rezerwacji stolika ({{reservationNumber}})",
      bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>dziękujemy za wybór <strong>{{restaurantName}}</strong>. Otrzymaliśmy zgłoszenie rezerwacji stolika i przygotowaliśmy jego podsumowanie.</p>
<p>Aby przekazać rezerwację do obsługi sali, potwierdź adres e-mail. Link pozostaje ważny przez <strong>2 godziny</strong>.</p>
${infoCard("Podsumowanie rezerwacji stolika", [
  ["Numer rezerwacji", "{{reservationNumber}}"],
  ["Data", "{{date}}"],
  ["Godzina", "{{timeFrom}} — {{timeTo}}"],
  ["Liczba gości", "{{guestsCount}}"],
  ["Łączenie stolików", "{{joinTables}}"],
  ["Preferencja miejsca", "{{placePreference}}"],
  ["Przydział stolików", "{{tablesList}}"],
])}
${noteCard("Rezerwacja stolika nie wymaga przedpłaty. <strong>Płatność odbywa się na miejscu</strong>, zgodnie z aktualnym menu i zamówieniem złożonym podczas wizyty.")}
<p>Jeżeli to nie Ty wysyłałeś formularz, zignoruj tę wiadomość.</p>`,
      actionLabel: "Potwierdź adres e-mail",
    },
    restaurant_pending_admin: {
      subject: "Nowa rezerwacja stolika ({{reservationNumber}})",
      bodyHtml: `<p>Do obsługi wpłynęła nowa rezerwacja stolika wymagająca decyzji.</p>
${infoCard("Szczegóły rezerwacji", [
  ["Numer rezerwacji", "{{reservationNumber}}"],
  ["Dotyczy", "{{reservationSubject}}"],
  ["Decyzja do", "{{decisionDeadline}}"],
  ["Klient", "{{fullName}}"],
  ["E-mail", "{{email}}"],
  ["Telefon", "{{phone}}"],
  ["Data", "{{date}}"],
  ["Godzina", "{{timeFrom}} — {{timeTo}}"],
  ["Liczba gości", "{{guestsCount}}"],
  ["Przydział stolików", "{{tablesList}}"],
  ["Łączenie stolików", "{{joinTables}}"],
  ["Preferencja miejsca", "{{placePreference}}"],
  ["Uwagi klienta", "{{customerNote}}"],
])}`,
    },
    restaurant_confirmed_client: {
      subject: "Rezerwacja stolika potwierdzona ({{reservationNumber}})",
      bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>z przyjemnością potwierdzamy Twoją rezerwację stolika.</p>
${infoCard("Potwierdzone spotkanie", [
  ["Numer rezerwacji", "{{reservationNumber}}"],
  ["Data", "{{date}}"],
  ["Godzina", "{{timeFrom}} — {{timeTo}}"],
  ["Liczba gości", "{{guestsCount}}"],
  ["Łączenie stolików", "{{joinTables}}"],
  ["Preferencja miejsca", "{{placePreference}}"],
  ["Przydział stolików", "{{tablesList}}"],
])}
${noteCard("Rezerwacja nie wymaga przedpłaty. <strong>Płatność następuje na miejscu</strong> według zamówienia i aktualnej karty menu. W przypadku spóźnienia lub zmiany liczby gości prosimy o wcześniejszy kontakt.")}`,
    },
    restaurant_cancelled_client: {
      subject: "Rezerwacja stolika anulowana ({{reservationNumber}})",
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
      subject: "Zaktualizowano rezerwację stolika ({{reservationNumber}})",
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
      subject: "Rezerwacja stolika wygasła ({{reservationNumber}})",
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
      subject: "Wygasła rezerwacja stolika ({{reservationNumber}})",
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
      subject: "Link potwierdzający wygasł",
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
    catering_manual_created_client: {
      subject: "{{restaurantName}} — utworzono dostawę cateringu",
      bodyHtml: `<p>Dzień dobry {{fullName}},</p>
<p>informujemy, że <strong>dostawa cateringu została zapisana w naszym systemie</strong> (rezerwacja utworzona ręcznie przez obsługę).</p>
{{cateringWhenHtml}}
{{cateringRecipientHtml}}
{{cateringDescriptionHtml}}
${noteCard("W razie pytań odpowiedz na tę wiadomość lub skontaktuj się bezpośrednio z obsługą cateringu.")}
<p>Pozdrawiamy,<br>{{restaurantName}}</p>`,
    },
  };
  return {
    ...base,
    rest_confirm_email: structuredClone(base.restaurant_confirm_email),
    rest_pending_admin: structuredClone(base.restaurant_pending_admin),
    rest_confirmed_client: structuredClone(base.restaurant_confirmed_client),
    rest_cancelled_client: structuredClone(base.restaurant_cancelled_client),
    rest_changed_client: structuredClone(base.restaurant_changed_client),
  };
}

function buildHallDefaultTemplates() {
  return {
    hall_confirm_email: {
      subject: "Potwierdzenie zgłoszenia rezerwacji sali ({{reservationNumber}})",
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
      actionLabel: "Potwierdź zgłoszenie",
    },
    hall_pending_admin: {
      subject: "Nowe zgłoszenie sali ({{reservationNumber}})",
      bodyHtml: `<p>Do obsługi wpłynęło nowe zgłoszenie rezerwacji sali.</p>
${infoCard("Szczegóły zgłoszenia", [
  ["Numer zgłoszenia", "{{reservationNumber}}"],
  ["Dotyczy", "{{reservationSubject}}"],
  ["Decyzja do", "{{decisionDeadline}}"],
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
      subject: "Rezerwacja sali potwierdzona ({{reservationNumber}})",
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
      subject: "Rezerwacja sali anulowana ({{reservationNumber}})",
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
      subject: "Zaktualizowano rezerwację sali ({{reservationNumber}})",
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
      subject: "Zgłoszenie wygasło ({{reservationNumber}})",
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
      subject: "Wygasła rezerwacja sali ({{reservationNumber}})",
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
      subject: "Link potwierdzający wygasł",
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
      subject: "Przedłużono termin oczekiwania ({{reservationNumber}})",
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

function defaultTemplateMap(service) {
  if (service === "hotel") return buildHotelDefaultTemplates();
  if (service === "restaurant") return buildRestaurantDefaultTemplates();
  return buildHallDefaultTemplates();
}

const EVENT_TEMPLATE_KEYS = {
  hotel: {
    confirm_email: ["confirm_email"],
    pending_admin: ["pending_admin"],
    confirmed_client: ["confirmed_client"],
    cancelled_client: ["cancelled_client"],
    changed_client: ["changed_client"],
  },
  restaurant: {
    confirm_email: ["restaurant_confirm_email", "rest_confirm_email"],
    pending_admin: ["restaurant_pending_admin", "rest_pending_admin"],
    confirmed_client: ["restaurant_confirmed_client", "rest_confirmed_client"],
    cancelled_client: ["restaurant_cancelled_client", "rest_cancelled_client"],
    changed_client: ["restaurant_changed_client", "rest_changed_client"],
    catering_manual_created_client: ["catering_manual_created_client"],
  },
  hall: {
    confirm_email: ["hall_confirm_email"],
    pending_admin: ["hall_pending_admin"],
    confirmed_client: ["hall_confirmed_client"],
    cancelled_client: ["hall_cancelled_client"],
    changed_client: ["hall_changed_client"],
  },
};

async function loadTemplates(env, service) {
  const defaults = defaultTemplateMap(service);
  const legacyDefaults = legacyDefaultTemplateMap(service);
  const ultraLegacyDefaults = ultraLegacyDefaultTemplateMap(service);
  const rows = await env.DB.prepare(
    "SELECT key, subject, body_html AS bodyHtml, action_label AS actionLabel, updated_at AS updatedAt FROM booking_mail_templates WHERE service = ? ORDER BY key ASC"
  )
    .bind(service)
    .all();
  if ((rows.results || []).length === 0) {
    const now = nowMs();
    for (const [key, val] of Object.entries(defaults)) {
      await env.DB.prepare(
        "INSERT INTO booking_mail_templates (service, key, subject, body_html, action_label, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
        .bind(service, key, val.subject, val.bodyHtml, cleanString(val.actionLabel, 200), now)
        .run();
    }
    return defaults;
  }
  const rowMap = new Map(
    (rows.results || []).map((r) => [
      r.key,
      {
        subject: r.subject || "",
        bodyHtml: r.bodyHtml || "",
        actionLabel: r.actionLabel || "",
        updatedAt: Number(r.updatedAt || 0),
      },
    ])
  );
  const out = {};
  const now = nowMs();
  for (const [key, template] of Object.entries(defaults)) {
    const existing = rowMap.get(key);
    if (!existing) {
      out[key] = {
        subject: template.subject || "",
        bodyHtml: template.bodyHtml || "",
        actionLabel: cleanString(template.actionLabel, 200),
        updatedAt: now,
      };
      await env.DB.prepare(
        "INSERT INTO booking_mail_templates (service, key, subject, body_html, action_label, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(service, key) DO UPDATE SET subject = excluded.subject, body_html = excluded.body_html, action_label = excluded.action_label, updated_at = excluded.updated_at"
      )
        .bind(service, key, template.subject, template.bodyHtml, cleanString(template.actionLabel, 200), now)
        .run();
      continue;
    }
    if (matchesAnyTemplateShape(existing, [legacyDefaults[key], ultraLegacyDefaults[key]])) {
      out[key] = {
        subject: template.subject || "",
        bodyHtml: template.bodyHtml || "",
        actionLabel: cleanString(template.actionLabel, 200),
        updatedAt: now,
      };
      await env.DB.prepare(
        "INSERT INTO booking_mail_templates (service, key, subject, body_html, action_label, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(service, key) DO UPDATE SET subject = excluded.subject, body_html = excluded.body_html, action_label = excluded.action_label, updated_at = excluded.updated_at"
      )
        .bind(service, key, template.subject, template.bodyHtml, cleanString(template.actionLabel, 200), now)
        .run();
      continue;
    }
    out[key] = existing;
  }
  rowMap.forEach((value, key) => {
    if (!out[key]) out[key] = value;
  });
  return out;
}

async function saveTemplate(env, service, key, subject, bodyHtml, actionLabel = "") {
  const al = cleanString(actionLabel, 200);
  await env.DB.prepare(
    "INSERT INTO booking_mail_templates (service, key, subject, body_html, action_label, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(service, key) DO UPDATE SET subject = excluded.subject, body_html = excluded.body_html, action_label = excluded.action_label, updated_at = excluded.updated_at"
  )
    .bind(service, cleanString(key, 120), cleanString(subject, 400), String(bodyHtml || ""), al, nowMs())
    .run();
}

async function resolveTemplateForEvent(env, service, eventKey) {
  const all = await loadTemplates(env, service);
  const candidates = EVENT_TEMPLATE_KEYS[service]?.[eventKey] || [eventKey];
  const isPlaceholder = (tpl) => {
    if (!tpl) return true;
    const subject = cleanString(tpl.subject, 500).toLowerCase();
    const body = cleanString(tpl.bodyHtml, 5000).toLowerCase();
    const placeholderSubject = subject === `${service} - ${eventKey}`;
    const placeholderBody =
      body === "" ||
      /^szablon [a-z0-9_-]+$/u.test(body) ||
      /^<p>\s*szablon [a-z0-9_-]+\s*<\/p>$/u.test(body);
    return placeholderSubject && placeholderBody;
  };

  const ranked = candidates
    .map((key, index) => ({
      index,
      tpl: all[key],
      updatedAt: Number(all[key]?.updatedAt || 0),
    }))
    .filter((entry) => entry.tpl && !isPlaceholder(entry.tpl))
    .sort((a, b) => {
      if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
      return a.index - b.index;
    });

  if (ranked.length) {
    return {
      subject: ranked[0].tpl.subject || "",
      bodyHtml: ranked[0].tpl.bodyHtml || "",
      actionLabel: cleanString(ranked[0].tpl.actionLabel, 200),
    };
  }
  const defaults = defaultTemplateMap(service);
  for (const key of candidates) {
    if (defaults[key]) {
      const d = defaults[key];
      return {
        subject: d.subject || "",
        bodyHtml: d.bodyHtml || "",
        actionLabel: cleanString(d.actionLabel, 200),
      };
    }
  }
  return { subject: `${service} - ${eventKey}`, bodyHtml: `<p>Szablon ${eventKey}</p>`, actionLabel: "" };
}

function listStatusWhere(status) {
  const s = cleanString(status, 40) || "active";
  if (s === "all") return { sql: "", binds: [] };
  if (s === "active") return { sql: "WHERE status IN ('pending','confirmed')", binds: [] };
  return { sql: "WHERE status = ?", binds: [s] };
}

async function listHotelReservations(env, status) {
  const { sql, binds } = listStatusWhere(status);
  const rows = await env.DB.prepare(
    `SELECT * FROM hotel_reservations ${sql}
     ORDER BY CASE status
                WHEN 'pending' THEN 0
                WHEN 'confirmed' THEN 1
                WHEN 'email_verification_pending' THEN 2
                WHEN 'manual_block' THEN 3
                WHEN 'cancelled' THEN 4
                WHEN 'expired' THEN 5
                ELSE 6
              END ASC,
              date_to ASC,
              created_at DESC
     LIMIT 500`
  )
    .bind(...binds)
    .all();
  return (rows.results || []).map(mapHotelReservation);
}

async function listRestaurantReservations(env, status) {
  const tables = await restaurantTables(env, true);
  const map = new Map(tables.map((t) => [t.id, t]));
  const { sql, binds } = listStatusWhere(status);
  const rows = await env.DB.prepare(
    `SELECT * FROM restaurant_reservations ${sql}
     ORDER BY CASE status
                WHEN 'pending' THEN 0
                WHEN 'confirmed' THEN 1
                WHEN 'email_verification_pending' THEN 2
                WHEN 'manual_block' THEN 3
                WHEN 'cancelled' THEN 4
                WHEN 'expired' THEN 5
                ELSE 6
              END ASC,
              end_ms ASC,
              created_at DESC
     LIMIT 500`
  )
    .bind(...binds)
    .all();
  const list = rows.results || [];
  const recipientIds = [...new Set(list.map((r) => cleanString(r.recipient_id, 80)).filter(Boolean))];
  const recipientById = new Map();
  if (recipientIds.length) {
    const placeholders = recipientIds.map(() => "?").join(",");
    const recRes = await env.DB.prepare(`SELECT * FROM catering_recipients WHERE id IN (${placeholders})`)
      .bind(...recipientIds)
      .all();
    for (const rec of recRes.results || []) {
      recipientById.set(rec.id, rec);
    }
  }
  return list.map((r) => mapRestaurantReservation(r, map, recipientById.get(r.recipient_id) || null));
}

async function listHallReservations(env, status) {
  const halls = await venueHalls(env);
  const map = new Map(halls.map((h) => [h.id, h]));
  const { sql, binds } = listStatusWhere(status);
  const rows = await env.DB.prepare(
    `SELECT * FROM venue_reservations ${sql}
     ORDER BY CASE status
                WHEN 'pending' THEN 0
                WHEN 'confirmed' THEN 1
                WHEN 'email_verification_pending' THEN 2
                WHEN 'manual_block' THEN 3
                WHEN 'cancelled' THEN 4
                WHEN 'expired' THEN 5
                ELSE 6
              END ASC,
              end_ms ASC,
              created_at DESC
     LIMIT 500`
  )
    .bind(...binds)
    .all();
  return (rows.results || []).map((r) => mapHallReservation(r, map));
}

async function getRestaurantReservationRow(env, id) {
  return env.DB.prepare("SELECT * FROM restaurant_reservations WHERE id = ?").bind(id).first();
}

async function getHallReservationRow(env, id) {
  return env.DB.prepare("SELECT * FROM venue_reservations WHERE id = ?").bind(id).first();
}

function hotelDisplayName(env) {
  return cleanString(env.HOTEL_NAME, 140) || "Średzka Korona";
}

function restaurantDisplayName(env) {
  return cleanString(env.RESTAURANT_NAME, 140) || cleanString(env.HOTEL_NAME, 140) || "Średzka Korona — Restauracja";
}

function hallDisplayName(env) {
  return cleanString(env.VENUE_NAME, 140) || cleanString(env.HOTEL_NAME, 140) || "Średzka Korona";
}

function parseAdminNotifyEmails(env) {
  return [...new Set([env.ADMIN_NOTIFY_EMAIL, env.FIREBASE_ADMIN_EMAILS]
    .flatMap((raw) => splitLines(String(raw || "").replace(/,/g, "\n")))
    .map((x) => cleanString(x, 320).toLowerCase())
    .filter((x) => x.includes("@")))];
}

async function issueAdminActionToken(env, service, reservationId) {
  const now = nowMs();
  const table = reservationTableName(service);
  const row = await env.DB.prepare(`SELECT pending_expires_at FROM ${table} WHERE id = ? LIMIT 1`)
    .bind(reservationId)
    .first();
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const pendingExpiresAt = Number(row?.pending_expires_at || 0);
  const adminActionExpiresAt =
    pendingExpiresAt > now ? Math.min(now + ADMIN_ACTION_LINK_MS, pendingExpiresAt) : now + ADMIN_ACTION_LINK_MS;
  await env.DB.prepare(
    `UPDATE ${table} SET admin_action_token_hash = ?, admin_action_expires_at = ?, updated_at = ? WHERE id = ?`
  )
    .bind(tokenHash, adminActionExpiresAt, now, reservationId)
    .run();
  return token;
}

async function getReservationByAdminActionToken(env, service, token) {
  const cleanToken = cleanString(token, 500);
  if (!cleanToken) return null;
  const tokenHash = await sha256Hex(cleanToken);
  const now = nowMs();
  return env.DB.prepare(
    `SELECT * FROM ${reservationTableName(service)}
     WHERE admin_action_token_hash = ?
       AND admin_action_expires_at IS NOT NULL
       AND admin_action_expires_at >= ?
       AND status = 'pending'
       AND pending_expires_at IS NOT NULL
       AND pending_expires_at >= ?
     LIMIT 1`
  )
    .bind(tokenHash, now, now)
    .first();
}

function buildAdminActionDetailRows(service, vars) {
  const rows = [
    ["Numer rezerwacji", vars.reservationNumber || ""],
    ["Dotyczy", vars.reservationSubject || ""],
    ["Decyzja do", vars.decisionDeadline || ""],
    ["Klient", vars.fullName || ""],
    ["E-mail", vars.email || ""],
    ["Telefon", vars.phone || ""],
  ];
  if (service === "hotel") {
    rows.push(
      ["Termin pobytu", [vars.dateFrom, vars.dateTo].filter(Boolean).join(" — ")],
      ["Liczba noclegów", vars.nights || ""],
      ["Pokoje", vars.roomsList || ""],
      ["Orientacyjna kwota", vars.totalPrice ? `${vars.totalPrice} PLN` : ""]
    );
  } else if (service === "restaurant") {
    rows.push(
      ["Data", vars.date || ""],
      ["Godzina", [vars.timeFrom, vars.timeTo].filter(Boolean).join(" — ")],
      ["Liczba gości", vars.guestsCount || ""],
      ["Przydział stolików", vars.tablesList || ""],
      ["Łączenie stolików", vars.joinTables || ""],
      ["Preferencja miejsca", vars.placePreference || ""]
    );
  } else {
    rows.push(
      ["Sala", vars.hallName || ""],
      ["Data", vars.date || ""],
      ["Godziny", [vars.timeFrom, vars.timeTo].filter(Boolean).join(" — ")],
      ["Liczba gości", vars.guestsCount || ""],
      ["Rodzaj wydarzenia", vars.eventType || ""],
      ["Wyłączność", vars.exclusive || ""],
      ["Pełna blokada sali", vars.fullBlockLabel || ""]
    );
  }
  rows.push(["Uwagi klienta", vars.customerNote || ""]);
  return rows.filter(([, value]) => String(value || "").trim());
}

async function buildAdminActionPayload(env, request, service, row) {
  const vars = await buildMailVarsForService(env, request, service, row, "");
  return {
    ok: true,
    service,
    serviceLabel: serviceLabel(service),
    status: row.status || "",
    statusLabel: statusLabel(row.status || ""),
    canConfirm: row.status === "pending" && Number(row.pending_expires_at || 0) > nowMs(),
    reservationNumber: vars.reservationNumber || "",
    reservationSubject: vars.reservationSubject || reservationSubjectLabel(service, row),
    decisionDeadline: vars.decisionDeadline || "",
    details: buildAdminActionDetailRows(service, vars).map(([label, value]) => ({ label, value })),
  };
}

async function confirmReservationById(env, request, service, id) {
  const table = reservationTableName(service);
  const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ? LIMIT 1`)
    .bind(id)
    .first();
  if (!row) {
    return { status: 404, data: { error: "Brak rezerwacji." } };
  }
  if (row.status === "confirmed") {
    return { status: 200, data: await buildAdminActionPayload(env, request, service, row) };
  }
  if (row.status !== "pending") {
    return {
      status: 400,
      data: {
        error:
          row.status === "expired"
            ? "Ta rezerwacja wygasła i nie może już zostać potwierdzona."
            : row.status === "cancelled"
              ? "Ta rezerwacja została już anulowana."
              : "Ta rezerwacja nie oczekuje już na decyzję.",
      },
    };
  }
  await env.DB.prepare(
    `UPDATE ${table} SET status='confirmed', pending_expires_at=NULL, admin_action_token_hash=NULL, admin_action_expires_at=NULL, updated_at=? WHERE id=?`
  )
    .bind(nowMs(), id)
    .run();
  const updated = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ? LIMIT 1`)
    .bind(id)
    .first();
  try {
    await sendTemplatedBookingMail(env, request, {
      service,
      eventKey: "confirmed_client",
      row: updated,
      to: updated?.email,
    });
  } catch (error) {
    console.error(`${service} confirm mail error:`, error);
  }
  return { status: 200, data: await buildAdminActionPayload(env, request, service, updated) };
}

async function buildHotelMailVars(env, request, row, token = "") {
  const roomIds = parseJson(row.room_ids_json, []);
  const rooms = await hotelRooms(env);
  const roomMap = new Map(rooms.map((r) => [r.id, r]));
  const roomLabels = roomIds.map((id) => roomMap.get(id)?.name || id).join(", ");
  return {
    reservationId: row.id,
    reservationNumber: reservationNumberForRow(row, "hotel"),
    reservationSubject: reservationSubjectLabel("hotel", row),
    fullName: row.customer_name || "",
    email: row.email || "",
    phone: `${row.phone_prefix || ""} ${row.phone_national || ""}`.trim(),
    roomsList: roomLabels,
    dateFrom: row.date_from || "",
    dateTo: row.date_to || "",
    nights: String(nightsCount(row.date_from, row.date_to)),
    totalPrice: String(Number(row.total_price || 0).toFixed(2)),
    customerNote: row.customer_note || "",
    adminNote: row.admin_note || "",
    decisionDeadline: formatDateTimeWarsaw(Number(row.pending_expires_at || 0)),
    confirmationLink: token ? buildConfirmationLink(env, request, "hotel", token) : "",
    hotelName: hotelDisplayName(env),
  };
}

async function buildRestaurantMailVars(env, request, row, token = "") {
  const tables = await restaurantTables(env, true);
  const tableMap = new Map(tables.map((t) => [t.id, t]));
  const assigned = parseJson(row.assigned_table_ids_json, []);
  const tableLabels = assigned
    .map((id) => {
      const t = tableMap.get(id);
      return t ? `Stół ${t.number}${t.zone ? ` (${t.zone})` : ""}` : id;
    })
    .join(", ");
  return {
    reservationId: row.id,
    reservationNumber: reservationNumberForRow(row, "restaurant"),
    reservationSubject: reservationSubjectLabel("restaurant", row),
    fullName: row.full_name || "",
    email: row.email || "",
    phone: `${row.phone_prefix || ""} ${row.phone_national || ""}`.trim(),
    date: row.reservation_date || "",
    timeFrom: row.start_time || "",
    timeTo: formatHm(Number(row.end_ms || 0)),
    durationHours: String(row.duration_hours || ""),
    tablesCount: String(row.tables_count || ""),
    tablesList: tableLabels,
    guestsCount: String(row.guests_count || ""),
    joinTables: Number(row.join_tables) ? "tak" : "nie",
    placePreference: restaurantPlacePreferenceLabel(row.place_preference),
    customerNote: row.customer_note || "",
    adminNote: row.admin_note || "",
    decisionDeadline: formatDateTimeWarsaw(Number(row.pending_expires_at || 0)),
    confirmationLink: token ? buildConfirmationLink(env, request, "restaurant", token) : "",
    restaurantName: restaurantDisplayName(env),
  };
}

function cateringDeliveryTerminWord(n) {
  const c = Math.floor(Number(n) || 0);
  if (c === 1) return "termin";
  const m10 = c % 10;
  const m100 = c % 100;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "terminy";
  return "terminów";
}

function cateringRepeatSummaryPhrase(repeatMode, repeatWeekdays) {
  const mode = cleanString(repeatMode, 24).toLowerCase();
  if (mode === "weekly") return ", co tydzień";
  if (mode === "biweekly") return ", co dwa tygodnie";
  if (mode === "monthly") return ", co miesiąc";
  if (mode === "selected_days") {
    const labels = ["niedz.", "pon.", "wt.", "śr.", "czw.", "pt.", "sob."];
    const xs = [...new Set((Array.isArray(repeatWeekdays) ? repeatWeekdays : []).map(Number))].filter(
      (n) => Number.isInteger(n) && n >= 0 && n <= 6
    );
    xs.sort((a, b) => a - b);
    if (!xs.length) return ", w wybrane dni tygodnia";
    return `, w dni: ${xs.map((i) => labels[i]).join(", ")}`;
  }
  return ", harmonogram cykliczny";
}

function buildCateringManualCreatedMailExtraVars(recipientSqlRow, { dates, startTime, repeatMode, repeatWeekdays, description }) {
  const sorted = [...(Array.isArray(dates) ? dates : [])].filter((d) => isYmd(cleanString(d, 10))).sort();
  const first = sorted[0] || "";
  const last = sorted[sorted.length - 1] || first;
  const st = cleanString(startTime, 5);
  const mode = cleanString(repeatMode, 24).toLowerCase();
  let cateringWhenHtml = "";
  let cateringWhenPlain = "";
  if (sorted.length <= 1 || !mode || mode === "none") {
    const line = first && st ? `${first}, godz. ${st}` : first ? String(first) : "—";
    cateringWhenHtml = infoCard("Na kiedy", [["Termin dostawy", escapeHtml(line)]]);
    cateringWhenPlain = `Na kiedy: ${line}`;
  } else {
    const tw = cateringDeliveryTerminWord(sorted.length);
    const summaryLine = `${sorted.length} ${tw} od ${first} do ${last} (włącznie)${cateringRepeatSummaryPhrase(
      repeatMode,
      repeatWeekdays
    )}, zawsze o ${st}`;
    const listNote =
      sorted.length <= 16
        ? `<p style="margin:14px 0 0 0;color:#5e4b39;font-size:14px;line-height:1.65;">Kolejne daty: ${sorted.map((d) => escapeHtml(d)).join(", ")}</p>`
        : "";
    cateringWhenHtml = `${infoCard("Na kiedy", [["Harmonogram", escapeHtml(summaryLine)]])}${listNote}`;
    cateringWhenPlain = `Na kiedy: ${summaryLine}`;
  }
  const r = recipientSqlRow || {};
  const person = [r.contact_first_name, r.contact_last_name].filter(Boolean).join(" ");
  const phone = `${r.phone_prefix || ""} ${r.phone_national || ""}`.trim();
  const addr = [r.street, r.building_number].filter(Boolean).join(" ");
  const cityLine = [r.postal_code, r.city].filter(Boolean).join(" ");
  const recipientRows = [
    ["Nazwa odbiorcy", r.display_name || "—"],
    ["Osoba kontaktowa", person || "—"],
    ["E-mail", r.email || "—"],
    ["Telefon", phone || "—"],
    ["Adres", addr || "—"],
    ["Miejscowość", cityLine || "—"],
  ];
  if (String(r.extra_info || "").trim()) {
    recipientRows.push(["Dodatkowe informacje", String(r.extra_info).trim()]);
  }
  const cateringRecipientHtml = infoCard(
    "Dla kogo (odbiorca)",
    recipientRows.map(([label, value]) => [label, escapeHtml(String(value ?? ""))])
  );
  const desc = cleanString(description, 2000);
  const cateringDescriptionHtml = desc
    ? noteCard(`<strong>Opis / uwagi do zamówienia:</strong><br>${escapeHtml(desc).replace(/\n/g, "<br>")}`)
    : "";
  return { cateringWhenHtml, cateringRecipientHtml, cateringDescriptionHtml, cateringWhenPlain };
}

async function buildHallMailVars(env, request, row, token = "") {
  const hall = await env.DB.prepare("SELECT name FROM venue_halls WHERE id = ?").bind(row.hall_id).first();
  return {
    reservationId: row.id,
    reservationNumber: reservationNumberForRow(row, "hall"),
    reservationSubject: reservationSubjectLabel("hall", row),
    fullName: row.full_name || "",
    email: row.email || "",
    phone: `${row.phone_prefix || ""} ${row.phone_national || ""}`.trim(),
    hallName: row.hall_name_snapshot || hall?.name || row.hall_id || "",
    date: row.reservation_date || "",
    timeFrom: row.start_time || "",
    timeTo: formatHm(Number(row.end_ms || 0)),
    durationHours: String(row.duration_hours || ""),
    guestsCount: String(row.guests_count || ""),
    eventType: row.event_type || "",
    exclusive: Number(row.exclusive) ? "tak" : "nie",
    fullBlockLabel: Number(row.full_block) ? "tak" : "nie",
    customerNote: row.customer_note || "",
    adminNote: row.admin_note || "",
    decisionDeadline: formatDateTimeWarsaw(Number(row.pending_expires_at || 0)),
    confirmationLink: token ? buildConfirmationLink(env, request, "hall", token) : "",
    venueName: hallDisplayName(env),
  };
}

async function buildMailVarsForService(env, request, service, row, token = "") {
  if (service === "hotel") return buildHotelMailVars(env, request, row, token);
  if (service === "restaurant") return buildRestaurantMailVars(env, request, row, token);
  return buildHallMailVars(env, request, row, token);
}

async function logMailAudit(
  env,
  { service, eventKey, row, to, envelopeFrom = "", subject, status, messageId = "", smtpAccepted = "", error = "" }
) {
  try {
    await env.DB.prepare(
      `INSERT INTO booking_mail_audit
        (service, event_key, reservation_id, recipient, envelope_from, subject, status, message_id, smtp_accepted, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        cleanString(service, 40),
        cleanString(eventKey, 80),
        cleanString(row?.id, 120) || null,
        cleanString(to, 320),
        cleanString(envelopeFrom, 320),
        cleanString(subject, 500),
        cleanString(status, 40),
        cleanString(messageId, 320),
        cleanString(smtpAccepted, 4000),
        cleanString(error, 4000),
        nowMs()
      )
      .run();
  } catch (auditError) {
    console.error("Mail audit log error:", auditError);
  }
}

async function sendTemplatedBookingMail(env, request, { service, eventKey, row, token, to, extraVars }) {
  if (!row) {
    await logMailAudit(env, {
      service,
      eventKey,
      row,
      to: cleanString(to, 320),
      subject: "",
      status: "skipped",
      error: "missing_row",
    });
    return { skipped: true };
  }
  const destination = cleanString(to || row.email, 320).toLowerCase();
  if (!destination || !destination.includes("@")) {
    await logMailAudit(env, {
      service,
      eventKey,
      row,
      to: destination,
      subject: "",
      status: "skipped",
      error: "invalid_destination",
    });
    return { skipped: true };
  }
  if (row.status === "manual_block" && isClientFacingMailEvent(eventKey)) {
    await logMailAudit(env, {
      service,
      eventKey,
      row,
      to: destination,
      subject: "",
      status: "skipped",
      error: "manual_block_no_client_mail",
    });
    return { skipped: true };
  }
  if (!isLikelyDeliverableEmail(destination)) {
    await logMailAudit(env, {
      service,
      eventKey,
      row,
      to: destination,
      subject: "",
      status: "skipped",
      error: "non_routable_destination",
    });
    return { skipped: true };
  }
  const template = await resolveTemplateForEvent(env, service, eventKey);
  const vars = {
    ...(await buildMailVarsForService(env, request, service, row, token || "")),
    ...(extraVars && typeof extraVars === "object" ? extraVars : {}),
  };
  const subject = normalizeRenderedReservationSubject(renderTemplate(template.subject, vars), vars, row);
  const templateBodyRaw = String(template.bodyHtml || "");
  let html = renderTemplate(templateBodyRaw, vars);
  if (eventKey === "confirm_email" && vars.confirmationLink) {
    html = injectInlineActionButton(html, vars.confirmationLink, { preferredLabel: template.actionLabel || "" });
  }
  const cancelReason = cleanString(vars.cancelReason, 2000);
  if (eventKey === "cancelled_client" && cancelReason) {
    const hasCancelReasonPlaceholder = /\{\{\s*cancelReason\s*\}\}/u.test(templateBodyRaw);
    if (!hasCancelReasonPlaceholder) {
      html += `<p><strong>Powod anulowania:</strong><br>${escapeHtml(cancelReason).replace(/\n/g, "<br>")}</p>`;
    }
  }
  const siteUrl = publicSiteUrl(env, request);
  const brandName =
    service === "hotel"
      ? vars.hotelName || "Średzka Korona"
      : service === "restaurant"
        ? vars.restaurantName || "Średzka Korona"
        : vars.venueName || "Średzka Korona";
  const reservationNo = cleanString(vars.reservationNumber, 120);
  const email = buildBrandedEmail({
    subject,
    htmlFragment: html,
    brandName,
    headerBrandLine: "Średzka Korona",
    headerContextLine: mailHeaderSecondLine(service, eventKey),
    headerNumberLine: reservationNo ? `nr ${reservationNo}` : "",
    serviceLabel: serviceLabel(service),
    siteUrl,
    serviceUrl: `${siteUrl}${serviceLandingPath(service)}`,
    preheader: (() => {
      if (service === "restaurant") {
        if (eventKey === "catering_manual_created_client") {
          const w = cleanString(vars.cateringWhenPlain, 220);
          return w || `Dostawa cateringu — ${vars.reservationNumber || ""}`.trim();
        }
        return `Rezerwacja stolika ${vars.reservationNumber || ""}`.trim();
      }
      return `Rezerwacja ${vars.reservationNumber || ""}`.trim();
    })(),
    actionUrl: eventKey === "pending_admin" ? vars.adminActionLink || "" : "",
    actionLabel:
      eventKey === "pending_admin"
        ? "Otwórz i potwierdź"
        : service === "hall"
          ? "Potwierdź zgłoszenie"
          : eventKey === "catering_manual_created_client"
            ? ""
            : "Potwierdź adres e-mail",
  });
  try {
    const result = await sendMailViaSmtpWithRetry(
      env,
      { to: destination, subject, html: email.html, text: email.text },
      { retries: 1 }
    );
    await logMailAudit(env, {
      service,
      eventKey,
      row,
      to: destination,
      subject,
      envelopeFrom: result?.envelopeFrom || "",
      status: "queued",
      messageId: result?.messageId || "",
      smtpAccepted: cleanString(result?.smtpAccepted, 4000),
    });

    const shadow = readShadowCopyConfig(env);
    if (shadow.active && shadow.recipient && shadow.recipient !== destination) {
      const shadowSubject = `[KOPIA 24h] ${subject}`;
      const shadowText =
        `Kopia techniczna (24h)\n` +
        `Serwis: ${service}\n` +
        `Zdarzenie: ${eventKey}\n` +
        `Odbiorca klienta: ${destination}\n` +
        `Wygasa: ${formatDateTimeWarsaw(shadow.untilMs)}\n\n` +
        `${email.text || ""}`;
      try {
        const shadowResult = await sendMailViaSmtpWithRetry(
          env,
          {
            to: shadow.recipient,
            subject: shadowSubject,
            html: email.html,
            text: shadowText,
          },
          { retries: 1 }
        );
        await logMailAudit(env, {
          service,
          eventKey: `${eventKey}_shadow`,
          row,
          to: shadow.recipient,
          subject: shadowSubject,
          envelopeFrom: shadowResult?.envelopeFrom || "",
          status: "queued",
          messageId: shadowResult?.messageId || "",
          smtpAccepted: cleanString(shadowResult?.smtpAccepted, 4000),
        });
      } catch (shadowError) {
        await logMailAudit(env, {
          service,
          eventKey: `${eventKey}_shadow`,
          row,
          to: shadow.recipient,
          subject: shadowSubject,
          status: "failed",
          error: shadowError?.message || String(shadowError || "shadow_unknown_error"),
        });
      }
    }

    return result;
  } catch (error) {
    await logMailAudit(env, {
      service,
      eventKey,
      row,
      to: destination,
      subject,
      status: "failed",
      error: error?.message || String(error || "unknown_error"),
    });
    throw error;
  }
}

async function notifyPendingAdmins(env, request, service, row) {
  const adminActionToken = await issueAdminActionToken(env, service, row.id);
  const adminActionLink = buildAdminActionLink(env, request, service, adminActionToken);
  const admins = parseAdminNotifyEmails(env);
  for (const adminEmail of admins) {
    await sendTemplatedBookingMail(env, request, {
      service,
      eventKey: "pending_admin",
      row,
      to: adminEmail,
      extraVars: { adminActionLink },
    });
  }
}

async function handlePublicAdminAction(env, op, request, service) {
  if (op === "public-admin-action-view" && request.method === "GET") {
    const url = new URL(request.url);
    const row = await getReservationByAdminActionToken(env, service, url.searchParams.get("token"));
    if (!row) {
      return { status: 404, data: { error: "Link administracyjny wygasł albo rezerwacja została już obsłużona." } };
    }
    return { status: 200, data: await buildAdminActionPayload(env, request, service, row) };
  }
  if (op === "public-admin-action-confirm" && request.method === "POST") {
    const body = await readBody(request);
    const row = await getReservationByAdminActionToken(env, service, body.token);
    if (!row) {
      return { status: 404, data: { error: "Link administracyjny wygasł albo rezerwacja została już obsłużona." } };
    }
    return confirmReservationById(env, request, service, row.id);
  }
  return null;
}

async function handleHotelPublic(env, op, request, verifyTurnstileToken) {
  if (op === "health" && request.method === "GET") {
    return { status: 200, data: { ok: true, service: "hotelApi-d1" } };
  }
  if (op === "public-rooms" && request.method === "GET") {
    const rooms = (await hotelRooms(env))
      .filter((r) => r.active)
      .map((r) => ({
        id: r.id,
        name: r.name,
        pricePerNight: r.pricePerNight,
        maxGuests: r.maxGuests,
        bedsSingle: r.bedsSingle ?? 0,
        bedsDouble: r.bedsDouble ?? 0,
        bedsChild: r.bedsChild ?? 0,
        description: r.description || "",
        imageUrls: r.imageUrls || [],
      }));
    return { status: 200, data: { rooms } };
  }
  const adminAction = await handlePublicAdminAction(env, op, request, "hotel");
  if (adminAction) return adminAction;
  if (op === "public-availability" && request.method === "POST") {
    const body = await readBody(request);
    const out = await hotelAvailability(env, cleanString(body.dateFrom, 10), cleanString(body.dateTo, 10));
    return { status: 200, data: out };
  }
  if (op === "public-reservation-draft" && request.method === "POST") {
    const body = await readBody(request);
    if (cleanString(body.hpCompanyWebsite, 200)) return { status: 200, data: { ok: true } };
    if (verifyTurnstileToken && !(await verifyTurnstileToken(body.turnstileToken || ""))) {
      return { status: 400, data: { error: "Weryfikacja anty-spam nie powiodła się." } };
    }
    try {
      const smtpAvailable = hasSmtpConfig(env);
      assertSession(body.sessionStartedAt);
      assertTerms(body.termsAccepted);
      if (!cleanString(body.fullName, 120) || !cleanString(body.email, 180).includes("@")) {
        return { status: 400, data: { error: "Wypełnij imię i nazwisko oraz poprawny e-mail." } };
      }
      const out = await createHotelReservation(env, body, {
        withConfirmationToken: smtpAvailable,
        status: smtpAvailable ? "email_verification_pending" : "pending",
      });
      const row = await getHotelReservation(env, out.id);
      let requiresEmailConfirmation = smtpAvailable;
      if (smtpAvailable) {
        try {
          await sendTemplatedBookingMail(env, request, {
            service: "hotel",
            eventKey: "confirm_email",
            row,
            token: out.token,
            to: row?.email,
          });
        } catch (error) {
          requiresEmailConfirmation = false;
          console.error("Hotel draft mail error:", error);
          await env.DB.prepare(
            "UPDATE hotel_reservations SET status='pending', confirmation_token_hash=NULL, admin_action_token_hash=NULL, admin_action_expires_at=NULL, email_verification_expires_at=NULL, pending_expires_at=?, updated_at=? WHERE id=?"
          )
            .bind(nowMs() + HOTEL_PENDING_MS, nowMs(), out.id)
            .run();
          try {
            const pendingRow = await getHotelReservation(env, out.id);
            await notifyPendingAdmins(env, request, "hotel", pendingRow);
          } catch (adminError) {
            console.error("Hotel admin notify fallback error:", adminError);
          }
        }
      }
      return {
        status: 200,
        data: {
          ok: true,
          reservationId: out.id,
          humanNumber: out.humanNumber,
          requiresEmailConfirmation,
          message: requiresEmailConfirmation
            ? "Wysłano wiadomość z linkiem potwierdzającym."
            : "Rezerwacja została zapisana jako oczekująca. Jeśli nie widzisz e-maila, sprawdź także folder SPAM.",
        },
      };
    } catch (error) {
      return { status: 400, data: { error: error.message || "Błąd walidacji." } };
    }
  }
  if (op === "public-reservation-confirm" && request.method === "POST") {
    const body = await readBody(request);
    const token = cleanString(body.token, 500);
    if (!token) return { status: 400, data: { error: "Brak tokenu." } };
    const tokenHash = await sha256Hex(token);
    const row = await env.DB.prepare(
      "SELECT * FROM hotel_reservations WHERE confirmation_token_hash = ? LIMIT 1"
    )
      .bind(tokenHash)
      .first();
    if (!row) return { status: 400, data: { error: "Nieprawidłowy lub wygasły link." } };
    if (row.status === "pending" || row.status === "confirmed") {
      return { status: 200, data: { ok: true, reservationId: row.id, humanNumber: row.human_number, status: row.status } };
    }
    if (row.status !== "email_verification_pending") {
      return { status: 400, data: { error: row.status === "expired" ? "Link potwierdzający wygasł." : "Ta rezerwacja została już przetworzona." } };
    }
    if (row.email_verification_expires_at && Number(row.email_verification_expires_at) < nowMs()) {
      await notifyEmailVerificationExpiredClient(env, request, "hotel", row);
      await env.DB.prepare(
        "UPDATE hotel_reservations SET status='expired', admin_action_token_hash=NULL, admin_action_expires_at=NULL, email_verification_expires_at=NULL, updated_at=? WHERE id=?"
      )
        .bind(nowMs(), row.id)
        .run();
      return { status: 400, data: { error: "Link potwierdzający wygasł." } };
    }
    try {
      const roomIds = parseJson(row.room_ids_json, []);
      await assertHotelRoomIdsAvailable(env, roomIds, row.date_from, row.date_to, row.id);
      await env.DB.prepare(
        "UPDATE hotel_reservations SET status='pending', admin_action_token_hash=NULL, admin_action_expires_at=NULL, email_verification_expires_at=NULL, pending_expires_at=?, updated_at=? WHERE id=?"
      )
        .bind(nowMs() + HOTEL_PENDING_MS, nowMs(), row.id)
        .run();
      try {
        const pendingRow = await getHotelReservation(env, row.id);
        await notifyPendingAdmins(env, request, "hotel", pendingRow);
      } catch (mailError) {
        console.error("Hotel pending mail error:", mailError);
      }
      return { status: 200, data: { ok: true, reservationId: row.id, humanNumber: row.human_number } };
    } catch (error) {
      return { status: 409, data: { error: error.message || "Konflikt terminów." } };
    }
  }
  return null;
}

async function handleRestaurantPublic(env, op, request, verifyTurnstileToken) {
  if (op === "health" && request.method === "GET") {
    return { status: 200, data: { ok: true, service: "restaurantApi-d1" } };
  }
  const adminAction = await handlePublicAdminAction(env, op, request, "restaurant");
  if (adminAction) return adminAction;
  if (op === "public-settings" && request.method === "GET") {
    const url = new URL(request.url);
    const requestedDate = cleanString(url.searchParams.get("reservationDate"), 10);
    const reservationDate = isYmd(requestedDate) ? requestedDate : todayYmdInWarsaw();
    const settings = await loadRestaurantSettings(env);
    const tables = await restaurantTables(env, false);
    const dayWindow = await resolveRestaurantWindowForDate(env, settings, reservationDate);
    const slots = dayWindow.closed
      ? []
      : buildTimeSlotsFromMinutes(dayWindow.openMinutes, dayWindow.closeMinutes, settings.timeSlotMinutes);
    return {
      status: 200,
      data: {
        maxGuestsPerTable: Number(settings.maxGuestsPerTable || 4),
        tableCount: tables.length,
        selectedDate: reservationDate,
        closedForDay: Boolean(dayWindow.closed),
        reservationOpenTime: dayWindow.closed ? "" : dayWindow.openLabel,
        reservationCloseTime: dayWindow.closed ? "" : dayWindow.closeLabel,
        reservationHoursSource: dayWindow.source || "settings",
        timeSlotMinutes: Number(settings.timeSlotMinutes || 30),
        timeSlots: dayWindow.closed
          ? []
          : slots.length
            ? slots
            : ["12:00", "13:00", "14:00", "18:00", "19:00", "20:00"],
        restaurantName: "Średzka Korona — Restauracja",
      },
    };
  }
  if (op === "public-calendar" && request.method === "POST") {
    const body = await readBody(request);
    try {
      const calendar = await restaurantCalendarAvailability(env, body);
      return { status: 200, data: calendar };
    } catch (error) {
      return { status: 400, data: { error: error.message || "Nie udało się pobrać kalendarza restauracji." } };
    }
  }
  if (op === "public-availability" && request.method === "POST") {
    const body = await readBody(request);
    try {
      const chk = await assertRestaurantAvailability(env, body, null);
      return { status: 200, data: { ok: chk.ok, available: chk.ok, message: chk.ok ? null : "Brak wolnych stolików." } };
    } catch (error) {
      return { status: 400, data: { error: error.message || "Błąd walidacji." } };
    }
  }
  if (op === "public-reservation-draft" && request.method === "POST") {
    const body = await readBody(request);
    if (cleanString(body.hpCompanyWebsite, 200)) return { status: 200, data: { ok: true } };
    if (verifyTurnstileToken && !(await verifyTurnstileToken(body.turnstileToken || ""))) {
      return { status: 400, data: { error: "Weryfikacja anty-spam nie powiodła się." } };
    }
    try {
      const smtpAvailable = hasSmtpConfig(env);
      assertSession(body.sessionStartedAt);
      assertTerms(body.termsAccepted);
      if (!cleanString(body.fullName, 120) || !cleanString(body.email, 180).includes("@")) {
        return { status: 400, data: { error: "Wypełnij imię i nazwisko oraz poprawny e-mail." } };
      }
      const out = await createRestaurantReservation(env, body, {
        withConfirmationToken: smtpAvailable,
        status: smtpAvailable ? "email_verification_pending" : "pending",
      });
      const row = await getRestaurantReservationRow(env, out.id);
      let requiresEmailConfirmation = smtpAvailable;
      if (smtpAvailable) {
        try {
          await sendTemplatedBookingMail(env, request, {
            service: "restaurant",
            eventKey: "confirm_email",
            row,
            token: out.token,
            to: row?.email,
          });
        } catch (error) {
          requiresEmailConfirmation = false;
          console.error("Restaurant draft mail error:", error);
          await env.DB.prepare(
            "UPDATE restaurant_reservations SET status='pending', confirmation_token_hash=NULL, admin_action_token_hash=NULL, admin_action_expires_at=NULL, email_verification_expires_at=NULL, pending_expires_at=?, updated_at=? WHERE id=?"
          )
            .bind(nowMs() + RESTAURANT_PENDING_MS, nowMs(), out.id)
            .run();
          try {
            const pendingRow = await getRestaurantReservationRow(env, out.id);
            await notifyPendingAdmins(env, request, "restaurant", pendingRow);
          } catch (adminError) {
            console.error("Restaurant admin notify fallback error:", adminError);
          }
        }
      }
      return {
        status: 200,
        data: {
          ok: true,
          reservationId: out.id,
          humanNumber: out.humanNumber,
          requiresEmailConfirmation,
          message: requiresEmailConfirmation
            ? "Wysłano wiadomość z linkiem potwierdzającym."
            : "Rezerwacja została zapisana jako oczekująca. Jeśli nie widzisz e-maila, sprawdź także folder SPAM.",
        },
      };
    } catch (error) {
      return { status: 400, data: { error: error.message || "Błąd walidacji." } };
    }
  }
  if (op === "public-reservation-confirm" && request.method === "POST") {
    const body = await readBody(request);
    const token = cleanString(body.token, 500);
    if (!token) return { status: 400, data: { error: "Brak tokenu." } };
    const tokenHash = await sha256Hex(token);
    const row = await env.DB.prepare(
      "SELECT * FROM restaurant_reservations WHERE confirmation_token_hash = ? LIMIT 1"
    )
      .bind(tokenHash)
      .first();
    if (!row) return { status: 400, data: { error: "Nieprawidłowy lub wygasły link." } };
    if (row.status === "pending" || row.status === "confirmed") {
      return { status: 200, data: { ok: true, reservationId: row.id, humanNumber: row.human_number, status: row.status } };
    }
    if (row.status !== "email_verification_pending") {
      return { status: 400, data: { error: row.status === "expired" ? "Link potwierdzający wygasł." : "Ta rezerwacja została już przetworzona." } };
    }
    if (row.email_verification_expires_at && Number(row.email_verification_expires_at) < nowMs()) {
      await notifyEmailVerificationExpiredClient(env, request, "restaurant", row);
      await env.DB.prepare(
        "UPDATE restaurant_reservations SET status='expired', admin_action_token_hash=NULL, admin_action_expires_at=NULL, email_verification_expires_at=NULL, updated_at=? WHERE id=?"
      )
        .bind(nowMs(), row.id)
        .run();
      return { status: 400, data: { error: "Link potwierdzający wygasł." } };
    }
    try {
      const existingAssigned = parseJson(row.assigned_table_ids_json, []).filter(Boolean);
      const assigned =
        existingAssigned.length >= Number(row.tables_count)
          ? existingAssigned.slice(0, Number(row.tables_count))
          : await restaurantAvailableTableIds(
              env,
              Number(row.start_ms),
              Number(row.end_ms),
              Number(row.tables_count),
              row.id
            );
      if (assigned.length < Number(row.tables_count)) {
        return { status: 409, data: { error: "Brak wolnych stolików w tym terminie." } };
      }
      await env.DB.prepare(
        "UPDATE restaurant_reservations SET status='pending', assigned_table_ids_json=?, admin_action_token_hash=NULL, admin_action_expires_at=NULL, email_verification_expires_at=NULL, pending_expires_at=?, updated_at=? WHERE id=?"
      )
        .bind(toJson(assigned), nowMs() + RESTAURANT_PENDING_MS, nowMs(), row.id)
        .run();
      try {
        const pendingRow = await getRestaurantReservationRow(env, row.id);
        await notifyPendingAdmins(env, request, "restaurant", pendingRow);
      } catch (mailError) {
        console.error("Restaurant pending mail error:", mailError);
      }
      return { status: 200, data: { ok: true, reservationId: row.id, humanNumber: row.human_number } };
    } catch (error) {
      return { status: 409, data: { error: error.message || "Konflikt terminów." } };
    }
  }
  return null;
}

async function handleHallPublic(env, op, request, verifyTurnstileToken) {
  if (op === "health" && request.method === "GET") {
    return { status: 200, data: { ok: true, service: "hallApi-d1" } };
  }
  const adminAction = await handlePublicAdminAction(env, op, request, "hall");
  if (adminAction) return adminAction;
  if (op === "public-halls" && request.method === "GET") {
    const halls = (await venueHalls(env))
      .filter((h) => h.active)
      .map((h) => ({
        id: h.id,
        name: h.name,
        capacity: h.capacity,
        hallKind: h.hallKind,
        description: h.description || "",
        bufferMinutes: h.bufferMinutes,
        fullBlockGuestThreshold: h.fullBlockGuestThreshold,
        sortOrder: h.sortOrder,
      }));
    return { status: 200, data: { halls } };
  }
  if (op === "public-calendar" && request.method === "POST") {
    const body = await readBody(request);
    try {
      const calendar = await hallCalendarAvailability(env, body);
      return { status: 200, data: calendar };
    } catch (error) {
      return { status: 400, data: { error: error.message || "Nie udało się pobrać kalendarza sal." } };
    }
  }
  if (op === "public-availability" && request.method === "POST") {
    const body = await readBody(request);
    try {
      const chk = await hallAvailability(env, body, null);
      if (!chk.ok) {
        return { status: 200, data: { ok: false, available: false, maxGuests: chk.maxGuests || 0 } };
      }
      return { status: 200, data: { ok: true, available: true, maxGuests: chk.maxGuests || chk.hall.capacity } };
    } catch (error) {
      return { status: 400, data: { error: error.message || "Błąd walidacji." } };
    }
  }
  if (op === "public-reservation-draft" && request.method === "POST") {
    const body = await readBody(request);
    if (cleanString(body.hpCompanyWebsite, 200)) return { status: 200, data: { ok: true } };
    if (verifyTurnstileToken && !(await verifyTurnstileToken(body.turnstileToken || ""))) {
      return { status: 400, data: { error: "Weryfikacja anty-spam nie powiodła się." } };
    }
    try {
      const smtpAvailable = hasSmtpConfig(env);
      assertSession(body.sessionStartedAt);
      assertTerms(body.termsAccepted);
      if (!cleanString(body.fullName, 120) || !cleanString(body.email, 180).includes("@")) {
        return { status: 400, data: { error: "Wypełnij imię i nazwisko oraz poprawny e-mail." } };
      }
      if (!cleanString(body.eventType, 500)) {
        return { status: 400, data: { error: "Podaj rodzaj imprezy." } };
      }
      const out = await createHallReservation(env, body, {
        withConfirmationToken: smtpAvailable,
        status: smtpAvailable ? "email_verification_pending" : "pending",
      });
      const row = await getHallReservationRow(env, out.id);
      let requiresEmailConfirmation = smtpAvailable;
      if (smtpAvailable) {
        try {
          await sendTemplatedBookingMail(env, request, {
            service: "hall",
            eventKey: "confirm_email",
            row,
            token: out.token,
            to: row?.email,
          });
        } catch (error) {
          requiresEmailConfirmation = false;
          console.error("Hall draft mail error:", error);
          await env.DB.prepare(
            "UPDATE venue_reservations SET status='pending', confirmation_token_hash=NULL, admin_action_token_hash=NULL, admin_action_expires_at=NULL, email_verification_expires_at=NULL, pending_expires_at=?, updated_at=? WHERE id=?"
          )
            .bind(nowMs() + HALL_PENDING_MS, nowMs(), out.id)
            .run();
          try {
            const pendingRow = await getHallReservationRow(env, out.id);
            await notifyPendingAdmins(env, request, "hall", pendingRow);
          } catch (adminError) {
            console.error("Hall admin notify fallback error:", adminError);
          }
        }
      }
      return {
        status: 200,
        data: {
          ok: true,
          reservationId: out.id,
          humanNumber: out.humanNumber,
          requiresEmailConfirmation,
          message: requiresEmailConfirmation
            ? "Wysłano wiadomość z linkiem potwierdzającym."
            : "Rezerwacja została zapisana jako oczekująca. Jeśli nie widzisz e-maila, sprawdź także folder SPAM.",
        },
      };
    } catch (error) {
      return { status: 400, data: { error: error.message || "Błąd walidacji." } };
    }
  }
  if (op === "public-reservation-confirm" && request.method === "POST") {
    const body = await readBody(request);
    const token = cleanString(body.token, 500);
    if (!token) return { status: 400, data: { error: "Brak tokenu." } };
    const tokenHash = await sha256Hex(token);
    const row = await env.DB.prepare(
      "SELECT * FROM venue_reservations WHERE confirmation_token_hash = ? LIMIT 1"
    )
      .bind(tokenHash)
      .first();
    if (!row) return { status: 400, data: { error: "Nieprawidłowy lub wygasły link." } };
    if (row.status === "pending" || row.status === "confirmed") {
      return { status: 200, data: { ok: true, reservationId: row.id, humanNumber: row.human_number, status: row.status } };
    }
    if (row.status !== "email_verification_pending") {
      return { status: 400, data: { error: row.status === "expired" ? "Link potwierdzający wygasł." : "Ta rezerwacja została już przetworzona." } };
    }
    if (row.email_verification_expires_at && Number(row.email_verification_expires_at) < nowMs()) {
      await notifyEmailVerificationExpiredClient(env, request, "hall", row);
      await env.DB.prepare(
        "UPDATE venue_reservations SET status='expired', admin_action_token_hash=NULL, admin_action_expires_at=NULL, email_verification_expires_at=NULL, updated_at=? WHERE id=?"
      )
        .bind(nowMs(), row.id)
        .run();
      return { status: 400, data: { error: "Link potwierdzający wygasł." } };
    }
    try {
      const chk = await hallAvailability(
        env,
        {
          hallId: row.hall_id,
          reservationDate: row.reservation_date,
          startTime: row.start_time,
          durationHours: row.duration_hours,
          guestsCount: row.guests_count,
          exclusive: Boolean(row.exclusive),
        },
        row.id,
        { skipMinAdvance: true }
      );
      if (!chk.ok) return { status: 409, data: { error: "Termin niedostępny." } };
      await env.DB.prepare(
        "UPDATE venue_reservations SET status='pending', admin_action_token_hash=NULL, admin_action_expires_at=NULL, email_verification_expires_at=NULL, pending_expires_at=?, updated_at=? WHERE id=?"
      )
        .bind(nowMs() + HALL_PENDING_MS, nowMs(), row.id)
        .run();
      try {
        const pendingRow = await getHallReservationRow(env, row.id);
        await notifyPendingAdmins(env, request, "hall", pendingRow);
      } catch (mailError) {
        console.error("Hall pending mail error:", mailError);
      }
      return { status: 200, data: { ok: true, reservationId: row.id, humanNumber: row.human_number } };
    } catch (error) {
      return { status: 409, data: { error: error.message || "Konflikt terminów." } };
    }
  }
  return null;
}

async function handleHotelAdmin(env, op, request) {
  if (op === "admin-rooms-list" && request.method === "GET") {
    const rooms = await hotelRooms(env);
    return { status: 200, data: { rooms } };
  }
  if (op === "admin-room-upsert" && request.method === "PUT") {
    const body = await readBody(request);
    const id = cleanString(body.id, 80);
    if (!id) return { status: 400, data: { error: "Brak ID pokoju." } };
    await env.DB.prepare(
      `INSERT INTO hotel_rooms (id, name, price_per_night, max_guests, beds_single, beds_double, beds_child, description, image_urls_json, active, sort_order, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, price_per_night=excluded.price_per_night, max_guests=excluded.max_guests,
         beds_single=excluded.beds_single, beds_double=excluded.beds_double, beds_child=excluded.beds_child,
         description=excluded.description, image_urls_json=excluded.image_urls_json, active=excluded.active,
         sort_order=excluded.sort_order, updated_at=excluded.updated_at`
    )
      .bind(
        id,
        cleanString(body.name || id, 120),
        Number(body.pricePerNight || 0),
        Math.max(1, toInt(body.maxGuests, 2)),
        Math.max(0, toInt(body.bedsSingle, 0)),
        Math.max(0, toInt(body.bedsDouble, 1)),
        Math.max(0, toInt(body.bedsChild, 0)),
        cleanString(body.description, 2000),
        toJson(Array.isArray(body.imageUrls) ? body.imageUrls : []),
        body.active === false ? 0 : 1,
        toInt(body.sortOrder, 0),
        nowMs()
      )
      .run();
    return { status: 200, data: { ok: true } };
  }
  if (op === "admin-room-delete" && ["DELETE", "POST"].includes(request.method)) {
    const url = new URL(request.url);
    const body = await readBody(request).catch(() => ({}));
    const id = cleanString(url.searchParams.get("id") || body?.id, 80);
    if (!id) return { status: 400, data: { error: "Brak ID pokoju." } };
    try {
      await assertHotelRoomDeletable(env, id);
      await env.DB.prepare("DELETE FROM hotel_rooms WHERE id = ?").bind(id).run();
      return { status: 200, data: { ok: true } };
    } catch (error) {
      return { status: 400, data: { error: error.message || "Nie można usunąć pokoju." } };
    }
  }
  if (op === "admin-reservations-list" && request.method === "GET") {
    const url = new URL(request.url);
    const status = cleanString(url.searchParams.get("status"), 40);
    const reservations = await listHotelReservations(env, status);
    return { status: 200, data: { reservations } };
  }
  if (op === "admin-reservation-get" && request.method === "GET") {
    const url = new URL(request.url);
    const id = cleanString(url.searchParams.get("id"), 80);
    const row = await getHotelReservation(env, id);
    if (!row) return { status: 404, data: { error: "Brak rezerwacji." } };
    return { status: 200, data: { reservation: mapHotelReservation(row) } };
  }
  if (op === "admin-reservation-create" && request.method === "POST") {
    const body = await readBody(request);
    try {
      const status = ["pending", "confirmed", "manual_block"].includes(body.status) ? body.status : "confirmed";
      const out = await createHotelReservation(env, body, {
        status,
        withConfirmationToken: false,
        skipAvailabilityCheck: status === "manual_block",
      });
      return { status: 200, data: { ok: true, reservationId: out.id, humanNumber: out.humanNumber } };
    } catch (error) {
      return { status: 400, data: { error: error.message || "Błąd tworzenia." } };
    }
  }
  if (op === "admin-manual-block" && request.method === "POST") {
    const body = await readBody(request);
    try {
      let dateFrom = cleanString(body.dateFrom, 10);
      let dateTo = cleanString(body.dateTo, 10);
      if (dateFrom && dateTo && dateFrom === dateTo) {
        dateTo = addOneDayYmd(dateFrom);
      }
      const out = await createHotelReservation(
        env,
        {
          ...body,
          dateFrom,
          dateTo,
          fullName: "Blokada terminu",
          email: "",
          phonePrefix: "+48",
          phoneNational: "000000000",
          customerNote: cleanString(body.note, 2000),
          adminNote: cleanString(body.note, 2000),
        },
        { status: "manual_block", withConfirmationToken: false, skipAvailabilityCheck: true }
      );
      return { status: 200, data: { ok: true, reservationId: out.id } };
    } catch (error) {
      return { status: 400, data: { error: error.message || "Błąd blokady." } };
    }
  }
  if (op === "admin-reservation-update" && request.method === "PATCH") {
    const body = await readBody(request);
    const id = cleanString(body.id, 80);
    const row = await getHotelReservation(env, id);
    if (!row) return { status: 404, data: { error: "Brak rezerwacji." } };
    const notifyClient = Boolean(body.notifyClient);
    const fullEdit =
      body.dateFrom != null ||
      body.dateTo != null ||
      Array.isArray(body.roomIds) ||
      body.fullName != null ||
      body.email != null ||
      body.phonePrefix != null ||
      body.phoneNational != null ||
      body.customerNote != null;
    if (!fullEdit) {
      await env.DB.prepare("UPDATE hotel_reservations SET admin_note=?, updated_at=? WHERE id=?")
        .bind(cleanString(body.adminNote, 2000), nowMs(), id)
        .run();
      return { status: 200, data: { ok: true } };
    }
    try {
      const dateFrom = cleanString(body.dateFrom ?? row.date_from, 10);
      let dateTo = cleanString(body.dateTo ?? row.date_to, 10);
      if (dateFrom && dateTo && dateFrom === dateTo) {
        dateTo = addOneDayYmd(dateFrom);
      }
      assertDateRange(dateFrom, dateTo);
      const roomIds = Array.isArray(body.roomIds)
        ? body.roomIds.map((x) => cleanString(x, 80)).filter(Boolean)
        : parseJson(row.room_ids_json, []);
      await assertHotelRoomIdsAvailable(env, roomIds, dateFrom, dateTo, id);
      const phone = normalizePhone(body.phonePrefix ?? row.phone_prefix, body.phoneNational ?? row.phone_national);
      const activeRooms = await hotelRooms(env);
      const byId = new Map(activeRooms.map((r) => [r.id, r]));
      const nights = nightsCount(dateFrom, dateTo);
      let totalPrice = 0;
      roomIds.forEach((rid) => {
        const room = byId.get(rid);
        totalPrice += Number(room?.pricePerNight || 0) * nights;
      });
      await env.DB.prepare(
        `UPDATE hotel_reservations SET
          customer_name=?, email=?, phone_prefix=?, phone_national=?, phone_e164=?,
          date_from=?, date_to=?, total_price=?, customer_note=?, admin_note=?,
          room_ids_json=?, updated_at=?
         WHERE id=?`
      )
        .bind(
          cleanString(body.fullName ?? row.customer_name, 120),
          cleanString(body.email ?? row.email, 180).toLowerCase(),
          phone.prefix,
          phone.national,
          phone.e164,
          dateFrom,
          dateTo,
          totalPrice,
          cleanString(body.customerNote ?? row.customer_note, 2000),
          cleanString(body.adminNote ?? row.admin_note, 2000),
          toJson(roomIds),
          nowMs(),
          id
        )
        .run();
      if (notifyClient) {
        try {
          const updated = await getHotelReservation(env, id);
          await sendTemplatedBookingMail(env, request, {
            service: "hotel",
            eventKey: "changed_client",
            row: updated,
            to: updated?.email,
          });
        } catch (error) {
          console.error("Hotel changed mail error:", error);
        }
      }
      return { status: 200, data: { ok: true } };
    } catch (error) {
      return { status: 400, data: { error: error.message || "Błąd zapisu." } };
    }
  }
  if (op === "admin-reservation-confirm" && request.method === "POST") {
    const body = await readBody(request);
    const id = cleanString(body.id, 80);
    await env.DB.prepare(
      "UPDATE hotel_reservations SET status='confirmed', pending_expires_at=NULL, admin_action_token_hash=NULL, admin_action_expires_at=NULL, updated_at=? WHERE id=?"
    )
      .bind(nowMs(), id)
      .run();
    try {
      const row = await getHotelReservation(env, id);
      await sendTemplatedBookingMail(env, request, {
        service: "hotel",
        eventKey: "confirmed_client",
        row,
        to: row?.email,
      });
    } catch (error) {
      console.error("Hotel confirm mail error:", error);
    }
    return { status: 200, data: { ok: true } };
  }
  if (op === "admin-reservation-cancel" && request.method === "POST") {
    const body = await readBody(request);
    const id = cleanString(body.id, 80);
    const cancelReason = cleanString(body.cancelReason, 2000);
    const existing = await getHotelReservation(env, id);
    if (!existing) return { status: 404, data: { error: "Brak rezerwacji." } };
    if (existing.status !== "manual_block") {
      const reservationEndMs = Date.parse(`${cleanString(existing.date_to, 10)}T00:00:00`);
      if (Number.isFinite(reservationEndMs) && reservationEndMs <= nowMs()) {
        return { status: 400, data: { error: "Nie można odwołać rezerwacji, która już minęła." } };
      }
    }
    if (existing.status !== "manual_block" && !cancelReason) {
      return { status: 400, data: { error: "Podaj powód anulowania rezerwacji." } };
    }
    await env.DB.prepare(
      "UPDATE hotel_reservations SET status='cancelled', pending_expires_at=NULL, admin_action_token_hash=NULL, admin_action_expires_at=NULL, updated_at=? WHERE id=?"
    )
      .bind(nowMs(), id)
      .run();
    try {
      const row = await getHotelReservation(env, id);
      await sendTemplatedBookingMail(env, request, {
        service: "hotel",
        eventKey: "cancelled_client",
        row,
        to: row?.email,
        extraVars: { cancelReason },
      });
    } catch (error) {
      console.error("Hotel cancel mail error:", error);
    }
    return { status: 200, data: { ok: true } };
  }
  if (op === "admin-mail-templates" && request.method === "GET") {
    return { status: 200, data: { templates: await loadTemplates(env, "hotel") } };
  }
  if (op === "admin-mail-template-save" && request.method === "PUT") {
    const body = await readBody(request);
    await saveTemplate(env, "hotel", body.key, body.subject, body.bodyHtml, body.actionLabel);
    return { status: 200, data: { ok: true } };
  }
  return null;
}

async function handleRestaurantAdmin(env, op, request) {
  if (op === "admin-settings" && request.method === "GET") {
    return { status: 200, data: { settings: await loadRestaurantSettings(env) } };
  }
  if (op === "admin-settings-save" && request.method === "PUT") {
    const body = await readBody(request);
    const tableCount = Math.max(1, toInt(body.tableCount, 5));
    const now = nowMs();
    await env.DB.prepare(
      "UPDATE restaurant_settings SET table_count=?, max_guests_per_table=?, reservation_open_time=?, reservation_close_time=?, time_slot_minutes=?, updated_at=? WHERE id='default'"
    )
      .bind(
        tableCount,
        Math.max(1, toInt(body.maxGuestsPerTable, 4)),
        cleanString(body.reservationOpenTime, 5) || "12:00",
        cleanString(body.reservationCloseTime, 5) || "22:00",
        [15, 30, 60].includes(toInt(body.timeSlotMinutes, 30)) ? toInt(body.timeSlotMinutes, 30) : 30,
        now
      )
      .run();
    const existing = await restaurantTables(env, true);
    const existingByNumber = new Map(existing.map((t) => [t.number, t]));
    for (let n = 1; n <= tableCount; n += 1) {
      if (!existingByNumber.has(n)) {
        const id = `table-${n}`;
        await env.DB.prepare(
          "INSERT INTO restaurant_tables (id, number, zone, active, hidden, description, sort_order, updated_at) VALUES (?, ?, 'sala', 1, 0, '', ?, ?)"
        )
          .bind(id, n, n, now)
          .run();
      }
    }
    return { status: 200, data: { ok: true, warnings: [] } };
  }
  if (op === "admin-tables-list" && request.method === "GET") {
    const out = await env.DB.prepare(
      "SELECT id, number, zone, active, hidden, description, sort_order AS sortOrder FROM restaurant_tables ORDER BY sort_order ASC, number ASC"
    ).all();
    const tables = (out.results || []).map((t) => ({
      id: t.id,
      number: Number(t.number || 0),
      zone: t.zone || "sala",
      active: Boolean(t.active),
      hidden: Boolean(t.hidden),
      description: t.description || "",
      sortOrder: Number(t.sortOrder || 0),
    }));
    return { status: 200, data: { tables } };
  }
  if (op === "admin-table-upsert" && request.method === "PUT") {
    const body = await readBody(request);
    const id = cleanString(body.id, 80);
    await env.DB.prepare(
      `INSERT INTO restaurant_tables (id, number, zone, active, hidden, description, sort_order, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         number=excluded.number, zone=excluded.zone, active=excluded.active, hidden=excluded.hidden,
         description=excluded.description, sort_order=excluded.sort_order, updated_at=excluded.updated_at`
    )
      .bind(
        id,
        Math.max(1, toInt(body.number, 1)),
        cleanString(body.zone, 40) || "sala",
        body.active === false ? 0 : 1,
        body.hidden ? 1 : 0,
        cleanString(body.description, 1000),
        toInt(body.sortOrder, 0),
        nowMs()
      )
      .run();
    return { status: 200, data: { ok: true } };
  }
  if (op === "admin-table-create" && request.method === "POST") {
    const now = nowMs();
    const maxNumRow = await env.DB.prepare("SELECT COALESCE(MAX(number), 0) AS m FROM restaurant_tables").first();
    const maxSortRow = await env.DB.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM restaurant_tables").first();
    const nextNumber = Number(maxNumRow?.m || 0) + 1;
    const nextSortOrder = Number(maxSortRow?.m || 0) + 1;
    const suffix =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${now}-${Math.random().toString(36).slice(2, 10)}`;
    const id = `table-${nextNumber}-${suffix}`;
    try {
      await env.DB.prepare(
        "INSERT INTO restaurant_tables (id, number, zone, active, hidden, description, sort_order, updated_at) VALUES (?, ?, 'sala', 1, 0, '', ?, ?)"
      )
        .bind(id, nextNumber, nextSortOrder, now)
        .run();
    } catch (error) {
      const msg = String(error?.message || "nie udało się dodać stolika.");
      return {
        status: 409,
        data: {
          error: msg.includes("UNIQUE") || msg.includes("constraint") ? "Konflikt zapisu stolika — odśwież listę i spróbuj ponownie." : msg,
        },
      };
    }
    const countRow = await env.DB.prepare("SELECT COUNT(*) AS c FROM restaurant_tables").first();
    const tableCount = Math.max(1, Number(countRow?.c || 0));
    await env.DB.prepare("UPDATE restaurant_settings SET table_count=?, updated_at=? WHERE id='default'")
      .bind(tableCount, now)
      .run();
    return { status: 200, data: { ok: true, table: { id, number: nextNumber } } };
  }
  if (op === "admin-table-delete" && ["DELETE", "POST"].includes(request.method)) {
    const url = new URL(request.url);
    const body = await readBody(request).catch(() => ({}));
    const id = cleanString(body.id || url.searchParams.get("id"), 80);
    if (!id) return { status: 400, data: { error: "Brak id stolika." } };
    const target = await env.DB.prepare("SELECT id FROM restaurant_tables WHERE id=?").bind(id).first();
    if (!target) return { status: 404, data: { error: "Stolik nie istnieje." } };
    const now = nowMs();
    const futureRowsRes = await env.DB.prepare(
      `SELECT assigned_table_ids_json AS assignedTableIdsJson
       FROM restaurant_reservations
       WHERE status IN ('email_verification_pending','pending','confirmed','manual_block')
         AND (end_ms + (COALESCE(cleanup_buffer_minutes, ${RESTAURANT_CLEANUP_BUFFER_MINUTES}) * 60000)) > ?`
    )
      .bind(now)
      .all();
    const hasFutureAssignment = (futureRowsRes.results || []).some((row) => {
      const ids = parseJson(row.assignedTableIdsJson, []);
      return Array.isArray(ids) && ids.includes(id);
    });
    if (hasFutureAssignment) {
      return { status: 409, data: { error: "Nie mozna usunac stolika z przyszla rezerwacja lub blokada." } };
    }
    await env.DB.prepare("DELETE FROM restaurant_tables WHERE id=?").bind(id).run();
    const countRow = await env.DB.prepare("SELECT COUNT(*) AS c FROM restaurant_tables").first();
    const tableCount = Math.max(1, Number(countRow?.c || 0));
    await env.DB.prepare("UPDATE restaurant_settings SET table_count=?, updated_at=? WHERE id='default'")
      .bind(tableCount, now)
      .run();
    return { status: 200, data: { ok: true } };
  }
  if (op === "admin-reservations-list" && request.method === "GET") {
    const url = new URL(request.url);
    const status = cleanString(url.searchParams.get("status"), 40);
    return { status: 200, data: { reservations: await listRestaurantReservations(env, status) } };
  }
  if (op === "admin-reservation-get" && request.method === "GET") {
    const url = new URL(request.url);
    const id = cleanString(url.searchParams.get("id"), 80);
    const row = await env.DB.prepare("SELECT * FROM restaurant_reservations WHERE id=?")
      .bind(id)
      .first();
    if (!row) return { status: 404, data: { error: "Brak rezerwacji." } };
    const tables = await restaurantTables(env, true);
    const map = new Map(tables.map((t) => [t.id, t]));
    const recRow = row.recipient_id ? await getCateringRecipientRow(env, row.recipient_id) : null;
    return { status: 200, data: { reservation: mapRestaurantReservation(row, map, recRow) } };
  }
  if (op === "admin-catering-recipients-list" && request.method === "GET") {
    return { status: 200, data: { recipients: await listCateringRecipients(env) } };
  }
  if (op === "admin-catering-recipient-save" && request.method === "PUT") {
    const body = await readBody(request);
    try {
      const recipient = await upsertCateringRecipient(env, body);
      return { status: 200, data: { ok: true, recipient } };
    } catch (error) {
      return { status: 400, data: { error: error.message || "Błąd zapisu odbiorcy." } };
    }
  }
  if (op === "admin-catering-recipient-delete" && ["DELETE", "POST"].includes(request.method)) {
    const url = new URL(request.url);
    const body = await readBody(request).catch(() => ({}));
    const id = cleanString(body.id || url.searchParams.get("id"), 80);
    if (!id) return { status: 400, data: { error: "Brak id odbiorcy." } };
    const now = nowMs();
    const inUse = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM restaurant_reservations
       WHERE recipient_id = ?
         AND status IN ('email_verification_pending','pending','confirmed','manual_block')
         AND (end_ms + (COALESCE(cleanup_buffer_minutes, ${RESTAURANT_CLEANUP_BUFFER_MINUTES}) * 60000)) > ?`
    )
      .bind(id, now)
      .first();
    if (Number(inUse?.c || 0) > 0) {
      return {
        status: 409,
        data: { error: "Nie można usunąć odbiorcy powiązanego z aktywną lub przyszłą rezerwacją dostawy." },
      };
    }
    await env.DB.prepare("DELETE FROM catering_recipients WHERE id=?").bind(id).run();
    return { status: 200, data: { ok: true } };
  }
  if (op === "admin-catering-delivery-create" && request.method === "POST") {
    const body = await readBody(request);
    try {
      const recipientId = cleanString(body.recipientId, 80);
      if (!recipientId) return { status: 400, data: { error: "Wybierz odbiorcę." } };
      const startTime = cleanString(body.startTime, 5);
      const durationHours = 1;
      if (!isHm(startTime)) return { status: 400, data: { error: "Nieprawidłowa godzina." } };
      const repeatModeRaw = cleanString(body.repeatMode, 24).toLowerCase();
      if (
        repeatModeRaw &&
        repeatModeRaw !== "none" &&
        !body.repeatIndefinite &&
        !cleanString(body.repeatUntil, 10)
      ) {
        return {
          status: 400,
          data: { error: "Podaj datę końca powtarzania albo zaznacz „bezterminowo”." },
        };
      }
      const dates = expandCateringRepeatDates(
        cleanString(body.reservationDate, 10),
        body.repeatMode,
        body.repeatWeekday,
        cleanString(body.repeatUntil, 10),
        {
          repeatIndefinite: Boolean(body.repeatIndefinite),
          repeatWeekdays: Array.isArray(body.repeatWeekdays) ? body.repeatWeekdays : [],
        }
      );
      const description = cleanString(body.description, 2000);
      const adminNote = cleanString(body.adminNote, 2000);
      const status = ["pending", "confirmed"].includes(cleanString(body.status, 20)) ? body.status : "confirmed";
      const createdIds = [];
      for (const reservationDate of dates) {
        if (!isYmd(reservationDate)) continue;
        const out = await createRestaurantReservation(
          env,
          {
            reservationDate,
            startTime,
            durationHours,
            tablesCount: 1,
            guestsCount: 1,
            joinTables: false,
            placePreference: "no_preference",
            fullName: "",
            email: "",
            phonePrefix: "+48",
            phoneNational: "",
            customerNote: description,
            adminNote,
          },
          {
            cateringDelivery: true,
            recipientId,
            status,
            withConfirmationToken: false,
            skipAvailabilityCheck: true,
            skipPublicBookingRules: true,
          }
        );
        createdIds.push(out.id);
      }
      const recRow = await getCateringRecipientRow(env, recipientId);
      const recipientEmail = cleanString(recRow?.email, 180).toLowerCase();
      if (createdIds.length && recRow && recipientEmail.includes("@")) {
        try {
          const firstId = createdIds[0];
          const resRow = await getRestaurantReservationRow(env, firstId);
          if (resRow) {
            const extraVars = buildCateringManualCreatedMailExtraVars(recRow, {
              dates,
              startTime,
              repeatMode: body.repeatMode,
              repeatWeekdays: body.repeatWeekdays,
              description,
            });
            await sendTemplatedBookingMail(env, request, {
              service: "restaurant",
              eventKey: "catering_manual_created_client",
              row: resRow,
              to: recipientEmail,
              extraVars,
            });
          }
        } catch (mailErr) {
          console.error("Catering manual created client mail error:", mailErr);
        }
      }
      return { status: 200, data: { ok: true, reservationIds: createdIds, count: createdIds.length } };
    } catch (error) {
      return { status: 400, data: { error: error.message || "Błąd tworzenia dostaw." } };
    }
  }
  if (op === "admin-reservation-create" && request.method === "POST") {
    const body = await readBody(request);
    try {
      const status = ["pending", "confirmed", "manual_block"].includes(body.status) ? body.status : "confirmed";
      let assigned = [];
      if (status === "manual_block") {
        assigned = Array.isArray(body.assignedTableIds)
          ? body.assignedTableIds.map((value) => cleanString(value, 80)).filter(Boolean)
          : [];
      } else if (status !== "email_verification_pending") {
        const chk = await assertRestaurantAvailability(env, body, null, { skipPublicBookingRules: true });
        if (!chk.ok) return { status: 409, data: { error: "Brak wolnych stolików." } };
        assigned = chk.availableIds;
      }
      const out = await createRestaurantReservation(env, body, {
        status,
        withConfirmationToken: false,
        assignedTableIds: assigned,
        skipAvailabilityCheck: status === "manual_block",
        skipPublicBookingRules: status !== "manual_block",
      });
      return { status: 200, data: { ok: true, reservationId: out.id, humanNumber: out.humanNumber } };
    } catch (error) {
      return { status: 400, data: { error: error.message || "Błąd tworzenia." } };
    }
  }
  if (op === "admin-manual-block" && request.method === "POST") {
    const body = await readBody(request);
    const reservationDate = cleanString(body.reservationDate, 10);
    const startTime = cleanString(body.startTime, 5);
    const endTime = cleanString(body.endTime, 5);
    if (!isYmd(reservationDate) || !isHm(startTime) || !isHm(endTime)) {
      return { status: 400, data: { error: "Nieprawidłowe dane daty/godziny." } };
    }
    const startMs = ymdHmToMs(reservationDate, startTime);
    const endMs = ymdHmToMs(reservationDate, endTime);
    if (endMs <= startMs) return { status: 400, data: { error: "Godzina końca musi być późniejsza." } };
    const tableIds = Array.isArray(body.tableIds) ? body.tableIds.map((x) => cleanString(x, 80)).filter(Boolean) : [];
    if (!tableIds.length) return { status: 400, data: { error: "Podaj stoliki do blokady." } };
    const durationHours = Math.max(0.5, (endMs - startMs) / 3600000);
    const payload = {
      reservationDate,
      startTime,
      durationHours,
      tablesCount: tableIds.length,
      guestsCount: 1,
      joinTables: false,
      fullName: "Blokada stolików",
      email: "",
      phonePrefix: "+48",
      phoneNational: "000000000",
      customerNote: cleanString(body.note, 2000),
      adminNote: cleanString(body.note, 2000),
    };
    try {
      const out = await createRestaurantReservation(env, payload, {
        status: "manual_block",
        withConfirmationToken: false,
        assignedTableIds: tableIds,
        skipAvailabilityCheck: true,
      });
      return { status: 200, data: { ok: true, reservationId: out.id } };
    } catch (error) {
      return { status: 400, data: { error: error.message || "Błąd blokady." } };
    }
  }
  if (op === "admin-reservation-update" && request.method === "PATCH") {
    const body = await readBody(request);
    const id = cleanString(body.id, 80);
    const row = await getRestaurantReservationRow(env, id);
    if (!row) return { status: 404, data: { error: "Brak rezerwacji." } };
    const notifyClient = Boolean(body.notifyClient);
    const fullEdit =
      body.reservationDate != null ||
      body.startTime != null ||
      body.durationHours != null ||
      body.tablesCount != null ||
      body.guestsCount != null ||
      body.joinTables != null ||
      body.placePreference != null ||
      body.fullName != null ||
      body.email != null ||
      body.phonePrefix != null ||
      body.phoneNational != null ||
      body.customerNote != null ||
      Object.prototype.hasOwnProperty.call(body, "recipientId");
    if (!fullEdit) {
      await env.DB.prepare("UPDATE restaurant_reservations SET admin_note=?, updated_at=? WHERE id=?")
        .bind(cleanString(body.adminNote, 2000), nowMs(), id)
        .run();
      return { status: 200, data: { ok: true } };
    }
    try {
      if (Number(row.catering_delivery) === 1) {
        const reservationDate = cleanString(body.reservationDate ?? row.reservation_date, 10);
        const startTime = cleanString(body.startTime ?? row.start_time, 5);
        const durationHours = Number(body.durationHours ?? row.duration_hours);
        if (!isYmd(reservationDate) || !isHm(startTime)) {
          return { status: 400, data: { error: "Nieprawidłowa data lub godzina." } };
        }
        if (!Number.isFinite(durationHours) || durationHours <= 0) {
          return { status: 400, data: { error: "Nieprawidłowy czas trwania." } };
        }
        const startMs = ymdHmToMs(reservationDate, startTime);
        const endMs = startMs + durationHours * 3600000;
        const customerNote = cleanString(body.customerNote ?? row.customer_note, 2000);
        const adminNote = cleanString(body.adminNote ?? row.admin_note, 2000);
        let nextRecipientId = cleanString(row.recipient_id, 80);
        if (body.recipientId != null && String(body.recipientId).trim() !== "") {
          nextRecipientId = cleanString(body.recipientId, 80);
        }
        if (!nextRecipientId) {
          return { status: 400, data: { error: "Wybierz odbiorcę." } };
        }
        let fullName = row.full_name;
        let email = row.email;
        let phonePrefix = row.phone_prefix;
        let phoneNational = row.phone_national;
        if (nextRecipientId) {
          const rec = await getCateringRecipientRow(env, nextRecipientId);
          if (!rec) return { status: 400, data: { error: "Nie znaleziono odbiorcy." } };
          fullName = rec.display_name;
          email = rec.email;
          phonePrefix = rec.phone_prefix;
          phoneNational = rec.phone_national;
        }
        const phone = normalizePhone(phonePrefix, phoneNational);
        const newHumanYear = yearFromMsWarsaw(startMs);
        const newSlug = await allocateCateringHumanSlug(env, fullName, newHumanYear, id);
        await env.DB.prepare(
          `UPDATE restaurant_reservations SET
            recipient_id=?, human_year=?, human_slug=?, human_number=0,
            full_name=?, email=?, phone_prefix=?, phone_national=?, phone_e164=?,
            reservation_date=?, start_time=?, duration_hours=?, start_ms=?, end_ms=?,
            customer_note=?, admin_note=?, assigned_table_ids_json='[]', tables_count=1, guests_count=1,
            join_tables=0, place_preference='no_preference', updated_at=?
           WHERE id=?`
        )
          .bind(
            nextRecipientId || null,
            newHumanYear,
            newSlug,
            fullName,
            String(email || "").toLowerCase(),
            phone.prefix,
            phone.national,
            phone.e164,
            reservationDate,
            startTime,
            durationHours,
            startMs,
            endMs,
            customerNote,
            adminNote,
            nowMs(),
            id
          )
          .run();
        return { status: 200, data: { ok: true } };
      }
      const payload = {
        reservationDate: cleanString(body.reservationDate ?? row.reservation_date, 10),
        startTime: cleanString(body.startTime ?? row.start_time, 5),
        durationHours: Number(body.durationHours ?? row.duration_hours),
        tablesCount: Math.max(1, toInt(body.tablesCount ?? row.tables_count, 1)),
        guestsCount: Math.max(1, toInt(body.guestsCount ?? row.guests_count, 1)),
        joinTables: body.joinTables != null ? Boolean(body.joinTables) : Boolean(row.join_tables),
        placePreference:
          body.placePreference != null
            ? normalizeRestaurantPlacePreference(body.placePreference)
            : normalizeRestaurantPlacePreference(row.place_preference),
        fullName: cleanString(body.fullName ?? row.full_name, 120),
        email: cleanString(body.email ?? row.email, 180),
        phonePrefix: cleanString(body.phonePrefix ?? row.phone_prefix, 8),
        phoneNational: cleanString(body.phoneNational ?? row.phone_national, 32),
        customerNote: cleanString(body.customerNote ?? row.customer_note, 2000),
        adminNote: cleanString(body.adminNote ?? row.admin_note, 2000),
      };
      const chk = await assertRestaurantAvailability(env, payload, id, { skipPublicBookingRules: true });
      if (!chk.ok) return { status: 409, data: { error: "Brak wolnych stolików w wybranym terminie." } };
      const assigned = chk.availableIds;
      const phone = normalizePhone(payload.phonePrefix, payload.phoneNational);
      await env.DB.prepare(
        `UPDATE restaurant_reservations SET
          full_name=?, email=?, phone_prefix=?, phone_national=?, phone_e164=?,
          reservation_date=?, start_time=?, duration_hours=?, start_ms=?, end_ms=?,
          tables_count=?, guests_count=?, join_tables=?, place_preference=?,
          assigned_table_ids_json=?, customer_note=?, admin_note=?, updated_at=?
         WHERE id=?`
      )
        .bind(
          payload.fullName,
          payload.email.toLowerCase(),
          phone.prefix,
          phone.national,
          phone.e164,
          chk.reservationDate,
          chk.startTime,
          chk.durationHours,
          chk.startMs,
          chk.endMs,
          chk.tablesCount,
          payload.guestsCount,
          payload.joinTables ? 1 : 0,
          payload.placePreference,
          toJson(assigned),
          payload.customerNote,
          payload.adminNote,
          nowMs(),
          id
        )
        .run();
      if (notifyClient) {
        try {
          const updated = await getRestaurantReservationRow(env, id);
          await sendTemplatedBookingMail(env, request, {
            service: "restaurant",
            eventKey: "changed_client",
            row: updated,
            to: updated?.email,
          });
        } catch (error) {
          console.error("Restaurant changed mail error:", error);
        }
      }
      return { status: 200, data: { ok: true } };
    } catch (error) {
      return { status: 400, data: { error: error.message || "Błąd zapisu." } };
    }
  }
  if (op === "admin-reservation-confirm" && request.method === "POST") {
    const body = await readBody(request);
    const id = cleanString(body.id, 80);
    await env.DB.prepare(
      "UPDATE restaurant_reservations SET status='confirmed', pending_expires_at=NULL, admin_action_token_hash=NULL, admin_action_expires_at=NULL, updated_at=? WHERE id=?"
    )
      .bind(nowMs(), id)
      .run();
    try {
      const row = await getRestaurantReservationRow(env, id);
      await sendTemplatedBookingMail(env, request, {
        service: "restaurant",
        eventKey: "confirmed_client",
        row,
        to: row?.email,
      });
    } catch (error) {
      console.error("Restaurant confirm mail error:", error);
    }
    return { status: 200, data: { ok: true } };
  }
  if (op === "admin-reservation-cancel" && request.method === "POST") {
    const body = await readBody(request);
    const id = cleanString(body.id, 80);
    const cancelReason = cleanString(body.cancelReason, 2000);
    const existing = await getRestaurantReservationRow(env, id);
    if (!existing) return { status: 404, data: { error: "Brak rezerwacji." } };
    if (existing.status !== "manual_block" && Number(existing.end_ms || 0) <= nowMs()) {
      return { status: 400, data: { error: "Nie można odwołać rezerwacji, która już minęła." } };
    }
    if (existing.status !== "manual_block" && !cancelReason) {
      return { status: 400, data: { error: "Podaj powód anulowania rezerwacji." } };
    }
    await env.DB.prepare(
      "UPDATE restaurant_reservations SET status='cancelled', pending_expires_at=NULL, admin_action_token_hash=NULL, admin_action_expires_at=NULL, updated_at=? WHERE id=?"
    )
      .bind(nowMs(), id)
      .run();
    try {
      const row = await getRestaurantReservationRow(env, id);
      await sendTemplatedBookingMail(env, request, {
        service: "restaurant",
        eventKey: "cancelled_client",
        row,
        to: row?.email,
        extraVars: { cancelReason },
      });
    } catch (error) {
      console.error("Restaurant cancel mail error:", error);
    }
    return { status: 200, data: { ok: true } };
  }
  if (op === "admin-mail-templates" && request.method === "GET") {
    return { status: 200, data: { templates: await loadTemplates(env, "restaurant") } };
  }
  if (op === "admin-mail-template-save" && request.method === "PUT") {
    const body = await readBody(request);
    await saveTemplate(env, "restaurant", body.key, body.subject, body.bodyHtml, body.actionLabel);
    return { status: 200, data: { ok: true } };
  }
  return null;
}

async function handleHallAdmin(env, op, request) {
  if (op === "admin-halls-list" && request.method === "GET") {
    return { status: 200, data: { halls: await venueHalls(env) } };
  }
  if (op === "admin-hall-upsert" && request.method === "PUT") {
    const body = await readBody(request);
    const id = cleanString(body.id, 80);
    await env.DB.prepare(
      `INSERT INTO venue_halls (id, name, capacity, active, hall_kind, description, exclusive_rule, buffer_minutes, full_block_guest_threshold, sort_order, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, capacity=excluded.capacity, active=excluded.active, hall_kind=excluded.hall_kind,
         description=excluded.description, exclusive_rule=excluded.exclusive_rule, buffer_minutes=excluded.buffer_minutes,
         full_block_guest_threshold=excluded.full_block_guest_threshold, sort_order=excluded.sort_order, updated_at=excluded.updated_at`
    )
      .bind(
        id,
        cleanString(body.name, 120) || id,
        Math.max(1, toInt(body.capacity, 40)),
        body.active === false ? 0 : 1,
        cleanString(body.hallKind, 20) || "large",
        cleanString(body.description, 2000),
        cleanString(body.exclusiveRule, 30) || "optional",
        Math.max(0, toInt(body.bufferMinutes, 60)),
        Math.max(1, toInt(body.fullBlockGuestThreshold, 100)),
        toInt(body.sortOrder, 0),
        nowMs()
      )
      .run();
    return { status: 200, data: { ok: true } };
  }
  if (op === "admin-reservations-list" && request.method === "GET") {
    const url = new URL(request.url);
    const status = cleanString(url.searchParams.get("status"), 40);
    return { status: 200, data: { reservations: await listHallReservations(env, status) } };
  }
  if (op === "admin-reservation-get" && request.method === "GET") {
    const url = new URL(request.url);
    const id = cleanString(url.searchParams.get("id"), 80);
    const row = await env.DB.prepare("SELECT * FROM venue_reservations WHERE id=?")
      .bind(id)
      .first();
    if (!row) return { status: 404, data: { error: "Brak rezerwacji." } };
    const halls = await venueHalls(env);
    const map = new Map(halls.map((h) => [h.id, h]));
    return { status: 200, data: { reservation: mapHallReservation(row, map) } };
  }
  if (op === "admin-reservation-create" && request.method === "POST") {
    const body = await readBody(request);
    try {
      const status = ["pending", "confirmed", "manual_block"].includes(body.status) ? body.status : "confirmed";
      const out = await createHallReservation(env, body, {
        status,
        withConfirmationToken: false,
        skipAvailabilityCheck: status === "manual_block",
        skipMinAdvance: true,
        skipPublicBookingRules: status !== "manual_block",
      });
      return { status: 200, data: { ok: true, reservationId: out.id, humanNumber: out.humanNumber } };
    } catch (error) {
      return { status: 400, data: { error: error.message || "Błąd tworzenia." } };
    }
  }
  if (op === "admin-reservation-update" && request.method === "PATCH") {
    const body = await readBody(request);
    const id = cleanString(body.id, 80);
    const row = await env.DB.prepare("SELECT * FROM venue_reservations WHERE id=?").bind(id).first();
    if (!row) return { status: 404, data: { error: "Brak rezerwacji." } };
    const notifyClient = Boolean(body.notifyClient);
    const fullEdit =
      body.hallId != null ||
      body.reservationDate != null ||
      body.startTime != null ||
      body.durationHours != null ||
      body.guestsCount != null ||
      body.exclusive != null ||
      body.eventType != null ||
      body.fullName != null ||
      body.email != null ||
      body.phonePrefix != null ||
      body.phoneNational != null ||
      body.customerNote != null;
    if (!fullEdit) {
      await env.DB.prepare("UPDATE venue_reservations SET admin_note=?, updated_at=? WHERE id=?")
        .bind(cleanString(body.adminNote, 2000), nowMs(), id)
        .run();
      return { status: 200, data: { ok: true } };
    }
    try {
      const payload = {
        hallId: cleanString(body.hallId ?? row.hall_id, 80),
        reservationDate: cleanString(body.reservationDate ?? row.reservation_date, 10),
        startTime: cleanString(body.startTime ?? row.start_time, 5),
        durationHours: Number(body.durationHours ?? row.duration_hours),
        guestsCount: toInt(body.guestsCount ?? row.guests_count, 0),
        exclusive: body.exclusive != null ? Boolean(body.exclusive) : Boolean(row.exclusive),
        eventType: cleanString(body.eventType ?? row.event_type, 500),
        fullName: cleanString(body.fullName ?? row.full_name, 120),
        email: cleanString(body.email ?? row.email, 180),
        phonePrefix: cleanString(body.phonePrefix ?? row.phone_prefix, 8),
        phoneNational: cleanString(body.phoneNational ?? row.phone_national, 32),
        customerNote: cleanString(body.customerNote ?? row.customer_note, 2000),
        adminNote: cleanString(body.adminNote ?? row.admin_note, 2000),
      };
      const avail = await hallAvailability(env, payload, id, { skipMinAdvance: true, skipPublicBookingRules: true });
      if (!avail.ok) return { status: 409, data: { error: "Termin niedostępny." } };
      const phone = normalizePhone(payload.phonePrefix, payload.phoneNational);
      await env.DB.prepare(
        `UPDATE venue_reservations SET
          hall_id=?, hall_name_snapshot=?, hall_kind_snapshot=?, full_block_guest_threshold_snap=?,
          full_name=?, email=?, phone_prefix=?, phone_national=?, phone_e164=?,
          reservation_date=?, start_time=?, duration_hours=?, start_ms=?, end_ms=?,
          start_time_label=?, end_time_label=?,
          guests_count=?, exclusive=?, full_block=?, event_type=?, customer_note=?, admin_note=?, updated_at=?
         WHERE id=?`
      )
        .bind(
          avail.hall.id,
          avail.hall.name,
          avail.hall.hallKind,
          avail.hall.fullBlockGuestThreshold,
          payload.fullName,
          payload.email.toLowerCase(),
          phone.prefix,
          phone.national,
          phone.e164,
          cleanString(payload.reservationDate, 10),
          cleanString(payload.startTime, 5),
          Number(payload.durationHours || 2),
          avail.startMs,
          avail.endMs,
          formatHm(avail.startMs),
          formatHm(avail.endMs),
          Number(avail.guestsCount || 0),
          avail.exclusive ? 1 : 0,
          avail.fullBlock ? 1 : 0,
          payload.eventType,
          payload.customerNote,
          payload.adminNote,
          nowMs(),
          id
        )
        .run();
      if (notifyClient) {
        try {
          const updated = await getHallReservationRow(env, id);
          await sendTemplatedBookingMail(env, request, {
            service: "hall",
            eventKey: "changed_client",
            row: updated,
            to: updated?.email,
          });
        } catch (error) {
          console.error("Hall changed mail error:", error);
        }
      }
      return { status: 200, data: { ok: true } };
    } catch (error) {
      return { status: 400, data: { error: error.message || "Błąd zapisu." } };
    }
  }
  if (op === "admin-reservation-confirm" && request.method === "POST") {
    const body = await readBody(request);
    const id = cleanString(body.id, 80);
    await env.DB.prepare(
      "UPDATE venue_reservations SET status='confirmed', pending_expires_at=NULL, admin_action_token_hash=NULL, admin_action_expires_at=NULL, updated_at=? WHERE id=?"
    )
      .bind(nowMs(), id)
      .run();
    try {
      const row = await getHallReservationRow(env, id);
      await sendTemplatedBookingMail(env, request, {
        service: "hall",
        eventKey: "confirmed_client",
        row,
        to: row?.email,
      });
    } catch (error) {
      console.error("Hall confirm mail error:", error);
    }
    return { status: 200, data: { ok: true } };
  }
  if (op === "admin-reservation-cancel" && request.method === "POST") {
    const body = await readBody(request);
    const id = cleanString(body.id, 80);
    const cancelReason = cleanString(body.cancelReason, 2000);
    const existing = await getHallReservationRow(env, id);
    if (!existing) return { status: 404, data: { error: "Brak rezerwacji." } };
    if (existing.status !== "manual_block" && Number(existing.end_ms || 0) <= nowMs()) {
      return { status: 400, data: { error: "Nie można odwołać rezerwacji, która już minęła." } };
    }
    if (existing.status !== "manual_block" && !cancelReason) {
      return { status: 400, data: { error: "Podaj powód anulowania rezerwacji." } };
    }
    await env.DB.prepare(
      "UPDATE venue_reservations SET status='cancelled', pending_expires_at=NULL, admin_action_token_hash=NULL, admin_action_expires_at=NULL, updated_at=? WHERE id=?"
    )
      .bind(nowMs(), id)
      .run();
    try {
      const row = await getHallReservationRow(env, id);
      await sendTemplatedBookingMail(env, request, {
        service: "hall",
        eventKey: "cancelled_client",
        row,
        to: row?.email,
        extraVars: { cancelReason },
      });
    } catch (error) {
      console.error("Hall cancel mail error:", error);
    }
    return { status: 200, data: { ok: true } };
  }
  if (op === "admin-extend-pending" && request.method === "POST") {
    const body = await readBody(request);
    const id = cleanString(body.id, 80);
    const row = await env.DB.prepare("SELECT pending_expires_at AS pendingExpiresAt, status FROM venue_reservations WHERE id=?")
      .bind(id)
      .first();
    if (!row) return { status: 404, data: { error: "Brak rezerwacji." } };
    if (row.status !== "pending") return { status: 400, data: { error: "Tylko rezerwacje oczekujące można przedłużyć." } };
    const left = Number(row.pendingExpiresAt || 0) - nowMs();
    if (!(left > 0 && left <= HALL_EXTEND_THRESHOLD_MS)) {
      return { status: 400, data: { error: "Przedłużenie możliwe tylko przy krótkim czasie do wygaśnięcia." } };
    }
    await env.DB.prepare("UPDATE venue_reservations SET pending_expires_at=?, updated_at=? WHERE id=?")
      .bind(Number(row.pendingExpiresAt || nowMs()) + HALL_PENDING_MS, nowMs(), id)
      .run();
    return { status: 200, data: { ok: true } };
  }
  if (op === "admin-mail-templates" && request.method === "GET") {
    return { status: 200, data: { templates: await loadTemplates(env, "hall") } };
  }
  if (op === "admin-mail-template-save" && request.method === "PUT") {
    const body = await readBody(request);
    await saveTemplate(env, "hall", body.key, body.subject, body.bodyHtml, body.actionLabel);
    return { status: 200, data: { ok: true } };
  }
  return null;
}

/**
 * Powiadomienie e-mail o zgłoszeniu z formularza kontaktowego (SMTP jak w rezerwacjach).
 * Odbiorcy: ADMIN_NOTIFY_EMAIL oraz FIREBASE_ADMIN_EMAILS (unikalne adresy).
 */
export async function sendContactFormAdminEmail(env, { fullName, email, phone, formKind, message }) {
  if (!hasSmtpConfig(env)) {
    return { skipped: true };
  }
  const recipients = parseAdminNotifyEmails(env);
  if (!recipients.length) {
    console.warn("sendContactFormAdminEmail: brak odbiorcow (ADMIN_NOTIFY_EMAIL / FIREBASE_ADMIN_EMAILS)");
    return { skipped: true, reason: "no-recipients" };
  }
  const kindLabel = cleanString(formKind, 80) || "Inne";
  const subject = `Formularz kontaktowy - ${kindLabel}`;
  const esc = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:system-ui,Segoe UI,sans-serif;line-height:1.5;color:#222">
<p style="margin:0 0 1em"><strong>Nowe zgłoszenie z formularza kontaktowego</strong></p>
<p><strong>Rodzaj formularza:</strong> ${esc(kindLabel)}</p>
<hr style="border:none;border-top:1px solid #ddd;margin:1.25em 0">
<p style="margin:0 0 0.5em"><strong>Dane kontaktowe</strong></p>
<p style="margin:0 0 1em">Imię i nazwisko: ${esc(fullName)}<br>Telefon: ${esc(phone || "—")}<br>E-mail: ${esc(email)}</p>
<p style="margin:0 0 0.5em"><strong>Treść zapytania</strong></p>
<p style="margin:0;white-space:pre-wrap">${esc(message)}</p>
</body></html>`;
  const replyTo = formatAddressHeader(`${cleanString(fullName, 120)} <${cleanString(email, 320)}>`);
  for (const to of recipients) {
    await sendMailViaSmtpWithRetry(env, { to, subject, html, replyTo });
  }
  return { ok: true };
}

export async function handleD1BookingApi({ service, op, request, env, isAdmin, verifyTurnstileToken }) {
  await ensureSchema(env);
  await expireReservations(env);
  try {
    if (isAdmin) {
      if (service === "hotel") return await handleHotelAdmin(env, op, request);
      if (service === "restaurant") return await handleRestaurantAdmin(env, op, request);
      if (service === "hall") return await handleHallAdmin(env, op, request);
      return null;
    }
    if (service === "hotel") return await handleHotelPublic(env, op, request, verifyTurnstileToken);
    if (service === "restaurant") return await handleRestaurantPublic(env, op, request, verifyTurnstileToken);
    if (service === "hall") return await handleHallPublic(env, op, request, verifyTurnstileToken);
    return null;
  } catch (error) {
    return {
      status: 500,
      data: { error: error.message || "Wystąpił błąd modułu rezerwacji D1." },
    };
  }
}

export async function runBookingMaintenance(env) {
  await ensureSchema(env);
  return expireReservations(env);
}
