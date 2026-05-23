# Roadmap — Średzka Korona (sredzka-korona.pl)

## Status projektu

| Sekcja | Status | Uwagi |
|--------|--------|-------|
| Strona główna (`/`) | ✅ Działa | Treści generowane dynamicznie przez JS + Firestore |
| Hotel (`/Hotel/`) | ✅ Działa | Pełna podstrona z rezerwacjami |
| Restauracja / Catering (`/Restauracja/`) | ✅ Działa | Pełna podstrona z zapytaniami |
| Przyjęcia (`/Przyjec/`) | ✅ Działa | Pełna podstrona z zapytaniami |
| Kontakt (`/kontakt/`) | ✅ Działa | Formularz kontaktowy |
| Dokumenty (`/dokumenty/`) | ✅ Działa | Polityka prywatności itp. |
| Panel admin (`/admin/`) | ✅ Działa | Zarządzanie treścią przez Firestore |
| Worker (rezerwacje Cloudflare D1) | ✅ Działa | Backend rezerwacji |
| **robots.txt** | ⚠️ **Błąd URL** | Używa `sredzka-korona.pl` zamiast `www.sredzkakorona.pl` |
| **sitemap.xml** | ⚠️ **Błąd URL** | Używa `sredzka-korona.pl` zamiast `www.sredzkakorona.pl` |

---

## Plan działania

### 1. 🔧 SEO — naprawa URL-i w robots.txt i sitemap.xml (PILNE)
- [x] robots.txt — zmiana `sredzka-korona.pl` → `www.sredzkakorona.pl`
- [x] sitemap.xml — zmiana `sredzka-korona.pl` → `www.sredzkakorona.pl`
- [x] `scripts/generate-seo.mjs` — dodać obsługę poprawnego originu z `www.`

### 2. 🔧 SEO — statyczne nagłówki H1/H2 na stronie głównej
- [ ] Dodać statyczne `