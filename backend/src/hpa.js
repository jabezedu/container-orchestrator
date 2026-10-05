const db = require('./db');
const { recordEvent } = require('./events');

async function evaluateHPAs(client) {
  const hpasRes = await client.query(`
    SELECT h.*, d.name AS deployment_name, d.replicas, d.cpu_request, d.simulated_load
    FROM hpas h
    JOIN deployments d ON d.id = h.deployment_id
    WHERE h.is_enabled = true
  `);

  const now = Date.now();

  for (const hpa of hpasRes.rows) {
    const readyPodsRes = await client.query(
      `SELECT COUNT(*)::int AS count 
       FROM pods 
       WHERE deployment_id = $1 AND is_ready = true AND status != 'Terminating'`,
      [hpa.deployment_id]
    );

    const readyPods = readyPodsRes.rows[0].count;
    const cpuRequest = hpa.cpu_request || 250;
    const simulatedLoad = hpa.simulated_load || 0;

    let avgCpuPercent = 0;
    if (readyPods === 0) {
      avgCpuPercent = simulatedLoad > 0 ? 100 : 0;
    } else {
      const totalCapacity = readyPods * cpuRequest;
      avgCpuPercent = Math.min(100, Math.round((simulatedLoad / totalCapacity) * 100));
    }

    const currentReplicas = hpa.replicas;

    // Scale Out: avgCpuPercent > target_cpu_percent
    if (avgCpuPercent > hpa.target_cpu_percent) {
      let desired = Math.ceil(Math.max(1, readyPods) * (avgCpuPercent / hpa.target_cpu_percent));
      if (desired <= currentReplicas) {
        desired = currentReplicas + 1;
      }
      desired = Math.min(hpa.max_replicas, Math.max(hpa.min_replicas, desired));

      if (desired > currentReplicas) {
        await client.query(
          `UPDATE deployments SET replicas = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [desired, hpa.deployment_id]
        );

        await recordEvent(client, {
          type: 'Normal',
          reason: 'SuccessfulRescale',
          objectKind: 'HorizontalPodAutoscaler',
          objectName: hpa.deployment_name,
          message: `New size: ${desired}; reason: cpu resource utilization (${avgCpuPercent}%) above target (${hpa.target_cpu_percent}%)`
        });
      }
    } 
    // Scale In: avgCpuPercent < 60% of target
    else if (avgCpuPercent < Math.floor(hpa.target_cpu_percent * 0.6)) {
      let desired = avgCpuPercent === 0 
        ? hpa.min_replicas 
        : Math.ceil(Math.max(1, readyPods) * (avgCpuPercent / hpa.target_cpu_percent));
      desired = Math.min(hpa.max_replicas, Math.max(hpa.min_replicas, desired));

      if (desired < currentReplicas) {
        const lastScaleInTime = hpa.last_scale_in_at ? new Date(hpa.last_scale_in_at).getTime() : 0;
        const stabilizationWindowPassed = (now - lastScaleInTime) >= 15000;

        if (stabilizationWindowPassed) {
          await client.query(
            `UPDATE deployments SET replicas = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
            [desired, hpa.deployment_id]
          );

          await client.query(
            `UPDATE hpas SET last_scale_in_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [hpa.id]
          );

          await recordEvent(client, {
            type: 'Normal',
            reason: 'SuccessfulRescale',
            objectKind: 'HorizontalPodAutoscaler',
            objectName: hpa.deployment_name,
            message: `New size: ${desired}; reason: cpu resource utilization (${avgCpuPercent}%) below 60% of target`
          });
        }
      }
    }
  }
}

module.exports = {
  evaluateHPAs
};
