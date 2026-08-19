const { Pool } = require("pg");

/**
 * Supabase (and most managed Postgres providers) REQUIRE SSL on every
 * connection, in development and production alike. The previous config
 * disabled SSL in development, which would fail the TLS handshake even if
 * the network path were open.
 *
 * You can override this behaviour with DB_SSL=false for a local Postgres
 * instance that has no TLS configured.
 */
const useSsl = process.env.DB_SSL !== "false";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  // Fail fast instead of hanging ~20s when the host is unreachable.
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 10,
  // Prefer IPv4 first — many local networks / ISPs cannot route the
  // IPv6 (NAT64) addresses Supabase advertises, which shows up as ETIMEDOUT.
  keepAlive: true,
});

pool.on("connect", () => {
  console.log("Connected to PostgreSQL database");
});

// Do NOT crash the whole server on a transient idle-client error.
// Log it and let the pool recover on the next query.
pool.on("error", (err) => {
  console.error("Unexpected error on idle PostgreSQL client:", err.message);
});

// Helper function to run queries
const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log("Executed query", {
      text: text.substring(0, 50),
      duration,
      rows: res.rowCount,
    });
    return res;
  } catch (err) {
    if (
      err.code === "ETIMEDOUT" ||
      err.code === "ENOTFOUND" ||
      err.code === "ECONNREFUSED"
    ) {
      console.error(
        "\n[DB CONNECTION FAILED] Could not reach the database host.\n" +
          "  code: " +
          err.code +
          "\n" +
          "  Check that:\n" +
          "    1. DATABASE_URL is set correctly in your .env file.\n" +
          "    2. Your network/firewall allows outbound connections to the DB port (5432/6543).\n" +
          "    3. For Supabase on an IPv4-only network, use the Session Pooler host (aws-0-<region>.pooler.supabase.com:5432).\n",
      );
    }
    throw err;
  }
};

// Get a client from the pool for transactions
const getClient = async () => {
  const client = await pool.connect();
  return client;
};

module.exports = {
  pool,
  query,
  getClient,
};
