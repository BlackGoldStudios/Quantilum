-- Quantilum core schema
-- Run with: npm run migrate

CREATE TYPE user_role AS ENUM ('student', 'teacher', 'business', 'worker');
CREATE TYPE verification_status AS ENUM ('unverified', 'pending', 'verified', 'rejected');
CREATE TYPE quest_status AS ENUM ('active', 'submitted', 'approved', 'rejected');
CREATE TYPE ledger_type AS ENUM (
  'subscription_payment',   -- $5 business reg, etc.
  'quest_reward',           -- student earns from quest
  'tutor_trial_payout',     -- platform pays teacher for trial week
  'b2b_project_payment',    -- business -> worker/business
  'withdrawal',
  'deposit'
);

-- ============ USERS ============
CREATE TABLE users (
  id                SERIAL PRIMARY KEY,
  github_id         BIGINT UNIQUE,
  github_username   TEXT,
  email             TEXT UNIQUE,
  display_name      TEXT NOT NULL,
  avatar_url        TEXT,
  role              user_role NOT NULL,
  verification      verification_status NOT NULL DEFAULT 'unverified',
  verification_doc_url TEXT,           -- link to uploaded ID / business cert
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ WALLETS ============
CREATE TABLE wallets (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  balance_cents     INTEGER NOT NULL DEFAULT 0, -- store money as integer cents, avoid float
  currency          TEXT NOT NULL DEFAULT 'INR',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

CREATE TABLE ledger_entries (
  id                SERIAL PRIMARY KEY,
  wallet_id         INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  type              ledger_type NOT NULL,
  amount_cents      INTEGER NOT NULL, -- positive = credit, negative = debit
  reference_id      INTEGER,          -- e.g. quest_id, project_id
  reference_table   TEXT,
  memo              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ STUDENT HUB ============
CREATE TABLE notes (
  id                SERIAL PRIMARY KEY,
  student_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  body              TEXT,
  image_url         TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE quizzes (
  id                SERIAL PRIMARY KEY,
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL, -- teacher, nullable if AI-generated
  title             TEXT NOT NULL,
  questions_json     JSONB NOT NULL, -- [{q, options[], answerIndex}]
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE quiz_attempts (
  id                SERIAL PRIMARY KEY,
  quiz_id           INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  student_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score             INTEGER NOT NULL,
  total              INTEGER NOT NULL,
  submitted_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tutor_trials (
  id                SERIAL PRIMARY KEY,
  student_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  teacher_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at           TIMESTAMPTZ NOT NULL, -- starts_at + 7 days
  payout_cents      INTEGER NOT NULL DEFAULT 0,
  payout_released   BOOLEAN NOT NULL DEFAULT false
);

-- ============ QUESTS (gamification) ============
CREATE TABLE quests (
  id                SERIAL PRIMARY KEY,
  assigned_by       INTEGER REFERENCES users(id) ON DELETE SET NULL, -- teacher or NULL = platform quest
  title             TEXT NOT NULL,
  description       TEXT,
  reward_cents      INTEGER NOT NULL DEFAULT 100, -- default ~ ₹1
  is_daily          BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE quest_completions (
  id                SERIAL PRIMARY KEY,
  quest_id          INTEGER NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  student_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status            quest_status NOT NULL DEFAULT 'active',
  proof_url         TEXT,
  completed_at      TIMESTAMPTZ,
  reviewed_at       TIMESTAMPTZ,
  UNIQUE(quest_id, student_id)
);

-- ============ JARVIS (adaptive AI) ============
CREATE TABLE jarvis_preferences (
  id                SERIAL PRIMARY KEY,
  student_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_weights_json JSONB NOT NULL DEFAULT '{}', -- learned interest weights
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(student_id)
);

CREATE TABLE jarvis_messages (
  id                SERIAL PRIMARY KEY,
  student_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role              TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content           TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ TEACHER PORTAL ============
CREATE TABLE classes (
  id                SERIAL PRIMARY KEY,
  teacher_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  description       TEXT,
  meeting_link      TEXT,
  scheduled_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE class_enrollments (
  id                SERIAL PRIMARY KEY,
  class_id          INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enrolled_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(class_id, student_id)
);

-- ============ BUSINESS MARKETPLACE ============
CREATE TABLE businesses (
  id                SERIAL PRIMARY KEY,
  owner_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_name      TEXT NOT NULL,
  registration_cert_url TEXT,
  verified_badge    BOOLEAN NOT NULL DEFAULT false,
  registration_paid BOOLEAN NOT NULL DEFAULT false, -- $5 fee
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE business_ads (
  id                SERIAL PRIMARY KEY,
  business_id       INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  body              TEXT,
  image_url         TEXT,
  active            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pnl_entries (
  id                SERIAL PRIMARY KEY,
  business_id       INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  label             TEXT NOT NULL,
  amount_cents      INTEGER NOT NULL, -- positive = revenue, negative = expense
  entry_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id                SERIAL PRIMARY KEY,
  business_id       INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  description       TEXT,
  budget_cents      INTEGER,
  status            TEXT NOT NULL DEFAULT 'open', -- open, in_progress, completed, cancelled
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE project_applications (
  id                SERIAL PRIMARY KEY,
  project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  worker_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message           TEXT,
  status            TEXT NOT NULL DEFAULT 'pending', -- pending, accepted, rejected
  applied_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, worker_id)
);

-- ============ WORKER NETWORK ============
CREATE TABLE portfolios (
  id                SERIAL PRIMARY KEY,
  worker_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  headline          TEXT,
  bio               TEXT,
  skills            TEXT[], -- e.g. {'react','design'}
  portfolio_links   TEXT[],
  UNIQUE(worker_id)
);

CREATE TABLE messages (
  id                SERIAL PRIMARY KEY,
  sender_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body              TEXT NOT NULL,
  read_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ INDEXES ============
CREATE INDEX idx_notes_student ON notes(student_id);
CREATE INDEX idx_quest_completions_student ON quest_completions(student_id);
CREATE INDEX idx_ledger_wallet ON ledger_entries(wallet_id);
CREATE INDEX idx_projects_business ON projects(business_id);
CREATE INDEX idx_project_applications_project ON project_applications(project_id);
CREATE INDEX idx_messages_recipient ON messages(recipient_id);
CREATE INDEX idx_jarvis_messages_student ON jarvis_messages(student_id);
