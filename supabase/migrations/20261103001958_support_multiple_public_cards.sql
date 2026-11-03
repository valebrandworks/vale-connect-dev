BEGIN;
ALTER TABLE public.public_cards
  ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN card_label text NOT NULL DEFAULT 'My card',
  ADD COLUMN revision bigint NOT NULL DEFAULT 0;
ALTER TABLE public.public_cards DROP CONSTRAINT public_cards_pkey;
ALTER TABLE public.public_cards ADD CONSTRAINT public_cards_pkey PRIMARY KEY (id);
CREATE INDEX public_cards_owner_id_idx ON public.public_cards(owner_id);
ALTER TABLE public.public_cards
  ADD CONSTRAINT public_cards_label_check CHECK (length(btrim(card_label)) BETWEEN 1 AND 80),
  ADD CONSTRAINT public_cards_revision_check CHECK (revision >= 0);
COMMIT;

