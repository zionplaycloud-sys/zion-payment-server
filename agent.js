import express from "express";
import WebSocket from "ws";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { mouse, keyboard, Button, Point } from "@nut-tree-fork/nut-js";

const SIGNALING_URL = process.env.SIGNALING_URL || "ws://localhost:3000";
const AGENT_PORT = Number(process.env.AGENT_PORT || 3001);
const LAUNCH_TOKEN = process.env.AGENT_LAUNCH_TOKEN || "";
const SCREEN_WIDTH = Number(process.env.SCREEN_WIDTH || 1920);
const SCREEN_HEIGHT = Number(process.env.SCREEN_HEIGHT || 1080);
const allowedLaunchRoots = (process.env.ALLOWED_LAUNCH_ROOTS || "")
  .split(";")
  .map((p) => p.trim())
  .filter(Boolean)
  .map((p) => path.resolve(p).toLowerCase());

function ensureToken(req, res, next) {
  if (!LAUNCH_TOKEN) {
    return next();
  }

  const headerToken = req.headers["x-agent-token"];
  if (headerToken !== LAUNCH_TOKEN) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  return next();
}

function validateLaunchPath(rawPath) {
  if (!rawPath || typeof rawPath !== "string") {
    return { ok: false, error: "Invalid path" };
  }

  const exePath = path.resolve(rawPath);
  if (!path.isAbsolute(exePath)) {
    return { ok: false, error: "Path must be absolute" };
  }

  if (path.extname(exePath).toLowerCase() !== ".exe") {
    return { ok: false, error: "Only .exe files are allowed" };
  }

  if (!fs.existsSync(exePath)) {
    return { ok: false, error: "Executable not found" };
  }

  if (
    allowedLaunchRoots.length > 0 &&
    !allowedLaunchRoots.some((root) => exePath.toLowerCase().startsWith(root))
  ) {
    return { ok: false, error: "Path not in allowed launch roots" };
  }

  return { ok: true, exePath };
}

function launchExecutable(exePath) {
  return new Promise((resolve, reject) => {
    const child = spawn("cmd.exe", ["/c", "start", "", exePath], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });

    child.on("error", reject);
    child.unref();
    resolve();
  });
}

async function handleInput(data) {
  if (data.type !== "input") return;

  if (data.event === "mousemove") {
    if (data.relative) {
      const pos = await mouse.getPosition();
      const newX = pos.x + Number(data.x || 0);
      const newY = pos.y + Number(data.y || 0);
      await mouse.setPosition(new Point(newX, newY));
      return;
    }

    const x = Math.floor(Number(data.x || 0) * SCREEN_WIDTH);
    const y = Math.floor(Number(data.y || 0) * SCREEN_HEIGHT);
    await mouse.setPosition(new Point(x, y));
    return;
  }

  if (data.event === "mousedown") {
    await mouse.click(Button.LEFT);
    return;
  }

  if (data.event === "keydown" && data.key) {
    await keyboard.pressKey(data.key);
    return;
  }

  if (data.event === "keyup" && data.key) {
    await keyboard.releaseKey(data.key);
  }
}

function connectToSignaling() {
  const ws = new WebSocket(SIGNALING_URL);

  ws.on("open", () => {
    console.log("Agent connected to signaling:", SIGNALING_URL);
    ws.send(JSON.stringify({ type: "join-agent" }));
  });

  ws.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      await handleInput(data);
    } catch (err) {
      console.log("Agent input error:", err.message);
    }
  });

  ws.on("close", () => {
    console.log("Signaling disconnected. Reconnecting in 2s...");
    setTimeout(connectToSignaling, 2000);
  });

  ws.on("error", (err) => {
    console.log("Signaling error:", err.message);
  });
}

const app = express();
app.use(express.json());

app.get("/status", (req, res) => {
  res.json({ success: true, status: "ok" });
});

app.post("/launch-exe", ensureToken, async (req, res) => {
  try {
    const check = validateLaunchPath(req.body?.path);
    if (!check.ok) {
      return res.json({ success: false, error: check.error });
    }

    await launchExecutable(check.exePath);
    return res.json({ success: true });
  } catch (err) {
    return res.json({ success: false, error: err.message || "Launch failed" });
  }
});

app.listen(AGENT_PORT, () => {
  console.log(`Agent HTTP server running on ${AGENT_PORT}`);
});

connectToSignaling();
