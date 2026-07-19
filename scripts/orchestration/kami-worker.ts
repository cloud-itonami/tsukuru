import { bpmnEngine } from './communication-worker.js';
import { KamiEngine } from './sdk-mocks/kami-engine.js';

console.log('[Worker] Starting Execution Worker (KAMI SDK)...');

// Listen for BPMN Task: 'executeManufacturingCell'
bpmnEngine.on('task:executeManufacturingCell', async (job) => {
  console.log(`\n[BPMN-Worker] Executing 'executeManufacturingCell' task for order: ${job.variables.orderUri}...`);

  try {
    const kami = new KamiEngine(`Cell-for-${job.variables.customerDid}`);

    // 1. Compile the 3D cell from the product spec
    const isCompiled = await kami.compileManufacturingCell(job.variables.productSpec);

    if (!isCompiled) {
      throw new Error("Cell compilation failed due to spatial constraints.");
    }

    // 2. Generate actual physical outputs (G-code, Robot Waypoints)
    const outputs = await kami.generateDeviceOutputs();

    console.log(`[BPMN-Worker] Physical outputs generated successfully.`);
    outputs.forEach(out => {
      console.log(`  -> Device: ${out.deviceId} (${out.deviceType}) | Payload Size: ${out.payload.length} bytes`);
    });

    // Complete the task and attach output variables back to the BPMN process
    setTimeout(() => {
      console.log(`[BPMN-Worker] Task 'executeManufacturingCell' completed.`);
      bpmnEngine.emit('taskCompleted', {
        taskId: job.taskId,
        result: {
          kamiOutputs: outputs
        }
      });
    }, 300);

  } catch (error: any) {
    console.error(`[BPMN-Worker] Task failed: ${error.message}`);
    // In a real BPMN engine, we would emit a 'taskFailed' or throw a BPMN error
  }
});
