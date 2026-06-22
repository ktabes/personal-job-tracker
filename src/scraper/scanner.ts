import { logger } from "../logger.js";
import { nowIso } from "../time.js";
import type { JobTrackerRepository } from "../db/repositories.js";
import type { TargetScanOutcome } from "../types.js";
import { buildKeywordMatcher } from "./keywords.js";
import { fetchTargetRoles } from "./fetchers.js";

export interface ScanSummary {
  checkedAt: string;
  category: string | null;
  outcomes: TargetScanOutcome[];
}

export async function scanTargets(
  repository: JobTrackerRepository,
  category: string | null = null
): Promise<ScanSummary> {
  const checkedAt = nowIso();
  const targets = repository.listTargetsForScan(category);
  const matcher = buildKeywordMatcher(repository.listKeywords());
  const outcomes = await Promise.all(targets.map((target) => fetchTargetRoles(target, matcher)));

  repository.saveScanOutcomes(outcomes, checkedAt);

  for (const outcome of outcomes) {
    if (outcome.status === "failed") {
      logger.warn(`Target check failed for ${outcome.target.name}`, outcome.error);
    }
  }

  return { checkedAt, category, outcomes };
}
