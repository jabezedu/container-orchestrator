const db = require('./db');

async function recordEvent(executor, { type = 'Normal', reason, objectKind, objectName, message }) {
  try {
    const runner = executor || db;
    await runner.query(
      `INSERT INTO events (type, reason, object_kind, object_name, message, created_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
      [type, reason, objectKind, objectName, message]
    );

    // Prune events beyond the latest 1000
    await runner.query(
      `DELETE FROM events 
       WHERE id NOT IN (
         SELECT id FROM events ORDER BY created_at DESC, id DESC LIMIT 1000
       )`
    );
  } catch (err) {
    console.error('Error recording event:', err.message);
  }
}

module.exports = {
  recordEvent
};
