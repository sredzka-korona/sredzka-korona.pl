# Sredzka Korona

Statyczny frontend typu one-page pod GitHub Pages oraz backend i storage pod Cloudflare Workers + D1 + R2.

## Najwazniejsze katalogi

- [index.html](/Users/janicki/myApps/Sredzka-Korona/index.html) - glowna strona z osadzonym HTML, CSS i JS
- [admin/index.html](/Users/janicki/myApps/Sredzka-Korona/admin/index.html) - panel administratora
- [dokumenty/index.html](/Users/janicki/myApps/Sredzka-Korona/dokumenty/index.html) - osobna strona dokumentow
- [assets/js](/Users/janicki/myApps/Sredzka-Korona/assets/js) - frontend i panel
- [worker](/Users/janicki/myApps/Sredzka-Korona/worker) - API Cloudflare
- [WDROZENIE-CLOUDFLARE-GITHUB.md](/Users/janicki/myApps/Sredzka-Korona/WDROZENIE-CLOUDFLARE-GITHUB.md) - instrukcja wdrozenia

## Test lokalny

Do lokalnego podgladu nie otwieraj strony przez `file://`.

Uruchom:

```bash
npm run preview
```

Potem otworz:

```text
http://127.0.0.1:4173
```

W tym trybie publiczna strona dziala na lokalnych danych startowych. Formularz kontaktowy, kalendarz online i panel admina wymagaja podpietego API Cloudflare.

## Panel administratora (Firebase)

Logowanie do panelu odbywa sie przez **Firebase Authentication** (e-mail i haslo). Konto tworzysz w konsoli Firebase; Worker weryfikuje token i sprawdza, czy adres e-mail jest na liscie `FIREBASE_ADMIN_EMAILS` w Cloudflare.

Szczegoly konfiguracji: [WDROZENIE-CLOUDFLARE-GITHUB.md](WDROZENIE-CLOUDFLARE-GITHUB.md).
