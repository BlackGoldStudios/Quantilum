import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { applyLedgerEntry } from "../services/walletService.js";

const router = Router();

// Register a business (charges the $5 fee and marks verified_badge pending -> true)
router.post("/register", requireAuth, requireRole("business"), async (req, res) => {
  const { companyName, registrationCertUrl } = req.body;
  if (!companyName) return res.status(400).json({ error: "companyName is required" });

  try {
    await applyLedgerEntry({
      userId: req.user.id,
      type: "subscription_payment",
      amountCents: -500,
      memo: "Business registration fee ($5)"
    });
  } catch (err) {
    return res.status(400).json({ error: `Payment failed: ${err.message}` });
  }

  const result = await pool.query(
    `INSERT INTO businesses (owner_id, company_name, registration_cert_url, verified_badge, registration_paid)
     VALUES ($1, $2, $3, true, true) RETURNING *`,
    [req.user.id, companyName, registrationCertUrl || null]
  );
  res.status(201).json(result.rows[0]);
});

router.get("/me", requireAuth, requireRole("business"), async (req, res) => {
  const result = await pool.query("SELECT * FROM businesses WHERE owner_id = $1", [req.user.id]);
  if (!result.rows.length) return res.status(404).json({ error: "No business registered yet" });
  res.json(result.rows[0]);
});

// --- Ads ---
router.post("/:businessId/ads", requireAuth, requireRole("business"), async (req, res) => {
  const { title, body, imageUrl } = req.body;
  const result = await pool.query(
    `INSERT INTO business_ads (business_id, title, body, image_url) VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.params.businessId, title, body || null, imageUrl || null]
  );
  res.status(201).json(result.rows[0]);
});

router.get("/ads/active", async (req, res) => {
  const result = await pool.query(
    `SELECT ba.*, b.company_name FROM business_ads ba
     JOIN businesses b ON b.id = ba.business_id
     WHERE ba.active = true ORDER BY ba.created_at DESC LIMIT 20`
  );
  res.json(result.rows);
});

// --- P&L tracking ---
router.post("/:businessId/pnl", requireAuth, requireRole("business"), async (req, res) => {
  const { label, amountCents, entryDate } = req.body;
  if (!label || amountCents === undefined) {
    return res.status(400).json({ error: "label and amountCents are required" });
  }
  const result = await pool.query(
    `INSERT INTO pnl_entries (business_id, label, amount_cents, entry_date)
     VALUES ($1, $2, $3, COALESCE($4, CURRENT_DATE)) RETURNING *`,
    [req.params.businessId, label, amountCents, entryDate || null]
  );
  res.status(201).json(result.rows[0]);
});

router.get("/:businessId/pnl", requireAuth, requireRole("business"), async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM pnl_entries WHERE business_id = $1 ORDER BY entry_date DESC",
    [req.params.businessId]
  );
  const net = result.rows.reduce((sum, r) => sum + r.amount_cents, 0);
  res.json({ entries: result.rows, netCents: net });
});

// --- Projects (posted to the global worker library) ---
router.post("/:businessId/projects", requireAuth, requireRole("business"), async (req, res) => {
  const { title, description, budgetCents } = req.body;
  if (!title) return res.status(400).json({ error: "title is required" });
  const result = await pool.query(
    `INSERT INTO projects (business_id, title, description, budget_cents) VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.params.businessId, title, description || null, budgetCents || null]
  );
  res.status(201).json(result.rows[0]);
});

router.get("/projects", async (req, res) => {
  const result = await pool.query(
    `SELECT p.*, b.company_name FROM projects p
     JOIN businesses b ON b.id = p.business_id
     WHERE p.status = 'open' ORDER BY p.created_at DESC`
  );
  res.json(result.rows);
});

router.post("/projects/:projectId/applications/:applicationId/accept", requireAuth, requireRole("business"), async (req, res) => {
  const result = await pool.query(
    `UPDATE project_applications SET status = 'accepted' WHERE id = $1 AND project_id = $2 RETURNING *`,
    [req.params.applicationId, req.params.projectId]
  );
  if (!result.rows.length) return res.status(404).json({ error: "Application not found" });
  await pool.query("UPDATE projects SET status = 'in_progress' WHERE id = $1", [req.params.projectId]);
  res.json(result.rows[0]);
});

export default router;
