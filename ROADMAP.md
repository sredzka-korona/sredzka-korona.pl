# Roadmap — Średzka Korona (sredzka-korona.pl)

## Status projektu

| Sekcja | Status | Uwagi |
|--------|--------|-------|
| Strona główna (`/`) | ✅ Działa | Treści generowane dynamicznie przez JS + Firestore |
| Hotel (`/Hotel/`) | ✅ Działa | Pełna podstrona z rezerwacjami |
| Restauracja / Catering (`/catering/`) | ✅ Działa | Pełna podstrona z zapytaniami |
| Przyjęcia (`/przyjecia/`) | ✅ Działa | Pełna podstrona z zapytaniami |
| Kontakt (`/kontakt/`) | ✅ Działa | Formularz kontaktowy |
| Dokumenty (`/dokumenty/`) | ✅ Działa | Polityka prywatności itp. |
| Panel admin (`/admin/`) | ✅ Działa | Zarządzanie treścią przez Firestore |
| Worker (rezerwacje Cloudflare D1) | ✅ Działa | Backend rezerwacji |
| **robots.txt** | ✅ OK | Używa kanonicznego `https://sredzka-korona.pl` |
| **sitemap.xml** | ✅ OK | Używa kanonicznego `https://sredzka-korona.pl` |

---

## Plan działania

### 1. 🔧 SEO — naprawa URL-i w robots.txt i sitemap.xml (PILNE)
- [x] robots.txt — ustawiony na kanoniczny `https://sredzka-korona.pl`
- [x] sitemap.xml — ustawiony na kanoniczny `https://sredzka-korona.pl`
- [x] `scripts/generate-seo.mjs` — generuje SEO z `assets/seo/site-origin.json`

### 2. 🔧 SEO — statyczne nagłówki H1/H2 na stronie głównej
- [ ] Dodać statyczne `
