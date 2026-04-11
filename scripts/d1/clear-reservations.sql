DELETE FROM hotel_reservations;
DELETE FROM restaurant_reservations;
DELETE FROM venue_reservations;
DELETE FROM booking_counters WHERE key LIKE 'reservation_human_seq_%';
