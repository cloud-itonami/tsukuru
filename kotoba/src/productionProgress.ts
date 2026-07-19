/**
 * tsukuru kotoba — productionProgress (slice 5).
 *
 * Milestone records are append-only AT records per ADR-2605202800
 * record-log semantics. They do NOT mutate productionOrder.status —
 * that requires updateOrderStatus (slice 4) with state-machine
 * validation.
 *
 * Per-order timeline read uses post-fetch filter on productionOrderUri;
 * Phase 3 mst-projector view will index by order.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import type {
  GetProgressInput,
  GetProgressOutput,
  MilestoneRecord,
  MilestoneView,
  ReportMilestoneInput,
  ReportMilestoneOutput,
} from "./types.js";

const MILESTONE_COLLECTION = "com.etzhayyim.apps.tsukuru.productionProgress";

export async function reportMilestone(
  e: Etzhayyim,
  input: ReportMilestoneInput
): Promise<ReportMilestoneOutput> {
  if (!input.productionOrderUri || !input.milestone || !input.factoryDid) {
    return { status: "rejected", error: "missingRequiredFields" };
  }

  const record: MilestoneRecord = {
    productionOrderUri: input.productionOrderUri,
    milestone: input.milestone,
    factoryDid: input.factoryDid,
    note: input.note,
    completedPercent: input.completedPercent,
    evidenceCids: input.evidenceCids,
    createdAt: new Date().toISOString(),
  };

  const receipt = await e.write({
    collection: MILESTONE_COLLECTION,
    record: record as unknown as Record<string, unknown>,
    // Auto-generated TID rkey (append-only timeline; no slug-based key).
  });

  return { status: "recorded", milestoneUri: receipt.uri };
}

/**
 * Read all milestones for a productionOrder. Phase 2 post-filters on
 * read; Phase 3 mst-projector view by productionOrderUri.
 */
export async function getProgress(
  e: Etzhayyim,
  input: GetProgressInput
): Promise<GetProgressOutput> {
  if (!input.productionOrderUri) {
    return { items: [], total: 0 };
  }
  const limit = Math.min(input.limit ?? 50, 100);
  const resp = await e.read<MilestoneRecord>({
    collection: MILESTONE_COLLECTION,
    cursor: input.cursor,
    limit,
  });
  const items: MilestoneView[] = resp.records
    .filter((r) => r.value.productionOrderUri === input.productionOrderUri)
    .map((r) => ({ ...r.value, milestoneUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}
