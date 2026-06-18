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
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type MessageActionRowComponentBuilder,
  type MessageCreateOptions,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction
} from "discord.js";
import { config } from "../config.js";
import type { JobTrackerRepository, RoleHideDurationDays } from "../db/repositories.js";
import { buildKeywordsReport, buildTargetsReport } from "../reports/admin-reports.js";
import { buildActiveApplicationsDigest, buildClosedApplicationsHistory } from "../reports/applications-report.js";
import { buildOpenRolesReport, type OpenRolesReportMode } from "../reports/open-roles-report.js";
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
  type OutreachStatus
} from "../types.js";
import { sendMessagesToConfiguredChannel } from "./send.js";

interface PendingHideSelection {
  missingRoleNumbers: string[];
  roles: OpenRoleWithTarget[];
  expiresAt: number;
}

export class InteractionHandler {
  private readonly pendingHideSelections = new Map<string, PendingHideSelection>();

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

    if (interaction.isStringSelectMenu()) {
      await this.handleStringSelect(interaction);
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
    const category = emptyToNull(interaction.options.getString("category"));
    const summary = await scanTargets(this.repository, category);
    const reportableRoles = this.repository.listReportableOpenRolesWithTargets(category);
    const report = buildOpenRolesReport(summary, reportableRoles, mode);
    await sendMessagesToConfiguredChannel(this.client, report.messages);
    const scope = category ? ` for category ${category}` : "";
    await interaction.editReply(`Open roles scan${scope} finished and the ${mode} report was posted to the configured channel.`);
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

  private async handleExportCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    this.repository.regenerateCsv();
    const file = new AttachmentBuilder(config.csvExportPath, { name: "applications.csv" });
    await interaction.editReply({ content: "Current applications CSV export.", files: [file] });
  }

  private async handleButton(customId: string, interaction: ButtonInteraction): Promise<void> {
    const [action, idRaw, kindRaw] = customId.split(":");

    if (action === "apply_menu" || action === "hide_menu") {
      await this.handleRoleActionButton(action, interaction);
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

    if (action === "close") {
      const applicationId = parseIntegerId(idRaw);
      await interaction.reply({
        content: `Choose a close status for application #${applicationId}.`,
        components: [buildCloseStatusSelect(applicationId)],
        flags: MessageFlags.Ephemeral
      });
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

  private async handleRoleActionButton(action: "apply_menu" | "hide_menu", interaction: ButtonInteraction): Promise<void> {
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

    await interaction.showModal(buildHideRoleModal(interaction.channelId, interaction.message.id));
  }

  private async handleStringSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [action, idRaw] = interaction.customId.split(":");

    if (action === "hide_duration") {
      const pending = this.pendingHideSelections.get(idRaw);
      this.pendingHideSelections.delete(idRaw);
      if (!pending || pending.expiresAt < Date.now()) {
        await interaction.update({
          content: "That hide selection expired. Click `Hide` and try again.",
          components: []
        });
        return;
      }

      const duration = parseHideDuration(interaction.values[0]);
      const suppressedUntilValues = pending.roles.map((role) => this.repository.hideOpenRole(role, duration));
      await interaction.update({
        content: hiddenRolesConfirmation(
          pending.roles,
          duration,
          suppressedUntilValues[0],
          pending.missingRoleNumbers
        ),
        components: []
      });
      return;
    }

    if (action !== "close_status") return;

    const applicationId = parseIntegerId(idRaw);
    const subStatus = parseClosedSubStatus(interaction.values[0]);
    await interaction.showModal(buildCloseModal(applicationId, subStatus));
  }

  private async handleModal(interaction: ModalSubmitInteraction): Promise<void> {
    const [kind, first, second, third] = interaction.customId.split(":");

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

      await removeRolesFromReportMessage(sourceMessage, selection.roles);
      const token = this.storePendingHideSelection(selection.roles, selection.missingRoleNumbers);
      await interaction.reply({
        content: `Choose Hide Duration for ${formatRoleNumbers(roleNumbers)}.`,
        components: [buildHideDurationSelect(token)],
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

    if (kind === "close_modal") {
      const applicationId = parseIntegerId(first);
      const subStatus = parseClosedSubStatus(second);
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

  private storePendingHideSelection(roles: OpenRoleWithTarget[], missingRoleNumbers: string[]): string {
    this.deleteExpiredPendingHideSelections();
    const token = createInteractionToken();
    this.pendingHideSelections.set(token, {
      missingRoleNumbers,
      roles,
      expiresAt: Date.now() + 10 * 60 * 1000
    });
    return token;
  }

  private deleteExpiredPendingHideSelections(): void {
    const now = Date.now();
    for (const [token, selection] of this.pendingHideSelections) {
      if (selection.expiresAt < now) {
        this.pendingHideSelections.delete(token);
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
      )
    );
}

function buildHideDurationSelect(token: string): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`hide_duration:${token}`)
      .setPlaceholder("Hide Duration")
      .addOptions(
        { label: "7 Days", value: "7" },
        { label: "14 Days", value: "14" },
        { label: "30 Days", value: "30" }
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

function formatRoleNumbers(roleNumbers: string[]): string {
  return roleNumbers.map((roleNumber) => `#${roleNumber}`).join(", ");
}

function createInteractionToken(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
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

function removeRoleLinesByApplyUrl(description: string, applyUrls: Set<string>): string {
  return description
    .split("\n")
    .filter((line) => {
      const parsed = parseRoleLine(line);
      return !parsed || !applyUrls.has(parsed.applyUrl);
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

function buildCloseStatusSelect(applicationId: number): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`close_status:${applicationId}`)
      .setPlaceholder("Closed sub-status")
      .addOptions(
        { label: "Rejected", value: "rejected" },
        { label: "Offer", value: "offer" },
        { label: "Withdrawn", value: "withdrawn" },
        { label: "Ghosted", value: "ghosted" }
      )
  );
}

function buildCloseModal(applicationId: number, subStatus: ClosedSubStatus): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`close_modal:${applicationId}:${subStatus}`)
    .setTitle(`Close application #${applicationId}`)
    .addComponents(
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

function validateTargetInput(checkType: CheckType, boardSlug: string | null, careersUrl: string | null): string | null {
  if (
    [
      "ats_greenhouse",
      "ats_ashby",
      "ats_lever",
      "ats_workable",
      "ats_recruitee",
      "ats_smartrecruiters"
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
