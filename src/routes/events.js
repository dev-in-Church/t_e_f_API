const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { authenticateToken, requireStaff } = require('../middleware/auth');

const router = express.Router();

// Get all events (public)
router.get('/', async (req, res) => {
  const { upcoming = 'true', limit = 10 } = req.query;

  try {
    let queryText = `
      SELECT id, title, slug, description, event_date, start_time, end_time,
             location, image_url, event_type, expected_attendees, is_featured
      FROM events 
      WHERE is_active = true
    `;

    if (upcoming === 'true') {
      queryText += ` AND event_date >= CURRENT_DATE`;
    } else {
      queryText += ` AND event_date < CURRENT_DATE`;
    }

    queryText += ` ORDER BY event_date ${upcoming === 'true' ? 'ASC' : 'DESC'} LIMIT $1`;

    const result = await query(queryText, [parseInt(limit)]);
    res.json({ events: result.rows });
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// Get single event (public)
router.get('/:slug', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM events WHERE slug = $1 AND is_active = true`,
      [req.params.slug]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json({ event: result.rows[0] });
  } catch (error) {
    console.error('Error fetching event:', error);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
});

// Register for event (public)
router.post('/:id/register', [
  body('name').trim().notEmpty(),
  body('email').isEmail().normalizeEmail(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { name, email, phone, notes } = req.body;

  try {
    // Check if already registered
    const existing = await query(
      'SELECT id FROM event_registrations WHERE event_id = $1 AND email = $2',
      [req.params.id, email]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Already registered for this event' });
    }

    const result = await query(
      `INSERT INTO event_registrations (event_id, name, email, phone, notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.id, name, email, phone, notes]
    );

    res.status(201).json({
      message: 'Registration successful',
      registration: result.rows[0],
    });
  } catch (error) {
    console.error('Error registering for event:', error);
    res.status(500).json({ error: 'Failed to register' });
  }
});

// Create event (admin)
router.post('/', authenticateToken, requireStaff, [
  body('title').trim().notEmpty(),
  body('slug').trim().notEmpty(),
  body('event_date').isDate(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const {
    title, slug, description, event_date, start_time, end_time,
    location, image_url, event_type, expected_attendees, is_featured,
  } = req.body;

  try {
    const result = await query(
      `INSERT INTO events 
       (title, slug, description, event_date, start_time, end_time, 
        location, image_url, event_type, expected_attendees, is_featured)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [title, slug, description, event_date, start_time, end_time,
       location, image_url, event_type, expected_attendees, is_featured || false]
    );

    res.status(201).json({ event: result.rows[0] });
  } catch (error) {
    console.error('Error creating event:', error);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// Update event (admin)
router.put('/:id', authenticateToken, requireStaff, async (req, res) => {
  const {
    title, slug, description, event_date, start_time, end_time,
    location, image_url, event_type, expected_attendees, is_featured, is_active,
  } = req.body;

  try {
    const result = await query(
      `UPDATE events SET
       title = COALESCE($1, title),
       slug = COALESCE($2, slug),
       description = COALESCE($3, description),
       event_date = COALESCE($4, event_date),
       start_time = COALESCE($5, start_time),
       end_time = COALESCE($6, end_time),
       location = COALESCE($7, location),
       image_url = COALESCE($8, image_url),
       event_type = COALESCE($9, event_type),
       expected_attendees = COALESCE($10, expected_attendees),
       is_featured = COALESCE($11, is_featured),
       is_active = COALESCE($12, is_active),
       updated_at = NOW()
       WHERE id = $13 RETURNING *`,
      [title, slug, description, event_date, start_time, end_time,
       location, image_url, event_type, expected_attendees, is_featured, is_active, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json({ event: result.rows[0] });
  } catch (error) {
    console.error('Error updating event:', error);
    res.status(500).json({ error: 'Failed to update event' });
  }
});

// Delete event (admin)
router.delete('/:id', authenticateToken, requireStaff, async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM events WHERE id = $1 RETURNING id',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    console.error('Error deleting event:', error);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

// Get event registrations (admin)
router.get('/:id/registrations', authenticateToken, requireStaff, async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM event_registrations WHERE event_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );

    res.json({ registrations: result.rows });
  } catch (error) {
    console.error('Error fetching registrations:', error);
    res.status(500).json({ error: 'Failed to fetch registrations' });
  }
});

module.exports = router;
