import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import type { ApplicationRow } from "../types.js";

const CSV_COLUMNS = [
  "company",
  "role_title",
  "apply_url",
  "date_applied",
  "status",
  "sub_status",
  "heard_back_date",
  "interview_dates",
  "decision_date",
  "reason",
  "notes",
  "resume_version",
  "cover_letter_version",
  "referral_contact",
  "follow_up_date"
] as const;

export function writeApplicationsCsv(applications: ApplicationRow[], exportPath = config.csvExportPath): void {
  fs.mkdirSync(path.dirname(exportPath), { recursive: true });
  const lines = [
    CSV_COLUMNS.join(","),
    ...applications.map((application) =>
      CSV_COLUMNS.map((column) => csvCell(application[column] ?? "")).join(",")
    )
  ];
  fs.writeFileSync(exportPath, `${lines.join("\n")}\n`, "utf8");
}

function csvCell(value: string | number): string {
  const text = String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}
