export const CHECK_TYPES = [
  "ats_greenhouse",
  "ats_ashby",
  "ats_lever",
  "ats_workable",
  "ats_recruitee",
  "ats_smartrecruiters",
  "ats_personio",
  "html",
  "manual"
] as const;
export type CheckType = (typeof CHECK_TYPES)[number];

export const CHECK_STATUSES = ["ok", "failed", "manual"] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export const KEYWORD_KINDS = ["include", "exclude"] as const;
export type KeywordKind = (typeof KEYWORD_KINDS)[number];

export const APPLICATION_STATUSES = ["active", "closed"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const CLOSED_SUB_STATUSES = ["rejected", "offer", "withdrawn", "ghosted"] as const;
export type ClosedSubStatus = (typeof CLOSED_SUB_STATUSES)[number];

export const OUTREACH_STATUSES = ["not_started", "researching", "contacted", "applied", "paused"] as const;
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

export interface TargetRow {
  id: number;
  name: string;
  check_type: CheckType;
  board_slug: string | null;
  careers_url: string | null;
  category: string | null;
  location_filter: string | null;
  last_check_status: CheckStatus | null;
  last_checked_at: string | null;
  active: number;
}

export interface TargetWithOutreach extends TargetRow {
  outreach_status: OutreachStatus | null;
  outreach_contact_url: string | null;
  outreach_notes: string | null;
  outreach_updated_at: string | null;
}

export interface TargetOutreachRow {
  target_id: number;
  status: OutreachStatus;
  contact_url: string | null;
  notes: string | null;
  updated_at: string | null;
}

export interface KeywordRow {
  id: number;
  term: string;
  kind: KeywordKind;
}

export interface OpenRoleRow {
  id: number;
  target_id: number;
  external_id: string | null;
  title: string;
  location: string | null;
  apply_url: string;
  first_seen_at: string | null;
  last_seen_at: string | null;
}

export interface OpenRoleWithTarget extends OpenRoleRow {
  company: string;
  target_check_status: CheckStatus | null;
}

export interface HiddenRoleRow {
  id: number;
  target_id: number;
  role_key: string;
  company: string;
  role_title: string;
  apply_url: string | null;
  suppressed_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewOpenRole {
  target_id: number;
  external_id: string | null;
  title: string;
  location: string | null;
  apply_url: string;
}

export interface ApplicationRow {
  id: number;
  company: string;
  role_title: string;
  apply_url: string | null;
  date_applied: string;
  status: ApplicationStatus;
  sub_status: ClosedSubStatus | null;
  heard_back_date: string | null;
  interview_dates: string | null;
  decision_date: string | null;
  reason: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface TargetScanOutcome {
  target: TargetRow;
  status: CheckStatus;
  matchingRoles: NewOpenRole[];
  error?: string;
}
