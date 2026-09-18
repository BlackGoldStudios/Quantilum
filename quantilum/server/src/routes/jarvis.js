import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { chatWithJarvis, getPreferences, bumpPreference } from "../services/jarvisService.js";

const router = Router();

router.post("/chat", requireAuth, requireRole("student"), async (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "message is required" });
  }
  try {
    const reply = await chatWithJarvis(req.user.id, message);
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Jarvis is unavailable right now", detail: err.message });
  }
});

router.get("/preferences", requireAuth, requireRole("student"), async (req, res) => {
  const prefs = await getPreferences(req.user.id);
  res.json(prefs);
});

router.post("/preferences/bump", requireAuth, requireRole("student"), async (req, res) => {
  const { subject, delta } = req.body;
  if (!subject) return res.status(400).json({ error: "subject is required" });
  const updated = await bumpPreference(req.user.id, subject, delta);
  res.json(updated);
});

export default router;
