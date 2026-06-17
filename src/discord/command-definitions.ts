import { SlashCommandBuilder } from "discord.js";
import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";
import { CHECK_TYPES } from "../types.js";

export const commandDefinitions: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [
  new SlashCommandBuilder()
    .setName("run")
    .setDescription("Run the open-roles scan and post a report.")
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription("Which roles to include in the posted report.")
        .setRequired(false)
        .addChoices(
          { name: "Focused: low + mid", value: "focused" },
          { name: "Low-level only", value: "low" },
          { name: "Mid-level only", value: "mid" },
          { name: "High-level only", value: "high" },
          { name: "All roles", value: "all" },
        )
    ),
  new SlashCommandBuilder().setName("applications").setDescription("Show active applications."),
  new SlashCommandBuilder()
    .setName("history")
    .setDescription("Show recent closed applications.")
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription("Maximum closed applications to show.")
        .setMinValue(1)
        .setMaxValue(50)
        .setRequired(false)
    ),
  new SlashCommandBuilder().setName("keywords").setDescription("Show and edit include/exclude title keywords."),
  new SlashCommandBuilder()
    .setName("targets")
    .setDescription("List, add, or disable monitored targets.")
    .addSubcommand((subcommand) => subcommand.setName("list").setDescription("List configured targets."))
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Add a monitoring target.")
        .addStringOption((option) => option.setName("name").setDescription("Company or protocol name.").setRequired(true))
        .addStringOption((option) =>
          option
            .setName("check_type")
            .setDescription("How this target should be checked.")
            .setRequired(true)
            .addChoices(...CHECK_TYPES.map((type) => ({ name: type, value: type })))
        )
        .addStringOption((option) =>
          option.setName("board_slug").setDescription("ATS board slug for Greenhouse, Ashby, or Lever.").setRequired(false)
        )
        .addStringOption((option) =>
          option.setName("careers_url").setDescription("Human-readable careers page or manual method URL.").setRequired(false)
        )
        .addStringOption((option) =>
          option.setName("category").setDescription("Optional freeform grouping.").setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("disable")
        .setDescription("Disable a target without deleting it.")
        .addIntegerOption((option) => option.setName("id").setDescription("Target ID.").setMinValue(1).setRequired(true))
    ),
  new SlashCommandBuilder().setName("export").setDescription("Download the current applications CSV export.")
].map((command) => command.toJSON());
