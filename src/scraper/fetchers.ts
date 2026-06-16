import type { KeywordMatcher } from "./keywords.js";
import { titleMatches } from "./keywords.js";
import type { NewOpenRole, TargetRow, TargetScanOutcome } from "../types.js";

const FETCH_TIMEOUT_MS = 20_000;

interface ParsedRole {
  external_id: string | null;
  title: string;
  location: string | null;
  apply_url: string;
}

export async function fetchTargetRoles(target: TargetRow, matcher: KeywordMatcher): Promise<TargetScanOutcome> {
  if (target.check_type === "manual") {
    return { target, status: "manual", matchingRoles: [] };
  }

  try {
    const roles = await fetchRolesForTarget(target);
    const matchingRoles = roles.filter((role) => titleMatches(role.title, matcher)).map((role) => toNewOpenRole(target, role));
    return { target, status: "ok", matchingRoles };
  } catch (error) {
    return {
      target,
      status: "failed",
      matchingRoles: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function fetchRolesForTarget(target: TargetRow): Promise<ParsedRole[]> {
  switch (target.check_type) {
    case "ats_greenhouse":
      return fetchGreenhouseRoles(requiredBoardSlug(target));
    case "ats_ashby":
      return fetchAshbyRoles(requiredBoardSlug(target));
    case "ats_lever":
      return fetchLeverRoles(requiredBoardSlug(target), target.careers_url);
    case "html":
      return fetchHtmlStructuredRoles(requiredCareersUrl(target));
    case "manual":
      return [];
  }
}

async function fetchGreenhouseRoles(boardSlug: string): Promise<ParsedRole[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardSlug)}/jobs`;
  const json = await fetchJson(url);
  const jobs = getArrayProperty(json, "jobs", "Greenhouse jobs");

  return jobs.map((job) => {
    const record = asRecord(job, "Greenhouse job");
    const location = asRecordOrNull(record.location);
    return {
      external_id: optionalString(record.id),
      title: requiredString(record.title, "Greenhouse job title"),
      location: location ? optionalString(location.name) : null,
      apply_url: requiredString(record.absolute_url, "Greenhouse absolute_url")
    };
  });
}

async function fetchAshbyRoles(boardSlug: string): Promise<ParsedRole[]> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(boardSlug)}`;
  const json = await fetchJson(url);
  const jobs = getArrayProperty(json, "jobs", "Ashby jobs");

  return jobs.map((job) => {
    const record = asRecord(job, "Ashby job");
    return {
      external_id: optionalString(record.id),
      title: requiredString(record.title, "Ashby job title"),
      location: ashbyLocation(record.location),
      apply_url: firstRequiredString(
        [record.applyUrl, record.jobUrl, record.applicationUrl, record.url],
        "Ashby applyUrl/jobUrl"
      )
    };
  });
}

async function fetchLeverRoles(boardSlug: string, careersUrl: string | null): Promise<ParsedRole[]> {
  const apiBaseUrl = careersUrl?.includes("jobs.eu.lever.co") ? "https://api.eu.lever.co" : "https://api.lever.co";
  const url = `${apiBaseUrl}/v0/postings/${encodeURIComponent(boardSlug)}?mode=json`;
  const json = await fetchJson(url);
  if (!Array.isArray(json)) {
    throw new Error("Lever response was not an array");
  }

  return json.map((job) => {
    const record = asRecord(job, "Lever job");
    const categories = asRecordOrNull(record.categories);
    return {
      external_id: optionalString(record.id),
      title: requiredString(record.text, "Lever posting text"),
      location: categories ? optionalString(categories.location) : null,
      apply_url: requiredString(record.hostedUrl, "Lever hostedUrl")
    };
  });
}

async function fetchHtmlStructuredRoles(careersUrl: string): Promise<ParsedRole[]> {
  const html = await fetchText(careersUrl);
  const jsonLdObjects = extractJsonLdObjects(html);
  const jobPostings = jsonLdObjects.flatMap((item) => findJobPostings(item));

  if (jobPostings.length === 0) {
    throw new Error("No trusted JSON-LD JobPosting data found on HTML page");
  }

  return jobPostings.map((job, index) => {
    const title = requiredString(job.title, "JSON-LD JobPosting title");
    return {
      external_id: optionalString(job.identifier) ?? optionalString(job["@id"]) ?? `${careersUrl}#jobposting-${index}`,
      title,
      location: jobPostingLocation(job.jobLocation),
      apply_url: optionalString(job.url) ?? careersUrl
    };
  });
}

function toNewOpenRole(target: TargetRow, role: ParsedRole): NewOpenRole {
  return {
    target_id: target.id,
    external_id: role.external_id,
    title: role.title,
    location: role.location,
    apply_url: role.apply_url
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while fetching ${url}`);
  }
  return response.json();
}

async function fetchText(url: string): Promise<string> {
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while fetching ${url}`);
  }
  return response.text();
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "discord-job-search-tracker-bot/0.1 (+personal job tracker)"
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

function requiredBoardSlug(target: TargetRow): string {
  if (!target.board_slug) {
    throw new Error(`${target.name} is missing board_slug`);
  }
  return target.board_slug;
}

function requiredCareersUrl(target: TargetRow): string {
  if (!target.careers_url) {
    throw new Error(`${target.name} is missing careers_url`);
  }
  return target.careers_url;
}

function getArrayProperty(value: unknown, property: string, label: string): unknown[] {
  const record = asRecord(value, label);
  const array = record[property];
  if (!Array.isArray(array)) {
    throw new Error(`${label} was not an array`);
  }
  return array;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} was not an object`);
  }
  return value as Record<string, unknown>;
}

function asRecordOrNull(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`${label} was missing`);
  }
  const text = String(value).trim();
  if (!text) {
    throw new Error(`${label} was empty`);
  }
  return text;
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function firstRequiredString(values: unknown[], label: string): string {
  for (const value of values) {
    const text = optionalString(value);
    if (text) return text;
  }
  throw new Error(`${label} was missing`);
}

function ashbyLocation(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  const record = asRecordOrNull(value);
  if (!record) return null;
  return optionalString(record.name) ?? optionalString(record.location) ?? optionalString(record.text);
}

function jobPostingLocation(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  const first = Array.isArray(value) ? value[0] : value;
  const record = asRecordOrNull(first);
  if (!record) return null;
  const address = asRecordOrNull(record.address);
  return (
    optionalString(record.name) ??
    optionalString(address?.addressLocality) ??
    optionalString(address?.addressRegion) ??
    optionalString(address?.addressCountry)
  );
}

function extractJsonLdObjects(html: string): unknown[] {
  const objects: unknown[] = [];
  const scriptRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptRegex)) {
    const body = decodeHtmlEntities(match[1]?.trim() ?? "");
    if (!body) continue;
    try {
      objects.push(JSON.parse(body));
    } catch {
      continue;
    }
  }
  return objects;
}

function findJobPostings(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.flatMap((item) => findJobPostings(item));
  }

  const record = asRecordOrNull(value);
  if (!record) return [];

  const type = record["@type"];
  const typeValues = Array.isArray(type) ? type : [type];
  const isJobPosting = typeValues.some((item) => typeof item === "string" && item.toLowerCase() === "jobposting");
  const children = [
    ...findJobPostings(record["@graph"]),
    ...findJobPostings(record.itemListElement),
    ...findJobPostings(record.mainEntity)
  ];

  return isJobPosting ? [record, ...children] : children;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#34;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}
