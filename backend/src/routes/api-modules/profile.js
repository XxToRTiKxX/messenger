function registerProfileRoutes(router, deps) {
  const { authenticateToken, query, logger } = deps;

  router.get('/user/profile', authenticateToken, async (req, res) => {
    try {
      const result = await query(
        'SELECT id, username, email FROM users WHERE id = $1 LIMIT 1',
        [req.user.userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const user = result.rows[0];
      return res.json({
        userId: user.id,
        username: user.username,
        email: user.email,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      logger.error('Profile fetch failed', { error: err.message, userId: req.user.userId });
      return res.status(500).json({ error: 'Failed to load profile' });
    }
  });
}

module.exports = registerProfileRoutes;
