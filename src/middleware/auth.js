const jwt = require("jsonwebtoken");
const { query } = require("../config/database");

// Verify JWT token
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: "Access token required" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user from database
    const result = await query(
      "SELECT id, email, name, role FROM users WHERE id = $1 AND status = 'active'",
      [decoded.userId],
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "User not found or inactive" });
    }

    req.user = result.rows[0];
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired" });
    }
    return res.status(403).json({ error: "Invalid token" });
  }
};

// Check if user is admin
const requireAdmin = (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
};

// Check if user is admin or editor
const requireStaff = (req, res, next) => {
  if (!["admin", "editor"].includes(req.user.role)) {
    return res.status(403).json({ error: "Staff access required" });
  }
  next();
};

module.exports = {
  authenticateToken,
  requireAdmin,
  requireStaff,
};
