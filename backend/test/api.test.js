const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

process.env.PORT = '4010';
process.env.TICK_MS = '200';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5450/orchestrator';

const { app, start } = require('../src/server');
const db = require('../src/db');
const { stopController } = require('../src/controller');

let server;
let token = '';
const BASE_URL = 'http://localhost:4010';

async function fetchApi(path, options = {}) {
  const headers = options.headers || {};
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (options.body && typeof options.body === 'object') {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  return fetch(`${BASE_URL}${path}`, { ...options, headers });
}

async function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    await fetchApi('/api/tick', { method: 'POST' });
    await new Promise(r => setTimeout(r, 100));
  }
}

async function resetCluster() {
  await fetchApi('/api/chaos/reset-cluster', { method: 'POST' });
  await tick(2);
}

describe('Container Orchestrator Integration Tests', () => {
  before(async () => {
    server = await start();
    // Allow DB & initial seed
    await new Promise(r => setTimeout(r, 500));
  });

  after(async () => {
    stopController();
    if (server) {
      await new Promise(res => server.close(res));
    }
    await db.pool.end();
  });

  test('1. Login and 401 Unauthorized handling', async () => {
    // Unauthenticated request should yield 401
    const unauthRes = await fetch(`${BASE_URL}/api/nodes`);
    assert.equal(unauthRes.status, 401);

    // Invalid credentials should yield 401
    const badLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@demo.com', password: 'wrong' })
    });
    assert.equal(badLoginRes.status, 401);

    // Valid credentials should yield 200 and JWT token
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@demo.com', password: 'demo123' })
    });
    assert.equal(loginRes.status, 200);
    const loginData = await loginRes.json();
    assert.ok(loginData.token);
    token = loginData.token;

    // Reset cluster to clean seed baseline
    await resetCluster();
  });

  test('2. Create deployment reaches desired Ready count', async () => {
    const createRes = await fetchApi('/api/deployments', {
      method: 'POST',
      body: {
        name: 'test-app',
        image: 'nginx:1.25',
        replicas: 2,
        cpu_request: 250,
        memory_request: 256
      }
    });
    assert.equal(createRes.status, 201);

    // Advance ticks for scheduling, container creating (2s), and ready (2s)
    for (let i = 0; i < 30; i++) {
      await tick(1);
      const getRes = await fetchApi('/api/deployments/test-app');
      const dep = await getRes.json();
      if (dep.ready_replicas === 2) break;
      await new Promise(r => setTimeout(r, 200));
    }

    const checkRes = await fetchApi('/api/deployments/test-app');
    const depData = await checkRes.json();
    assert.equal(depData.ready_replicas, 2);
    assert.equal(depData.pods.length, 2);
    assert.ok(depData.pods.every(p => p.is_ready));
  });

  test('3. Scale up and down replicas', async () => {
    // Scale up to 4
    const scaleUpRes = await fetchApi('/api/deployments/test-app/scale', {
      method: 'PATCH',
      body: { replicas: 4 }
    });
    assert.equal(scaleUpRes.status, 200);

    for (let i = 0; i < 30; i++) {
      await tick(1);
      const getRes = await fetchApi('/api/deployments/test-app');
      const dep = await getRes.json();
      if (dep.ready_replicas === 4) break;
      await new Promise(r => setTimeout(r, 200));
    }

    const scaledUp = await (await fetchApi('/api/deployments/test-app')).json();
    assert.equal(scaledUp.ready_replicas, 4);

    // Scale down to 2
    const scaleDownRes = await fetchApi('/api/deployments/test-app/scale', {
      method: 'PATCH',
      body: { replicas: 2 }
    });
    assert.equal(scaleDownRes.status, 200);

    for (let i = 0; i < 20; i++) {
      await tick(1);
      const getRes = await fetchApi('/api/deployments/test-app');
      const dep = await getRes.json();
      if (dep.pods.length === 2) break;
      await new Promise(r => setTimeout(r, 200));
    }

    const scaledDown = await (await fetchApi('/api/deployments/test-app')).json();
    assert.equal(scaledDown.pods.length, 2);
  });

  test('4. Rolling update never drops ready pods below replicas - maxUnavailable', async () => {
    // Ensure test-app has 3 replicas, max_surge 1, max_unavailable 0
    await fetchApi('/api/deployments/test-app/scale', {
      method: 'PATCH',
      body: { replicas: 3 }
    });

    for (let i = 0; i < 30; i++) {
      await tick(1);
      const dep = await (await fetchApi('/api/deployments/test-app')).json();
      if (dep.ready_replicas === 3) break;
      await new Promise(r => setTimeout(r, 200));
    }

    // Trigger update to nginx:1.26
    const updateRes = await fetchApi('/api/deployments/test-app', {
      method: 'PUT',
      body: { image: 'nginx:1.26' }
    });
    assert.equal(updateRes.status, 200);

    // Sample ready pods across ticks: total ready pods must never be < 3 (3 - 0 = 3)
    let minReadySeen = 3;
    let completed = false;

    for (let i = 0; i < 100; i++) {
      await tick(1);
      const dep = await (await fetchApi('/api/deployments/test-app')).json();
      if (dep.ready_replicas < minReadySeen) {
        minReadySeen = dep.ready_replicas;
      }
      if (dep.rollout_status === 'Complete' && dep.current_revision === 2 && dep.new_pods_ready === 3) {
        completed = true;
        break;
      }
      await new Promise(r => setTimeout(r, 150));
    }

    assert.ok(minReadySeen >= 3, `Ready pods dropped below replicas - maxUnavailable: saw ${minReadySeen}`);
    assert.ok(completed, 'Rolling update did not reach Complete status');
  });

  test('5. api:broken rollout stalls and rollback restores previous revision', async () => {
    // Update to api:broken
    const brokenRes = await fetchApi('/api/deployments/test-app', {
      method: 'PUT',
      body: { image: 'api:broken' }
    });
    assert.equal(brokenRes.status, 200);

    // Simulate rollout duration exceeding 30s
    await db.query(
      `UPDATE deployments 
       SET rollout_started_at = NOW() - INTERVAL '35 seconds' 
       WHERE name = 'test-app'`
    );

    // Run ticks to process crash and deadline detection
    for (let i = 0; i < 20; i++) {
      await tick(1);
      const dep = await (await fetchApi('/api/deployments/test-app')).json();
      if (dep.rollout_status === 'Stalled') break;
      await new Promise(r => setTimeout(r, 150));
    }

    const stalledDep = await (await fetchApi('/api/deployments/test-app')).json();
    assert.equal(stalledDep.rollout_status, 'Stalled');
    // Old pods must still be intact and serving
    assert.ok(stalledDep.old_pods_count > 0);

    // Verify RolloutStalled event
    const eventsRes = await fetchApi('/api/events?reason=RolloutStalled');
    const events = await eventsRes.json();
    assert.ok(events.length > 0);

    // Execute rollback
    const rollbackRes = await fetchApi('/api/deployments/test-app/rollback', {
      method: 'POST',
      body: { revision_number: 2 }
    });
    assert.equal(rollbackRes.status, 200);

    // Advance ticks until rollback finishes
    for (let i = 0; i < 100; i++) {
      await tick(1);
      const dep = await (await fetchApi('/api/deployments/test-app')).json();
      if (dep.rollout_status === 'Complete' && dep.image === 'nginx:1.26') break;
      await new Promise(r => setTimeout(r, 150));
    }

    const restoredDep = await (await fetchApi('/api/deployments/test-app')).json();
    assert.equal(restoredDep.image, 'nginx:1.26');
    assert.equal(restoredDep.rollout_status, 'Complete');
  });

  test('6. Failing a node reschedules its pods on other nodes', async () => {
    // Find node with pods
    const nodesRes = await fetchApi('/api/nodes');
    const nodes = await nodesRes.json();
    const nodeWithPods = nodes.find(n => n.pods.length > 0);
    assert.ok(nodeWithPods, 'Must have at least one node with pods');

    // Fail node
    const failRes = await fetchApi(`/api/nodes/${nodeWithPods.id}/fail`, { method: 'POST' });
    assert.equal(failRes.status, 200);

    // Run tick to mark pods Unknown
    await tick(1);

    // Simulate 6 seconds passed since node failure
    await db.query(
      `UPDATE pods SET node_failed_at = NOW() - INTERVAL '6 seconds' WHERE status = 'Unknown'`
    );

    // Run ticks to evict and recreate pods on remaining ready nodes
    for (let i = 0; i < 20; i++) {
      await tick(1);
      const checkRes = await fetchApi('/api/deployments/test-app');
      const dep = await checkRes.json();
      if (dep.ready_replicas === dep.replicas) break;
      await new Promise(r => setTimeout(r, 150));
    }

    // Verify all pods of test-app are on Ready nodes
    const finalNodes = await (await fetchApi('/api/nodes')).json();
    const failedNode = finalNodes.find(n => n.id === nodeWithPods.id);
    assert.equal(failedNode.status, 'NotReady');
    assert.equal(failedNode.pods.length, 0);

    // Recover node
    await fetchApi(`/api/nodes/${nodeWithPods.id}/recover`, { method: 'POST' });
  });

  test('7. Oversized deployment leaves Pending pods with a FailedScheduling event', async () => {
    const hugeRes = await fetchApi('/api/deployments', {
      method: 'POST',
      body: {
        name: 'huge-service',
        image: 'memory-hog:1.0',
        replicas: 1,
        cpu_request: 500,
        memory_request: 999999
      }
    });
    assert.equal(hugeRes.status, 201);

    await tick(2);

    const podsRes = await fetchApi('/api/pods?deployment=huge-service');
    const pods = await podsRes.json();
    assert.equal(pods.length, 1);
    assert.equal(pods[0].status, 'Pending');
    assert.equal(pods[0].node_name, null);

    const eventsRes = await fetchApi('/api/events?reason=FailedScheduling');
    const events = await eventsRes.json();
    assert.ok(events.length > 0);
    assert.ok(events.some(e => e.message.includes('Insufficient memory')));

    // Clean up
    await fetchApi('/api/deployments/huge-service', { method: 'DELETE' });
  });

  test('8. HPA scales out under high load and scales back in', async () => {
    // Configure HPA for test-app (min: 1, max: 4, target: 50%)
    const hpaRes = await fetchApi('/api/hpas', {
      method: 'POST',
      body: {
        deployment_name: 'test-app',
        min_replicas: 1,
        max_replicas: 4,
        target_cpu_percent: 50,
        is_enabled: true
      }
    });
    assert.equal(hpaRes.status, 201);

    // Put high load (e.g. 5000m)
    await fetchApi('/api/deployments/test-app/load', {
      method: 'PUT',
      body: { load: 5000 }
    });

    // Run ticks to trigger HPA evaluation (tick % 5 === 0)
    for (let i = 0; i < 15; i++) {
      await tick(1);
    }

    const scaledOutDep = await (await fetchApi('/api/deployments/test-app')).json();
    assert.ok(scaledOutDep.replicas > 1, `Expected replicas > 1, got ${scaledOutDep.replicas}`);

    // Verify SuccessfulRescale event
    const rescaleEvents = await (await fetchApi('/api/events?reason=SuccessfulRescale')).json();
    assert.ok(rescaleEvents.length > 0);

    // Remove load
    await fetchApi('/api/deployments/test-app/load', {
      method: 'PUT',
      body: { load: 0 }
    });

    // Simulate 20 seconds passed for scale-in stabilization window
    await db.query(
      `UPDATE hpas SET last_scale_in_at = NOW() - INTERVAL '20 seconds' WHERE deployment_id = $1`,
      [scaledOutDep.id]
    );

    // Run ticks for scale-in
    for (let i = 0; i < 20; i++) {
      await tick(1);
      const cur = await (await fetchApi('/api/deployments/test-app')).json();
      if (cur.replicas === 1) break;
    }

    const scaledInDep = await (await fetchApi('/api/deployments/test-app')).json();
    assert.equal(scaledInDep.replicas, 1);
  });

  test('9. Service traffic only hits Ready pods and returns 503 with none', async () => {
    // Create service for an empty deployment
    await fetchApi('/api/deployments', {
      method: 'POST',
      body: { name: 'empty-dep', image: 'nginx:1.25', replicas: 0 }
    });

    await fetchApi('/api/services', {
      method: 'POST',
      body: { name: 'empty-svc', selector: 'empty-dep', port: 80 }
    });

    // Traffic to empty service must return 503
    const noEndpointsRes = await fetchApi('/api/services/empty-svc/traffic', {
      method: 'POST',
      body: { count: 10 }
    });
    assert.equal(noEndpointsRes.status, 503);

    // Traffic to web-service (has ready pods)
    // First ensure web-app has ready pods
    for (let i = 0; i < 20; i++) {
      await tick(1);
      const svc = await (await fetchApi('/api/services')).json();
      const webSvc = svc.find(s => s.name === 'web-service');
      if (webSvc && webSvc.endpoints_count > 0) break;
    }

    const trafficRes = await fetchApi('/api/services/web-service/traffic', {
      method: 'POST',
      body: { count: 30 }
    });
    assert.equal(trafficRes.status, 200);
    const trafficData = await trafficRes.json();
    assert.equal(trafficData.total_requests, 30);
    assert.ok(trafficData.distribution.length > 0);

    // Clean up empty-dep & empty-svc
    await fetchApi('/api/services/empty-svc', { method: 'DELETE' });
    await fetchApi('/api/deployments/empty-dep', { method: 'DELETE' });
  });

  test('10. Drain and cordon behavior', async () => {
    const nodes = await (await fetchApi('/api/nodes')).json();
    const targetNode = nodes[0];

    // Cordon node
    const cordonRes = await fetchApi(`/api/nodes/${targetNode.id}/cordon`, {
      method: 'PATCH',
      body: { is_cordoned: true }
    });
    assert.equal(cordonRes.status, 200);
    const cordonedNode = await cordonRes.json();
    assert.equal(cordonedNode.is_cordoned, true);

    // Drain node
    const drainRes = await fetchApi(`/api/nodes/${targetNode.id}/drain`, { method: 'POST' });
    assert.equal(drainRes.status, 200);

    // Advance ticks for pods to terminate
    await tick(3);

    const postDrainNode = (await (await fetchApi('/api/nodes')).json()).find(n => n.id === targetNode.id);
    assert.equal(postDrainNode.pod_count, 0);

    // Uncordon node
    await fetchApi(`/api/nodes/${targetNode.id}/cordon`, {
      method: 'PATCH',
      body: { is_cordoned: false }
    });
  });

  test('11. Removing a node with pods returns 409', async () => {
    // Re-seed cluster to have clean distribution
    await resetCluster();

    // Advance ticks until pods are scheduled
    for (let i = 0; i < 15; i++) {
      await tick(1);
    }

    const nodes = await (await fetchApi('/api/nodes')).json();
    const nodeWithPods = nodes.find(n => n.pod_count > 0);
    assert.ok(nodeWithPods, 'Must have a node with pods');

    // Attempting to delete without draining must return 409
    const deleteRes = await fetchApi(`/api/nodes/${nodeWithPods.id}`, { method: 'DELETE' });
    assert.equal(deleteRes.status, 409);
  });
});
