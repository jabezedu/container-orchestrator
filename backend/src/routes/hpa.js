const express = require('express');
const router = express.Router();
const db = require('../db');
const { recordEvent } = require('../events');

// GET /api/hpas
router.get('/', async (req, res) => {
  try {
    const hpasRes = await db.query(`
      SELECT 
        h.*,
        d.name AS deployment_name,
        d.replicas AS current_replicas,
        d.cpu_request,
        d.simulated_load
      FROM hpas h
      JOIN deployments d ON d.id = h.deployment_id
      ORDER BY h.id ASC
    `);

    const result = await Promise.all(
      hpasRes.rows.map(async hpa => {
        const podsRes = await db.query(
          `SELECT COUNT(*)::int AS count 
           FROM pods 
           WHERE deployment_id = $1 AND is_ready = true AND status != 'Terminating'`,
          [hpa.deployment_id]
        );
        const readyPods = podsRes.rows[0].count;
        const totalCapacity = readyPods * (hpa.cpu_request || 250);
        const simulatedLoad = hpa.simulated_load || 0;

        let currentCpuPercent = 0;
        if (readyPods === 0) {
          currentCpuPercent = simulatedLoad > 0 ? 100 : 0;
        } else {
          currentCpuPercent = Math.min(100, Math.round((simulatedLoad / totalCapacity) * 100));
        }

        // Recent scaling events for this HPA
        const eventsRes = await db.query(
          `SELECT * FROM events 
           WHERE object_kind = 'HorizontalPodAutoscaler' AND object_name = $1 
           ORDER BY created_at DESC LIMIT 5`,
          [hpa.deployment_name]
        );

        return {
          ...hpa,
          ready_pods: readyPods,
          current_cpu_percent: currentCpuPercent,
          recent_events: eventsRes.rows
        };
      })
    );

    res.json(result);
  } catch (err) {
    console.error('List HPAs error:', err);
    res.status(500).json({ error: 'Failed to retrieve HPAs' });
  }
});

// POST /api/hpas (Create or Upsert HPA)
router.post('/', async (req, res) => {
  const { deployment_name, min_replicas = 1, max_replicas = 10, target_cpu_percent = 70, is_enabled = true } = req.body;

  if (!deployment_name) {
    return res.status(400).json({ error: 'deployment_name is required' });
  }

  const min = parseInt(min_replicas, 10);
  const max = parseInt(max_replicas, 10);
  const target = parseInt(target_cpu_percent, 10);

  if (isNaN(min) || min < 1 || min > 20) {
    return res.status(400).json({ error: 'min_replicas must be between 1 and 20' });
  }
  if (isNaN(max) || max < min || max > 30) {
    return res.status(400).json({ error: 'max_replicas must be between min_replicas and 30' });
  }
  if (isNaN(target) || target < 10 || target > 95) {
    return res.status(400).json({ error: 'target_cpu_percent must be between 10 and 95' });
  }

  try {
    const depRes = await db.query('SELECT id, name FROM deployments WHERE name = $1', [deployment_name.trim()]);
    if (depRes.rows.length === 0) {
      return res.status(404).json({ error: 'Deployment not found' });
    }
    const dep = depRes.rows[0];

    const result = await db.query(
      `INSERT INTO hpas (deployment_id, min_replicas, max_replicas, target_cpu_percent, is_enabled)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (deployment_id)
       DO UPDATE SET
         min_replicas = EXCLUDED.min_replicas,
         max_replicas = EXCLUDED.max_replicas,
         target_cpu_percent = EXCLUDED.target_cpu_percent,
         is_enabled = EXCLUDED.is_enabled
       RETURNING *`,
      [dep.id, min, max, target, Boolean(is_enabled)]
    );

    await recordEvent(db, {
      type: 'Normal',
      reason: 'HPAConfigured',
      objectKind: 'HorizontalPodAutoscaler',
      objectName: dep.name,
      message: `Configured HPA for ${dep.name} (min: ${min}, max: ${max}, target: ${target}%)`
    });

    res.status(201).json({
      ...result.rows[0],
      deployment_name: dep.name
    });
  } catch (err) {
    console.error('Create HPA error:', err);
    res.status(500).json({ error: 'Failed to configure HPA' });
  }
});

// PUT /api/hpas/:id
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { min_replicas, max_replicas, target_cpu_percent, is_enabled } = req.body;

  try {
    const current = await db.query('SELECT * FROM hpas WHERE id = $1', [id]);
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'HPA not found' });
    }
    const cur = current.rows[0];

    const min = min_replicas !== undefined ? parseInt(min_replicas, 10) : cur.min_replicas;
    const max = max_replicas !== undefined ? parseInt(max_replicas, 10) : cur.max_replicas;
    const target = target_cpu_percent !== undefined ? parseInt(target_cpu_percent, 10) : cur.target_cpu_percent;
    const enabled = is_enabled !== undefined ? Boolean(is_enabled) : cur.is_enabled;

    if (min < 1 || min > max) {
      return res.status(400).json({ error: 'Invalid min/max replicas' });
    }

    const updateRes = await db.query(
      `UPDATE hpas 
       SET min_replicas = $1, max_replicas = $2, target_cpu_percent = $3, is_enabled = $4
       WHERE id = $5
       RETURNING *`,
      [min, max, target, enabled, id]
    );

    res.json(updateRes.rows[0]);
  } catch (err) {
    console.error('Update HPA error:', err);
    res.status(500).json({ error: 'Failed to update HPA' });
  }
});

// DELETE /api/hpas/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query('DELETE FROM hpas WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'HPA not found' });
    }
    res.json({ message: 'HPA deleted successfully' });
  } catch (err) {
    console.error('Delete HPA error:', err);
    res.status(500).json({ error: 'Failed to delete HPA' });
  }
});

module.exports = router;
