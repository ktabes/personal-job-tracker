import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type MessageActionRowComponentBuilder,
  type MessageCreateOptions
} from "discord.js";
import { statusLabel } from "../db/repositories.js";
import type { HiddenRoleRow, HiddenTargetRow, KeywordRow, TargetRow, TargetWithOutreach } from "../types.js";

const MAX_TARGETS_MESSAGE_LENGTH = 1_850;
const MAX_HIDDEN_ROLES_MESSAGE_LENGTH = 1_850;

export function buildKeywordsReport(keywords: KeywordRow[]): MessageCreateOptions {
  const include = keywords.filter((keyword) => keyword.kind === "include").map((keyword) => keyword.term);
  const exclude = keywords.filter((keyword) => keyword.kind === "exclude").map((keyword) => keyword.term);
  const content = [
    "**Keywords**",
    `Include: ${include.length > 0 ? include.join(", ") : "none"}`,
    `Exclude: ${exclude.length > 0 ? exclude.join(", ") : "none"}`
  ].join("\n");

  return {
    content,
    components: [
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder().setCustomId("keyword:add:include").setLabel("Add include").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("keyword:add:exclude").setLabel("Add exclude").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("keyword:remove:include").setLabel("Remove include").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("keyword:remove:exclude").setLabel("Remove exclude").setStyle(ButtonStyle.Secondary)
      )
    ]
  };
}

type TargetReportRow = TargetRow | TargetWithOutreach;

export function buildTargetsReport(targets: TargetReportRow[]): MessageCreateOptions[] {
  if (targets.length === 0) {
    return [{ content: "**Targets**\nNo targets are configured yet." }];
  }

  const pages: MessageCreateOptions[] = [];
  let lines = ["**Targets**"];

  for (const target of targets) {
    const active = target.active === 1 ? "active" : "disabled";
    const category = target.category ? `; category: ${target.category}` : "";
    const locationFilter = target.location_filter ? `; location: ${target.location_filter}` : "";
    const slug = target.board_slug ? `; slug: ${target.board_slug}` : "";
    const link = target.careers_url ? `; ${target.careers_url}` : "";
    const outreach = "outreach_status" in target && target.outreach_status ? `; outreach: ${target.outreach_status}` : "";
    const line = `#${target.id} **${target.name}** - ${target.check_type}; ${active}; status: ${statusLabel(target.last_check_status)}${category}${locationFilter}${outreach}${slug}${link}`;
    const nextContent = [...lines, line].join("\n");
    if (lines.length > 1 && nextContent.length > MAX_TARGETS_MESSAGE_LENGTH) {
      pages.push({ content: lines.join("\n") });
      lines = ["**Targets**"];
    }
    lines.push(line);
  }

  if (lines.length > 1) {
    pages.push({ content: lines.join("\n") });
  }

  return pages;
}

export function buildHiddenRolesReport(roles: HiddenRoleRow[]): MessageCreateOptions[] {
  if (roles.length === 0) {
    return [{ content: "**Hidden Roles**\nNo active hidden roles." }];
  }

  const pages: MessageCreateOptions[] = [];
  let lines = ["**Hidden Roles**"];

  for (const role of roles) {
    const until = role.suppressed_until ? `hidden until ${role.suppressed_until}` : "hidden forever";
    const link = role.apply_url ? ` - ${role.apply_url}` : "";
    const line = `#${role.id} **${role.company}** - ${role.role_title}; ${until}${link}`;
    const nextContent = [...lines, line].join("\n");
    if (lines.length > 1 && nextContent.length > MAX_HIDDEN_ROLES_MESSAGE_LENGTH) {
      pages.push({ content: lines.join("\n") });
      lines = ["**Hidden Roles**"];
    }
    lines.push(line);
  }

  if (lines.length > 1) {
    pages.push({ content: lines.join("\n") });
  }

  return pages;
}

export function buildHiddenReport(roles: HiddenRoleRow[], targets: HiddenTargetRow[]): MessageCreateOptions[] {
  if (roles.length === 0 && targets.length === 0) {
    return [{ content: "**Hidden Items**\nNo active hidden roles or manual targets." }];
  }

  const pages: MessageCreateOptions[] = [];
  let lines = ["**Hidden Items**"];

  if (roles.length > 0) {
    lines.push("", "__Roles__");
    for (const role of roles) {
      const until = role.suppressed_until ? `hidden until ${role.suppressed_until}` : "hidden forever";
      const link = role.apply_url ? ` - ${role.apply_url}` : "";
      const line = `Role #${role.id} **${role.company}** - ${role.role_title}; ${until}${link}`;
      const nextContent = [...lines, line].join("\n");
      if (lines.length > 1 && nextContent.length > MAX_HIDDEN_ROLES_MESSAGE_LENGTH) {
        pages.push({ content: lines.join("\n") });
        lines = ["**Hidden Items**", "__Roles__"];
      }
      lines.push(line);
    }
  }

  if (targets.length > 0) {
    lines.push("", "__Manual Targets__");
    for (const target of targets) {
      const until = target.suppressed_until ? `hidden until ${target.suppressed_until}` : "hidden forever";
      const link = target.careers_url ? ` - ${target.careers_url}` : "";
      const line = `Target #${target.id} **${target.target_name}**; ${until}${link}`;
      const nextContent = [...lines, line].join("\n");
      if (lines.length > 1 && nextContent.length > MAX_HIDDEN_ROLES_MESSAGE_LENGTH) {
        pages.push({ content: lines.join("\n") });
        lines = ["**Hidden Items**", "__Manual Targets__"];
      }
      lines.push(line);
    }
  }

  if (lines.length > 1) {
    pages.push({ content: lines.join("\n") });
  }

  return pages;
}
