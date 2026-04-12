import WebSocket, { WebSocketServer } from "ws";
import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = Number(process.env.WEBRTC_PORT || 3000);

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

const sessions = {};
const agents = new Set();

wss.on("connection", (ws) => {
  let sessionId = null;
  let role = null;

  ws.on("message", (msg) => {
    let data;
    try {
      data = JSON.parse(msg.toString());
    } catch {
      return;
    }

    if (data.type === "join-viewer") {
      sessionId = data.sessionId;
      role = "viewer";
      sessions[sessionId] = sessions[sessionId] || {};
      sessions[sessionId].viewer = ws;
      return;
    }

    if (data.type === "join-broadcaster") {
      sessionId = data.sessionId;
      role = "broadcaster";
      sessions[sessionId] = sessions[sessionId] || {};
      sessions[sessionId].broadcaster = ws;
      return;
    }

    if (data.type === "join-agent") {
      role = "agent";
      ws.isAgent = true;
      agents.add(ws);
      return;
    }

    if (data.type === "offer") {
      sessions[data.sessionId]?.viewer?.send(JSON.stringify(data));
      return;
    }

    if (data.type === "answer") {
      sessions[data.sessionId]?.broadcaster?.send(JSON.stringify(data));
      return;
    }

    if (data.type === "ice-candidate") {
      const s = sessions[data.sessionId];
      if (!s) return;

      if (data.from === "viewer") {
        s.broadcaster?.send(JSON.stringify(data));
      } else {
        s.viewer?.send(JSON.stringify(data));
      }
      return;
    }

    if (data.type === "input") {
      agents.forEach((agent) => {
        if (agent.readyState === WebSocket.OPEN) {
          agent.send(JSON.stringify(data));
        }
      });
    }
  });

  ws.on("close", () => {
    if (role === "agent") {
      agents.delete(ws);
    }

    if (sessionId && sessions[sessionId]) {
      delete sessions[sessionId][role];
      if (!sessions[sessionId].viewer && !sessions[sessionId].broadcaster) {
        delete sessions[sessionId];
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`WebRTC signaling server running on ${PORT}`);
});
