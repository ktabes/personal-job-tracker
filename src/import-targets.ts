import fs from "node:fs";
import path from "node:path";
import { closeDb, getDb } from "./db/database.js";
import { JobTrackerRepository } from "./db/repositories.js";
import { CHECK_TYPES, type CheckType } from "./types.js";

interface TargetSeed {
  name: string;
  check_type: CheckType;
  board_slug: string | null;
  careers_url: string | null;
  category: string | null;
  location_filter: string | null;
}

const defaultSeedPath = path.join(process.cwd(), "data", "targets", "crypto-data-api-verified-2026-06-16.json");
const seedPath = path.resolve(process.argv[2] ?? defaultSeedPath);
const seeds = readSeeds(seedPath);
const repository = new JobTrackerRepository(getDb());
const existingKeys = new Set(repository.listTargets(true).map(targetKey));

let imported = 0;
let skipped = 0;

for (const seed of seeds) {
  const key = targetKey(seed);
  if (existingKeys.has(key)) {
    skipped += 1;
    continue;
  }

  repository.addTarget({
    name: seed.name,
    checkType: seed.check_type,
    boardSlug: seed.board_slug,
    careersUrl: seed.careers_url,
    category: seed.category,
    locationFilter: seed.location_filter
  });
  existingKeys.add(key);
  imported += 1;
}

console.log(`Imported ${imported} targets from ${seedPath}`);
console.log(`Skipped ${skipped} existing targets`);
closeDb();

function readSeeds(filePath: string): TargetSeed[] {
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error("Target seed file must contain an array");
  }
  return parsed.map((item, index) => validateSeed(item, index));
}

function validateSeed(item: unknown, index: number): TargetSeed {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    throw new Error(`Seed row ${index + 1} must be an object`);
  }

  const record = item as Record<string, unknown>;
  const name = requiredString(record.name, `Seed row ${index + 1} name`);
  const checkType = requiredCheckType(record.check_type, `Seed row ${index + 1} check_type`);
  const boardSlug = optionalString(record.board_slug);
  const careersUrl = optionalString(record.careers_url);
  const category = optionalString(record.category);
  const locationFilter = optionalString(record.location_filter);

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
    throw new Error(`Seed row ${index + 1} requires board_slug`);
  }
  if (checkType === "ats_personio" && !boardSlug && !careersUrl) {
    throw new Error(`Seed row ${index + 1} requires board_slug or careers_url`);
  }
  if ((checkType === "html" || checkType === "manual") && !careersUrl) {
    throw new Error(`Seed row ${index + 1} requires careers_url`);
  }

  return {
    name,
    check_type: checkType,
    board_slug: boardSlug,
    careers_url: careersUrl,
    category,
    location_filter: locationFilter
  };
}

function targetKey(target: Pick<TargetSeed, "name" | "check_type" | "board_slug" | "careers_url">): string {
  return [
    target.name.trim().toLowerCase(),
    target.check_type,
    target.board_slug?.trim().toLowerCase() ?? "",
    target.careers_url?.trim().toLowerCase() ?? ""
  ].join("|");
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} cannot be blank`);
  }
  return trimmed;
}

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error("Optional seed fields must be strings or null");
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requiredCheckType(value: unknown, label: string): CheckType {
  if (typeof value === "string" && CHECK_TYPES.includes(value as CheckType)) {
    return value as CheckType;
  }
  throw new Error(`${label} must be one of ${CHECK_TYPES.join(", ")}`);
}
