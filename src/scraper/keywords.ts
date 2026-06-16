import type { KeywordRow } from "../types.js";

export interface KeywordMatcher {
  include: string[];
  exclude: string[];
}

export function buildKeywordMatcher(rows: KeywordRow[]): KeywordMatcher {
  return {
    include: rows.filter((row) => row.kind === "include").map((row) => row.term.toLowerCase()),
    exclude: rows.filter((row) => row.kind === "exclude").map((row) => row.term.toLowerCase())
  };
}

export function titleMatches(title: string, matcher: KeywordMatcher): boolean {
  const normalized = title.toLowerCase();
  const hasInclude = matcher.include.some((term) => normalized.includes(term));
  const hasExclude = matcher.exclude.some((term) => normalized.includes(term));
  return hasInclude && !hasExclude;
}
