-- Reverses 20261109030000_add_sharing_indexes. Removes the four indexes only; no data is touched.
BEGIN;
DROP INDEX public.card_shares_sharer_card_idx;
DROP INDEX public.connections_share_idx;
DROP INDEX public.notifications_share_idx;
DROP INDEX public.notifications_connection_idx;
COMMIT;
