const express = require('express');
const router = express.Router();
const { IMAGE_CATALOG } = require('../images');

// GET /api/images
router.get('/', (req, res) => {
  res.json(Object.values(IMAGE_CATALOG));
});

module.exports = router;
