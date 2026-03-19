const express = require('express');
const bcrypt = require('bcryptjs');
const { getQuery, runQuery } = require('../lib/database');
const { authenticateToken, signToken } = require('../lib/auth');

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { username, password, email, invitationCode } = req.body || {};

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    if (username.length < 3 || username.length > 20) {
      res.status(400).json({ error: 'Username must be 3-20 characters' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' });
      return;
    }

    if ((process.env.INVITATION_CODE || '').trim() && invitationCode !== process.env.INVITATION_CODE) {
      res.status(400).json({ error: 'Invalid invitation code' });
      return;
    }

    const existing = await getQuery('SELECT id FROM users WHERE username = ?', [username]);
    if (existing) {
      res.status(409).json({ error: 'Username already exists' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await runQuery(
      'INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
      [username, passwordHash, email || null]
    );

    const user = { id: result.id, username, email: email || null };
    res.status(201).json({
      token: signToken(user),
      user
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    const user = await getQuery('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    res.json({
      token: signToken(user),
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await getQuery(
      'SELECT id, username, email, created_at FROM users WHERE id = ?',
      [req.user.userId]
    );

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json(user);
  } catch (error) {
    console.error('Auth me error:', error);
    res.status(500).json({ error: 'Failed to load user' });
  }
});

module.exports = router;
