import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type MessageActionRowComponentBuilder,
  type MessageCreateOptions
} from "discord.js";
import type { ShortlistedRoleRow } from "../types.js";

const SHORTLIST_PER_MESSAGE = 25;
const REPORT_COLOR = 0x8e7cc3;

export function buildShortlistReport(roles: ShortlistedRoleRow[]): MessageCreateOptions[] {
  if (roles.length === 0) {
    return [{ content: "**Shortlist**\nNo active shortlisted roles." }];
  }

  const messages: MessageCreateOptions[] = [];
  for (let index = 0; index < roles.length; index += SHORTLIST_PER_MESSAGE) {
    const chunk = roles.slice(index, index + SHORTLIST_PER_MESSAGE);
    const lines = chunk.map((role, offset) => formatShortlistedRoleLine(role, offset + 1));
    messages.push({
      embeds: [
        new EmbedBuilder()
          .setTitle(`Shortlist - Page ${messages.length + 1}`)
          .setDescription(lines.join("\n"))
          .setFooter({ text: "Use Apply or Archive, then fill out the popup fields." })
          .setColor(REPORT_COLOR)
      ],
      components: [
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("shortlist_apply_menu")
            .setLabel("Apply")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId("shortlist_prep_menu")
            .setLabel("Prep")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId("shortlist_archive_menu")
            .setLabel("Archive")
            .setStyle(ButtonStyle.Secondary)
        )
      ]
    });
  }

  return messages;
}

function formatShortlistedRoleLine(role: ShortlistedRoleRow, number: number): string {
  const title = escapeLinkText(truncateText(`${role.company} - ${role.role_title}`, 120));
  const location = role.location ? ` - ${truncateText(role.location, 60)}` : "";
  const notes = role.notes ? ` - note: ${truncateText(role.notes, 80)}` : "";
  return `**#${number}** \`ID ${role.id}\` [${title}](${role.apply_url})${location}${notes}`;
}

function escapeLinkText(value: string): string {
  return value.replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}
