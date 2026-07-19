/**
 * tsukuru kotoba — barrel export.
 *
 * Per ADR-2605202800 + ADR-2605202900 Phase 2 reference implementation
 * of productionOrder.create + cancel using @etzhayyim/sdk PDS XRPC
 * writes + escrow_intent pattern (deferred USDC settlement).
 *
 * NOT a Worker. Pure TS module to be wired into an XRPC handler when
 * the etzhayyim Worker framework matures (see open-isco/kotoba for
 * the seed.ts / query.ts pattern).
 */

export * from "./types.js";
export { openIntent, refundIntent } from "./escrow.js";
export type { OpenIntentOpts, RefundIntentOpts } from "./escrow.js";
export { settleEscrow } from "./settle.js";
export type { SettleEscrowOpts } from "./settle.js";
export {
  createProductionOrder,
  cancelProductionOrder,
  getProductionOrder,
  listProductionOrders,
  updateOrderStatus,
  estimateLeadTime,
} from "./productionOrder.js";
export { submitInspection, getInspections } from "./qualityInspection.js";
export {
  registerManufacturer,
  getManufacturer,
  listManufacturers,
  searchManufacturers,
  getManufacturerStats,
} from "./manufacturerRegistry.js";
export { registerFactory, listFactories } from "./factoryRegistry.js";
export { reportMilestone, getProgress } from "./productionProgress.js";
export { normalizePackage, validatePackage } from "./supplierExchange.js";
export {
  euvDesignManufacturingFlow,
  euvPrepareOrderPackage,
  euvGetImplementationCoverage,
} from "./euv.js";
export {
  cntDesignManufacturingFlow,
  cntPlanAutomation,
  cntGetAutomationCoverage,
  cntPrepareOrderPackage,
  cntPrepareRunPackage,
  cntValidateRunPackage,
  cntGetProcessCatalog,
} from "./cnt.js";
export {
  designCell,
  planDeviceOutput,
  designStack,
  planRoute,
  planOperation,
} from "./planning.js";
export {
  screenDeniedParties,
  screenExportControl,
  classifyProduct,
  getIndustryActor,
  listIndustryActors,
  getIndustryProfile,
  listIndustryProfiles,
  resolveProcess,
  recordCertification,
  listCertifications,
  tsukuruStats,
  tsukuruWave,
} from "./closure.js";
