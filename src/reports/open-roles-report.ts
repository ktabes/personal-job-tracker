import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type MessageActionRowComponentBuilder,
  type MessageCreateOptions
} from "discord.js";
import type { JobTrackerRepository } from "../db/repositories.js";
import type { OpenRoleWithTarget, TargetScanOutcome } from "../types.js";
import type { ScanSummary } from "../scraper/scanner.js";

const MAX_CONTENT_LENGTH = 1_800;
const MAX_BUTTONS_PER_MESSAGE = 25;

export function buildOpenRolesReport(
  summary: ScanSummary,
  repository: JobTrackerRepository
): MessageCreateOptions[] {
  const roles = repository.listOpenRolesWithTargets();
  const messages: MessageCreateOptions[] = [];
  const groupedRoles = groupByCompany(roles);

  for (const [company, companyRoles] of groupedRoles) {
    messages.push(...buildCompanyRoleMessages(company, companyRoles));
  }

  messages.unshift(buildStatusMessage(summary));
  return messages;
}

function buildCompanyRoleMessages(company: string, roles: OpenRoleWithTarget[]): MessageCreateOptions[] {
  const messages: MessageCreateOptions[] = [];
  let lines = [`**Open Roles Report**`, `**${company}**`];
  let buttons: ButtonBuilder[] = [];

  for (const role of roles) {
    const line = `- [${escapeLinkText(role.title)}](${role.apply_url})${role.location ? ` - ${role.location}` : ""}`;
    const nextLength = [...lines, line].join("\n").length;
    if (nextLength > MAX_CONTENT_LENGTH || buttons.length >= MAX_BUTTONS_PER_MESSAGE) {
      messages.push(toMessage(lines, buttons));
      lines = [`**Open Roles Report**`, `**${company}** continued`];
      buttons = [];
    }

    lines.push(line);
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`apply:${role.id}`)
        .setLabel(truncateButtonLabel(`Applied ✅: ${role.title}`))
        .setStyle(ButtonStyle.Success)
    );
  }

  messages.push(toMessage(lines, buttons));
  return messages;
}

function buildStatusMessage(summary: ScanSummary): MessageCreateOptions {
  const failed = summary.outcomes.filter((outcome) => outcome.status === "failed");
  const manual = summary.outcomes.filter((outcome) => outcome.status === "manual");
  const noMatches = summary.outcomes.filter(
    (outcome) => outcome.status === "ok" && outcome.matchingRoles.length === 0
  );
  const matchCount = summary.outcomes.reduce((sum, outcome) => sum + outcome.matchingRoles.length, 0);

  const lines = [
    "**Open Roles Report**",
    `Checked at: ${summary.checkedAt}`,
    matchCount > 0 ? `Matching roles found: ${matchCount}` : "No matching auto-check roles found."
  ];

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

  return { content: splitLongLines(lines).join("\n") };
}

function groupByCompany(roles: OpenRoleWithTarget[]): Map<string, OpenRoleWithTarget[]> {
  const grouped = new Map<string, OpenRoleWithTarget[]>();
  for (const role of roles) {
    const existing = grouped.get(role.company) ?? [];
    existing.push(role);
    grouped.set(role.company, existing);
  }
  return grouped;
}

function toMessage(lines: string[], buttons: ButtonBuilder[]): MessageCreateOptions {
  return {
    content: lines.join("\n"),
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

function truncateButtonLabel(label: string): string {
  return label.length > 80 ? `${label.slice(0, 77)}...` : label;
}

function escapeLinkText(value: string): string {
  return value.replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function splitLongLines(lines: string): string[];
function splitLongLines(lines: string[]): string[];
function splitLongLines(lines: string[] | string): string[] {
  const values = Array.isArray(lines) ? lines : [lines];
  return values.map((line) => (line.length > 500 ? `${line.slice(0, 497)}...` : line));
}
