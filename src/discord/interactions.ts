import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonInteraction,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  Interaction,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  type Message,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type MessageActionRowComponentBuilder,
  type MessageCreateOptions,
  type ModalSubmitInteraction
} from "discord.js";
import { config } from "../config.js";
import type { JobTrackerRepository, RoleHideDurationDays } from "../db/repositories.js";
import { buildHiddenReport, buildKeywordsReport, buildTargetsReport } from "../reports/admin-reports.js";
import { buildActiveApplicationsDigest, buildClosedApplicationsHistory, buildFollowUpDigest } from "../reports/applications-report.js";
import { buildOpenRolesReport, type OpenRolesReportMode } from "../reports/open-roles-report.js";
import type { OpenRolesReportView } from "../reports/role-insights.js";
import { buildPrepBundleMarkdown, prepBundleFileName } from "../reports/prep-bundle.js";
import { buildShortlistReport } from "../reports/shortlist-report.js";
import { scanTargets } from "../scraper/scanner.js";
import { isIsoDate, todayIsoDateInTimezone } from "../time.js";
import {
  CHECK_TYPES,
  CLOSED_SUB_STATUSES,
  OUTREACH_STATUSES,
  type ApplicationRow,
  type CheckType,
  type ClosedSubStatus,
  type KeywordKind,
  type OpenRoleWithTarget,
  type OutreachStatus,
  type ShortlistedRoleRow,
  type TargetRow
} from "../types.js";
import { sendMessagesToConfiguredChannel } from "./send.js";

export class InteractionHandler {
  constructor(
    private readonly client: Client,
    private readonly repository: JobTrackerRepository
  ) {}

  async handle(interaction: Interaction): Promise<void> {
    if (interaction.isChatInputCommand()) {
      await this.handleCommand(interaction);
      return;
    }

    if (interaction.isButton()) {
      await this.handleButton(interaction.customId, interaction);
      return;
    }

    if (interaction.isModalSubmit()) {
      await this.handleModal(interaction);
    }
  }

  private async handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    switch (interaction.commandName) {
      case "run":
        await this.handleRunCommand(interaction);
        return;
      case "applications":
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await replyWithMessages(interaction, buildActiveApplicationsDigest(this.repository.listActiveApplications()));
        return;
      case "shortlist":
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await replyWithMessages(
          interaction,
          buildShortlistReport(this.repository.listActiveShortlistedRoles(interaction.options.getInteger("limit") ?? 50))
        );
        return;
      case "application":
        await this.handleApplicationCommand(interaction);
        return;
      case "history":
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await replyWithMessages(
          interaction,
          buildClosedApplicationsHistory(this.repository.listClosedApplications(interaction.options.getInteger("limit") ?? 10))
        );
        return;
      case "keywords":
        await interaction.reply({ ...buildKeywordsReport(this.repository.listKeywords()), flags: MessageFlags.Ephemeral });
        return;
      case "followups":
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await replyWithMessages(
          interaction,
          buildFollowUpDigest(
            this.repository.listDueFollowUpApplications(todayIsoDateInTimezone(config.reportTimezone))
          )
        );
        return;
      case "hidden":
        await this.handleHiddenCommand(interaction);
        return;
      case "targets":
        await this.handleTargetsCommand(interaction);
        return;
      case "export":
        await this.handleExportCommand(interaction);
        return;
    }
  }

  private async handleRunCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const mode = parseOpenRolesReportMode(interaction.options.getString("mode") ?? "focused");
    const view = parseOpenRolesReportView(interaction.options.getString("view") ?? "default");
    const requestedCategory = emptyToNull(interaction.options.getString("category"));
    const category = requestedCategory ?? (view === "melbourne" ? "melbourne-data" : null);
    const summary = await scanTargets(this.repository, category);
    const reportableRoles = this.repository.listReportableOpenRolesWithTargets(category);
    const report = buildOpenRolesReport(summary, reportableRoles, mode, view);
    await sendMessagesToConfiguredChannel(this.client, report.messages);
    const scope = category ? ` for category ${category}` : "";
    const viewLabel = view === "default" ? "" : ` with view ${view}`;
    await interaction.editReply(`Open roles scan${scope}${viewLabel} finished and the ${mode} report was posted to the configured channel.`);
  }

  private async handleApplicationCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "add") {
      await interaction.showModal(buildManualApplicationModal());
    }
  }

  private async handleTargetsCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "list") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await replyWithMessages(interaction, buildTargetsReport(this.repository.listTargetsWithOutreach(true)));
      return;
    }

    if (subcommand === "disable") {
      const id = interaction.options.getInteger("id", true);
      const disabled = this.repository.disableTarget(id);
      await interaction.reply({
        content: disabled ? `Disabled target #${id}.` : `No target found for #${id}.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === "outreach") {
      const targetId = interaction.options.getInteger("id", true);
      const status = parseOutreachStatus(interaction.options.getString("status", true));
      const contactUrl = interaction.options.getString("contact_url");
      const notes = interaction.options.getString("notes");
      const outreach = this.repository.updateTargetOutreach({ targetId, status, contactUrl, notes });
      await interaction.reply({
        content: `Updated outreach for target #${outreach.target_id}: ${outreach.status}.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === "add") {
      const checkType = parseCheckType(interaction.options.getString("check_type", true));
      const name = interaction.options.getString("name", true).trim();
      const boardSlug = emptyToNull(interaction.options.getString("board_slug"));
      const careersUrl = emptyToNull(interaction.options.getString("careers_url"));
      const category = emptyToNull(interaction.options.getString("category"));
      const locationFilter = emptyToNull(interaction.options.getString("location_filter"));

      if (!name) {
        await interaction.reply({ content: "Target name cannot be blank.", flags: MessageFlags.Ephemeral });
        return;
      }

      const validationError = validateTargetInput(checkType, boardSlug, careersUrl);
      if (validationError) {
        await interaction.reply({ content: validationError, flags: MessageFlags.Ephemeral });
        return;
      }

      const target = this.repository.addTarget({ name, checkType, boardSlug, careersUrl, category, locationFilter });
      await interaction.reply({
        content: `Added target #${target.id}: ${target.name} (${target.check_type}).`,
        flags: MessageFlags.Ephemeral
      });
    }
  }

  private async handleHiddenCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "list") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const limit = interaction.options.getInteger("limit") ?? 25;
      await replyWithMessages(
        interaction,
        buildHiddenReport(this.repository.listHiddenRoles(limit), this.repository.listHiddenTargets(limit))
      );
      return;
    }

    if (subcommand === "unhide") {
      const id = interaction.options.getInteger("id", true);
      const role = this.repository.unhideRole(id);
      await interaction.reply({
        content: role
          ? `Unhid #${role.id}: ${role.company} - ${role.role_title}. It can reappear after the next scan if it is still open.`
          : `No hidden role found for #${id}.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === "unhide_target") {
      const id = interaction.options.getInteger("id", true);
      const target = this.repository.unhideTarget(id);
      await interaction.reply({
        content: target
          ? `Unhid manual target #${target.id}: ${target.target_name}. It can reappear in the next report.`
          : `No hidden manual target found for #${id}.`,
        flags: MessageFlags.Ephemeral
      });
    }
  }

  private async handleExportCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    this.repository.regenerateCsv();
    const file = new AttachmentBuilder(config.csvExportPath, { name: "applications.csv" });
    await interaction.editReply({ content: "Current applications CSV export.", files: [file] });
  }

  private async handleButton(customId: string, interaction: ButtonInteraction): Promise<void> {
    const [action, idRaw, kindRaw] = customId.split(":");

    if (action === "apply_menu" || action === "shortlist_menu" || action === "prep_menu" || action === "hide_menu") {
      await this.handleRoleActionButton(action, interaction);
      return;
    }

    if (action === "shortlist_apply_menu" || action === "shortlist_prep_menu" || action === "shortlist_archive_menu") {
      await this.handleShortlistActionButton(action, interaction);
      return;
    }

    if (action === "hide_manual_menu" || action === "check_manual_menu") {
      await this.handleManualTargetActionButton(action, interaction);
      return;
    }

    if (action === "apply") {
      const roleId = parseIntegerId(idRaw);
      const role = this.repository.getOpenRoleWithTarget(roleId);
      if (!role) {
        await interaction.reply({
          content: "That role is no longer in the current open roles snapshot. Run `/run` and verify manually before applying.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const application = this.repository.createApplicationFromOpenRole(
        role,
        todayIsoDateInTimezone(config.reportTimezone)
      );
      await removeAppliedRoleFromSourceMessage(interaction, customId);
      await interaction.reply({
        content: `Tracked application #${application.id}: ${application.company} - ${application.role_title}.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (action === "update") {
      const application = this.repository.getApplication(parseIntegerId(idRaw));
      await interaction.showModal(buildUpdateModal(application.id));
      return;
    }

    if (action === "checklist") {
      const application = this.repository.getApplication(parseIntegerId(idRaw));
      await interaction.showModal(buildChecklistModal(application));
      return;
    }

    if (action === "prep_application") {
      const application = this.repository.getApplication(parseIntegerId(idRaw));
      await replyWithPrepBundle(interaction, [application], "application-prep");
      return;
    }

    if (action === "close") {
      const application = this.repository.getApplication(parseIntegerId(idRaw));
      await interaction.showModal(buildCloseModal(application.id));
      return;
    }

    if (action === "keyword") {
      const operation = idRaw;
      const kind = parseKeywordKind(kindRaw);
      if (operation !== "add" && operation !== "remove") {
        throw new Error(`Unknown keyword operation ${operation}`);
      }
      await interaction.showModal(buildKeywordModal(operation, kind));
    }
  }

  private async handleRoleActionButton(
    action: "apply_menu" | "shortlist_menu" | "prep_menu" | "hide_menu",
    interaction: ButtonInteraction
  ): Promise<void> {
    if (!messageHasRoleLines(interaction.message)) {
      await interaction.reply({
        content: "No current roles from this message are still available.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (action === "apply_menu") {
      await interaction.showModal(buildApplyRoleModal(interaction.channelId, interaction.message.id));
      return;
    }

    if (action === "shortlist_menu") {
      await interaction.showModal(buildShortlistRoleModal(interaction.channelId, interaction.message.id));
      return;
    }

    if (action === "prep_menu") {
      await interaction.showModal(buildPrepRoleModal(interaction.channelId, interaction.message.id));
      return;
    }

    await interaction.showModal(buildHideRoleModal(interaction.channelId, interaction.message.id));
  }

  private async handleShortlistActionButton(
    action: "shortlist_apply_menu" | "shortlist_prep_menu" | "shortlist_archive_menu",
    interaction: ButtonInteraction
  ): Promise<void> {
    if (!messageHasShortlistLines(interaction.message)) {
      await interaction.reply({
        content: "No shortlist items from this message are still available.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.showModal(
      buildShortlistActionModal(
        action === "shortlist_apply_menu" ? "apply" : action === "shortlist_prep_menu" ? "prep" : "archive",
        interaction.channelId,
        interaction.message.id
      )
    );
  }

  private async handleManualTargetActionButton(
    action: "hide_manual_menu" | "check_manual_menu",
    interaction: ButtonInteraction
  ): Promise<void> {
    if (!messageHasManualTargetLines(interaction.message)) {
      await interaction.reply({
        content: "No manual targets from this message are still available.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (action === "check_manual_menu") {
      await interaction.showModal(buildCheckManualTargetModal(interaction.channelId, interaction.message.id));
      return;
    }

    await interaction.showModal(buildHideManualTargetModal(interaction.channelId, interaction.message.id));
  }

  private async handleModal(interaction: ModalSubmitInteraction): Promise<void> {
    const [kind, first, second] = interaction.customId.split(":");

    if (kind === "manual_application_modal") {
      const company = interaction.fields.getTextInputValue("manual_application_company").trim();
      const roleTitle = interaction.fields.getTextInputValue("manual_application_role_title").trim();
      const applyUrl = emptyToNull(interaction.fields.getTextInputValue("manual_application_apply_url"));
      const dateApplied = interaction.fields.getTextInputValue("manual_application_date_applied").trim();
      const notes = emptyToNull(interaction.fields.getTextInputValue("manual_application_notes"));

      if (!company || !roleTitle) {
        await interaction.reply({
          content: "Company and role title are required.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (!isIsoDate(dateApplied)) {
        await interaction.reply({
          content: "Date applied must use YYYY-MM-DD.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const result = this.repository.createManualApplication({ company, roleTitle, applyUrl, dateApplied, notes });
      await interaction.reply({
        content: result.created
          ? `Tracked application #${result.application.id}: ${result.application.company} - ${result.application.role_title}.`
          : `Already tracking active application #${result.application.id}: ${result.application.company} - ${result.application.role_title}.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (kind === "apply_role_modal") {
      const sourceMessage = await fetchMessage(this.client, first, second);
      if (!sourceMessage) {
        await interaction.reply({
          content: "I could not find the original report message. Run `/run` and try again.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const roleNumbers = readRoleNumbers(interaction, "apply_role_number");
      if (!roleNumbers) {
        await interaction.reply({
          content: "Enter role numbers like `1`, `1, 3, 5`, or `1-3`.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const selection = rolesFromMessageByNumbers(sourceMessage, this.repository, roleNumbers);
      if (selection.roles.length === 0) {
        await interaction.reply({
          content: `I could not find any available roles for ${formatRoleNumbers(roleNumbers)} in that report message.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const dateApplied = todayIsoDateInTimezone(config.reportTimezone);
      const applications = selection.roles.map((role) =>
        this.repository.createApplicationFromOpenRole(role, dateApplied)
      );
      await removeRolesFromReportMessage(sourceMessage, selection.roles);
      await interaction.reply({
        content: appliedRolesConfirmation(applications, selection.missingRoleNumbers),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (kind === "shortlist_role_modal") {
      const sourceMessage = await fetchMessage(this.client, first, second);
      if (!sourceMessage) {
        await interaction.reply({
          content: "I could not find the original report message. Run `/run` and try again.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const roleNumbers = readRoleNumbers(interaction, "shortlist_role_number");
      if (!roleNumbers) {
        await interaction.reply({
          content: "Enter role numbers like `1`, `1, 3, 5`, or `1-3`.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const selection = rolesFromMessageByNumbers(sourceMessage, this.repository, roleNumbers);
      if (selection.roles.length === 0) {
        await interaction.reply({
          content: `I could not find any available roles for ${formatRoleNumbers(roleNumbers)} in that report message.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const notes = emptyToNull(interaction.fields.getTextInputValue("shortlist_notes"));
      const shortlistedRoles = selection.roles.map((role) => this.repository.shortlistOpenRole(role, notes));
      await removeRolesFromReportMessage(sourceMessage, selection.roles);
      await interaction.reply({
        content: shortlistedRolesConfirmation(shortlistedRoles, selection.missingRoleNumbers),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (kind === "prep_role_modal") {
      const sourceMessage = await fetchMessage(this.client, first, second);
      if (!sourceMessage) {
        await interaction.reply({
          content: "I could not find the original report message. Run `/run` and try again.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const roleNumbers = readRoleNumbers(interaction, "prep_role_number");
      if (!roleNumbers) {
        await interaction.reply({
          content: "Enter role numbers like `1`, `1, 3, 5`, or `1-3`.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const selection = rolesFromMessageByNumbers(sourceMessage, this.repository, roleNumbers);
      if (selection.roles.length === 0) {
        await interaction.reply({
          content: `I could not find any available roles for ${formatRoleNumbers(roleNumbers)} in that report message.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await replyWithPrepBundle(interaction, selection.roles, "role-prep", selection.missingRoleNumbers);
      return;
    }

    if (kind === "shortlist_apply_modal" || kind === "shortlist_prep_modal" || kind === "shortlist_archive_modal") {
      const sourceMessage = await fetchMessage(this.client, first, second);
      if (!sourceMessage) {
        await interaction.reply({
          content: "I could not find the original shortlist message. Run `/shortlist` and try again.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const shortlistNumbers = readRoleNumbers(interaction, "shortlist_item_number");
      if (!shortlistNumbers) {
        await interaction.reply({
          content: "Enter shortlist numbers like `1`, `1, 3, 5`, or `1-3`.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const selection = shortlistedRolesFromMessageByNumbers(sourceMessage, this.repository, shortlistNumbers);
      if (selection.roles.length === 0) {
        await interaction.reply({
          content: `I could not find any available shortlist items for ${formatRoleNumbers(shortlistNumbers)} in that message.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (kind === "shortlist_apply_modal") {
        const dateApplied = todayIsoDateInTimezone(config.reportTimezone);
        const applications = selection.roles.map((role) =>
          this.repository.createApplicationFromShortlistedRole(role, dateApplied)
        );
        await removeShortlistedRolesFromMessage(sourceMessage, selection.roles);
        await interaction.reply({
          content: appliedRolesConfirmation(applications, selection.missingRoleNumbers),
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (kind === "shortlist_prep_modal") {
        await replyWithPrepBundle(interaction, selection.roles, "shortlist-prep", selection.missingRoleNumbers);
        return;
      }

      for (const role of selection.roles) {
        this.repository.archiveShortlistedRole(role.id);
      }
      await removeShortlistedRolesFromMessage(sourceMessage, selection.roles);
      await interaction.reply({
        content: archivedShortlistedRolesConfirmation(selection.roles, selection.missingRoleNumbers),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (kind === "hide_role_modal") {
      const sourceMessage = await fetchMessage(this.client, first, second);
      if (!sourceMessage) {
        await interaction.reply({
          content: "I could not find the original report message. Run `/run` and try again.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const roleNumbers = readRoleNumbers(interaction, "hide_role_number");
      if (!roleNumbers) {
        await interaction.reply({
          content: "Enter role numbers like `1`, `1, 3, 5`, or `1-3`.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const selection = rolesFromMessageByNumbers(sourceMessage, this.repository, roleNumbers);
      if (selection.roles.length === 0) {
        await interaction.reply({
          content: `I could not find any available roles for ${formatRoleNumbers(roleNumbers)} in that report message.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      let duration: RoleHideDurationDays;
      try {
        duration = parseHideDuration(interaction.fields.getTextInputValue("hide_duration").trim());
      } catch {
        await interaction.reply({
          content: "Hide Duration (Days) must be `7`, `14`, or `30`.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const reason = emptyToNull(interaction.fields.getTextInputValue("hide_reason"));
      const suppressedUntilValues = selection.roles.map((role) => this.repository.hideOpenRole(role, duration, reason));
      await removeRolesFromReportMessage(sourceMessage, selection.roles);
      await interaction.reply({
        content: hiddenRolesConfirmation(
          selection.roles,
          duration,
          suppressedUntilValues[0],
          selection.missingRoleNumbers
        ),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (kind === "hide_manual_modal") {
      const sourceMessage = await fetchMessage(this.client, first, second);
      if (!sourceMessage) {
        await interaction.reply({
          content: "I could not find the original manual-target message. Run `/run` and try again.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const targetNumbers = readRoleNumbers(interaction, "hide_manual_number");
      if (!targetNumbers) {
        await interaction.reply({
          content: "Enter manual target numbers like `1`, `1, 3, 5`, or `1-3`.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const selection = manualTargetsFromMessageByNumbers(sourceMessage, this.repository, targetNumbers);
      if (selection.targets.length === 0) {
        await interaction.reply({
          content: `I could not find any manual targets for ${formatRoleNumbers(targetNumbers)} in that report message.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      let duration: RoleHideDurationDays;
      try {
        duration = parseHideDuration(interaction.fields.getTextInputValue("hide_manual_duration").trim());
      } catch {
        await interaction.reply({
          content: "Hide Duration (Days) must be `7`, `14`, or `30`.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const reason = emptyToNull(interaction.fields.getTextInputValue("hide_manual_reason"));
      const suppressedUntilValues = selection.targets.map((target) => this.repository.hideTarget(target, duration, reason));
      await removeManualTargetsFromReportMessage(sourceMessage, selection.targets);
      await interaction.reply({
        content: hiddenManualTargetsConfirmation(
          selection.targets,
          duration,
          suppressedUntilValues[0],
          selection.missingTargetNumbers
        ),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (kind === "check_manual_modal") {
      const sourceMessage = await fetchMessage(this.client, first, second);
      if (!sourceMessage) {
        await interaction.reply({
          content: "I could not find the original manual-target message. Run `/run` and try again.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const targetNumbers = readRoleNumbers(interaction, "check_manual_number");
      if (!targetNumbers) {
        await interaction.reply({
          content: "Enter manual target numbers like `1`, `1, 3, 5`, or `1-3`.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const selection = manualTargetsFromMessageByNumbers(sourceMessage, this.repository, targetNumbers);
      if (selection.targets.length === 0) {
        await interaction.reply({
          content: `I could not find any manual targets for ${formatRoleNumbers(targetNumbers)} in that report message.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      let status: OutreachStatus;
      try {
        status = parseOutreachStatus(interaction.fields.getTextInputValue("check_manual_status").trim().toLowerCase());
      } catch {
        await interaction.reply({
          content: "Review Status must be `checked`, `researching`, `contacted`, `applied`, or `paused`.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const notes = emptyToNull(interaction.fields.getTextInputValue("check_manual_notes"));
      for (const target of selection.targets) {
        this.repository.updateTargetOutreach({ targetId: target.id, status, notes });
      }
      await removeManualTargetsFromReportMessage(sourceMessage, selection.targets);
      await interaction.reply({
        content: checkedManualTargetsConfirmation(selection.targets, status, selection.missingTargetNumbers),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (kind === "update_modal") {
      const applicationId = parseIntegerId(first);
      const heardBackDate = readOptionalDate(interaction, "update_heard_back", "heard-back date");
      const addInterviewDate = readOptionalDate(interaction, "update_interview", "interview date");
      const notes = emptyToNull(interaction.fields.getTextInputValue("update_notes"));
      const application = this.repository.updateApplication(applicationId, { heardBackDate, addInterviewDate, notes });
      await interaction.reply({
        content: `Updated application #${application.id}.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (kind === "checklist_modal") {
      const applicationId = parseIntegerId(first);
      const followUpDate = readOptionalDate(interaction, "checklist_follow_up", "follow-up date");
      const application = this.repository.updateApplicationChecklist(applicationId, {
        resumeVersion: emptyToNull(interaction.fields.getTextInputValue("checklist_resume")),
        coverLetterVersion: emptyToNull(interaction.fields.getTextInputValue("checklist_cover_letter")),
        referralContact: emptyToNull(interaction.fields.getTextInputValue("checklist_referral")),
        followUpDate,
        notes: emptyToNull(interaction.fields.getTextInputValue("checklist_notes"))
      });
      await interaction.reply({
        content: `Updated checklist for application #${application.id}.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (kind === "close_modal") {
      const applicationId = parseIntegerId(first);
      let subStatus: ClosedSubStatus;
      try {
        subStatus = parseClosedSubStatus(interaction.fields.getTextInputValue("close_status").trim().toLowerCase());
      } catch {
        await interaction.reply({
          content: "Close Status must be `rejected`, `offer`, `withdrawn`, or `ghosted`.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      const decisionDate = interaction.fields.getTextInputValue("close_decision_date").trim();
      if (!isIsoDate(decisionDate)) {
        await interaction.reply({
          content: "Decision date must use YYYY-MM-DD.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      const application = this.repository.closeApplication(applicationId, {
        subStatus,
        decisionDate,
        reason: emptyToNull(interaction.fields.getTextInputValue("close_reason")),
        notes: emptyToNull(interaction.fields.getTextInputValue("close_notes"))
      });
      await interaction.reply({
        content: `Closed application #${application.id} as ${application.sub_status}.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (kind === "keyword_modal") {
      const operation = first;
      const keywordKind = parseKeywordKind(second);
      const term = interaction.fields.getTextInputValue("keyword_term");
      if (operation === "add") {
        this.repository.addKeyword(term, keywordKind);
        await interaction.reply({ content: `Added ${keywordKind} keyword: ${term.trim()}.`, flags: MessageFlags.Ephemeral });
        return;
      }
      if (operation === "remove") {
        const removed = this.repository.removeKeyword(term, keywordKind);
        await interaction.reply({
          content: removed
            ? `Removed ${keywordKind} keyword: ${term.trim()}.`
            : `No ${keywordKind} keyword matched: ${term.trim()}.`,
          flags: MessageFlags.Ephemeral
        });
      }
    }
  }
}

async function replyWithMessages(interaction: ChatInputCommandInteraction, messages: MessageCreateOptions[]): Promise<void> {
  const [first, ...rest] = messages;
  await interaction.editReply(toEditReplyOptions(first ?? { content: "No results." }));
  for (const message of rest) {
    await interaction.followUp({ ...toInteractionReplyOptions(message), flags: MessageFlags.Ephemeral });
  }
}

async function replyWithPrepBundle(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  items: Array<OpenRoleWithTarget | ShortlistedRoleRow | ApplicationRow>,
  filePrefix: string,
  missingNumbers: string[] = []
): Promise<void> {
  const markdown = buildPrepBundleMarkdown(items);
  const file = new AttachmentBuilder(Buffer.from(markdown, "utf8"), { name: prepBundleFileName(filePrefix) });
  const lines = [`Prepared materials bundle for ${items.length} role${items.length === 1 ? "" : "s"}.`];
  if (missingNumbers.length > 0) {
    lines.push(`Skipped unavailable number${missingNumbers.length === 1 ? "" : "s"}: ${formatRoleNumbers(missingNumbers)}.`);
  }
  await interaction.reply({
    content: lines.join("\n"),
    files: [file],
    flags: MessageFlags.Ephemeral
  });
}

function toEditReplyOptions(message: MessageCreateOptions): InteractionEditReplyOptions {
  return {
    content: message.content,
    components: message.components,
    files: message.files,
    embeds: message.embeds,
    allowedMentions: message.allowedMentions
  };
}

function toInteractionReplyOptions(message: MessageCreateOptions): InteractionReplyOptions {
  return {
    content: message.content,
    components: message.components,
    files: message.files,
    embeds: message.embeds,
    allowedMentions: message.allowedMentions
  };
}

function messageHasRoleLines(message: Message): boolean {
  const description = message.embeds[0]?.description ?? "";
  return description.split("\n").some((line) => parseRoleLine(line));
}

function messageHasManualTargetLines(message: Message): boolean {
  const description = message.embeds[0]?.description ?? "";
  return description.split("\n").some((line) => parseManualTargetLine(line));
}

function messageHasShortlistLines(message: Message): boolean {
  const description = message.embeds[0]?.description ?? "";
  return description.split("\n").some((line) => parseShortlistLine(line));
}

function rolesFromMessageByNumbers(
  message: Message,
  repository: JobTrackerRepository,
  roleNumbers: string[]
): { roles: OpenRoleWithTarget[]; missingRoleNumbers: string[] } {
  const description = message.embeds[0]?.description ?? "";
  const applyUrlByNumber = new Map<string, string>();
  for (const line of description.split("\n")) {
    const parsed = parseRoleLine(line);
    if (parsed) {
      applyUrlByNumber.set(parsed.number, parsed.applyUrl);
    }
  }

  const roles: OpenRoleWithTarget[] = [];
  const missingRoleNumbers: string[] = [];
  for (const roleNumber of roleNumbers) {
    const applyUrl = applyUrlByNumber.get(roleNumber);
    const role = applyUrl ? repository.getOpenRoleWithTargetByApplyUrl(applyUrl) : null;
    if (role) {
      roles.push(role);
    } else {
      missingRoleNumbers.push(roleNumber);
    }
  }

  return { roles, missingRoleNumbers };
}

function parseRoleLine(line: string): { number: string; applyUrl: string } | null {
  const match = line.match(/^\*\*#(\d+)\*\* \[[^\]]+\]\((.+?)\)/);
  if (!match) return null;
  return { number: match[1], applyUrl: match[2] };
}

function shortlistedRolesFromMessageByNumbers(
  message: Message,
  repository: JobTrackerRepository,
  shortlistNumbers: string[]
): { roles: ShortlistedRoleRow[]; missingRoleNumbers: string[] } {
  const description = message.embeds[0]?.description ?? "";
  const idByNumber = new Map<string, number>();
  for (const line of description.split("\n")) {
    const parsed = parseShortlistLine(line);
    if (parsed) {
      idByNumber.set(parsed.number, parsed.id);
    }
  }

  const roles: ShortlistedRoleRow[] = [];
  const missingRoleNumbers: string[] = [];
  for (const shortlistNumber of shortlistNumbers) {
    const id = idByNumber.get(shortlistNumber);
    const role = id ? repository.getShortlistedRole(id) : null;
    if (role && role.status === "active") {
      roles.push(role);
    } else {
      missingRoleNumbers.push(shortlistNumber);
    }
  }

  return { roles, missingRoleNumbers };
}

function parseShortlistLine(line: string): { number: string; id: number } | null {
  const match = line.match(/^\*\*#(\d+)\*\* `ID (\d+)` /);
  if (!match) return null;
  return { number: match[1], id: Number.parseInt(match[2], 10) };
}

function manualTargetsFromMessageByNumbers(
  message: Message,
  repository: JobTrackerRepository,
  targetNumbers: string[]
): { targets: TargetRow[]; missingTargetNumbers: string[] } {
  const description = message.embeds[0]?.description ?? "";
  const targetByNumber = new Map<string, { name: string; careersUrl: string }>();
  for (const line of description.split("\n")) {
    const parsed = parseManualTargetLine(line);
    if (parsed) {
      targetByNumber.set(parsed.number, { name: parsed.name, careersUrl: parsed.careersUrl });
    }
  }

  const targets: TargetRow[] = [];
  const missingTargetNumbers: string[] = [];
  for (const targetNumber of targetNumbers) {
    const parsed = targetByNumber.get(targetNumber);
    const target = parsed ? repository.getManualTargetByNameAndCareersUrl(parsed.name, parsed.careersUrl) : null;
    if (target) {
      targets.push(target);
    } else {
      missingTargetNumbers.push(targetNumber);
    }
  }

  return { targets, missingTargetNumbers };
}

function parseManualTargetLine(line: string): { number: string; name: string; careersUrl: string } | null {
  const match = line.match(/^\*\*#(\d+)\*\* \[([^\]]+)\]\((.+?)\)/);
  if (!match) return null;
  return {
    number: match[1],
    name: unescapeLinkText(match[2]),
    careersUrl: match[3]
  };
}

function buildApplyRoleModal(channelId: string, messageId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`apply_role_modal:${channelId}:${messageId}`)
    .setTitle("Apply Role")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("apply_role_number")
          .setLabel("Role Numbers")
          .setPlaceholder("Example: 1, 3, 5-7")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function buildShortlistRoleModal(channelId: string, messageId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`shortlist_role_modal:${channelId}:${messageId}`)
    .setTitle("Shortlist Role")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("shortlist_role_number")
          .setLabel("Role Numbers")
          .setPlaceholder("Example: 1, 3, 5-7")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("shortlist_notes")
          .setLabel("Notes")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
      )
    );
}

function buildPrepRoleModal(channelId: string, messageId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`prep_role_modal:${channelId}:${messageId}`)
    .setTitle("Prep Materials")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("prep_role_number")
          .setLabel("Role Numbers")
          .setPlaceholder("Example: 1, 3, 5-7")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function buildShortlistActionModal(action: "apply" | "prep" | "archive", channelId: string, messageId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`shortlist_${action}_modal:${channelId}:${messageId}`)
    .setTitle(action === "apply" ? "Apply Shortlist" : action === "prep" ? "Prep Shortlist" : "Archive Shortlist")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("shortlist_item_number")
          .setLabel("Shortlist Numbers")
          .setPlaceholder("Example: 1, 3, 5-7")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function buildHideRoleModal(channelId: string, messageId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`hide_role_modal:${channelId}:${messageId}`)
    .setTitle("Hide Role")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("hide_role_number")
          .setLabel("Role Numbers")
          .setPlaceholder("Example: 1, 3, 5-7")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("hide_duration")
          .setLabel("Hide Duration (Days)")
          .setPlaceholder("7, 14, or 30")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("hide_reason")
          .setLabel("Hide Reason")
          .setPlaceholder("too senior, wrong location, not relevant")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
      )
    );
}

function buildHideManualTargetModal(channelId: string, messageId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`hide_manual_modal:${channelId}:${messageId}`)
    .setTitle("Hide Manual Target")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("hide_manual_number")
          .setLabel("Manual Target Numbers")
          .setPlaceholder("Example: 1, 3, 5-7")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("hide_manual_duration")
          .setLabel("Hide Duration (Days)")
          .setPlaceholder("7, 14, or 30")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("hide_manual_reason")
          .setLabel("Hide Reason")
          .setPlaceholder("checked manually, bad link, not relevant")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
      )
    );
}

function buildCheckManualTargetModal(channelId: string, messageId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`check_manual_modal:${channelId}:${messageId}`)
    .setTitle("Mark Manual Target")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("check_manual_number")
          .setLabel("Manual Target Numbers")
          .setPlaceholder("Example: 1, 3, 5-7")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("check_manual_status")
          .setLabel("Review Status")
          .setPlaceholder("checked, researching, contacted, applied, or paused")
          .setStyle(TextInputStyle.Short)
          .setValue("checked")
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("check_manual_notes")
          .setLabel("Notes")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
      )
    );
}

function readRoleNumbers(interaction: ModalSubmitInteraction, field: string): string[] | null {
  return parseRoleNumbers(interaction.fields.getTextInputValue(field));
}

function parseRoleNumbers(value: string): string[] | null {
  const normalized = value.trim().replaceAll("#", "").replace(/\s*-\s*/g, "-");
  if (!normalized) return null;

  const roleNumbers = new Set<number>();
  for (const token of normalized.split(/[\s,;]+/)) {
    if (!token) continue;
    const rangeMatch = token.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = Number.parseInt(rangeMatch[1], 10);
      const end = Number.parseInt(rangeMatch[2], 10);
      if (!isValidRoleNumber(start) || !isValidRoleNumber(end) || end < start || end - start > 24) return null;
      for (let number = start; number <= end; number += 1) {
        roleNumbers.add(number);
      }
    } else if (/^\d+$/.test(token)) {
      const number = Number.parseInt(token, 10);
      if (!isValidRoleNumber(number)) return null;
      roleNumbers.add(number);
    } else {
      return null;
    }

    if (roleNumbers.size > 25) return null;
  }

  return roleNumbers.size > 0 ? [...roleNumbers].map(String) : null;
}

function isValidRoleNumber(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function parseHideDuration(value: string | undefined): RoleHideDurationDays {
  if (value === "7") return 7;
  if (value === "14") return 14;
  if (value === "30") return 30;
  throw new Error(`Invalid hide duration ${value}`);
}

function appliedRolesConfirmation(applications: ApplicationRow[], missingRoleNumbers: string[]): string {
  const lines = [`Tracked ${applications.length} application${applications.length === 1 ? "" : "s"}.`];
  lines.push(...applications.slice(0, 5).map((application) => `- #${application.id}: ${application.company} - ${application.role_title}`));
  if (applications.length > 5) {
    lines.push(`- ...and ${applications.length - 5} more`);
  }
  if (missingRoleNumbers.length > 0) {
    lines.push(`Skipped unavailable role number${missingRoleNumbers.length === 1 ? "" : "s"}: ${formatRoleNumbers(missingRoleNumbers)}.`);
  }
  return lines.join("\n");
}

function shortlistedRolesConfirmation(roles: ShortlistedRoleRow[], missingRoleNumbers: string[]): string {
  const lines = [`Shortlisted ${roles.length} role${roles.length === 1 ? "" : "s"}.`];
  lines.push(...roles.slice(0, 5).map((role) => `- #${role.id}: ${role.company} - ${role.role_title}`));
  if (roles.length > 5) {
    lines.push(`- ...and ${roles.length - 5} more`);
  }
  if (missingRoleNumbers.length > 0) {
    lines.push(`Skipped unavailable role number${missingRoleNumbers.length === 1 ? "" : "s"}: ${formatRoleNumbers(missingRoleNumbers)}.`);
  }
  return lines.join("\n");
}

function archivedShortlistedRolesConfirmation(roles: ShortlistedRoleRow[], missingRoleNumbers: string[]): string {
  const lines = [`Archived ${roles.length} shortlisted role${roles.length === 1 ? "" : "s"}.`];
  lines.push(...roles.slice(0, 5).map((role) => `- #${role.id}: ${role.company} - ${role.role_title}`));
  if (roles.length > 5) {
    lines.push(`- ...and ${roles.length - 5} more`);
  }
  if (missingRoleNumbers.length > 0) {
    lines.push(`Skipped unavailable shortlist number${missingRoleNumbers.length === 1 ? "" : "s"}: ${formatRoleNumbers(missingRoleNumbers)}.`);
  }
  return lines.join("\n");
}

function hiddenRolesConfirmation(
  roles: OpenRoleWithTarget[],
  duration: RoleHideDurationDays,
  suppressedUntil: string,
  missingRoleNumbers: string[]
): string {
  const lines = [`Hidden ${roles.length} role${roles.length === 1 ? "" : "s"}.`];
  lines.push(...roles.slice(0, 5).map((role) => `- ${role.company} - ${role.title}`));
  if (roles.length > 5) {
    lines.push(`- ...and ${roles.length - 5} more`);
  }
  lines.push(`They are hidden until ${suppressedUntil}.`);
  if (missingRoleNumbers.length > 0) {
    lines.push(`Skipped unavailable role number${missingRoleNumbers.length === 1 ? "" : "s"}: ${formatRoleNumbers(missingRoleNumbers)}.`);
  }
  return lines.join("\n");
}

function hiddenManualTargetsConfirmation(
  targets: TargetRow[],
  duration: RoleHideDurationDays,
  suppressedUntil: string,
  missingTargetNumbers: string[]
): string {
  const lines = [`Hidden ${targets.length} manual target${targets.length === 1 ? "" : "s"}.`];
  lines.push(...targets.slice(0, 5).map((target) => `- ${target.name}`));
  if (targets.length > 5) {
    lines.push(`- ...and ${targets.length - 5} more`);
  }
  lines.push(`They are hidden until ${suppressedUntil}.`);
  if (missingTargetNumbers.length > 0) {
    lines.push(`Skipped unavailable manual target number${missingTargetNumbers.length === 1 ? "" : "s"}: ${formatRoleNumbers(missingTargetNumbers)}.`);
  }
  return lines.join("\n");
}

function checkedManualTargetsConfirmation(
  targets: TargetRow[],
  status: OutreachStatus,
  missingTargetNumbers: string[]
): string {
  const lines = [`Marked ${targets.length} manual target${targets.length === 1 ? "" : "s"} as ${status}.`];
  lines.push(...targets.slice(0, 5).map((target) => `- ${target.name}`));
  if (targets.length > 5) {
    lines.push(`- ...and ${targets.length - 5} more`);
  }
  if (status === "checked" || status === "applied" || status === "paused") {
    lines.push("Those manual targets will be skipped in future manual reports until their outreach status changes.");
  }
  if (missingTargetNumbers.length > 0) {
    lines.push(`Skipped unavailable manual target number${missingTargetNumbers.length === 1 ? "" : "s"}: ${formatRoleNumbers(missingTargetNumbers)}.`);
  }
  return lines.join("\n");
}

function formatRoleNumbers(roleNumbers: string[]): string {
  return roleNumbers.map((roleNumber) => `#${roleNumber}`).join(", ");
}

async function fetchMessage(client: Client, channelId: string | undefined, messageId: string | undefined): Promise<Message | null> {
  if (!channelId || !messageId) return null;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return null;
  return channel.messages.fetch(messageId).catch(() => null);
}

async function removeRolesFromReportMessage(message: Message, roles: OpenRoleWithTarget[]): Promise<void> {
  const originalEmbed = message.embeds[0];
  const description = originalEmbed?.description ?? "";
  const applyUrls = new Set(roles.map((role) => role.apply_url));
  const nextDescription = removeRoleLinesByApplyUrl(description, applyUrls);
  const hasRoleLines = nextDescription.split("\n").some((line) => parseRoleLine(line));
  const embeds = originalEmbed
    ? [
        EmbedBuilder.from(originalEmbed).setDescription(
          hasRoleLines ? nextDescription : "All roles in this message are now hidden or tracked."
        )
      ]
    : [];

  await message
    .edit({
      embeds,
      components: hasRoleLines ? message.components : []
    })
    .catch(() => undefined);
}

async function removeManualTargetsFromReportMessage(message: Message, targets: TargetRow[]): Promise<void> {
  const originalEmbed = message.embeds[0];
  const description = originalEmbed?.description ?? "";
  const careersUrls = new Set(targets.map((target) => target.careers_url).filter((value): value is string => Boolean(value)));
  const nextDescription = removeManualTargetLinesByCareersUrl(description, careersUrls);
  const hasManualLines = nextDescription.split("\n").some((line) => parseManualTargetLine(line));
  const embeds = originalEmbed
    ? [
        EmbedBuilder.from(originalEmbed).setDescription(
          hasManualLines ? nextDescription : "All manual targets in this message are now hidden."
        )
      ]
    : [];

  await message
    .edit({
      embeds,
      components: hasManualLines ? message.components : []
    })
    .catch(() => undefined);
}

async function removeShortlistedRolesFromMessage(message: Message, roles: ShortlistedRoleRow[]): Promise<void> {
  const originalEmbed = message.embeds[0];
  const description = originalEmbed?.description ?? "";
  const ids = new Set(roles.map((role) => role.id));
  const nextDescription = removeShortlistLinesById(description, ids);
  const hasShortlistLines = nextDescription.split("\n").some((line) => parseShortlistLine(line));
  const embeds = originalEmbed
    ? [
        EmbedBuilder.from(originalEmbed).setDescription(
          hasShortlistLines ? nextDescription : "All shortlist items in this message are now applied or archived."
        )
      ]
    : [];

  await message
    .edit({
      embeds,
      components: hasShortlistLines ? message.components : []
    })
    .catch(() => undefined);
}

function removeRoleLinesByApplyUrl(description: string, applyUrls: Set<string>): string {
  return description
    .split("\n")
    .filter((line) => {
      const parsed = parseRoleLine(line);
      return !parsed || !applyUrls.has(parsed.applyUrl);
    })
    .join("\n");
}

function removeShortlistLinesById(description: string, ids: Set<number>): string {
  return description
    .split("\n")
    .filter((line) => {
      const parsed = parseShortlistLine(line);
      return !parsed || !ids.has(parsed.id);
    })
    .join("\n");
}

function removeManualTargetLinesByCareersUrl(description: string, careersUrls: Set<string>): string {
  return description
    .split("\n")
    .filter((line) => {
      const parsed = parseManualTargetLine(line);
      return !parsed || !careersUrls.has(parsed.careersUrl);
    })
    .join("\n");
}

async function removeAppliedRoleFromSourceMessage(interaction: ButtonInteraction, customId: string): Promise<void> {
  const actionRows = interaction.message.components as Array<{ components: Array<{ type: number; customId?: string; label?: string }> }>;
  const appliedButton = actionRows
    .flatMap((row) => row.components)
    .find((component) => component.type === 2 && component.customId === customId);
  const roleNumber = appliedButton?.label?.match(/#(\d+)/)?.[1];
  const originalEmbed = interaction.message.embeds[0];

  const embeds = originalEmbed
    ? [
        EmbedBuilder.from(originalEmbed).setDescription(
          removeRoleLine(originalEmbed.description ?? "", roleNumber)
        )
      ]
    : [];

  const components = actionRows
    .map((row) => {
      const buttons = row.components
        .filter((component) => component.type === 2 && component.customId !== customId)
        .map((component) => ButtonBuilder.from(component as never));
      return buttons.length > 0 ? new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...buttons) : null;
    })
    .filter((row): row is ActionRowBuilder<MessageActionRowComponentBuilder> => row !== null);

  await interaction.message.edit({ embeds, components }).catch(() => undefined);
}

function removeRoleLine(description: string, roleNumber: string | undefined): string {
  if (!roleNumber) return description;
  return description
    .split("\n")
    .filter((line) => !line.startsWith(`**#${roleNumber} `) && !line.startsWith(`**#${roleNumber}**`))
    .join("\n");
}

function buildManualApplicationModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId("manual_application_modal")
    .setTitle("Add application")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("manual_application_company")
          .setLabel("Company")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("manual_application_role_title")
          .setLabel("Role title")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("manual_application_apply_url")
          .setLabel("Apply URL")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("manual_application_date_applied")
          .setLabel("Date applied")
          .setPlaceholder("YYYY-MM-DD")
          .setStyle(TextInputStyle.Short)
          .setValue(todayIsoDateInTimezone(config.reportTimezone))
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("manual_application_notes")
          .setLabel("Notes")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
      )
    );
}

function buildUpdateModal(applicationId: number): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`update_modal:${applicationId}`)
    .setTitle(`Update application #${applicationId}`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("update_heard_back")
          .setLabel("Heard-back date")
          .setPlaceholder("YYYY-MM-DD")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("update_interview")
          .setLabel("Add interview date")
          .setPlaceholder("YYYY-MM-DD")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("update_notes")
          .setLabel("Notes")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
      )
    );
}

function buildChecklistModal(application: ApplicationRow): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`checklist_modal:${application.id}`)
    .setTitle(`Checklist #${application.id}`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("checklist_resume")
          .setLabel("Resume Version")
          .setStyle(TextInputStyle.Short)
          .setValue(truncateInputValue(application.resume_version))
          .setRequired(false)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("checklist_cover_letter")
          .setLabel("Cover Letter Used")
          .setStyle(TextInputStyle.Short)
          .setValue(truncateInputValue(application.cover_letter_version))
          .setRequired(false)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("checklist_referral")
          .setLabel("Referral / Contact")
          .setStyle(TextInputStyle.Short)
          .setValue(truncateInputValue(application.referral_contact))
          .setRequired(false)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("checklist_follow_up")
          .setLabel("Follow-Up Date")
          .setPlaceholder("YYYY-MM-DD")
          .setStyle(TextInputStyle.Short)
          .setValue(truncateInputValue(application.follow_up_date))
          .setRequired(false)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("checklist_notes")
          .setLabel("Notes")
          .setStyle(TextInputStyle.Paragraph)
          .setValue(truncateInputValue(application.notes, 1_000))
          .setRequired(false)
      )
    );
}

function buildCloseModal(applicationId: number): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`close_modal:${applicationId}`)
    .setTitle(`Close application #${applicationId}`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("close_status")
          .setLabel("Close Status")
          .setPlaceholder("rejected, offer, withdrawn, or ghosted")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("close_decision_date")
          .setLabel("Decision date")
          .setStyle(TextInputStyle.Short)
          .setValue(todayIsoDateInTimezone(config.reportTimezone))
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("close_reason")
          .setLabel("Reason")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("close_notes")
          .setLabel("Notes")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
      )
    );
}

function buildKeywordModal(operation: "add" | "remove", kind: KeywordKind): ModalBuilder {
  const title = `${operation === "add" ? "Add" : "Remove"} ${kind} keyword`;
  return new ModalBuilder()
    .setCustomId(`keyword_modal:${operation}:${kind}`)
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("keyword_term")
          .setLabel("Keyword term")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function readOptionalDate(interaction: ModalSubmitInteraction, field: string, label: string): string | null {
  const value = interaction.fields.getTextInputValue(field).trim();
  if (!value) return null;
  if (!isIsoDate(value)) {
    throw new Error(`${label} must use YYYY-MM-DD`);
  }
  return value;
}

function parseIntegerId(value: string | undefined): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Invalid ID: ${value}`);
  }
  return id;
}

function parseCheckType(value: string): CheckType {
  if (CHECK_TYPES.includes(value as CheckType)) return value as CheckType;
  throw new Error(`Invalid check_type ${value}`);
}

function parseClosedSubStatus(value: string | undefined): ClosedSubStatus {
  if (CLOSED_SUB_STATUSES.includes(value as ClosedSubStatus)) return value as ClosedSubStatus;
  throw new Error(`Invalid close status ${value}`);
}

function parseKeywordKind(value: string | undefined): KeywordKind {
  if (value === "include" || value === "exclude") return value;
  throw new Error(`Invalid keyword kind ${value}`);
}

function parseOutreachStatus(value: string | undefined): OutreachStatus {
  if (OUTREACH_STATUSES.includes(value as OutreachStatus)) return value as OutreachStatus;
  throw new Error(`Invalid outreach status ${value}`);
}

function parseOpenRolesReportMode(value: string): OpenRolesReportMode {
  if (value === "lower") return "low";
  if (value === "senior") return "high";
  if (value === "focused" || value === "all" || value === "low" || value === "mid" || value === "high") {
    return value;
  }
  throw new Error(`Invalid report mode ${value}`);
}

function parseOpenRolesReportView(value: string): OpenRolesReportView {
  if (value === "default" || value === "best-fit" || value === "melbourne" || value === "risk-fraud" || value === "entry-mid") {
    return value;
  }
  throw new Error(`Invalid report view ${value}`);
}

function validateTargetInput(checkType: CheckType, boardSlug: string | null, careersUrl: string | null): string | null {
  if (
    [
      "ats_greenhouse",
      "ats_ashby",
      "ats_lever",
      "ats_workable",
      "ats_recruitee",
      "ats_smartrecruiters",
      "ats_workday"
    ].includes(checkType) &&
    !boardSlug
  ) {
    return `${checkType} targets require board_slug.`;
  }
  if (checkType === "ats_personio" && !boardSlug && !careersUrl) {
    return "ats_personio targets require board_slug or careers_url.";
  }
  if ((checkType === "html" || checkType === "manual") && !careersUrl) {
    return `${checkType} targets require careers_url.`;
  }
  return null;
}

function emptyToNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function unescapeLinkText(value: string): string {
  return value.replaceAll("\\[", "[").replaceAll("\\]", "]");
}

function truncateInputValue(value: string | null | undefined, maxLength = 100): string {
  const text = value ?? "";
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}
