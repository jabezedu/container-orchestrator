const { Pool } = require('pg');
require('dotenv').config();

let connectionString = process.env.DATABASE_URL;

// On Windows without direct localhost port forwarding to WSL2, fallback to WSL eth0 IP if localhost fails
let cachedWslIp = '172.20.141.250';

function getResolvedConnectionString(rawUrl) {
  if (!rawUrl) return rawUrl;
  if (process.platform === 'win32' && rawUrl.includes('localhost:5450')) {
    try {
      const { execSync } = require('child_process');
      const out = execSync('wsl -d Ubuntu -e hostname -I', { encoding: 'utf8', timeout: 1000 });
      const ip = out.trim().split(/\s+/)[0];
      if (ip && /^(\d+\.){3}\d+$/.test(ip)) {
        cachedWslIp = ip;
      }
    } catch (e) {
      // use cachedWslIp
    }
    return rawUrl.replace('localhost:5450', `${cachedWslIp}:5450`);
  }
  return rawUrl;
}

const resolvedUrl = getResolvedConnectionString(connectionString);

const pool = new Pool({
  connectionString: resolvedUrl
});

async function connectWithRetry(retries = 15, delay = 2000) {
  for (let i = 1; i <= retries; i++) {
    try {
      const client = await pool.connect();
      client.release();
      return pool;
    } catch (err) {
      if (i === retries) {
        throw new Error(`Unable to connect to database after ${retries} attempts: ${err.message}`);
      }
      await new Promise(res => setTimeout(res, delay));
    }
  }
}

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  connectWithRetry
};
