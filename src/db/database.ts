import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  db = new Database(config.databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  seedKeywords(db);
  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}

function initSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS targets (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      check_type TEXT NOT NULL CHECK (check_type IN ('ats_greenhouse', 'ats_ashby', 'ats_lever', 'html', 'manual')),
      board_slug TEXT,
      careers_url TEXT,
      category TEXT,
      last_check_status TEXT CHECK (last_check_status IN ('ok', 'failed', 'manual')),
      last_checked_at TEXT,
      active INTEGER DEFAULT 1 CHECK (active IN (0, 1))
    );

    CREATE INDEX IF NOT EXISTS idx_targets_active ON targets(active);
    CREATE INDEX IF NOT EXISTS idx_targets_category ON targets(category);

    CREATE TABLE IF NOT EXISTS open_roles (
      id INTEGER PRIMARY KEY,
      target_id INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
      external_id TEXT,
      title TEXT NOT NULL,
      location TEXT,
      apply_url TEXT NOT NULL,
      first_seen_at TEXT,
      last_seen_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_open_roles_target_id ON open_roles(target_id);
    CREATE INDEX IF NOT EXISTS idx_open_roles_last_seen_at ON open_roles(last_seen_at);

    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY,
      company TEXT NOT NULL,
      role_title TEXT NOT NULL,
      apply_url TEXT,
      date_applied TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
      sub_status TEXT CHECK (sub_status IN ('rejected', 'offer', 'withdrawn', 'ghosted')),
      heard_back_date TEXT,
      interview_dates TEXT DEFAULT '[]',
      decision_date TEXT,
      reason TEXT,
      notes TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
    CREATE INDEX IF NOT EXISTS idx_applications_date_applied ON applications(date_applied DESC);
    CREATE INDEX IF NOT EXISTS idx_applications_decision_date ON applications(decision_date DESC);

    CREATE TABLE IF NOT EXISTS keywords (
      id INTEGER PRIMARY KEY,
      term TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('include', 'exclude'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_keywords_kind_term ON keywords(kind, term);

    CREATE TABLE IF NOT EXISTS role_report_history (
      id INTEGER PRIMARY KEY,
      target_id INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
      role_key TEXT NOT NULL,
      report_window TEXT NOT NULL,
      reported_at TEXT NOT NULL,
      UNIQUE(target_id, role_key, report_window)
    );

    CREATE INDEX IF NOT EXISTS idx_role_report_history_window ON role_report_history(report_window);
    CREATE INDEX IF NOT EXISTS idx_role_report_history_role ON role_report_history(target_id, role_key);

    CREATE TABLE IF NOT EXISTS applied_roles (
      id INTEGER PRIMARY KEY,
      application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      target_id INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
      role_key TEXT NOT NULL,
      company TEXT NOT NULL,
      role_title TEXT NOT NULL,
      apply_url TEXT,
      applied_at TEXT NOT NULL,
      UNIQUE(target_id, role_key)
    );

    CREATE INDEX IF NOT EXISTS idx_applied_roles_role ON applied_roles(target_id, role_key);
  `);
}

function seedKeywords(database: Database.Database): void {
  const include = [
    "data engineer",
    "analytics engineer",
    "data analyst",
    "data scientist",
    "business intelligence",
    "bi engineer",
    "analytics",
    "machine learning engineer",
    "ml engineer",
    "data infrastructure",
    "analyst",
    "product analyst",
    "business analyst",
    "operations analyst",
    "strategy analyst",
    "risk analyst",
    "research analyst",
    "growth analyst",
    "financial analyst",
    "reporting analyst",
    "insights analyst",
    "customer insights",
    "data operations",
    "data quality",
    "business operations",
    "strategy & operations",
    "strategy and operations",
    "growth associate",
    "operations associate",
    "research associate",
    "data associate"
  ];
  const exclude = ["data center", "data entry", "facilities", "sales", "recruiter"];

  const insert = database.prepare("INSERT OR IGNORE INTO keywords (term, kind) VALUES (?, ?)");
  const transaction = database.transaction(() => {
    for (const term of include) insert.run(term, "include");
    for (const term of exclude) insert.run(term, "exclude");
  });

  transaction();
}
