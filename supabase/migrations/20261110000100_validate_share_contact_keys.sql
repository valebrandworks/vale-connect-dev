-- Rate-limit records made before 20261110000000 held a readable contact key. With the founder's approval
-- (2026-11-10) the one such record on development was hashed in place with the same method, and the check now
-- covers every row. Safe to run again: nothing is left to convert, and validating twice changes nothing.
-- The stored value was already the normalised 'email:...' / 'phone:...' form, so the result equals what a new share
-- stores and the two-per-day limit carries over. No record is deleted.
BEGIN;
UPDATE public.share_attempts SET contact_key = vale_private.share_contact_key(contact_key)
 WHERE contact_key IS NOT NULL AND contact_key !~ '^h1:';
ALTER TABLE public.share_attempts VALIDATE CONSTRAINT share_attempts_contact_key_hashed;
COMMIT;
