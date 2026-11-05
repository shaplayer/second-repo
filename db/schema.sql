-- BigStocks.com schema. Run once: npm run db:init

CREATE TABLE IF NOT EXISTS subscribers (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT UNIQUE,
  phone         TEXT UNIQUE,
  sms_consent   BOOLEAN NOT NULL DEFAULT FALSE,
  consent_text  TEXT,                -- exact wording the user agreed to (TCPA)
  consent_at    TIMESTAMPTZ,
  ip            TEXT,
  user_agent    TEXT,
  source        TEXT,                -- e.g. 'home-hero', 'home-footer'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  unsubscribed_at TIMESTAMPTZ,
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS news_items (
  id            BIGSERIAL PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('press', 'filing')),
  ticker        TEXT,
  company       TEXT,
  title         TEXT NOT NULL,
  url           TEXT NOT NULL UNIQUE,
  source        TEXT NOT NULL,
  form_type     TEXT,
  published_at  TIMESTAMPTZ NOT NULL,
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS news_items_published_idx ON news_items (published_at DESC);
CREATE INDEX IF NOT EXISTS news_items_ticker_idx ON news_items (ticker, published_at DESC);

-- Public track record (Phase 4). Every alert, wins AND losses.
CREATE TABLE IF NOT EXISTS alerts (
  id            BIGSERIAL PRIMARY KEY,
  ticker        TEXT NOT NULL,
  alerted_at    TIMESTAMPTZ NOT NULL,
  alert_price   NUMERIC(14,4) NOT NULL,
  high_after    NUMERIC(14,4),       -- highest price after alert (same session)
  close_after   NUMERIC(14,4),       -- closing price on alert day
  result        TEXT CHECK (result IN ('win', 'loss', 'flat', 'open')),
  sponsored     BOOLEAN NOT NULL DEFAULT FALSE,
  sponsor_comp  TEXT,                -- compensation disclosure (SEC 17(b)), required when sponsored
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (NOT sponsored OR sponsor_comp IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS alerts_alerted_idx ON alerts (alerted_at DESC);

-- Sponsor inquiries from /advertise
CREATE TABLE IF NOT EXISTS inquiries (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  company       TEXT NOT NULL,
  ticker        TEXT,
  email         TEXT NOT NULL,
  phone         TEXT,
  package       TEXT,
  message       TEXT,
  ip            TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  handled_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS inquiries_created_idx ON inquiries (created_at DESC);

-- Track record integrity: alerts can never be deleted, and the facts recorded
-- at send time (ticker, time, price, sponsorship) can never be changed.
-- Only the outcome fields (high_after, close_after, result, notes) can be filled in later.
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION alerts_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'alerts are permanent: the public track record cannot be deleted';
  END IF;
  IF NEW.ticker IS DISTINCT FROM OLD.ticker
     OR NEW.alerted_at IS DISTINCT FROM OLD.alerted_at
     OR NEW.alert_price IS DISTINCT FROM OLD.alert_price
     OR NEW.sponsored IS DISTINCT FROM OLD.sponsored
     OR NEW.sponsor_comp IS DISTINCT FROM OLD.sponsor_comp
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'alert %: ticker, time, price and sponsorship are permanent', OLD.id;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS alerts_guard_row ON alerts;
CREATE TRIGGER alerts_guard_row BEFORE UPDATE OR DELETE ON alerts FOR EACH ROW EXECUTE FUNCTION alerts_guard();
DROP TRIGGER IF EXISTS alerts_guard_truncate ON alerts;
CREATE TRIGGER alerts_guard_truncate BEFORE TRUNCATE ON alerts FOR EACH STATEMENT EXECUTE FUNCTION alerts_guard();

-- When the team was emailed about an inquiry (NULL = notification not sent / failed)
ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;
