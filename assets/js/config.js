window.SREDZKA_CONFIG = {
  /**
   * Publiczne API strony i panelu admina — wyłącznie adres Workera Cloudflare (bez końcowego slasha).
   * Nie ustawiaj tu URL Firebase Cloud Functions (cloudfunctions.net) ani /restaurantApi — wtedy dostaniesz HTML 404 od Google.
   */
  apiBase: "https://api.sredzka-korona.pl",
  /**
   * W wariancie bez Firebase Functions zostaw false.
   * Ustaw true dopiero po wdrozeniu backendu rezerwacji online.
   */
  enableOnlineBookings: true,
  turnstileSiteKey: "0x4AAAAAACyIQzt5qiD-IVXQ",
  /** Konfiguracja Firebase Authentication (panel admina) — z konsoli Firebase: Project settings */
  firebaseApiKey: "AIzaSyDvKjj2Lu_aGBFIOId5KU4rONguQMj2sxc",
  firebaseAuthDomain: "sredzka-korona.firebaseapp.com",
  firebaseProjectId: "sredzka-korona",
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
