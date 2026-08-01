const STATS_COOKIE_NAME = "sredzka_stats_session";
const STATS_SESSION_SECONDS = 12 * 60 * 60;
const CAPTCHA_AFTER_FAILURES = 3;
const BLOCK_AFTER_FAILURES = 6;
const BLOCK_DURATION_MS = 10 * 60 * 1000;
const ATTEMPT_TTL_MS = 24 * 60 * 60 * 1000;
const ALL_RANGE_DAYS = -1;

const ALLOWED_EVENT_TYPES = new Set([
  "visit",
  "contact_phone_click",
  "contact_email_click",
  "contact_map_click",
  "contact_form_submit",
]);

const SECTION_CONFIG = [
  { key: "home", label: "Strona główna", detailLabel: "" },
  { key: "hotel", label: "Hotel", detailLabel: "Podstrony hotelu" },
  { key: "catering", label: "Catering", detailLabel: "" },
  { key: "przyjecia", label: "Przyjęcia", detailLabel: "" },
  { key: "kontakt", label: "Kontakt", detailLabel: "" },
  { key: "dokumenty", label: "Dokumenty", detailLabel: "" },
  { key: "faq", label: "F&Q", detailLabel: "" },
  { key: "other", label: "Inne", detailLabel: "Pozostałe strony" },
];

const SITEMAP_ITEMS = [
  { url: "/", label: "Strona główna", robots: "index, follow", indexed: true, inSitemap: true },
  { url: "/Hotel/", label: "Hotel", robots: "index, follow", indexed: true, inSitemap: true },
  { url: "/catering/", label: "Catering", robots: "index, follow", indexed: true, inSitemap: true },
  { url: "/przyjecia/", label: "Przyjęcia", robots: "index, follow", indexed: true, inSitemap: true },
  { url: "/kontakt/", label: "Kontakt", robots: "index, follow", indexed: true, inSitemap: true },
  { url: "/dokumenty/", label: "Dokumenty", robots: "index, follow", indexed: true, inSitemap: true },
  { url: "/f-and-q/", label: "F&Q", robots: "index, follow", indexed: true, inSitemap: true },
  { url: "/admin/", label: "Panel administracyjny", robots: "noindex, nofollow", indexed: false, inSitemap: false },
  { url: "/stats/", label: "Statystyki", robots: "noindex, nofollow", indexed: false, inSitemap: false },
  { url: "/Hotel/potwierdzenie/", label: "Potwierdzenie rezerwacji hotelu", robots: "noindex, nofollow", indexed: false, inSitemap: false },
  { url: "/Hotel/akceptacja/", label: "Akceptacja rezerwacji hotelu", robots: "noindex, nofollow", indexed: false, inSitemap: false },
  { url: "/catering/potwierdzenie/", label: "Potwierdzenie rezerwacji cateringu", robots: "noindex, nofollow", indexed: false, inSitemap: false },
  { url: "/catering/akceptacja/", label: "Akceptacja rezerwacji cateringu", robots: "noindex, nofollow", indexed: false, inSitemap: false },
  { url: "/przyjecia/potwierdzenie/", label: "Potwierdzenie rezerwacji przyjęcia", robots: "noindex, nofollow", indexed: false, inSitemap: false },
  { url: "/przyjecia/akceptacja/", label: "Akceptacja rezerwacji przyjęcia", robots: "noindex, nofollow", indexed: false, inSitemap: false },
];

const loginAttempts = new Map();
let statsSchemaPromise = null;

export async function handleStatsApi({ request, env, url, respond, assertPublic, verifyCaptcha, allowedOrigins }) {
  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  if (pathname === "/api/public/track" && request.method === "POST") {
    assertPublic();
    assertAllowedOrigin(request, allowedOrigins());
    const payload = await readJson(request);
    const event = normalizeEvent(payload);
    if (!event.type) throw httpError(400, "Niepoprawny typ zdarzenia.");
    await ensureStatsSchema(env);
    const result = await env.DB.prepare(
      `INSERT OR IGNORE INTO analytics_events
       (id, client_event_id, type, page, label, section, source, path, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        event.id,
        event.clientEventId || null,
        event.type,
        event.page,
        event.label,
        event.section,
        event.source,
        event.path,
        event.createdAt
      )
      .run();
    return respond({ ok: true, id: event.id, deduplicated: Number(result.meta?.changes || 0) === 0 }, 200, noStore());
  }

  if (pathname === "/api/stats/auth" && request.method === "POST") {
    assertAllowedOrigin(request, allowedOrigins());
    requireStatsPassword(env);
    const status = getLoginStatus(request);
    if (status.isBlocked) {
      throw httpError(429, `Za dużo błędnych prób. Spróbuj ponownie za ${status.retryAfterSeconds} s.`, {
        code: "blocked",
        retryAfterSeconds: status.retryAfterSeconds,
      });
    }

    const payload = await readJson(request);
    if (status.requiresCaptcha) {
      const captchaOk = await verifyCaptcha(String(payload.turnstileToken || ""));
      if (!captchaOk) {
        throw httpError(403, "Potwierdź CAPTCHA przed kolejną próbą.", { code: "captcha_required" });
      }
    }

    const provided = String(payload.password || "");
    const expected = getStatsPassword(env);
    if (!provided || !(await secureStringEqual(provided, expected))) {
      const next = registerLoginFailure(request);
      if (next.isBlocked) {
        throw httpError(429, "Za dużo błędnych prób. Logowanie z tego adresu zostało zablokowane na 10 minut.", {
          code: "blocked",
          retryAfterSeconds: next.retryAfterSeconds,
        });
      }
      if (next.requiresCaptcha) {
        throw httpError(401, "Nieprawidłowe hasło. Przed kolejną próbą potwierdź CAPTCHA.", {
          code: "captcha_required",
          failures: next.failures,
        });
      }
      throw httpError(401, "Nieprawidłowe hasło.", { code: "invalid_password", failures: next.failures });
    }

    resetLoginState(request);
    const token = await createSessionToken(env);
    return respond({ ok: true }, 200, {
      ...noStore(),
      "Set-Cookie": buildSessionCookie(token, STATS_SESSION_SECONDS, url),
    });
  }

  if (pathname === "/api/stats/auth" && request.method === "DELETE") {
    assertAllowedOrigin(request, allowedOrigins());
    return respond({ ok: true }, 200, {
      ...noStore(),
      "Set-Cookie": buildSessionCookie("", 0, url),
    });
  }

  if (pathname === "/api/stats/data" && request.method === "GET") {
    requireStatsPassword(env);
    if (!(await isAuthorized(request, env))) throw httpError(401, "Brak autoryzacji.");
    await ensureStatsSchema(env);
    const rangeDays = parseRangeDays(url.searchParams.get("range"));
    return respond(await buildStatsPayload(env, rangeDays), 200, noStore());
  }

  if (pathname === "/api/stats/sitemap" && request.method === "GET") {
    requireStatsPassword(env);
    if (!(await isAuthorized(request, env))) throw httpError(401, "Brak autoryzacji.");
    return respond(SITEMAP_ITEMS, 200, noStore());
  }

  return null;
}

async function ensureStatsSchema(env) {
  if (!statsSchemaPromise) {
    statsSchemaPromise = (async () => {
      await env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS analytics_events (
          id TEXT PRIMARY KEY,
          client_event_id TEXT UNIQUE,
          type TEXT NOT NULL,
          page TEXT NOT NULL DEFAULT 'home',
          label TEXT NOT NULL DEFAULT '',
          section TEXT NOT NULL DEFAULT 'other',
          source TEXT NOT NULL DEFAULT 'main-site',
          path TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        )`
      ).run();
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at ON analytics_events(created_at DESC)").run();
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_analytics_events_type_created ON analytics_events(type, created_at DESC)").run();
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_analytics_events_page_created ON analytics_events(section, page, created_at DESC)").run();
    })().catch((error) => {
      statsSchemaPromise = null;
      throw error;
    });
  }
  return statsSchemaPromise;
}

function normalizeEvent(payload = {}) {
  const type = clean(payload.type, 80);
  const createdAt = new Date().toISOString();
  const path = normalizePath(payload.path);
  return {
    id: crypto.randomUUID(),
    clientEventId: clean(payload.clientEventId, 100),
    type: ALLOWED_EVENT_TYPES.has(type) ? type : "",
    page: clean(payload.page, 160) || "home",
    label: clean(payload.label, 200),
    section: normalizeSection(payload.section, path),
    source: clean(payload.source, 100) || "main-site",
    path: path.slice(0, 300),
    createdAt,
  };
}

async function buildStatsPayload(env, rangeDays) {
  const startIso = rangeDays === ALL_RANGE_DAYS ? "" : new Date(Date.now() - (Math.max(rangeDays - 1, 0) * 86400000)).toISOString().slice(0, 10) + "T00:00:00.000Z";
  const where = startIso ? "WHERE created_at >= ?" : "";
  const bind = (sql) => (startIso ? env.DB.prepare(sql).bind(startIso) : env.DB.prepare(sql));

  const [availableResult, filteredResult, dailyResult, pagesResult, recentResult] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS count FROM analytics_events"),
    bind(
      `SELECT COUNT(*) AS count,
        SUM(CASE WHEN type = 'visit' THEN 1 ELSE 0 END) AS visits,
        SUM(CASE WHEN type = 'contact_phone_click' THEN 1 ELSE 0 END) AS phone,
        SUM(CASE WHEN type = 'contact_map_click' THEN 1 ELSE 0 END) AS address,
        SUM(CASE WHEN type = 'contact_email_click' THEN 1 ELSE 0 END) AS email,
        SUM(CASE WHEN type = 'contact_form_submit' THEN 1 ELSE 0 END) AS form
       FROM analytics_events ${where}`
    ),
    bind(
      `SELECT substr(created_at, 1, 10) AS day,
        SUM(CASE WHEN type = 'visit' THEN 1 ELSE 0 END) AS visit,
        SUM(CASE WHEN type = 'contact_phone_click' THEN 1 ELSE 0 END) AS phone,
        SUM(CASE WHEN type = 'contact_map_click' THEN 1 ELSE 0 END) AS address,
        SUM(CASE WHEN type = 'contact_email_click' THEN 1 ELSE 0 END) AS email,
        SUM(CASE WHEN type = 'contact_form_submit' THEN 1 ELSE 0 END) AS form
       FROM analytics_events ${where}
       GROUP BY substr(created_at, 1, 10) ORDER BY day ASC`
    ),
    bind(
      `SELECT section, page, label, path, COUNT(*) AS visits
       FROM analytics_events ${where}${where ? " AND" : " WHERE"} type = 'visit'
       GROUP BY section, page, label, path ORDER BY visits DESC, label ASC`
    ),
    bind(
      `SELECT id, type, page, label, section, source, path, created_at AS createdAt
       FROM analytics_events ${where} ORDER BY created_at DESC LIMIT 50`
    ),
  ]);

  const totalsRow = filteredResult.results?.[0] || {};
  const totals = {
    visits: number(totalsRow.visits),
    phone: number(totalsRow.phone),
    address: number(totalsRow.address),
    email: number(totalsRow.email),
    form: number(totalsRow.form),
  };
  const dailyRows = (dailyResult.results || []).map((row) => ({
    day: String(row.day || ""),
    visit: number(row.visit),
    phone: number(row.phone),
    address: number(row.address),
    email: number(row.email),
    form: number(row.form),
  }));
  const series = fillDailySeries(dailyRows, rangeDays);

  return {
    rangeDays,
    availableEvents: number(availableResult.results?.[0]?.count),
    filteredEvents: number(totalsRow.count),
    totals,
    totalContacts: totals.phone + totals.address + totals.email + totals.form,
    conversionRate: totals.visits ? (totals.form / totals.visits) * 100 : 0,
    series,
    pageBreakdown: buildPageBreakdown(pagesResult.results || []),
    recentEvents: recentResult.results || [],
    lastUpdatedAt: new Date().toISOString(),
  };
}

function fillDailySeries(rows, rangeDays) {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  let firstDay = "";
  if (rangeDays === ALL_RANGE_DAYS) firstDay = rows[0]?.day || new Date().toISOString().slice(0, 10);
  else firstDay = new Date(Date.now() - (Math.max(rangeDays - 1, 0) * 86400000)).toISOString().slice(0, 10);

  const cursor = new Date(`${firstDay}T00:00:00.000Z`);
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const result = [];
  while (cursor <= today && result.length < 3700) {
    const day = cursor.toISOString().slice(0, 10);
    const item = byDay.get(day) || { visit: 0, phone: 0, address: 0, email: 0, form: 0 };
    result.push({
      date: day,
      label: new Intl.DateTimeFormat("pl-PL", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(cursor),
      visit: number(item.visit), phone: number(item.phone), address: number(item.address), email: number(item.email), form: number(item.form),
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function buildPageBreakdown(rows) {
  const sections = new Map(SECTION_CONFIG.map((item) => [item.key, { ...item, section: item.key, visits: 0, pages: [] }]));
  for (const row of rows) {
    const key = normalizeSection(row.section, row.path);
    const target = sections.get(key) || sections.get("other");
    const visits = number(row.visits);
    target.visits += visits;
    target.pages.push({ page: row.page || "home", label: row.label || row.page || "Nieznana strona", path: row.path || "", visits });
  }
  return SECTION_CONFIG.map((config) => sections.get(config.key)).filter((section) => section.visits > 0 || section.key !== "other");
}

function normalizeSection(value, path = "") {
  const raw = clean(value, 80).toLowerCase();
  if (SECTION_CONFIG.some((item) => item.key === raw)) return raw;
  const first = normalizePath(path).replace(/^\/+/, "").split("/")[0].toLowerCase();
  if (!first || first === "index.html") return "home";
  if (first === "hotel") return "hotel";
  if (first === "catering") return "catering";
  if (first === "przyjecia") return "przyjecia";
  if (first === "kontakt") return "kontakt";
  if (first === "dokumenty") return "dokumenty";
  if (first === "f-and-q") return "faq";
  return "other";
}

function normalizePath(value) {
  const path = String(value || "/").trim().split("?")[0].split("#")[0] || "/";
  return `/${path.replace(/^\/+/, "").replace(/\/{2,}/g, "/")}`;
}

function parseRangeDays(value) {
  const normalized = String(value || "7").trim().toLowerCase();
  if (["30", "miesiac", "month"].includes(normalized)) return 30;
  if (["365", "rok", "year"].includes(normalized)) return 365;
  if (["all", "zawsze", "alltime"].includes(normalized)) return ALL_RANGE_DAYS;
  return 7;
}

function getStatsPassword(env) {
  return String(env.STATS_ACCESS_PASSWORD || "").trim();
}

function requireStatsPassword(env) {
  if (!getStatsPassword(env)) throw httpError(500, "Brak konfiguracji hasła statystyk.");
}

function getRequestIp(request) {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() || "unknown";
}

function getLoginState(request) {
  const now = Date.now();
  for (const [key, state] of loginAttempts) {
    if (now - state.updatedAt > ATTEMPT_TTL_MS) loginAttempts.delete(key);
  }
  const ip = getRequestIp(request);
  let state = loginAttempts.get(ip);
  if (!state) {
    state = { failures: 0, blockedUntil: 0, updatedAt: now };
    loginAttempts.set(ip, state);
  }
  if (state.blockedUntil && state.blockedUntil <= now) {
    state.failures = 0;
    state.blockedUntil = 0;
  }
  state.updatedAt = now;
  return state;
}

function getLoginStatus(request) {
  const state = getLoginState(request);
  const retryAfterSeconds = state.blockedUntil > Date.now() ? Math.max(1, Math.ceil((state.blockedUntil - Date.now()) / 1000)) : 0;
  return {
    failures: state.failures,
    isBlocked: retryAfterSeconds > 0,
    requiresCaptcha: state.failures >= CAPTCHA_AFTER_FAILURES,
    retryAfterSeconds,
  };
}

function registerLoginFailure(request) {
  const state = getLoginState(request);
  state.failures += 1;
  if (state.failures >= BLOCK_AFTER_FAILURES) state.blockedUntil = Date.now() + BLOCK_DURATION_MS;
  return getLoginStatus(request);
}

function resetLoginState(request) {
  const state = getLoginState(request);
  state.failures = 0;
  state.blockedUntil = 0;
}

async function createSessionToken(env) {
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ exp: Date.now() + STATS_SESSION_SECONDS * 1000 })));
  return `${payload}.${await sign(payload, sessionSecret(env))}`;
}

async function isAuthorized(request, env) {
  const token = parseCookies(request.headers.get("Cookie") || "")[STATS_COOKIE_NAME] || "";
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = await sign(payload, sessionSecret(env));
  if (!(await secureStringEqual(signature, expected))) return false;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
    return Number(parsed.exp) > Date.now();
  } catch {
    return false;
  }
}

function sessionSecret(env) {
  return String(env.STATS_SESSION_SECRET || getStatsPassword(env));
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

async function secureStringEqual(left, right) {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(left))),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(right))),
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let diff = a.length ^ b.length;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}

function base64UrlEncode(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlDecode(value) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function buildSessionCookie(value, maxAge, url) {
  const parts = [
    `${STATS_COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/api/stats",
    "HttpOnly",
    `Max-Age=${Math.max(0, Number(maxAge) || 0)}`,
  ];
  if (url.protocol === "https:") parts.push("SameSite=None", "Secure");
  else parts.push("SameSite=Lax");
  return parts.join("; ");
}

function parseCookies(header) {
  return String(header || "").split(";").reduce((result, part) => {
    const [key, ...rest] = part.trim().split("=");
    if (key) result[key] = decodeURIComponent(rest.join("=") || "");
    return result;
  }, {});
}

function assertAllowedOrigin(request, origins) {
  const origin = String(request.headers.get("Origin") || "").toLowerCase();
  if (!origin) return;
  const allowed = origins.map((item) => String(item).toLowerCase());
  if (!allowed.includes(origin)) throw httpError(403, "Niedozwolone źródło żądania.");
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw httpError(400, "Niepoprawny JSON.");
  }
}

function clean(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function number(value) {
  return Number(value) || 0;
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0, must-revalidate" };
}

function httpError(status, message, extras = {}) {
  return Object.assign(new Error(message), { status, ...extras });
}
