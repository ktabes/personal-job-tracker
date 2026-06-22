import { SlashCommandBuilder } from "discord.js";
import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";
import { CHECK_TYPES, OUTREACH_STATUSES } from "../types.js";

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
    )
    .addStringOption((option) =>
      option
        .setName("category")
        .setDescription("Optional category to scan, such as crypto-data or data-platforms.")
        .setRequired(false)
    ),
  new SlashCommandBuilder().setName("applications").setDescription("Show active applications."),
  new SlashCommandBuilder()
    .setName("application")
    .setDescription("Add an application that was found outside the scan.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Manually add an active application.")
    ),
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
    .setName("hidden")
    .setDescription("List or unhide suppressed roles.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("List active hidden roles.")
        .addIntegerOption((option) =>
          option
            .setName("limit")
            .setDescription("Maximum hidden roles to show.")
            .setMinValue(1)
            .setMaxValue(100)
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("unhide")
        .setDescription("Unhide a role by hidden-role ID.")
        .addIntegerOption((option) =>
          option.setName("id").setDescription("Hidden role ID from /hidden list.").setMinValue(1).setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("unhide_target")
        .setDescription("Unhide a manual target by hidden-target ID.")
        .addIntegerOption((option) =>
          option.setName("id").setDescription("Hidden target ID from /hidden list.").setMinValue(1).setRequired(true)
        )
    ),
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
          option.setName("board_slug").setDescription("Provider identifier such as a Greenhouse/Ashby/Lever slug.").setRequired(false)
        )
        .addStringOption((option) =>
          option.setName("careers_url").setDescription("Human-readable careers page or manual method URL.").setRequired(false)
        )
        .addStringOption((option) =>
          option.setName("category").setDescription("Optional freeform grouping.").setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName("location_filter")
            .setDescription("Optional comma-separated location terms, such as Melbourne, Victoria.")
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("disable")
        .setDescription("Disable a target without deleting it.")
        .addIntegerOption((option) => option.setName("id").setDescription("Target ID.").setMinValue(1).setRequired(true))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("outreach")
        .setDescription("Update manual/outreach status for a target.")
        .addIntegerOption((option) => option.setName("id").setDescription("Target ID.").setMinValue(1).setRequired(true))
        .addStringOption((option) =>
          option
            .setName("status")
            .setDescription("Current outreach status.")
            .setRequired(true)
            .addChoices(...OUTREACH_STATUSES.map((status) => ({ name: status, value: status })))
        )
        .addStringOption((option) =>
          option.setName("contact_url").setDescription("Optional contact, referral, or application URL.").setRequired(false)
        )
        .addStringOption((option) =>
          option.setName("notes").setDescription("Optional short outreach note.").setRequired(false)
        )
    ),
  new SlashCommandBuilder().setName("export").setDescription("Download the current applications CSV export.")
].map((command) => command.toJSON());
