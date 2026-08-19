/**
 * Database connectivity diagnostic.
 *
 * Run with:  node src/scripts/test-db.js
 *
 * This isolates the connection from the rest of the app so you can tell
 * whether "Connection terminated due to connection timeout" is a network
 * problem (cannot reach the host) or a credentials/SSL problem.
 */
require("dotenv").config();

const net = require("net");
const { URL } = require("url");
const { Client } = require("pg");

const connectionString = process.env.DATABASE_URL;

async function main() {
  if (!connectionString) {
    console.error("[test-db] DATABASE_URL is not set. Add it to backend/.env");
    process.exit(1);
  }

  let host;
  let port;
  try {
    const parsed = new URL(connectionString);
    host = parsed.hostname;
    port = parsed.port || "5432";
    console.log(`[test-db] Target host: ${host}`);
    console.log(`[test-db] Target port: ${port}`);
  } catch {
    console.error(
      "[test-db] DATABASE_URL is not a valid URL. Check for unencoded special characters in the password (@ must be %40).",
    );
    process.exit(1);
  }

  // Step 1: raw TCP reachability. This is what times out in a network problem.
  console.log("\n[test-db] Step 1: testing raw TCP connection (5s timeout)...");
  const reachable = await new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(5000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
    socket.connect(Number(port), host);
  });

  if (!reachable) {
    console.error(
      `\n[test-db] FAILED: cannot open a TCP socket to ${host}:${port}.`,
    );
    console.error(
      "[test-db] This is a NETWORK problem, not credentials. Fixes:",
    );
    console.error(
      "  1. If Supabase on port 6543, switch to the Session Pooler string on port 5432.",
    );
    console.error(
      "  2. Try a different network (e.g. phone hotspot) to rule out a firewall/VPN.",
    );
    console.error(
      "  3. Confirm the host name is spelled correctly and the project is not paused.",
    );
    process.exit(1);
  }
  console.log(
    `[test-db] OK: TCP socket to ${host}:${port} opened successfully.`,
  );

  // Step 2: full Postgres handshake (SSL + auth).
  console.log(
    "\n[test-db] Step 2: testing Postgres auth + SSL (10s timeout)...",
  );
  const useSsl = process.env.DB_SSL !== "false";
  const client = new Client({
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10000,
  });

  try {
    await client.connect();
    const res = await client.query(
      "SELECT NOW() as now, current_database() as db",
    );
    console.log(
      `[test-db] OK: connected to database "${res.rows[0].db}" at ${res.rows[0].now}`,
    );
    console.log(
      "\n[test-db] SUCCESS: your DATABASE_URL works. Logins should now succeed.",
    );
  } catch (err) {
    console.error(
      "\n[test-db] TCP worked but the Postgres handshake FAILED:",
      err.message,
    );
    console.error(
      "[test-db] This usually means wrong password/user/db name, or an SSL setting mismatch (toggle DB_SSL).",
    );
    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
}

main();
