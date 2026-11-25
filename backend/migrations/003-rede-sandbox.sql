CREATE TABLE rede_credentials (
  environment text PRIMARY KEY CHECK (environment IN ('sandbox', 'production')),
  account_hint text NOT NULL,
  encrypted text NOT NULL,
  revision uuid NOT NULL,
  verified_at timestamptz NOT NULL
);

CREATE TABLE rede_sandbox_pix (
  id uuid PRIMARY KEY,
  admin_id uuid NOT NULL REFERENCES administrators(id),
  reference text UNIQUE NOT NULL,
  cents integer NOT NULL CHECK (cents BETWEEN 1 AND 999999999),
  tid text,
  state text NOT NULL CHECK (state IN ('sending','uncertain','pending','approved','rejected','canceled','expired','refunded')),
  qr_text text,
  qr_image text,
  upstream_code text,
  refund_state text CHECK (refund_state IN ('sending','uncertain','accepted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 0
);
