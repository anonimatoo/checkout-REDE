ALTER TABLE administrators
  ALTER COLUMN singleton DROP NOT NULL,
  ALTER COLUMN password_hash DROP NOT NULL,
  ADD COLUMN role text NOT NULL DEFAULT 'owner',
  ADD COLUMN disabled_at timestamptz,
  ADD CONSTRAINT administrators_role CHECK (role IN ('owner', 'operator', 'viewer')),
  ADD CONSTRAINT administrators_single_owner CHECK ((role = 'owner') = (singleton IS TRUE));

CREATE TABLE admin_setup_token (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  digest text NOT NULL,
  expires_at timestamptz NOT NULL
);
