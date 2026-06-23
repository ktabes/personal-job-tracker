import type { OpenRoleWithTarget } from "../types.js";

export type RoleBucket = "low" | "mid" | "high";
export type OpenRolesReportView = "default" | "best-fit" | "melbourne" | "risk-fraud" | "entry-mid";

const LOWER_LEVEL_PATTERNS = [
  /\bjunior\b/i,
  /\bjr\.?\b/i,
  /\bentry[- ]level\b/i,
  /\bnew grad\b/i,
  /\bgraduate\b/i,
  /\bearly career\b/i,
  /\bintern(ship)?\b/i,
  /\bassociate\b/i,
  /\banalyst\b/i,
  /\bcoordinator\b/i,
  /\bspecialist\b/i,
  /\brepresentative\b/i,
  /\brep\b/i,
  /\bsupport agent\b/i,
  /\btrainer\b/i,
  /\binvestigator\b/i,
  /\bassistant\b/i,
  /\bapprentice\b/i
];

const SENIOR_PATTERNS = [
  /\bsenior\b/i,
  /\bsr\.?\b/i,
  /\bstaff\b/i,
  /\bprincipal\b/i,
  /\blead\b/i,
  /\bmanager\b/i,
  /\bdirector\b/i,
  /\bhead of\b/i,
  /\bvp\b/i,
  /\bvice president\b/i,
  /\bchief\b/i,
  /\barchitect\b/i,
  /\bfellow\b/i,
  /\bdistinguished\b/i,
  /\bexecutive\b/i,
  /\bcontroller\b/i
];

const DATA_TERMS = [
  "data",
  "analytics",
  "analyst",
  "business intelligence",
  "bi ",
  "insights",
  "reporting",
  "machine learning",
  "ml ",
  "research",
  "market intelligence"
];

const RISK_TERMS = [
  "risk",
  "fraud",
  "compliance",
  "aml",
  "kyc",
  "sanctions",
  "financial crime",
  "financial crimes",
  "trust",
  "safety",
  "transaction monitoring",
  "threat intelligence"
];

const OPERATIONS_TERMS = [
  "operations",
  "strategy",
  "implementation",
  "solutions",
  "solution",
  "customer success",
  "customer support",
  "customer experience",
  "support",
  "onboarding",
  "growth",
  "product",
  "finance",
  "treasury",
  "billing",
  "payments",
  "revenue"
];

const CRYPTO_TERMS = [
  "crypto",
  "blockchain",
  "onchain",
  "on-chain",
  "defi",
  "protocol",
  "web3",
  "wallet",
  "token",
  "trading"
];

const GOOD_LOCATION_TERMS = [
  "remote",
  "united states",
  " usa ",
  " us ",
  "u.s.",
  "north america",
  "canada",
  "australia",
  "melbourne",
  "victoria",
  " vic"
];

const MELBOURNE_TERMS = ["melbourne", "victoria", " vic", "australia", "remote australia", "oceania"];

export function classifyRoleLevel(role: OpenRoleWithTarget): RoleBucket {
  const title = role.title.toLowerCase();
  if (SENIOR_PATTERNS.some((pattern) => pattern.test(title))) return "high";
  if (LOWER_LEVEL_PATTERNS.some((pattern) => pattern.test(title))) return "low";
  return "mid";
}

export function scoreRoleFit(role: OpenRoleWithTarget): number {
  const level = classifyRoleLevel(role);
  const searchable = roleSearchText(role);
  let score = 45;

  if (containsAny(searchable, DATA_TERMS)) score += 20;
  if (containsAny(searchable, RISK_TERMS)) score += 15;
  if (containsAny(searchable, OPERATIONS_TERMS)) score += 10;
  if (containsAny(searchable, CRYPTO_TERMS)) score += 8;
  if (containsAny(` ${role.location?.toLowerCase() ?? ""} `, GOOD_LOCATION_TERMS)) score += 8;

  if (level === "low") score += 12;
  if (level === "mid") score += 6;
  if (level === "high") score -= 25;

  return Math.max(0, Math.min(100, score));
}

export function roleMatchesSavedView(role: OpenRoleWithTarget, view: OpenRolesReportView): boolean {
  const searchable = roleSearchText(role);
  switch (view) {
    case "default":
      return true;
    case "best-fit":
      return scoreRoleFit(role) >= 70;
    case "melbourne":
      return containsAny(searchable, MELBOURNE_TERMS);
    case "risk-fraud":
      return containsAny(searchable, RISK_TERMS);
    case "entry-mid":
      return classifyRoleLevel(role) !== "high";
  }
}

export function reportViewLabel(view: OpenRolesReportView): string {
  switch (view) {
    case "default":
      return "default";
    case "best-fit":
      return "best-fit";
    case "melbourne":
      return "Melbourne / Australia";
    case "risk-fraud":
      return "risk / fraud / compliance";
    case "entry-mid":
      return "entry + mid";
  }
}

function roleSearchText(role: OpenRoleWithTarget): string {
  return ` ${role.title} ${role.company} ${role.location ?? ""} ${role.target_category ?? ""} `.toLowerCase();
}

function containsAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}
