import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type MessageActionRowComponentBuilder,
  type MessageCreateOptions
} from "discord.js";
import { statusLabel } from "../db/repositories.js";
import type { KeywordRow, TargetRow } from "../types.js";

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

export function buildTargetsReport(targets: TargetRow[]): MessageCreateOptions {
  if (targets.length === 0) {
    return { content: "**Targets**\nNo targets are configured yet." };
  }

  const lines = [
    "**Targets**",
    ...targets.map((target) => {
      const active = target.active === 1 ? "active" : "disabled";
      const slug = target.board_slug ? `; slug: ${target.board_slug}` : "";
      const link = target.careers_url ? `; ${target.careers_url}` : "";
      return `#${target.id} **${target.name}** - ${target.check_type}; ${active}; status: ${statusLabel(target.last_check_status)}${slug}${link}`;
    })
  ];

  return { content: lines.join("\n") };
}
