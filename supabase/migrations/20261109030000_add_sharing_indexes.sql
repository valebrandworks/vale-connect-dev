-- Indexes for the reciprocal sharing links (flagged by the Supabase performance advisor as unindexed foreign keys).
-- Each of these links has an ON DELETE action, so deleting the row it points to makes Postgres look up every row
-- that refers to it. Without an index that lookup reads the whole table. purge_share_history, which runs on every
-- share and when notifications are marked read, deletes old shares, so it triggers two of these lookups each time.
-- Adds indexes only: no data, rules or permissions change. Reverse: supabase/rollback/20261109030000_add_sharing_indexes.down.sql
BEGIN;
CREATE INDEX card_shares_sharer_card_idx ON public.card_shares (sharer_card_id);        -- deleting a member's card
CREATE INDEX connections_share_idx ON public.connections (share_id);                     -- deleting a share
CREATE INDEX notifications_share_idx ON public.notifications (share_id);                 -- deleting a share
CREATE INDEX notifications_connection_idx ON public.notifications (connection_id);       -- deleting a connection
COMMIT;
