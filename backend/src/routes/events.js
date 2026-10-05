const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/events
router.get('/', async (req, res) => {
  const { type, object_kind, search, limit = 100 } = req.query;

  try {
    let query = 'SELECT * FROM events WHERE 1=1';
    const params = [];

    if (type) {
      params.push(type);
      query += ` AND type = $${params.length}`;
    }
    if (object_kind) {
      params.push(object_kind);
      query += ` AND object_kind = $${params.length}`;
    }
    if (search) {
      params.push(`%${search.trim()}%`);
      query += ` AND (message ILIKE $${params.length} OR object_name ILIKE $${params.length} OR reason ILIKE $${params.length})`;
    }

    const lim = Math.min(500, Math.max(1, parseInt(limit, 10) || 100));
    params.push(lim);
    query += ` ORDER BY created_at DESC, id DESC LIMIT $${params.length}`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('List events error:', err);
    res.status(500).json({ error: 'Failed to retrieve events' });
  }
});

module.exports = router;
