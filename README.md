# Container Orchestrator

Production-quality mini Kubernetes-style container orchestrator simulator with real-time reconciliation, node scheduling, declarative rolling updates, Horizontal Pod Autoscaling (HPA), Service load balancing, and interactive Chaos Engineering scenarios.

## Overview

Container Orchestrator is a full-stack container orchestration platform simulator designed to emulate Kubernetes primitives and control loop mechanics. It provides declarative cluster management where the system reconciles desired state against actual state in real-time. Features include pod lifecycle management, least-allocated resource scheduling, rolling deployments with maxSurge and maxUnavailable constraints, HPA scaling, service endpoint round-robin routing, and cluster chaos simulation.

## Features

- **Control Loop & Reconciliation**: Idempotent control loop evaluating pod lifecycle states (`Pending` -> `ContainerCreating` -> `Running` -> `Ready`), crash detection, restart backoff, and state recovery from persistent PostgreSQL storage.
- **Node Management & Scheduler**: 
  - Filters nodes by Ready status, cordon state, and available CPU and Memory requests vs capacity.
  - Scores eligible nodes via least-allocated resource algorithm.
  - Emits deduplicated `FailedScheduling` events when resources are insufficient.
  - Supports cordon, uncordon, graceful node draining, and simulated node failure/recovery.
- **Declarative Deployments & Rolling Updates**:
  - Reconciles desired replica counts against active pods.
  - Rolling updates with configurable `maxSurge` and `maxUnavailable` parameters.
  - Rollout progress deadline detection (30-second stall timeout for broken images emitting `RolloutStalled` / `ProgressDeadlineExceeded`).
  - Revision history tracking with instant rollback to any prior revision.
  - Pause and resume deployment rollout controls.
- **Horizontal Pod Autoscaler (HPA)**:
  - Automated scaling between min and max replicas based on CPU demand.
  - Scale-out triggered when average CPU utilization breaches target threshold.
  - Scale-in triggered below 60% of target threshold with a 15-second stabilization window to prevent flapping.
  - Simulated workload generator via dynamic millicore demand adjustments.
- **Services & Endpoint Load Balancing**:
  - Exposes services with `ClusterIP`, `NodePort`, or `LoadBalancer` types.
  - Dynamically updates active endpoints based on Ready pods.
  - Live round-robin traffic distribution with pod-level request counting and HTTP 503 handling when zero endpoints are available.
- **Event Auditing & Metrics History**:
  - Tracks cluster lifecycle events (`Scheduled`, `Pulled`, `Started`, `Killing`, `ScalingReplicaSet`, `FailedScheduling`, `BackOff`, `NodeNotReady`, `SuccessfulRescale`, `RolloutStalled`).
  - Automatic circular buffer pruning capped at 1,000 events.
  - Cluster metrics time-series snapshots (pods by state, CPU/memory allocation) stored every 2 ticks (capped at 300 data points).
- **Chaos Engineering Lab**:
  - Guided step-by-step simulations: Bad Rollout & Rollback, Node Failure, Traffic Spike, and Resource Exhaustion.
  - Ad-hoc chaos triggers: terminate random pods, fail random nodes, and reset cluster to seed state.

## Architecture

```
+-------------------------------------------------------------------------------+
|                             Next.js 14 Web UI                                |
|  Overview | Nodes | Deployments | Pods | Services | Autoscaler | Chaos Lab    |
+-------------------------------------------------------------------------------+
                                      |
                           HTTP REST / JWT Auth
                                      v
+-------------------------------------------------------------------------------+
|                              Express Backend                                  |
|                                                                               |
|  +--------------------+   +---------------------+   +---------------------+   |
|  | Controller Loop    |   | Scheduler Engine    |   | HPA Controller      |   |
|  | - Pod Lifecycles   |   | - Filter & Score    |   | - CPU Demand Model  |   |
|  | - Rolling Updates  |   | - Least-Allocated   |   | - Stabilization Win |   |
|  | - Node Health      |   | - FailedScheduling  |   | - Metric Snapshots  |   |
|  +--------------------+   +---------------------+   +---------------------+   |
+-------------------------------------------------------------------------------+
                                      |
                              PostgreSQL Pool
                                      v
+-------------------------------------------------------------------------------+
|                                PostgreSQL                                     |
|  users | nodes | deployments | deployment_revisions | pods | hpas | services  |
|  events | metrics_history                                                     |
+-------------------------------------------------------------------------------+
```

### Controller Loop
The core reconciliation loop executes on every tick (`TICK_MS`, default 1000ms, or manual invocation via `POST /api/tick`). It enforces a lock to prevent overlapping runs. During each cycle, it:
1. Detects nodes in `NotReady` status past a 5-second grace period, marking pods as `Unknown`, terminating them, and triggering rescheduling.
2. Identifies pods in `Terminating` status for longer than 2 seconds and deletes them.
3. Advances pod phases: `Pending` scheduled pods transition to `ContainerCreating` (2s delay), then `Running`. Pods become `Ready` once their image startup delay expires.
4. Detects crashing images (`api:broken`), shifting them to `CrashLoopBackOff` with exponential backoff delays (2s, 4s, 8s, up to 30s) and incrementing `restart_count`.
5. Executes the Deployment controller to create or terminate pods matching replica targets and active rolling update parameters.
6. Assesses rollout health against a 30-second progress deadline.
7. Evaluates HPA metrics and records cluster metric snapshots every 2 ticks.

### Scheduler
The scheduler is invoked during reconciliation for pods with `node_id = NULL` and status `Pending`:
1. **Filtering**: Identifies candidate nodes that are `Ready`, uncordoned (`cordoned = false`), and have sufficient unreserved CPU and memory capacity.
2. **Scoring**: Computes free capacity ratios `(free_cpu / total_cpu) + (free_memory / total_memory)` and selects the node with the highest unallocated score.
3. **Event Recording**: When no candidate qualifies, the pod remains `Pending` and a `FailedScheduling` warning is logged once per pod to avoid log saturation.

### Rolling Update Strategy
Deployments maintain zero-downtime updates through `maxSurge` and `maxUnavailable` controls:
- **maxSurge**: Maximum number of pods created beyond the desired replica count.
- **maxUnavailable**: Maximum number of pods unavailable during the update process.
- The controller creates new-revision pods, waits until they achieve `Ready` status, and sequentially terminates old-revision pods while ensuring active ready pods never drop below `desired_replicas - maxUnavailable`.
- Rollbacks create a new rolling update targeting the selected historical revision.

### Horizontal Pod Autoscaler (HPA)
- Target CPU utilization percentage is evaluated across all `Ready` pods for a deployment.
- Deployment demand is calculated as `average_cpu_pct = load / (ready_pods * cpu_request) * 100` (capped at 100%).
- Scale-out expands replicas up to `max_replicas` when utilization exceeds `target_cpu_percentage`.
- Scale-in contracts replicas down to `min_replicas` when utilization drops below 60% of `target_cpu_percentage`, constrained by a 15-second stabilization window to dampen transient oscillations.

## Tech Stack

| Layer | Technologies |
|---|---|
| Frontend | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS v3, Inline SVG Visualizations |
| Backend | Node.js, Express 4.21, pg (node-postgres), bcryptjs, jsonwebtoken, cors, dotenv |
| Database | PostgreSQL 16 |
| Containerization | Docker, Docker Compose |
| Testing | Node.js Built-in Test Runner (`node:test`), native `fetch` |

## Project Structure

```
./container-orchestrator/
  frontend/
    src/
      app/
        layout.tsx
        globals.css
        page.tsx                     # Overview Dashboard
        login/page.tsx               # Authentication
        nodes/page.tsx               # Node Operations & Provisioning
        deployments/page.tsx         # Deployments List & Creation
        deployments/[name]/page.tsx  # Deployment Rollout, Revisions & HPA
        pods/page.tsx                # Pod Management & Detail Drawer
        services/page.tsx            # Services & Traffic Generator
        autoscaler/page.tsx          # HPA Dashboard & Workload Generator
        events/page.tsx              # Filterable Event Log
        chaos/page.tsx               # Chaos Engineering Lab
      components/
        Badge.tsx
        Card.tsx
        ConfirmDialog.tsx
        Header.tsx
        LiveContext.tsx
        Modal.tsx
        ProgressBar.tsx
        Shell.tsx
        Sidebar.tsx
        Table.tsx
        Toast.tsx
      lib/
        api.ts                       # Typed API Client with JWT Interceptor
    Dockerfile
    package.json
    postcss.config.js
    tailwind.config.ts
    tsconfig.json
    .env.example
    .env.local
    .gitignore
  backend/
    src/
      routes/
        auth.js
        chaos.js
        deployments.js
        events.js
        hpa.js
        images.js
        metrics.js
        nodes.js
        pods.js
        services.js
      auth.js
      controller.js                  # Reconciliation Loop
      db.js                          # Connection Pool with Retry Logic
      events.js                      # Event Bus & Persistence
      hpa.js                         # Autoscaling Engine
      images.js                      # Container Image Catalog
      scheduler.js                   # Node Placement Engine
      server.js                      # HTTP Server & Route Registration
    test/
      api.test.js                    # Integration Test Suite
    Dockerfile
    package.json
    .env
    .env.example
    .gitignore
  database/
    init.sql                         # Complete Relational Schema & Seed Data
  docker-compose.yml
  .gitignore
  README.md
```

## Getting Started

### Prerequisites
- Node.js 18+ or 20+
- Docker and Docker Compose (for containerized execution)
- PostgreSQL 16 (if running locally without Docker)

### Option 1: Docker Compose

1. Clone or navigate to the repository directory:
   ```bash
   cd ./container-orchestrator
   ```

2. Start the database, backend, and frontend containers:
   ```bash
   docker compose up --build -d
   ```

3. Access the services:
   - Frontend UI: `http://localhost:3010`
   - Backend API: `http://localhost:4010`
   - PostgreSQL: `localhost:5450`

### Option 2: Local Development

1. **Start PostgreSQL**:
   Ensure PostgreSQL is running on port 5450 with database `orchestrator`, and initialize the schema:
   ```bash
   psql -h localhost -p 5450 -U postgres -d orchestrator -f database/init.sql
   ```

2. **Start Backend**:
   ```bash
   cd backend
   npm install
   npm start
   ```

3. **Start Frontend**:
   ```bash
   cd ../frontend
   npm install
   npm run dev -- -p 3010
   ```

4. Open `http://localhost:3010` in your browser.

## Demo Credentials

- **Username**: `admin@demo.com`
- **Password**: `demo123`

The application includes a one-click demo login button on the login screen.

## Environment Variables

### Backend (`backend/.env`)

| Variable | Description | Default |
|---|---|---|
| `PORT` | HTTP server listen port | `4010` |
| `DATABASE_URL` | PostgreSQL connection string | `postgres://postgres:postgres@localhost:5450/orchestrator` |
| `JWT_SECRET` | Secret key for signing JWT tokens | `orchestrator-jwt-secret-key-super-secure-change-in-prod` |
| `CORS_ORIGIN` | Allowed origin for CORS requests | `http://localhost:3010` |
| `TICK_MS` | Control loop cycle interval in milliseconds | `1000` |

### Frontend (`frontend/.env.local`)

| Variable | Description | Default |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Base URL for backend API requests | `http://localhost:4010` |

## API Endpoints

All endpoints except `GET /health` and `POST /api/auth/login` require an `Authorization: Bearer <token>` header.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check endpoint |
| `POST` | `/api/auth/login` | Authenticate user and receive JWT |
| `POST` | `/api/tick` | Trigger a single reconciliation cycle |
| `GET` | `/api/overview` | Cluster resource totals, allocation gauges, and status counts |
| `GET` | `/api/metrics/history` | Time-series metrics history for cluster visualizations |
| `GET` | `/api/images` | Catalog of available container images |
| `GET` | `/api/nodes` | List all cluster nodes |
| `POST` | `/api/nodes` | Provision a new cluster node |
| `GET` | `/api/nodes/:id` | Get node details |
| `PUT` | `/api/nodes/:id/cordon` | Toggle node cordoned status |
| `POST` | `/api/nodes/:id/drain` | Cordon and terminate pods on node for rescheduling |
| `POST` | `/api/nodes/:id/fail` | Mark node NotReady to trigger pod eviction |
| `POST` | `/api/nodes/:id/recover` | Recover node to Ready status |
| `DELETE` | `/api/nodes/:id` | Remove node (requires draining first) |
| `GET` | `/api/deployments` | List all deployments |
| `POST` | `/api/deployments` | Create a new deployment |
| `GET` | `/api/deployments/:name` | Get deployment details, rollout state, and revisions |
| `PUT` | `/api/deployments/:name` | Update deployment image, replica count, or strategy |
| `PUT` | `/api/deployments/:name/scale` | Scale deployment replicas |
| `PUT` | `/api/deployments/:name/load` | Update simulated CPU demand (millicores) |
| `POST` | `/api/deployments/:name/pause` | Pause active deployment rollout |
| `POST` | `/api/deployments/:name/resume` | Resume paused deployment rollout |
| `POST` | `/api/deployments/:name/rollback` | Roll back deployment to a specified revision |
| `DELETE` | `/api/deployments/:name` | Delete deployment and terminate associated pods |
| `GET` | `/api/pods` | List all pods with optional status/node/deployment filters |
| `GET` | `/api/pods/:id` | Get pod details and lifecycle event history |
| `DELETE` | `/api/pods/:id` | Terminate pod |
| `GET` | `/api/services` | List all configured services |
| `POST` | `/api/services` | Create a new service |
| `GET` | `/api/services/:name` | Get service configuration and live endpoints |
| `POST` | `/api/services/:name/traffic` | Dispatch simulated traffic requests across ready pods |
| `DELETE` | `/api/services/:name` | Delete service |
| `GET` | `/api/hpas` | List all Horizontal Pod Autoscaler configurations |
| `POST` | `/api/hpas` | Create or update HPA configuration for a deployment |
| `DELETE` | `/api/hpas/:deployment_name` | Remove HPA configuration |
| `GET` | `/api/events` | Retrieve cluster event log with optional filters |
| `POST` | `/api/chaos/kill-pod` | Terminate a random or specific pod |
| `POST` | `/api/chaos/fail-node` | Trigger failure on a random or specific node |
| `POST` | `/api/chaos/reset-cluster` | Reset cluster to initial seed configuration |

## Chaos Lab Scenarios

1. **Bad Rollout and Rollback**:
   - Updates `web-app` to crashing image `api:broken`.
   - Triggers reconciliation ticks and observes rollout stalling (`ProgressDeadlineExceeded`).
   - Verifies old revision pods continue serving traffic.
   - Triggers rollback to restore previous working revision.
2. **Node Failure**:
   - Identifies a node hosting running pods and marks it `NotReady`.
   - Simulates failure grace period, marking pods `Unknown` then deleting them.
   - Verifies the scheduler reschedules replacement pods on healthy nodes.
3. **Traffic Spike**:
   - Increases deployment load to 3,000 millicores.
   - Observes HPA controller scaling out replicas to satisfy the CPU threshold.
   - Lowers load and observes stabilization window prior to scale-in.
4. **Resource Exhaustion**:
   - Creates a large deployment requesting CPU or memory beyond total cluster capacity.
   - Observes pods remaining in `Pending` state.
   - Verifies deduplicated `FailedScheduling` events in the cluster event log.

## Running Tests

Integration tests run against the backend using Node.js built-in test runner:

```bash
cd backend
npm test
```

The test suite validates:
- Authentication verification and 401 unauthorized rejection.
- Deployment creation reaching desired ready replica counts.
- Dynamic scaling up and scaling down.
- Rolling updates maintaining `replicas - maxUnavailable` availability.
- Broken image rollout stall detection and rollback restoration.
- Node failure pod eviction and rescheduling.
- Resource exhaustion with pending pods and `FailedScheduling` event logging.
- HPA scale-out and stabilized scale-in.
- Service traffic distribution across ready endpoints and 503 error handling.
- Node cordon and drain behaviors.
- Conflict rejection (HTTP 409) when attempting to delete an undrained node.

## Notes

- All cluster state is persisted in PostgreSQL to ensure the controller loop can resume state seamlessly across restarts.
- Overlapping reconcile iterations are guarded by an in-memory lock flag.
- Circular log pruning ensures database storage remains bounded in long-running simulation environments.

## License

MIT
