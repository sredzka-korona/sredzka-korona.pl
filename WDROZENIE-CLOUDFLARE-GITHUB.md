# Wdrozenie: OVH + GitHub + Cloudflare

## Architektura

- `OVH` zostaje rejestratorem domeny.
- `Cloudflare` przejmuje DNS dla domeny i wystawia API Workera na subdomenie `api.twoja-domena.pl`.
- `GitHub Pages` publikuje strone statyczna pod domena glowna `twoja-domena.pl` lub `www.twoja-domena.pl`.
- `Cloudflare D1` przechowuje tresci, zgoszenia i kalendarz.
- `Cloudflare R2` przechowuje zdjecia i dokumenty.

To oznacza, ze nie uruchamiasz zadnego lokalnego serwera. Zmiany frontendu wrzucasz do GitHuba, a panel admina zapisuje dane do Cloudflare.

## 1. Konto Cloudflare

1. Wejdz na [Cloudflare Dashboard](https://dash.cloudflare.com/sign-up) i zaloz darmowe konto.
2. Potwierdz adres e-mail.
3. W panelu kliknij `Add a domain`.
4. Wpisz swoja domena z OVH, np. `twoja-domena.pl`.
5. Wybierz plan `Free`.
6. Cloudflare pokaze rekordy DNS i dwa nameserwery.
7. Zaloguj sie do OVH, przejdz do zarzadzania domena i podmien nameserwery na te z Cloudflare.
8. Wroc do Cloudflare i poczekaj, az domena przejdzie w status `Active`.

Dokumentacja:
- [Set up a zone](https://developers.cloudflare.com/fundamentals/setup/manage-domains/add-site/)
- [Change nameservers at your registrar](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/)

## 2. GitHub Pages pod domena z OVH

1. Utworz repozytorium GitHub i wrzuc do niego ten projekt.
2. W GitHub przejdz do `Settings` -> `Pages`.
3. Jako source wybierz `Deploy from a branch`.
4. Wybierz branch `main` i folder `/root`.
5. W polu `Custom domain` wpisz swoja domene, np. `twoja-domena.pl`.
6. W Cloudflare DNS dodaj rekordy:
   - `A` dla `@` na `185.199.108.153`
   - `A` dla `@` na `185.199.109.153`
   - `A` dla `@` na `185.199.110.153`
   - `A` dla `@` na `185.199.111.153`
   - `CNAME` dla `www` na `twoj-login.github.io`
7. Wlacz `Enforce HTTPS` w GitHub Pages, gdy certyfikat bedzie gotowy.

Dokumentacja:
- [Configuring a custom domain for GitHub Pages](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site)
- [Managing a custom domain for your GitHub Pages site](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)

## 3. Cloudflare D1

1. W Cloudflare otworz `Storage & Databases` -> `D1 SQL Database`.
2. Kliknij `Create`.
3. Nazwij baze `sredzka-korona`.
4. Po utworzeniu skopiuj `Database ID`.
5. W pliku [worker/wrangler.jsonc](/Users/janicki/myApps/Sredzka-Korona/worker/wrangler.jsonc) wklej ten identyfikator w `database_id`.
6. W zakladce SQL uruchom zawartosc pliku [worker/schema.sql](/Users/janicki/myApps/Sredzka-Korona/worker/schema.sql).

Dokumentacja:
- [Create a D1 database](https://developers.cloudflare.com/d1/get-started/)

## 4. Cloudflare R2

1. W Cloudflare otworz `Storage & Databases` -> `R2`.
2. Kliknij `Create bucket`.
3. Nazwij bucket `sredzka-korona-media`.
4. Nic nie musisz wystawiac publicznie. Pliki beda serwowane przez Workera.

Dokumentacja:
- [Create a bucket in R2](https://developers.cloudflare.com/r2/get-started/)

## 5. Worker API

1. Wejdz do `Workers & Pages`.
2. Kliknij `Create`.
3. Wybierz `Import a repository` albo utworz projekt z `Hello World` i podmien pliki z katalogu [worker](/Users/janicki/myApps/Sredzka-Korona/worker).
4. Jesli importujesz repo:
   - wskaz ten repozytorium,
   - jako root directory ustaw `worker`,
   - framework preset ustaw na `None`.
5. W ustawieniach Workera dodaj bindingi:
   - `D1 database binding`: `DB`
   - `R2 bucket binding`: `MEDIA_BUCKET`
6. Dodaj zmienne srodowiskowe (Workera):
   - `ALLOWED_ORIGIN=https://twoja-domena.pl`
   - `FIREBASE_PROJECT_ID` — identyfikator projektu Firebase (ten sam co w `config.js`)
   - `FIREBASE_ADMIN_EMAILS` — lista adresow e-mail z uprawnieniami administratora, rozdzielona przecinkami, np. `jan@twoja-domena.pl,anna@twoja-domena.pl`
7. Dodaj opcjonalny sekret:
   - `TURNSTILE_SECRET` — do formularza kontaktowego

### Firebase Authentication (panel admina)

1. W [konsoli Firebase](https://console.firebase.google.com/) utworz projekt lub uzyj istniejacego.
2. `Build` → `Authentication` → `Sign-in method` → wlacz **Email/Password**.
3. `Authentication` → `Users` — dodaj uzytkownika (e-mail i haslo) lub pozwol na rejestracje z poziomu aplikacji (wtedy ogranicz dostep wylacznie lista `FIREBASE_ADMIN_EMAILS` po stronie API).
4. `Project settings` (ikona zebatki) → `Your apps` — jesli nie ma aplikacji web, dodaj **Web** i skopiuj `apiKey`, `authDomain`, `projectId` do pliku [assets/js/config.js](assets/js/config.js):
   - `firebaseApiKey`
   - `firebaseAuthDomain`
   - `firebaseProjectId`
5. W `Authentication` → `Settings` → `Authorized domains` dodaj domeny, na ktorych hostowany jest panel (np. `twoja-domena.pl`, `www.twoja-domena.pl`, `twoj-login.github.io` dla GitHub Pages, `localhost` do testow lokalnych).

Worker weryfikuje **Firebase ID token** (JWT) podpisany przez Google; lista `FIREBASE_ADMIN_EMAILS` decyduje, kto moze wywolywac endpointy `/api/admin/*`.

Dokumentacja:
- [Workers Git integration](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Bindings in Workers](https://developers.cloudflare.com/workers/runtime-apis/bindings/)
- [Environment variables and secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

## 6. Subdomena API

1. W ustawieniach Workera dodaj `Custom Domain`.
2. Ustaw subdomene `api.twoja-domena.pl`.
3. Cloudflare sam doda odpowiedni rekord DNS.

Po tym frontend bedzie komunikowal sie z API pod `https://api.twoja-domena.pl`.

Dokumentacja:
- [Custom domains for Workers](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

## 7. Turnstile do formularza kontaktowego

1. W Cloudflare wejdz do `Turnstile`.
2. Kliknij `Add site`.
3. Podaj domena strony.
4. Skopiuj `site key` i `secret key`.
5. `secret key` dodaj do sekretow Workera jako `TURNSTILE_SECRET`.
6. `site key` wpisz w pliku [assets/js/config.js](/Users/janicki/myApps/Sredzka-Korona/assets/js/config.js) jako `turnstileSiteKey`.

Dokumentacja:
- [Cloudflare Turnstile getting started](https://developers.cloudflare.com/turnstile/get-started/)

## 8. Konfiguracja frontendu

W pliku [assets/js/config.js](/Users/janicki/myApps/Sredzka-Korona/assets/js/config.js):

```js
window.SREDZKA_CONFIG = {
  apiBase: "https://api.twoja-domena.pl",
  turnstileSiteKey: "WKLEJ_TUTAJ_SITE_KEY",
  firebaseApiKey: "WKLEJ_Z_FIREBASE",
  firebaseAuthDomain: "twoj-projekt.firebaseapp.com",
  firebaseProjectId: "twoj-projekt",
};
```

Jesli nie wpiszesz `apiBase`, frontend probuje uzyc `https://api.twoja-domena.pl` automatycznie tylko wtedy, gdy strona dziala juz na wlasnej domenie.

## 9. Co wrzucasz gdzie

- Do `GitHub`:
  - wszystkie pliki frontendu,
  - panel admina,
  - kod Workera,
  - instrukcje.
- Do `Cloudflare`:
  - baza D1,
  - pliki w R2,
  - API Workera,
  - sekrety i formularz Turnstile.

## 10. Rzeczy, ktore warto zrobic od razu

- Uzyj silnego hasla dla konta Firebase z uprawnieniami administratora; rozwaz **2FA** w konsoli Google dla konta wlasciciela Firebase.
- Dodaj drugi adres e-mail do odzyskiwania konta Cloudflare.
- Wlacz 2FA na GitHub i Cloudflare.
- Ustal, czy `www` ma przekierowywac na `@`, czy odwrotnie.
- Przetestuj upload duzych paczek zdjec na jednym albumie, zanim wrzucisz cala biblioteke.

