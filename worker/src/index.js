import { DEFAULT_CONTENT } from "./default-content.js";
import { parseAdminEmailAllowlist, verifyFirebaseIdToken } from "./firebase-verify.js";
import { handleD1BookingApi, runBookingMaintenance, sendContactFormAdminEmail } from "./booking-d1.js";

const MAX_MEDIA_FILE_BYTES = 1_700_000;
const BOOTSTRAP_EDGE_CACHE_TTL_MS = 30 * 1000;
const bootstrapPayloadCache = new Map();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    try {
      if (url.pathname === "/api/public/bootstrap" && request.method === "GET") {
        assertBrowserLikePublicRequest(request, url);
        return jsonResponse(await getPublicBootstrap(env, url), 200, request, env, {
          // Treść z CMS (m.in. przełączniki rezerwacji) musi być świeża — bez długiego cache na edge.
          "Cache-Control": "private, no-cache, max-age=0, must-revalidate",
        });
      }

      if (url.pathname === "/api/public/calendar" && request.method === "GET") {
        assertBrowserLikePublicRequest(request, url);
        const from = url.searchParams.get("from");
        return jsonResponse(await getCalendarBlocks(env, from, url), 200, request, env, {
          "Cache-Control": "public, max-age=60, s-maxage=120, stale-while-revalidate=300",
        });
      }

      if (url.pathname === "/api/public/contact" && request.method === "POST") {
        assertBrowserLikePublicRequest(request, url);
        const payload = await request.json();
        await handleContactSubmission(payload, request, env);
        return jsonResponse({ ok: true }, 201, request, env);
      }

      if (url.pathname.startsWith("/api/public/gallery-images/") && request.method === "GET") {
        const imageId = url.pathname.split("/").pop();
        return streamGalleryImage(imageId, env, request);
      }

      if (url.pathname.startsWith("/api/public/documents/") && request.method === "GET") {
        const documentId = url.pathname.split("/").pop();
        const download = url.searchParams.get("download") === "1";
        return streamDocument(documentId, download, env, request);
      }

      if (url.pathname.startsWith("/api/public/hotel-room-images/") && request.method === "GET") {
        const imageId = url.pathname.split("/").pop();
        return streamHotelRoomImage(imageId, env, request);
      }

      if (url.pathname === "/api/admin/session" && request.method === "GET") {
        await requireFirebaseAdmin(request, env);
        return jsonResponse({ ok: true }, 200, request, env);
      }

      if (url.pathname === "/api/admin/dashboard" && request.method === "GET") {
        await requireFirebaseAdmin(request, env);
        const content = await getContent(env, url);
        const documents = await listDocuments(env, url);
        const galleryAlbums = await listGalleryAlbums(env, url);
        const calendar = await getCalendarBlocks(env, null, url);
        const submissions = await env.DB.prepare(
          "SELECT id, full_name AS fullName, email, phone, event_type AS eventType, preferred_date AS preferredDate, message, status, created_at AS createdAt FROM contact_submissions ORDER BY created_at DESC LIMIT 100"
        ).all();
        const hallMap = new Map(content.events.halls.map((hall) => [hall.key, hall.name]));
        const calendarBlocks = (calendar.blocks || []).map((block) => ({
          ...block,
          hallName: hallMap.get(block.hallKey) || block.hallKey,
        }));
        const notifications = await listAllSiteNotifications(env);
        return jsonResponse(
          {
            content,
            documents,
            galleryAlbums,
            calendarBlocks,
            submissions: submissions.results || [],
            notifications,
            capabilities: {
              mediaStorageEnabled: true,
            },
          },
          200,
          request,
          env
        );
      }

      if (url.pathname === "/api/admin/notifications" && request.method === "POST") {
        await requireFirebaseAdmin(request, env);
        const payload = await request.json();
        const row = await createSiteNotification(env, payload);
        return jsonResponse({ notification: row }, 201, request, env);
      }

      if (url.pathname.match(/^\/api\/admin\/notifications\/\d+$/) && request.method === "PUT") {
        await requireFirebaseAdmin(request, env);
        const id = Number(url.pathname.split("/").pop());
        const payload = await request.json();
        const row = await updateSiteNotification(env, id, payload);
        return jsonResponse({ notification: row }, 200, request, env);
      }

      if (url.pathname.match(/^\/api\/admin\/notifications\/\d+$/) && request.method === "DELETE") {
        await requireFirebaseAdmin(request, env);
        const id = Number(url.pathname.split("/").pop());
        await deleteSiteNotification(env, id);
        return jsonResponse({ ok: true }, 200, request, env);
      }

      if (url.pathname === "/api/admin/content" && request.method === "PUT") {
        await requireFirebaseAdmin(request, env);
        const payload = await request.json();
        const content = sanitizeContent(payload.content || DEFAULT_CONTENT);
        await saveContent(env, content);
        return jsonResponse({ content: await getContent(env, url) }, 200, request, env);
      }

      if (url.pathname === "/api/admin/gallery/albums" && request.method === "POST") {
        await requireFirebaseAdmin(request, env);
        const payload = await request.json();
        const title = String(payload.title || "").trim();
        if (!title) {
          return jsonResponse({ error: "Tytul albumu jest wymagany." }, 400, request, env);
        }
        const now = nowIso();
        const slug = await findUniqueGalleryAlbumSlug(payload.slug || title, env);
        await env.DB.prepare(
          "INSERT INTO gallery_albums (slug, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
        )
          .bind(slug, title, (payload.description || "").trim(), now, now)
          .run();
        return jsonResponse({ ok: true }, 201, request, env);
      }

      if (url.pathname === "/api/admin/gallery/albums/reorder" && request.method === "POST") {
        await requireFirebaseAdmin(request, env);
        const payload = await request.json();
        await reorderGalleryAlbums(payload.albumIds, env);
        return jsonResponse({ ok: true }, 200, request, env);
      }

      if (url.pathname.match(/^\/api\/admin\/gallery\/albums\/\d+$/) && request.method === "DELETE") {
        await requireFirebaseAdmin(request, env);
        const albumId = Number(url.pathname.split("/")[5]);
        await deleteGalleryAlbum(albumId, env);
        return jsonResponse({ ok: true }, 200, request, env);
      }

      if (
        url.pathname.match(/^\/api\/admin\/gallery\/albums\/\d+\/images$/) &&
        request.method === "POST"
      ) {
        await requireFirebaseAdmin(request, env);
        const albumId = Number(url.pathname.split("/")[5]);
        await uploadGalleryImages(albumId, request, env);
        return jsonResponse({ ok: true }, 201, request, env);
      }

      if (
        url.pathname.match(/^\/api\/admin\/gallery\/albums\/\d+\/reorder-images$/) &&
        request.method === "POST"
      ) {
        await requireFirebaseAdmin(request, env);
        const albumId = Number(url.pathname.split("/")[5]);
        const payload = await request.json();
        await reorderGalleryAlbumImages(albumId, payload.imageIds, env);
        return jsonResponse({ ok: true }, 200, request, env);
      }

      if (
        url.pathname.match(/^\/api\/admin\/gallery\/images\/\d+\/cover$/) &&
        request.method === "POST"
      ) {
        await requireFirebaseAdmin(request, env);
        const imageId = Number(url.pathname.split("/")[5]);
        await setAlbumCover(imageId, env);
        return jsonResponse({ ok: true }, 200, request, env);
      }

      if (url.pathname.match(/^\/api\/admin\/gallery\/images\/\d+$/) && request.method === "DELETE") {
        await requireFirebaseAdmin(request, env);
        const imageId = Number(url.pathname.split("/")[5]);
        await deleteGalleryImage(imageId, env);
        return jsonResponse({ ok: true }, 200, request, env);
      }

      if (url.pathname === "/api/admin/documents" && request.method === "POST") {
        await requireFirebaseAdmin(request, env);
        await uploadDocument(request, env);
        return jsonResponse({ ok: true }, 201, request, env);
      }

      if (url.pathname === "/api/admin/hotel/room-galleries" && request.method === "GET") {
        await requireFirebaseAdmin(request, env);
        return jsonResponse({ roomGalleries: await listHotelRoomGalleries(env, url) }, 200, request, env);
      }

      if (
        url.pathname.match(/^\/api\/admin\/hotel\/room-galleries\/[^/]+\/images$/) &&
        request.method === "POST"
      ) {
        await requireFirebaseAdmin(request, env);
        const roomType = decodeURIComponent(url.pathname.split("/")[5]);
        await uploadHotelRoomImages(roomType, request, env);
        return jsonResponse({ roomGalleries: await listHotelRoomGalleries(env, url) }, 201, request, env);
      }

      if (url.pathname.match(/^\/api\/admin\/hotel\/room-images\/\d+$/) && request.method === "DELETE") {
        await requireFirebaseAdmin(request, env);
        const imageId = Number(url.pathname.split("/")[5]);
        await deleteHotelRoomImage(imageId, env);
        return jsonResponse({ roomGalleries: await listHotelRoomGalleries(env, url) }, 200, request, env);
      }

      if (
        url.pathname.match(/^\/api\/admin\/hotel\/room-galleries\/[^/]+\/reorder$/) &&
        request.method === "POST"
      ) {
        await requireFirebaseAdmin(request, env);
        const roomType = decodeURIComponent(url.pathname.split("/")[5]);
        const payload = await request.json();
        await reorderHotelRoomImages(roomType, payload.imageIds, env);
        return jsonResponse({ roomGalleries: await listHotelRoomGalleries(env, url) }, 200, request, env);
      }

      if (url.pathname.match(/^\/api\/admin\/documents\/\d+$/) && request.method === "DELETE") {
        await requireFirebaseAdmin(request, env);
        const documentId = Number(url.pathname.split("/")[4]);
        await deleteDocument(documentId, env);
        return jsonResponse({ ok: true }, 200, request, env);
      }

      if (url.pathname === "/api/admin/calendar/blocks" && request.method === "POST") {
        await requireFirebaseAdmin(request, env);
        const payload = await request.json();
        await createCalendarBlock(payload, env);
        return jsonResponse({ ok: true }, 201, request, env);
      }

      if (url.pathname.match(/^\/api\/admin\/calendar\/blocks\/\d+$/) && request.method === "DELETE") {
        await requireFirebaseAdmin(request, env);
        const blockId = Number(url.pathname.split("/")[5]);
        await env.DB.prepare("DELETE FROM calendar_blocks WHERE id = ?").bind(blockId).run();
        return jsonResponse({ ok: true }, 200, request, env);
      }

      if (url.pathname.match(/^\/api\/admin\/submissions\/\d+$/) && request.method === "PATCH") {
        await requireFirebaseAdmin(request, env);
        const submissionId = Number(url.pathname.split("/")[4]);
        const payload = await request.json();
        await env.DB.prepare(
          "UPDATE contact_submissions SET status = ? WHERE id = ?"
        )
          .bind(payload.status || "new", submissionId)
          .run();
        return jsonResponse({ ok: true }, 200, request, env);
      }

      if (
        url.pathname.match(/^\/api\/public\/legacy-bookings\/(hotel|restaurant|hall)$/) &&
        ["GET", "POST"].includes(request.method)
      ) {
        assertBrowserLikePublicRequest(request, url);
        const service = url.pathname.split("/").pop();
        const op = String(url.searchParams.get("op") || "").trim();
        if (!isAllowedPublicLegacyBookingOp(op)) {
          return jsonResponse({ error: "Niedozwolona operacja publiczna." }, 403, request, env);
        }
        const native = await handleD1BookingApi({
          service,
          op,
          request,
          env,
          isAdmin: false,
          verifyTurnstileToken: env.TURNSTILE_SECRET
            ? async (token) => verifyTurnstile(token, request, env)
            : null,
        });
        if (native) {
          return jsonResponse(native.data, native.status || 200, request, env);
        }
        return proxyLegacyBookingApi(service, request, url, env);
      }

      if (
        url.pathname.match(/^\/api\/admin\/legacy-bookings\/(hotel|restaurant|hall)$/) &&
        ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(request.method)
      ) {
        await requireFirebaseAdmin(request, env);
        const service = url.pathname.split("/").pop();
        const op = String(url.searchParams.get("op") || "").trim();
        const native = await handleD1BookingApi({
          service,
          op,
          request,
          env,
          isAdmin: true,
          verifyTurnstileToken: null,
        });
        if (native) {
          return jsonResponse(native.data, native.status || 200, request, env);
        }
        return proxyLegacyBookingApi(service, request, url, env);
      }

      return jsonResponse({ error: "Nie znaleziono zasobu." }, 404, request, env);
    } catch (error) {
      const status = error.status || 500;
      return jsonResponse({ error: error.message || "Wystapil blad." }, status, request, env);
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const result = await runBookingMaintenance(env);
        console.log("Booking maintenance completed", {
          cron: controller.cron || "",
          scheduledTime: controller.scheduledTime || 0,
          ...result,
        });
      })()
    );
  },
};

let siteNotificationsSchemaPromise = null;

async function ensureSiteNotificationsTable(env) {
  if (siteNotificationsSchemaPromise) {
    return siteNotificationsSchemaPromise;
  }
  siteNotificationsSchemaPromise = (async () => {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS site_notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        starts_at TEXT NOT NULL,
        ends_at TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`
    ).run();
    await env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_site_notifications_window ON site_notifications(starts_at, ends_at)`
    ).run();
  })();
  return siteNotificationsSchemaPromise;
}

function parseNotificationIso(value, label) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw badRequest(`${label} jest wymagana.`);
  }
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) {
    throw badRequest(`${label} ma nieprawidlowy format.`);
  }
  return new Date(ms).toISOString();
}

function sanitizeNotificationPayload(payload) {
  const title = String(payload?.title || "").trim().slice(0, 200);
  if (!title) {
    throw badRequest("Tytul powiadomienia jest wymagany.");
  }
  const description = String(payload?.description || "").trim().slice(0, 4000);
  const startsAt = parseNotificationIso(payload?.startsAt, "Data i godzina poczatku");
  const endsAt = parseNotificationIso(payload?.endsAt, "Data i godzina konca");
  if (Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw badRequest("Koniec musi byc pozniej niz poczatek.");
  }
  return { title, description, startsAt, endsAt };
}

function mapSiteNotificationRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    startsAt: row.starts_at ?? row.startsAt,
    endsAt: row.ends_at ?? row.endsAt,
    sortOrder: row.sort_order ?? row.sortOrder ?? 0,
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
  };
}

async function listActiveSiteNotifications(env) {
  await ensureSiteNotificationsTable(env);
  const now = nowIso();
  const result = await env.DB.prepare(
    `SELECT id, title, description, starts_at AS startsAt, ends_at AS endsAt
     FROM site_notifications
     WHERE starts_at <= ? AND ends_at >= ?
     ORDER BY sort_order ASC, id ASC`
  )
    .bind(now, now)
    .all();
  return (result.results || []).map((row) => mapSiteNotificationRow(row));
}

async function listAllSiteNotifications(env) {
  await ensureSiteNotificationsTable(env);
  const result = await env.DB.prepare(
    `SELECT id, title, description, starts_at AS startsAt, ends_at AS endsAt,
            sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt
     FROM site_notifications
     ORDER BY sort_order ASC, id DESC`
  ).all();
  return (result.results || []).map((row) => mapSiteNotificationRow(row));
}

async function createSiteNotification(env, payload) {
  const { title, description, startsAt, endsAt } = sanitizeNotificationPayload(payload);
  const now = nowIso();
  const maxRow = await env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) AS m FROM site_notifications"
  ).first();
  const sortOrder = Number(maxRow?.m ?? -1) + 1;
  const insert = await env.DB.prepare(
    `INSERT INTO site_notifications (title, description, starts_at, ends_at, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(title, description, startsAt, endsAt, sortOrder, now, now)
    .run();
  let id = insert.meta?.last_row_id;
  if (!id) {
    const last = await env.DB.prepare("SELECT last_insert_rowid() AS id").first();
    id = Number(last?.id);
  }
  const row = await env.DB.prepare(
    `SELECT id, title, description, starts_at AS startsAt, ends_at AS endsAt,
            sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt
     FROM site_notifications WHERE id = ?`
  )
    .bind(id)
    .first();
  return mapSiteNotificationRow(row);
}

async function updateSiteNotification(env, id, payload) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    throw badRequest("Nieprawidlowy identyfikator powiadomienia.");
  }
  const { title, description, startsAt, endsAt } = sanitizeNotificationPayload(payload);
  const existing = await env.DB.prepare("SELECT id FROM site_notifications WHERE id = ?")
    .bind(numericId)
    .first();
  if (!existing) {
    throw badRequest("Nie znaleziono powiadomienia.");
  }
  const now = nowIso();
  await env.DB.prepare(
    `UPDATE site_notifications
     SET title = ?, description = ?, starts_at = ?, ends_at = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(title, description, startsAt, endsAt, now, numericId)
    .run();
  const row = await env.DB.prepare(
    `SELECT id, title, description, starts_at AS startsAt, ends_at AS endsAt,
            sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt
     FROM site_notifications WHERE id = ?`
  )
    .bind(numericId)
    .first();
  return mapSiteNotificationRow(row);
}

async function deleteSiteNotification(env, id) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    throw badRequest("Nieprawidlowy identyfikator powiadomienia.");
  }
  await env.DB.prepare("DELETE FROM site_notifications WHERE id = ?").bind(numericId).run();
}

async function getPublicBootstrap(env, url) {
  const originKey = String(url?.origin || "");
  const now = Date.now();
  const cached = bootstrapPayloadCache.get(originKey);
  if (cached && now - cached.ts < BOOTSTRAP_EDGE_CACHE_TTL_MS) {
    return cached.payload;
  }

  const content = await getContent(env, url);
  const payload = {
    content,
    documents: await listDocuments(env, url),
    galleryAlbums: await listGalleryAlbums(env, url),
    activeNotifications: await listActiveSiteNotifications(env),
    capabilities: {
      mediaStorageEnabled: true,
    },
  };
  bootstrapPayloadCache.set(originKey, { ts: now, payload });
  return payload;
}

async function getContent(env, url = null) {
  const record = await env.DB.prepare(
    "SELECT content_json FROM site_content WHERE id = 1"
  ).first();
  if (!record) {
    await saveContent(env, DEFAULT_CONTENT);
    const fallback = structuredClone(DEFAULT_CONTENT);
    return url ? withHotelRoomGalleries(fallback, await listHotelRoomGalleries(env, url)) : fallback;
  }
  const parsed = JSON.parse(record.content_json);
  const content = sanitizeContent(parsed);
  if (!url) {
    return content;
  }
  return withHotelRoomGalleries(content, await listHotelRoomGalleries(env, url));
}

async function saveContent(env, content) {
  try {
    await env.DB.prepare(
      "INSERT INTO site_content (id, content_json, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET content_json = excluded.content_json, updated_at = excluded.updated_at"
    )
      .bind(JSON.stringify(content), nowIso())
      .run();
  } catch (error) {
    const message = String(error?.message || "");
    if (/SQLITE_TOOBIG|string or blob too big|too big/i.test(message)) {
      throw badRequest(
        "Nie udalo sie zapisac tresci, bo laczny rozmiar danych jest zbyt duzy. Zmniejsz liczbe lub rozmiar zdjec i sprobuj ponownie."
      );
    }
    throw error;
  }
}

async function listDocuments(env, url) {
  const result = await env.DB.prepare(
    "SELECT id, title, description, mime_type AS mimeType, file_name AS fileName FROM documents ORDER BY created_at DESC"
  ).all();
  return (result.results || []).map((item) => ({
    id: item.id,
    title: item.title,
    description: item.description,
    fileType: item.mimeType.includes("pdf") ? "pdf" : item.fileName.split(".").pop().toLowerCase(),
    previewUrl: item.mimeType.includes("pdf")
      ? absoluteUrl(url, `/api/public/documents/${item.id}`)
      : "",
    downloadUrl: absoluteUrl(url, `/api/public/documents/${item.id}?download=1`),
  }));
}

async function listGalleryAlbums(env, url) {
  const albumResult = await env.DB.prepare(
    "SELECT id, slug, title, description FROM gallery_albums ORDER BY created_at ASC, id ASC"
  ).all();
  const imageResult = await env.DB.prepare(
    "SELECT id, album_id AS albumId, alt_text AS altText FROM gallery_images ORDER BY created_at ASC, id ASC"
  ).all();
  const imagesByAlbum = new Map();
  for (const image of imageResult.results || []) {
    if (!imagesByAlbum.has(image.albumId)) {
      imagesByAlbum.set(image.albumId, []);
    }
    imagesByAlbum.get(image.albumId).push({
      id: image.id,
      url: absoluteUrl(url, `/api/public/gallery-images/${image.id}`),
      alt: image.altText,
    });
  }
  return (albumResult.results || []).map((album) => {
    const images = imagesByAlbum.get(album.id) || [];
    const cover = images[0] || null;
    return {
      id: String(album.id),
      slug: album.slug,
      title: album.title,
      description: album.description,
      coverUrl: cover ? cover.url : "https://placehold.co/800x600/111/ccb06a?text=Sredzka+Korona",
      images,
    };
  });
}

async function findUniqueGalleryAlbumSlug(value, env) {
  const baseSlug = sanitizeSlug(value) || "album";
  let candidate = baseSlug;
  let attempt = 1;

  while (true) {
    const existing = await env.DB.prepare("SELECT id FROM gallery_albums WHERE slug = ?").bind(candidate).first();
    if (!existing) {
      return candidate;
    }
    attempt += 1;
    candidate = `${baseSlug}-${attempt}`;
  }
}

function normalizeHotelRoomType(roomType) {
  const normalized = String(roomType || "").trim();
  const allowed = new Set(["1-osobowe", "2-osobowe", "3-osobowe", "4-osobowe"]);
  if (!allowed.has(normalized)) {
    throw badRequest("Nieprawidlowy typ pokoju.");
  }
  return normalized;
}

function emptyHotelRoomGalleries() {
  return {
    "1-osobowe": [],
    "2-osobowe": [],
    "3-osobowe": [],
    "4-osobowe": [],
  };
}

function withHotelRoomGalleries(content, roomGalleries) {
  return {
    ...content,
    hotel: {
      ...(content.hotel || {}),
      roomGalleries,
    },
  };
}

function isMissingHotelRoomImagesTableError(error) {
  const message = String(error?.message || "");
  return /no such table:\s*hotel_room_images/i.test(message);
}

function isMissingGalleryImagesStorageSchemaError(error) {
  const message = String(error?.message || "");
  return (
    /no such table:\s*gallery_images/i.test(message) ||
    /table\s+gallery_images\s+has no column named\s+(object_key|mime_type|blob_data|byte_size)/i.test(message)
  );
}

async function listHotelRoomGalleries(env, url) {
  let result;
  try {
    result = await env.DB.prepare(
      "SELECT id, room_type AS roomType, alt_text AS altText FROM hotel_room_images ORDER BY room_type ASC, sort_order ASC, id ASC"
    ).all();
  } catch (error) {
    if (isMissingHotelRoomImagesTableError(error)) {
      return emptyHotelRoomGalleries();
    }
    throw error;
  }
  const galleries = emptyHotelRoomGalleries();
  for (const item of result.results || []) {
    if (!galleries[item.roomType]) {
      galleries[item.roomType] = [];
    }
    galleries[item.roomType].push({
      id: item.id,
      url: absoluteUrl(url, `/api/public/hotel-room-images/${item.id}`),
      alt: item.altText || "",
    });
  }
  return galleries;
}

async function getCalendarBlocks(env, from, url) {
  const startDate = from ? new Date(`${from}T00:00:00`) : new Date();
  const endDate = new Date(startDate.getTime() + 1000 * 60 * 60 * 24 * 31);
  let result;
  try {
    result = await env.DB.prepare(
      "SELECT id, hall_key AS hallKey, start_at AS startAt, end_at AS endAt, label, notes, guests_count AS guestsCount, exclusive FROM calendar_blocks WHERE start_at <= ? AND end_at >= ? ORDER BY start_at ASC"
    )
      .bind(endDate.toISOString(), startDate.toISOString())
      .all();
  } catch (error) {
    const message = String(error?.message || "");
    if (!/no such column:\s*(guests_count|exclusive)/i.test(message)) {
      throw error;
    }
    result = await env.DB.prepare(
      "SELECT id, hall_key AS hallKey, start_at AS startAt, end_at AS endAt, label, notes FROM calendar_blocks WHERE start_at <= ? AND end_at >= ? ORDER BY start_at ASC"
    )
      .bind(endDate.toISOString(), startDate.toISOString())
      .all();
  }
  return {
    blocks: (result.results || []).map((item) => ({
      ...item,
      startAt: item.startAt,
      endAt: item.endAt,
      guestsCount: Number(item.guestsCount) || null,
      exclusive: Boolean(item.exclusive),
      detailsUrl: absoluteUrl(url, "/index.html#contact"),
    })),
  };
}

async function handleContactSubmission(payload, request, env) {
  const fullName = String(payload.fullName || payload.name || "").trim();
  const email = String(payload.email || "").trim();
  const message = String(payload.message || "").trim();
  const phone = String(payload.phone || "").trim();
  const eventType = String(payload.eventType || payload.topic || "").trim();
  const preferredDate = String(payload.preferredDate || "").trim();

  if (!fullName || !email || !message) {
    throw badRequest("Imie, e-mail i wiadomosc sa wymagane.");
  }
  if (!email.includes("@")) {
    throw badRequest("Nieprawidlowy adres e-mail.");
  }
  if (env.TURNSTILE_SECRET) {
    const ok = await verifyTurnstile(payload.turnstileToken, request, env);
    if (!ok) {
      throw badRequest("Nie udalo sie potwierdzic formularza.");
    }
  }
  await env.DB.prepare(
    "INSERT INTO contact_submissions (full_name, email, phone, event_type, preferred_date, message, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'new', ?)"
  )
    .bind(fullName, email, phone, eventType, preferredDate, message, nowIso())
    .run();

  try {
    await sendContactFormAdminEmail(env, { fullName, email, phone, formKind: eventType, message });
  } catch (error) {
    console.error("contact form: blad wysylki e-maila", error?.message || error);
  }
}

async function verifyTurnstile(token, request, env) {
  if (!token) {
    return false;
  }
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      secret: env.TURNSTILE_SECRET,
      response: token,
      remoteip: ip,
    }),
  });
  const data = await response.json();
  return Boolean(data.success);
}

async function requireFirebaseAdmin(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw unauthorized("Brak tokenu uwierzytelnienia (Firebase).");
  }
  let payload;
  try {
    payload = await verifyFirebaseIdToken(match[1], env);
  } catch (error) {
    throw unauthorized(error.message || "Token jest nieprawidlowy.");
  }
  const email = String(payload.email || "")
    .trim()
    .toLowerCase();
  if (!email) {
    throw unauthorized("Konto bez adresu e-mail nie ma dostepu do panelu.");
  }
  const allowlist = parseAdminEmailAllowlist(env.FIREBASE_ADMIN_EMAILS);
  if (!allowlist.length) {
    throw unauthorized("Serwer nie ma skonfigurowanej listy administratorow (FIREBASE_ADMIN_EMAILS).");
  }
  if (!allowlist.includes(email)) {
    throw unauthorized("To konto nie ma uprawnien administratora.");
  }
  return payload;
}

async function uploadGalleryImages(albumId, request, env) {
  const album = await env.DB.prepare(
    "SELECT id, slug FROM gallery_albums WHERE id = ?"
  )
    .bind(albumId)
    .first();
  if (!album) {
    throw badRequest("Album nie istnieje.");
  }
  const formData = await request.formData();
  const files = formData.getAll("images").filter((entry) => entry instanceof File);
  if (!files.length) {
    throw badRequest("Wybierz co najmniej jedno zdjecie.");
  }

  try {
    for (const file of files) {
      assertFileWithinLimit(file, "Zdjecie");
      const safeName = sanitizeFileName(file.name);
      const objectKey = `gallery/${album.slug}/${crypto.randomUUID()}-${safeName}`;
      const blobData = new Uint8Array(await file.arrayBuffer());
      await env.DB.prepare(
        "INSERT INTO gallery_images (album_id, object_key, file_name, alt_text, mime_type, blob_data, byte_size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
        .bind(
          album.id,
          objectKey,
          file.name,
          album.slug,
          normalizeImageMimeType(file.type, file.name),
          blobData,
          blobData.byteLength,
          nowIso()
        )
        .run();
    }
  } catch (error) {
    if (isMissingGalleryImagesStorageSchemaError(error)) {
      throw badRequest(
        "Brak aktualnej migracji bazy dla galerii. Uruchom najnowszy worker/schema.sql, aby dodac kolumny do przechowywania zdjec."
      );
    }
    throw error;
  }
}

async function setAlbumCover(imageId, env) {
  const image = await env.DB.prepare(
    "SELECT id, album_id AS albumId FROM gallery_images WHERE id = ?"
  )
    .bind(imageId)
    .first();
  if (!image) {
    throw badRequest("Zdjecie nie istnieje.");
  }
  await env.DB.prepare("UPDATE gallery_albums SET cover_image_id = ?, updated_at = ? WHERE id = ?")
    .bind(image.id, nowIso(), image.albumId)
    .run();
}

async function deleteGalleryImage(imageId, env) {
  const image = await env.DB.prepare(
    "SELECT id, album_id AS albumId FROM gallery_images WHERE id = ?"
  )
    .bind(imageId)
    .first();
  if (!image) {
    throw badRequest("Zdjecie nie istnieje.");
  }
  await env.DB.prepare("DELETE FROM gallery_images WHERE id = ?").bind(imageId).run();
  await env.DB.prepare("UPDATE gallery_albums SET updated_at = ? WHERE id = ?")
    .bind(nowIso(), image.albumId)
    .run();
}

async function deleteGalleryAlbum(albumId, env) {
  const id = Number(albumId);
  if (!Number.isInteger(id) || id <= 0) {
    throw badRequest("Album nie istnieje.");
  }
  const album = await env.DB.prepare("SELECT id FROM gallery_albums WHERE id = ?").bind(id).first();
  if (!album) {
    throw badRequest("Album nie istnieje.");
  }
  await env.DB.prepare("UPDATE gallery_albums SET cover_image_id = NULL, updated_at = ? WHERE id = ?")
    .bind(nowIso(), id)
    .run();
  await env.DB.prepare("DELETE FROM gallery_images WHERE album_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM gallery_albums WHERE id = ?").bind(id).run();
}

async function reorderGalleryAlbums(albumIds, env) {
  const ids = Array.isArray(albumIds)
    ? albumIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
    : [];
  if (!ids.length) {
    throw badRequest("Brak listy albumow do ustawienia kolejnosci.");
  }
  const existing = await env.DB.prepare("SELECT id FROM gallery_albums ORDER BY created_at ASC, id ASC").all();
  const existingIds = (existing.results || []).map((row) => Number(row.id));
  assertMatchingOrderSet(existingIds, ids, "Lista albumow jest nieprawidlowa.");

  for (let index = 0; index < ids.length; index += 1) {
    await env.DB.prepare("UPDATE gallery_albums SET created_at = ?, updated_at = ? WHERE id = ?")
      .bind(sortIsoStamp(index, ids.length), nowIso(), ids[index])
      .run();
  }
}

async function reorderGalleryAlbumImages(albumId, imageIds, env) {
  const currentAlbumId = Number(albumId);
  if (!Number.isInteger(currentAlbumId) || currentAlbumId <= 0) {
    throw badRequest("Album nie istnieje.");
  }
  const ids = Array.isArray(imageIds)
    ? imageIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
    : [];
  if (!ids.length) {
    throw badRequest("Brak listy zdjec do ustawienia kolejnosci.");
  }
  const existing = await env.DB.prepare(
    "SELECT id FROM gallery_images WHERE album_id = ? ORDER BY created_at ASC, id ASC"
  )
    .bind(currentAlbumId)
    .all();
  const existingIds = (existing.results || []).map((row) => Number(row.id));
  assertMatchingOrderSet(existingIds, ids, "Lista zdjec jest nieprawidlowa.");

  for (let index = 0; index < ids.length; index += 1) {
    await env.DB.prepare("UPDATE gallery_images SET created_at = ? WHERE id = ?")
      .bind(sortIsoStamp(index, ids.length), ids[index])
      .run();
  }
  await env.DB.prepare("UPDATE gallery_albums SET updated_at = ? WHERE id = ?")
    .bind(nowIso(), currentAlbumId)
    .run();
}

async function uploadHotelRoomImages(roomType, request, env) {
  const normalizedRoomType = normalizeHotelRoomType(roomType);
  const formData = await request.formData();
  const files = formData.getAll("images").filter((entry) => entry instanceof File);
  if (!files.length) {
    throw badRequest("Wybierz co najmniej jedno zdjecie.");
  }

  let orderRow;
  try {
    orderRow = await env.DB.prepare(
      "SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM hotel_room_images WHERE room_type = ?"
    )
      .bind(normalizedRoomType)
      .first();
  } catch (error) {
    if (isMissingHotelRoomImagesTableError(error)) {
      throw badRequest("Brak migracji bazy: utworz tabele hotel_room_images w D1.");
    }
    throw error;
  }
  let nextOrder = Number(orderRow?.maxOrder ?? -1) + 1;

  for (const file of files) {
    assertFileWithinLimit(file, "Zdjecie");
    const blobData = new Uint8Array(await file.arrayBuffer());
    await env.DB.prepare(
      "INSERT INTO hotel_room_images (room_type, file_name, alt_text, mime_type, blob_data, byte_size, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(
        normalizedRoomType,
        file.name || "zdjecie",
        normalizedRoomType,
        normalizeImageMimeType(file.type, file.name),
        blobData,
        blobData.byteLength,
        nextOrder,
        nowIso()
      )
      .run();
    nextOrder += 1;
  }
}

async function deleteHotelRoomImage(imageId, env) {
  let image;
  try {
    image = await env.DB.prepare(
      "SELECT id, room_type AS roomType FROM hotel_room_images WHERE id = ?"
    )
      .bind(imageId)
      .first();
  } catch (error) {
    if (isMissingHotelRoomImagesTableError(error)) {
      throw badRequest("Brak migracji bazy: utworz tabele hotel_room_images w D1.");
    }
    throw error;
  }
  if (!image) {
    throw badRequest("Zdjecie nie istnieje.");
  }
  await env.DB.prepare("DELETE FROM hotel_room_images WHERE id = ?").bind(imageId).run();
  await compactHotelRoomImageOrder(image.roomType, env);
}

async function reorderHotelRoomImages(roomType, imageIds, env) {
  const normalizedRoomType = normalizeHotelRoomType(roomType);
  const ids = Array.isArray(imageIds)
    ? imageIds
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    : [];
  if (!ids.length) {
    throw badRequest("Brak listy zdjec do ustawienia kolejnosci.");
  }
  let existing;
  try {
    existing = await env.DB.prepare(
      "SELECT id FROM hotel_room_images WHERE room_type = ? ORDER BY sort_order ASC, id ASC"
    )
      .bind(normalizedRoomType)
      .all();
  } catch (error) {
    if (isMissingHotelRoomImagesTableError(error)) {
      throw badRequest("Brak migracji bazy: utworz tabele hotel_room_images w D1.");
    }
    throw error;
  }
  const existingIds = (existing.results || []).map((row) => Number(row.id));
  if (existingIds.length !== ids.length) {
    throw badRequest("Lista zdjec ma nieprawidlowa dlugosc.");
  }
  const expected = [...existingIds].sort((a, b) => a - b).join(",");
  const received = [...ids].sort((a, b) => a - b).join(",");
  if (expected !== received) {
    throw badRequest("Lista zdjec jest nieprawidlowa.");
  }
  for (let index = 0; index < ids.length; index += 1) {
    await env.DB.prepare("UPDATE hotel_room_images SET sort_order = ? WHERE id = ?")
      .bind(index, ids[index])
      .run();
  }
}

async function compactHotelRoomImageOrder(roomType, env) {
  const normalizedRoomType = normalizeHotelRoomType(roomType);
  let result;
  try {
    result = await env.DB.prepare(
      "SELECT id FROM hotel_room_images WHERE room_type = ? ORDER BY sort_order ASC, id ASC"
    )
      .bind(normalizedRoomType)
      .all();
  } catch (error) {
    if (isMissingHotelRoomImagesTableError(error)) {
      return;
    }
    throw error;
  }
  const ids = (result.results || []).map((row) => Number(row.id));
  for (let index = 0; index < ids.length; index += 1) {
    await env.DB.prepare("UPDATE hotel_room_images SET sort_order = ? WHERE id = ?")
      .bind(index, ids[index])
      .run();
  }
}

async function uploadDocument(request, env) {
  const formData = await request.formData();
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const file = formData.get("file");
  if (!title || !(file instanceof File)) {
    throw badRequest("Tytul i plik dokumentu sa wymagane.");
  }
  const allowed = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];
  if (!allowed.includes(file.type)) {
    throw badRequest("Dozwolone sa tylko pliki PDF, DOC i DOCX.");
  }
  assertFileWithinLimit(file, "Dokument");
  const safeName = sanitizeFileName(file.name);
  const objectKey = `documents/${crypto.randomUUID()}-${safeName}`;
  const blobData = new Uint8Array(await file.arrayBuffer());
  await env.DB.prepare(
    "INSERT INTO documents (title, description, object_key, file_name, mime_type, blob_data, byte_size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(title, description, objectKey, file.name, file.type, blobData, blobData.byteLength, nowIso())
    .run();
}

async function deleteDocument(documentId, env) {
  const documentEntry = await env.DB.prepare("SELECT id FROM documents WHERE id = ?")
    .bind(documentId)
    .first();
  if (!documentEntry) {
    throw badRequest("Dokument nie istnieje.");
  }
  await env.DB.prepare("DELETE FROM documents WHERE id = ?").bind(documentId).run();
}

async function createCalendarBlock(payload, env) {
  if (!payload.hallKey || !payload.label || !payload.startAt || !payload.endAt) {
    throw badRequest("Sala, etykieta i zakres czasu sa wymagane.");
  }
  const startAt = new Date(payload.startAt);
  const endAt = new Date(payload.endAt);
  if (Number.isNaN(startAt.valueOf()) || Number.isNaN(endAt.valueOf()) || startAt >= endAt) {
    throw badRequest("Zakres dat jest nieprawidlowy.");
  }
  const guestsCountRaw = payload.guestsCount;
  const guestsCount =
    guestsCountRaw === undefined || guestsCountRaw === null || String(guestsCountRaw).trim() === ""
      ? null
      : Number(guestsCountRaw);
  if (guestsCount !== null && (!Number.isInteger(guestsCount) || guestsCount < 1)) {
    throw badRequest("Liczba osob musi byc dodatnia liczba calkowita.");
  }
  const exclusive = payload.exclusive === true || payload.exclusive === "true" || payload.exclusive === "1";
  try {
    await env.DB.prepare(
      "INSERT INTO calendar_blocks (hall_key, start_at, end_at, label, notes, guests_count, exclusive, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(
        payload.hallKey,
        startAt.toISOString(),
        endAt.toISOString(),
        payload.label.trim(),
        (payload.notes || "").trim(),
        guestsCount,
        exclusive ? 1 : 0,
        nowIso(),
        nowIso()
      )
      .run();
  } catch (error) {
    const message = String(error?.message || "");
    if (/no such column:\s*(guests_count|exclusive)/i.test(message)) {
      throw badRequest("Brak migracji bazy kalendarza. Zaktualizuj schemat D1 (calendar_blocks).");
    }
    throw error;
  }
}

async function streamGalleryImage(imageId, env, request) {
  const image = await env.DB.prepare(
    "SELECT blob_data AS blobData, mime_type AS mimeType, file_name AS fileName FROM gallery_images WHERE id = ?"
  )
    .bind(Number(imageId))
    .first();
  if (!image) {
    return jsonResponse({ error: "Zdjecie nie istnieje." }, 404, request, env);
  }
  const object = normalizeBlobData(image.blobData);
  if (!object) {
    return jsonResponse({ error: "Plik nie istnieje." }, 404, request, env);
  }
  return binaryResponse(object, normalizeImageMimeType(image.mimeType, image.fileName), request, env);
}

async function streamDocument(documentId, download, env, request) {
  const documentEntry = await env.DB.prepare(
    "SELECT blob_data AS blobData, mime_type AS mimeType, file_name AS fileName FROM documents WHERE id = ?"
  )
    .bind(Number(documentId))
    .first();
  if (!documentEntry) {
    return jsonResponse({ error: "Dokument nie istnieje." }, 404, request, env);
  }
  const object = normalizeBlobData(documentEntry.blobData);
  if (!object) {
    return jsonResponse({ error: "Plik nie istnieje." }, 404, request, env);
  }
  return binaryResponse(object, documentEntry.mimeType, request, env, {
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${sanitizeHeaderValue(
      documentEntry.fileName
    )}"`,
  });
}

async function streamHotelRoomImage(imageId, env, request) {
  let image;
  try {
    image = await env.DB.prepare(
      "SELECT blob_data AS blobData, mime_type AS mimeType, file_name AS fileName FROM hotel_room_images WHERE id = ?"
    )
      .bind(Number(imageId))
      .first();
  } catch (error) {
    if (isMissingHotelRoomImagesTableError(error)) {
      return jsonResponse({ error: "Zdjecia pokoi nie sa jeszcze skonfigurowane." }, 404, request, env);
    }
    throw error;
  }
  if (!image) {
    return jsonResponse({ error: "Zdjecie nie istnieje." }, 404, request, env);
  }
  const object = normalizeBlobData(image.blobData);
  if (!object) {
    return jsonResponse({ error: "Plik nie istnieje." }, 404, request, env);
  }
  return binaryResponse(object, normalizeImageMimeType(image.mimeType, image.fileName), request, env);
}

function normalizeBookingPausePair(from, to) {
  let f = String(from ?? "").trim().slice(0, 10);
  let t = String(to ?? "").trim().slice(0, 10);
  if (
    f &&
    t &&
    /^\d{4}-\d{2}-\d{2}$/.test(f) &&
    /^\d{4}-\d{2}-\d{2}$/.test(t) &&
    f > t
  ) {
    const x = f;
    f = t;
    t = x;
  }
  return [f, t];
}

function normalizeBookingPauseRanges(ranges, fallbackFrom, fallbackTo) {
  const source = Array.isArray(ranges) ? ranges : [];
  const normalized = source
    .map((entry) => {
      const [from, to] = normalizeBookingPausePair(entry?.from, entry?.to);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return null;
      }
      return { from, to };
    })
    .filter(Boolean)
    .sort((a, b) => (a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from)));
  if (normalized.length > 0) {
    return normalized;
  }
  const [from, to] = normalizeBookingPausePair(fallbackFrom, fallbackTo);
  if (/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return [{ from, to }];
  }
  return [];
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function normalizeHomeSectionMedia(sectionMedia, fallbackMedia = DEFAULT_CONTENT.home?.sectionMedia || {}) {
  const source = sectionMedia && typeof sectionMedia === "object" ? sectionMedia : {};
  const result = {};
  const keys = ["hotel", "restaurant", "events"];

  for (const key of keys) {
    const fallback = fallbackMedia?.[key] || {};
    const raw = source?.[key] || {};
    const imageUrl = String(raw.imageUrl || fallback.imageUrl || "").trim();
    const imageAlt = String(raw.imageAlt || fallback.imageAlt || "").trim();
    result[key] = {
      imageUrl,
      imageAlt,
      focusX: clampNumber(raw.focusX, 0, 100, clampNumber(fallback.focusX, 0, 100, 50)),
      focusY: clampNumber(raw.focusY, 0, 100, clampNumber(fallback.focusY, 0, 100, 50)),
      zoom: clampNumber(raw.zoom, 1, 2.5, clampNumber(fallback.zoom, 1, 2.5, 1)),
    };
  }

  return result;
}

function sanitizeContent(content) {
  const rawBooking = content.booking || {};
  const restaurantPauseRanges = normalizeBookingPauseRanges(
    rawBooking.restaurantPauseRanges,
    rawBooking.restaurantPauseFrom,
    rawBooking.restaurantPauseTo
  );
  const hotelPauseRanges = normalizeBookingPauseRanges(
    rawBooking.hotelPauseRanges,
    rawBooking.hotelPauseFrom,
    rawBooking.hotelPauseTo
  );
  const eventsPauseRanges = normalizeBookingPauseRanges(
    rawBooking.eventsPauseRanges,
    rawBooking.eventsPauseFrom,
    rawBooking.eventsPauseTo
  );
  const firstRestaurantPause = restaurantPauseRanges[0] || { from: "", to: "" };
  const firstHotelPause = hotelPauseRanges[0] || { from: "", to: "" };
  const firstEventsPause = eventsPauseRanges[0] || { from: "", to: "" };

  return {
    ...DEFAULT_CONTENT,
    ...content,
    company: { ...DEFAULT_CONTENT.company, ...(content.company || {}) },
    home: {
      ...DEFAULT_CONTENT.home,
      ...(content.home || {}),
      sectionBlocks: {
        ...DEFAULT_CONTENT.home.sectionBlocks,
        ...(content.home?.sectionBlocks || {}),
      },
      sectionMedia: normalizeHomeSectionMedia(content.home?.sectionMedia, DEFAULT_CONTENT.home?.sectionMedia),
    },
    restaurant: { ...DEFAULT_CONTENT.restaurant, ...(content.restaurant || {}) },
    hotel: {
      ...DEFAULT_CONTENT.hotel,
      ...(content.hotel || {}),
      // Galerie pokoi sa utrzymywane poza content_json (tabela hotel_room_images).
      roomGalleries: emptyHotelRoomGalleries(),
    },
    events: { ...DEFAULT_CONTENT.events, ...(content.events || {}) },
    services: Array.isArray(content.services) ? content.services : DEFAULT_CONTENT.services,
    gallery: { ...DEFAULT_CONTENT.gallery, ...(content.gallery || {}) },
    documentsPage: {
      ...DEFAULT_CONTENT.documentsPage,
      ...(content.documentsPage || {}),
      documents: Array.isArray(content.documentsPage?.documents)
        ? content.documentsPage.documents
        : DEFAULT_CONTENT.documentsPage.documents,
    },
    contact: { ...DEFAULT_CONTENT.contact, ...(content.contact || {}) },
    cookies: { ...DEFAULT_CONTENT.cookies, ...(content.cookies || {}) },
    booking: {
      ...DEFAULT_CONTENT.booking,
      ...rawBooking,
      restaurantPauseRanges,
      hotelPauseRanges,
      eventsPauseRanges,
      restaurantPauseFrom: firstRestaurantPause.from,
      restaurantPauseTo: firstRestaurantPause.to,
      hotelPauseFrom: firstHotelPause.from,
      hotelPauseTo: firstHotelPause.to,
      eventsPauseFrom: firstEventsPause.from,
      eventsPauseTo: firstEventsPause.to,
    },
  };
}

function assertFileWithinLimit(file, label) {
  if (file.size > MAX_MEDIA_FILE_BYTES) {
    throw badRequest(`${label} jest zbyt duzy. Maksymalny rozmiar po kompresji to ok. 1.7 MB.`);
  }
}

function normalizeImageMimeType(mimeType, fileName = "") {
  const normalized = String(mimeType || "").toLowerCase().trim();
  const allowed = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/bmp",
    "image/avif",
    "image/svg+xml",
  ]);
  if (allowed.has(normalized)) {
    return normalized;
  }

  const extension = String(fileName || "")
    .toLowerCase()
    .split("?")[0]
    .split("#")[0]
    .split(".")
    .pop();

  const byExtension = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
    avif: "image/avif",
    svg: "image/svg+xml",
  };
  return byExtension[extension] || "image/jpeg";
}

function normalizeBlobData(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (Array.isArray(value)) {
    return new Uint8Array(value);
  }
  return null;
}

function jsonResponse(data, status, request, env, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request, env),
      ...extraHeaders,
    },
  });
}

function binaryResponse(object, contentType, request, env, extraHeaders = {}) {
  const headers = new Headers(corsHeaders(request, env));
  headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "public, max-age=3600");
  Object.entries(extraHeaders).forEach(([key, value]) => headers.set(key, value));
  const body = object && typeof object === "object" && "body" in object ? object.body : object;
  return new Response(body, { headers });
}

function normalizeOriginValue(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.origin.toLowerCase();
  } catch {
    return "";
  }
}

function counterpartOrigin(origin) {
  const safe = normalizeOriginValue(origin);
  if (!safe) return "";
  try {
    const url = new URL(safe);
    const host = url.hostname.toLowerCase();
    if (host.startsWith("www.")) {
      url.hostname = host.slice(4);
      return url.origin.toLowerCase();
    }
    url.hostname = `www.${host}`;
    return url.origin.toLowerCase();
  } catch {
    return "";
  }
}

function allowedOrigins(env) {
  const configured = String(env.ALLOWED_ORIGIN || "*")
    .split(",")
    .map((item) => normalizeOriginValue(item))
    .filter(Boolean);
  const siteOrigin = normalizeOriginValue(env.PUBLIC_SITE_URL || "");
  const expanded = new Set(configured);
  if (siteOrigin) {
    expanded.add(siteOrigin);
    const siteCounterpart = counterpartOrigin(siteOrigin);
    if (siteCounterpart) expanded.add(siteCounterpart);
  }
  for (const origin of [...expanded]) {
    const pair = counterpartOrigin(origin);
    if (pair) expanded.add(pair);
  }
  return [...expanded];
}

function corsHeaders(request, env) {
  const origin = normalizeOriginValue(request.headers.get("Origin"));
  const allowAll = String(env.ALLOWED_ORIGIN || "*")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .includes("*");
  const allowedRaw = allowedOrigins(env);
  const canUseOrigin = allowAll
    ? "*"
    : origin && allowedRaw.includes(origin)
      ? origin
      : allowedRaw[0] || "*";
  return {
    "Access-Control-Allow-Origin": canUseOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
}

function assertBrowserLikePublicRequest(request, url) {
  const hasOrigin = Boolean(request.headers.get("Origin"));
  const hasReferer = Boolean(request.headers.get("Referer"));
  const secFetchSite = String(request.headers.get("Sec-Fetch-Site") || "").trim().toLowerCase();
  const secFetchMode = String(request.headers.get("Sec-Fetch-Mode") || "").trim().toLowerCase();
  const hasBrowserHints =
    hasOrigin ||
    hasReferer ||
    ["same-origin", "same-site", "cross-site", "none"].includes(secFetchSite) ||
    ["cors", "navigate", "same-origin", "no-cors"].includes(secFetchMode);
  if (hasBrowserHints) {
    return;
  }
  throw Object.assign(new Error(`Publiczny endpoint ${url.pathname} wymaga naglowkow przegladarki.`), {
    status: 403,
  });
}

function getLegacyBookingApiBase(service, env) {
  const projectId = String(env.FIREBASE_PROJECT_ID || "sredzka-korona").trim();
  const defaults = {
    hotel: `https://europe-west1-${projectId}.cloudfunctions.net/hotelApi`,
    restaurant: `https://europe-west1-${projectId}.cloudfunctions.net/restaurantApi`,
    hall: `https://europe-west1-${projectId}.cloudfunctions.net/hallApi`,
  };
  const byEnv = {
    hotel: env.HOTEL_API_BASE,
    restaurant: env.RESTAURANT_API_BASE,
    hall: env.HALL_API_BASE,
  };
  return String(byEnv[service] || defaults[service] || "").trim();
}

function isAllowedPublicLegacyBookingOp(op) {
  if (!op) {
    return false;
  }
  return op === "health" || op.startsWith("public-");
}

async function proxyLegacyBookingApi(service, request, url, env) {
  const base = getLegacyBookingApiBase(service, env);
  if (!base) {
    return jsonResponse({ error: "Brak konfiguracji adresu API rezerwacji." }, 500, request, env);
  }

  const targetUrl = new URL(base);
  for (const [key, value] of url.searchParams.entries()) {
    targetUrl.searchParams.set(key, value);
  }

  const headers = new Headers();
  const auth = request.headers.get("Authorization");
  const contentType = request.headers.get("Content-Type");
  if (auth) headers.set("Authorization", auth);
  if (contentType) headers.set("Content-Type", contentType);

  const bodyAllowed = !["GET", "HEAD"].includes(request.method);
  const rawBody = bodyAllowed ? await request.text() : "";
  const upstream = await fetch(targetUrl.toString(), {
    method: request.method,
    headers,
    body: bodyAllowed && rawBody ? rawBody : undefined,
  });

  const responseHeaders = new Headers(corsHeaders(request, env));
  const upstreamContentType = upstream.headers.get("Content-Type");
  if (upstreamContentType) {
    responseHeaders.set("Content-Type", upstreamContentType);
  } else {
    responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  }

  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: responseHeaders,
  });
}

function absoluteUrl(url, pathname) {
  return new URL(pathname, url.origin).toString();
}

function sanitizeSlug(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/(^-|-$)/g, "");
}

function sanitizeFileName(value) {
  return String(value || "plik")
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .replaceAll(/[^a-zA-Z0-9._-]+/g, "-")
    .replaceAll(/-+/g, "-")
    .toLowerCase();
}

function sanitizeHeaderValue(value) {
  return String(value || "plik").replaceAll(/["\r\n]/g, "");
}

function nowIso() {
  return new Date().toISOString();
}

function sortIsoStamp(index, total) {
  const base = Date.UTC(2020, 0, 1, 0, 0, 0);
  const safeIndex = Math.max(0, Number(index) || 0);
  const safeTotal = Math.max(1, Number(total) || 1);
  return new Date(base + (safeTotal * 1000 + safeIndex) * 1000).toISOString();
}

function assertMatchingOrderSet(existingIds, receivedIds, message) {
  if (existingIds.length !== receivedIds.length) {
    throw badRequest(message);
  }
  const expected = [...existingIds].sort((a, b) => a - b).join(",");
  const received = [...receivedIds].sort((a, b) => a - b).join(",");
  if (expected !== received) {
    throw badRequest(message);
  }
}

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function unauthorized(message) {
  return Object.assign(new Error(message), { status: 401 });
}
