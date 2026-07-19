import { atprotoFirehose } from './communication-worker.js';
import './kami-worker.js';
import './logistics-worker.js';

console.log('=================================================================');
console.log(' Tsukuru E2E Orchestration Daemon (Continuous Operation Mode) ');
console.log('=================================================================\n');
console.log('[Daemon] Initializing workers and connecting to Firehose (Mock)...');

// Helper to generate random orders
const customers = ['alice.etzhayyim.com', 'bob.corp.com', 'charlie.robotics.io'];
const productSpecs = [
  { type: 'kami-3d-cell-spec', details: 'CNC milling and 3D printing combo cell', weightKg: 12.5 },
  { type: 'kami-pcb-assembly', details: 'Automated PCB pick-and-place cell', weightKg: 2.1 },
  { type: 'kami-cnt-fiber', details: 'Carbon Nanotube fiber extrusion module', weightKg: 8.4 }
];

let orderCount = 0;

async function runDaemon() {
  console.log('[Daemon] Entering continuous listening loop. Press Ctrl+C to exit.\n');

  // Loop indefinitely
  while (true) {
    orderCount++;
    const customer = customers[Math.floor(Math.random() * customers.length)];
    const spec = productSpecs[Math.floor(Math.random() * productSpecs.length)];
    const rId = Math.random().toString(36).substring(2, 8);

    const mockRecord = {
      uri: `at://did:web:${customer}/com.etzhayyim.apps.tsukuru.productionOrder/${rId}`,
      manufacturerDid: 'did:web:tsukuru.etzhayyim.com',
      customerDid: `did:web:${customer}`,
      contactEmail: `procurement@${customer.replace('.com', '.net')}`,
      deliveryAddress: `Logistics Hub - ${customer}`,
      productSpec: {
        type: spec.type,
        details: spec.details,
        estimatedWeightKg: spec.weightKg
      }
    };

    console.log(`\n-----------------------------------------------------------------`);
    console.log(`[Daemon] 🕒 Timestamp: ${new Date().toISOString()}`);
    console.log(`[Daemon] 📥 New Incoming Order #${orderCount} Detected on Firehose!`);
    console.log(`-----------------------------------------------------------------`);

    // Trigger the flow
    atprotoFirehose.emit('createProductionOrder', mockRecord);

    // Wait for a random interval between 15 to 25 seconds before the next order arrives
    // This allows the current pipeline to mostly complete, simulating real-world staggered traffic.
    const waitTimeMs = Math.floor(Math.random() * 10000) + 15000;
    console.log(`[Daemon] 💤 Waiting ${waitTimeMs / 1000} seconds for next event...`);

    await new Promise(resolve => setTimeout(resolve, waitTimeMs));
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Daemon] Graceful shutdown initiated. Exiting loop...');
  process.exit(0);
});

runDaemon().catch(console.error);
