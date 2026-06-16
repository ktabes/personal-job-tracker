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

export function buildOpenRolesReport(
  summary: ScanSummary,
  repository: JobTrackerRepository
): MessageCreateOptions[] {
  const roles = repository.listOpenRolesWithTargets();
  return [buildStatusMessage(summary), ...buildRoleMessages(roles)];
}

function buildRoleMessages(roles: OpenRoleWithTarget[]): MessageCreateOptions[] {
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
      messages.push(toRoleMessage(lines, buttons, messages.length + 1));
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
    messages.push(toRoleMessage(lines, buttons, messages.length + 1));
  }

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

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Open Roles Report")
        .setDescription(splitLongLines(lines).join("\n"))
        .setColor(REPORT_COLOR)
    ]
  };
}

function toRoleMessage(lines: string[], buttons: ButtonBuilder[], page: number): MessageCreateOptions {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`Open Roles - Page ${page}`)
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
