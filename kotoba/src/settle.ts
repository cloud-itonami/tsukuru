/**
 * tsukuru kotoba — settlement helper.
 *
 * Calls @etzhayyim/sdk pay() to actually transfer USDC to the
 * manufacturer's wallet, fulfilling a deferred escrow_intent at
 * delivery confirmation (quality_inspection.result == 'pass').
 *
 * Per ADR-2605202900 — this is the on-chain step. Before this call
 * the buyer's USDC has NOT been moved. After this call (success),
 * the payment.sent record is written and the productionOrder
 * transitions to status='passed' (or 'delivered').
 *
 * Wallet keys: Phase 2 uses SDK v0.1's EOA-backed pay() which
 * requires the buyer's private key. In a deployed Worker the key
 * would come from a wallet management module (e.g., paymaster +
 * smart wallet binding to DID). Phase 2 reference impl accepts the
 * privateKey directly to keep the contract minimal — the wallet
 * abstraction layer is its own design problem.
 *
 * Phase 2b+ migration: when SDK adds ERC-4337 Smart Account +
 * Paymaster, the buyer signs a UserOperation instead of a raw EOA
 * tx, and the gas is paid by etzhayyim-paymaster. Internal-only
 * change — this module's contract stays the same.
 */

import { pay, type PaymentReceipt } from "@etzhayyim/sdk";
import type { PaymentIntent } from "./types.js";

type PdsBinding = Parameters<typeof pay>[0]["pds"];

export interface SettleEscrowOpts {
  /** Manufacturer's recipient wallet (0x-prefixed Base address). */
  to: `0x${string}`;
  /** Buyer's private key for SDK v0.1 EOA pay(). Phase 2b+ replaces with smart-wallet signer. */
  privateKey: `0x${string}`;
  /** USDC amount + token contract + chain from the productionOrder.payment field. */
  payment: PaymentIntent;
  /** AT URI of the productionOrder that triggered this settlement. */
  productionOrderUri: string;
  /** AT URI of the escrowOpened record being settled. */
  escrowIntentUri: string;
  /** Base L2 RPC URL. */
  rpcUrl?: string;
  /** Optional PDS binding to record payment.sent on sender's PDS. */
  pds?: PdsBinding;
}

const BASE_RPC_DEFAULT = "https://mainnet.base.org" as const;
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

/**
 * Execute the on-chain USDC.transfer for a deferred escrow_intent.
 * Returns the payment.sent AT URI + Base L2 tx hash.
 *
 * Throws if USDC.transfer reverts. Caller (qualityInspection.submit)
 * should catch and return `status: 'settlementFailed'` while still
 * persisting the inspection record (audit trail + retry path).
 */
export async function settleEscrow(
  opts: SettleEscrowOpts
): Promise<{ paymentSentUri: string; txHash: string; receipt: PaymentReceipt }> {
  const receipt = await pay({
    rpcUrl: opts.rpcUrl ?? BASE_RPC_DEFAULT,
    privateKey: opts.privateKey,
    to: opts.to,
    amount: BigInt(opts.payment.amountUsdcMicros),
    reason: {
      purpose: "internal-purchase",
      forUri: opts.productionOrderUri,
      memo: `settle escrow ${opts.escrowIntentUri}`,
    },
    tokenContract: (opts.payment.tokenContract ?? USDC_BASE) as `0x${string}`,
    pds: opts.pds,
  });

  return {
    paymentSentUri: receipt.recordUri,
    txHash: receipt.txHash,
    receipt,
  };
}
