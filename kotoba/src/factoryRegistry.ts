/**
 * tsukuru kotoba — factoryRegistry (slice 5).
 *
 * Per ADR-2605202800 Phase 2 + ADR-2605203000 Option B (PDS XRPC).
 * Factories are children of manufacturers in the authority chain:
 *   manufacturer:{slug}  →  factory:{slug}
 *
 * Idempotency via rkey=slug, matching the manufacturerRegistry pattern
 * (slice 3 etz #84).
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  factoryDid,
  type FactoryRecord,
  type FactoryView,
  type ListFactoriesInput,
  type ListFactoriesOutput,
  type RegisterFactoryInput,
  type RegisterFactoryOutput,
} from "./types.js";

const FACTORY_COLLECTION = "com.etzhayyim.apps.tsukuru.factory";

export async function registerFactory(
  e: Etzhayyim,
  input: RegisterFactoryInput
): Promise<RegisterFactoryOutput> {
  if (!input.slug || !input.manufacturerDid || !input.factoryName || !input.countryIso3) {
    return { status: "rejected", error: "missingRequiredFields" };
  }

  const existing = await e
    .read<FactoryRecord>({ collection: FACTORY_COLLECTION, rkey: input.slug })
    .catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return {
      status: "alreadyExists",
      factoryUri: existing.records[0].uri,
      did: existing.records[0].value.did,
    };
  }

  const did = factoryDid(input.slug);
  const record: FactoryRecord = {
    did,
    slug: input.slug,
    manufacturerDid: input.manufacturerDid,
    factoryName: input.factoryName,
    countryIso3: input.countryIso3,
    city: input.city,
    addressLine: input.addressLine,
    postalCode: input.postalCode,
    capacityLevel: input.capacityLevel,
    certifications: input.certifications,
    createdAt: new Date().toISOString(),
  };

  const receipt = await e.write({
    collection: FACTORY_COLLECTION,
    record: record as unknown as Record<string, unknown>,
    rkey: input.slug,
  });

  return {
    status: "registered",
    factoryUri: receipt.uri,
    did,
  };
}

export async function listFactories(
  e: Etzhayyim,
  input: ListFactoriesInput = {}
): Promise<ListFactoriesOutput> {
  const limit = Math.min(input.limit ?? 50, 100);
  const resp = await e.read<FactoryRecord>({
    collection: FACTORY_COLLECTION,
    cursor: input.cursor,
    limit,
  });

  const items: FactoryView[] = resp.records
    .filter((r) => {
      const v = r.value;
      if (input.manufacturerDid && v.manufacturerDid !== input.manufacturerDid) return false;
      if (input.countryIso3 && v.countryIso3 !== input.countryIso3) return false;
      return true;
    })
    .map((r) => ({ ...r.value, factoryUri: r.uri }));

  return { items, cursor: resp.cursor, total: items.length };
}
