/**
 * Wygaszanie rezerwacji restauracji: link e-mail 2h + pending 3 dni.
 */
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { initializeApp, getApps } = require("firebase-admin/app");

const { renderTemplate, getRestaurantMailTemplate, sendMail } = require("./lib/mail");
const { releaseLocksForReservation, loadTablesList } = require("./lib/restaurantLogic");

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();

function restaurantName() {
  return process.env.RESTAURANT_NAME || process.env.HOTEL_NAME || "Średzka Korona — Restauracja";
}

function adminNotifyEmail() {
  return process.env.ADMIN_NOTIFY_EMAIL || "";
}

async function appendRestaurantAudit(dbConn, { action, reservationId, details }) {
  await dbConn.collection("restaurantAuditLog").add({
    action,
    reservationId: reservationId || null,
    actorEmail: null,
    details: details || {},
    createdAt: FieldValue.serverTimestamp(),
  });
}

function formatTimeFromMs(ms) {
  const { DateTime } = require("luxon");
  return DateTime.fromMillis(ms, { zone: "Europe/Warsaw" }).toFormat("HH:mm");
}

function formatDateFromMs(ms) {
  const { DateTime } = require("luxon");
  return DateTime.fromMillis(ms, { zone: "Europe/Warsaw" }).toFormat("yyyy-MM-dd");
}

async function buildVars(res, tableMap) {
  const tid = res.assignedTableIds || [];
  const labels = tid.map((id) => {
    const t = tableMap[id];
    return t ? `Stół ${t.number} (${t.zone || "sala"})` : id;
  });
  const startMs = res.startDateTime?.toMillis?.() || res.startMs;
  const endMs = res.endDateTime?.toMillis?.() || res.endMs;
  return {
    reservationId: res.id,
    reservationNumber: res.humanNumber || res.id,
    fullName: res.fullName || "",
    email: res.email || "",
    phone: `${res.phonePrefix || ""} ${res.phoneNational || ""}`.trim(),
    date: res.reservationDate || (startMs ? formatDateFromMs(startMs) : ""),
    timeFrom: startMs ? formatTimeFromMs(startMs) : "",
    timeTo: endMs ? formatTimeFromMs(endMs) : "",
    durationHours: res.durationHours != null ? String(res.durationHours) : "",
    tablesCount: String(res.tablesCount ?? ""),
    tablesList: labels.join(", "),
    guestsCount: String(res.guestsCount ?? ""),
    joinTables: res.joinTables ? "tak" : "nie",
    customerNote: res.customerNote || "",
    adminNote: res.adminNote || "",
    restaurantName: restaurantName(),
  };
}

async function sendTemplated(dbConn, key, to, vars) {
  const t = await getRestaurantMailTemplate(dbConn, key);
  const subject = renderTemplate(t.subject, vars);
  const html = renderTemplate(t.bodyHtml, vars);
  await sendMail(key, { to, subject, html });
}

exports.restaurantExpireCron = onSchedule(
  {
    schedule: "every 15 minutes",
    region: "europe-west1",
    timeZone: "Europe/Warsaw",
  },
  async () => {
    const now = Timestamp.now();
    const tables = await loadTablesList(db);
    const tableMap = {};
    tables.forEach((t) => {
      tableMap[t.id] = t;
    });

    const expEmail = await db
      .collection("restaurantReservations")
      .where("status", "==", "email_verification_pending")
      .where("emailVerificationExpiresAt", "<", now)
      .limit(50)
      .get()
      .catch(() => ({ empty: true, docs: [] }));

    if (expEmail && !expEmail.empty) {
      for (const d of expEmail.docs) {
        const data = d.data();
        await db.collection("restaurantReservations").doc(d.id).update({
          status: "expired",
          updatedAt: FieldValue.serverTimestamp(),
        });
        const vars = await buildVars({ ...data, id: d.id }, tableMap);
        if (data.email) {
          await sendTemplated(db, "restaurant_expired_email_client", data.email, vars);
        }
        await appendRestaurantAudit(db, {
          action: "restaurant_expired_email_verification",
          reservationId: d.id,
          details: {},
        });
      }
    }

    const expPending = await db
      .collection("restaurantReservations")
      .where("status", "==", "pending")
      .where("pendingExpiresAt", "<", now)
      .limit(50)
      .get()
      .catch(() => ({ empty: true, docs: [] }));

    if (expPending && !expPending.empty) {
      for (const d of expPending.docs) {
        const data = d.data();
        await releaseLocksForReservation(db, d.id);
        await db.collection("restaurantReservations").doc(d.id).update({
          status: "expired",
          pendingExpiresAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        const vars = await buildVars({ ...data, id: d.id }, tableMap);
        if (data.email) {
          await sendTemplated(db, "restaurant_expired_pending_client", data.email, vars);
        }
        const adm = adminNotifyEmail();
        if (adm) {
          await sendTemplated(db, "restaurant_expired_pending_admin", adm, vars);
        }
        await appendRestaurantAudit(db, {
          action: "restaurant_expired_pending_timeout",
          reservationId: d.id,
          details: {},
        });
      }
    }

    return null;
  }
);
