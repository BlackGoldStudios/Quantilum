import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { applyLedgerEntry } from "../services/walletService.js";

const router = Router();

router.post("/classes", requireAuth, requireRole("teacher"), async (req, res) => {
  const { title, description, meetingLink, scheduledAt } = req.body;
  if (!title) return res.status(400).json({ error: "title is required" });
  const result = await pool.query(
    `INSERT INTO classes (teacher_id, title, description, meeting_link, scheduled_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.user.id, title, description || null, meetingLink || null, scheduledAt || null]
  );
  res.status(201).json(result.rows[0]);
});

router.get("/classes", requireAuth, requireRole("teacher"), async (req, res) => {
  const result = await pool.query("SELECT * FROM classes WHERE teacher_id = $1 ORDER BY scheduled_at", [req.user.id]);
  res.json(result.rows);
});

router.post("/classes/:id/enroll", requireAuth, requireRole("student"), async (req, res) => {
  const result = await pool.query(
    `INSERT INTO class_enrollments (class_id, student_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING *`,
    [req.params.id, req.user.id]
  );
  res.status(201).json(result.rows[0] || { ok: true, alreadyEnrolled: true });
});

// Release tutor-trial payout once the 7-day window has ended
router.post("/tutor-trials/:id/release-payout", requireAuth, requireRole("teacher"), async (req, res) => {
  const trial = await pool.query(
    "SELECT * FROM tutor_trials WHERE id = $1 AND teacher_id = $2",
    [req.params.id, req.user.id]
  );
  if (!trial.rows.length) return res.status(404).json({ error: "Trial not found" });
  const t = trial.rows[0];

  if (t.payout_released) return res.status(400).json({ error: "Payout already released" });
  if (new Date(t.ends_at) > new Date()) return res.status(400).json({ error: "Trial period has not ended yet" });

  const wallet = await applyLedgerEntry({
    userId: req.user.id,
    type: "tutor_trial_payout",
    amountCents: t.payout_cents,
    referenceId: t.id,
    referenceTable: "tutor_trials",
    memo: "Tutor trial completion payout"
  });

  await pool.query("UPDATE tutor_trials SET payout_released = true WHERE id = $1", [t.id]);

  res.json({ ok: true, newBalanceCents: wallet.balance_cents });
});

export default router;
