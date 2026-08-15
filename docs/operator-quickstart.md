# Operator quickstart

**37 files, twelve domain modules, an orchestration daemon with Kubernetes
manifests — and the one thing you can run offline returns the cheapest freight
quote in the table when you pass it a modality it does not know.**

This is the richest repository in the migrated cohort. Steps marked ✅ were run
against this tree on 2026-08-16.

---

## 1. The planner runs with nothing installed ✅

`kotoba/src/planning.ts` imports the SDK as `import type`, which type-stripping
erases, so Node loads it directly. Walked on Node v26.3.0, where
`--experimental-strip-types` is a no-op (default from Node 23) and required on
22.6–22.x:

```bash
cat > /tmp/tsuwalk.mjs <<'EOF'
const p = await import(process.argv[2]);
const base = { orderUri: "at://x/o/1", fromCountry: "JP", toCountry: "US" };
for (const m of ["sea", "air", "land", "multimodal", undefined, "rail"]) {
  const out = p.planRoute({ ...base, ...(m === undefined ? {} : { modality: m }) });
  console.log(String(m).padEnd(11), "days=" + String(out.estimatedTransitDays).padStart(3),
              " costUsdcMicros=" + out.estimatedCostUsdcMicros,
              " (" + (out.estimatedCostUsdcMicros / 1e6) + " USDC)");
}
EOF

node --experimental-strip-types /tmp/tsuwalk.mjs kotoba/src/planning.ts
```

Actual output:

```
sea         days= 30  costUsdcMicros=100000000  (100 USDC)
air         days=  5  costUsdcMicros=500000000  (500 USDC)
land        days=  7  costUsdcMicros=200000000  (200 USDC)
multimodal  days= 14  costUsdcMicros=300000000  (300 USDC)
undefined   days= 14  costUsdcMicros=300000000  (300 USDC)
rail        days= 14  costUsdcMicros=100000000  (100 USDC)
```

`escrow.ts` also loads (`openIntent`, `refundIntent`), but it takes an `Etzhayyim`
client and moves money, so it is not exercised here. `settle.ts` does not load at
all — `ERR_MODULE_NOT_FOUND`, a value import it cannot resolve from disk.

## 2. ⚠ An unrecognised modality is quoted at the cheapest rate in the table

Look at the last two rows above. Omitting `modality` gives 14 days and 300 USDC,
because the parameter defaults to `"multimodal"` — consistent. Passing `"rail"`
gives **14 days and 100 USDC**, which is no row in the table: the transit time
falls back to multimodal's 14 while the cost falls back to sea's multiplier.

The cause is two fallbacks that disagree, on consecutive lines of `planRoute`
(95 and 96):

```ts
const estimatedTransitDays     = transitDaysByModality[modality] ?? 14;   // multimodal's value
const estimatedCostUsdcMicros  = 100_000_000 * (costMultiplier[modality] ?? 1); // sea's multiplier
```

So an unknown modality produces **the cheapest quote the function can emit**, with a
mid-range transit time, and `status: "ok"`. Nothing signals that the modality was
not recognised. `"rail"` is not a contrived input for a factory-direct logistics
platform — neither is `"ocean"`, `"truck"` or a typo.

Whether the fix is to reject an unknown modality, to make both fallbacks agree, or
to widen the table is the app owner's call. What is not in question is that a caller
cannot currently tell a rail quote from a sea quote from a mistake.

## 3. ⚠ The deprecated nanoid is still in this repository's own metadata

`CLAUDE.md` states the rule at the top:

> Canonical nanoid is `tsukr8u0`. `0ljdfw8u` is deprecated (alpha-start violation)
> and **must not be used in new paths, hosts, component names, or deploy commands**.

Measured:

```bash
git grep -c '0ljdfw8u' -- .
#   CLAUDE.md:1        <- the prohibition itself
#   PROJECT.jsonld:2
git grep -o '"[^"]*0ljdfw8u[^"]*"' PROJECT.jsonld
#   "etzhayyim-wasm-tsukuru-0ljdfw8u"
#   "...API at 0ljdfw8u.etzhayyim.com/api/grpc."
```

A **component name** and a **host** — two of the four categories the rule names, in
the file that describes the project. Note also that the canonical API base in
`CLAUDE.md` is `https://tsukr8u0.etzhayyim.com/xrpc`, so the two documents disagree
about both the host and the protocol (`/xrpc` against `/api/grpc`).

## 4. What is here and does not run from a checkout ⚠ NOT WALKED

- **Twelve domain modules** under `kotoba/src/`: closure, cnt, escrow, euv,
  factoryRegistry, manufacturerRegistry, planning, productionOrder,
  productionProgress, qualityInspection, settle, supplierExchange. Seven import the
  SDK as `import type` only; the rest need it at runtime.
- **An orchestration daemon** — `scripts/orchestration/daemon.ts` plus
  communication, kami and logistics workers, an MST repo client, and
  `sdk-mocks/`. The daemon does not load from disk (`ERR_MODULE_NOT_FOUND`). The
  mocks are the interesting part: something here was built to be testable without
  the real engines, and `smoke-test-tsukuru-e2e.ts` imports only local modules, so
  an offline end-to-end may be reachable after an install. Not attempted here.
- **A deployment**: `Dockerfile.orchestrator` and
  `k8s/orchestrator-deployment.yaml`. This is the first repository in the cohort
  with Kubernetes manifests rather than a Cloudflare `wrangler.jsonc`.
- `scripts/register-isic-industry-actors.mjs` is a raw `.mjs`. The workspace rule is
  that new first-party tooling is written in nbb rather than `.mjs` or shell, so
  this is a pre-existing file to migrate rather than a pattern to copy.

## 5. What the maturity instrument cannot see here ✅

The loop's own tick now reports this, and it is worth repeating in the repository it
concerns:

```
· orgs/cloud-itonami/tsukuru  own=0.043
    axis-ingest は 0bp だが計数外のファイルに URL が 12 件在る
    README が .md ではないので docs の README 成分は 0
```

Both are instrument blind spots recorded in ADR-2608052000, not absences. The twelve
URLs include `atproto.etzhayyim.com`, `pds.etzhayyim.com`, `mainnet.base.org`,
`resources.etzhayyim.com` identifiers and `schema.org`; the citation counter looks
only under `facts`/`catalog`/`data`, and the README component reads only
`README.md` while this repository has `README.edn`.

**So do not read `own=0.043` as an empty repository.** It is the richest one in the
cohort measured by an instrument looking in four places it does not keep its things.

`migration.edn` records the extraction; this document was added to its
`:identity/:allowed-additions`.
