# Wdrozenie bez karty klienta

Wariant: `GitHub Pages + Cloudflare Free + Firebase Authentication`.

Ten wariant nie uzywa Firebase Functions. Panel admina loguje sie przez Firebase Auth, a API publiczne i adminowe dziala na Cloudflare Worker.

Repo jest teraz przygotowane do startu bez `R2`. To oznacza:

- nie potrzebujesz karty, zeby uruchomic kontakt, panel, tresci i kalendarz,
- upload galerii i dokumentow z panelu bedzie wylaczony,
- jesli kiedys dodasz `R2`, uploady da sie wlaczyc bez duzej przebudowy.

## Co dziala bez karty

- strona publiczna na GitHub Pages,
- panel admina,
- edycja tresci,
- galerie i dokumenty jako sekcje panelu, ale bez uploadu plikow,
- kalendarz,
- formularz kontaktowy,
- logowanie admina przez Firebase.

## Co jest celowo wylaczone

- rezerwacja online hotelu,
- rezerwacja online restauracji,
- rezerwacja online sal,
- automatyczne maile i cron po Firebase Functions.

## Konfiguracja frontendu

W pliku `assets/js/config.js` ustaw:

```js
window.SREDZKA_CONFIG = {
  apiBase: "https://api.twoja-domena.pl",
  enableOnlineBookings: false,
  turnstileSiteKey: "WKLEJ_TUTAJ_SITE_KEY",
  firebaseApiKey: "AIzaSyDvKjj2Lu_aGBFIOId5KU4rONguQMj2sxc",
  firebaseAuthDomain: "sredzka-korona.firebaseapp.com",
  firebaseProjectId: "sredzka-korona",
  hotelApiBase: "",
  restaurantApiBase: "",
  hallApiBase: "",
};
```

## 1. Firebase - tylko logowanie admina

1. Wejdz na [Firebase Console](https://console.firebase.google.com/).
2. Kliknij `Create a project`.
3. Wpisz nazwe projektu, np. `sredzka-korona-admin`.
4. Przeklikaj tworzenie projektu. Google Analytics mozesz wylaczyc.
5. Po utworzeniu projektu wejdz w `Build` -> `Authentication`.
6. Kliknij `Get started`.
7. Wejdz w zakladke `Sign-in method`.
8. Wlacz `Email/Password`.
9. Wejdz w `Settings` -> `Authorized domains`.
10. Dodaj domeny:
    - `twoja-domena.pl`
    - `www.twoja-domena.pl`
    - `twoj-login.github.io`
    - `localhost`
11. Wejdz w `Authentication` -> `Users`.
12. Kliknij `Add user`.
13. Dodaj admina z mailem i haslem.
14. Wejdz w `Project settings` -> `General`.
15. W sekcji `Your apps` kliknij ikonke `</>` i dodaj aplikacje web.
16. Nadaj nazwe, np. `panel-admin`.
17. Skopiuj:
    - `apiKey`
    - `authDomain`
    - `projectId`
18. Wklej te wartosci do `assets/js/config.js`.

## 2. Cloudflare - API i baza

1. Wejdz do [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Dodaj domene do Cloudflare i wybierz plan `Free`.
3. W panelu domeny przejdz do `Storage & Databases` -> `D1 SQL Database`.
4. Kliknij `Create`.
5. Nazwij baze `sredzka-korona`.
6. Skopiuj `Database ID`.
7. Otworz `worker/wrangler.jsonc` i wklej `database_id`.
8. W D1 otworz zakladke SQL.
9. Uruchom SQL z pliku `worker/schema.sql`.
10. Wejdz do `Turnstile`.
11. Kliknij `Add site`.
12. Dodaj domene strony.
13. Skopiuj `site key` i `secret key`.
14. `site key` wklej do `assets/js/config.js` jako `turnstileSiteKey`.

## 3. Cloudflare - Worker

1. Wejdz w `Workers & Pages`.
2. Kliknij `Create`.
3. Wybierz `Import a repository` albo utworz pustego Workera i podmien pliki z katalogu `worker/`.
4. Ustaw `root directory` na `worker`, jesli importujesz repo.
5. W ustawieniach Workera dodaj binding:
    - `D1 database binding`: `DB`
6. Dodaj `Variables`:
    - `ALLOWED_ORIGIN=https://twoja-domena.pl`
    - `FIREBASE_PROJECT_ID=sredzka-korona`
    - `FIREBASE_ADMIN_EMAILS=twoj-admin@domena.pl`
7. Dodaj `Secrets`:
    - `TURNSTILE_SECRET`
8. W `Custom Domains` dodaj `api.twoja-domena.pl`.
9. Po zapisaniu sprawdz, czy Worker odpowiada pod `https://api.twoja-domena.pl/api/public/bootstrap`.

## 4. GitHub Pages - frontend

1. Wrzuc repo na GitHub.
2. Wejdz w repo -> `Settings` -> `Pages`.
3. Wybierz `Deploy from a branch`.
4. Ustaw branch `main` i folder `/root`.
5. Jesli uzywasz wlasnej domeny, wpisz ja w `Custom domain`.
6. W DNS ustaw rekordy zgodnie z GitHub Pages dla domeny glownej i `www`.
7. W `assets/js/config.js` ustaw `apiBase` na `https://api.twoja-domena.pl`.
8. Zostaw `enableOnlineBookings: false`.

## 5. Po wdrozeniu - pierwsze logowanie

1. Otworz `https://twoja-domena.pl/admin/`.
2. Zaloguj sie mailem i haslem admina z Firebase.
3. Sprawdz:
    - zapis tresci,
    - wysylke formularza kontaktowego,
    - edycje kalendarza.

## Kiedy bedzie potrzebne R2

R2 jest potrzebne dopiero wtedy, gdy chcesz z panelu:

- wgrywac dokumenty PDF/DOC/DOCX,
- wgrywac galerie zdjec,
- serwowac pliki binarne z bucketu.

Jesli Cloudflare pokazuje ekran billingowy dla `R2`, po prostu pomin ten krok na razie.

## Uwaga

Jesli kiedys bedziesz chcial wlaczyc rezerwacje online, trzeba bedzie:

- wdrozyc backend rezerwacji,
- wlaczyc `enableOnlineBookings: true`,
- dopiero wtedy uzupelnic endpointy rezerwacyjne.
