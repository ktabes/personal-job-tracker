import { buildKeywordMatcher } from "./scraper/keywords.js";
import { fetchTargetRoles } from "./scraper/fetchers.js";
import type { KeywordRow, TargetRow } from "./types.js";

const keywords: KeywordRow[] = [
  { id: 1, kind: "include", term: "data", },
  { id: 2, kind: "include", term: "analytics" },
  { id: 3, kind: "include", term: "engineer" },
  { id: 4, kind: "exclude", term: "data center" }
];

const examples: TargetRow[] = [
  {
    id: 1,
    name: "Example Greenhouse",
    check_type: "ats_greenhouse",
    board_slug: "airbnb",
    careers_url: "https://careers.airbnb.com/",
    category: "smoke",
    last_check_status: null,
    last_checked_at: null,
    active: 1
  },
  {
    id: 2,
    name: "Example Ashby",
    check_type: "ats_ashby",
    board_slug: "opensea",
    careers_url: "https://opensea.io/careers",
    category: "smoke",
    last_check_status: null,
    last_checked_at: null,
    active: 1
  },
  {
    id: 3,
    name: "Example Lever",
    check_type: "ats_lever",
    board_slug: "spotify",
    careers_url: "https://www.lifeatspotify.com/jobs",
    category: "smoke",
    last_check_status: null,
    last_checked_at: null,
    active: 1
  },
  {
    id: 4,
    name: "Example Lever EU",
    check_type: "ats_lever",
    board_slug: "aavelabs",
    careers_url: "https://jobs.eu.lever.co/aavelabs",
    category: "smoke",
    last_check_status: null,
    last_checked_at: null,
    active: 1
  }
];

const matcher = buildKeywordMatcher(keywords);
for (const target of examples) {
  const outcome = await fetchTargetRoles(target, matcher);
  console.log(
    JSON.stringify(
      {
        target: target.name,
        check_type: target.check_type,
        status: outcome.status,
        matching_roles: outcome.matchingRoles.length,
        error: outcome.error
      },
      null,
      2
    )
  );
}
