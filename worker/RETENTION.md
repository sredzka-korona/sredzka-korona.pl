# Retencja danych

Worker uruchamia czyszczenie co godzinę, w 7. minucie. Cron rezerwacji co 15 minut pozostaje niezależny.

| Dane | Okres | Zasada |
| --- | --- | --- |
| `analytics_events` | 90 dni | Zastąpienie dziennymi licznikami, potem usunięcie pojedynczych zdarzeń |
| `analytics_daily` | Bezterminowo | Tylko dzień, typ akcji, podstrona i licznik potrzebne do `/stats` |
| `booking_mail_audit` | 90 dni | Usunięcie historii wysyłki, odbiorców i treści błędów |
| Stare `admin_sessions` | 90 dni od ostatniej aktywności | Usunięcie niewykorzystywanych sesji poprzedniego systemu logowania |
| D1 `contact_submissions` i RTDB `contactTickets` | 12 miesięcy od wysłania | Usunięcie obu kopii zgłoszenia |
| RTDB `cookie_consents` — odrębna historia dowodów decyzji cookies | 3 lata od każdej decyzji (`updated_at`) | Nowy identyfikator i niezmienny wpis dla każdej decyzji, także odmowy i wycofania zgody |
| D1 `client_consent_emails` | 12 miesięcy od `updated_at` | Usunięcie rejestru zgód formularzowych |
| Lokalne ustawienia cookies i anonimowy identyfikator | 12 miesięcy od ostatniej decyzji | Wygaszenie przy odczycie ustawień w przeglądarce; ponowny wybór zgody |

Okresy 12 miesięcy i 3 lat są liczone kalendarzowo; rocznica 29 lutego przypada na 28 lutego w roku nieprzestępnym. Usunięcie następuje przy najbliższym zaplanowanym czyszczeniu. Firebase usuwa po maksymalnie 10 rekordów z każdej kategorii w jednym przebiegu; większa zaległość jest opróżniana w kolejnych przebiegach.

Archiwizacja statystyk oraz usunięcie oryginalnych zdarzeń odbywają się w jednej transakcji D1. Ponowienie zadania nie podwaja statystyk. Dane historyczne łączą się z aktualnymi w zakresach `/stats` (7 dni, miesiąc, rok, zawsze); lista pojedynczych zdarzeń zawiera tylko nieusunięte wpisy.

Ustawienia używane przez przeglądarkę wygasają po 12 miesiącach. Historia w RTDB służy wyłącznie jako dowód decyzji przez 3 lata, a nie do ponownego uruchamiania analityki lub marketingu. Obejmuje identyfikator decyzji i pseudonimowy identyfikator użytkownika, datę, wersję polityki, kategorie i rodzaj decyzji; nie zawiera danych kontaktowych, IP ani treści formularza. Publiczne reguły pozwalają wyłącznie dodać nowy wpis, bez nadpisywania historii. Wpisy są chronione ponownym odczytem daty oraz warunkowym usunięciem z ETag. Błąd czyszczenia Firebase jest zgłaszany jako nieudany cron; nie zatrzymuje czyszczenia D1. Publiczne reguły Firebase nadal nie pozwalają na odczyt ani usuwanie.

Istniejące wpisy RTDB, zapisujące wcześniej tylko ostatnią decyzję, również zachowują 3-letnią retencję od `updated_at`. Nie można odzyskać decyzji wcześniej nadpisanych ani usuniętych. D1 `client_consent_emails` zawiera dane kontaktowe formularzy i nadal jest usuwane po 12 miesiącach; osobna 3-letnia historia dotyczy decyzji cookies.

Google Analytics otrzymuje `cookie_expires` jako czas pozostały do rocznicy ostatniej decyzji. Aktualizacja cookies przy wizycie utrzymuje tę samą końcową datę. Znane cookies Google dostępne dla strony są usuwane po wygaśnięciu decyzji. Cookies usług zewnętrznych niedostępne dla JavaScript strony podlegają ustawieniom tych usług; Google Ads Conversion Linker nie obsługuje `cookie_expires`.

## Wdrożenie

1. Wdróż statyczną stronę z aktualnym `cookie-consent-core.js` i dokumentami. Wersja polityki to `1.1`; stare decyzje `1.0` nie są stosowane jako aktualna zgoda i użytkownik wybiera ustawienia ponownie.
2. Opublikuj `database.rules.json`, aby dodać indeksy `updated_at` i `submittedAt` oraz ochronę historii przed nadpisaniem (`firebase deploy --only database`).
3. Skonfiguruj w sekretach Workera `FIREBASE_SERVICE_ACCOUNT_EMAIL` i `FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY` konta z uprawnieniami administracyjnymi do RTDB. Istniejące administracyjne `FIREBASE_DATABASE_AUTH` / `FIREBASE_DATABASE_BEARER_TOKEN` są również obsługiwane. Zapis publiczny formularza nie wystarcza do czyszczenia.
4. Wdróż Worker (`npm run worker:deploy`). Tabela dziennych liczników powstaje automatycznie; nie trzeba ręcznie uruchamiać destrukcyjnej migracji.
5. Po pierwszym przebiegu sprawdź wynik crona, usunięcie przeterminowanych rekordów w obu bazach i niezmienione historyczne liczniki `/stats`.

Zmiana kodu lokalnie nie włącza retencji na produkcji. Nie uruchamiaj czyszczenia z przeglądarki i nie otwieraj publicznych uprawnień usuwania w Firebase.

Nie jest potrzebna nowa płatna usługa. Czyszczenie korzysta z istniejących zasobów Cloudflare i Firebase oraz zużywa ich limity. Przy dużych zaległościach lub ruchu limity darmowych planów mogą wymagać dostosowania.

Jeżeli używane są starsze Firebase Cloud Functions do rezerwacji, istniejące crony otrzymały czyszczenie kolekcji `hotelAuditLog`, `restaurantAuditLog` i `venueAuditLog` po 90 dniach (do 100 rekordów na przebieg). Należy zaktualizować te crony wyłącznie wtedy, gdy są używane. Ich istniejący wymóg planu Blaze pozostaje; do obecnego Workera nie jest potrzebna nowa funkcja Firebase.

Retencja nie usuwa rezerwacji, dokumentów rozliczeniowych, treści CMS ani korespondencji w skrzynce pocztowej. Logi infrastruktury Cloudflare/Google oraz kopie zapasowe usług mają odrębne okresy retencji.

## Sprawdzenie lokalne

`node --test scripts/tests/retention.test.mjs` (Node 24 z `node:sqlite`). Testy wykonują rzeczywiste zapytania i transakcje SQLite, sprawdzają wycofanie operacji po błędzie, zachowanie statystyk, zakresy dat, czyszczenie baz, wyścig odnowienia zgody oraz wygasanie ustawień w przeglądarce.

Dokumentacja dostawców: [transakcje D1](https://developers.cloudflare.com/d1/worker-api/d1-database/), [warunkowe usuwanie Firebase](https://firebase.google.com/docs/database/rest/save-data), [ustawienia cookies Google](https://developers.google.com/tag-platform/security/guides/customize-cookies).
