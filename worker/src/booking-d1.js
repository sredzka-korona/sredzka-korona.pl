const SESSION_MS = 30 * 60 * 1000;
const EMAIL_LINK_MS = 2 * 60 * 60 * 1000;
const HOTEL_PENDING_MS = 3 * 24 * 60 * 60 * 1000;
const RESTAURANT_PENDING_MS = 3 * 24 * 60 * 60 * 1000;
const HALL_PENDING_MS = 7 * 24 * 60 * 60 * 1000;
const HALL_EXTEND_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;

const STATUS_LABELS = {
  email_verification_pending: "E-mail do potwierdzenia",
  pending: "Oczekujące",
  confirmed: "Zarezerwowane",
  cancelled: "Anulowane",
  expired: "Wygasłe",
  manual_block: "Blokada terminu",
};

const BLOCKING_STATUSES = ["pending", "confirmed", "manual_block"];

let schemaReadyPromise = null;

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

function formatHm(ms) {
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleTimeString("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/Warsaw",
  });
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

function humanNumberKey(service) {
  if (service === "hotel") return "hotel_human_number";
  if (service === "restaurant") return "restaurant_human_number";
  return "hall_human_number";
}

function humanNumberStart(service) {
  if (service === "hotel") return 1000;
  if (service === "restaurant") return 2000;
  return 3000;
}

async function nextHumanNumber(env, service) {
  const key = humanNumberKey(service);
  const start = humanNumberStart(service);
  const row = await env.DB.prepare(
    "INSERT INTO booking_counters (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = value + 1 RETURNING value"
  )
    .bind(key, start)
    .first();
  return Number(row?.value || start);
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
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (service, key)
      )`,
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
        assigned_table_ids_json TEXT NOT NULL DEFAULT '[]',
        customer_note TEXT NOT NULL DEFAULT '',
        admin_note TEXT NOT NULL DEFAULT '',
        cleanup_buffer_minutes INTEGER NOT NULL DEFAULT 30,
        confirmation_token_hash TEXT,
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
        email_verification_expires_at INTEGER,
        pending_expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_venue_res_status_time
        ON venue_reservations(status, hall_id, start_ms, end_ms)`,
    ];
    for (const sql of stmts) {
      await env.DB.prepare(sql).run();
    }
    await seedDefaults(env);
  })();
  return schemaReadyPromise;
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

async function expireReservations(env) {
  const now = nowMs();
  await env.DB.prepare(
    "UPDATE hotel_reservations SET status='expired', updated_at=? WHERE status='email_verification_pending' AND email_verification_expires_at IS NOT NULL AND email_verification_expires_at < ?"
  )
    .bind(now, now)
    .run();
  await env.DB.prepare(
    "UPDATE hotel_reservations SET status='expired', updated_at=? WHERE status='pending' AND pending_expires_at IS NOT NULL AND pending_expires_at < ?"
  )
    .bind(now, now)
    .run();
  await env.DB.prepare(
    "UPDATE restaurant_reservations SET status='expired', updated_at=? WHERE status='email_verification_pending' AND email_verification_expires_at IS NOT NULL AND email_verification_expires_at < ?"
  )
    .bind(now, now)
    .run();
  await env.DB.prepare(
    "UPDATE restaurant_reservations SET status='expired', updated_at=? WHERE status='pending' AND pending_expires_at IS NOT NULL AND pending_expires_at < ?"
  )
    .bind(now, now)
    .run();
  await env.DB.prepare(
    "UPDATE venue_reservations SET status='expired', updated_at=? WHERE status='email_verification_pending' AND email_verification_expires_at IS NOT NULL AND email_verification_expires_at < ?"
  )
    .bind(now, now)
    .run();
  await env.DB.prepare(
    "UPDATE venue_reservations SET status='expired', updated_at=? WHERE status='pending' AND pending_expires_at IS NOT NULL AND pending_expires_at < ?"
  )
    .bind(now, now)
    .run();
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

async function hotelBlockingReservations(env, dateFrom, dateTo, excludeId = null) {
  const rows = await env.DB.prepare(
    `SELECT id, room_ids_json AS roomIdsJson FROM hotel_reservations
     WHERE status IN ('pending','confirmed','manual_block')
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
  const humanNumber = await nextHumanNumber(env, "hotel");
  const phone = normalizePhone(payload.phonePrefix, payload.phoneNational);
  const roomIds = Array.isArray(payload.roomIds) ? payload.roomIds.map((x) => cleanString(x, 80)).filter(Boolean) : [];
  const dateFrom = cleanString(payload.dateFrom, 10);
  const dateTo = cleanString(payload.dateTo, 10);
  assertDateRange(dateFrom, dateTo);
  const { requested } = await assertHotelRoomIdsAvailable(env, roomIds, dateFrom, dateTo, options.excludeId || null);

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
      id, human_number, status, customer_name, email, phone_prefix, phone_national, phone_e164,
      date_from, date_to, total_price, customer_note, admin_note, room_ids_json,
      confirmation_token_hash, email_verification_expires_at, pending_expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      humanNumber,
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
    customerName: row.customer_name,
    email: row.email,
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

async function resolveRestaurantWindowForDate(env, settings, reservationDate) {
  const openingHours = await loadCompanyOpeningHours(env);
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
    `SELECT id, assigned_table_ids_json AS assignedTableIdsJson
     FROM restaurant_reservations
     WHERE status IN ('pending','confirmed','manual_block')
       AND start_ms < ?
       AND end_ms > ?
       ${excludeId ? "AND id != ?" : ""}`
  )
    .bind(...(excludeId ? [endMs, startMs, excludeId] : [endMs, startMs]))
    .all();
  return (rows.results || []).map((r) => ({
    id: r.id,
    tableIds: parseJson(r.assignedTableIdsJson, []),
  }));
}

async function restaurantAvailableTableIds(env, startMs, endMs, tablesNeeded, excludeId = null) {
  const allTables = await restaurantTables(env, false);
  const blockedRows = await restaurantBlockingRows(env, startMs, endMs, excludeId);
  const blocked = new Set();
  blockedRows.forEach((r) => {
    (r.tableIds || []).forEach((id) => blocked.add(id));
  });
  const free = allTables.filter((t) => !blocked.has(t.id)).map((t) => t.id);
  return free.slice(0, Math.max(0, Number(tablesNeeded || 1)));
}

async function assertRestaurantAvailability(env, payload, excludeId = null) {
  const settings = await loadRestaurantSettings(env);
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
  const dayWindow = await resolveRestaurantWindowForDate(env, settings, reservationDate);
  if (dayWindow.closed) {
    throw new Error("Restauracja jest nieczynna w wybranym dniu.");
  }
  const startMs = ymdHmToMs(reservationDate, startTime);
  const endMs = startMs + durationHours * 3600000;
  const startMinutes = toInt(startTime.slice(0, 2), 0) * 60 + toInt(startTime.slice(3, 5), 0);
  const endMinutes = startMinutes + Math.round(durationHours * 60);
  if (startMinutes < dayWindow.openMinutes || endMinutes > dayWindow.closeMinutes) {
    throw new Error(`Rezerwacje tylko w godzinach ${dayWindow.openLabel}-${dayWindow.closeLabel}.`);
  }
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
  };
}

function mapRestaurantReservation(row, tableMap) {
  const ids = parseJson(row.assigned_table_ids_json, []);
  const labels = ids
    .map((id) => {
      const t = tableMap.get(id);
      return t ? `${t.number} (${t.zone || "sala"})` : id;
    })
    .join(", ");
  return {
    id: row.id,
    humanNumber: row.human_number,
    fullName: row.full_name,
    email: row.email,
    phone: `${row.phone_prefix || ""} ${row.phone_national || ""}`.trim(),
    status: row.status,
    statusLabel: statusLabel(row.status),
    reservationDate: row.reservation_date,
    startDateTime: Number(row.start_ms || 0),
    endDateTime: Number(row.end_ms || 0),
    durationHours: Number(row.duration_hours || 0),
    tablesCount: Number(row.tables_count || 0),
    assignedTableIds: ids,
    assignedTablesLabel: labels,
    guestsCount: Number(row.guests_count || 0),
    joinTables: Boolean(row.join_tables),
    customerNote: row.customer_note || "",
    adminNote: row.admin_note || "",
    pendingExpiresAt: row.pending_expires_at || null,
    emailVerificationExpiresAt: row.email_verification_expires_at || null,
    createdAtMs: Number(row.created_at || 0),
    cleanupBufferMinutes: Number(row.cleanup_buffer_minutes || 30),
  };
}

async function createRestaurantReservation(env, payload, options = {}) {
  const now = nowMs();
  const availability = await assertRestaurantAvailability(env, payload, options.excludeId || null);
  if (!availability.ok) {
    throw new Error("Brak wolnych stolików w wybranym terminie.");
  }
  const settings = availability.settings;
  const tablesCount = availability.tablesCount;
  const guestsCount = Math.max(1, toInt(payload.guestsCount, 1));
  const maxGuests = Math.max(1, toInt(settings.maxGuestsPerTable, 4)) * tablesCount;
  if (guestsCount > maxGuests) {
    throw new Error(`Maksymalnie ${maxGuests} gości przy ${tablesCount} stolikach.`);
  }
  const id = crypto.randomUUID();
  const humanNumber = await nextHumanNumber(env, "restaurant");
  const phone = normalizePhone(payload.phonePrefix, payload.phoneNational);
  const token = options.withConfirmationToken ? randomToken() : "";
  const tokenHash = token ? await sha256Hex(token) : null;
  const status = options.status || "email_verification_pending";
  const assigned = Array.isArray(options.assignedTableIds) ? options.assignedTableIds : [];
  const emailExp = status === "email_verification_pending" ? now + EMAIL_LINK_MS : null;
  const pendingExp = status === "pending" ? now + RESTAURANT_PENDING_MS : null;
  await env.DB.prepare(
    `INSERT INTO restaurant_reservations (
      id, human_number, status, full_name, email, phone_prefix, phone_national, phone_e164,
      reservation_date, start_time, duration_hours, start_ms, end_ms, tables_count, guests_count, join_tables,
      assigned_table_ids_json, customer_note, admin_note, cleanup_buffer_minutes,
      confirmation_token_hash, email_verification_expires_at, pending_expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      humanNumber,
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
      toJson(assigned),
      cleanString(payload.customerNote, 2000),
      cleanString(payload.adminNote, 2000),
      30,
      tokenHash,
      emailExp,
      pendingExp,
      now,
      now
    )
    .run();
  return { id, humanNumber, token, availability };
}

async function venueSettings(env) {
  const row = await env.DB.prepare(
    "SELECT hall_open_time AS hallOpenTime, hall_close_time AS hallCloseTime FROM venue_settings WHERE id='default'"
  ).first();
  return row || { hallOpenTime: "08:00", hallCloseTime: "23:00" };
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

async function hallAvailability(env, payload, excludeId = null) {
  const halls = await venueHalls(env);
  const hall = halls.find((h) => h.id === cleanString(payload.hallId, 80) && h.active);
  if (!hall) throw new Error("Sala niedostępna.");
  const settings = await venueSettings(env);
  const reservationDate = cleanString(payload.reservationDate, 10);
  const startTime = cleanString(payload.startTime, 5);
  const durationHours = Number(payload.durationHours || 2);
  if (!isYmd(reservationDate) || !isHm(startTime) || !Number.isFinite(durationHours) || durationHours <= 0) {
    throw new Error("Nieprawidłowa data lub godzina.");
  }
  const startMs = ymdHmToMs(reservationDate, startTime);
  const endMs = startMs + durationHours * 3600000;
  const [openH, openM] = String(settings.hallOpenTime || "08:00").split(":").map((x) => Number(x));
  const [closeH, closeM] = String(settings.hallCloseTime || "23:00").split(":").map((x) => Number(x));
  const startMinutes = toInt(startTime.slice(0, 2), 0) * 60 + toInt(startTime.slice(3, 5), 0);
  const endMinutes = startMinutes + Math.round(durationHours * 60);
  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;
  if (startMinutes < openMinutes || endMinutes > closeMinutes) {
    throw new Error(`Rezerwacje tylko w godzinach ${settings.hallOpenTime}-${settings.hallCloseTime}.`);
  }

  const guestsCount = Math.max(0, toInt(payload.guestsCount, hall.hallKind === "small" ? 1 : 10));
  const exclusive = hall.hallKind === "small" ? true : Boolean(payload.exclusive);
  const fullBlock = hallFullBlock(hall, guestsCount, exclusive);
  const bufferMs = Math.max(0, toInt(hall.bufferMinutes, 60)) * 60000;

  const rows = await env.DB.prepare(
    `SELECT id, guests_count AS guestsCount, exclusive, full_block AS fullBlock, start_ms AS startMs, end_ms AS endMs
     FROM venue_reservations
     WHERE hall_id = ?
       AND status IN ('pending','confirmed','manual_block')
       ${excludeId ? "AND id != ?" : ""}`
  )
    .bind(...(excludeId ? [hall.id, excludeId] : [hall.id]))
    .all();
  let usedGuests = 0;
  for (const row of rows.results || []) {
    const existingStart = Number(row.startMs || 0) - bufferMs;
    const existingEnd = Number(row.endMs || 0) + bufferMs;
    const overlap = startMs < existingEnd && endMs > existingStart;
    if (!overlap) continue;
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
    const max = Math.min(40, hall.capacity);
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

async function createHallReservation(env, payload, options = {}) {
  const now = nowMs();
  const avail = await hallAvailability(env, payload, options.excludeId || null);
  if (!avail.ok) {
    throw new Error("Termin niedostępny.");
  }
  const id = crypto.randomUUID();
  const humanNumber = await nextHumanNumber(env, "hall");
  const phone = normalizePhone(payload.phonePrefix, payload.phoneNational);
  const token = options.withConfirmationToken ? randomToken() : "";
  const tokenHash = token ? await sha256Hex(token) : null;
  const status = options.status || "email_verification_pending";
  const emailExp = status === "email_verification_pending" ? now + EMAIL_LINK_MS : null;
  const pendingExp = status === "pending" ? now + HALL_PENDING_MS : null;
  await env.DB.prepare(
    `INSERT INTO venue_reservations (
      id, human_number, status, hall_id, hall_name_snapshot, hall_kind_snapshot, full_block_guest_threshold_snap,
      full_name, email, phone_prefix, phone_national, phone_e164,
      reservation_date, start_time, duration_hours, start_ms, end_ms, start_time_label, end_time_label,
      guests_count, exclusive, full_block, event_type, customer_note, admin_note,
      confirmation_token_hash, email_verification_expires_at, pending_expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      humanNumber,
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

function defaultTemplateMap(service) {
  const t = {};
  const keys =
    service === "hotel"
      ? [
          "confirm_email",
          "pending_client",
          "pending_admin",
          "confirmed_client",
          "cancelled_client",
          "expired_email_client",
          "expired_pending_client",
          "expired_pending_admin",
        ]
      : service === "restaurant"
        ? [
            "rest_confirm_email",
            "rest_pending_client",
            "rest_pending_admin",
            "rest_confirmed_client",
            "rest_cancelled_client",
            "rest_expired_client",
            "rest_expired_admin",
          ]
        : [
            "hall_confirm_email",
            "hall_pending_client",
            "hall_pending_admin",
            "hall_confirmed_client",
            "hall_cancelled_client",
            "hall_expired_client",
            "hall_expired_admin",
          ];
  keys.forEach((k) => {
    t[k] = {
      subject: `${service} - ${k}`,
      bodyHtml: `<p>Szablon ${k}</p>`,
    };
  });
  return t;
}

async function loadTemplates(env, service) {
  const rows = await env.DB.prepare(
    "SELECT key, subject, body_html AS bodyHtml FROM booking_mail_templates WHERE service = ? ORDER BY key ASC"
  )
    .bind(service)
    .all();
  if ((rows.results || []).length === 0) {
    const defaults = defaultTemplateMap(service);
    const now = nowMs();
    for (const [key, val] of Object.entries(defaults)) {
      await env.DB.prepare(
        "INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at) VALUES (?, ?, ?, ?, ?)"
      )
        .bind(service, key, val.subject, val.bodyHtml, now)
        .run();
    }
    return defaults;
  }
  const out = {};
  (rows.results || []).forEach((r) => {
    out[r.key] = { subject: r.subject || "", bodyHtml: r.bodyHtml || "" };
  });
  return out;
}

async function saveTemplate(env, service, key, subject, bodyHtml) {
  await env.DB.prepare(
    "INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(service, key) DO UPDATE SET subject = excluded.subject, body_html = excluded.body_html, updated_at = excluded.updated_at"
  )
    .bind(service, cleanString(key, 120), cleanString(subject, 400), String(bodyHtml || ""), nowMs())
    .run();
}

async function listHotelReservations(env, status) {
  const rows = await env.DB.prepare(
    `SELECT * FROM hotel_reservations ${status && status !== "all" ? "WHERE status = ?" : ""} ORDER BY created_at DESC LIMIT 500`
  )
    .bind(...(status && status !== "all" ? [status] : []))
    .all();
  return (rows.results || []).map(mapHotelReservation);
}

async function listRestaurantReservations(env, status) {
  const tables = await restaurantTables(env, true);
  const map = new Map(tables.map((t) => [t.id, t]));
  const rows = await env.DB.prepare(
    `SELECT * FROM restaurant_reservations ${status && status !== "all" ? "WHERE status = ?" : ""} ORDER BY created_at DESC LIMIT 500`
  )
    .bind(...(status && status !== "all" ? [status] : []))
    .all();
  return (rows.results || []).map((r) => mapRestaurantReservation(r, map));
}

async function listHallReservations(env, status) {
  const halls = await venueHalls(env);
  const map = new Map(halls.map((h) => [h.id, h]));
  const rows = await env.DB.prepare(
    `SELECT * FROM venue_reservations ${status && status !== "all" ? "WHERE status = ?" : ""} ORDER BY created_at DESC LIMIT 500`
  )
    .bind(...(status && status !== "all" ? [status] : []))
    .all();
  return (rows.results || []).map((r) => mapHallReservation(r, map));
}

async function handleHotelPublic(env, op, request, verifyTurnstileToken) {
  if (op === "health" && request.method === "GET") {
    return { status: 200, data: { ok: true, service: "hotelApi-d1" } };
  }
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
      assertSession(body.sessionStartedAt);
      assertTerms(body.termsAccepted);
      if (!cleanString(body.fullName, 120) || !cleanString(body.email, 180).includes("@")) {
        return { status: 400, data: { error: "Wypełnij imię i nazwisko oraz poprawny e-mail." } };
      }
      const out = await createHotelReservation(env, body, { withConfirmationToken: true, status: "email_verification_pending" });
      return {
        status: 200,
        data: {
          ok: true,
          reservationId: out.id,
          humanNumber: out.humanNumber,
          message: "Wysłano wiadomość z linkiem potwierdzającym.",
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
    if (row.status !== "email_verification_pending") return { status: 400, data: { error: "Ta rezerwacja została już przetworzona." } };
    if (row.email_verification_expires_at && Number(row.email_verification_expires_at) < nowMs()) {
      await env.DB.prepare("UPDATE hotel_reservations SET status='expired', updated_at=? WHERE id=?")
        .bind(nowMs(), row.id)
        .run();
      return { status: 400, data: { error: "Link potwierdzający wygasł." } };
    }
    try {
      const roomIds = parseJson(row.room_ids_json, []);
      await assertHotelRoomIdsAvailable(env, roomIds, row.date_from, row.date_to, row.id);
      await env.DB.prepare(
        "UPDATE hotel_reservations SET status='pending', pending_expires_at=?, updated_at=? WHERE id=?"
      )
        .bind(nowMs() + HOTEL_PENDING_MS, nowMs(), row.id)
        .run();
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
      assertSession(body.sessionStartedAt);
      assertTerms(body.termsAccepted);
      if (!cleanString(body.fullName, 120) || !cleanString(body.email, 180).includes("@")) {
        return { status: 400, data: { error: "Wypełnij imię i nazwisko oraz poprawny e-mail." } };
      }
      const out = await createRestaurantReservation(env, body, { withConfirmationToken: true, status: "email_verification_pending" });
      return {
        status: 200,
        data: {
          ok: true,
          reservationId: out.id,
          humanNumber: out.humanNumber,
          message: "Wysłano wiadomość z linkiem potwierdzającym.",
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
    if (row.status !== "email_verification_pending") return { status: 400, data: { error: "Ta rezerwacja została już przetworzona." } };
    if (row.email_verification_expires_at && Number(row.email_verification_expires_at) < nowMs()) {
      await env.DB.prepare("UPDATE restaurant_reservations SET status='expired', updated_at=? WHERE id=?")
        .bind(nowMs(), row.id)
        .run();
      return { status: 400, data: { error: "Link potwierdzający wygasł." } };
    }
    try {
      const assigned = await restaurantAvailableTableIds(
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
        "UPDATE restaurant_reservations SET status='pending', assigned_table_ids_json=?, pending_expires_at=?, updated_at=? WHERE id=?"
      )
        .bind(toJson(assigned), nowMs() + RESTAURANT_PENDING_MS, nowMs(), row.id)
        .run();
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
      assertSession(body.sessionStartedAt);
      assertTerms(body.termsAccepted);
      if (!cleanString(body.fullName, 120) || !cleanString(body.email, 180).includes("@")) {
        return { status: 400, data: { error: "Wypełnij imię i nazwisko oraz poprawny e-mail." } };
      }
      if (!cleanString(body.eventType, 500)) {
        return { status: 400, data: { error: "Podaj rodzaj imprezy." } };
      }
      const out = await createHallReservation(env, body, { withConfirmationToken: true, status: "email_verification_pending" });
      return {
        status: 200,
        data: {
          ok: true,
          reservationId: out.id,
          humanNumber: out.humanNumber,
          message: "Wysłano wiadomość z linkiem potwierdzającym.",
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
    if (row.status !== "email_verification_pending") return { status: 400, data: { error: "Ta rezerwacja została już przetworzona." } };
    if (row.email_verification_expires_at && Number(row.email_verification_expires_at) < nowMs()) {
      await env.DB.prepare("UPDATE venue_reservations SET status='expired', updated_at=? WHERE id=?")
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
        row.id
      );
      if (!chk.ok) return { status: 409, data: { error: "Termin niedostępny." } };
      await env.DB.prepare(
        "UPDATE venue_reservations SET status='pending', pending_expires_at=?, updated_at=? WHERE id=?"
      )
        .bind(nowMs() + HALL_PENDING_MS, nowMs(), row.id)
        .run();
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
      const status = ["pending", "confirmed", "manual_block"].includes(body.status) ? body.status : "pending";
      const out = await createHotelReservation(env, body, { status, withConfirmationToken: false });
      return { status: 200, data: { ok: true, reservationId: out.id, humanNumber: out.humanNumber } };
    } catch (error) {
      return { status: 400, data: { error: error.message || "Błąd tworzenia." } };
    }
  }
  if (op === "admin-manual-block" && request.method === "POST") {
    const body = await readBody(request);
    try {
      const out = await createHotelReservation(env, {
        ...body,
        fullName: "Blokada terminu",
        email: "noreply@local",
        phonePrefix: "+48",
        phoneNational: "000000000",
        customerNote: cleanString(body.note, 2000),
        adminNote: cleanString(body.note, 2000),
      }, { status: "manual_block", withConfirmationToken: false });
      return { status: 200, data: { ok: true, reservationId: out.id } };
    } catch (error) {
      return { status: 400, data: { error: error.message || "Błąd blokady." } };
    }
  }
  if (op === "admin-reservation-update" && request.method === "PATCH") {
    const body = await readBody(request);
    await env.DB.prepare("UPDATE hotel_reservations SET admin_note=?, updated_at=? WHERE id=?")
      .bind(cleanString(body.adminNote, 2000), nowMs(), cleanString(body.id, 80))
      .run();
    return { status: 200, data: { ok: true } };
  }
  if (op === "admin-reservation-confirm" && request.method === "POST") {
    const body = await readBody(request);
    await env.DB.prepare("UPDATE hotel_reservations SET status='confirmed', pending_expires_at=NULL, updated_at=? WHERE id=?")
      .bind(nowMs(), cleanString(body.id, 80))
      .run();
    return { status: 200, data: { ok: true } };
  }
  if (op === "admin-reservation-cancel" && request.method === "POST") {
    const body = await readBody(request);
    await env.DB.prepare("UPDATE hotel_reservations SET status='cancelled', pending_expires_at=NULL, updated_at=? WHERE id=?")
      .bind(nowMs(), cleanString(body.id, 80))
      .run();
    return { status: 200, data: { ok: true } };
  }
  if (op === "admin-mail-templates" && request.method === "GET") {
    return { status: 200, data: { templates: await loadTemplates(env, "hotel") } };
  }
  if (op === "admin-mail-template-save" && request.method === "PUT") {
    const body = await readBody(request);
    await saveTemplate(env, "hotel", body.key, body.subject, body.bodyHtml);
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
    return { status: 200, data: { reservation: mapRestaurantReservation(row, map) } };
  }
  if (op === "admin-reservation-create" && request.method === "POST") {
    const body = await readBody(request);
    try {
      const status = ["pending", "confirmed", "manual_block"].includes(body.status) ? body.status : "pending";
      let assigned = [];
      if (status !== "email_verification_pending") {
        const chk = await assertRestaurantAvailability(env, body, null);
        if (!chk.ok) return { status: 409, data: { error: "Brak wolnych stolików." } };
        assigned = chk.availableIds;
      }
      const out = await createRestaurantReservation(env, body, {
        status,
        withConfirmationToken: false,
        assignedTableIds: assigned,
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
      email: "noreply@local",
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
      });
      return { status: 200, data: { ok: true, reservationId: out.id } };
    } catch (error) {
      return { status: 400, data: { error: error.message || "Błąd blokady." } };
    }
  }
  if (op === "admin-reservation-update" && request.method === "PATCH") {
    const body = await readBody(request);
    await env.DB.prepare("UPDATE restaurant_reservations SET admin_note=?, updated_at=? WHERE id=?")
      .bind(cleanString(body.adminNote, 2000), nowMs(), cleanString(body.id, 80))
      .run();
    return { status: 200, data: { ok: true } };
  }
  if (op === "admin-reservation-confirm" && request.method === "POST") {
    const body = await readBody(request);
    await env.DB.prepare("UPDATE restaurant_reservations SET status='confirmed', pending_expires_at=NULL, updated_at=? WHERE id=?")
      .bind(nowMs(), cleanString(body.id, 80))
      .run();
    return { status: 200, data: { ok: true } };
  }
  if (op === "admin-reservation-cancel" && request.method === "POST") {
    const body = await readBody(request);
    await env.DB.prepare("UPDATE restaurant_reservations SET status='cancelled', pending_expires_at=NULL, updated_at=? WHERE id=?")
      .bind(nowMs(), cleanString(body.id, 80))
      .run();
    return { status: 200, data: { ok: true } };
  }
  if (op === "admin-mail-templates" && request.method === "GET") {
    return { status: 200, data: { templates: await loadTemplates(env, "restaurant") } };
  }
  if (op === "admin-mail-template-save" && request.method === "PUT") {
    const body = await readBody(request);
    await saveTemplate(env, "restaurant", body.key, body.subject, body.bodyHtml);
    return { status: 200, data: { ok: true } };
  }
  return null;
}

async function handleHallAdmin(env, op, request) {
  if (op === "admin-halls-list" && request.method === "GET") {
    return { status: 200, data: { halls: await venueHalls(env) } };
  }
  if (op === "admin-venue-settings" && request.method === "GET") {
    return { status: 200, data: { settings: await venueSettings(env) } };
  }
  if (op === "admin-venue-settings-save" && request.method === "PUT") {
    const body = await readBody(request);
    await env.DB.prepare("UPDATE venue_settings SET hall_open_time=?, hall_close_time=?, updated_at=? WHERE id='default'")
      .bind(cleanString(body.hallOpenTime, 5) || "08:00", cleanString(body.hallCloseTime, 5) || "23:00", nowMs())
      .run();
    return { status: 200, data: { ok: true } };
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
      const status = ["pending", "confirmed", "manual_block"].includes(body.status) ? body.status : "pending";
      const out = await createHallReservation(env, body, { status, withConfirmationToken: false });
      return { status: 200, data: { ok: true, reservationId: out.id, humanNumber: out.humanNumber } };
    } catch (error) {
      return { status: 400, data: { error: error.message || "Błąd tworzenia." } };
    }
  }
  if (op === "admin-reservation-update" && request.method === "PATCH") {
    const body = await readBody(request);
    await env.DB.prepare("UPDATE venue_reservations SET admin_note=?, updated_at=? WHERE id=?")
      .bind(cleanString(body.adminNote, 2000), nowMs(), cleanString(body.id, 80))
      .run();
    return { status: 200, data: { ok: true } };
  }
  if (op === "admin-reservation-confirm" && request.method === "POST") {
    const body = await readBody(request);
    await env.DB.prepare("UPDATE venue_reservations SET status='confirmed', pending_expires_at=NULL, updated_at=? WHERE id=?")
      .bind(nowMs(), cleanString(body.id, 80))
      .run();
    return { status: 200, data: { ok: true } };
  }
  if (op === "admin-reservation-cancel" && request.method === "POST") {
    const body = await readBody(request);
    await env.DB.prepare("UPDATE venue_reservations SET status='cancelled', pending_expires_at=NULL, updated_at=? WHERE id=?")
      .bind(nowMs(), cleanString(body.id, 80))
      .run();
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
    await saveTemplate(env, "hall", body.key, body.subject, body.bodyHtml);
    return { status: 200, data: { ok: true } };
  }
  return null;
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
