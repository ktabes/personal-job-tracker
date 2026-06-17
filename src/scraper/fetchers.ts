import { XMLParser } from "fast-xml-parser";
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
    const matchingRoles = roles
      .filter((role) => titleMatches(role.title, matcher) && locationMatchesTarget(role, target))
      .map((role) => toNewOpenRole(target, role));
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
    case "ats_workable":
      return fetchWorkableRoles(requiredBoardSlug(target));
    case "ats_recruitee":
      return fetchRecruiteeRoles(requiredBoardSlug(target));
    case "ats_smartrecruiters":
      return fetchSmartRecruitersRoles(requiredBoardSlug(target));
    case "ats_personio":
      return fetchPersonioRoles(target);
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

async function fetchWorkableRoles(boardSlug: string): Promise<ParsedRole[]> {
  const url = `https://www.workable.com/api/accounts/${encodeURIComponent(boardSlug)}?details=true`;
  const json = await fetchJson(url);
  const jobs = getArrayProperty(json, "jobs", "Workable jobs");

  return jobs.map((job) => {
    const record = asRecord(job, "Workable job");
    return {
      external_id: optionalString(record.shortcode) ?? optionalString(record.id) ?? optionalString(record.url),
      title: requiredString(record.title, "Workable job title"),
      location: workableLocation(record),
      apply_url: firstRequiredString([record.url, record.application_url, record.shortlink], "Workable url/application_url")
    };
  });
}

async function fetchRecruiteeRoles(boardSlug: string): Promise<ParsedRole[]> {
  const host = recruiteeHost(boardSlug);
  const url = `https://${host}/api/offers`;
  const json = await fetchJson(url);
  const offers = getArrayProperty(json, "offers", "Recruitee offers");

  return offers.map((offer) => {
    const record = asRecord(offer, "Recruitee offer");
    return {
      external_id: optionalString(record.guid) ?? optionalString(record.id) ?? optionalString(record.position),
      title: requiredString(record.title, "Recruitee offer title"),
      location: recruiteeLocation(record),
      apply_url: firstRequiredString([record.careers_url, record.careers_apply_url], "Recruitee careers_url")
    };
  });
}

async function fetchSmartRecruitersRoles(boardSlug: string): Promise<ParsedRole[]> {
  const roles: ParsedRole[] = [];
  const limit = 100;

  for (let offset = 0; offset < 1_000; offset += limit) {
    const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(boardSlug)}/postings?limit=${limit}&offset=${offset}`;
    const json = await fetchJson(url);
    const response = asRecord(json, "SmartRecruiters response");
    const jobs = getArrayProperty(json, "content", "SmartRecruiters postings");
    roles.push(...jobs.map((job) => smartRecruitersRole(job, boardSlug)));

    const totalFound = optionalNumber(response.totalFound);
    if (jobs.length < limit || (totalFound !== null && roles.length >= totalFound)) {
      break;
    }
  }

  return roles;
}

async function fetchPersonioRoles(target: TargetRow): Promise<ParsedRole[]> {
  const url = personioXmlUrl(target);
  const xml = await fetchText(url);
  const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
  const parsed = parser.parse(xml);
  const root = asRecord(parsed, "Personio XML");
  const jobsRoot = asRecordOrNull(root["workzag-jobs"]);
  if (!jobsRoot) {
    throw new Error("Personio XML did not contain workzag-jobs");
  }

  const positions = arrayFromMaybe(jobsRoot.position);
  return positions.map((position) => {
    const record = asRecord(position, "Personio position");
    const id = requiredString(record.id, "Personio position id");
    return {
      external_id: id,
      title: requiredString(record.name, "Personio position name"),
      location: personioLocation(record),
      apply_url: personioJobUrl(target, id)
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

function locationMatchesTarget(role: ParsedRole, target: TargetRow): boolean {
  const terms = parseLocationFilter(target.location_filter);
  if (terms.length === 0) return true;
  const location = role.location?.toLowerCase() ?? "";
  return terms.some((term) => location.includes(term));
}

function parseLocationFilter(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length > 0);
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

function optionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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

function workableLocation(record: Record<string, unknown>): string | null {
  const direct = joinNonEmpty([record.city, record.state, record.country]);
  if (direct) return direct;

  const locations = arrayFromMaybe(record.locations);
  const firstLocation = locations.length > 0 ? asRecordOrNull(locations[0]) : null;
  if (!firstLocation) return null;

  return (
    optionalString(firstLocation.name) ??
    optionalString(firstLocation.location_str) ??
    joinNonEmpty([firstLocation.city, firstLocation.region, firstLocation.country])
  );
}

function recruiteeLocation(record: Record<string, unknown>): string | null {
  const direct = optionalString(record.location) ?? joinNonEmpty([record.city, record.state_name, record.country]);
  if (direct) return direct;

  const locations = arrayFromMaybe(record.locations);
  const firstLocation = locations.length > 0 ? asRecordOrNull(locations[0]) : null;
  if (!firstLocation) return null;

  return optionalString(firstLocation.name) ?? joinNonEmpty([firstLocation.city, firstLocation.state, firstLocation.country]);
}

function smartRecruitersRole(job: unknown, boardSlug: string): ParsedRole {
  const record = asRecord(job, "SmartRecruiters posting");
  const location = asRecordOrNull(record.location);
  const id = firstRequiredString([record.id, record.uuid], "SmartRecruiters posting id");
  return {
    external_id: optionalString(record.uuid) ?? id,
    title: requiredString(record.name, "SmartRecruiters posting name"),
    location: location
      ? optionalString(location.fullLocation) ?? joinNonEmpty([location.city, location.region, location.country])
      : null,
    apply_url: `https://jobs.smartrecruiters.com/${encodeURIComponent(boardSlug)}/${encodeURIComponent(id)}`
  };
}

function personioLocation(record: Record<string, unknown>): string | null {
  const offices = [record.office, ...arrayFromMaybe(asRecordOrNull(record.additionalOffices)?.office)];
  return joinNonEmpty(offices);
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

function recruiteeHost(boardSlug: string): string {
  const trimmed = boardSlug.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return trimmed.includes(".") ? trimmed : `${trimmed}.recruitee.com`;
}

function personioXmlUrl(target: TargetRow): string {
  if (target.careers_url && /\/xml(?:\?.*)?$/.test(target.careers_url)) {
    return target.careers_url;
  }

  if (target.board_slug) {
    return `https://${encodeURIComponent(target.board_slug)}.jobs.personio.de/xml?language=en`;
  }

  throw new Error(`${target.name} is missing board_slug or XML careers_url`);
}

function personioJobUrl(target: TargetRow, id: string): string {
  if (target.board_slug) {
    return `https://${encodeURIComponent(target.board_slug)}.jobs.personio.de/job/${encodeURIComponent(id)}?display=en`;
  }

  const careersUrl = requiredCareersUrl(target);
  return careersUrl.replace(/\/xml(?:\?.*)?$/, `/job/${encodeURIComponent(id)}?display=en`);
}

function arrayFromMaybe(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function joinNonEmpty(values: unknown[]): string | null {
  const parts = values.map((value) => optionalString(value)).filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join(", ") : null;
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
