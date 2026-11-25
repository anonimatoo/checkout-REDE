CREATE TABLE administrators (
  id uuid PRIMARY KEY,
  singleton boolean NOT NULL UNIQUE CHECK (singleton),
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_sessions (
  digest text PRIMARY KEY,
  admin_id uuid NOT NULL REFERENCES administrators(id) ON DELETE CASCADE,
  csrf text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX admin_sessions_admin_idx ON admin_sessions(admin_id);

CREATE TABLE reset_tokens (
  digest text PRIMARY KEY,
  admin_id uuid NOT NULL REFERENCES administrators(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE TABLE auth_limits (
  key text PRIMARY KEY,
  count integer NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE store_settings (
  id boolean PRIMARY KEY CHECK (id),
  name text NOT NULL DEFAULT 'Meu estabelecimento',
  legal_name text NOT NULL DEFAULT '',
  document text NOT NULL DEFAULT '',
  merchant_reference text NOT NULL DEFAULT '',
  support_email text NOT NULL DEFAULT '',
  support_phone text NOT NULL DEFAULT '',
  support_whatsapp text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  privacy text NOT NULL DEFAULT '',
  terms text NOT NULL DEFAULT '',
  primary_color text NOT NULL DEFAULT '#ff6600',
  secondary_color text NOT NULL DEFAULT '#101828',
  logo text NOT NULL DEFAULT '',
  min_cents integer NOT NULL DEFAULT 100 CHECK (min_cents > 0),
  max_cents integer NOT NULL DEFAULT 10000000 CHECK (max_cents BETWEEN min_cents AND 999999999),
  min_installment integer NOT NULL DEFAULT 500 CHECK (min_installment > 0),
  max_installments integer NOT NULL DEFAULT 12 CHECK (max_installments BETWEEN 1 AND 12),
  authorized_cidr inet,
  observed_egress inet,
  egress_checked_at timestamptz
);
INSERT INTO store_settings (id) VALUES (true);

CREATE TABLE orders (
  id uuid PRIMARY KEY,
  admin_id uuid NOT NULL REFERENCES administrators(id),
  idempotency_key uuid NOT NULL,
  input_digest text NOT NULL,
  token_digest text UNIQUE NOT NULL,
  token_sealed text NOT NULL,
  reference text NOT NULL,
  description text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 1 AND 999999999),
  max_installments integer NOT NULL CHECK (max_installments BETWEEN 1 AND 12),
  min_installment integer NOT NULL CHECK (min_installment > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  canceled_at timestamptz,
  UNIQUE (admin_id, idempotency_key)
);
CREATE INDEX orders_created_idx ON orders(created_at DESC, id DESC);

CREATE TABLE audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id uuid REFERENCES administrators(id),
  action text NOT NULL,
  subject text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
