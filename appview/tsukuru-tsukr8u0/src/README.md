# tsukuru appview src — Phase 2 rewrite pending

Vendor `60-apps/etzhayyim-project-tsukuru/appview/tsukuru-tsukr8u0/src/app.ts`
is the current production B2B factory-direct ordering platform. It uses:

- `createKyselyDb()` — RisingWave Hyperdrive direct write (T2 Domain path)
- `did:web:stripe.etzhayyim.com cancelCard` invoke — Stripe Issuing virtual cards
- `payment.method = "stripe_issuing"` — fiat USD card-based factory payment

Per **ADR-2605172000** (etzhayyim kotoba substrate) and **ADR-2605172100**
(payments on-chain only), the etzhayyim deploy must:

1. Replace `createKyselyDb()` writes with PDS XRPC `createRecord` against
   etzhayyim PDS (collection `ai.etzhayyim.apps.tsukuru.*`).
2. Replace `stripe_issuing` payment with ERC-4337 + USDC on Base L2 via
   `@etzhayyim/sdk` `pay()` (ADR-2605172100 reference impl).
3. Replace `did:web:stripe.etzhayyim.com` invokes with on-chain equivalents
   (USDC transfer + ERC-4337 Paymaster `etzhayyim-paymaster`).

This rewrite is Phase 2 of the tsukuru full-move plan recorded in:
- This repo: ADR-2605202800-tsukuru-etzhayyim-business-model-change.md
- vendor deps.toml: `tranche-f-tsukuru-etzhayyim-fullmove-2026-05-20`

Until Phase 2 lands, `tsukuru.etzhayyim.com` is NOT deployed; only the
spec / lexicon / BPMN / actor-manifest live in etzhayyim/root.
