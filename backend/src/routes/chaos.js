const express = require('express');
const router = express.Router();
const db = require('../db');
const { recordEvent } = require('../events');

// POST /api/chaos/kill-pod
router.post('/kill-pod', async (req, res) => {
  const { pod_name } = req.body || {};

  try {
    let pod;
    if (pod_name) {
      const podRes = await db.query('SELECT * FROM pods WHERE name = $1 AND status != \'Terminating\'', [pod_name]);
      if (podRes.rows.length === 0) {
        return res.status(404).json({ error: `Active pod ${pod_name} not found` });
      }
      pod = podRes.rows[0];
    } else {
      // Pick random active pod
      const randomRes = await db.query(
        `SELECT * FROM pods WHERE status != 'Terminating' ORDER BY RANDOM() LIMIT 1`
      );
      if (randomRes.rows.length === 0) {
        return res.status(400).json({ error: 'No active pods available to kill' });
      }
      pod = randomRes.rows[0];
    }

    await db.query(
      `UPDATE pods SET status = 'Terminating', terminating_since = CURRENT_TIMESTAMP WHERE id = $1`,
      [pod.id]
    );

    await recordEvent(db, {
      type: 'Warning',
      reason: 'ChaosMonkeyKill',
      objectKind: 'Pod',
      objectName: pod.name,
      message: `Chaos action: forcefully terminating container ${pod.name}`
    });

    res.json({
      message: `Chaos: Pod ${pod.name} marked for termination`,
      pod_name: pod.name
    });
  } catch (err) {
    console.error('Chaos kill-pod error:', err);
    res.status(500).json({ error: 'Failed to execute kill-pod chaos' });
  }
});

// POST /api/chaos/fail-node
router.post('/fail-node', async (req, res) => {
  const { node_name } = req.body || {};

  try {
    let node;
    if (node_name) {
      const nodeRes = await db.query('SELECT * FROM nodes WHERE name = $1', [node_name]);
      if (nodeRes.rows.length === 0) {
        return res.status(404).json({ error: `Node ${node_name} not found` });
      }
      node = nodeRes.rows[0];
    } else {
      // Pick random ready node
      const randomRes = await db.query(
        `SELECT * FROM nodes WHERE status = 'Ready' ORDER BY RANDOM() LIMIT 1`
      );
      if (randomRes.rows.length === 0) {
        return res.status(400).json({ error: 'No ready nodes available to fail' });
      }
      node = randomRes.rows[0];
    }

    await db.query(
      `UPDATE nodes SET status = 'NotReady' WHERE id = $1`,
      [node.id]
    );

    await recordEvent(db, {
      type: 'Warning',
      reason: 'ChaosNodeFailure',
      objectKind: 'Node',
      objectName: node.name,
      message: `Chaos action: node ${node.name} marked as NotReady (simulating hardware outage)`
    });

    res.json({
      message: `Chaos: Node ${node.name} failed (status set to NotReady)`,
      node_name: node.name
    });
  } catch (err) {
    console.error('Chaos fail-node error:', err);
    res.status(500).json({ error: 'Failed to execute fail-node chaos' });
  }
});

// POST /api/chaos/reset-cluster
router.post('/reset-cluster', async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Clean dynamic tables
    await client.query('DELETE FROM pods');
    await client.query('DELETE FROM services');
    await client.query('DELETE FROM hpas');
    await client.query('DELETE FROM deployment_revisions');
    await client.query('DELETE FROM deployments');
    await client.query('DELETE FROM nodes');
    await client.query('DELETE FROM metrics_history');

    // Restore seed nodes
    await client.query(`
      INSERT INTO nodes (id, name, cpu_capacity, memory_capacity, status, is_cordoned) VALUES
      (1, 'node-1', 4000, 8192, 'Ready', false),
      (2, 'node-2', 4000, 8192, 'Ready', false),
      (3, 'node-3', 4000, 8192, 'Ready', false)
    `);

    // Restore seed deployments
    await client.query(`
      INSERT INTO deployments (id, name, namespace, replicas, image, cpu_request, memory_request, max_surge, max_unavailable, current_revision, is_paused, rollout_status) VALUES
      (1, 'web-app', 'default', 2, 'nginx:1.25', 250, 256, 1, 0, 1, false, 'Complete'),
      (2, 'auth-service', 'default', 2, 'api:v1', 500, 512, 1, 0, 1, false, 'Complete')
    `);

    // Restore seed revisions
    await client.query(`
      INSERT INTO deployment_revisions (id, deployment_id, revision_number, image, cpu_request, memory_request, cause) VALUES
      (1, 1, 1, 'nginx:1.25', 250, 256, 'InitialDeployment'),
      (2, 2, 1, 'api:v1', 500, 512, 'InitialDeployment')
    `);

    // Restore seed HPA
    await client.query(`
      INSERT INTO hpas (id, deployment_id, min_replicas, max_replicas, target_cpu_percent, is_enabled) VALUES
      (1, 1, 1, 6, 70, true)
    `);

    // Restore seed service
    await client.query(`
      INSERT INTO services (id, name, namespace, type, port, target_port, selector) VALUES
      (1, 'web-service', 'default', 'ClusterIP', 80, 80, 'web-app')
    `);

    // Reset sequences
    await client.query("SELECT setval('nodes_id_seq', (SELECT COALESCE(MAX(id), 1) FROM nodes))");
    await client.query("SELECT setval('deployments_id_seq', (SELECT COALESCE(MAX(id), 1) FROM deployments))");
    await client.query("SELECT setval('deployment_revisions_id_seq', (SELECT COALESCE(MAX(id), 1) FROM deployment_revisions))");
    await client.query("SELECT setval('pods_id_seq', 1, false)");
    await client.query("SELECT setval('hpas_id_seq', (SELECT COALESCE(MAX(id), 1) FROM hpas))");
    await client.query("SELECT setval('services_id_seq', (SELECT COALESCE(MAX(id), 1) FROM services))");

    await recordEvent(client, {
      type: 'Normal',
      reason: 'ClusterReset',
      objectKind: 'Cluster',
      objectName: 'orchestrator',
      message: 'Cluster restored to baseline seed state'
    });

    await client.query('COMMIT');
    res.json({ message: 'Cluster reset to baseline seed state successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Cluster reset error:', err);
    res.status(500).json({ error: 'Failed to reset cluster' });
  } finally {
    client.release();
  }
});

module.exports = router;
