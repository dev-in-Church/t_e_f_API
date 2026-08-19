const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { authenticateToken, requireStaff } = require('../middleware/auth');
const { sendContactNotification, sendContactReply } = require('../config/email');

const router = express.Router();

// Submit contact form (public)
router.post('/', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('subject').trim().notEmpty().withMessage('Subject is required'),
  body('message').trim().isLength({ min: 10 }).withMessage('Message must be at least 10 characters'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { name, email, phone, subject, message } = req.body;

  try {
    const result = await query(
      `INSERT INTO contact_messages (name, email, phone, subject, message)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, email, phone, subject, message]
    );

    // Send an email notification to the foundation inbox via Resend.
    // We don't fail the request if the email provider errors - the message
    // is already stored and visible in the admin dashboard.
    try {
      await sendContactNotification({ name, email, phone, subject, message });
    } catch (emailError) {
      console.error('Error sending contact notification email:', emailError);
    }

    res.status(201).json({
      message: 'Message sent successfully. We will get back to you soon.',
      contact: {
        id: result.rows[0].id,
        created_at: result.rows[0].created_at,
      },
    });
  } catch (error) {
    console.error('Error submitting contact form:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Get all contact messages (admin)
router.get('/', authenticateToken, requireStaff, async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  try {
    let queryText = 'SELECT * FROM contact_messages WHERE 1=1';
    const queryParams = [];
    let paramCount = 0;

    if (status && status !== 'all') {
      paramCount++;
      queryText += ` AND status = $${paramCount}`;
      queryParams.push(status);
    }

    // Get total count
    const countResult = await query(
      queryText.replace('SELECT *', 'SELECT COUNT(*)'),
      queryParams
    );

    queryText += ` ORDER BY created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    queryParams.push(parseInt(limit), parseInt(offset));

    const result = await query(queryText, queryParams);

    res.json({
      contacts: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(countResult.rows[0].count / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Get single message (admin) - also marks unread messages as read
router.get('/:id', authenticateToken, requireStaff, async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM contact_messages WHERE id = $1',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Mark as read if it is currently unread
    if (result.rows[0].status === 'unread') {
      const updated = await query(
        `UPDATE contact_messages SET status = 'read', updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [req.params.id]
      );
      return res.json({ contact: updated.rows[0] });
    }

    res.json({ contact: result.rows[0] });
  } catch (error) {
    console.error('Error fetching message:', error);
    res.status(500).json({ error: 'Failed to fetch message' });
  }
});

// Update message status (admin)
router.patch('/:id/status', authenticateToken, requireStaff, [
  body('status').isIn(['unread', 'read', 'replied', 'archived']),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const result = await query(
      `UPDATE contact_messages 
       SET status = $1, updated_at = NOW() 
       WHERE id = $2 RETURNING *`,
      [req.body.status, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    res.json({ contact: result.rows[0] });
  } catch (error) {
    console.error('Error updating message:', error);
    res.status(500).json({ error: 'Failed to update message' });
  }
});

// Reply to message (admin) - stores the reply and emails it to the sender
router.post('/:id/reply', authenticateToken, requireStaff, [
  body('reply').trim().notEmpty().withMessage('Reply content is required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    // Fetch the original message so we can email the sender
    const existing = await query(
      'SELECT * FROM contact_messages WHERE id = $1',
      [req.params.id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const original = existing.rows[0];

    // Send the reply email to the person who contacted us
    try {
      const emailResult = await sendContactReply({
        to: original.email,
        name: original.name,
        originalMessage: original.message,
        replyContent: req.body.reply,
      });

      if (emailResult && emailResult.error) {
        console.error('Resend reply error:', emailResult.error);
        return res.status(502).json({ error: 'Failed to send reply email. Please try again.' });
      }
    } catch (emailError) {
      console.error('Error sending reply email:', emailError);
      return res.status(502).json({ error: 'Failed to send reply email. Please try again.' });
    }

    // Persist the reply
    const result = await query(
      `UPDATE contact_messages 
       SET reply_content = $1, replied_by = $2, replied_at = NOW(), status = 'replied', updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [req.body.reply, req.user.id, req.params.id]
    );

    res.json({
      message: 'Reply sent successfully',
      contact: result.rows[0],
    });
  } catch (error) {
    console.error('Error replying to message:', error);
    res.status(500).json({ error: 'Failed to send reply' });
  }
});

// Delete message (admin)
router.delete('/:id', authenticateToken, requireStaff, async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM contact_messages WHERE id = $1 RETURNING id',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    res.json({ message: 'Message deleted successfully' });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

module.exports = router;
