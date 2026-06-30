import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type MessageActionRowComponentBuilder,
  type MessageCreateOptions
} from "discord.js";
import { config } from "../config.js";
import { todayIsoDateInTimezone } from "../time.js";
import type { ApplicationRow } from "../types.js";

const APPLICATIONS_PER_MESSAGE = 5;

export function buildActiveApplicationsDigest(applications: ApplicationRow[]): MessageCreateOptions[] {
  if (applications.length === 0) {
    return [{ content: "**Active Applications Digest**\nNo active applications." }];
  }

  const messages: MessageCreateOptions[] = [];
  for (let index = 0; index < applications.length; index += APPLICATIONS_PER_MESSAGE) {
    const chunk = applications.slice(index, index + APPLICATIONS_PER_MESSAGE);
    const lines = [
      index === 0 ? "**Active Applications Digest**" : "**Active Applications Digest** continued",
      ...chunk.map(formatActiveApplication)
    ];
    const rows = chunk.map((application) =>
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`update:${application.id}`)
          .setLabel(`Update #${application.id}`)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`checklist:${application.id}`)
          .setLabel(`Checklist #${application.id}`)
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`prep_application:${application.id}`)
          .setLabel(`Prep #${application.id}`)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`close:${application.id}`)
          .setLabel(`Close #${application.id}`)
          .setStyle(ButtonStyle.Secondary)
      )
    );
    messages.push({ content: lines.join("\n\n"), components: rows });
  }

  return messages;
}

export function buildFollowUpDigest(applications: ApplicationRow[]): MessageCreateOptions[] {
  if (applications.length === 0) {
    return [{ content: "**Follow-Ups Due**\nNo follow-ups are due." }];
  }

  const lines = ["**Follow-Ups Due**", ...applications.map(formatActiveApplication)];
  const messages: MessageCreateOptions[] = [];
  let current: string[] = [];

  for (const line of lines) {
    const next = [...current, line].join("\n\n");
    if (next.length > 1_800 && current.length > 0) {
      messages.push({ content: current.join("\n\n") });
      current = [line];
    } else {
      current.push(line);
    }
  }

  if (current.length > 0) {
    messages.push({ content: current.join("\n\n") });
  }

  return messages;
}

export function buildClosedApplicationsHistory(applications: ApplicationRow[]): MessageCreateOptions[] {
  if (applications.length === 0) {
    return [{ content: "**Closed Application History**\nNo closed applications." }];
  }

  const lines = ["**Closed Application History**", ...applications.map(formatClosedApplication)];
  const messages: MessageCreateOptions[] = [];
  let current: string[] = [];

  for (const line of lines) {
    const next = [...current, line].join("\n\n");
    if (next.length > 1_800 && current.length > 0) {
      messages.push({ content: current.join("\n\n") });
      current = [line];
    } else {
      current.push(line);
    }
  }

  if (current.length > 0) {
    messages.push({ content: current.join("\n\n") });
  }

  return messages;
}

function formatActiveApplication(application: ApplicationRow): string {
  const heardBack = application.heard_back_date ? `Heard back ${application.heard_back_date}` : "No response yet";
  const interviews = parseInterviewDates(application.interview_dates);
  const interviewText = interviews.length > 0 ? interviews.join(", ") : "None logged";
  const resume = application.resume_version ? `Resume ${application.resume_version}` : "Resume not logged";
  const coverLetter = application.cover_letter_version ? `cover letter ${application.cover_letter_version}` : "cover letter not logged";
  const referral = application.referral_contact ?? "None logged";
  const followUp = formatFollowUp(application.follow_up_date);
  const lines = [
    `#${application.id} **${application.company}** - ${application.role_title}`,
    `- Applied: ${application.date_applied}`,
    `- Status: ${heardBack}`,
    `- Interviews: ${interviewText}`,
    `- Materials: ${resume} / ${coverLetter}`,
    `- Contact: ${referral}`,
    `- Follow-up: ${followUp}`
  ];
  if (application.apply_url) {
    lines.push(`- Link: ${suppressLinkPreview(application.apply_url)}`);
  }
  return lines.join("\n");
}

function formatClosedApplication(application: ApplicationRow): string {
  const decision = application.decision_date ? `closed ${application.decision_date}` : "closed";
  const subStatus = application.sub_status ?? "closed";
  const lines = [
    `#${application.id} **${application.company}** - ${application.role_title}`,
    `- Applied: ${application.date_applied}`,
    `- Decision: ${decision}`,
    `- Outcome: ${subStatus}`
  ];
  if (application.reason) {
    lines.push(`- Reason: ${application.reason}`);
  }
  if (application.apply_url) {
    lines.push(`- Link: ${suppressLinkPreview(application.apply_url)}`);
  }
  return lines.join("\n");
}

function suppressLinkPreview(url: string): string {
  return `<${url}>`;
}

function formatFollowUp(followUpDate: string | null): string {
  if (!followUpDate) return "Not set";
  const today = todayIsoDateInTimezone(config.reportTimezone);
  return followUpDate <= today ? `Due ${followUpDate}` : followUpDate;
}

function parseInterviewDates(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}
