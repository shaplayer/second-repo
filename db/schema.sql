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
