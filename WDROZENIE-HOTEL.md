# Wdrożenie modułu rezerwacji hotelowych (Firebase)

## 1. Pliki dodane i zmienione

### Dodane

- `firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json` — konfiguracja Firebase
- `functions/` — Cloud Functions (`hotelApi`, `hotelExpireCron`), logika Firestore, maile, cron
- `functions/tools/seed-rooms.js` — seed 14 pokoi
- `assets/js/hotel-booking.js` — modal rezerwacji na stronie Hotel
- `assets/js/hotel-admin.js` — zakładka Hotel w panelu admina
- `Hotel/potwierdzenie.html` — strona po kliknięciu linku z maila
- `WDROZENIE-HOTEL.md` — ten dokument

### Zmienione

- `Hotel/index.html` — kafelek rezerwacji otwiera modal; style modułu; skrypty `config.js`, `hotel-booking.js`
- `assets/js/config.js` — `hotelApiBase`
- `assets/js/admin.js` — przełącznik zakładek Treści / Hotel
- `admin/index.html` — skrypt `hotel-admin.js`
- `assets/css/admin.css` — style modułu Hotel
- `dokumenty/index.html` — zwijany regulamin rezerwacji (`#regulamin-rezerwacji-hotel`)

---

## 2. Struktura danych Firestore

| Kolekcja | Opis |
|----------|------|
| `hotelRooms/{roomId}` | Pokój: `name`, `pricePerNight`, `maxGuests`, `bedsSingle`, `bedsDouble`, `bedsChild`, `description`, `imageUrls`, `active`, `sortOrder`, `updatedAt` |
| `hotelReservations/{id}` | Rezerwacja: `humanNumber`, `status`, dane klienta, `dateFrom`, `dateTo`, `totalPrice`, `confirmationTokenHash`, `emailVerificationExpiresAt`, `pendingExpiresAt`, `nightKeys`, `createdAt`, `source`, … |
| `hotelReservationItems/{autoId}` | Pozycja: `reservationId`, `roomId`, `roomNameSnapshot`, `pricePerNightSnapshot`, `nights`, `lineTotal` |
| `hotelRoomNights/{roomId__YYYY-MM-DD}` | Blokada nocy: `roomId`, `dateStr`, `reservationId`, `lockStatus` |
| `hotelMailTemplates/{templateKey}` | `subject`, `bodyHtml` |
| `hotelSettings/counters` | Liczniki numerów rezerwacji (`seq_RRRR`) |
| `hotelSettings/settings` | Opcjonalnie `hotelName` (seed) |
| `hotelRateLimits/{id}` | Rate limiting |
| `hotelAuditLog/{autoId}` | Zdarzenia administracyjne |

**Statusy (`status`):** `email_verification_pending`, `pending`, `confirmed`, `cancelled`, `expired`, `manual_block`.

---

## 3. Zmienne środowiskowe (Cloud Functions)

Ustaw w Firebase (np. `firebase functions:config:set` w v1 lub **Secrets / env** w konsoli dla v2) albo pliku `.env` zgodnie z dokumentacją Functions:

| Zmienna | Opis |
|---------|------|
| `FIREBASE_ADMIN_EMAILS` | Lista e-maili adminów (jak w Workerze), rozdzielone przecinkiem — wymagana do endpointów `admin-*` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Wysyłka e-maili (np. SMTP dostawcy poczty) |
| `SMTP_FROM` | Opcjonalny adres „From” |
| `ADMIN_NOTIFY_EMAIL` | Adres do powiadomień o nowych/oczekujących rezerwacjach |
| `PUBLIC_SITE_URL` | Bazowy URL strony (np. `https://twoja-domena.pl`) — linki w mailach i potwierdzeniu |
| `HOTEL_NAME` | Nazwa obiektu w szablonach (domyślnie „Średzka Korona”) |
| `CORS_ORIGINS` | Lista dozwolonych originów CORS, rozdzielona przecinkami (lub `*` na testy) |
| `TURNSTILE_SECRET` | Opcjonalnie — weryfikacja Cloudflare Turnstile (gdy na froncie jest `turnstileSiteKey`) |

Lokalnie: `GOOGLE_APPLICATION_CREDENTIALS` wskazujący na klucz konta usługi (seed, skrypty admin).

---

## 4. Seedowanie 14 pokoi

1. Zaloguj się do projektu: `firebase login` i `firebase use <PROJECT_ID>`.
2. Ustaw poświadczenia dla skryptu (np. zmienna `GOOGLE_APPLICATION_CREDENTIALS`).
3. W katalogu `functions/`:

```bash
npm install
npm run seed:rooms
```

Skrypt zapisuje dokumenty `room-01` … `room-14` oraz `hotelSettings/settings`.

---

## 5. Wygaszanie rezerwacji (3 dni / 2 godziny)

- **Funkcja zaplanowana** `hotelExpireCron` (co 15 minut, strefa `Europe/Warsaw`):
  - Znajduje rezerwacje w statusie `email_verification_pending` z `emailVerificationExpiresAt` w przeszłości → ustawia `expired`, usuwa pozycje `hotelReservationItems`, wysyła szablon `expired_email_client`.
  - Znajduje rezerwacje w statusie `pending` z `pendingExpiresAt` w przeszłości → zwalnia noce (`hotelRoomNights`), ustawia `expired`, wysyła maile do klienta i admina (`expired_pending_client`, `expired_pending_admin`).

Mechanizm **nie** opiera się wyłącznie na froncie — wykonuje się po stronie serwera.

---

## 6. Potwierdzanie linkiem e-mail

1. Po `public-reservation-draft` tworzony jest dokument ze statusem `email_verification_pending`, **bez** wpisów w `hotelRoomNights` (terminy nie są blokowane).
2. Klient otrzymuje mail (`confirm_email`) z linkiem: `{PUBLIC_SITE_URL}/Hotel/potwierdzenie.html?token=...` (ważność 2 h).
3. `public-reservation-confirm` w **transakcji** ponownie sprawdza dostępność i zakłada bloki w `hotelRoomNights`, ustawia status `pending` i `pendingExpiresAt` = teraz + 3 dni.
4. Wysyłane są maile `pending_client` i `pending_admin`.

---

## 7. Ochrona przed overbookingiem

- Dostępność jest reprezentowana dokumentami **`hotelRoomNights`** (klucz: `roomId__YYYY-MM-DD`).
- Rezerwacje blokujące terminy mają statusy zbliżone do „oczekujące / zarezerwowane / blokada ręczna” (`pending`, `confirmed`, `manual_block`).
- **Potwierdzenie e-mail** i **zamiana terminów przez admina** używają transakcji Firestore: najpierw odczyty konfliktów, potem atomowe zapisy (`claimNightsInTransactionAsync`, `swapNightsInTransaction`).
- Frontend może pokazać listę wolnych pokoi, ale **ostateczna decyzja** należy do serwera przy zapisie.

---

## Wdrożenie Functions

```bash
cd functions && npm install
cd .. && firebase deploy --only functions,firestore:rules,firestore:indexes
```

Adres HTTP funkcji (region `europe-west1`):

`https://europe-west1-<PROJECT_ID>.cloudfunctions.net/hotelApi`

Uzupełnij `assets/js/config.js`: `firebaseProjectId` i ewentualnie `hotelApiBase` (jeśli inny URL), oraz `turnstileSiteKey` jeśli używasz Turnstile na stronie Hotel (jak na kontakt).

---

## Domyślne decyzje implementacyjne (skrót)

- Routing API jednym endpointem `?op=...` (ograniczenie hostingu Functions bez rewrite).
- Klienci **nie** mają kont — tylko e-mail + link; admin przez **Firebase Auth** + lista `FIREBASE_ADMIN_EMAILS`.
- Regulamin jako statyczna sekcja w `dokumenty/index.html` z kotwicą pod linkiem w modalu.
- Zdjęcia pokoi: pole `imageUrls` w `hotelRooms`; panel edycji zdjęć można rozszerzyć o upload (np. Storage) — struktura pola jest przygotowana.
