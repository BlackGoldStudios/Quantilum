import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

router.put("/portfolio", requireAuth, requireRole("worker"), async (req, res) => {
  const { headline, bio, skills, portfolioLinks } = req.body;
  const result = await pool.query(
    `INSERT INTO portfolios (worker_id, headline, bio, skills, portfolio_links)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (worker_id)
     DO UPDATE SET headline = $2, bio = $3, skills = $4, portfolio_links = $5
     RETURNING *`,
    [req.user.id, headline || null, bio || null, skills || [], portfolioLinks || []]
  );
  res.json(result.rows[0]);
});

router.get("/portfolio/:workerId", async (req, res) => {
  const result = await pool.query("SELECT * FROM portfolios WHERE worker_id = $1", [req.params.workerId]);
  if (!result.rows.length) return res.status(404).json({ error: "Portfolio not found" });
  res.json(result.rows[0]);
});

router.post("/projects/:projectId/apply", requireAuth, requireRole("worker"), async (req, res) => {
  const { message } = req.body;
  const result = await pool.query(
    `INSERT INTO project_applications (project_id, worker_id, message)
     VALUES ($1, $2, $3)
     ON CONFLICT (project_id, worker_id) DO UPDATE SET message = $3
     RETURNING *`,
    [req.params.projectId, req.user.id, message || null]
  );
  res.status(201).json(result.rows[0]);
});

// --- Direct messaging (worker <-> business) ---
router.post("/messages", requireAuth, async (req, res) => {
  const { recipientId, body } = req.body;
  if (!recipientId || !body) return res.status(400).json({ error: "recipientId and body are required" });
  const result = await pool.query(
    `INSERT INTO messages (sender_id, recipient_id, body) VALUES ($1, $2, $3) RETURNING *`,
    [req.user.id, recipientId, body]
  );
  res.status(201).json(result.rows[0]);
});

router.get("/messages/thread/:otherUserId", requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM messages
     WHERE (sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1)
     ORDER BY created_at ASC`,
    [req.user.id, req.params.otherUserId]
  );
  res.json(result.rows);
});

export default router;
