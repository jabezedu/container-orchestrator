const express = require('express');
const router = express.Router();
const db = require('../db');
const { recordEvent } = require('../events');

// GET /api/nodes
router.get('/', async (req, res) => {
  try {
    const nodesRes = await db.query('SELECT * FROM nodes ORDER BY id ASC');
    const podsRes = await db.query(`
      SELECT p.*, d.name AS deployment_name 
      FROM pods p 
      LEFT JOIN deployments d ON d.id = p.deployment_id
      WHERE p.status != 'Terminating'
      ORDER BY p.id ASC
    `);

    const result = nodesRes.rows.map(node => {
      const nodePods = podsRes.rows.filter(p => p.node_id === node.id);
      const allocatedCpu = nodePods.reduce((sum, p) => sum + p.cpu_request, 0);
      const allocatedMemory = nodePods.reduce((sum, p) => sum + p.memory_request, 0);

      return {
        ...node,
        allocated_cpu: allocatedCpu,
        allocated_memory: allocatedMemory,
        cpu_percent: Math.min(100, Math.round((allocatedCpu / node.cpu_capacity) * 100)),
        memory_percent: Math.min(100, Math.round((allocatedMemory / node.memory_capacity) * 100)),
        pod_count: nodePods.length,
        pods: nodePods.map(p => ({
          id: p.id,
          name: p.name,
          image: p.image,
          status: p.status,
          is_ready: p.is_ready,
          deployment_name: p.deployment_name
        }))
      };
    });

    res.json(result);
  } catch (err) {
    console.error('List nodes error:', err);
    res.status(500).json({ error: 'Failed to retrieve nodes' });
  }
});

// POST /api/nodes
router.post('/', async (req, res) => {
  const { name, cpu_capacity = 4000, memory_capacity = 8192 } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Node name is required' });
  }

  const cpu = parseInt(cpu_capacity, 10);
  const mem = parseInt(memory_capacity, 10);
  if (isNaN(cpu) || cpu < 1000 || cpu > 32000) {
    return res.status(400).json({ error: 'CPU capacity must be between 1000m and 32000m' });
  }
  if (isNaN(mem) || mem < 1024 || mem > 65536) {
    return res.status(400).json({ error: 'Memory capacity must be between 1024 MB and 65536 MB' });
  }

  try {
    const existing = await db.query('SELECT id FROM nodes WHERE name = $1', [name.trim()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Node with this name already exists' });
    }

    const insertRes = await db.query(
      `INSERT INTO nodes (name, cpu_capacity, memory_capacity, status, is_cordoned)
       VALUES ($1, $2, $3, 'Ready', false)
       RETURNING *`,
      [name.trim(), cpu, mem]
    );

    const newNode = insertRes.rows[0];
    await recordEvent(db, {
      type: 'Normal',
      reason: 'NodeRegistered',
      objectKind: 'Node',
      objectName: newNode.name,
      message: `Node ${newNode.name} registered successfully with ${cpu}m CPU and ${mem}MB RAM`
    });

    res.status(201).json({
      ...newNode,
      allocated_cpu: 0,
      allocated_memory: 0,
      cpu_percent: 0,
      memory_percent: 0,
      pod_count: 0,
      pods: []
    });
  } catch (err) {
    console.error('Create node error:', err);
    res.status(500).json({ error: 'Failed to create node' });
  }
});

// PATCH /api/nodes/:id/cordon
router.patch('/:id/cordon', async (req, res) => {
  const { id } = req.params;
  const { is_cordoned } = req.body;

  try {
    const nodeRes = await db.query('SELECT * FROM nodes WHERE id = $1', [id]);
    if (nodeRes.rows.length === 0) {
      return res.status(404).json({ error: 'Node not found' });
    }

    const cordonedVal = is_cordoned !== undefined ? Boolean(is_cordoned) : !nodeRes.rows[0].is_cordoned;
    const updateRes = await db.query(
      'UPDATE nodes SET is_cordoned = $1 WHERE id = $2 RETURNING *',
      [cordonedVal, id]
    );

    const node = updateRes.rows[0];
    await recordEvent(db, {
      type: 'Normal',
      reason: cordonedVal ? 'Cordoned' : 'Uncordoned',
      objectKind: 'Node',
      objectName: node.name,
      message: `Node ${node.name} marked as ${cordonedVal ? 'Cordoned (SchedulingDisabled)' : 'Uncordoned'}`
    });

    res.json(node);
  } catch (err) {
    console.error('Cordon node error:', err);
    res.status(500).json({ error: 'Failed to update cordon state' });
  }
});

// POST /api/nodes/:id/drain
router.post('/:id/drain', async (req, res) => {
  const { id } = req.params;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const nodeRes = await client.query('SELECT * FROM nodes WHERE id = $1', [id]);
    if (nodeRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Node not found' });
    }
    const node = nodeRes.rows[0];

    // Cordon node
    await client.query('UPDATE nodes SET is_cordoned = true WHERE id = $1', [id]);

    // Gracefully terminate non-terminating pods on this node
    const podsRes = await client.query(
      `SELECT * FROM pods WHERE node_id = $1 AND status != 'Terminating'`,
      [id]
    );

    for (const pod of podsRes.rows) {
      await client.query(
        `UPDATE pods SET status = 'Terminating', terminating_since = CURRENT_TIMESTAMP WHERE id = $1`,
        [pod.id]
      );
      await recordEvent(client, {
        type: 'Normal',
        reason: 'Evicting',
        objectKind: 'Pod',
        objectName: pod.name,
        message: `Draining node ${node.name}: evicted pod default/${pod.name}`
      });
    }

    await recordEvent(client, {
      type: 'Normal',
      reason: 'DrainCompleted',
      objectKind: 'Node',
      objectName: node.name,
      message: `Node ${node.name} drained; ${podsRes.rows.length} pod(s) evicted`
    });

    await client.query('COMMIT');
    res.json({ message: `Node ${node.name} cordoned and drained successfully (${podsRes.rows.length} evicted)` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Drain node error:', err);
    res.status(500).json({ error: 'Failed to drain node' });
  } finally {
    client.release();
  }
});

// POST /api/nodes/:id/fail
router.post('/:id/fail', async (req, res) => {
  const { id } = req.params;
  try {
    const updateRes = await db.query(
      `UPDATE nodes SET status = 'NotReady' WHERE id = $1 RETURNING *`,
      [id]
    );
    if (updateRes.rows.length === 0) {
      return res.status(404).json({ error: 'Node not found' });
    }
    const node = updateRes.rows[0];

    await recordEvent(db, {
      type: 'Warning',
      reason: 'NodeNotReady',
      objectKind: 'Node',
      objectName: node.name,
      message: `Node ${node.name} status is now NotReady (NodeLost simulation)`
    });

    res.json(node);
  } catch (err) {
    console.error('Fail node error:', err);
    res.status(500).json({ error: 'Failed to fail node' });
  }
});

// POST /api/nodes/:id/recover
router.post('/:id/recover', async (req, res) => {
  const { id } = req.params;
  try {
    const updateRes = await db.query(
      `UPDATE nodes SET status = 'Ready' WHERE id = $1 RETURNING *`,
      [id]
    );
    if (updateRes.rows.length === 0) {
      return res.status(404).json({ error: 'Node not found' });
    }
    const node = updateRes.rows[0];

    await recordEvent(db, {
      type: 'Normal',
      reason: 'NodeReady',
      objectKind: 'Node',
      objectName: node.name,
      message: `Node ${node.name} status is now Ready`
    });

    res.json(node);
  } catch (err) {
    console.error('Recover node error:', err);
    res.status(500).json({ error: 'Failed to recover node' });
  }
});

// DELETE /api/nodes/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const nodeRes = await db.query('SELECT * FROM nodes WHERE id = $1', [id]);
    if (nodeRes.rows.length === 0) {
      return res.status(404).json({ error: 'Node not found' });
    }
    const node = nodeRes.rows[0];

    const podsRes = await db.query(
      `SELECT COUNT(*)::int AS count FROM pods WHERE node_id = $1 AND status != 'Terminating'`,
      [id]
    );
    if (podsRes.rows[0].count > 0) {
      return res.status(409).json({
        error: `Cannot delete node ${node.name}: Node has ${podsRes.rows[0].count} active pod(s). Drain node first before removing.`
      });
    }

    await db.query('DELETE FROM nodes WHERE id = $1', [id]);
    await recordEvent(db, {
      type: 'Normal',
      reason: 'NodeDeleted',
      objectKind: 'Node',
      objectName: node.name,
      message: `Node ${node.name} has been removed from the cluster`
    });

    res.json({ message: `Node ${node.name} deleted successfully` });
  } catch (err) {
    console.error('Delete node error:', err);
    res.status(500).json({ error: 'Failed to delete node' });
  }
});

module.exports = router;
