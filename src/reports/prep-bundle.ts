import type { ApplicationRow, OpenRoleWithTarget, ShortlistedRoleRow } from "../types.js";

type PrepSource = OpenRoleWithTarget | ShortlistedRoleRow | ApplicationRow;

export function buildPrepBundleMarkdown(items: PrepSource[]): string {
  const sections = [
    "# Application Prep Bundle",
    "",
    "Use this bundle with your baseline CV. Do not invent experience; only reorder, trim, and rephrase existing experience to match the job.",
    "",
    ...items.flatMap((item, index) => formatPrepItem(item, index + 1)),
    "## CV Tailoring Prompt",
    "",
    "Using my baseline CV and the job description above, suggest targeted CV changes. Keep all claims truthful. Prefer bullet edits, section ordering, keyword alignment, and concise wording. Return: (1) summary of fit, (2) exact CV edits, (3) risks or gaps I should not overclaim.",
    "",
    "## Cover Letter Prompt",
    "",
    "Write a concise cover letter for this role using only my real background and the job description above. Keep it specific to the company and role, avoid generic enthusiasm, and do not invent metrics, credentials, or experience.",
    ""
  ];

  return `${sections.join("\n")}\n`;
}

export function prepBundleFileName(prefix = "application-prep"): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${prefix}-${timestamp}.md`;
}

function formatPrepItem(item: PrepSource, index: number): string[] {
  const company = "company" in item ? item.company : "";
  const roleTitle = "role_title" in item ? item.role_title : item.title;
  const applyUrl = "apply_url" in item ? item.apply_url : null;
  const location = "location" in item ? item.location : null;
  const notes = "notes" in item ? item.notes : null;
  const description = item.job_description?.trim();

  return [
    `## ${index}. ${company} - ${roleTitle}`,
    "",
    `- Company: ${company}`,
    `- Role: ${roleTitle}`,
    `- Location: ${location ?? "not captured"}`,
    `- Apply URL: ${applyUrl ?? "not captured"}`,
    notes ? `- Notes: ${notes}` : "- Notes: none",
    "",
    "### Captured Job Description",
    "",
    description || "No job description was captured for this role. Open the apply URL and paste the description manually before using the prompts.",
    ""
  ];
}
