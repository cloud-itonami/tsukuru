/**
 * tsukuru kotoba — escrow_intent pattern helpers.
 *
 * Per ADR-2605202900 Phase 2:
 * Stripe Issuing cancelCard semantics are replaced with a deferred-
 * payment intent pattern, NOT yet full Gnosis Safe 2-of-3 escrow
 * (SDK v0.2+).
 *
 *   create order (escrow_intent)
 *     → openIntent() writes com.etzhayyim.apps.payment.escrowOpened with
 *       safeAddress/arbiter = 0x0...0 placeholder + dueDate. No
 *       on-chain tx. USDC has NOT been moved.
 *
 *   delivery confirmed (quality_inspection.passed)
 *     → quality-inspection flow calls @etzhayyim/sdk pay() to do the
 *       actual USDC.transfer. Writes com.etzhayyim.apps.payment.sent. The
 *       settlement step lives in qualityInspection module, not here.
 *
 *   cancel before delivery
 *     → refundIntent() writes com.etzhayyim.apps.payment.escrowRefunded.
 *       No on-chain tx (USDC was never moved).
 *
 * This is record-state-machine escrow, not on-chain escrow. The state
 * transition is enforced by application logic + AT firehose audit
 * trail rather than a Safe contract. Migration to on-chain Safe-based
 * escrow happens when @etzhayyim/sdk escrowOpen() / escrowRelease()
 * ship (currently throws "v0.2+" per pay.ts:307-321).
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import type {
  EscrowOpenedRecord,
  EscrowRefundedRecord,
  PaymentIntent,
} from "./types.js";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const BASE_CHAIN_ID = 8453 as const;
const PLACEHOLDER_ADDRESS =
  "0x0000000000000000000000000000000000000000" as const;

/** ms in 1 day. */
const MS_PER_DAY = 86_400_000;

export interface OpenIntentOpts {
  to: string;
  payment: PaymentIntent;
  forUri: string;
  arbiter?: string;
  /** Days until escrow auto-releases or arbiter intervention. Default 60. */
  intentTtlDays?: number;
  memo?: string;
}

/**
 * Open a deferred-payment intent. Phase 2: record-only (no on-chain
 * Safe deploy yet — SDK v0.2+). Returns the escrowOpened AT URI for
 * binding to the productionOrder record.
 */
export async function openIntent(
  e: Etzhayyim,
  opts: OpenIntentOpts
): Promise<{ escrowIntentUri: string }> {
  const now = new Date();
  const dueDate = new Date(
    now.getTime() + (opts.intentTtlDays ?? 60) * MS_PER_DAY
  ).toISOString();

  const record: EscrowOpenedRecord = {
    to: opts.to,
    amountUsdcMicros: opts.payment.amountUsdcMicros,
    tokenContract: opts.payment.tokenContract ?? USDC_BASE,
    chainId: opts.payment.chainId ?? BASE_CHAIN_ID,
    // Phase 2 placeholders — populated by SDK v0.2 when Safe deploys.
    safeAddress: PLACEHOLDER_ADDRESS,
    arbiter: opts.arbiter ?? PLACEHOLDER_ADDRESS,
    dueDate,
    purpose: "internal-purchase",
    forUri: opts.forUri,
    memo: opts.memo,
    openedAt: now.toISOString(),
  };

  const receipt = await e.write({
    collection: "com.etzhayyim.apps.payment.escrowOpened",
    record: record as unknown as Record<string, unknown>,
  });

  return { escrowIntentUri: receipt.uri };
}

export interface RefundIntentOpts {
  escrowIntentUri: string;
  productionOrderUri: string;
  reason: string;
  refundedByDid: string;
}

/**
 * Refund a deferred-payment intent. Phase 2: record-only state
 * transition (no on-chain tx — USDC was never moved). Writes
 * com.etzhayyim.apps.payment.escrowRefunded record.
 *
 * Note: the escrowRefunded lexicon doesn't exist yet — it will be
 * added alongside this kotoba PR when the SDK escrowRelease lands.
 * For Phase 2 consumers SHOULD treat the firehose event as a state-
 * transition signal until the lexicon is added.
 */
export async function refundIntent(
  e: Etzhayyim,
  opts: RefundIntentOpts
): Promise<{ escrowRefundUri: string }> {
  const record: EscrowRefundedRecord = {
    forEscrowUri: opts.escrowIntentUri,
    forProductionOrderUri: opts.productionOrderUri,
    reason: opts.reason,
    refundedAt: new Date().toISOString(),
    refundedByDid: opts.refundedByDid,
    // Phase 2: refundTxHash undefined (no on-chain tx). Phase 2b+:
    // populated by @etzhayyim/sdk escrowRelease() when SDK v0.2 ships.
  };

  const receipt = await e.write({
    collection: "com.etzhayyim.apps.payment.escrowRefunded",
    record: record as unknown as Record<string, unknown>,
  });

  return { escrowRefundUri: receipt.uri };
}
