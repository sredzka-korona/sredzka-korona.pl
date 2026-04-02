const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");

const { renderTemplate, getHallMailTemplate, sendMail, buildBrandedEmail } = require("./lib/mail");
const { formatHumanReservationNumber } = require("./lib/humanNumber");

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();

function venueName() {
  return process.env.VENUE_NAME || process.env.HOTEL_NAME || "Średzka Korona";
}

function adminNotifyEmail() {
  return process.env.ADMIN_NOTIFY_EMAIL || "";
}

function publicSiteUrl() {
  return (process.env.PUBLIC_SITE_URL || "https://example.com").replace(/\/$/, "");
}

function buildHallMailVars(data) {
  const start = data.startDateTime?.toDate?.() || new Date(data.startMs || 0);
  const end = data.endDateTime?.toDate?.() || new Date(data.endMs || 0);
  return {
    reservationId: data.id,
    reservationNumber: formatHumanReservationNumber(data, "hall") || String(data.id),
    fullName: data.fullName || "",
    email: data.email || "",
    phone: `${data.phonePrefix || ""} ${data.phoneNational || ""}`.trim(),
    hallName: data.hallNameSnapshot || "",
    date: data.reservationDate || "",
    timeFrom: data.startTimeLabel || start.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" }),
    timeTo: data.endTimeLabel || end.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" }),
    durationHours: data.durationUnspecified
      ? "nie określono"
      : `${Number(data.durationHours ?? 0)} h`,
    guestsCount: String(data.guestsCount ?? ""),
    eventType: data.eventType || "",
    exclusive: data.exclusive ? "tak" : "nie",
    fullBlockLabel: "",
    customerNote: data.customerNote || "",
    adminNote: data.adminNote || "",
    venueName: venueName(),
    expiresAt: "",
  };
}

async function sendHallTemplated(db, key, to, vars) {
  const t = await getHallMailTemplate(db, key);
  const subject = renderTemplate(t.subject, vars);
  const htmlFragment = renderTemplate(t.bodyHtml, vars);
  const email = buildBrandedEmail({
    subject,
    htmlFragment,
    brandName: venueName(),
    serviceLabel: "Przyjęcia i sale",
    siteUrl: publicSiteUrl(),
    serviceUrl: `${publicSiteUrl()}/Przyjec/`,
    preheader: `Zgłoszenie ${vars.reservationNumber || ""}`.trim(),
  });
  await sendMail(key, { to, subject, html: email.html });
}

async function appendVenueAudit(db, payload) {
  await db.collection("venueAuditLog").add({
    ...payload,
    createdAt: FieldValue.serverTimestamp(),
  });
}

exports.hallExpireCron = onSchedule(
  {
    schedule: "every 15 minutes",
    region: "europe-west1",
    timeZone: "Europe/Warsaw",
  },
  async () => {
    const now = Timestamp.now();

    const expEmail = await db
      .collection("venueReservations")
      .where("status", "==", "email_verification_pending")
      .where("emailVerificationExpiresAt", "<", now)
      .limit(50)
      .get()
      .catch(() => ({ empty: true, docs: [] }));

    if (expEmail && !expEmail.empty) {
      for (const d of expEmail.docs) {
        const data = d.data();
        await db.collection("venueReservations").doc(d.id).update({
          status: "expired",
          updatedAt: FieldValue.serverTimestamp(),
        });
        const vars = buildHallMailVars({ ...data, id: d.id });
        if (data.email) {
          await sendHallTemplated(db, "hall_expired_email_client", data.email, vars);
        }
        await appendVenueAudit(db, {
          action: "hall_expired_email_verification",
          reservationId: d.id,
          actorEmail: null,
          details: {},
        });
      }
    }

    const expPending = await db
      .collection("venueReservations")
      .where("status", "==", "pending")
      .where("pendingExpiresAt", "<", now)
      .limit(50)
      .get()
      .catch(() => ({ empty: true, docs: [] }));

    if (expPending && !expPending.empty) {
      for (const d of expPending.docs) {
        const data = d.data();
        await db.collection("venueReservations").doc(d.id).update({
          status: "expired",
          pendingExpiresAt: FieldValue.delete(),
          blockStartMs: FieldValue.delete(),
          blockEndMs: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        const vars = buildHallMailVars({ ...data, id: d.id });
        if (data.email) {
          await sendHallTemplated(db, "hall_expired_pending_client", data.email, vars);
        }
        const adm = adminNotifyEmail();
        if (adm) {
          await sendHallTemplated(db, "hall_expired_pending_admin", adm, vars);
        }
        await appendVenueAudit(db, {
          action: "hall_expired_pending_timeout",
          reservationId: d.id,
          actorEmail: null,
          details: {},
        });
      }
    }

    return null;
  }
);
