import { DEFAULT_CONTENT } from "./default-content.js";
import { parseAdminEmailAllowlist, verifyFirebaseIdToken } from "./firebase-verify.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    try {
      if (url.pathname === "/api/public/bootstrap" && request.method === "GET") {
        return jsonResponse(await getPublicBootstrap(env, url), 200, request, env);
      }

      if (url.pathname === "/api/public/calendar" && request.method === "GET") {
        const from = url.searchParams.get("from");
        return jsonResponse(await getCalendarBlocks(env, from, url), 200, request, env);
      }

      if (url.pathname === "/api/public/contact" && request.method === "POST") {
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

      if (url.pathname === "/api/admin/session" && request.method === "GET") {
        await requireFirebaseAdmin(request, env);
        return jsonResponse({ ok: true }, 200, request, env);
      }

      if (url.pathname === "/api/admin/dashboard" && request.method === "GET") {
        await requireFirebaseAdmin(request, env);
        const content = await getContent(env);
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
        return jsonResponse(
          {
            content,
            documents,
            galleryAlbums,
            calendarBlocks,
            submissions: submissions.results || [],
            capabilities: {
              mediaStorageEnabled: hasMediaStorage(env),
            },
          },
          200,
          request,
          env
        );
      }

      if (url.pathname === "/api/admin/content" && request.method === "PUT") {
        await requireFirebaseAdmin(request, env);
        const payload = await request.json();
        const content = sanitizeContent(payload.content || DEFAULT_CONTENT);
        await saveContent(env, content);
        return jsonResponse({ content }, 200, request, env);
      }

      if (url.pathname === "/api/admin/gallery/albums" && request.method === "POST") {
        await requireFirebaseAdmin(request, env);
        const payload = await request.json();
        const now = nowIso();
        const slug = sanitizeSlug(payload.slug || payload.title);
        if (!slug || !payload.title) {
          return jsonResponse({ error: "Tytul i slug sa wymagane." }, 400, request, env);
        }
        await env.DB.prepare(
          "INSERT INTO gallery_albums (slug, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
        )
          .bind(slug, payload.title.trim(), (payload.description || "").trim(), now, now)
          .run();
        return jsonResponse({ ok: true }, 201, request, env);
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

      return jsonResponse({ error: "Nie znaleziono zasobu." }, 404, request, env);
    } catch (error) {
      const status = error.status || 500;
      return jsonResponse({ error: error.message || "Wystapil blad." }, status, request, env);
    }
  },
};

async function getPublicBootstrap(env, url) {
  const content = await getContent(env);
  return {
    content,
    documents: await listDocuments(env, url),
    galleryAlbums: await listGalleryAlbums(env, url),
    capabilities: {
      mediaStorageEnabled: hasMediaStorage(env),
    },
  };
}

async function getContent(env) {
  const record = await env.DB.prepare(
    "SELECT content_json FROM site_content WHERE id = 1"
  ).first();
  if (!record) {
    await saveContent(env, DEFAULT_CONTENT);
    return structuredClone(DEFAULT_CONTENT);
  }
  return sanitizeContent(JSON.parse(record.content_json));
}

async function saveContent(env, content) {
  await env.DB.prepare(
    "INSERT INTO site_content (id, content_json, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET content_json = excluded.content_json, updated_at = excluded.updated_at"
  )
    .bind(JSON.stringify(content), nowIso())
    .run();
}

async function listDocuments(env, url) {
  if (!hasMediaStorage(env)) {
    return [];
  }
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
  if (!hasMediaStorage(env)) {
    return [];
  }
  const albumResult = await env.DB.prepare(
    "SELECT id, slug, title, description, cover_image_id AS coverImageId FROM gallery_albums ORDER BY created_at DESC"
  ).all();
  const imageResult = await env.DB.prepare(
    "SELECT id, album_id AS albumId, alt_text AS altText FROM gallery_images ORDER BY created_at ASC"
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
    const cover = images.find((image) => image.id === album.coverImageId) || images[0] || null;
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

async function getCalendarBlocks(env, from, url) {
  const startDate = from ? new Date(`${from}T00:00:00`) : new Date();
  const endDate = new Date(startDate.getTime() + 1000 * 60 * 60 * 24 * 31);
  const result = await env.DB.prepare(
    "SELECT id, hall_key AS hallKey, start_at AS startAt, end_at AS endAt, label, notes FROM calendar_blocks WHERE start_at <= ? AND end_at >= ? ORDER BY start_at ASC"
  )
    .bind(endDate.toISOString(), startDate.toISOString())
    .all();
  return {
    blocks: (result.results || []).map((item) => ({
      ...item,
      startAt: item.startAt,
      endAt: item.endAt,
      detailsUrl: absoluteUrl(url, "/index.html#contact"),
    })),
  };
}

async function handleContactSubmission(payload, request, env) {
  if (!payload.fullName || !payload.email || !payload.message) {
    throw badRequest("Imie, e-mail i wiadomosc sa wymagane.");
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
    .bind(
      payload.fullName.trim(),
      payload.email.trim(),
      (payload.phone || "").trim(),
      (payload.eventType || "").trim(),
      (payload.preferredDate || "").trim(),
      payload.message.trim(),
      nowIso()
    )
    .run();
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
  requireMediaStorage(env);
  const album = await env.DB.prepare(
    "SELECT id, slug, cover_image_id AS coverImageId FROM gallery_albums WHERE id = ?"
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

  let firstInsertedId = null;
  for (const file of files) {
    const safeName = sanitizeFileName(file.name);
    const objectKey = `gallery/${album.slug}/${crypto.randomUUID()}-${safeName}`;
    await env.MEDIA_BUCKET.put(objectKey, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
    });
    const insert = await env.DB.prepare(
      "INSERT INTO gallery_images (album_id, object_key, file_name, alt_text, mime_type, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind(album.id, objectKey, file.name, album.slug, file.type || "application/octet-stream", nowIso())
      .run();
    if (!firstInsertedId) {
      firstInsertedId = insert.meta.last_row_id;
    }
  }
  if (!album.coverImageId && firstInsertedId) {
    await env.DB.prepare("UPDATE gallery_albums SET cover_image_id = ?, updated_at = ? WHERE id = ?")
      .bind(firstInsertedId, nowIso(), album.id)
      .run();
  }
}

async function setAlbumCover(imageId, env) {
  requireMediaStorage(env);
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
  requireMediaStorage(env);
  const image = await env.DB.prepare(
    "SELECT id, album_id AS albumId, object_key AS objectKey FROM gallery_images WHERE id = ?"
  )
    .bind(imageId)
    .first();
  if (!image) {
    throw badRequest("Zdjecie nie istnieje.");
  }
  await env.MEDIA_BUCKET.delete(image.objectKey);
  await env.DB.prepare("DELETE FROM gallery_images WHERE id = ?").bind(imageId).run();
  const nextImage = await env.DB.prepare(
    "SELECT id FROM gallery_images WHERE album_id = ? ORDER BY created_at ASC LIMIT 1"
  )
    .bind(image.albumId)
    .first();
  await env.DB.prepare("UPDATE gallery_albums SET cover_image_id = ?, updated_at = ? WHERE id = ?")
    .bind(nextImage ? nextImage.id : null, nowIso(), image.albumId)
    .run();
}

async function uploadDocument(request, env) {
  requireMediaStorage(env);
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
  const safeName = sanitizeFileName(file.name);
  const objectKey = `documents/${crypto.randomUUID()}-${safeName}`;
  await env.MEDIA_BUCKET.put(objectKey, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });
  await env.DB.prepare(
    "INSERT INTO documents (title, description, object_key, file_name, mime_type, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(title, description, objectKey, file.name, file.type, nowIso())
    .run();
}

async function deleteDocument(documentId, env) {
  requireMediaStorage(env);
  const documentEntry = await env.DB.prepare(
    "SELECT object_key AS objectKey FROM documents WHERE id = ?"
  )
    .bind(documentId)
    .first();
  if (!documentEntry) {
    throw badRequest("Dokument nie istnieje.");
  }
  await env.MEDIA_BUCKET.delete(documentEntry.objectKey);
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
  await env.DB.prepare(
    "INSERT INTO calendar_blocks (hall_key, start_at, end_at, label, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      payload.hallKey,
      startAt.toISOString(),
      endAt.toISOString(),
      payload.label.trim(),
      (payload.notes || "").trim(),
      nowIso(),
      nowIso()
    )
    .run();
}

async function streamGalleryImage(imageId, env, request) {
  if (!hasMediaStorage(env)) {
    return jsonResponse({ error: "Magazyn mediow nie jest wlaczony." }, 503, request, env);
  }
  const image = await env.DB.prepare(
    "SELECT object_key AS objectKey, mime_type AS mimeType FROM gallery_images WHERE id = ?"
  )
    .bind(Number(imageId))
    .first();
  if (!image) {
    return jsonResponse({ error: "Zdjecie nie istnieje." }, 404, request, env);
  }
  const object = await env.MEDIA_BUCKET.get(image.objectKey);
  if (!object) {
    return jsonResponse({ error: "Plik nie istnieje." }, 404, request, env);
  }
  return binaryResponse(object, image.mimeType || "application/octet-stream", request, env);
}

async function streamDocument(documentId, download, env, request) {
  if (!hasMediaStorage(env)) {
    return jsonResponse({ error: "Magazyn mediow nie jest wlaczony." }, 503, request, env);
  }
  const documentEntry = await env.DB.prepare(
    "SELECT object_key AS objectKey, mime_type AS mimeType, file_name AS fileName FROM documents WHERE id = ?"
  )
    .bind(Number(documentId))
    .first();
  if (!documentEntry) {
    return jsonResponse({ error: "Dokument nie istnieje." }, 404, request, env);
  }
  const object = await env.MEDIA_BUCKET.get(documentEntry.objectKey);
  if (!object) {
    return jsonResponse({ error: "Plik nie istnieje." }, 404, request, env);
  }
  return binaryResponse(object, documentEntry.mimeType, request, env, {
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${sanitizeHeaderValue(
      documentEntry.fileName
    )}"`,
  });
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

function sanitizeContent(content) {
  const rawBooking = content.booking || {};
  const [restaurantPauseFrom, restaurantPauseTo] = normalizeBookingPausePair(
    rawBooking.restaurantPauseFrom,
    rawBooking.restaurantPauseTo
  );
  const [hotelPauseFrom, hotelPauseTo] = normalizeBookingPausePair(
    rawBooking.hotelPauseFrom,
    rawBooking.hotelPauseTo
  );
  const [eventsPauseFrom, eventsPauseTo] = normalizeBookingPausePair(
    rawBooking.eventsPauseFrom,
    rawBooking.eventsPauseTo
  );

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
    },
    restaurant: { ...DEFAULT_CONTENT.restaurant, ...(content.restaurant || {}) },
    hotel: { ...DEFAULT_CONTENT.hotel, ...(content.hotel || {}) },
    events: { ...DEFAULT_CONTENT.events, ...(content.events || {}) },
    services: Array.isArray(content.services) ? content.services : DEFAULT_CONTENT.services,
    gallery: { ...DEFAULT_CONTENT.gallery, ...(content.gallery || {}) },
    documentsMenu: {
      ...DEFAULT_CONTENT.documentsMenu,
      ...(content.documentsMenu || {}),
      sections: Array.isArray(content.documentsMenu?.sections)
        ? content.documentsMenu.sections
        : DEFAULT_CONTENT.documentsMenu.sections,
    },
    contact: { ...DEFAULT_CONTENT.contact, ...(content.contact || {}) },
    cookies: { ...DEFAULT_CONTENT.cookies, ...(content.cookies || {}) },
    booking: {
      ...DEFAULT_CONTENT.booking,
      ...rawBooking,
      restaurantPauseFrom,
      restaurantPauseTo,
      hotelPauseFrom,
      hotelPauseTo,
      eventsPauseFrom,
      eventsPauseTo,
    },
  };
}

function hasMediaStorage(env) {
  return Boolean(env.MEDIA_BUCKET && typeof env.MEDIA_BUCKET.get === "function");
}

function requireMediaStorage(env) {
  if (!hasMediaStorage(env)) {
    throw badRequest("Uploady galerii i dokumentow sa wylaczone, bo magazyn mediow nie jest skonfigurowany.");
  }
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
  return new Response(object.body, { headers });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowedOrigin = env.ALLOWED_ORIGIN || origin || "*";
  const canUseOrigin = allowedOrigin === "*" ? "*" : origin && origin === allowedOrigin ? origin : allowedOrigin;
  return {
    "Access-Control-Allow-Origin": canUseOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
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

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function unauthorized(message) {
  return Object.assign(new Error(message), { status: 401 });
}
