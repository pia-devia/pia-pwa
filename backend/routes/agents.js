const express = require('express');
const { authMiddleware } = require('../middlewares/auth');

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

/**
 * GET /api/agents
 * Returns list of available agents
 */
router.get('/', (req, res) => {
  const agents = [
    { id: 'kai', name: 'Kai', emoji: '🤖' },
    { id: 'po-kai', name: 'PO-Kai', emoji: '🧩' },
  ];
  res.json(agents);
});

module.exports = router;
