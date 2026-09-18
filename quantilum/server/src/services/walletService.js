import { pool } from "../db/pool.js";

/**
 * All money is stored as integer cents/paise to avoid float errors.
 * Every balance change MUST go through this service so the ledger
 * stays the single source of truth (wallets.balance_cents is a
 * cached sum, recomputed transactionally on each write).
 */

export async function getOrCreateWallet(userId) {
  const existing = await pool.query("SELECT * FROM wallets WHERE user_id = $1", [userId]);
  if (existing.rows.length) return existing.rows[0];

  const created = await pool.query(
    "INSERT INTO wallets (user_id) VALUES ($1) RETURNING *",
    [userId]
  );
  return created.rows[0];
}

/**
 * Apply a signed ledger entry (positive = credit, negative = debit)
 * inside a transaction, updating the cached wallet balance.
 */
export async function applyLedgerEntry({ userId, type, amountCents, referenceId, referenceTable, memo }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const walletRes = await client.query(
      "SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE",
      [userId]
    );
    let wallet = walletRes.rows[0];
    if (!wallet) {
      const created = await client.query(
        "INSERT INTO wallets (user_id) VALUES ($1) RETURNING *",
        [userId]
      );
      wallet = created.rows[0];
    }

    const newBalance = wallet.balance_cents + amountCents;
    if (newBalance < 0) {
      throw new Error("Insufficient wallet balance");
    }

    await client.query(
      `INSERT INTO ledger_entries (wallet_id, type, amount_cents, reference_id, reference_table, memo)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [wallet.id, type, amountCents, referenceId ?? null, referenceTable ?? null, memo ?? null]
    );

    await client.query(
      "UPDATE wallets SET balance_cents = $1 WHERE id = $2",
      [newBalance, wallet.id]
    );

    await client.query("COMMIT");
    return { ...wallet, balance_cents: newBalance };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Transfer between two users' wallets atomically (e.g. B2B project payment). */
export async function transfer({ fromUserId, toUserId, amountCents, referenceId, referenceTable, memo }) {
  await applyLedgerEntry({
    userId: fromUserId,
    type: "b2b_project_payment",
    amountCents: -amountCents,
    referenceId,
    referenceTable,
    memo
  });
  await applyLedgerEntry({
    userId: toUserId,
    type: "b2b_project_payment",
    amountCents: amountCents,
    referenceId,
    referenceTable,
    memo
  });
}

export async function getLedgerHistory(userId, limit = 50) {
  const res = await pool.query(
    `SELECT le.* FROM ledger_entries le
     JOIN wallets w ON w.id = le.wallet_id
     WHERE w.user_id = $1
     ORDER BY le.created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return res.rows;
}
