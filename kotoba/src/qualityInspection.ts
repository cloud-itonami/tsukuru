/**
 * tsukuru kotoba — qualityInspection submit + get.
 *
 * Replaces vendor `60-apps/etzhayyim-project-tsukuru/appview/tsukuru-
 * tsukr8u0/src/app.ts:967-1015` with @etzhayyim/sdk equivalents:
 *
 *   vendor (RW + Stripe)               → etzhayyim (PDS + escrow settle)
 *   ───────────────────────────────       ──────────────────────────────────
 *   recordWrite(sdk,                   → e.write({ collection, record })
 *     "com.etzhayyim.apps.tsukuru.qualityInspection",
 *     {...})
 *   if (result === "pass") update      → if (settlementTriggered):
 *     productionOrder.status="passed"     1. settle escrow via SDK pay()
 *     (Stripe charge happens elsewhere)   2. write payment.sent record
 *                                         3. update productionOrder
 *                                            status="passed" + paymentSentUri
 *   listByLabelField(...)              → e.read({ collection, prefix })
 *
 * Per ADR-2605202900 — pass/conditional_pass results trigger
 * on-chain USDC.transfer via @etzhayyim/sdk pay(). This is where
 * the deferred escrow_intent finally moves money.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import { settleEscrow, type SettleEscrowOpts } from "./settle.js";
import {
  SETTLEMENT_TRIGGERING_RESULTS,
  type GetInspectionsInput,
  type GetInspectionsOutput,
  type InspectionResult,
  type InspectionView,
  type ProductionOrderRecord,
  type QualityInspectionRecord,
  type SubmitInspectionInput,
  type SubmitInspectionOutput,
} from "./types.js";

/**
 * Submit a quality inspection. If the result triggers settlement
 * (pass / conditional_pass), call settleEscrow() to do the on-chain
 * USDC.transfer + write payment.sent, then mark productionOrder
 * status="passed" with paymentSentUri bound.
 *
 * Settlement requires (a) the order's payment.method === 'escrow_intent',
 * (b) escrowIntentUri populated, and (c) `settle` opts supplied
 * (manufacturer wallet + buyer privateKey + RPC). If any is missing
 * the inspection records cleanly with status='recorded' and the
 * caller can settle separately.
 */
export async function submitInspection(
  e: Etzhayyim,
  input: SubmitInspectionInput,
  settle?: {
    /** Manufacturer's recipient wallet. Required to trigger settlement. */
    manufacturerWallet?: `0x${string}`;
    /** Buyer's private key (Phase 2; replaced by smart-wallet signer in 2b+). */
    buyerPrivateKey?: `0x${string}`;
    rpcUrl?: string;
  }
): Promise<SubmitInspectionOutput> {
  if (
    !input.productionOrderUri ||
    !input.inspectorDid ||
    !input.result
  ) {
    return {
      status: "recorded",
      inspectionUri: "",
      result: input.result,
      error: "missingRequiredFields",
    };
  }

  // Step 1: write the inspection record (always, regardless of result).
  const record: QualityInspectionRecord = {
    productionOrderUri: input.productionOrderUri,
    inspectorDid: input.inspectorDid,
    inspectionType: input.inspectionType ?? "final",
    result: input.result,
    defectRatePpm: input.defectRatePpm,
    findings: input.findings,
    certificationsVerified: input.certificationsVerified,
    lotNumber: input.lotNumber,
    serialNumbers: input.serialNumbers,
    createdAt: new Date().toISOString(),
  };

  const writeReceipt = await e.write({
    collection: "com.etzhayyim.apps.tsukuru.qualityInspection",
    record: record as unknown as Record<string, unknown>,
  });
  const inspectionUri = writeReceipt.uri;

  // Step 2: if the result doesn't trigger settlement, we're done.
  if (
    !SETTLEMENT_TRIGGERING_RESULTS.includes(
      input.result as (typeof SETTLEMENT_TRIGGERING_RESULTS)[number]
    )
  ) {
    return {
      status: "recorded",
      inspectionUri,
      result: input.result,
    };
  }

  // Step 3: settlement-trigger path. Read the productionOrder.
  const orderRkey = extractRkey(input.productionOrderUri);
  if (!orderRkey) {
    return {
      status: "recorded",
      inspectionUri,
      result: input.result,
      error: "invalidProductionOrderUri",
    };
  }
  const orderRead = await e.read<ProductionOrderRecord>({
    collection: "com.etzhayyim.apps.tsukuru.productionOrder",
    rkey: orderRkey,
  });
  const order = orderRead.records[0]?.value;
  if (!order) {
    return {
      status: "recorded",
      inspectionUri,
      result: input.result,
      error: "productionOrderNotFound",
    };
  }

  // Step 4: settlement preconditions.
  const requiresSettle =
    order.payment?.method === "escrow_intent" &&
    !!order.escrowIntentUri;
  if (!requiresSettle) {
    // direct_pay or no escrow — just mark passed.
    await markOrderPassed(e, order, orderRkey, inspectionUri);
    return {
      status: "recorded",
      inspectionUri,
      result: input.result,
    };
  }
  if (
    !settle?.manufacturerWallet ||
    !settle.buyerPrivateKey ||
    !order.payment
  ) {
    return {
      status: "recorded",
      inspectionUri,
      result: input.result,
      error: "settlementCredentialsMissing",
    };
  }

  // Step 5: execute settlement via SDK pay().
  try {
    const settleOpts: SettleEscrowOpts = {
      to: settle.manufacturerWallet,
      privateKey: settle.buyerPrivateKey,
      payment: order.payment,
      productionOrderUri: input.productionOrderUri,
      escrowIntentUri: order.escrowIntentUri as string,
      rpcUrl: settle.rpcUrl,
    };
    const { paymentSentUri, txHash } = await settleEscrow(settleOpts);

    // Step 6: bind paymentSentUri to inspection + productionOrder.
    await markOrderPassed(e, order, orderRkey, inspectionUri, paymentSentUri);
    await e.write({
      collection: "com.etzhayyim.apps.tsukuru.qualityInspection",
      record: {
        ...record,
        paymentSentUri,
      } as unknown as Record<string, unknown>,
      rkey: extractRkey(inspectionUri),
    });

    return {
      status: "settled",
      inspectionUri,
      result: input.result,
      paymentSentUri,
      txHash,
    };
  } catch (err) {
    // Settlement failed (USDC.transfer reverted). Inspection record
    // already persisted; caller can retry settlement out-of-band.
    return {
      status: "settlementFailed",
      inspectionUri,
      result: input.result,
      error: (err as Error).message,
    };
  }
}

/** Update productionOrder record to status='passed' with paymentSentUri. */
async function markOrderPassed(
  e: Etzhayyim,
  order: ProductionOrderRecord,
  orderRkey: string,
  inspectionUri: string,
  paymentSentUri?: string
): Promise<void> {
  const updated: ProductionOrderRecord = {
    ...order,
    status: "delivered",
    paymentSentUri: paymentSentUri ?? order.paymentSentUri,
  };
  await e.write({
    collection: "com.etzhayyim.apps.tsukuru.productionOrder",
    record: updated as unknown as Record<string, unknown>,
    rkey: orderRkey,
  });
  void inspectionUri; // currently unused; reserved for forward-ref MV lookup
}

/**
 * List quality inspections for a production order. Newest first.
 *
 * Phase 2 limitation: filter-by-productionOrderUri requires
 * post-fetch filtering since AT MST traversal is rkey-prefix based,
 * not arbitrary-field-indexed. Production deploys should use
 * mst-projector to maintain a fixed-shape view keyed by
 * productionOrderUri (filed as Phase 3 follow-up).
 */
export async function getInspections(
  e: Etzhayyim,
  input: GetInspectionsInput
): Promise<GetInspectionsOutput> {
  const limit = Math.min(input.limit ?? 50, 100);
  const resp = await e.read<QualityInspectionRecord>({
    collection: "com.etzhayyim.apps.tsukuru.qualityInspection",
    cursor: input.cursor,
    limit,
  });
  const items: InspectionView[] = resp.records
    .filter((r) => r.value.productionOrderUri === input.productionOrderUri)
    .map((r) => ({
      ...r.value,
      inspectionUri: r.uri,
    }));
  return {
    items,
    cursor: resp.cursor,
    total: items.length,
  };
}

/** Extract rkey from an `at://did/collection/rkey` URI. */
function extractRkey(uri: string): string {
  const body = uri.startsWith("at://") ? uri.slice(5) : uri;
  const parts = body.split("/");
  return parts[parts.length - 1] ?? "";
}
