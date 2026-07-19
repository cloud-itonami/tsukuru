import { bpmnEngine } from './communication-worker.js';
import { LogisticsEngine } from './sdk-mocks/logistics-engine.js';

console.log('[Worker] Starting Logistics Worker (Drone/AGV routing)...');

// Listen for BPMN Task: 'planDeliveryRoute'
bpmnEngine.on('task:planDeliveryRoute', async (job) => {
  console.log(`\n[BPMN-Worker] Executing 'planDeliveryRoute' task for order: ${job.variables.orderUri}...`);

  try {
    const logistics = new LogisticsEngine();

    const routePlan = await logistics.planRoute({
      orderUri: job.variables.orderUri,
      destination: job.variables.deliveryAddress || 'Customer Default Facility',
      payloadWeightKg: job.variables.productSpec?.estimatedWeightKg || 2.5 // Default to drone eligible
    });

    console.log(`[BPMN-Worker] Delivery route dispatched to ${routePlan.vehicleId}`);

    // Complete the task
    setTimeout(() => {
      console.log(`[BPMN-Worker] Task 'planDeliveryRoute' completed.`);
      bpmnEngine.emit('taskCompleted', {
        taskId: job.taskId,
        result: { routePlan }
      });
    }, 300);

  } catch (error: any) {
    console.error(`[BPMN-Worker] Task failed: ${error.message}`);
  }
});
