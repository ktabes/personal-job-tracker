import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type MessageActionRowComponentBuilder,
  type MessageCreateOptions
} from "discord.js";
import type { OpenRoleWithTarget } from "../types.js";
import type { ScanSummary } from "../scraper/scanner.js";

const MAX_EMBED_DESCRIPTION_LENGTH = 3_800;
const MAX_ROLES_PER_MESSAGE = 25;
const REPORT_COLOR = 0x2f80ed;

type RoleBucket = "low" | "mid" | "high";
type ContinentKey =
  | "north_america"
  | "europe"
  | "asia"
  | "oceania"
  | "south_america"
  | "africa"
  | "remote_global"
  | "unspecified";
export type OpenRolesReportMode = "focused" | "all" | "low" | "mid" | "high";

export interface BuiltOpenRolesReport {
  messages: MessageCreateOptions[];
}

const ROLE_BUCKETS: Array<{ key: RoleBucket; title: string }> = [
  { key: "low", title: "Low-Level" },
  { key: "mid", title: "Mid-Level" },
  { key: "high", title: "High-Level" }
];

const CONTINENT_ORDER: Array<{ key: ContinentKey; title: string }> = [
  { key: "north_america", title: "North America" },
  { key: "europe", title: "Europe" },
  { key: "asia", title: "Asia" },
  { key: "oceania", title: "Oceania" },
  { key: "south_america", title: "South America" },
  { key: "africa", title: "Africa" },
  { key: "remote_global", title: "Remote / Global" },
  { key: "unspecified", title: "Unspecified Location" }
];

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

const NORTH_AMERICA_TERMS = [
  "north america",
  "united states",
  " usa ",
  " u.s.",
  " us ",
  "canada",
  "mexico",
  "new york",
  "san francisco",
  "los angeles",
  "chicago",
  "boston",
  "seattle",
  "austin",
  "denver",
  "toronto",
  "vancouver",
  "montreal",
  " ny",
  " ca",
  " tx",
  " wa",
  " ma",
  " il"
];

const EUROPE_TERMS = [
  "europe",
  "emea",
  "united kingdom",
  " uk ",
  "england",
  "ireland",
  "germany",
  "france",
  "netherlands",
  "spain",
  "portugal",
  "italy",
  "poland",
  "switzerland",
  "sweden",
  "london",
  "dublin",
  "berlin",
  "paris",
  "amsterdam",
  "warsaw",
  "limassol"
];

const ASIA_TERMS = [
  "asia",
  "apac",
  "singapore",
  "hong kong",
  "taiwan",
  "japan",
  "south korea",
  "korea",
  "india",
  "thailand",
  "vietnam",
  "indonesia",
  "philippines",
  "malaysia",
  "uae",
  "dubai",
  "tokyo",
  "taipei",
  "bangkok",
  "jakarta",
  "manila",
  "kuala lumpur",
  "ho chi minh"
];

const OCEANIA_TERMS = [
  "oceania",
  "australia",
  "new zealand",
  "melbourne",
  "sydney",
  "brisbane",
  "perth",
  "adelaide",
  "canberra",
  "auckland",
  "wellington",
  "victoria",
  "cremorne",
  " nsw",
  " vic"
];

const SOUTH_AMERICA_TERMS = [
  "south america",
  "latin america",
  "latam",
  "brazil",
  "argentina",
  "chile",
  "colombia",
  "peru",
  "sao paulo",
  "buenos aires",
  "bogota"
];

const AFRICA_TERMS = [
  "africa",
  "south africa",
  "nigeria",
  "kenya",
  "egypt",
  "cape town",
  "johannesburg",
  "lagos",
  "nairobi",
  "cairo"
];

const REMOTE_GLOBAL_TERMS = ["global", "worldwide", "anywhere", "remote"];

export function buildOpenRolesReport(
  summary: ScanSummary,
  roles: OpenRoleWithTarget[],
  mode: OpenRolesReportMode = "focused"
): BuiltOpenRolesReport {
  const includedRoles = filterRolesForMode(roles, mode);
  return {
    messages: [buildStatusMessage(summary, roles, includedRoles, mode), ...buildRoleMessages(includedRoles, mode)]
  };
}

function buildRoleMessages(roles: OpenRoleWithTarget[], mode: OpenRolesReportMode): MessageCreateOptions[] {
  const messages: MessageCreateOptions[] = [];
  const bucketedRoles = bucketRoles(roles);

  for (const bucket of ROLE_BUCKETS) {
    if (!bucketIncluded(bucket.key, mode)) continue;
    const bucketRoles = bucketedRoles[bucket.key];
    if (bucketRoles.length === 0) continue;
    messages.push(...buildBucketRoleMessages(bucket.title, bucketRoles));
  }

  return messages;
}

function buildBucketRoleMessages(bucketTitle: string, roles: OpenRoleWithTarget[]): MessageCreateOptions[] {
  const messages: MessageCreateOptions[] = [];
  const sortedRoles = sortRolesForReport(roles);
  let lines: string[] = [];
  let roleCount = 0;
  let currentContinent: ContinentKey | null = null;
  let currentCompany: string | null = null;

  for (const role of sortedRoles) {
    let headers = groupHeadersForRole(role, currentContinent, currentCompany);
    let roleNumber = roleCount + 1;
    let line = formatRoleLine(role, roleNumber);
    let nextDescriptionLength = [...lines, ...headers, line].join("\n").length;
    if (
      lines.length > 0 &&
      (nextDescriptionLength > MAX_EMBED_DESCRIPTION_LENGTH || roleCount >= MAX_ROLES_PER_MESSAGE)
    ) {
      messages.push(toRoleMessage(bucketTitle, lines, messages.length + 1));
      lines = [];
      roleCount = 0;
      currentContinent = null;
      currentCompany = null;
      headers = groupHeadersForRole(role, currentContinent, currentCompany);
      roleNumber = roleCount + 1;
      line = formatRoleLine(role, roleNumber);
      nextDescriptionLength = [...lines, ...headers, line].join("\n").length;
    }

    lines.push(...headers, line);
    roleCount += 1;
    currentContinent = continentForRole(role);
    currentCompany = role.company;
  }

  if (lines.length > 0) {
    messages.push(toRoleMessage(bucketTitle, lines, messages.length + 1));
  }

  return messages;
}

function buildStatusMessage(
  summary: ScanSummary,
  roles: OpenRoleWithTarget[],
  includedRoles: OpenRoleWithTarget[],
  mode: OpenRolesReportMode
): MessageCreateOptions {
  const failed = summary.outcomes.filter((outcome) => outcome.status === "failed");
  const manual = summary.outcomes.filter((outcome) => outcome.status === "manual");
  const noMatches = summary.outcomes.filter(
    (outcome) => outcome.status === "ok" && outcome.matchingRoles.length === 0
  );
  const matchCount = summary.outcomes.reduce((sum, outcome) => sum + outcome.matchingRoles.length, 0);
  const bucketCounts = countBuckets(roles);

  const lines = [
    `Checked at: ${summary.checkedAt}`,
    summary.category ? `Category: ${summary.category}` : "Category: all active targets",
    matchCount > 0 ? `Matching roles found: ${matchCount}` : "No matching auto-check roles found.",
    `Low-level: ${bucketCounts.low}`,
    `Mid-level: ${bucketCounts.mid}`,
    `High-level: ${bucketCounts.high}`,
    `Included in this report: ${includedRoles.length}`,
    `Report mode: ${reportModeLabel(mode)}`
  ];

  if (mode === "focused" && bucketCounts.high > 0) {
    lines.push(`High-level roles are hidden in focused mode. Use /run mode:all to include them.`);
  }

  if (noMatches.length > 0) {
    lines.push("", "**No matching roles**");
    lines.push(...noMatches.map((outcome) => `- ${outcome.target.name}`));
  }

  if (failed.length > 0) {
    lines.push("", "**⚠️ Checks failed - verify manually**");
    lines.push(
      ...failed.map((outcome) => {
        const link = outcome.target.careers_url ? ` - ${outcome.target.careers_url}` : "";
        const error = outcome.error ? ` (${outcome.error})` : "";
        return `- ${outcome.target.name}${link}${error}`;
      })
    );
  }

  if (manual.length > 0) {
    lines.push("", "**Manual-only - check directly**");
    lines.push(
      ...manual.map((outcome) => {
        const link = outcome.target.careers_url ? ` - ${outcome.target.careers_url}` : "";
        return `- ${outcome.target.name}${link}`;
      })
    );
  }

  if (summary.outcomes.length === 0) {
    lines.push("", "No active targets are configured yet.");
  }

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Open Roles Report")
        .setDescription(splitLongLines(lines).join("\n"))
        .setColor(REPORT_COLOR)
    ]
  };
}

function toRoleMessage(
  bucketTitle: string,
  lines: string[],
  page: number
): MessageCreateOptions {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`${bucketTitle} - Page ${page}`)
        .setDescription(lines.join("\n"))
        .setFooter({ text: "Use Apply to track a role or Hide to suppress one from future reports." })
        .setColor(REPORT_COLOR)
    ],
    components: [
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder().setCustomId("apply_menu").setLabel("Apply").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("hide_menu").setLabel("Hide").setStyle(ButtonStyle.Secondary)
      )
    ]
  };
}

function bucketRoles(roles: OpenRoleWithTarget[]): Record<RoleBucket, OpenRoleWithTarget[]> {
  const bucketed: Record<RoleBucket, OpenRoleWithTarget[]> = {
    low: [],
    mid: [],
    high: []
  };

  for (const role of roles) {
    bucketed[classifyRole(role)].push(role);
  }

  return bucketed;
}

function countBuckets(roles: OpenRoleWithTarget[]): Record<RoleBucket, number> {
  const bucketed = bucketRoles(roles);
  return {
    low: bucketed.low.length,
    mid: bucketed.mid.length,
    high: bucketed.high.length
  };
}

function filterRolesForMode(roles: OpenRoleWithTarget[], mode: OpenRolesReportMode): OpenRoleWithTarget[] {
  return roles.filter((role) => bucketIncluded(classifyRole(role), mode));
}

function bucketIncluded(bucket: RoleBucket, mode: OpenRolesReportMode): boolean {
  switch (mode) {
    case "all":
      return true;
    case "focused":
      return bucket === "low" || bucket === "mid";
    case "low":
      return bucket === "low";
    case "mid":
      return bucket === "mid";
    case "high":
      return bucket === "high";
  }
}

function reportModeLabel(mode: OpenRolesReportMode): string {
  switch (mode) {
    case "all":
      return "all roles";
    case "focused":
      return "focused low + mid";
    case "low":
      return "low-level only";
    case "mid":
      return "mid-level only";
    case "high":
      return "high-level only";
  }
}

function classifyRole(role: OpenRoleWithTarget): RoleBucket {
  const title = role.title.toLowerCase();
  if (SENIOR_PATTERNS.some((pattern) => pattern.test(title))) return "high";
  if (LOWER_LEVEL_PATTERNS.some((pattern) => pattern.test(title))) return "low";
  return "mid";
}

function formatRoleLine(role: OpenRoleWithTarget, roleNumber: number): string {
  const title = escapeLinkText(truncateText(role.title, 92));
  const location = role.location ? ` - ${truncateText(role.location, 60)}` : "";
  return `**#${roleNumber}** [${title}](${role.apply_url})${location}`;
}

function sortRolesForReport(roles: OpenRoleWithTarget[]): OpenRoleWithTarget[] {
  return [...roles].sort((left, right) => {
    const leftContinent = continentForRole(left);
    const rightContinent = continentForRole(right);
    const continentDelta = continentRank(leftContinent) - continentRank(rightContinent);
    if (continentDelta !== 0) return continentDelta;

    const companyDelta = left.company.localeCompare(right.company, undefined, { sensitivity: "base" });
    if (companyDelta !== 0) return companyDelta;

    return left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
  });
}

function groupHeadersForRole(
  role: OpenRoleWithTarget,
  currentContinent: ContinentKey | null,
  currentCompany: string | null
): string[] {
  const continent = continentForRole(role);
  const headers: string[] = [];
  if (continent !== currentContinent) {
    headers.push(`**${continentTitle(continent)}**`);
  }
  if (continent !== currentContinent || role.company !== currentCompany) {
    headers.push(`__${truncateText(role.company, 72)}__`);
  }
  return headers;
}

function continentForRole(role: OpenRoleWithTarget): ContinentKey {
  return continentForLocation(role.location);
}

function continentForLocation(location: string | null): ContinentKey {
  const normalized = ` ${location?.toLowerCase() ?? ""} `;
  if (!normalized.trim()) return "unspecified";

  if (matchesAny(normalized, NORTH_AMERICA_TERMS)) return "north_america";
  if (matchesAny(normalized, EUROPE_TERMS)) return "europe";
  if (matchesAny(normalized, ASIA_TERMS)) return "asia";
  if (matchesAny(normalized, OCEANIA_TERMS)) return "oceania";
  if (matchesAny(normalized, SOUTH_AMERICA_TERMS)) return "south_america";
  if (matchesAny(normalized, AFRICA_TERMS)) return "africa";
  if (matchesAny(normalized, REMOTE_GLOBAL_TERMS)) return "remote_global";
  return "unspecified";
}

function continentTitle(continent: ContinentKey): string {
  return CONTINENT_ORDER.find((item) => item.key === continent)?.title ?? "Unspecified Location";
}

function continentRank(continent: ContinentKey): number {
  const index = CONTINENT_ORDER.findIndex((item) => item.key === continent);
  return index >= 0 ? index : CONTINENT_ORDER.length;
}

function matchesAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function escapeLinkText(value: string): string {
  return value.replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function splitLongLines(lines: string): string[];
function splitLongLines(lines: string[]): string[];
function splitLongLines(lines: string[] | string): string[] {
  const values = Array.isArray(lines) ? lines : [lines];
  return values.map((line) => (line.length > 500 ? `${line.slice(0, 497)}...` : line));
}
