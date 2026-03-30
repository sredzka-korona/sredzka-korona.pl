window.SREDZKA_CONFIG = {
  apiBase: "",
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

