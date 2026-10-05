-- Mini Kubernetes-style Container Orchestrator Schema
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS nodes (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    cpu_capacity INTEGER NOT NULL DEFAULT 4000, -- millicores
    memory_capacity INTEGER NOT NULL DEFAULT 8192, -- MB
    status VARCHAR(20) NOT NULL DEFAULT 'Ready', -- 'Ready', 'NotReady'
    is_cordoned BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS deployments (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    namespace VARCHAR(100) NOT NULL DEFAULT 'default',
    replicas INTEGER NOT NULL DEFAULT 1,
    image VARCHAR(100) NOT NULL,
    cpu_request INTEGER NOT NULL DEFAULT 250, -- millicores
    memory_request INTEGER NOT NULL DEFAULT 256, -- MB
    max_surge INTEGER NOT NULL DEFAULT 1,
    max_unavailable INTEGER NOT NULL DEFAULT 0,
    current_revision INTEGER NOT NULL DEFAULT 1,
    is_paused BOOLEAN NOT NULL DEFAULT false,
    rollout_status VARCHAR(50) NOT NULL DEFAULT 'Complete', -- 'Complete', 'Progressing', 'Stalled', 'Paused'
    rollout_started_at TIMESTAMP WITH TIME ZONE,
    simulated_load INTEGER NOT NULL DEFAULT 0, -- total demand in millicores
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS deployment_revisions (
    id SERIAL PRIMARY KEY,
    deployment_id INTEGER NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    revision_number INTEGER NOT NULL,
    image VARCHAR(100) NOT NULL,
    cpu_request INTEGER NOT NULL,
    memory_request INTEGER NOT NULL,
    cause VARCHAR(255) DEFAULT 'InitialDeployment',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_deployment_revision UNIQUE(deployment_id, revision_number)
);

CREATE TABLE IF NOT EXISTS pods (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) UNIQUE NOT NULL,
    namespace VARCHAR(100) NOT NULL DEFAULT 'default',
    deployment_id INTEGER REFERENCES deployments(id) ON DELETE CASCADE,
    revision_id INTEGER REFERENCES deployment_revisions(id) ON DELETE SET NULL,
    node_id INTEGER REFERENCES nodes(id) ON DELETE SET NULL,
    image VARCHAR(100) NOT NULL,
    cpu_request INTEGER NOT NULL DEFAULT 250,
    memory_request INTEGER NOT NULL DEFAULT 256,
    status VARCHAR(50) NOT NULL DEFAULT 'Pending', -- 'Pending', 'ContainerCreating', 'Running', 'Ready', 'CrashLoopBackOff', 'Terminating', 'Unknown'
    is_ready BOOLEAN NOT NULL DEFAULT false,
    restart_count INTEGER NOT NULL DEFAULT 0,
    backoff_count INTEGER NOT NULL DEFAULT 0,
    backoff_until TIMESTAMP WITH TIME ZONE,
    state_entered_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    node_failed_at TIMESTAMP WITH TIME ZONE,
    terminating_since TIMESTAMP WITH TIME ZONE,
    failed_scheduling_logged BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hpas (
    id SERIAL PRIMARY KEY,
    deployment_id INTEGER UNIQUE NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    min_replicas INTEGER NOT NULL DEFAULT 1,
    max_replicas INTEGER NOT NULL DEFAULT 10,
    target_cpu_percent INTEGER NOT NULL DEFAULT 70,
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    last_scale_in_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS services (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    namespace VARCHAR(100) NOT NULL DEFAULT 'default',
    type VARCHAR(30) NOT NULL DEFAULT 'ClusterIP', -- 'ClusterIP', 'NodePort', 'LoadBalancer'
    port INTEGER NOT NULL DEFAULT 80,
    target_port INTEGER NOT NULL DEFAULT 80,
    selector VARCHAR(100) NOT NULL, -- deployment name
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    type VARCHAR(20) NOT NULL DEFAULT 'Normal', -- 'Normal', 'Warning'
    reason VARCHAR(100) NOT NULL,
    object_kind VARCHAR(50) NOT NULL, -- 'Pod', 'Deployment', 'Node', 'HPA', 'Service'
    object_name VARCHAR(150) NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);

CREATE TABLE IF NOT EXISTS metrics_history (
    id SERIAL PRIMARY KEY,
    pods_running INTEGER NOT NULL DEFAULT 0,
    pods_pending INTEGER NOT NULL DEFAULT 0,
    pods_ready INTEGER NOT NULL DEFAULT 0,
    pods_failing INTEGER NOT NULL DEFAULT 0,
    cpu_requested INTEGER NOT NULL DEFAULT 0,
    memory_requested INTEGER NOT NULL DEFAULT 0,
    ready_nodes INTEGER NOT NULL DEFAULT 0,
    total_nodes INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_metrics_created ON metrics_history(created_at DESC);

-- Seed default user (admin@demo.com / demo123)
INSERT INTO users (id, email, password_hash)
VALUES (1, 'admin@demo.com', '$2a$10$PaxlebeE6MoVPLq0Dtq82OH7ow5SPPTcrZV.Fw6PyrhmI4OOQO9Ma')
ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash;

-- Seed 3 standard nodes (4000m CPU, 8192 MB memory each)
INSERT INTO nodes (id, name, cpu_capacity, memory_capacity, status, is_cordoned) VALUES
(1, 'node-1', 4000, 8192, 'Ready', false),
(2, 'node-2', 4000, 8192, 'Ready', false),
(3, 'node-3', 4000, 8192, 'Ready', false)
ON CONFLICT (id) DO NOTHING;

-- Seed 2 sample deployments
INSERT INTO deployments (id, name, namespace, replicas, image, cpu_request, memory_request, max_surge, max_unavailable, current_revision, is_paused, rollout_status) VALUES
(1, 'web-app', 'default', 2, 'nginx:1.25', 250, 256, 1, 0, 1, false, 'Complete'),
(2, 'auth-service', 'default', 2, 'api:v1', 500, 512, 1, 0, 1, false, 'Complete')
ON CONFLICT (id) DO NOTHING;

-- Seed revisions for sample deployments
INSERT INTO deployment_revisions (id, deployment_id, revision_number, image, cpu_request, memory_request, cause) VALUES
(1, 1, 1, 'nginx:1.25', 250, 256, 'InitialDeployment'),
(2, 2, 1, 'api:v1', 500, 512, 'InitialDeployment')
ON CONFLICT (id) DO NOTHING;

-- Seed HPA for web-app
INSERT INTO hpas (id, deployment_id, min_replicas, max_replicas, target_cpu_percent, is_enabled) VALUES
(1, 1, 1, 6, 70, true)
ON CONFLICT (id) DO NOTHING;

-- Seed sample service for web-app
INSERT INTO services (id, name, namespace, type, port, target_port, selector) VALUES
(1, 'web-service', 'default', 'ClusterIP', 80, 80, 'web-app')
ON CONFLICT (id) DO NOTHING;

-- Reset serial sequences
SELECT setval('users_id_seq', (SELECT COALESCE(MAX(id), 1) FROM users));
SELECT setval('nodes_id_seq', (SELECT COALESCE(MAX(id), 1) FROM nodes));
SELECT setval('deployments_id_seq', (SELECT COALESCE(MAX(id), 1) FROM deployments));
SELECT setval('deployment_revisions_id_seq', (SELECT COALESCE(MAX(id), 1) FROM deployment_revisions));
SELECT setval('pods_id_seq', (SELECT COALESCE(MAX(id), 1) FROM pods));
SELECT setval('hpas_id_seq', (SELECT COALESCE(MAX(id), 1) FROM hpas));
SELECT setval('services_id_seq', (SELECT COALESCE(MAX(id), 1) FROM services));
SELECT setval('events_id_seq', (SELECT COALESCE(MAX(id), 1) FROM events));
SELECT setval('metrics_history_id_seq', (SELECT COALESCE(MAX(id), 1) FROM metrics_history));
