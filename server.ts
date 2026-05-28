import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // In-memory fundraising state (synced for the live session)
  let raisedAmount = 420000;
  let donorCount = 14;
  const GOAL_AMOUNT = 1000000;

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "RCTTS Server is running" });
  });

  app.get("/api/fundraising", (req, res) => {
    res.json({
      success: true,
      goal: GOAL_AMOUNT,
      raised: raisedAmount,
      contributors: donorCount
    });
  });

  app.post("/api/fundraising/donate", (req, res) => {
    const { amount, phone } = req.body;
    const parsedAmount = Number(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ success: false, error: "Invalid donation amount" });
    }
    raisedAmount += parsedAmount;
    donorCount += 1;
    res.json({
      success: true,
      goal: GOAL_AMOUNT,
      raised: raisedAmount,
      contributors: donorCount,
      message: `Successfully processed donation of RWF ${parsedAmount.toLocaleString()}`
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
