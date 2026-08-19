const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const { query } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

// Register new user
router.post(
  "/register",
  [
    body("email").isEmail().normalizeEmail(),
    body("password")
      .isLength({ min: 8 })
      .withMessage("Password must be at least 8 characters"),
    body("name").trim().notEmpty().withMessage("Name is required"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, name } = req.body;

    try {
      // Check if user exists
      const existingUser = await query(
        "SELECT id FROM users WHERE email = $1",
        [email],
      );
      if (existingUser.rows.length > 0) {
        return res.status(400).json({ error: "Email already registered" });
      }

      // Hash password
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // Create user
      const result = await query(
        `INSERT INTO users (email, password_hash, name, role) 
       VALUES ($1, $2, $3, 'viewer') 
       RETURNING id, email, name, role, created_at`,
        [email, hashedPassword, name],
      );

      const user = result.rows[0];

      // Generate JWT
      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || "7d",
      });

      res.status(201).json({
        message: "Registration successful",
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        token,
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ error: "Registration failed" });
    }
  },
);

// Login
router.post(
  "/login",
  [body("email").isEmail().normalizeEmail(), body("password").notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    try {
      // Get user
      const result = await query(
        "SELECT id, email, password_hash, name, role, status FROM users WHERE email = $1",
        [email],
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const user = result.rows[0];

      if (user.status !== "active") {
        return res.status(401).json({ error: "Account is deactivated" });
      }

      // Verify password
      const validPassword = await bcrypt.compare(password, user.password_hash);
      if (!validPassword) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      // Update last login
      await query("UPDATE users SET last_login = NOW() WHERE id = $1", [
        user.id,
      ]);

      // Generate JWT
      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || "7d",
      });

      res.json({
        message: "Login successful",
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        token,
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Login failed" });
    }
  },
);

// Get current user
router.get("/me", authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

// Change password
router.put(
  "/change-password",
  authenticateToken,
  [
    body("currentPassword").notEmpty(),
    body("newPassword").isLength({ min: 8 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { currentPassword, newPassword } = req.body;

    try {
      // Get user with password
      const result = await query(
        "SELECT password_hash FROM users WHERE id = $1",
        [req.user.id],
      );

      // Verify current password
      const validPassword = await bcrypt.compare(
        currentPassword,
        result.rows[0].password_hash,
      );
      if (!validPassword) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 12);

      // Update password
      await query(
        "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2",
        [hashedPassword, req.user.id],
      );

      res.json({ message: "Password updated successfully" });
    } catch (error) {
      console.error("Password change error:", error);
      res.status(500).json({ error: "Failed to change password" });
    }
  },
);

module.exports = router;
