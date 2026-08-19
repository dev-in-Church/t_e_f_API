const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { authenticateToken, requireStaff } = require('../middleware/auth');

const router = express.Router();

// Get all news articles (public)
router.get('/', async (req, res) => {
  const { category, featured, limit = 20, offset = 0 } = req.query;

  try {
    let queryText = `
      SELECT n.id, n.title, n.slug, n.excerpt, n.content, n.image_url, 
             n.category, n.author_id, n.is_featured, n.published_at, n.created_at,
             u.name as author_name
      FROM news_articles n
      LEFT JOIN users u ON n.author_id = u.id
      WHERE n.is_published = true AND n.published_at <= NOW()
    `;
    const queryParams = [];
    let paramCount = 0;

    if (category) {
      paramCount++;
      queryText += ` AND n.category = $${paramCount}`;
      queryParams.push(category);
    }

    if (featured === 'true') {
      queryText += ` AND n.is_featured = true`;
    }

    queryText += ` ORDER BY n.is_featured DESC, n.published_at DESC`;
    queryText += ` LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    queryParams.push(parseInt(limit), parseInt(offset));

    const result = await query(queryText, queryParams);

    // Get categories
    const categories = await query(
      `SELECT DISTINCT category FROM news_articles WHERE is_published = true ORDER BY category`
    );

    res.json({
      articles: result.rows,
      categories: categories.rows.map(c => c.category),
    });
  } catch (error) {
    console.error('Error fetching news:', error);
    res.status(500).json({ error: 'Failed to fetch news' });
  }
});

// Get single article (public)
router.get('/:slug', async (req, res) => {
  try {
    const result = await query(
      `SELECT n.*, u.name as author_name
       FROM news_articles n
       LEFT JOIN users u ON n.author_id = u.id
       WHERE n.slug = $1 AND n.is_published = true`,
      [req.params.slug]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Article not found' });
    }

    // Increment view count
    await query(
      'UPDATE news_articles SET view_count = view_count + 1 WHERE id = $1',
      [result.rows[0].id]
    );

    res.json({ article: result.rows[0] });
  } catch (error) {
    console.error('Error fetching article:', error);
    res.status(500).json({ error: 'Failed to fetch article' });
  }
});

// Create article (admin)
router.post('/', authenticateToken, requireStaff, [
  body('title').trim().notEmpty(),
  body('slug').trim().notEmpty(),
  body('content').trim().notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const {
    title, slug, excerpt, content, image_url, category,
    is_featured, is_published, published_at,
  } = req.body;

  try {
    const result = await query(
      `INSERT INTO news_articles 
       (title, slug, excerpt, content, image_url, category, author_id, 
        is_featured, is_published, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [title, slug, excerpt, content, image_url, category || 'General',
       req.user.id, is_featured || false, is_published || false,
       published_at || (is_published ? new Date() : null)]
    );

    res.status(201).json({ article: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Article with this slug already exists' });
    }
    console.error('Error creating article:', error);
    res.status(500).json({ error: 'Failed to create article' });
  }
});

// Update article (admin)
router.put('/:id', authenticateToken, requireStaff, async (req, res) => {
  const {
    title, slug, excerpt, content, image_url, category,
    is_featured, is_published, published_at,
  } = req.body;

  try {
    const result = await query(
      `UPDATE news_articles SET
       title = COALESCE($1, title),
       slug = COALESCE($2, slug),
       excerpt = COALESCE($3, excerpt),
       content = COALESCE($4, content),
       image_url = COALESCE($5, image_url),
       category = COALESCE($6, category),
       is_featured = COALESCE($7, is_featured),
       is_published = COALESCE($8, is_published),
       published_at = COALESCE($9, published_at),
       updated_at = NOW()
       WHERE id = $10 RETURNING *`,
      [title, slug, excerpt, content, image_url, category,
       is_featured, is_published, published_at, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Article not found' });
    }

    res.json({ article: result.rows[0] });
  } catch (error) {
    console.error('Error updating article:', error);
    res.status(500).json({ error: 'Failed to update article' });
  }
});

// Delete article (admin)
router.delete('/:id', authenticateToken, requireStaff, async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM news_articles WHERE id = $1 RETURNING id',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Article not found' });
    }

    res.json({ message: 'Article deleted successfully' });
  } catch (error) {
    console.error('Error deleting article:', error);
    res.status(500).json({ error: 'Failed to delete article' });
  }
});

// Newsletter subscription
router.post('/subscribe', [
  body('email').isEmail().normalizeEmail(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email, name } = req.body;

  try {
    await query(
      `INSERT INTO newsletter_subscribers (email, name)
       VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET is_active = true, updated_at = NOW()`,
      [email, name]
    );

    res.json({ message: 'Subscribed successfully' });
  } catch (error) {
    console.error('Error subscribing:', error);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

module.exports = router;
