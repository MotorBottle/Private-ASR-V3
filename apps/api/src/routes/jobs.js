const express = require('express');
const { authenticateToken } = require('../lib/auth');
const { getQuery, allQuery } = require('../lib/database');

const router = express.Router();

router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const job = await getQuery(
      `SELECT j.*
       FROM jobs j
       JOIN records r ON r.id = j.record_id
       WHERE j.id = ? AND r.user_id = ?`,
      [req.params.id, req.user.userId]
    );

    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    res.json(job);
  } catch (error) {
    console.error('Get job error:', error);
    res.status(500).json({ error: 'Failed to load job' });
  }
});

router.get('/', authenticateToken, async (req, res) => {
  try {
    const jobs = await allQuery(
      `SELECT j.*
       FROM jobs j
       JOIN records r ON r.id = j.record_id
       WHERE r.user_id = ?
       ORDER BY j.created_at DESC
       LIMIT 100`,
      [req.user.userId]
    );

    res.json({ jobs });
  } catch (error) {
    console.error('List jobs error:', error);
    res.status(500).json({ error: 'Failed to load jobs' });
  }
});

module.exports = router;
