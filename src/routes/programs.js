const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { authenticateToken, requireStaff } = require('../middleware/auth');

const router = express.Router();

// Get all programs (public)
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, name, slug, description, image_url, is_active, created_at
       FROM programs 
       WHERE is_active = true 
       ORDER BY sort_order, name`
    );
    res.json({ programs: result.rows });
  } catch (error) {
    console.error('Error fetching programs:', error);
    res.status(500).json({ error: 'Failed to fetch programs' });
  }
});

// Get single program (public)
router.get('/:slug', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM programs WHERE slug = $1 AND is_active = true`,
      [req.params.slug]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Program not found' });
    }

    res.json({ program: result.rows[0] });
  } catch (error) {
    console.error('Error fetching program:', error);
    res.status(500).json({ error: 'Failed to fetch program' });
  }
});

// Create program (admin)
router.post('/', authenticateToken, requireStaff, [
  body('name').trim().notEmpty(),
  body('slug').trim().notEmpty(),
  body('description').trim().notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { name, slug, description, image_url, sort_order } = req.body;

  try {
    const result = await query(
      `INSERT INTO programs (name, slug, description, image_url, sort_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, slug, description, image_url, sort_order || 0]
    );

    res.status(201).json({ program: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Program with this slug already exists' });
    }
    console.error('Error creating program:', error);
    res.status(500).json({ error: 'Failed to create program' });
  }
});

// Update program (admin)
router.put('/:id', authenticateToken, requireStaff, async (req, res) => {
  const { name, slug, description, image_url, is_active, sort_order } = req.body;

  try {
    const result = await query(
      `UPDATE programs 
       SET name = COALESCE($1, name),
           slug = COALESCE($2, slug),
           description = COALESCE($3, description),
           image_url = COALESCE($4, image_url),
           is_active = COALESCE($5, is_active),
           sort_order = COALESCE($6, sort_order),
           updated_at = NOW()
       WHERE id = $7 RETURNING *`,
      [name, slug, description, image_url, is_active, sort_order, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Program not found' });
    }

    res.json({ program: result.rows[0] });
  } catch (error) {
    console.error('Error updating program:', error);
    res.status(500).json({ error: 'Failed to update program' });
  }
});

// Delete program (admin)
router.delete('/:id', authenticateToken, requireStaff, async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM programs WHERE id = $1 RETURNING id',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Program not found' });
    }

    res.json({ message: 'Program deleted successfully' });
  } catch (error) {
    console.error('Error deleting program:', error);
    res.status(500).json({ error: 'Failed to delete program' });
  }
});

module.exports = router;
