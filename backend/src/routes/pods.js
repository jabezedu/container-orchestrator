const express = require('express');
const router = express.Router();
const db = require('../db');
const { recordEvent } = require('../events');

// GET /api/pods
router.get('/', async (req, res) => {
  const { status, node, deployment } = req.query;

  try {
    let query = `
      SELECT 
        p.*,
        n.name AS node_name,
        d.name AS deployment_name
      FROM pods p
      LEFT JOIN nodes n ON n.id = p.node_id
      LEFT JOIN deployments d ON d.id = p.deployment_id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      params.push(status);
      query += ` AND p.status = $${params.length}`;
    }
    if (node) {
      params.push(node);
      query += ` AND n.name = $${params.length}`;
    }
    if (deployment) {
      params.push(deployment);
      query += ` AND d.name = $${params.length}`;
    }

    query += ' ORDER BY p.created_at DESC';

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('List pods error:', err);
    res.status(500).json({ error: 'Failed to retrieve pods' });
  }
});

// GET /api/pods/:name
router.get('/:name', async (req, res) => {
  const { name } = req.params;
  try {
    const podRes = await db.query(`
      SELECT 
        p.*,
        n.name AS node_name,
        d.name AS deployment_name
      FROM pods p
      LEFT JOIN nodes n ON n.id = p.node_id
      LEFT JOIN deployments d ON d.id = p.deployment_id
      WHERE p.name = $1
    `, [name]);

    if (podRes.rows.length === 0) {
      return res.status(404).json({ error: 'Pod not found' });
    }

    const pod = podRes.rows[0];

    // Fetch related events
    const eventsRes = await db.query(
      `SELECT * FROM events 
       WHERE object_kind = 'Pod' AND object_name = $1 
       ORDER BY created_at ASC`,
      [name]
    );

    res.json({
      ...pod,
      events: eventsRes.rows
    });
  } catch (err) {
    console.error('Get pod error:', err);
    res.status(500).json({ error: 'Failed to retrieve pod' });
  }
});

// DELETE /api/pods/:name
router.delete('/:name', async (req, res) => {
  const { name } = req.params;
  try {
    const podRes = await db.query('SELECT * FROM pods WHERE name = $1', [name]);
    if (podRes.rows.length === 0) {
      return res.status(404).json({ error: 'Pod not found' });
    }

    const pod = podRes.rows[0];
    await db.query(
      `UPDATE pods SET status = 'Terminating', terminating_since = CURRENT_TIMESTAMP WHERE id = $1`,
      [pod.id]
    );

    await recordEvent(db, {
      type: 'Normal',
      reason: 'Killing',
      objectKind: 'Pod',
      objectName: pod.name,
      message: `Stopping container ${pod.name} (user deletion)`
    });

    res.json({ message: `Pod ${name} marked for graceful termination (2s grace period)` });
  } catch (err) {
    console.error('Delete pod error:', err);
    res.status(500).json({ error: 'Failed to delete pod' });
  }
});

module.exports = router;
