const express = require('express');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');
const { authenticateToken, requireStaff } = require('../middleware/auth');

const router = express.Router();

// Create donation (public)
router.post('/', [
  body('amount').isFloat({ min: 100 }).withMessage('Minimum donation is KES 100'),
  body('donor_name').trim().notEmpty(),
  body('donor_email').isEmail().normalizeEmail(),
  body('payment_method').isIn(['mpesa', 'card', 'bank_transfer']),
  body('program_id').optional().isUUID(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const {
    amount,
    donor_name,
    donor_email,
    donor_phone,
    payment_method,
    program_id,
    is_recurring,
    is_anonymous,
    message,
  } = req.body;

  try {
    const transactionRef = `DON-${uuidv4().slice(0, 8).toUpperCase()}`;

    const result = await query(
      `INSERT INTO donations 
       (transaction_ref, amount, donor_name, donor_email, donor_phone, 
        payment_method, program_id, is_recurring, is_anonymous, message, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
       RETURNING *`,
      [
        transactionRef,
        amount,
        donor_name,
        donor_email,
        donor_phone,
        payment_method,
        program_id || null,
        is_recurring || false,
        is_anonymous || false,
        message,
      ]
    );

    res.status(201).json({
      message: 'Donation initiated',
      donation: result.rows[0],
    });
  } catch (error) {
    console.error('Donation creation error:', error);
    res.status(500).json({ error: 'Failed to create donation' });
  }
});

// Get donation by transaction ref (public - for status check)
router.get('/status/:transactionRef', async (req, res) => {
  try {
    const result = await query(
      `SELECT transaction_ref, amount, status, payment_method, created_at 
       FROM donations WHERE transaction_ref = $1`,
      [req.params.transactionRef]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Donation not found' });
    }

    res.json({ donation: result.rows[0] });
  } catch (error) {
    console.error('Error fetching donation:', error);
    res.status(500).json({ error: 'Failed to fetch donation' });
  }
});

// Get all donations (admin only)
router.get('/', authenticateToken, requireStaff, async (req, res) => {
  const { page = 1, limit = 20, status, payment_method, program_id } = req.query;
  const offset = (page - 1) * limit;

  try {
    let queryText = `
      SELECT d.*, p.name as program_name
      FROM donations d
      LEFT JOIN programs p ON d.program_id = p.id
      WHERE 1=1
    `;
    const queryParams = [];
    let paramCount = 0;

    if (status) {
      paramCount++;
      queryText += ` AND d.status = $${paramCount}`;
      queryParams.push(status);
    }

    if (payment_method) {
      paramCount++;
      queryText += ` AND d.payment_method = $${paramCount}`;
      queryParams.push(payment_method);
    }

    if (program_id) {
      paramCount++;
      queryText += ` AND d.program_id = $${paramCount}`;
      queryParams.push(program_id);
    }

    // Get total count
    const countResult = await query(
      queryText.replace('SELECT d.*, p.name as program_name', 'SELECT COUNT(*)'),
      queryParams
    );

    // Get paginated results
    queryText += ` ORDER BY d.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    queryParams.push(limit, offset);

    const result = await query(queryText, queryParams);

    res.json({
      donations: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(countResult.rows[0].count / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching donations:', error);
    res.status(500).json({ error: 'Failed to fetch donations' });
  }
});

// Get donation stats (admin)
router.get('/stats', authenticateToken, requireStaff, async (req, res) => {
  try {
    const stats = await query(`
      SELECT 
        COUNT(*) as total_donations,
        SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END) as total_raised,
        SUM(CASE WHEN status = 'completed' AND created_at >= DATE_TRUNC('month', CURRENT_DATE) THEN amount ELSE 0 END) as this_month,
        COUNT(DISTINCT donor_email) as unique_donors,
        AVG(CASE WHEN status = 'completed' THEN amount ELSE NULL END) as average_donation
      FROM donations
    `);

    const byProgram = await query(`
      SELECT p.name, SUM(d.amount) as total
      FROM donations d
      JOIN programs p ON d.program_id = p.id
      WHERE d.status = 'completed'
      GROUP BY p.id, p.name
      ORDER BY total DESC
      LIMIT 5
    `);

    const byMonth = await query(`
      SELECT 
        TO_CHAR(created_at, 'YYYY-MM') as month,
        SUM(amount) as total
      FROM donations
      WHERE status = 'completed' AND created_at >= NOW() - INTERVAL '12 months'
      GROUP BY TO_CHAR(created_at, 'YYYY-MM')
      ORDER BY month
    `);

    res.json({
      overview: stats.rows[0],
      byProgram: byProgram.rows,
      byMonth: byMonth.rows,
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Update donation status (admin)
router.patch('/:id/status', authenticateToken, requireStaff, [
  body('status').isIn(['pending', 'completed', 'failed', 'refunded']),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const result = await query(
      `UPDATE donations SET status = $1, updated_at = NOW() 
       WHERE id = $2 RETURNING *`,
      [req.body.status, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Donation not found' });
    }

    res.json({ donation: result.rows[0] });
  } catch (error) {
    console.error('Error updating donation:', error);
    res.status(500).json({ error: 'Failed to update donation' });
  }
});

module.exports = router;
