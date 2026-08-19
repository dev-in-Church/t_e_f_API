const express = require("express");
const bcrypt = require("bcrypt");
const { body, validationResult } = require("express-validator");
const { query } = require("../config/database");
const {
  authenticateToken,
  requireAdmin,
  requireStaff,
} = require("../middleware/auth");

const router = express.Router();

// Get dashboard stats
router.get("/dashboard", authenticateToken, requireStaff, async (req, res) => {
  try {
    // Donations stats
    const donationStats = await query(`
      SELECT 
        COUNT(*) as total_donations,
        SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END) as total_raised,
        SUM(CASE WHEN status = 'completed' AND created_at >= DATE_TRUNC('month', CURRENT_DATE) THEN amount ELSE 0 END) as this_month,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_donations
      FROM donations
    `);

    // Recent donations
    const recentDonations = await query(`
      SELECT d.*, p.name as program_name
      FROM donations d
      LEFT JOIN programs p ON d.program_id = p.id
      ORDER BY d.created_at DESC
      LIMIT 5
    `);

    // Contact messages count
    const messagesCount = await query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'new' THEN 1 END) as unread
      FROM contact_messages
    `);

    // Event registrations
    const eventStats = await query(`
      SELECT 
        COUNT(DISTINCT e.id) as upcoming_events,
        COUNT(r.id) as total_registrations
      FROM events e
      LEFT JOIN event_registrations r ON e.id = r.event_id
      WHERE e.event_date >= CURRENT_DATE
    `);

    // Gallery stats
    const galleryStats = await query(`
      SELECT COUNT(*) as total_images
      FROM gallery_images WHERE is_active = true
    `);

    // Newsletter subscribers
    const subscriberCount = await query(`
      SELECT COUNT(*) as subscribers
      FROM newsletter_subscribers WHERE is_active = true
    `);

    res.json({
      donations: {
        ...donationStats.rows[0],
        recent: recentDonations.rows,
      },
      messages: messagesCount.rows[0],
      events: eventStats.rows[0],
      gallery: galleryStats.rows[0],
      newsletter: subscriberCount.rows[0],
    });
  } catch (error) {
    console.error("Error fetching dashboard:", error);
    res.status(500).json({ error: "Failed to fetch dashboard data" });
  }
});

// Get all users (admin only)
router.get("/users", authenticateToken, requireAdmin, async (req, res) => {
  const { page = 1, limit = 20, role } = req.query;
  const offset = (page - 1) * limit;

  try {
    let queryText = `
      SELECT id, email, name, role, status, last_login, created_at
      FROM users WHERE 1=1
    `;
    const queryParams = [];
    let paramCount = 0;

    if (role) {
      paramCount++;
      queryText += ` AND role = $${paramCount}`;
      queryParams.push(role);
    }

    // Count
    const countResult = await query(
      queryText.replace(/SELECT .+ FROM/, "SELECT COUNT(*) FROM"),
      queryParams,
    );

    queryText += ` ORDER BY created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    queryParams.push(parseInt(limit), parseInt(offset));

    const result = await query(queryText, queryParams);

    res.json({
      users: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(countResult.rows[0].count / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// Create user (admin only)
router.post(
  "/users",
  authenticateToken,
  requireAdmin,
  [
    body("email").isEmail().normalizeEmail(),
    body("password").isLength({ min: 8 }),
    body("name").trim().notEmpty(),
    body("role").isIn(["admin", "editor", "viewer"]),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, name, role } = req.body;

    try {
      const hashedPassword = await bcrypt.hash(password, 12);

      const result = await query(
        `INSERT INTO users (email, password_hash, name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, role, status, created_at`,
        [email, hashedPassword, name, role],
      );

      res.status(201).json({ user: result.rows[0] });
    } catch (error) {
      if (error.code === "23505") {
        return res.status(400).json({ error: "Email already exists" });
      }
      console.error("Error creating user:", error);
      res.status(500).json({ error: "Failed to create user" });
    }
  },
);

// Update user (admin only)
router.put("/users/:id", authenticateToken, requireAdmin, async (req, res) => {
  const { name, role, status } = req.body;

  try {
    const result = await query(
      `UPDATE users SET
       name = COALESCE($1, name),
       role = COALESCE($2, role),
       status = COALESCE($3, status),
       updated_at = NOW()
       WHERE id = $4
       RETURNING id, email, name, role, status`,
      [name, role, status, req.params.id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ error: "Failed to update user" });
  }
});

// Reset user password (admin only)
router.post(
  "/users/:id/reset-password",
  authenticateToken,
  requireAdmin,
  [body("password").isLength({ min: 8 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const hashedPassword = await bcrypt.hash(req.body.password, 12);

      const result = await query(
        `UPDATE users SET password_hash = $1, updated_at = NOW()
       WHERE id = $2 RETURNING id`,
        [hashedPassword, req.params.id],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({ message: "Password reset successfully" });
    } catch (error) {
      console.error("Error resetting password:", error);
      res.status(500).json({ error: "Failed to reset password" });
    }
  },
);

// Delete user (admin only)
router.delete(
  "/users/:id",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      // Don't allow deleting self
      if (req.params.id === req.user.id) {
        return res
          .status(400)
          .json({ error: "Cannot delete your own account" });
      }

      const result = await query(
        "DELETE FROM users WHERE id = $1 RETURNING id",
        [req.params.id],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({ message: "User deleted successfully" });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ error: "Failed to delete user" });
    }
  },
);

// Get newsletter subscribers (admin)
router.get(
  "/subscribers",
  authenticateToken,
  requireStaff,
  async (req, res) => {
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    try {
      const countResult = await query(
        "SELECT COUNT(*) FROM newsletter_subscribers WHERE is_active = true",
      );

      const result = await query(
        `SELECT * FROM newsletter_subscribers 
       WHERE is_active = true 
       ORDER BY created_at DESC 
       LIMIT $1 OFFSET $2`,
        [parseInt(limit), parseInt(offset)],
      );

      res.json({
        subscribers: result.rows,
        pagination: {
          total: parseInt(countResult.rows[0].count),
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(countResult.rows[0].count / limit),
        },
      });
    } catch (error) {
      console.error("Error fetching subscribers:", error);
      res.status(500).json({ error: "Failed to fetch subscribers" });
    }
  },
);

// Export donations report
router.get(
  "/reports/donations",
  authenticateToken,
  requireStaff,
  async (req, res) => {
    const { start_date, end_date, status } = req.query;

    try {
      let queryText = `
      SELECT d.*, p.name as program_name
      FROM donations d
      LEFT JOIN programs p ON d.program_id = p.id
      WHERE 1=1
    `;
      const queryParams = [];
      let paramCount = 0;

      if (start_date) {
        paramCount++;
        queryText += ` AND d.created_at >= $${paramCount}`;
        queryParams.push(start_date);
      }

      if (end_date) {
        paramCount++;
        queryText += ` AND d.created_at <= $${paramCount}`;
        queryParams.push(end_date);
      }

      if (status) {
        paramCount++;
        queryText += ` AND d.status = $${paramCount}`;
        queryParams.push(status);
      }

      queryText += " ORDER BY d.created_at DESC";

      const result = await query(queryText, queryParams);

      // Calculate totals
      const totals = result.rows.reduce(
        (acc, d) => {
          if (d.status === "completed") {
            acc.total += parseFloat(d.amount);
            acc.count++;
          }
          return acc;
        },
        { total: 0, count: 0 },
      );

      res.json({
        donations: result.rows,
        summary: totals,
      });
    } catch (error) {
      console.error("Error generating report:", error);
      res.status(500).json({ error: "Failed to generate report" });
    }
  },
);

module.exports = router;
