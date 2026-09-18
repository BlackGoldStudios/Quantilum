import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

// --- Notes ---
router.get("/notes", requireAuth, requireRole("student"), async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM notes WHERE student_id = $1 ORDER BY updated_at DESC",
    [req.user.id]
  );
  res.json(result.rows);
});

router.post("/notes", requireAuth, requireRole("student"), async (req, res) => {
  const { title, body, imageUrl } = req.body;
  if (!title) return res.status(400).json({ error: "title is required" });
  const result = await pool.query(
    `INSERT INTO notes (student_id, title, body, image_url) VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.user.id, title, body || null, imageUrl || null]
  );
  res.status(201).json(result.rows[0]);
});

router.put("/notes/:id", requireAuth, requireRole("student"), async (req, res) => {
  const { title, body, imageUrl } = req.body;
  const result = await pool.query(
    `UPDATE notes SET title = COALESCE($1,title), body = COALESCE($2,body),
     image_url = COALESCE($3,image_url), updated_at = now()
     WHERE id = $4 AND student_id = $5 RETURNING *`,
    [title, body, imageUrl, req.params.id, req.user.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: "Note not found" });
  res.json(result.rows[0]);
});

router.delete("/notes/:id", requireAuth, requireRole("student"), async (req, res) => {
  await pool.query("DELETE FROM notes WHERE id = $1 AND student_id = $2", [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// --- Quizzes ---
router.get("/quizzes", requireAuth, async (req, res) => {
  const result = await pool.query("SELECT id, title, created_by, created_at FROM quizzes ORDER BY created_at DESC");
  res.json(result.rows);
});

router.get("/quizzes/:id", requireAuth, async (req, res) => {
  const result = await pool.query("SELECT * FROM quizzes WHERE id = $1", [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: "Quiz not found" });
  res.json(result.rows[0]);
});

router.post("/quizzes", requireAuth, requireRole("teacher"), async (req, res) => {
  const { title, questions } = req.body;
  if (!title || !Array.isArray(questions)) {
    return res.status(400).json({ error: "title and questions[] are required" });
  }
  const result = await pool.query(
    `INSERT INTO quizzes (created_by, title, questions_json) VALUES ($1, $2, $3) RETURNING *`,
    [req.user.id, title, JSON.stringify(questions)]
  );
  res.status(201).json(result.rows[0]);
});

router.post("/quizzes/:id/attempt", requireAuth, requireRole("student"), async (req, res) => {
  const { answers } = req.body; // array of selected option indices
  const quiz = await pool.query("SELECT * FROM quizzes WHERE id = $1", [req.params.id]);
  if (!quiz.rows.length) return res.status(404).json({ error: "Quiz not found" });

  const questions = quiz.rows[0].questions_json;
  let score = 0;
  questions.forEach((q, i) => {
    if (answers[i] === q.answerIndex) score++;
  });

  const result = await pool.query(
    `INSERT INTO quiz_attempts (quiz_id, student_id, score, total) VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.params.id, req.user.id, score, questions.length]
  );
  res.status(201).json(result.rows[0]);
});

// --- Tutor trial (1-week platform-sponsored) ---
router.post("/tutor-trial", requireAuth, requireRole("student"), async (req, res) => {
  const { teacherId, payoutCents = 5000 } = req.body; // e.g. ₹50 default trial payout
  if (!teacherId) return res.status(400).json({ error: "teacherId is required" });

  const result = await pool.query(
    `INSERT INTO tutor_trials (student_id, teacher_id, ends_at, payout_cents)
     VALUES ($1, $2, now() + interval '7 days', $3) RETURNING *`,
    [req.user.id, teacherId, payoutCents]
  );
  res.status(201).json(result.rows[0]);
});

export default router;
