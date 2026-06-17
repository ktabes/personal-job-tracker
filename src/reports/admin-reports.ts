import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type MessageActionRowComponentBuilder,
  type MessageCreateOptions
} from "discord.js";
import { statusLabel } from "../db/repositories.js";
import type { KeywordRow, TargetRow, TargetWithOutreach } from "../types.js";

const MAX_TARGETS_MESSAGE_LENGTH = 1_850;

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
