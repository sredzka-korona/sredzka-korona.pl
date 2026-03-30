/**
 * Wspólne limity czasu dla modułów rezerwacji (hotel, restauracja, sale).
 */
const SESSION_MS = 30 * 60 * 1000;
const SPAM_BLOCK_MS = 15 * 60 * 1000;
const EMAIL_LINK_MS = 2 * 60 * 60 * 1000;
/** Oczekiwanie na decyzję admina — hotel */
const HOTEL_PENDING_MS = 3 * 24 * 60 * 60 * 1000;
/** Oczekiwanie na decyzję admina — restauracja */
const RESTAURANT_PENDING_MS = 3 * 24 * 60 * 60 * 1000;
/** Oczekiwanie na decyzję admina — sale */
const HALL_PENDING_MS = 7 * 24 * 60 * 60 * 1000;
/** Przycisk „Przedłuż o 7 dni” gdy pozostało ≤ tego czasu */
const HALL_EXTEND_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;

module.exports = {
  SESSION_MS,
  SPAM_BLOCK_MS,
  EMAIL_LINK_MS,
  HOTEL_PENDING_MS,
  RESTAURANT_PENDING_MS,
  HALL_PENDING_MS,
  HALL_EXTEND_THRESHOLD_MS,
};
