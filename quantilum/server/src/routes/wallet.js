import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { getOrCreateWallet, getLedgerHistory, applyLedgerEntry, transfer } from "../services/walletService.js";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const wallet = await getOrCreateWallet(req.user.id);
  res.json(wallet);
});

router.get("/history", requireAuth, async (req, res) => {
  const history = await getLedgerHistory(req.user.id);
  res.json(history);
});

// $5 business registration fee -> platform (modeled as a debit; platform account not modeled as a user here)
router.post("/pay-business-registration", requireAuth, async (req, res) => {
  try {
    const wallet = await applyLedgerEntry({
      userId: req.user.id,
      type: "subscription_payment",
      amountCents: -500, // $5.00
      memo: "Business registration fee"
    });
    res.json(wallet);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Business pays a worker/business for a completed project
router.post("/pay", requireAuth, async (req, res) => {
  const { toUserId, amountCents, projectId, memo } = req.body;
  if (!toUserId || !amountCents || amountCents <= 0) {
    return res.status(400).json({ error: "toUserId and a positive amountCents are required" });
  }
  try {
    await transfer({
      fromUserId: req.user.id,
      toUserId,
      amountCents,
      referenceId: projectId,
      referenceTable: "projects",
      memo
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
