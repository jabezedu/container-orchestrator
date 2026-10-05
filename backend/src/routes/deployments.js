const express = require('express');
const router = express.Router();
const db = require('../db');
const { recordEvent } = require('../events');
const { getImageInfo } = require('../images');

// Helper to assemble full deployment object
async function getDeploymentDetail(deployment) {
  const revsRes = await db.query(
    'SELECT * FROM deployment_revisions WHERE deployment_id = $1 ORDER BY revision_number DESC',
    [deployment.id]
  );

  const podsRes = await db.query(`
    SELECT p.*, n.name AS node_name
    FROM pods p
    LEFT JOIN nodes n ON n.id = p.node_id
    WHERE p.deployment_id = $1 AND p.status != 'Terminating'
    ORDER BY p.id ASC
  `, [deployment.id]);

  const hpaRes = await db.query(
    'SELECT * FROM hpas WHERE deployment_id = $1',
    [deployment.id]
  );

  const readyReplicas = podsRes.rows.filter(p => p.is_ready).length;
  const currentRevRecord = revsRes.rows.find(r => r.revision_number === deployment.current_revision);
  const currentRevPods = currentRevRecord ? podsRes.rows.filter(p => p.revision_id === currentRevRecord.id) : [];
  const oldRevPods = currentRevRecord ? podsRes.rows.filter(p => p.revision_id !== currentRevRecord.id) : [];

  return {
    ...deployment,
    ready_replicas: readyReplicas,
    total_replicas: podsRes.rows.length,
    new_pods_count: currentRevPods.length,
    new_pods_ready: currentRevPods.filter(p => p.is_ready).length,
    old_pods_count: oldRevPods.length,
    old_pods_ready: oldRevPods.filter(p => p.is_ready).length,
    revisions: revsRes.rows,
    pods: podsRes.rows.map(p => ({
      id: p.id,
      name: p.name,
      image: p.image,
      status: p.status,
      is_ready: p.is_ready,
      restart_count: p.restart_count,
      node_name: p.node_name || 'Unassigned',
      revision_id: p.revision_id,
      created_at: p.created_at
    })),
    hpa: hpaRes.rows[0] || null
  };
}

// GET /api/deployments
router.get('/', async (req, res) => {
  try {
    const depsRes = await db.query('SELECT * FROM deployments ORDER BY created_at ASC');
    const result = await Promise.all(depsRes.rows.map(getDeploymentDetail));
    res.json(result);
  } catch (err) {
    console.error('List deployments error:', err);
    res.status(500).json({ error: 'Failed to retrieve deployments' });
  }
});

// GET /api/deployments/:name
router.get('/:name', async (req, res) => {
  const { name } = req.params;
  try {
    const depRes = await db.query('SELECT * FROM deployments WHERE name = $1', [name]);
    if (depRes.rows.length === 0) {
      return res.status(404).json({ error: 'Deployment not found' });
    }
    const detail = await getDeploymentDetail(depRes.rows[0]);
    res.json(detail);
  } catch (err) {
    console.error('Get deployment error:', err);
    res.status(500).json({ error: 'Failed to retrieve deployment' });
  }
});

// POST /api/deployments
router.post('/', async (req, res) => {
  const {
    name,
    image,
    replicas = 1,
    cpu_request,
    memory_request,
    max_surge = 1,
    max_unavailable = 0
  } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Deployment name is required' });
  }
  if (!image || !image.trim()) {
    return res.status(400).json({ error: 'Container image is required' });
  }

  const cleanName = name.trim().toLowerCase();
  const rep = parseInt(replicas, 10);
  if (isNaN(rep) || rep < 0 || rep > 20) {
    return res.status(400).json({ error: 'Replicas must be between 0 and 20' });
  }

  const imgInfo = getImageInfo(image.trim());
  const cpu = cpu_request ? parseInt(cpu_request, 10) : imgInfo.defaultCpu;
  const mem = memory_request ? parseInt(memory_request, 10) : imgInfo.defaultMemory;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query('SELECT id FROM deployments WHERE name = $1', [cleanName]);
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Deployment with this name already exists' });
    }

    const depRes = await client.query(
      `INSERT INTO deployments 
       (name, namespace, replicas, image, cpu_request, memory_request, max_surge, max_unavailable, current_revision, rollout_status)
       VALUES ($1, 'default', $2, $3, $4, $5, $6, $7, 1, 'Progressing')
       RETURNING *`,
      [cleanName, rep, image.trim(), cpu, mem, parseInt(max_surge, 10) || 1, parseInt(max_unavailable, 10) || 0]
    );
    const dep = depRes.rows[0];

    // Create Revision 1
    await client.query(
      `INSERT INTO deployment_revisions (deployment_id, revision_number, image, cpu_request, memory_request, cause)
       VALUES ($1, 1, $2, $3, $4, 'InitialDeployment')`,
      [dep.id, image.trim(), cpu, mem]
    );

    await recordEvent(client, {
      type: 'Normal',
      reason: 'ScalingReplicaSet',
      objectKind: 'Deployment',
      objectName: dep.name,
      message: `Scaled up replica set ${dep.name} to ${rep}`
    });

    await client.query('COMMIT');
    const detail = await getDeploymentDetail(dep);
    res.status(201).json(detail);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create deployment error:', err);
    res.status(500).json({ error: 'Failed to create deployment' });
  } finally {
    client.release();
  }
});

// PUT /api/deployments/:name (Update image -> Trigger Rolling Update)
router.put('/:name', async (req, res) => {
  const { name } = req.params;
  const { image } = req.body;

  if (!image || !image.trim()) {
    return res.status(400).json({ error: 'Image is required' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const depRes = await client.query('SELECT * FROM deployments WHERE name = $1', [name]);
    if (depRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Deployment not found' });
    }
    const dep = depRes.rows[0];

    const nextRevNum = dep.current_revision + 1;
    const imgInfo = getImageInfo(image.trim());
    const cpu = dep.cpu_request;
    const mem = dep.memory_request;

    // Create next revision record
    await client.query(
      `INSERT INTO deployment_revisions (deployment_id, revision_number, image, cpu_request, memory_request, cause)
       VALUES ($1, $2, $3, $4, $5, 'ImageUpdated')`,
      [dep.id, nextRevNum, image.trim(), cpu, mem]
    );

    // Update deployment
    const updatedDepRes = await client.query(
      `UPDATE deployments
       SET image = $1,
           current_revision = $2,
           rollout_status = 'Progressing',
           rollout_started_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [image.trim(), nextRevNum, dep.id]
    );

    await recordEvent(client, {
      type: 'Normal',
      reason: 'TriggeredRollout',
      objectKind: 'Deployment',
      objectName: dep.name,
      message: `Triggered rolling update to revision ${nextRevNum} (image: ${image.trim()})`
    });

    await client.query('COMMIT');
    const detail = await getDeploymentDetail(updatedDepRes.rows[0]);
    res.json(detail);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update deployment image error:', err);
    res.status(500).json({ error: 'Failed to update deployment' });
  } finally {
    client.release();
  }
});

// PATCH /api/deployments/:name/scale
router.patch('/:name/scale', async (req, res) => {
  const { name } = req.params;
  const { replicas } = req.body;

  const rep = parseInt(replicas, 10);
  if (isNaN(rep) || rep < 0 || rep > 20) {
    return res.status(400).json({ error: 'Replicas must be between 0 and 20' });
  }

  try {
    const updateRes = await db.query(
      `UPDATE deployments 
       SET replicas = $1, 
           rollout_status = 'Progressing',
           updated_at = CURRENT_TIMESTAMP 
       WHERE name = $2 
       RETURNING *`,
      [rep, name]
    );

    if (updateRes.rows.length === 0) {
      return res.status(404).json({ error: 'Deployment not found' });
    }

    const dep = updateRes.rows[0];
    await recordEvent(db, {
      type: 'Normal',
      reason: 'ScalingReplicaSet',
      objectKind: 'Deployment',
      objectName: dep.name,
      message: `Scaled replica set ${dep.name} to ${rep}`
    });

    const detail = await getDeploymentDetail(dep);
    res.json(detail);
  } catch (err) {
    console.error('Scale deployment error:', err);
    res.status(500).json({ error: 'Failed to scale deployment' });
  }
});

// PUT /api/deployments/:name/load
router.put('/:name/load', async (req, res) => {
  const { name } = req.params;
  const { load } = req.body;

  const parsedLoad = parseInt(load, 10);
  if (isNaN(parsedLoad) || parsedLoad < 0) {
    return res.status(400).json({ error: 'Load must be a non-negative integer' });
  }

  try {
    const updateRes = await db.query(
      'UPDATE deployments SET simulated_load = $1, updated_at = CURRENT_TIMESTAMP WHERE name = $2 RETURNING *',
      [parsedLoad, name]
    );

    if (updateRes.rows.length === 0) {
      return res.status(404).json({ error: 'Deployment not found' });
    }

    res.json(updateRes.rows[0]);
  } catch (err) {
    console.error('Update load error:', err);
    res.status(500).json({ error: 'Failed to set load' });
  }
});

// POST /api/deployments/:name/pause
router.post('/:name/pause', async (req, res) => {
  const { name } = req.params;
  try {
    const updateRes = await db.query(
      `UPDATE deployments SET is_paused = true, rollout_status = 'Paused' WHERE name = $1 RETURNING *`,
      [name]
    );
    if (updateRes.rows.length === 0) {
      return res.status(404).json({ error: 'Deployment not found' });
    }
    await recordEvent(db, {
      type: 'Normal',
      reason: 'DeploymentPaused',
      objectKind: 'Deployment',
      objectName: name,
      message: `Deployment ${name} rollout has been paused`
    });
    res.json(updateRes.rows[0]);
  } catch (err) {
    console.error('Pause rollout error:', err);
    res.status(500).json({ error: 'Failed to pause rollout' });
  }
});

// POST /api/deployments/:name/resume
router.post('/:name/resume', async (req, res) => {
  const { name } = req.params;
  try {
    const updateRes = await db.query(
      `UPDATE deployments SET is_paused = false, rollout_status = 'Progressing' WHERE name = $1 RETURNING *`,
      [name]
    );
    if (updateRes.rows.length === 0) {
      return res.status(404).json({ error: 'Deployment not found' });
    }
    await recordEvent(db, {
      type: 'Normal',
      reason: 'DeploymentResumed',
      objectKind: 'Deployment',
      objectName: name,
      message: `Deployment ${name} rollout has been resumed`
    });
    res.json(updateRes.rows[0]);
  } catch (err) {
    console.error('Resume rollout error:', err);
    res.status(500).json({ error: 'Failed to resume rollout' });
  }
});

// POST /api/deployments/:name/rollback
router.post('/:name/rollback', async (req, res) => {
  const { name } = req.params;
  const { revision_number } = req.body || {};

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const depRes = await client.query('SELECT * FROM deployments WHERE name = $1', [name]);
    if (depRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Deployment not found' });
    }
    const dep = depRes.rows[0];

    let targetRev;
    if (revision_number) {
      const revRes = await client.query(
        'SELECT * FROM deployment_revisions WHERE deployment_id = $1 AND revision_number = $2',
        [dep.id, parseInt(revision_number, 10)]
      );
      if (revRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: `Revision ${revision_number} not found` });
      }
      targetRev = revRes.rows[0];
    } else {
      // Previous revision
      const revsRes = await client.query(
        'SELECT * FROM deployment_revisions WHERE deployment_id = $1 AND revision_number < $2 ORDER BY revision_number DESC LIMIT 1',
        [dep.id, dep.current_revision]
      );
      if (revsRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'No previous revision available for rollback' });
      }
      targetRev = revsRes.rows[0];
    }

    const nextRevNum = dep.current_revision + 1;
    await client.query(
      `INSERT INTO deployment_revisions (deployment_id, revision_number, image, cpu_request, memory_request, cause)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [dep.id, nextRevNum, targetRev.image, targetRev.cpu_request, targetRev.memory_request, `Rollback to revision ${targetRev.revision_number}`]
    );

    const updatedDepRes = await client.query(
      `UPDATE deployments
       SET image = $1,
           cpu_request = $2,
           memory_request = $3,
           current_revision = $4,
           rollout_status = 'Progressing',
           rollout_started_at = CURRENT_TIMESTAMP,
           is_paused = false,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING *`,
      [targetRev.image, targetRev.cpu_request, targetRev.memory_request, nextRevNum, dep.id]
    );

    await recordEvent(client, {
      type: 'Normal',
      reason: 'DeploymentRollback',
      objectKind: 'Deployment',
      objectName: dep.name,
      message: `Rolled back deployment ${dep.name} to revision ${targetRev.revision_number} as new revision ${nextRevNum}`
    });

    await client.query('COMMIT');
    const detail = await getDeploymentDetail(updatedDepRes.rows[0]);
    res.json(detail);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Rollback error:', err);
    res.status(500).json({ error: 'Failed to rollback deployment' });
  } finally {
    client.release();
  }
});

// DELETE /api/deployments/:name
router.delete('/:name', async (req, res) => {
  const { name } = req.params;
  try {
    const depRes = await db.query('SELECT * FROM deployments WHERE name = $1', [name]);
    if (depRes.rows.length === 0) {
      return res.status(404).json({ error: 'Deployment not found' });
    }
    const dep = depRes.rows[0];

    await db.query('DELETE FROM deployments WHERE id = $1', [dep.id]);
    await recordEvent(db, {
      type: 'Normal',
      reason: 'DeploymentDeleted',
      objectKind: 'Deployment',
      objectName: dep.name,
      message: `Deployment ${dep.name} deleted`
    });

    res.json({ message: `Deployment ${name} deleted successfully` });
  } catch (err) {
    console.error('Delete deployment error:', err);
    res.status(500).json({ error: 'Failed to delete deployment' });
  }
});

module.exports = router;
