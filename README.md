# Sredzka Korona

Statyczny frontend pod GitHub Pages oraz panel/API pod Cloudflare Worker + D1. Logowanie administratora dziala przez Firebase Authentication bez potrzeby wdrazania Firebase Functions.

## Najwazniejsze katalogi

- [index.html](/Users/janicki/myApps/Sredzka-Korona/index.html) - glowna strona z osadzonym HTML, CSS i JS
- [admin/index.html](/Users/janicki/myApps/Sredzka-Korona/admin/index.html) - panel administratora
- [dokumenty/index.html](/Users/janicki/myApps/Sredzka-Korona/dokumenty/index.html) - osobna strona dokumentow
- [assets/js](/Users/janicki/myApps/Sredzka-Korona/assets/js) - frontend i panel
- [worker](/Users/janicki/myApps/Sredzka-Korona/worker) - API Cloudflare
- [WDROZENIE-CLOUDFLARE-GITHUB.md](/Users/janicki/myApps/Sredzka-Korona/WDROZENIE-CLOUDFLARE-GITHUB.md) - instrukcja wdrozenia
- [WDROZENIE-BEZ-KARTY.md](/Users/janicki/myApps/sredzka-korona.pl/WDROZENIE-BEZ-KARTY.md) - wariant GitHub Pages + Cloudflare Free + Firebase Auth

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

Domyslna konfiguracja w repo jest ustawiona pod wariant bez karty klienta:
- publiczna strona i kontakt dzialaja przez Cloudflare Worker,
- panel admina dziala przez Cloudflare Worker + Firebase Auth,
- galerie i dokumenty sa trzymane w D1,
- obrazy w panelu sa kompresowane przed zapisem,
- rezerwacje online hotel/restauracja/sale sa domyslnie wylaczone.

Szczegoly konfiguracji: [WDROZENIE-CLOUDFLARE-GITHUB.md](WDROZENIE-CLOUDFLARE-GITHUB.md).
