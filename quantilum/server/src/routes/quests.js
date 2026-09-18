import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { applyLedgerEntry } from "../services/walletService.js";
import { bumpPreference } from "../services/jarvisService.js";

const router = Router();

// List active quests (platform-wide + assigned by teachers the student follows)
router.get("/", requireAuth, requireRole("student"), async (req, res) => {
  const result = await pool.query(
    `SELECT q.*, qc.status AS my_status
     FROM quests q
     LEFT JOIN quest_completions qc ON qc.quest_id = q.id AND qc.student_id = $1
     ORDER BY q.created_at DESC`,
    [req.user.id]
  );
  res.json(result.rows);
});

// Teacher assigns a custom quest
router.post("/", requireAuth, requireRole("teacher"), async (req, res) => {
  const { title, description, rewardCents = 100, isDaily = true } = req.body;
  if (!title) return res.status(400).json({ error: "title is required" });

  const result = await pool.query(
    `INSERT INTO quests (assigned_by, title, description, reward_cents, is_daily)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.user.id, title, description || null, rewardCents, isDaily]
  );
  res.status(201).json(result.rows[0]);
});

// Student marks a quest complete (submits for review)
router.post("/:id/complete", requireAuth, requireRole("student"), async (req, res) => {
  const questId = Number(req.params.id);
  const { proofUrl, subject } = req.body;

  const quest = await pool.query("SELECT * FROM quests WHERE id = $1", [questId]);
  if (!quest.rows.length) return res.status(404).json({ error: "Quest not found" });

  const upserted = await pool.query(
    `INSERT INTO quest_completions (quest_id, student_id, status, proof_url, completed_at)
     VALUES ($1, $2, 'submitted', $3, now())
     ON CONFLICT (quest_id, student_id)
     DO UPDATE SET status = 'submitted', proof_url = $3, completed_at = now()
     RETURNING *`,
    [questId, req.user.id, proofUrl || null]
  );

  if (subject) await bumpPreference(req.user.id, subject);

  res.json(upserted.rows[0]);
});

// Teacher (or platform, if quest has no assigned_by) approves -> pays out reward
router.post("/:id/approve/:studentId", requireAuth, requireRole("teacher"), async (req, res) => {
  const questId = Number(req.params.id);
  const studentId = Number(req.params.studentId);

  const quest = await pool.query("SELECT * FROM quests WHERE id = $1", [questId]);
  if (!quest.rows.length) return res.status(404).json({ error: "Quest not found" });
  const q = quest.rows[0];

  if (q.assigned_by && q.assigned_by !== req.user.id) {
    return res.status(403).json({ error: "Only the assigning teacher can approve this quest" });
  }

  const completion = await pool.query(
    `UPDATE quest_completions SET status = 'approved', reviewed_at = now()
     WHERE quest_id = $1 AND student_id = $2 AND status = 'submitted'
     RETURNING *`,
    [questId, studentId]
  );
  if (!completion.rows.length) {
    return res.status(400).json({ error: "No pending submission found for this student" });
  }

  const wallet = await applyLedgerEntry({
    userId: studentId,
    type: "quest_reward",
    amountCents: q.reward_cents,
    referenceId: questId,
    referenceTable: "quests",
    memo: `Reward for: ${q.title}`
  });

  res.json({ completion: completion.rows[0], newBalanceCents: wallet.balance_cents });
});

export default router;
