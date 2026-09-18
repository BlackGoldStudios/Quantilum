import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";

import authRoutes from "./routes/auth.js";
import jarvisRoutes from "./routes/jarvis.js";
import questRoutes from "./routes/quests.js";
import walletRoutes from "./routes/wallet.js";
import studentHubRoutes from "./routes/studentHub.js";
import teacherRoutes from "./routes/teacher.js";
import businessRoutes from "./routes/business.js";
import workerRoutes from "./routes/worker.js";

dotenv.config();

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/health", (req, res) => res.json({ ok: true, service: "quantilum-api" }));

app.use("/auth", authRoutes);
app.use("/api/jarvis", jarvisRoutes);
app.use("/api/quests", questRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/student", studentHubRoutes);
app.use("/api/teacher", teacherRoutes);
app.use("/api/business", businessRoutes);
app.use("/api/worker", workerRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Quantilum API listening on :${PORT}`));
