/**
 * tsukuru kotoba — productionOrder create + cancel reference impl.
 *
 * Replaces vendor `60-apps/etzhayyim-project-tsukuru/appview/tsukuru-
 * tsukr8u0/src/app.ts:740-870` with @etzhayyim/sdk equivalents:
 *
 *   vendor (RW + Stripe)              → etzhayyim (PDS + escrow_intent)
 *   ─────────────────────────────       ────────────────────────────────
 *   createKyselyDb().insertInto()      → e.write({ collection, record })
 *   recordWrite(sdk, ...)              → e.write({ ... })
 *   invoke(sdk, STRIPE_DID,            → escrow.openIntent() (no tx)
 *     "chargeCustomer", ...)
 *   invoke(sdk, STRIPE_DID,            → escrow.refundIntent()
 *     "cancelCard", ...)                 (no tx)
 *
 * Per ADR-2605202900 Phase 2, the actual USDC.transfer at delivery
 * confirmation lives in qualityInspection module (next PR), not here.
 *
 * Other 44 tsukuru commands (manufacturerRegistry / euv / cnt / etc.)
 * follow the same pattern: replace `createKyselyDb` write with
 * `e.write()`, eliminate `invoke(STRIPE_DID, ...)` for payment ops.
 * Filed as Phase 2 follow-up PRs.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import { openIntent, refundIntent } from "./escrow.js";
import {
  CANCELLABLE_STATUSES,
  STATUS_TRANSITIONS,
  type CancelOrderInput,
  type CancelOrderOutput,
  type CreateOrderInput,
  type CreateOrderOutput,
  type EstimateLeadTimeInput,
  type EstimateLeadTimeOutput,
  type GetOrderInput,
  type GetOrderOutput,
  type ListOrdersInput,
  type ListOrdersOutput,
  type ProductionOrderRecord,
  type ProductionOrderStatus,
  type ProductionOrderView,
  type UpdateStatusInput,
  type UpdateStatusOutput,
} from "./types.js";

const MS_PER_DAY = 86_400_000;

/** Default lead-time estimate by priority. Used when no industry profile is supplied. */
function defaultLeadTimeDays(priority: string): number {
  switch (priority) {
    case "urgent":
      return 7;
    case "high":
      return 21;
    case "low":
      return 90;
    default:
      return 45;
  }
}

/**
 * Create a production order.
 *
 *   1. (caller pre-screens manufacturer activeness + sanctions —
 *      separate module; the kotoba reference focuses on the order
 *      write + escrow intent.)
 *   2. Compute estimated completion date from priority.
 *   3. Build productionOrder record body.
 *   4. If payment.method === "escrow_intent": openIntent() →
 *      escrowIntentUri threaded into the record body.
 *   5. e.write() the productionOrder record.
 *   6. Return CreateOrderOutput.
 */
export async function createProductionOrder(
  e: Etzhayyim,
  input: CreateOrderInput,
  opts: { manufacturerWalletAddress?: string } = {}
): Promise<CreateOrderOutput> {
  if (!input.manufacturerDid || !input.customerDid) {
    return {
      productionOrderUri: "",
      status: "rejected",
      error: "missingRequiredFields",
    };
  }

  const priority = input.priority ?? "normal";
  const estimatedDays = defaultLeadTimeDays(priority);
  const estimatedCompletion = new Date(
    Date.now() + estimatedDays * MS_PER_DAY
  )
    .toISOString()
    .split("T")[0];

  // Step 4: open escrow intent if payment.method === "escrow_intent".
  let escrowIntentUri: string | undefined;
  if (input.payment?.method === "escrow_intent") {
    if (!opts.manufacturerWalletAddress) {
      return {
        productionOrderUri: "",
        status: "rejected",
        error: "missingManufacturerWalletForEscrowIntent",
      };
    }
    // forUri is updated after the productionOrder write; for now use
    // a placeholder that the caller can rebind. The escrowOpened
    // record's `forUri` field is informational, not a hard FK.
    const result = await openIntent(e, {
      to: opts.manufacturerWalletAddress,
      payment: input.payment,
      forUri: `at-pending:${input.customerDid}/${Date.now()}`,
      memo: `tsukuru order ${input.manufacturerDid}`,
    });
    escrowIntentUri = result.escrowIntentUri;
  }

  // Step 5: build + write productionOrder record.
  const record: ProductionOrderRecord = {
    manufacturerDid: input.manufacturerDid,
    customerDid: input.customerDid,
    factoryDid: input.factoryDid,
    productSpec: input.productSpec,
    fulfillmentMode: input.fulfillmentMode ?? "bto",
    priority,
    deadline: input.deadline,
    payment: input.payment,
    okaimonoOrderRef: input.okaimonoOrderRef,
    certificationsRequired: input.certificationsRequired,
    status: "pending",
    estimatedCompletion: `${estimatedCompletion}T00:00:00Z`,
    estimatedDays,
    escrowIntentUri,
    createdAt: new Date().toISOString(),
  };

  const receipt = await e.write({
    collection: "com.etzhayyim.apps.tsukuru.productionOrder",
    record: record as unknown as Record<string, unknown>,
  });

  return {
    productionOrderUri: receipt.uri,
    status: "pending",
    escrowIntentUri,
    estimatedCompletion: record.estimatedCompletion,
    estimatedDays,
    manufacturerDid: input.manufacturerDid,
  };
}

/**
 * Cancel a production order before delivery.
 *
 *   1. Read existing productionOrder record by uri.
 *   2. Verify currentStatus ∈ CANCELLABLE_STATUSES.
 *   3. If escrowIntentUri present: refundIntent() → escrowRefundUri.
 *      (record-only — no on-chain tx since USDC was never moved.)
 *   4. e.write() update productionOrder record with status=cancelled
 *      + cancelReason + cancelledAt + escrowRefundUri.
 *   5. Return CancelOrderOutput.
 *
 * Phase 2 quirk: AT Protocol records are append-only. "Update" here
 * actually writes a new record with the same rkey replacing the
 * previous version (createRecord with explicit rkey on the same DID).
 * Phase 3+ may switch to dedicated state-transition records
 * (productionOrderCancelled) per AT firehose best practices.
 */
export async function cancelProductionOrder(
  e: Etzhayyim,
  input: CancelOrderInput
): Promise<CancelOrderOutput> {
  // Step 1: read existing record. The Etzhayyim.read() API supports
  // rkey-direct lookup; for this reference we read via the explicit
  // rkey. In production the caller normally has the record already
  // loaded from a prior dispatch decision.
  const { uri } = parseAtUri(input.productionOrderUri);
  const rkey = uri.rkey;
  if (!rkey) {
    return {
      status: "cannotCancel",
      productionOrderUri: input.productionOrderUri,
      error: "invalidAtUri",
    };
  }

  const readResp = await e.read<ProductionOrderRecord>({
    collection: "com.etzhayyim.apps.tsukuru.productionOrder",
    rkey,
  });
  const order = readResp.records[0]?.value;
  if (!order) {
    return {
      status: "cannotCancel",
      productionOrderUri: input.productionOrderUri,
      error: "notFound",
    };
  }

  // Step 2: cancellable status check.
  if (
    !CANCELLABLE_STATUSES.includes(
      order.status as (typeof CANCELLABLE_STATUSES)[number]
    )
  ) {
    return {
      status: "cannotCancel",
      productionOrderUri: input.productionOrderUri,
      currentStatus: order.status,
      cancellableStatuses: [...CANCELLABLE_STATUSES],
    };
  }

  // Step 3: refund escrow intent (record-only) if present.
  let escrowRefundUri: string | undefined;
  if (order.escrowIntentUri && input.cancelledByDid) {
    const refund = await refundIntent(e, {
      escrowIntentUri: order.escrowIntentUri,
      productionOrderUri: input.productionOrderUri,
      reason: input.reason ?? "user-cancelled",
      refundedByDid: input.cancelledByDid,
    });
    escrowRefundUri = refund.escrowRefundUri;
  }

  // Step 4: write updated record (same rkey for in-place state machine).
  const updated: ProductionOrderRecord = {
    ...order,
    status: "cancelled",
    cancelReason: input.reason,
    cancelledAt: new Date().toISOString(),
    cancelledByDid: input.cancelledByDid,
    escrowRefundUri,
  };
  await e.write({
    collection: "com.etzhayyim.apps.tsukuru.productionOrder",
    record: updated as unknown as Record<string, unknown>,
    rkey,
  });

  return {
    status: "cancelled",
    productionOrderUri: input.productionOrderUri,
    escrowRefundUri,
  };
}

/** Minimal AT URI parser. `at://<did>/<collection>/<rkey>`. */
function parseAtUri(s: string): {
  uri: { did: string; collection: string; rkey: string };
} {
  // Strip `at://` prefix.
  const body = s.startsWith("at://") ? s.slice(5) : s;
  const parts = body.split("/");
  // [did, collection, rkey] — collection can contain dots; rkey is the
  // trailing segment after the last collection NSID separator. For our
  // tsukuru.productionOrder collection the NSID is the second-to-last
  // dotted run; rkey is the final path segment.
  // Practical parse:
  if (parts.length < 3)
    return { uri: { did: parts[0] ?? "", collection: "", rkey: "" } };
  const did = parts[0];
  const rkey = parts[parts.length - 1];
  const collection = parts.slice(1, -1).join("/");
  return { uri: { did, collection, rkey } };
}

// ─── Slice 4: remaining productionOrder commands ─────────────────────

const ORDER_COLLECTION = "com.etzhayyim.apps.tsukuru.productionOrder";

/** Read a single productionOrder by AT URI. */
export async function getProductionOrder(
  e: Etzhayyim,
  input: GetOrderInput
): Promise<GetOrderOutput> {
  const { uri } = parseAtUri(input.productionOrderUri);
  if (!uri.rkey) return { error: "invalidAtUri" };

  const resp = await e
    .read<ProductionOrderRecord>({
      collection: ORDER_COLLECTION,
      rkey: uri.rkey,
    })
    .catch(() => ({ records: [] }));
  const r = resp.records[0];
  if (!r) return { error: "notFound" };
  return {
    productionOrder: { ...r.value, productionOrderUri: r.uri },
  };
}

/**
 * List productionOrders with cursor pagination + post-fetch filter.
 * Phase 3 will move to mst-projector indexed view (filter by
 * manufacturerDid / customerDid / status).
 */
export async function listProductionOrders(
  e: Etzhayyim,
  input: ListOrdersInput = {}
): Promise<ListOrdersOutput> {
  const limit = Math.min(input.limit ?? 50, 100);
  const resp = await e.read<ProductionOrderRecord>({
    collection: ORDER_COLLECTION,
    cursor: input.cursor,
    limit,
  });

  const items: ProductionOrderView[] = resp.records
    .filter((r) => matchesOrderFilter(r.value, input))
    .map((r) => ({ ...r.value, productionOrderUri: r.uri }));

  return {
    items,
    cursor: resp.cursor,
    total: items.length,
  };
}

/**
 * Update the status of a productionOrder. Validates the transition
 * against STATUS_TRANSITIONS. Typically called by the manufacturer
 * as work progresses, but the lexicon doesn't enforce that — the
 * arbiter / customer can also call (e.g., for dispute).
 *
 * Settlement is NOT triggered here — only submitInspection
 * (qualityInspection.ts) calls pay() at result=pass. Status changes
 * here are pure record edits.
 */
export async function updateOrderStatus(
  e: Etzhayyim,
  input: UpdateStatusInput
): Promise<UpdateStatusOutput> {
  if (!input.productionOrderUri || !input.status || !input.updatedByDid) {
    return {
      status: "invalidTransition",
      productionOrderUri: input.productionOrderUri,
      error: "missingRequiredFields",
    };
  }

  const { uri } = parseAtUri(input.productionOrderUri);
  if (!uri.rkey) {
    return {
      status: "invalidTransition",
      productionOrderUri: input.productionOrderUri,
      error: "invalidAtUri",
    };
  }

  const resp = await e
    .read<ProductionOrderRecord>({
      collection: ORDER_COLLECTION,
      rkey: uri.rkey,
    })
    .catch(() => ({ records: [] }));
  const order = resp.records[0]?.value;
  if (!order) {
    return {
      status: "notFound",
      productionOrderUri: input.productionOrderUri,
    };
  }

  // Validate forward transition.
  const allowed = STATUS_TRANSITIONS[order.status as ProductionOrderStatus] ?? [];
  if (!allowed.includes(input.status)) {
    return {
      status: "invalidTransition",
      productionOrderUri: input.productionOrderUri,
      previousStatus: order.status,
      newStatus: input.status,
    };
  }

  const updated: ProductionOrderRecord = {
    ...order,
    status: input.status,
  };
  const fields: Record<string, unknown> = {
    ...updated,
    note: input.note,
    updatedByDid: input.updatedByDid,
    updatedAt: new Date().toISOString(),
  };
  await e.write({
    collection: ORDER_COLLECTION,
    record: fields,
    rkey: uri.rkey,
  });

  return {
    status: "updated",
    productionOrderUri: input.productionOrderUri,
    previousStatus: order.status,
    newStatus: input.status,
  };
}

/**
 * Pure-compute estimate. No records written, no SDK calls. Phase 2
 * uses default priority-based estimates; Phase 3 will look up
 * industry-profile records from mst-projector.
 */
export function estimateLeadTime(
  input: EstimateLeadTimeInput
): EstimateLeadTimeOutput {
  const priority = input.priority ?? "normal";
  const quantity = Math.max(1, input.quantity ?? 1);
  const days = defaultLeadTimeDays(priority);

  // Phase 2 USDC cost estimate: base $50/unit × quantity × priority multiplier.
  // Phase 3 will replace with industry-profile-driven pricing.
  const BASE_UNIT_COST_USDC_MICROS = 50_000_000; // 50 USDC = 50_000_000 micros
  const priorityMultiplier = priority === "urgent"
    ? 150
    : priority === "high"
      ? 120
      : priority === "low"
        ? 80
        : 100;
  const estimatedCostUsdcMicros = Math.round(
    (BASE_UNIT_COST_USDC_MICROS * quantity * priorityMultiplier) / 100
  );

  const earliestDate = new Date(
    Date.now() + days * MS_PER_DAY
  ).toISOString();

  return {
    estimatedDays: days,
    earliestDate,
    estimatedCostUsdcMicros,
    industryCode: input.industryCode,
    requiredCertifications: [],
  };
}

function matchesOrderFilter(
  v: ProductionOrderRecord,
  filter: ListOrdersInput
): boolean {
  if (filter.manufacturerDid && v.manufacturerDid !== filter.manufacturerDid)
    return false;
  if (filter.customerDid && v.customerDid !== filter.customerDid) return false;
  if (filter.status && v.status !== filter.status) return false;
  return true;
}
