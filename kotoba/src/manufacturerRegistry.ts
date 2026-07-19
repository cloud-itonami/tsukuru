/**
 * tsukuru kotoba — manufacturerRegistry (5 commands).
 *
 * Replaces vendor `60-apps/etzhayyim-project-tsukuru/appview/tsukuru-
 * tsukr8u0/src/app.ts:548-720` with @etzhayyim/sdk equivalents.
 *
 * Foundational module: without it no manufacturers exist for
 * productionOrder.create to reference. Mints path-based DIDs
 * (did:web:tsukuru.etzhayyim.com:manufacturer:{slug}) on register.
 *
 * Phase 2 limitations (Phase 3 mst-projector fixes):
 *  - list filters: post-fetch since MST traversal is rkey-prefix.
 *  - search: client-side text matching (no embedding/IVF yet).
 *  - stats: full-scan + bucket count on every call.
 *
 * The lexicons document these as expected Phase 3 migration targets.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  manufacturerDid,
  type GetManufacturerInput,
  type GetManufacturerOutput,
  type GetManufacturerStatsInput,
  type GetManufacturerStatsOutput,
  type ListManufacturersInput,
  type ListManufacturersOutput,
  type ManufacturerRecord,
  type ManufacturerView,
  type RegisterManufacturerInput,
  type RegisterManufacturerOutput,
  type SearchManufacturersInput,
  type SearchManufacturersOutput,
  type StatsBucket,
  type StatsGroupBy,
} from "./types.js";

const MANUFACTURER_COLLECTION = "com.etzhayyim.apps.tsukuru.manufacturer";

/**
 * Register a new manufacturer. Uses slug as rkey so re-registration
 * with the same slug returns alreadyExists (idempotent).
 */
export async function registerManufacturer(
  e: Etzhayyim,
  input: RegisterManufacturerInput
): Promise<RegisterManufacturerOutput> {
  if (!input.slug || !input.legalName || !input.countryIso3) {
    return {
      status: "rejected",
      error: "missingRequiredFields",
    };
  }

  // Check for duplicate by reading the existing rkey=slug record.
  // If present, return alreadyExists.
  const existing = await e
    .read<ManufacturerRecord>({
      collection: MANUFACTURER_COLLECTION,
      rkey: input.slug,
    })
    .catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    const v = existing.records[0].value;
    return {
      status: "alreadyExists",
      did: v.did,
      manufacturerUri: existing.records[0].uri,
      onboardingStatus: v.onboardingStatus,
    };
  }

  const did = manufacturerDid(input.slug);
  const record: ManufacturerRecord = {
    did,
    slug: input.slug,
    legalName: input.legalName,
    tradeName: input.tradeName,
    countryIso3: input.countryIso3,
    isicCodes: input.isicCodes,
    category: input.category ?? "other-manufacturing",
    factoryType: input.factoryType ?? "oem",
    contactEmail: input.contactEmail,
    website: input.website,
    lei: input.lei,
    walletAddress: input.walletAddress,
    verificationTier: "basic",
    onboardingStatus: "pending-review",
    createdAt: new Date().toISOString(),
  };

  const receipt = await e.write({
    collection: MANUFACTURER_COLLECTION,
    record: record as unknown as Record<string, unknown>,
    rkey: input.slug,
  });

  return {
    status: "registered",
    manufacturerUri: receipt.uri,
    did,
    onboardingStatus: "pending-review",
  };
}

/** Get a manufacturer by DID or slug. Returns notFound if neither resolves. */
export async function getManufacturer(
  e: Etzhayyim,
  input: GetManufacturerInput
): Promise<GetManufacturerOutput> {
  const slug = input.slug ?? slugFromDid(input.did);
  if (!slug) {
    return { error: "missingDidOrSlug" };
  }

  const resp = await e
    .read<ManufacturerRecord>({
      collection: MANUFACTURER_COLLECTION,
      rkey: slug,
    })
    .catch(() => ({ records: [] }));
  const r = resp.records[0];
  if (!r) {
    return { error: "notFound" };
  }
  return {
    manufacturer: { ...r.value, manufacturerUri: r.uri },
  };
}

/**
 * List manufacturers with cursor pagination + post-fetch filters.
 * Phase 3 will move these filters into mst-projector indexed views.
 */
export async function listManufacturers(
  e: Etzhayyim,
  input: ListManufacturersInput = {}
): Promise<ListManufacturersOutput> {
  const limit = Math.min(input.limit ?? 50, 100);
  const resp = await e.read<ManufacturerRecord>({
    collection: MANUFACTURER_COLLECTION,
    cursor: input.cursor,
    limit,
  });

  const items = resp.records
    .filter((r) => matchesListFilter(r.value, input))
    .map<ManufacturerView>((r) => ({ ...r.value, manufacturerUri: r.uri }));

  return {
    items,
    cursor: resp.cursor,
    total: items.length,
  };
}

/**
 * Search manufacturers by free-text matching of query against
 * legalName / tradeName / category, plus filters by ISIC code +
 * min verification tier. Phase 2 = client-side text matching;
 * Phase 3 = mst-projector + IVF embedding index.
 */
export async function searchManufacturers(
  e: Etzhayyim,
  input: SearchManufacturersInput
): Promise<SearchManufacturersOutput> {
  if (!input.query) {
    return { items: [], total: 0 };
  }
  const limit = Math.min(input.limit ?? 20, 50);
  const resp = await e.read<ManufacturerRecord>({
    collection: MANUFACTURER_COLLECTION,
    cursor: input.cursor,
    limit,
  });

  const q = input.query.toLowerCase();
  const minTierRank = tierRank(input.minTier ?? "basic");
  const items = resp.records
    .filter((r) => {
      const v = r.value;
      // Verification tier gate.
      if (tierRank(v.verificationTier) < minTierRank) return false;
      // ISIC filter.
      if (input.isicCode) {
        if (!v.isicCodes?.includes(input.isicCode)) return false;
      }
      // Text match (Phase 2: naive substring; Phase 3: embedding).
      return matchesText(v, q);
    })
    .map<ManufacturerView>((r) => ({ ...r.value, manufacturerUri: r.uri }));

  return {
    items,
    cursor: resp.cursor,
    total: items.length,
  };
}

/**
 * Aggregate stats grouped by a single field. Phase 2 = full-scan +
 * client-side bucket; Phase 3 = mst-projector pre-computed counts.
 */
export async function getManufacturerStats(
  e: Etzhayyim,
  input: GetManufacturerStatsInput = {}
): Promise<GetManufacturerStatsOutput> {
  const groupBy: StatsGroupBy = input.groupBy ?? "countryIso3";

  const buckets = new Map<string, number>();
  let total = 0;
  let cursor: string | undefined;

  // Full-scan with cursor pagination (Phase 2 limitation).
  do {
    const resp = await e.read<ManufacturerRecord>({
      collection: MANUFACTURER_COLLECTION,
      cursor,
      limit: 100,
    });
    for (const r of resp.records) {
      const key = bucketKey(r.value, groupBy) || "(unknown)";
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
      total++;
    }
    cursor = resp.cursor;
  } while (cursor);

  const sortedBuckets: StatsBucket[] = [...buckets.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);

  return {
    total,
    buckets: sortedBuckets,
    groupBy,
    computedAt: new Date().toISOString(),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function slugFromDid(did?: string): string {
  if (!did) return "";
  const prefix = "did:web:tsukuru.etzhayyim.com:manufacturer:";
  return did.startsWith(prefix) ? did.slice(prefix.length) : "";
}

function tierRank(t: ManufacturerRecord["verificationTier"]): number {
  return { basic: 0, verified: 1, audited: 2 }[t];
}

function matchesListFilter(
  v: ManufacturerRecord,
  filter: ListManufacturersInput
): boolean {
  if (filter.category && v.category !== filter.category) return false;
  if (filter.countryIso3 && v.countryIso3 !== filter.countryIso3) return false;
  if (filter.onboardingStatus && v.onboardingStatus !== filter.onboardingStatus)
    return false;
  if (filter.factoryType && v.factoryType !== filter.factoryType) return false;
  return true;
}

function matchesText(v: ManufacturerRecord, q: string): boolean {
  if (v.legalName.toLowerCase().includes(q)) return true;
  if (v.tradeName?.toLowerCase().includes(q)) return true;
  if (v.category?.toLowerCase().includes(q)) return true;
  if (v.slug.toLowerCase().includes(q)) return true;
  return false;
}

function bucketKey(v: ManufacturerRecord, groupBy: StatsGroupBy): string {
  switch (groupBy) {
    case "countryIso3":
      return v.countryIso3;
    case "category":
      return v.category ?? "";
    case "factoryType":
      return v.factoryType;
    case "verificationTier":
      return v.verificationTier;
    case "onboardingStatus":
      return v.onboardingStatus;
  }
}
