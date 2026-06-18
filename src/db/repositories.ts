import type Database from "better-sqlite3";
import { config } from "../config.js";
import { writeApplicationsCsv } from "../csv/exporter.js";
import { nowIso } from "../time.js";
import type {
  ApplicationRow,
  CheckStatus,
  CheckType,
  ClosedSubStatus,
  KeywordKind,
  KeywordRow,
  NewOpenRole,
  OpenRoleRow,
  OpenRoleWithTarget,
  OutreachStatus,
  TargetOutreachRow,
  TargetRow,
  TargetScanOutcome,
  TargetWithOutreach
} from "../types.js";

interface AddTargetInput {
  name: string;
  checkType: CheckType;
  boardSlug: string | null;
  careersUrl: string | null;
  category: string | null;
  locationFilter: string | null;
}

interface UpdateApplicationInput {
  heardBackDate?: string | null;
  addInterviewDate?: string | null;
  notes?: string | null;
}

interface CreateManualApplicationInput {
  company: string;
  roleTitle: string;
  applyUrl: string | null;
  dateApplied: string;
  notes?: string | null;
}

interface CreateApplicationResult {
  application: ApplicationRow;
  created: boolean;
}

interface CloseApplicationInput {
  subStatus: ClosedSubStatus;
  decisionDate: string;
  reason?: string | null;
  notes?: string | null;
}

interface UpdateTargetOutreachInput {
  targetId: number;
  status: OutreachStatus;
  contactUrl?: string | null;
  notes?: string | null;
}

export type RoleHideDurationDays = 7 | 14 | 30;

const ROLE_KEY_SQL =
  "CASE WHEN open_roles.external_id IS NOT NULL AND open_roles.external_id <> '' THEN 'external:' || open_roles.external_id ELSE 'url:' || open_roles.apply_url || ':title:' || open_roles.title END";

export class JobTrackerRepository {
  constructor(private readonly db: Database.Database) {}

  listTargets(includeInactive = false, category: string | null = null): TargetRow[] {
    const { where, params } = targetWhereClause(includeInactive, category);
    return this.db
      .prepare(`SELECT * FROM targets${where} ORDER BY active DESC, lower(name)`)
      .all(...params) as TargetRow[];
  }

  listTargetsWithOutreach(includeInactive = false, category: string | null = null): TargetWithOutreach[] {
    const { where, params } = targetWhereClause(includeInactive, category);
    return this.db
      .prepare(
        `SELECT
           targets.*,
           target_outreach.status AS outreach_status,
           target_outreach.contact_url AS outreach_contact_url,
           target_outreach.notes AS outreach_notes,
           target_outreach.updated_at AS outreach_updated_at
         FROM targets
         LEFT JOIN target_outreach ON target_outreach.target_id = targets.id
         ${where}
         ORDER BY targets.active DESC, lower(targets.name)`
      )
      .all(...params) as TargetWithOutreach[];
  }

  addTarget(input: AddTargetInput): TargetRow {
    const info = this.db
      .prepare(
        `INSERT INTO targets (name, check_type, board_slug, careers_url, category, location_filter, last_check_status, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
      )
      .run(
        input.name,
        input.checkType,
        input.boardSlug,
        input.careersUrl,
        input.category,
        input.locationFilter,
        input.checkType === "manual" ? "manual" : null
      );

    return this.getTarget(Number(info.lastInsertRowid));
  }

  disableTarget(id: number): boolean {
    const transaction = this.db.transaction((targetId: number) => {
      const info = this.db.prepare("UPDATE targets SET active = 0 WHERE id = ?").run(targetId);
      this.db.prepare("DELETE FROM open_roles WHERE target_id = ?").run(targetId);
      return info.changes > 0;
    });
    return transaction(id);
  }

  getTarget(id: number): TargetRow {
    const row = this.db.prepare("SELECT * FROM targets WHERE id = ?").get(id) as TargetRow | undefined;
    if (!row) throw new Error(`Target ${id} not found`);
    return row;
  }

  getTargetOutreach(targetId: number): TargetOutreachRow | null {
    return (
      (this.db
        .prepare("SELECT * FROM target_outreach WHERE target_id = ?")
        .get(targetId) as TargetOutreachRow | undefined) ?? null
    );
  }

  updateTargetOutreach(input: UpdateTargetOutreachInput): TargetOutreachRow {
    this.getTarget(input.targetId);
    const current = this.getTargetOutreach(input.targetId);
    const contactUrl = input.contactUrl === undefined ? current?.contact_url ?? null : emptyToNull(input.contactUrl);
    const notes = input.notes === undefined ? current?.notes ?? null : emptyToNull(input.notes);
    const updatedAt = nowIso();

    this.db
      .prepare(
        `INSERT INTO target_outreach (target_id, status, contact_url, notes, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(target_id) DO UPDATE SET
           status = excluded.status,
           contact_url = excluded.contact_url,
           notes = excluded.notes,
           updated_at = excluded.updated_at`
      )
      .run(input.targetId, input.status, contactUrl, notes, updatedAt);

    const updated = this.getTargetOutreach(input.targetId);
    if (!updated) throw new Error(`Outreach row for target ${input.targetId} was not written`);
    return updated;
  }

  listKeywords(): KeywordRow[] {
    return this.db.prepare("SELECT * FROM keywords ORDER BY kind, lower(term)").all() as KeywordRow[];
  }

  addKeyword(term: string, kind: KeywordKind): void {
    const normalized = normalizeKeyword(term);
    this.db.prepare("INSERT OR IGNORE INTO keywords (term, kind) VALUES (?, ?)").run(normalized, kind);
  }

  removeKeyword(term: string, kind: KeywordKind): boolean {
    const normalized = normalizeKeyword(term);
    const info = this.db.prepare("DELETE FROM keywords WHERE term = ? AND kind = ?").run(normalized, kind);
    return info.changes > 0;
  }

  saveScanOutcomes(outcomes: TargetScanOutcome[], checkedAt: string): void {
    const priorRows = this.db
      .prepare("SELECT target_id, external_id, title, apply_url, first_seen_at FROM open_roles")
      .all() as Array<Pick<OpenRoleRow, "target_id" | "external_id" | "title" | "apply_url" | "first_seen_at">>;
    const firstSeenByKey = new Map<string, string | null>();
    for (const row of priorRows) {
      firstSeenByKey.set(roleIdentity(row), row.first_seen_at);
    }

    const updateTarget = this.db.prepare(
      "UPDATE targets SET last_check_status = ?, last_checked_at = ? WHERE id = ?"
    );
    const deleteRolesForTarget = this.db.prepare("DELETE FROM open_roles WHERE target_id = ?");
    const insertRole = this.db.prepare(
      `INSERT INTO open_roles (target_id, external_id, title, location, apply_url, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    const transaction = this.db.transaction((items: TargetScanOutcome[]) => {
      for (const outcome of items) {
        updateTarget.run(outcome.status, checkedAt, outcome.target.id);
      }

      for (const outcome of items) {
        deleteRolesForTarget.run(outcome.target.id);
        if (outcome.status !== "ok") continue;
        for (const role of outcome.matchingRoles) {
          const firstSeenAt = firstSeenByKey.get(roleIdentity(role)) ?? checkedAt;
          insertRole.run(
            role.target_id,
            role.external_id,
            role.title,
            role.location,
            role.apply_url,
            firstSeenAt,
            checkedAt
          );
        }
      }
    });

    transaction(outcomes);
  }

  listOpenRolesWithTargets(category: string | null = null): OpenRoleWithTarget[] {
    const { categoryFilter, params } = openRoleCategoryFilter(category);
    return this.db
      .prepare(
        `SELECT open_roles.*, targets.name AS company, targets.last_check_status AS target_check_status
         FROM open_roles
         JOIN targets ON targets.id = open_roles.target_id
         WHERE targets.active = 1${categoryFilter}
         ORDER BY lower(targets.name), lower(open_roles.title)`
      )
      .all(...params) as OpenRoleWithTarget[];
  }

  listReportableOpenRolesWithTargets(category: string | null = null): OpenRoleWithTarget[] {
    const { categoryFilter, params } = openRoleCategoryFilter(category);
    const timestamp = nowIso();
    return this.db
      .prepare(
        `SELECT open_roles.*, targets.name AS company, targets.last_check_status AS target_check_status
         FROM open_roles
         JOIN targets ON targets.id = open_roles.target_id
         WHERE targets.active = 1${categoryFilter}
           AND NOT EXISTS (
             SELECT 1
             FROM hidden_roles
             WHERE hidden_roles.target_id = open_roles.target_id
               AND hidden_roles.role_key = ${ROLE_KEY_SQL}
               AND (hidden_roles.suppressed_until IS NULL OR hidden_roles.suppressed_until > ?)
           )
           AND NOT EXISTS (
             SELECT 1
             FROM applied_roles
             WHERE applied_roles.target_id = open_roles.target_id
               AND applied_roles.role_key = ${ROLE_KEY_SQL}
           )
           AND NOT EXISTS (
             SELECT 1
             FROM applications
             WHERE lower(applications.company) = lower(targets.name)
               AND lower(applications.role_title) = lower(open_roles.title)
               AND COALESCE(applications.apply_url, '') = open_roles.apply_url
         )
         ORDER BY lower(targets.name), lower(open_roles.title)`
      )
      .all(...params, timestamp) as OpenRoleWithTarget[];
  }

  getOpenRoleWithTarget(id: number): OpenRoleWithTarget | null {
    return (
      (this.db
        .prepare(
          `SELECT open_roles.*, targets.name AS company, targets.last_check_status AS target_check_status
           FROM open_roles
           JOIN targets ON targets.id = open_roles.target_id
           WHERE open_roles.id = ?`
        )
        .get(id) as OpenRoleWithTarget | undefined) ?? null
    );
  }

  getOpenRoleWithTargetByApplyUrl(applyUrl: string): OpenRoleWithTarget | null {
    return (
      (this.db
        .prepare(
          `SELECT open_roles.*, targets.name AS company, targets.last_check_status AS target_check_status
           FROM open_roles
           JOIN targets ON targets.id = open_roles.target_id
           WHERE open_roles.apply_url = ?
           ORDER BY open_roles.id
           LIMIT 1`
        )
        .get(applyUrl) as OpenRoleWithTarget | undefined) ?? null
    );
  }

  createApplicationFromOpenRole(role: OpenRoleWithTarget, dateApplied: string): ApplicationRow {
    const existing = this.db
      .prepare(
        `SELECT * FROM applications
         WHERE status = 'active'
           AND company = ?
           AND role_title = ?
           AND COALESCE(apply_url, '') = COALESCE(?, '')
         ORDER BY id DESC
         LIMIT 1`
      )
      .get(role.company, role.title, role.apply_url) as ApplicationRow | undefined;

    if (existing) {
      this.markRoleApplied(role, existing.id);
      this.deleteOpenRole(role.id);
      return existing;
    }

    const timestamp = nowIso();
    const info = this.db
      .prepare(
        `INSERT INTO applications (
          company,
          role_title,
          apply_url,
          date_applied,
          status,
          sub_status,
          heard_back_date,
          interview_dates,
          decision_date,
          reason,
          notes,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, 'active', NULL, NULL, '[]', NULL, NULL, NULL, ?, ?)`
      )
      .run(role.company, role.title, role.apply_url, dateApplied, timestamp, timestamp);

    const application = this.getApplication(Number(info.lastInsertRowid));
    this.markRoleApplied(role, application.id);
    this.deleteOpenRole(role.id);
    this.regenerateCsv();
    return application;
  }

  createManualApplication(input: CreateManualApplicationInput): CreateApplicationResult {
    const company = input.company.trim();
    const roleTitle = input.roleTitle.trim();
    const applyUrl = emptyToNull(input.applyUrl);
    const notes = emptyToNull(input.notes);

    if (!company) {
      throw new Error("Company cannot be blank");
    }
    if (!roleTitle) {
      throw new Error("Role title cannot be blank");
    }

    const existing = this.db
      .prepare(
        `SELECT * FROM applications
         WHERE status = 'active'
           AND lower(company) = lower(?)
           AND lower(role_title) = lower(?)
           AND COALESCE(apply_url, '') = COALESCE(?, '')
         ORDER BY id DESC
         LIMIT 1`
      )
      .get(company, roleTitle, applyUrl) as ApplicationRow | undefined;

    if (existing) {
      return { application: existing, created: false };
    }

    const timestamp = nowIso();
    const info = this.db
      .prepare(
        `INSERT INTO applications (
          company,
          role_title,
          apply_url,
          date_applied,
          status,
          sub_status,
          heard_back_date,
          interview_dates,
          decision_date,
          reason,
          notes,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, 'active', NULL, NULL, '[]', NULL, NULL, ?, ?, ?)`
      )
      .run(company, roleTitle, applyUrl, input.dateApplied, notes, timestamp, timestamp);

    const application = this.getApplication(Number(info.lastInsertRowid));
    this.regenerateCsv();
    return { application, created: true };
  }

  hideOpenRole(role: OpenRoleWithTarget, durationDays: RoleHideDurationDays): string {
    const timestamp = nowIso();
    const suppressedUntil = daysFromNowIso(durationDays);

    this.db
      .prepare(
        `INSERT INTO hidden_roles (
          target_id,
          role_key,
          company,
          role_title,
          apply_url,
          suppressed_until,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(target_id, role_key) DO UPDATE SET
          company = excluded.company,
          role_title = excluded.role_title,
          apply_url = excluded.apply_url,
          suppressed_until = excluded.suppressed_until,
          updated_at = excluded.updated_at`
      )
      .run(role.target_id, openRoleKey(role), role.company, role.title, role.apply_url, suppressedUntil, timestamp, timestamp);

    this.deleteOpenRole(role.id);
    return suppressedUntil;
  }

  private markRoleApplied(role: OpenRoleWithTarget, applicationId: number): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO applied_roles (
          application_id,
          target_id,
          role_key,
          company,
          role_title,
          apply_url,
          applied_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(applicationId, role.target_id, openRoleKey(role), role.company, role.title, role.apply_url, nowIso());
  }

  private deleteOpenRole(id: number): void {
    this.db.prepare("DELETE FROM open_roles WHERE id = ?").run(id);
  }

  listActiveApplications(): ApplicationRow[] {
    return this.db
      .prepare(
        `SELECT * FROM applications
         WHERE status = 'active'
         ORDER BY date_applied DESC, created_at DESC, id DESC`
      )
      .all() as ApplicationRow[];
  }

  listClosedApplications(limit: number): ApplicationRow[] {
    return this.db
      .prepare(
        `SELECT * FROM applications
         WHERE status = 'closed'
         ORDER BY COALESCE(decision_date, updated_at, created_at) DESC, id DESC
         LIMIT ?`
      )
      .all(limit) as ApplicationRow[];
  }

  listAllApplicationsForExport(): ApplicationRow[] {
    return this.db
      .prepare(
        `SELECT * FROM applications
         ORDER BY date_applied DESC, created_at DESC, id DESC`
      )
      .all() as ApplicationRow[];
  }

  getApplication(id: number): ApplicationRow {
    const row = this.db.prepare("SELECT * FROM applications WHERE id = ?").get(id) as ApplicationRow | undefined;
    if (!row) throw new Error(`Application ${id} not found`);
    return row;
  }

  updateApplication(id: number, input: UpdateApplicationInput): ApplicationRow {
    const current = this.getApplication(id);
    const interviewDates = parseInterviewDates(current.interview_dates);
    const addInterviewDate = input.addInterviewDate?.trim();
    if (addInterviewDate && !interviewDates.includes(addInterviewDate)) {
      interviewDates.push(addInterviewDate);
      interviewDates.sort();
    }

    const heardBackDate = presentOrCurrent(input.heardBackDate, current.heard_back_date);
    const notes = presentOrCurrent(input.notes, current.notes);
    const timestamp = nowIso();

    this.db
      .prepare(
        `UPDATE applications
         SET heard_back_date = ?,
             interview_dates = ?,
             notes = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(heardBackDate, JSON.stringify(interviewDates), notes, timestamp, id);

    const updated = this.getApplication(id);
    this.regenerateCsv();
    return updated;
  }

  closeApplication(id: number, input: CloseApplicationInput): ApplicationRow {
    const current = this.getApplication(id);
    const timestamp = nowIso();
    const notes = presentOrCurrent(input.notes, current.notes);
    const reason = emptyToNull(input.reason);

    this.db
      .prepare(
        `UPDATE applications
         SET status = 'closed',
             sub_status = ?,
             decision_date = ?,
             reason = ?,
             notes = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(input.subStatus, input.decisionDate, reason, notes, timestamp, id);

    const updated = this.getApplication(id);
    this.regenerateCsv();
    return updated;
  }

  regenerateCsv(): void {
    writeApplicationsCsv(this.listAllApplicationsForExport(), config.csvExportPath);
  }
}

function normalizeKeyword(term: string): string {
  const normalized = term.trim().toLowerCase();
  if (normalized.length === 0) {
    throw new Error("Keyword term cannot be empty");
  }
  return normalized;
}

function roleIdentity(role: Pick<NewOpenRole, "target_id" | "external_id" | "apply_url" | "title">): string {
  if (role.external_id) return `${role.target_id}:external:${role.external_id}`;
  return `${role.target_id}:url:${role.apply_url}:title:${role.title}`;
}

function openRoleKey(role: Pick<OpenRoleRow, "external_id" | "apply_url" | "title">): string {
  if (role.external_id) return `external:${role.external_id}`;
  return `url:${role.apply_url}:title:${role.title}`;
}

function parseInterviewDates(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

function presentOrCurrent(next: string | null | undefined, current: string | null): string | null {
  if (next === undefined) return current;
  const trimmed = next?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : current;
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function daysFromNowIso(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function targetWhereClause(includeInactive: boolean, category: string | null): { where: string; params: string[] } {
  const conditions: string[] = [];
  const params: string[] = [];

  if (!includeInactive) {
    conditions.push("active = 1");
  }

  const normalizedCategory = category?.trim();
  if (normalizedCategory) {
    conditions.push("lower(category) = lower(?)");
    params.push(normalizedCategory);
  }

  return {
    where: conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "",
    params
  };
}

function openRoleCategoryFilter(category: string | null): { categoryFilter: string; params: string[] } {
  const normalizedCategory = category?.trim();
  if (!normalizedCategory) {
    return { categoryFilter: "", params: [] };
  }
  return { categoryFilter: " AND lower(targets.category) = lower(?)", params: [normalizedCategory] };
}

export function statusLabel(status: CheckStatus | null): string {
  if (status === "ok") return "ok";
  if (status === "failed") return "failed";
  if (status === "manual") return "manual";
  return "never checked";
}
