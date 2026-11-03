BEGIN;
ALTER TABLE public.public_cards ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.public_cards FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.public_cards TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.public_cards TO authenticated;
COMMIT;