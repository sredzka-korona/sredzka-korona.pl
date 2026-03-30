window.SREDZKA_CONFIG = {
  /**
   * Publiczne API strony i panelu admina.
   * Dla GitHub Pages ustaw tu adres Workera, np. https://api.twoja-domena.pl
   */
  apiBase: "",
  /**
   * W wariancie bez Firebase Functions zostaw false.
   * Ustaw true dopiero po wdrozeniu backendu rezerwacji online.
   */
  enableOnlineBookings: false,
  turnstileSiteKey: "",
  /** Konfiguracja Firebase Authentication (panel admina) — z konsoli Firebase: Project settings */
  firebaseApiKey: "",
  firebaseAuthDomain: "",
  firebaseProjectId: "",
  /**
   * Pełny URL funkcji hotelApi (Cloud Functions). Jeśli pusty, budowany jest z firebaseProjectId:
   * https://europe-west1-PROJECT_ID.cloudfunctions.net/hotelApi
   */
  hotelApiBase: "",
  /**
   * Pełny URL funkcji restaurantApi (Cloud Functions). Jeśli pusty, budowany jest z firebaseProjectId.
   */
  restaurantApiBase: "",
  /**
   * Pełny URL funkcji hallApi (Cloud Functions). Jeśli pusty, budowany jest z firebaseProjectId.
   */
  hallApiBase: "",
};
