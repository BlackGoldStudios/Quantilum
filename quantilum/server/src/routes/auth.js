import { Router } from "express";
import jwt from "jsonwebtoken";
import fetch from "node-fetch";
import { pool } from "../db/pool.js";
import { getOrCreateWallet } from "../services/walletService.js";

const router = Router();

// Step 1: redirect user to GitHub
router.get("/github", (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: process.env.GITHUB_CALLBACK_URL,
    scope: "read:user user:email",
    state: req.query.role || "student" // pass intended role through state
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

// Step 2: GitHub redirects back here with a code
router.get("/github/callback", async (req, res) => {
  const { code, state } = req.query;
  const role = ["student", "teacher", "business", "worker"].includes(state) ? state : "student";

  try {
    // Exchange code for access token
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: process.env.GITHUB_CALLBACK_URL
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return res.status(400).json({ error: "GitHub auth failed", detail: tokenData });
    }

    // Fetch GitHub profile
    const profileRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const profile = await profileRes.json();

    let email = profile.email;
    if (!email) {
      const emailsRes = await fetch("https://api.github.com/user/emails", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      const emails = await emailsRes.json();
      email = Array.isArray(emails) ? emails.find(e => e.primary)?.email : null;
    }

    // Upsert user
    const existing = await pool.query("SELECT * FROM users WHERE github_id = $1", [profile.id]);
    let user;
    if (existing.rows.length) {
      user = existing.rows[0];
    } else {
      const inserted = await pool.query(
        `INSERT INTO users (github_id, github_username, email, display_name, avatar_url, role)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [profile.id, profile.login, email, profile.name || profile.login, profile.avatar_url, role]
      );
      user = inserted.rows[0];
      await getOrCreateWallet(user.id);
    }

    const jwtToken = jwt.sign(
      { id: user.id, role: user.role, verification: user.verification },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.cookie("token", jwtToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000
    });

    res.redirect(`${process.env.CLIENT_URL}/dashboard`);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Auth callback failed" });
  }
});

router.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ ok: true });
});

router.get("/me", async (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const result = await pool.query("SELECT id, display_name, email, role, verification, avatar_url FROM users WHERE id = $1", [payload.id]);
    res.json(result.rows[0]);
  } catch {
    res.status(401).json({ error: "Invalid session" });
  }
});

export default router;
