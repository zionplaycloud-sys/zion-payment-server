const WebSocket = require("ws");
const express = require("express");
const http = require("http");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, "public")));

let sessions = {};
let agents = new Set();

wss.on("connection", (ws) => {
  let sessionId = null;
  let role = null;

  ws.on("message", (msg) => {
    let data;
    try {
      data = JSON.parse(msg);
    } catch {
      return;
    }

    // VIEWER
    if (data.type === "join-viewer") {
      sessionId = data.sessionId;
      role = "viewer";
      sessions[sessionId] = sessions[sessionId] || {};
      sessions[sessionId].viewer = ws;
      console.log("Viewer joined:", sessionId);
    }

    // BROADCASTER
    if (data.type === "join-broadcaster") {
      sessionId = data.sessionId;
      role = "broadcaster";
      sessions[sessionId] = sessions[sessionId] || {};
      sessions[sessionId].broadcaster = ws;
      console.log("Broadcaster joined:", sessionId);
    }

    // AGENT
    if (data.type === "join-agent") {
      role = "agent";
      ws.isAgent = true;
      agents.add(ws);
      console.log("Agent connected to server ✅");
    }

    // SIGNALING
    if (data.type === "offer") {
      sessions[data.sessionId]?.viewer?.send(JSON.stringify(data));
    }

    if (data.type === "answer") {
      sessions[data.sessionId]?.broadcaster?.send(JSON.stringify(data));
    }

    if (data.type === "ice-candidate") {
      const s = sessions[data.sessionId];
      if (!s) return;

      if (data.from === "viewer") {
        s.broadcaster?.send(JSON.stringify(data));
      } else {
        s.viewer?.send(JSON.stringify(data));
      }
    }

    // 🔥 INPUT → AGENT
    if (data.type === "input") {
      agents.forEach(agent => {
        if (agent.readyState === 1) {
          agent.send(JSON.stringify(data));
        }
      });
    }
  });

  ws.on("close", () => {
    if (role === "agent") agents.delete(ws);

    if (sessionId && sessions[sessionId]) {
      delete sessions[sessionId][role];
      if (!sessions[sessionId].viewer && !sessions[sessionId].broadcaster) {
        delete sessions[sessionId];
      }
    }
  });
});

server.listen(3000, () => {
  console.log("🚀 Server running on 3000");
});