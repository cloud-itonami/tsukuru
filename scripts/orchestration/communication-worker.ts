import { EventEmitter } from 'events';
import { MstRepoClient } from './mst/mst-repo-client.js';

// Mock AT Protocol Firehose Event Emitter
export const atprotoFirehose = new EventEmitter();

// Mock BPMN Engine
export const bpmnEngine = new EventEmitter();

console.log('[Worker] Starting Communication Worker (Atproto, MST & Email)...');

// 1. Listen for Atproto Production Order Creation
atprotoFirehose.on('createProductionOrder', (record) => {
  console.log(`[Atproto] Detected new productionOrder: ${record.uri}`);
  console.log(`[Atproto] -> Triggering BPMN process for manufacturer: ${record.manufacturerDid}`);

  // Kick off BPMN process
  setTimeout(() => {
    bpmnEngine.emit('startProcess', {
      processId: 'tsukuru_manufacturing_flow',
      variables: {
        orderUri: record.uri,
        customerDid: record.customerDid,
        contactEmail: record.contactEmail || 'customer@example.com',
        productSpec: record.productSpec
      }
    });
  }, 500);
});

// Phase 4: OpenMail Postage Smart Contract Simulation
async function payOpenMailPostage(recipientEmail: string, orderUri: string) {
  const messageHash = `0x${Math.random().toString(16).slice(2, 66).padEnd(64, '0')}`;
  console.log(`\n[OpenMail-Postage] Preparing to send message to ${recipientEmail}`);
  console.log(`[OpenMail-Postage] Paying on-chain postage... (Simulated Base L2 TX)`);
  console.log(`[OpenMail-Postage]   -> Contract: Postage.sol`);
  console.log(`[OpenMail-Postage]   -> Call: payPostage(messageHash: ${messageHash}, recipientCount: 1)`);

  await new Promise(resolve => setTimeout(resolve, 800)); // Simulate L2 block inclusion time

  const txHash = `0x${Math.random().toString(16).slice(2, 66).padEnd(64, 'a')}`;
  console.log(`[OpenMail-Postage] TX confirmed: ${txHash}. Paid event emitted.`);
  return txHash;
}

// Phase 7: MST (Merkle Search Tree) / Atproto Sync Simulation
async function writeProjectorRecord(customerDid: string, status: string, convoId: string) {
  const mstClient = new MstRepoClient(customerDid);

  const record = {
    projectId: "tsukuru-manufacturing",
    name: "Tsukuru Order Progress",
    convoId: convoId,
    status: status,
    $type: "com.etzhayyim.projector#main"
  };

  const rkey = `order-${Date.now()}`;
  await mstClient.appendToMst({
    collection: "com.etzhayyim.projector",
    rkey: rkey,
    record: record
  });
}

// 2. Listen for BPMN Tasks (Email & Projector)
bpmnEngine.on('task:sendEmail', async (job) => {
  console.log(`\n[BPMN-Worker] Executing 'sendEmail' task...`);

  // Pay openmail postage on-chain
  const txHash = await payOpenMailPostage(job.variables.contactEmail, job.variables.orderUri);

  console.log(`[Email-Gateway] Sending email to ${job.variables.contactEmail}: "Your order ${job.variables.orderUri} is now in progress." (Postage TX: ${txHash})`);

  console.log(`[BPMN-Worker] Task 'sendEmail' completed.`);
  bpmnEngine.emit('taskCompleted', { taskId: job.taskId });
});

bpmnEngine.on('task:updateProjector', async (job) => {
  console.log(`\n[BPMN-Worker] Executing 'updateProjector' task...`);

  await writeProjectorRecord(job.variables.customerDid, job.variables.status, job.variables.orderUri);

  console.log(`[BPMN-Worker] Task 'updateProjector' completed.`);
  bpmnEngine.emit('taskCompleted', { taskId: job.taskId });
});

// BPMN Process Orchestration Mock
bpmnEngine.on('startProcess', (instance) => {
  console.log(`\n[BPMN-Engine] Process started: ${instance.processId}`);

  // 1. Update Projector (Started)
  setTimeout(() => {
    bpmnEngine.emit('task:updateProjector', { taskId: 'proj-1', variables: { ...instance.variables, status: 'started' } });
  }, 100);

  // 2. Send Initial Email
  setTimeout(() => {
    bpmnEngine.emit('task:sendEmail', { taskId: 'email-1', variables: instance.variables });
  }, 1200);

  // 3. Execute Manufacturing Cell (KAMI SDK)
  setTimeout(() => {
    bpmnEngine.emit('task:executeManufacturingCell', { taskId: 'kami-1', variables: instance.variables });
  }, 3500);

  // 4. Update Projector (Manufactured) & Execute Logistics
  setTimeout(() => {
    bpmnEngine.emit('task:updateProjector', { taskId: 'proj-2', variables: { ...instance.variables, status: 'manufactured' } });
    bpmnEngine.emit('task:planDeliveryRoute', { taskId: 'logistics-1', variables: instance.variables });
  }, 6000);

  // 5. Update Projector (In Transit) & Final Email (triggered after Logistics task completes)
  setTimeout(() => {
    bpmnEngine.emit('task:updateProjector', { taskId: 'proj-3', variables: { ...instance.variables, status: 'in-transit' } });
    bpmnEngine.emit('task:sendEmail', { taskId: 'email-2', variables: { ...instance.variables, orderUri: instance.variables.orderUri + " (IN TRANSIT)" } });
  }, 8500);
});
