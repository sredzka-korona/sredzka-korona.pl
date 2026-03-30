/**
 * Daty hotelowe jako stringi YYYY-MM-DD (UTC), bez strefy — spójne porównania.
 */

function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return dt;
}

function formatYmd(d) {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

/** Noclegi: każda noc od dateFrom (włącznie) do dateTo (wyłącznie) — przyjazd / wyjazd hotelowy. */
function enumerateNights(dateFromStr, dateToStr) {
  const start = parseYmd(dateFromStr);
  const end = parseYmd(dateToStr);
  if (!start || !end || end <= start) {
    return [];
  }
  const nights = [];
  const cur = new Date(start.getTime());
  while (cur < end) {
    nights.push(formatYmd(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return nights;
}

function nightsCount(dateFromStr, dateToStr) {
  return enumerateNights(dateFromStr, dateToStr).length;
}

function todayYmd() {
  return formatYmd(new Date());
}

module.exports = {
  parseYmd,
  formatYmd,
  enumerateNights,
  nightsCount,
  todayYmd,
};
