/**
 * Create or reset an admin user with a correctly hashed password.
 *
 * Usage:
 *   node src/scripts/create-admin.js <email> <password> [name]
 *
 * Examples:
 *   node src/scripts/create-admin.js admin@teamemmanuel.org "MyStrongPass123"
 *   node src/scripts/create-admin.js admin@teamemmanuel.org "MyStrongPass123" "Admin User"
 *
 * If the email already exists, its password, role (admin) and status (active)
 * are updated. Otherwise a new admin user is created.
 */
require("dotenv").config();
const bcrypt = require("bcrypt");
const { query, pool } = require("../config/database");

async function main() {
  const [, , emailArg, passwordArg, nameArg] = process.argv;

  const email = emailArg;
  const password = passwordArg;
  const name = nameArg || "Admin User";

  if (!email || !password) {
    console.error(
      "Usage: node src/scripts/create-admin.js <email> <password> [name]",
    );
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  try {
    const hash = await bcrypt.hash(password, 12);

    const result = await query(
      `INSERT INTO users (email, password_hash, name, role, status)
       VALUES ($1, $2, $3, 'admin', 'active')
       ON CONFLICT (email)
       DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         role = 'admin',
         status = 'active',
         updated_at = NOW()
       RETURNING id, email, name, role, status`,
      [email, hash, name],
    );

    const user = result.rows[0];
    console.log("Admin user ready:");
    console.log(`  email:  ${user.email}`);
    console.log(`  name:   ${user.name}`);
    console.log(`  role:   ${user.role}`);
    console.log(`  status: ${user.status}`);
    console.log(
      "\nYou can now log in with this email and the password you provided.",
    );
  } catch (error) {
    console.error("Failed to create admin user:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
