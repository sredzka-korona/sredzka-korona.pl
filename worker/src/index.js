import { DEFAULT_CONTENT } from "./default-content.js";
import { parseAdminEmailAllowlist, verifyFirebaseIdToken } from "./firebase-verify.js";

const MAX_MEDIA_FILE_BYTES = 1_700_000;

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
        return jsonResponse(
          {
            content,
            documents,
            galleryAlbums,
            calendarBlocks,
            submissions: submissions.results || [],
            capabilities: {
              mediaStorageEnabled: true,
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
        return jsonResponse({ content: await getContent(env, url) }, 200, request, env);
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

      return jsonResponse({ error: "Nie znaleziono zasobu." }, 404, request, env);
    } catch (error) {
      const status = error.status || 500;
      return jsonResponse({ error: error.message || "Wystapil blad." }, status, request, env);
    }
  },
};

async function getPublicBootstrap(env, url) {
  const content = await getContent(env, url);
  return {
    content,
    documents: await listDocuments(env, url),
    galleryAlbums: await listGalleryAlbums(env, url),
    capabilities: {
      mediaStorageEnabled: true,
    },
  };
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
  const content = sanitizeContent(JSON.parse(record.content_json));
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

async function listHotelRoomGalleries(env, url) {
  const result = await env.DB.prepare(
    "SELECT id, room_type AS roomType, alt_text AS altText FROM hotel_room_images ORDER BY room_type ASC, sort_order ASC, id ASC"
  ).all();
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
    assertFileWithinLimit(file, "Zdjecie");
    const safeName = sanitizeFileName(file.name);
    const objectKey = `gallery/${album.slug}/${crypto.randomUUID()}-${safeName}`;
    const blobData = new Uint8Array(await file.arrayBuffer());
    const insert = await env.DB.prepare(
      "INSERT INTO gallery_images (album_id, object_key, file_name, alt_text, mime_type, blob_data, byte_size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(
        album.id,
        objectKey,
        file.name,
        album.slug,
        file.type || "application/octet-stream",
        blobData,
        blobData.byteLength,
        nowIso()
      )
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
  const nextImage = await env.DB.prepare(
    "SELECT id FROM gallery_images WHERE album_id = ? ORDER BY created_at ASC LIMIT 1"
  )
    .bind(image.albumId)
    .first();
  await env.DB.prepare("UPDATE gallery_albums SET cover_image_id = ?, updated_at = ? WHERE id = ?")
    .bind(nextImage ? nextImage.id : null, nowIso(), image.albumId)
    .run();
}

async function uploadHotelRoomImages(roomType, request, env) {
  const normalizedRoomType = normalizeHotelRoomType(roomType);
  const formData = await request.formData();
  const files = formData.getAll("images").filter((entry) => entry instanceof File);
  if (!files.length) {
    throw badRequest("Wybierz co najmniej jedno zdjecie.");
  }

  const orderRow = await env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM hotel_room_images WHERE room_type = ?"
  )
    .bind(normalizedRoomType)
    .first();
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
        file.type || "application/octet-stream",
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
  const image = await env.DB.prepare(
    "SELECT id, room_type AS roomType FROM hotel_room_images WHERE id = ?"
  )
    .bind(imageId)
    .first();
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
  const existing = await env.DB.prepare(
    "SELECT id FROM hotel_room_images WHERE room_type = ? ORDER BY sort_order ASC, id ASC"
  )
    .bind(normalizedRoomType)
    .all();
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
  const result = await env.DB.prepare(
    "SELECT id FROM hotel_room_images WHERE room_type = ? ORDER BY sort_order ASC, id ASC"
  )
    .bind(normalizedRoomType)
    .all();
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
  const image = await env.DB.prepare(
    "SELECT blob_data AS blobData, mime_type AS mimeType FROM gallery_images WHERE id = ?"
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
  return binaryResponse(object, image.mimeType || "application/octet-stream", request, env);
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
  const image = await env.DB.prepare(
    "SELECT blob_data AS blobData, mime_type AS mimeType FROM hotel_room_images WHERE id = ?"
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
  return binaryResponse(object, image.mimeType || "application/octet-stream", request, env);
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

function sanitizeHotelRoomGalleryEntries(roomGalleries) {
  const source = roomGalleries && typeof roomGalleries === "object" ? roomGalleries : {};
  const normalized = emptyHotelRoomGalleries();
  Object.keys(normalized).forEach((roomType) => {
    const items = Array.isArray(source[roomType]) ? source[roomType] : [];
    normalized[roomType] = items
      .map((item) => {
        const entry = typeof item === "string" ? { url: item } : item;
        const id = Number(entry?.id);
        const url = String(entry?.url || "").trim();
        if (url.startsWith("data:")) {
          return null;
        }
        const sanitized = {};
        if (Number.isInteger(id) && id > 0) sanitized.id = id;
        if (url) sanitized.url = url;
        if (entry?.alt) sanitized.alt = String(entry.alt);
        return Object.keys(sanitized).length ? sanitized : null;
      })
      .filter(Boolean);
  });
  return normalized;
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
    },
    restaurant: { ...DEFAULT_CONTENT.restaurant, ...(content.restaurant || {}) },
    hotel: {
      ...DEFAULT_CONTENT.hotel,
      ...(content.hotel || {}),
      roomGalleries: sanitizeHotelRoomGalleryEntries(content.hotel?.roomGalleries),
    },
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
