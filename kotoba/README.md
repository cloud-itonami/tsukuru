# tsukuru kotoba

Phase 2 reference implementation of tsukuru on the etzhayyim substrate.

Per [ADR-2605202800](../../../90-docs/adr/2605202800-tsukuru-etzhayyim-business-model-change.md), tsukuru migrates from vendor's `createKyselyDb` + Stripe Issuing pattern to the etzhayyim kotoba + on-chain-only substrate ([ADR-2605172000](../../../90-docs/adr/2605172000-etzhayyim-kotoba-substrate.md) + [ADR-2605172100](../../../90-docs/adr/2605172100-etzhayyim-payments-on-chain-only.md)).

This package implements **46 of 46** tsukuru XRPC commands as reference — **Phase 2 COMPLETE (100%)**.

| Module | Commands | Slice |
|---|---|---|
| productionOrder | createProductionOrder, cancelProductionOrder | 1 |
| productionOrder | getProductionOrder, listProductionOrders, updateOrderStatus, estimateLeadTime | 4 |
| qualityInspection | submitInspection, getInspections | 2 |
| manufacturerRegistry | × 5 | 3 |
| factoryRegistry | registerFactory, listFactories | 5 |
| productionProgress | reportMilestone, getProgress | 5 |
| supplierExchange | normalizePackage, validatePackage | 6 |
| euv | × 3 | 7 |
| cnt | × 7 | 8 |
| planning batch | designCell, planDeviceOutput, designStack, planRoute, planOperation | 9 |
| **closure batch** | exportControl × 2, hsClassification, industryActor × 2, industryProfile × 2, processRegistry, verification × 2, stats, wave | **10** |

**Phase 2 COMPLETE.** All 46 tsukuru XRPC commands have Option B PDS XRPC reference implementations.

## Phase 3-6 ahead

Per ADR-2605202800:
- **Phase 3**: `tsukuru.etzhayyim.com` Worker deploy + DNS (operator action)
- **Phase 4**: 460+ factory DID migration (6-month rolling, factory consent + ERC-4337 onboarding)
- **Phase 5**: DNS cutover (routing-gateway 301 yoro-pattern) + vendor stub + Stripe Issuing wind-down
- **Phase 6**: long-tail cleanup + lexicon dual-schema retire

## Pattern translation

| Vendor (`tsukuru.etzhayyim.com`) | etzhayyim (`tsukuru.etzhayyim.com`) |
|---|---|
| `createKyselyDb().insertInto("vertex_tsukuru_*").values({...})` | `e.write({ collection, record })` |
| `recordWrite(sdk, "com.etzhayyim.apps.tsukuru.*", {...})` | `e.write({ collection, record })` |
| `invoke(sdk, "did:web:stripe.etzhayyim.com", "chargeCustomer", {...})` | `escrow.openIntent(e, {...})` (no on-chain tx) |
| `invoke(sdk, "did:web:stripe.etzhayyim.com", "cancelCard", {...})` | `escrow.refundIntent(e, {...})` (no on-chain tx) |
| `payment.method === "stripe_issuing"` + `stripeCardId` | `payment.method === "escrow_intent"` + escrow record URI |

## Escrow flow (deferred-payment intent — full loop)

```
   create order (escrow_intent)
     │
     └─► openIntent()
           writes com.etzhayyim.apps.payment.escrowOpened
           safeAddress / arbiter = 0x0...0 placeholder (SDK v0.1)
           NO on-chain USDC transfer
           returns escrowIntentUri
           │
           └─► createProductionOrder() binds escrowIntentUri to record

   delivery confirmed (slice 2 — qualityInspection)
     │
     └─► submitInspection(result="pass")
           writes com.etzhayyim.apps.tsukuru.qualityInspection
           │
           └─► settleEscrow()  →  SDK pay()
                 USDC.transfer to manufacturer wallet on Base L2
                 writes com.etzhayyim.apps.payment.sent (auto by SDK)
                 returns paymentSentUri + txHash
                 │
                 └─► markOrderPassed()
                       productionOrder.status = "delivered"
                       productionOrder.paymentSentUri = ...
                       inspection.paymentSentUri = ...

   cancel before delivery (slice 1)
     │
     └─► refundIntent()
           writes com.etzhayyim.apps.payment.escrowRefunded
           NO on-chain tx (USDC was never moved)
           returns escrowRefundUri
           │
           └─► cancelProductionOrder() writes updated productionOrder
                with status=cancelled + escrowRefundUri
```

This is **record-state-machine escrow**, not on-chain escrow. State transitions are enforced by application logic + AT firehose audit trail, not by a Safe 2-of-3 contract. Migration to on-chain Safe-based escrow happens when [`@etzhayyim/sdk`](../../../20-actors/etzhayyim-sdk/src/pay.ts) ships v0.2 `escrowOpen()` / `escrowRelease()` (currently throws `"v0.2+"`).

## Usage

```ts
import { Etzhayyim } from "@etzhayyim/sdk";
import {
  createProductionOrder,
  cancelProductionOrder,
  submitInspection,
  getInspections,
} from "@etzhayyim/tsukuru-kotoba";

const e = new Etzhayyim({
  did: "did:web:customer.etzhayyim.com",
  pdsUrl: "https://pds.etzhayyim.com",
  l2RpcUrl: "https://mainnet.base.org",
  // ... session or auth
});

// 1. Create
const out = await createProductionOrder(
  e,
  {
    manufacturerDid: "did:web:tsukuru.etzhayyim.com:manufacturer:acme-precision",
    customerDid: "did:web:customer.etzhayyim.com",
    productSpec: { sku: "WIDGET-A", quantity: 100, cadCid: "bafy..." },
    fulfillmentMode: "bto",
    priority: "normal",
    payment: {
      method: "escrow_intent",
      amountUsdcMicros: 10_000_000_000, // 10,000 USDC
    },
  },
  { manufacturerWalletAddress: "0xACME...DEAD" }
);
// → { productionOrderUri, status: "pending", escrowIntentUri, ... }

// 2a. Cancel before delivery (record-only refund)
const cancel = await cancelProductionOrder(e, {
  productionOrderUri: out.productionOrderUri,
  reason: "spec change requested by buyer",
  cancelledByDid: "did:web:customer.etzhayyim.com",
});
// → { status: "cancelled", escrowRefundUri }

// 2b. OR — submit passing inspection at delivery (triggers settlement)
const inspect = await submitInspection(
  e,
  {
    productionOrderUri: out.productionOrderUri,
    inspectorDid: "did:web:qa-agent.etzhayyim.com",
    inspectionType: "final",
    result: "pass",
    defectRatePpm: 50,
    findings: ["all units within spec"],
    lotNumber: "L20260520-A",
  },
  {
    manufacturerWallet: "0xACME...DEAD",
    buyerPrivateKey: "0x..." as `0x${string}`, // Phase 2b+ replaces with smart-wallet signer
  }
);
// → { status: "settled", inspectionUri, paymentSentUri, txHash, ... }

// 3. List inspections
const list = await getInspections(e, {
  productionOrderUri: out.productionOrderUri,
});
// → { items: [InspectionView], total }
```

## What this package IS / ISN'T

**IS**:
- Reference implementation of 2 tsukuru commands on the etzhayyim substrate.
- Documentation (via code) of the vendor-Stripe → etzhayyim-escrow pattern translation.
- Type definitions aligned with the tightened lexicons (`productionOrder.{create,cancel}ProductionOrder.json` updated in this same PR).
- Module that builds standalone with @etzhayyim/sdk — `pnpm typecheck` passes.

**ISN'T**:
- A deployed Worker — there's no XRPC handler glue yet. Wiring lands when the etzhayyim Worker framework matures (see open-isco/kotoba for the seed.ts / query.ts CLI pattern as the current usage model).
- A production replacement for `tsukuru.etzhayyim.com` — vendor production runs with Stripe + RW until Phase 5 cutover (per ADR-2605202800 timeline 6-9 months).
- The full 46-command parity — 44 commands remain to be ported (Phase 2 follow-ups).
- On-chain escrow — Phase 2 is record-only intent; migration to Safe 2-of-3 lands when SDK v0.2 ships `escrowOpen()` / `escrowRelease()`.

## Related

- [ADR-2605202800](../../../90-docs/adr/2605202800-tsukuru-etzhayyim-business-model-change.md) — tsukuru full-move Phase 1-6 plan
- [ADR-2605202900](../../../90-docs/adr/2605202900-tsukuru-phase2-escrow-intent-pattern.md) — Phase 2 escrow_intent pattern design (this PR)
- [ADR-2605172000](../../../90-docs/adr/2605172000-etzhayyim-kotoba-substrate.md) — kotoba substrate
- [ADR-2605172100](../../../90-docs/adr/2605172100-etzhayyim-payments-on-chain-only.md) — payments on-chain only
- [@etzhayyim/sdk](../../../20-actors/etzhayyim-sdk/) — SDK reference
- [open-isco kotoba](../../etzhayyim-project-open-isco/kotoba/) — sibling reference impl (seeder + query CLI pattern)
