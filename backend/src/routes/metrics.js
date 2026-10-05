const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/metrics/history
router.get('/history', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM metrics_history ORDER BY created_at ASC LIMIT 300`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Metrics history error:', err);
    res.status(500).json({ error: 'Failed to retrieve metrics history' });
  }
});

// GET /api/overview
router.get('/overview', async (req, res) => {
  try {
    // 1. Nodes summary
    const nodesRes = await db.query('SELECT * FROM nodes ORDER BY id ASC');
    const nodes = nodesRes.rows;
    const readyNodes = nodes.filter(n => n.status === 'Ready').length;
    const totalCpuCapacity = nodes.reduce((sum, n) => sum + n.cpu_capacity, 0);
    const totalMemoryCapacity = nodes.reduce((sum, n) => sum + n.memory_capacity, 0);

    // 2. Pods summary
    const podsRes = await db.query(`
      SELECT p.*, n.name AS node_name, d.name AS deployment_name
      FROM pods p
      LEFT JOIN nodes n ON n.id = p.node_id
      LEFT JOIN deployments d ON d.id = p.deployment_id
      WHERE p.status != 'Terminating'
      ORDER BY p.id ASC
    `);
    const pods = podsRes.rows;

    const podStateCounts = {
      running: pods.filter(p => p.status === 'Running' || p.status === 'Ready').length,
      ready: pods.filter(p => p.is_ready).length,
      pending: pods.filter(p => p.status === 'Pending').length,
      container_creating: pods.filter(p => p.status === 'ContainerCreating').length,
      failing: pods.filter(p => p.status === 'CrashLoopBackOff' || p.status === 'Unknown').length,
      total: pods.length
    };

    let totalCpuRequested = 0;
    let totalMemoryRequested = 0;
    pods.forEach(p => {
      totalCpuRequested += p.cpu_request;
      totalMemoryRequested += p.memory_request;
    });

    // 3. Per-node breakdown
    const nodeAllocationMap = nodes.map(n => {
      const assigned = pods.filter(p => p.node_id === n.id);
      const cpu = assigned.reduce((sum, p) => sum + p.cpu_request, 0);
      const mem = assigned.reduce((sum, p) => sum + p.memory_request, 0);

      return {
        id: n.id,
        name: n.name,
        status: n.status,
        is_cordoned: n.is_cordoned,
        cpu_capacity: n.cpu_capacity,
        memory_capacity: n.memory_capacity,
        allocated_cpu: cpu,
        allocated_memory: mem,
        cpu_percent: Math.min(100, Math.round((cpu / n.cpu_capacity) * 100)),
        memory_percent: Math.min(100, Math.round((mem / n.memory_capacity) * 100)),
        pod_count: assigned.length,
        pods: assigned.map(p => ({
          name: p.name,
          status: p.status,
          is_ready: p.is_ready
        }))
      };
    });

    // 4. Deployment health
    const depsRes = await db.query('SELECT * FROM deployments ORDER BY id ASC');
    const deployments = depsRes.rows;
    let healthyDeployments = 0;
    let totalReplicasDesired = 0;

    deployments.forEach(d => {
      totalReplicasDesired += d.replicas;
      const readyForDep = pods.filter(p => p.deployment_id === d.id && p.is_ready).length;
      if (readyForDep >= d.replicas && d.rollout_status === 'Complete') {
        healthyDeployments++;
      }
    });

    // 5. Latest 8 events
    const eventsRes = await db.query('SELECT * FROM events ORDER BY created_at DESC, id DESC LIMIT 8');

    res.json({
      nodes: {
        ready: readyNodes,
        total: nodes.length,
        total_cpu_capacity: totalCpuCapacity,
        total_memory_capacity: totalMemoryCapacity,
        allocated_cpu: totalCpuRequested,
        allocated_memory: totalMemoryRequested,
        cpu_usage_percent: totalCpuCapacity > 0 ? Math.min(100, Math.round((totalCpuRequested / totalCpuCapacity) * 100)) : 0,
        memory_usage_percent: totalMemoryCapacity > 0 ? Math.min(100, Math.round((totalMemoryRequested / totalMemoryCapacity) * 100)) : 0,
        breakdown: nodeAllocationMap
      },
      pods: podStateCounts,
      deployments: {
        healthy: healthyDeployments,
        total: deployments.length,
        total_replicas_desired: totalReplicasDesired,
        total_replicas_ready: podStateCounts.ready
      },
      latest_events: eventsRes.rows
    });
  } catch (err) {
    console.error('Overview error:', err);
    res.status(500).json({ error: 'Failed to retrieve overview' });
  }
});

module.exports = router;
