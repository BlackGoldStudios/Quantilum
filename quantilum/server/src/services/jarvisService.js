import fetch from "node-fetch";
import { pool } from "../db/pool.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Jarvis learns a lightweight "subject weight" profile per student
 * (e.g. { math: 0.8, biology: 0.3 }) from what they ask about and
 * which quests they complete, then uses it to bias recommendations.
 */

export async function getPreferences(studentId) {
  const res = await pool.query(
    "SELECT subject_weights_json FROM jarvis_preferences WHERE student_id = $1",
    [studentId]
  );
  return res.rows[0]?.subject_weights_json || {};
}

export async function bumpPreference(studentId, subject, delta = 0.1) {
  const current = await getPreferences(studentId);
  const updated = { ...current, [subject]: Math.min(1, (current[subject] || 0) + delta) };

  await pool.query(
    `INSERT INTO jarvis_preferences (student_id, subject_weights_json, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (student_id)
     DO UPDATE SET subject_weights_json = $2, updated_at = now()`,
    [studentId, updated]
  );
  return updated;
}

export async function chatWithJarvis(studentId, userMessage) {
  const prefs = await getPreferences(studentId);

  const history = await pool.query(
    `SELECT role, content FROM jarvis_messages
     WHERE student_id = $1 ORDER BY created_at DESC LIMIT 10`,
    [studentId]
  );
  const recentMessages = history.rows.reverse();

  const systemPrompt = `You are Jarvis, an adaptive study assistant on the Quantilum platform.
You help students with notes, quiz prep, and daily quests. Keep answers concise and encouraging.
Known interest weights for this student (0-1 scale, higher = more interested): ${JSON.stringify(prefs)}.
Use this to tailor examples and suggested quests toward their stronger interests when relevant.`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...recentMessages.map(m => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage }
  ];

  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      messages,
      temperature: 0.6,
      max_tokens: 600
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const reply = data.choices?.[0]?.message?.content || "Sorry, I couldn't generate a response.";

  await pool.query(
    `INSERT INTO jarvis_messages (student_id, role, content) VALUES ($1, 'user', $2), ($1, 'assistant', $3)`,
    [studentId, userMessage, reply]
  );

  return reply;
}
