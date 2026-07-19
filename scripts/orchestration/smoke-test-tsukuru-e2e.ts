import { atprotoFirehose } from './communication-worker.js';
import './kami-worker.js'; // Ensure KAMI worker is loaded
import './logistics-worker.js'; // Ensure Logistics worker is loaded

async function runSmokeTest() {
  console.log('=== Tsukuru E2E Smoke Test (Phase 4: XRPC & OpenMail Postage Integration) ===');
  console.log('Initiating test sequence...');

  // Mock an incoming AT Protocol record
  const mockRecord = {
    uri: 'at://did:web:customer.etzhayyim.com/com.etzhayyim.apps.tsukuru.productionOrder/3jxy2z...',
    manufacturerDid: 'did:web:tsukuru.etzhayyim.com',
    customerDid: 'did:web:customer.etzhayyim.com',
    contactEmail: 'buyer@example.com',
    deliveryAddress: 'Etzhayyim Innovation Lab, Zone B',
    productSpec: {
      type: 'kami-3d-cell-spec',
      details: 'CNC milling and 3D printing combo cell',
      estimatedWeightKg: 1.5 // Suitable for drone delivery
    }
  };

  console.log('\n[Test] Emitting createProductionOrder event to Atproto Firehose...');
  atprotoFirehose.emit('createProductionOrder', mockRecord);

  // Wait for async events to settle (Wait 12 seconds for full pipeline to complete)
  await new Promise(resolve => setTimeout(resolve, 12000));

  console.log('\n=== Smoke Test Completed ===');
}

runSmokeTest().catch(console.error);
