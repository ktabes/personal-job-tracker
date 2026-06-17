import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type MessageActionRowComponentBuilder,
  type MessageCreateOptions
} from "discord.js";
import type { JobTrackerRepository } from "../db/repositories.js";
import type { OpenRoleWithTarget } from "../types.js";
import type { ScanSummary } from "../scraper/scanner.js";

const MAX_EMBED_DESCRIPTION_LENGTH = 3_800;
const MAX_BUTTONS_PER_MESSAGE = 25;
const REPORT_COLOR = 0x2f80ed;

type RoleBucket = "low" | "mid" | "high";
export type OpenRolesReportMode = "focused" | "all" | "low" | "mid" | "high";

const ROLE_BUCKETS: Array<{ key: RoleBucket; title: string }> = [
  { key: "low", title: "Low-Level" },
  { key: "mid", title: "Mid-Level" },
  { key: "high", title: "High-Level" }
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

export function buildOpenRolesReport(
  summary: ScanSummary,
  repository: JobTrackerRepository,
  mode: OpenRolesReportMode = "focused"
): MessageCreateOptions[] {
  const roles = repository.listOpenRolesWithTargets();
  return [buildStatusMessage(summary, roles, mode), ...buildRoleMessages(roles, mode)];
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
  let lines: string[] = [];
  let buttons: ButtonBuilder[] = [];

  for (const role of roles) {
    const roleNumber = buttons.length + 1;
    const line = formatRoleLine(role, roleNumber);
    const nextDescriptionLength = [...lines, line].join("\n").length;
    if (
      lines.length > 0 &&
      (nextDescriptionLength > MAX_EMBED_DESCRIPTION_LENGTH || buttons.length >= MAX_BUTTONS_PER_MESSAGE)
    ) {
      messages.push(toRoleMessage(bucketTitle, lines, buttons, messages.length + 1));
      lines = [];
      buttons = [];
    }

    const nextRoleNumber = buttons.length + 1;
    lines.push(formatRoleLine(role, nextRoleNumber));
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`apply:${role.id}`)
        .setLabel(`Apply #${nextRoleNumber} ✅`)
        .setStyle(ButtonStyle.Success)
    );
  }

  if (lines.length > 0) {
    messages.push(toRoleMessage(bucketTitle, lines, buttons, messages.length + 1));
  }

  return messages;
}

function buildStatusMessage(
  summary: ScanSummary,
  roles: OpenRoleWithTarget[],
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
    matchCount > 0 ? `Matching roles found: ${matchCount}` : "No matching auto-check roles found.",
    `Low-level: ${bucketCounts.low}`,
    `Mid-level: ${bucketCounts.mid}`,
    `High-level: ${bucketCounts.high}`,
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
  buttons: ButtonBuilder[],
  page: number
): MessageCreateOptions {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`${bucketTitle} - Page ${page}`)
        .setDescription(lines.join("\n"))
        .setFooter({ text: "Click the matching Apply button below to track an application." })
        .setColor(REPORT_COLOR)
    ],
    components: chunk(buttons, 5).map((buttonRow) =>
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...buttonRow)
    )
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
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
  const company = truncateText(role.company, 42);
  const title = escapeLinkText(truncateText(role.title, 92));
  const location = role.location ? ` - ${truncateText(role.location, 60)}` : "";
  return `**#${roleNumber} ${company}** - [${title}](${role.apply_url})${location}`;
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
