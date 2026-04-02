CREATE TABLE IF NOT EXISTS booking_mail_templates_backup_20260402 AS
SELECT * FROM booking_mail_templates;

-- HOTEL
INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at)
VALUES (
  'hotel',
  'confirm_email',
  '{{hotelName}} - potwierdzenie adresu e-mail ({{reservationNumber}})',
  '<p>Dzien dobry {{fullName}},</p><p>Dziekujemy za wyslanie rezerwacji do {{hotelName}}.</p><p>Aby przekazac rezerwacje do obslugi, potwierdz adres e-mail:</p><p><a href="{{confirmationLink}}">Potwierdz rezerwacje</a></p><p>Numer rezerwacji: <strong>{{reservationNumber}}</strong><br>Termin pobytu: {{dateFrom}} - {{dateTo}}<br>Pokoje: {{roomsList}}</p>',
  (CAST(strftime('%s','now') AS INTEGER) * 1000)
)
ON CONFLICT(service, key) DO UPDATE SET
  subject = excluded.subject,
  body_html = excluded.body_html,
  updated_at = excluded.updated_at;

INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at)
VALUES (
  'hotel',
  'pending_admin',
  '[{{hotelName}}] Nowa rezerwacja do decyzji: {{reservationNumber}}',
  '<p>Nowa rezerwacja oczekuje na decyzje.</p><p>Numer: <strong>{{reservationNumber}}</strong><br>Klient: {{fullName}}<br>E-mail: {{email}}<br>Telefon: {{phone}}<br>Termin: {{dateFrom}} - {{dateTo}}<br>Pokoje: {{roomsList}}<br>Uwagi: {{customerNote}}</p>',
  (CAST(strftime('%s','now') AS INTEGER) * 1000)
)
ON CONFLICT(service, key) DO UPDATE SET
  subject = excluded.subject,
  body_html = excluded.body_html,
  updated_at = excluded.updated_at;

INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at)
VALUES (
  'hotel',
  'confirmed_client',
  '{{hotelName}} - rezerwacja potwierdzona ({{reservationNumber}})',
  '<p>Dzien dobry {{fullName}},</p><p>Rezerwacja zostala potwierdzona.</p><p>Numer rezerwacji: <strong>{{reservationNumber}}</strong><br>Termin pobytu: {{dateFrom}} - {{dateTo}}<br>Pokoje: {{roomsList}}</p>',
  (CAST(strftime('%s','now') AS INTEGER) * 1000)
)
ON CONFLICT(service, key) DO UPDATE SET
  subject = excluded.subject,
  body_html = excluded.body_html,
  updated_at = excluded.updated_at;

INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at)
VALUES (
  'hotel',
  'cancelled_client',
  '{{hotelName}} - rezerwacja anulowana ({{reservationNumber}})',
  '<p>Dzien dobry {{fullName}},</p><p>Rezerwacja zostala anulowana.</p><p>Numer rezerwacji: <strong>{{reservationNumber}}</strong><br>Termin pobytu: {{dateFrom}} - {{dateTo}}</p>',
  (CAST(strftime('%s','now') AS INTEGER) * 1000)
)
ON CONFLICT(service, key) DO UPDATE SET
  subject = excluded.subject,
  body_html = excluded.body_html,
  updated_at = excluded.updated_at;

INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at)
VALUES (
  'hotel',
  'changed_client',
  '{{hotelName}} - zaktualizowano rezerwacje ({{reservationNumber}})',
  '<p>Dzien dobry {{fullName}},</p><p>Wprowadzono zmiany w rezerwacji.</p><p>Numer rezerwacji: <strong>{{reservationNumber}}</strong><br>Termin pobytu: {{dateFrom}} - {{dateTo}}<br>Pokoje: {{roomsList}}<br>Uwagi: {{customerNote}}</p>',
  (CAST(strftime('%s','now') AS INTEGER) * 1000)
)
ON CONFLICT(service, key) DO UPDATE SET
  subject = excluded.subject,
  body_html = excluded.body_html,
  updated_at = excluded.updated_at;

INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at)
VALUES (
  'hotel',
  'expired_pending_client',
  '{{hotelName}} - rezerwacja wygasla ({{reservationNumber}})',
  '<p>Dzien dobry {{fullName}},</p><p>Rezerwacja wygasla, poniewaz nie zostala potwierdzona w wymaganym czasie.</p><p>Numer rezerwacji: <strong>{{reservationNumber}}</strong><br>Termin pobytu: {{dateFrom}} - {{dateTo}}</p>',
  (CAST(strftime('%s','now') AS INTEGER) * 1000)
)
ON CONFLICT(service, key) DO UPDATE SET
  subject = excluded.subject,
  body_html = excluded.body_html,
  updated_at = excluded.updated_at;

INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at)
VALUES (
  'hotel',
  'expired_pending_admin',
  '[{{hotelName}}] Wygasla rezerwacja oczekujaca {{reservationNumber}}',
  '<p>Rezerwacja oczekujaca wygasla automatycznie.</p><p>Numer rezerwacji: <strong>{{reservationNumber}}</strong><br>Klient: {{fullName}}<br>E-mail: {{email}}<br>Termin: {{dateFrom}} - {{dateTo}}</p>',
  (CAST(strftime('%s','now') AS INTEGER) * 1000)
)
ON CONFLICT(service, key) DO UPDATE SET
  subject = excluded.subject,
  body_html = excluded.body_html,
  updated_at = excluded.updated_at;

INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at)
VALUES (
  'hotel',
  'expired_email_client',
  '{{hotelName}} - link potwierdzajacy wygasl',
  '<p>Dzien dobry {{fullName}},</p><p>Link potwierdzajacy wygasl. Wyslij formularz ponownie, jesli nadal chcesz dokonac rezerwacji.</p><p>Numer rezerwacji: <strong>{{reservationNumber}}</strong></p>',
  (CAST(strftime('%s','now') AS INTEGER) * 1000)
)
ON CONFLICT(service, key) DO UPDATE SET
  subject = excluded.subject,
  body_html = excluded.body_html,
  updated_at = excluded.updated_at;

INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at)
VALUES (
  'hotel',
  'cancelled_admin',
  '[{{hotelName}}] Anulowano rezerwacje {{reservationNumber}}',
  '<p>Rezerwacja zostala anulowana.</p><p>Numer rezerwacji: <strong>{{reservationNumber}}</strong><br>Klient: {{fullName}}<br>E-mail: {{email}}</p>',
  (CAST(strftime('%s','now') AS INTEGER) * 1000)
)
ON CONFLICT(service, key) DO UPDATE SET
  subject = excluded.subject,
  body_html = excluded.body_html,
  updated_at = excluded.updated_at;

-- RESTAURANT (CANONICAL)
INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at)
VALUES (
  'restaurant',
  'restaurant_confirm_email',
  '{{restaurantName}} - potwierdzenie rezerwacji stolika ({{reservationNumber}})',
  '<p>Dzien dobry {{fullName}},</p><p>Dziekujemy za rezerwacje stolika w {{restaurantName}}.</p><p>Aby przekazac rezerwacje do obslugi, potwierdz adres e-mail:</p><p><a href="{{confirmationLink}}">Potwierdz rezerwacje</a></p><p>Numer rezerwacji: <strong>{{reservationNumber}}</strong><br>Termin: {{date}} / {{timeFrom}}-{{timeTo}}<br>Liczba gosci: {{guestsCount}}</p>',
  (CAST(strftime('%s','now') AS INTEGER) * 1000)
)
ON CONFLICT(service, key) DO UPDATE SET
  subject = excluded.subject,
  body_html = excluded.body_html,
  updated_at = excluded.updated_at;

INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at)
VALUES (
  'restaurant',
  'restaurant_pending_admin',
  '[{{restaurantName}}] Nowa rezerwacja stolika {{reservationNumber}}',
  '<p>Nowa rezerwacja stolika oczekuje na decyzje.</p><p>Numer rezerwacji: <strong>{{reservationNumber}}</strong><br>Klient: {{fullName}}<br>E-mail: {{email}}<br>Telefon: {{phone}}<br>Termin: {{date}} / {{timeFrom}}-{{timeTo}}<br>Liczba gosci: {{guestsCount}}<br>Stoliki: {{tablesList}}<br>Uwagi: {{customerNote}}</p>',
  (CAST(strftime('%s','now') AS INTEGER) * 1000)
)
ON CONFLICT(service, key) DO UPDATE SET
  subject = excluded.subject,
  body_html = excluded.body_html,
  updated_at = excluded.updated_at;

INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at)
VALUES (
  'restaurant',
  'restaurant_confirmed_client',
  '{{restaurantName}} - rezerwacja potwierdzona ({{reservationNumber}})',
  '<p>Dzien dobry {{fullName}},</p><p>Rezerwacja stolika zostala potwierdzona.</p><p>Numer rezerwacji: <strong>{{reservationNumber}}</strong><br>Termin: {{date}} / {{timeFrom}}-{{timeTo}}<br>Liczba gosci: {{guestsCount}}<br>Stoliki: {{tablesList}}</p>',
  (CAST(strftime('%s','now') AS INTEGER) * 1000)
)
ON CONFLICT(service, key) DO UPDATE SET
  subject = excluded.subject,
  body_html = excluded.body_html,
  updated_at = excluded.updated_at;

INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at)
VALUES (
  'restaurant',
  'restaurant_cancelled_client',
  '{{restaurantName}} - rezerwacja anulowana ({{reservationNumber}})',
  '<p>Dzien dobry {{fullName}},</p><p>Rezerwacja stolika zostala anulowana.</p><p>Numer rezerwacji: <strong>{{reservationNumber}}</strong><br>Termin: {{date}} / {{timeFrom}}-{{timeTo}}</p>',
  (CAST(strftime('%s','now') AS INTEGER) * 1000)
)
ON CONFLICT(service, key) DO UPDATE SET
  subject = excluded.subject,
  body_html = excluded.body_html,
  updated_at = excluded.updated_at;

INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at)
VALUES (
  'restaurant',
  'restaurant_changed_client',
  '{{restaurantName}} - zaktualizowano rezerwacje stolika ({{reservationNumber}})',
  '<p>Dzien dobry {{fullName}},</p><p>Wprowadzono zmiany w rezerwacji stolika.</p><p>Numer rezerwacji: <strong>{{reservationNumber}}</strong><br>Termin: {{date}} / {{timeFrom}}-{{timeTo}}<br>Liczba gosci: {{guestsCount}}<br>Stoliki: {{tablesList}}<br>Uwagi: {{customerNote}}</p>',
  (CAST(strftime('%s','now') AS INTEGER) * 1000)
)
ON CONFLICT(service, key) DO UPDATE SET
  subject = excluded.subject,
  body_html = excluded.body_html,
  updated_at = excluded.updated_at;

INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at)
VALUES (
  'restaurant',
  'restaurant_expired_pending_client',
  '{{restaurantName}} - rezerwacja wygasla ({{reservationNumber}})',
  '<p>Dzien dobry {{fullName}},</p><p>Rezerwacja wygasla, poniewaz nie zostala potwierdzona w wymaganym czasie.</p><p>Numer rezerwacji: <strong>{{reservationNumber}}</strong><br>Termin: {{date}} / {{timeFrom}}-{{timeTo}}</p>',
  (CAST(strftime('%s','now') AS INTEGER) * 1000)
)
ON CONFLICT(service, key) DO UPDATE SET
  subject = excluded.subject,
  body_html = excluded.body_html,
  updated_at = excluded.updated_at;

INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at)
VALUES (
  'restaurant',
  'restaurant_expired_pending_admin',
  '[{{restaurantName}}] Wygasla rezerwacja {{reservationNumber}}',
  '<p>Rezerwacja stolika wygasla automatycznie.</p><p>Numer rezerwacji: <strong>{{reservationNumber}}</strong><br>Klient: {{fullName}}<br>E-mail: {{email}}<br>Termin: {{date}} / {{timeFrom}}-{{timeTo}}</p>',
  (CAST(strftime('%s','now') AS INTEGER) * 1000)
)
ON CONFLICT(service, key) DO UPDATE SET
  subject = excluded.subject,
  body_html = excluded.body_html,
  updated_at = excluded.updated_at;

INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at)
VALUES (
  'restaurant',
  'restaurant_expired_email_client',
  '{{restaurantName}} - link potwierdzajacy wygasl',
  '<p>Dzien dobry {{fullName}},</p><p>Link potwierdzajacy wygasl. Wyslij formularz ponownie, jesli nadal chcesz dokonac rezerwacji.</p><p>Numer rezerwacji: <strong>{{reservationNumber}}</strong></p>',
  (CAST(strftime('%s','now') AS INTEGER) * 1000)
)
ON CONFLICT(service, key) DO UPDATE SET
  subject = excluded.subject,
  body_html = excluded.body_html,
  updated_at = excluded.updated_at;

-- RESTAURANT (ALIAS rest_*)
INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at)
SELECT 'restaurant', 'rest_confirm_email', subject, body_html, updated_at
FROM booking_mail_templates
WHERE service = 'restaurant' AND key = 'restaurant_confirm_email'
ON CONFLICT(service, key) DO UPDATE SET
  subject = excluded.subject,
  body_html = excluded.body_html,
  updated_at = excluded.updated_at;

INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at)
SELECT 'restaurant', 'rest_pending_admin', subject, body_html, updated_at
FROM booking_mail_templates
WHERE service = 'restaurant' AND key = 'restaurant_pending_admin'
ON CONFLICT(service, key) DO UPDATE SET
  subject = excluded.subject,
  body_html = excluded.body_html,
  updated_at = excluded.updated_at;

INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at)
SELECT 'restaurant', 'rest_confirmed_client', subject, body_html, updated_at
FROM booking_mail_templates
WHERE service = 'restaurant' AND key = 'restaurant_confirmed_client'
ON CONFLICT(service, key) DO UPDATE SET
  subject = excluded.subject,
  body_html = excluded.body_html,
  updated_at = excluded.updated_at;

INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at)
SELECT 'restaurant', 'rest_cancelled_client', subject, body_html, updated_at
FROM booking_mail_templates
WHERE service = 'restaurant' AND key = 'restaurant_cancelled_client'
ON CONFLICT(service, key) DO UPDATE SET
  subject = excluded.subject,
  body_html = excluded.body_html,
  updated_at = excluded.updated_at;

INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at)
SELECT 'restaurant', 'rest_changed_client', subject, body_html, updated_at
FROM booking_mail_templates
WHERE service = 'restaurant' AND key = 'restaurant_changed_client'
ON CONFLICT(service, key) DO UPDATE SET
  subject = excluded.subject,
  body_html = excluded.body_html,
  updated_at = excluded.updated_at;

-- HALL
INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at)
VALUES (
  'hall',
  'hall_confirm_email',
  '{{venueName}} - potwierdzenie zgloszenia rezerwacji sali ({{reservationNumber}})',
  '<p>Dzien dobry {{fullName}},</p><p>Dziekujemy za zgloszenie rezerwacji sali w {{venueName}}.</p><p>Aby przekazac zgloszenie do obslugi, potwierdz adres e-mail:</p><p><a href="{{confirmationLink}}">Potwierdz zgloszenie</a></p><p>Numer zgloszenia: <strong>{{reservationNumber}}</strong><br>Sala: {{hallName}}<br>Termin: {{date}} / {{timeFrom}}-{{timeTo}}<br>Liczba gosci: {{guestsCount}}<br>Rodzaj wydarzenia: {{eventType}}</p>',
  (CAST(strftime('%s','now') AS INTEGER) * 1000)
)
ON CONFLICT(service, key) DO UPDATE SET
  subject = excluded.subject,
  body_html = excluded.body_html,
  updated_at = excluded.updated_at;

INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at)
VALUES (
  'hall',
  'hall_pending_admin',
  '[{{venueName}}] Nowe zgloszenie sali {{reservationNumber}}',
  '<p>Nowe zgloszenie rezerwacji sali oczekuje na decyzje.</p><p>Numer zgloszenia: <strong>{{reservationNumber}}</strong><br>Klient: {{fullName}}<br>E-mail: {{email}}<br>Telefon: {{phone}}<br>Sala: {{hallName}}<br>Termin: {{date}} / {{timeFrom}}-{{timeTo}}<br>Liczba gosci: {{guestsCount}}<br>Rodzaj wydarzenia: {{eventType}}<br>Uwagi: {{customerNote}}</p>',
  (CAST(strftime('%s','now') AS INTEGER) * 1000)
)
ON CONFLICT(service, key) DO UPDATE SET
  subject = excluded.subject,
  body_html = excluded.body_html,
  updated_at = excluded.updated_at;

INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at)
VALUES (
  'hall',
  'hall_confirmed_client',
  '{{venueName}} - rezerwacja sali potwierdzona ({{reservationNumber}})',
  '<p>Dzien dobry {{fullName}},</p><p>Rezerwacja sali zostala potwierdzona.</p><p>Numer zgloszenia: <strong>{{reservationNumber}}</strong><br>Sala: {{hallName}}<br>Termin: {{date}} / {{timeFrom}}-{{timeTo}}<br>Liczba gosci: {{guestsCount}}</p>',
  (CAST(strftime('%s','now') AS INTEGER) * 1000)
)
ON CONFLICT(service, key) DO UPDATE SET
  subject = excluded.subject,
  body_html = excluded.body_html,
  updated_at = excluded.updated_at;

INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at)
VALUES (
  'hall',
  'hall_cancelled_client',
  '{{venueName}} - rezerwacja sali anulowana ({{reservationNumber}})',
  '<p>Dzien dobry {{fullName}},</p><p>Rezerwacja sali zostala anulowana.</p><p>Numer zgloszenia: <strong>{{reservationNumber}}</strong><br>Sala: {{hallName}}<br>Termin: {{date}} / {{timeFrom}}-{{timeTo}}</p>',
  (CAST(strftime('%s','now') AS INTEGER) * 1000)
)
ON CONFLICT(service, key) DO UPDATE SET
  subject = excluded.subject,
  body_html = excluded.body_html,
  updated_at = excluded.updated_at;

INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at)
VALUES (
  'hall',
  'hall_changed_client',
  '{{venueName}} - zaktualizowano rezerwacje sali ({{reservationNumber}})',
  '<p>Dzien dobry {{fullName}},</p><p>Wprowadzono zmiany w zgloszeniu rezerwacji sali.</p><p>Numer zgloszenia: <strong>{{reservationNumber}}</strong><br>Sala: {{hallName}}<br>Termin: {{date}} / {{timeFrom}}-{{timeTo}}<br>Liczba gosci: {{guestsCount}}<br>Rodzaj wydarzenia: {{eventType}}<br>Uwagi: {{customerNote}}</p>',
  (CAST(strftime('%s','now') AS INTEGER) * 1000)
)
ON CONFLICT(service, key) DO UPDATE SET
  subject = excluded.subject,
  body_html = excluded.body_html,
  updated_at = excluded.updated_at;

INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at)
VALUES (
  'hall',
  'hall_expired_pending_client',
  '{{venueName}} - zgloszenie wygaslo ({{reservationNumber}})',
  '<p>Dzien dobry {{fullName}},</p><p>Zgloszenie wygaslo, poniewaz nie zostalo potwierdzone w wymaganym czasie.</p><p>Numer zgloszenia: <strong>{{reservationNumber}}</strong><br>Sala: {{hallName}}<br>Termin: {{date}} / {{timeFrom}}-{{timeTo}}</p>',
  (CAST(strftime('%s','now') AS INTEGER) * 1000)
)
ON CONFLICT(service, key) DO UPDATE SET
  subject = excluded.subject,
  body_html = excluded.body_html,
  updated_at = excluded.updated_at;

INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at)
VALUES (
  'hall',
  'hall_expired_pending_admin',
  '[{{venueName}}] Wygasla rezerwacja sali {{reservationNumber}}',
  '<p>Zgloszenie rezerwacji sali wygaslo automatycznie.</p><p>Numer zgloszenia: <strong>{{reservationNumber}}</strong><br>Klient: {{fullName}}<br>E-mail: {{email}}<br>Sala: {{hallName}}<br>Termin: {{date}} / {{timeFrom}}-{{timeTo}}</p>',
  (CAST(strftime('%s','now') AS INTEGER) * 1000)
)
ON CONFLICT(service, key) DO UPDATE SET
  subject = excluded.subject,
  body_html = excluded.body_html,
  updated_at = excluded.updated_at;

INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at)
VALUES (
  'hall',
  'hall_expired_email_client',
  '{{venueName}} - link potwierdzajacy wygasl',
  '<p>Dzien dobry {{fullName}},</p><p>Link potwierdzajacy wygasl. Wyslij formularz ponownie, jesli nadal chcesz dokonac rezerwacji sali.</p><p>Numer zgloszenia: <strong>{{reservationNumber}}</strong></p>',
  (CAST(strftime('%s','now') AS INTEGER) * 1000)
)
ON CONFLICT(service, key) DO UPDATE SET
  subject = excluded.subject,
  body_html = excluded.body_html,
  updated_at = excluded.updated_at;

INSERT INTO booking_mail_templates (service, key, subject, body_html, updated_at)
VALUES (
  'hall',
  'hall_extended_pending_client',
  '{{venueName}} - przedluzono termin oczekiwania ({{reservationNumber}})',
  '<p>Dzien dobry {{fullName}},</p><p>Termin oczekiwania na decyzje zostal przedluzony.</p><p>Numer zgloszenia: <strong>{{reservationNumber}}</strong><br>Sala: {{hallName}}<br>Termin: {{date}} / {{timeFrom}}-{{timeTo}}</p>',
  (CAST(strftime('%s','now') AS INTEGER) * 1000)
)
ON CONFLICT(service, key) DO UPDATE SET
  subject = excluded.subject,
  body_html = excluded.body_html,
  updated_at = excluded.updated_at;

-- CLEANUP OF UNUSED LEGACY KEYS
DELETE FROM booking_mail_templates
WHERE (service = 'hotel' AND key IN ('pending_client'))
   OR (service = 'restaurant' AND key IN ('restaurant_pending_client', 'rest_pending_client'))
   OR (service = 'hall' AND key IN ('hall_pending_client'));
