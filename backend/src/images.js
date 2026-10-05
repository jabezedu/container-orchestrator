const IMAGE_CATALOG = {
  'nginx:1.25': {
    name: 'nginx:1.25',
    readyDelaySeconds: 2,
    crashes: false,
    crashDelaySeconds: 0,
    defaultCpu: 250,
    defaultMemory: 256,
    description: 'Lightweight web server, ready in 2s'
  },
  'nginx:1.26': {
    name: 'nginx:1.26',
    readyDelaySeconds: 2,
    crashes: false,
    crashDelaySeconds: 0,
    defaultCpu: 250,
    defaultMemory: 256,
    description: 'Updated web server release, ready in 2s'
  },
  'api:v1': {
    name: 'api:v1',
    readyDelaySeconds: 3,
    crashes: false,
    crashDelaySeconds: 0,
    defaultCpu: 500,
    defaultMemory: 512,
    description: 'REST API backend v1, ready in 3s'
  },
  'api:v2': {
    name: 'api:v2',
    readyDelaySeconds: 3,
    crashes: false,
    crashDelaySeconds: 0,
    defaultCpu: 500,
    defaultMemory: 512,
    description: 'REST API backend v2, ready in 3s'
  },
  'slow-start:1.0': {
    name: 'slow-start:1.0',
    readyDelaySeconds: 12,
    crashes: false,
    crashDelaySeconds: 0,
    defaultCpu: 500,
    defaultMemory: 512,
    description: 'Heavy initialization workload, ready in 12s'
  },
  'api:broken': {
    name: 'api:broken',
    readyDelaySeconds: 99999,
    crashes: true,
    crashDelaySeconds: 3,
    defaultCpu: 500,
    defaultMemory: 512,
    description: 'Faulty service that crashes 3s after start (never ready)'
  },
  'memory-hog:1.0': {
    name: 'memory-hog:1.0',
    readyDelaySeconds: 2,
    crashes: false,
    crashDelaySeconds: 0,
    defaultCpu: 500,
    defaultMemory: 2048,
    description: 'High-memory workload (requests 2048 MB by default)'
  }
};

function getImageInfo(imageName) {
  return IMAGE_CATALOG[imageName] || {
    name: imageName,
    readyDelaySeconds: 2,
    crashes: false,
    crashDelaySeconds: 0,
    defaultCpu: 250,
    defaultMemory: 256,
    description: 'Custom container image'
  };
}

module.exports = {
  IMAGE_CATALOG,
  getImageInfo
};
