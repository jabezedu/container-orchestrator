const express = require('express');
const router = express.Router();
const db = require('../db');
const { recordEvent } = require('../events');

// Helper to get service with live endpoints
async function getServiceDetail(service) {
  const podsRes = await db.query(`
    SELECT p.id, p.name, p.status, p.is_ready, p.image, n.name AS node_name
    FROM pods p
    JOIN deployments d ON d.id = p.deployment_id
    LEFT JOIN nodes n ON n.id = p.node_id
    WHERE d.name = $1 AND p.is_ready = true AND p.status != 'Terminating'
    ORDER BY p.name ASC
  `, [service.selector]);

  return {
    ...service,
    endpoints: podsRes.rows,
    endpoints_count: podsRes.rows.length
  };
}

// GET /api/services
router.get('/', async (req, res) => {
  try {
    const servicesRes = await db.query('SELECT * FROM services ORDER BY created_at ASC');
    const result = await Promise.all(servicesRes.rows.map(getServiceDetail));
    res.json(result);
  } catch (err) {
    console.error('List services error:', err);
    res.status(500).json({ error: 'Failed to retrieve services' });
  }
});

// POST /api/services
router.post('/', async (req, res) => {
  const { name, type = 'ClusterIP', port = 80, target_port = 80, selector } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Service name is required' });
  }
  if (!selector || !selector.trim()) {
    return res.status(400).json({ error: 'Selector (deployment name) is required' });
  }

  const validTypes = ['ClusterIP', 'NodePort', 'LoadBalancer'];
  const svcType = validTypes.includes(type) ? type : 'ClusterIP';

  const p = parseInt(port, 10);
  const tp = parseInt(target_port, 10);
  if (isNaN(p) || p < 1 || p > 65535) {
    return res.status(400).json({ error: 'Port must be between 1 and 65535' });
  }
  if (isNaN(tp) || tp < 1 || tp > 65535) {
    return res.status(400).json({ error: 'Target port must be between 1 and 65535' });
  }

  try {
    const existing = await db.query('SELECT id FROM services WHERE name = $1', [name.trim().toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Service with this name already exists' });
    }

    const insertRes = await db.query(
      `INSERT INTO services (name, namespace, type, port, target_port, selector)
       VALUES ($1, 'default', $2, $3, $4, $5)
       RETURNING *`,
      [name.trim().toLowerCase(), svcType, p, tp, selector.trim().toLowerCase()]
    );

    const svc = insertRes.rows[0];
    await recordEvent(db, {
      type: 'Normal',
      reason: 'ServiceCreated',
      objectKind: 'Service',
      objectName: svc.name,
      message: `Created service ${svc.name} (${svc.type}:${svc.port} -> ${svc.selector})`
    });

    const detail = await getServiceDetail(svc);
    res.status(201).json(detail);
  } catch (err) {
    console.error('Create service error:', err);
    res.status(500).json({ error: 'Failed to create service' });
  }
});

// DELETE /api/services/:name
router.delete('/:name', async (req, res) => {
  const { name } = req.params;
  try {
    const result = await db.query('DELETE FROM services WHERE name = $1 RETURNING id', [name]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }
    await recordEvent(db, {
      type: 'Normal',
      reason: 'ServiceDeleted',
      objectKind: 'Service',
      objectName: name,
      message: `Deleted service ${name}`
    });
    res.json({ message: `Service ${name} deleted successfully` });
  } catch (err) {
    console.error('Delete service error:', err);
    res.status(500).json({ error: 'Failed to delete service' });
  }
});

// POST /api/services/:name/traffic (Simulate Traffic Distribution)
router.post('/:name/traffic', async (req, res) => {
  const { name } = req.params;
  const count = parseInt(req.body.count, 10) || 10;

  if (isNaN(count) || count < 1 || count > 200) {
    return res.status(400).json({ error: 'Count must be an integer between 1 and 200' });
  }

  try {
    const svcRes = await db.query('SELECT * FROM services WHERE name = $1', [name]);
    if (svcRes.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }
    const service = svcRes.rows[0];

    // Find ready pods matching selector
    const podsRes = await db.query(`
      SELECT p.id, p.name, p.status, p.is_ready, n.name AS node_name
      FROM pods p
      JOIN deployments d ON d.id = p.deployment_id
      LEFT JOIN nodes n ON n.id = p.node_id
      WHERE d.name = $1 AND p.is_ready = true AND p.status != 'Terminating'
      ORDER BY p.name ASC
    `, [service.selector]);

    const endpoints = podsRes.rows;
    if (endpoints.length === 0) {
      return res.status(503).json({
        error: `503 Service Unavailable: No ready endpoints for service "${service.name}" (selector: "${service.selector}")`
      });
    }

    // Round-robin distribution
    const distributionMap = new Map();
    endpoints.forEach(ep => {
      distributionMap.set(ep.name, { pod_name: ep.name, node_name: ep.node_name, count: 0 });
    });

    for (let i = 0; i < count; i++) {
      const target = endpoints[i % endpoints.length];
      const entry = distributionMap.get(target.name);
      entry.count += 1;
    }

    const distribution = Array.from(distributionMap.values());
    res.json({
      service: service.name,
      total_requests: count,
      endpoints_count: endpoints.length,
      distribution
    });
  } catch (err) {
    console.error('Service traffic error:', err);
    res.status(500).json({ error: 'Failed to dispatch traffic' });
  }
});

module.exports = router;
