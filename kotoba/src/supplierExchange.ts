/**
 * tsukuru kotoba — supplierExchange (slice 6).
 *
 * normalizePackage + validatePackage. Per the lexicons these are
 * QUERY commands (pure compute, no PDS write). They normalize/
 * validate supplier-facing CAD/RFQ artifact envelopes for handoff.
 *
 * Per ADR-2604282300 (CF Worker = edge proxy only; execution in
 * K8s LangServer pods), the actual CAD/CAM/RFQ normalization
 * heavy-lift work lives in pod-side LangServer. This kotoba
 * module provides the edge-side handler that delegates: parses
 * input, returns synthesized envelope. Real pipeline integration
 * arrives when etzhayyim deploys its own LangServer fleet.
 *
 * For now: minimal envelope synthesis (pass-through with normalized
 * field names + defaults). Matches vendor src/app.ts behavior shape.
 */

import type {
  NormalizePackageInput,
  NormalizePackageOutput,
  ValidatePackageInput,
  ValidatePackageOutput,
} from "./types.js";

const DEFAULT_DESIGN_FORMATS = ["dwg", "step", "iges", "stl"] as const;

/**
 * Normalize a supplier exchange package envelope. Pure compute.
 *
 * Vendor: SELECT supplier from vertex_tsukuru_supplier WHERE did=?
 *         + apply known-format transforms + return.
 * etzhayyim: same input/output shape, defer heavy-lift to pod.
 */
export function normalizePackage(
  input: NormalizePackageInput
): NormalizePackageOutput {
  return {
    status: "ok",
    schema: "com.etzhayyim.apps.tsukuru.supplierExchange.v1",
    packageId: input.packageId ?? `pkg-${Date.now()}`,
    productionOrderId: input.productionOrderId,
    supplierDid: input.supplierDid,
    exchangeFormat: input.exchangeFormat ?? "neutral-cad",
    channels: input.channels ?? ["pds", "https"],
    designFormats: [...DEFAULT_DESIGN_FORMATS],
    artifacts: input.artifacts ?? [],
    requirements: input.requirements,
    compatibility: { ok: true, notes: [] },
    riskControls: ["sanctions-check", "export-control", "ip-watermark"],
  };
}

/**
 * Validate a supplier exchange package envelope. Pure compute.
 * Returns issues + verdict.
 */
export function validatePackage(
  input: ValidatePackageInput
): ValidatePackageOutput {
  const issues: string[] = [];
  if (!input.supplierDid) issues.push("missingSupplierDid");
  if (!input.artifacts || input.artifacts.length === 0)
    issues.push("missingArtifacts");
  if (!input.exchangeFormat) issues.push("missingExchangeFormat");
  return {
    status: issues.length === 0 ? "valid" : "invalid",
    packageId: input.packageId,
    issues,
    schema: "com.etzhayyim.apps.tsukuru.supplierExchange.v1",
  };
}
