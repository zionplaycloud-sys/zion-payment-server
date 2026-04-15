import WebSocket, { WebSocketServer } from "ws";
import http from "http";

const server = http.createServer();
const wss = new WebSocketServer({ server });

const sessions = {};

wss.on("connection", (ws) => {
  console.log("🔌 Connected");

  ws.on("message", (msg) => {
    const data = JSON.parse(msg.toString());

    if (data.type === "join-viewer") {
      sessions[data.sessionId] = sessions[data.sessionId] || {};
      sessions[data.sessionId].viewer = ws;
      console.log("👀 Viewer joined");

      if (sessions[data.sessionId].broadcaster) {
        sessions[data.sessionId].broadcaster.send(JSON.stringify({
          type: "viewer-ready"
        }));
      }
      return;
    }

    if (data.type === "join-broadcaster") {
      sessions[data.sessionId] = sessions[data.sessionId] || {};
      sessions[data.sessionId].broadcaster = ws;
      console.log("🟢 Agent joined");
      return;
    }

    if (["offer", "answer", "ice-candidate"].includes(data.type)) {
      const s = sessions[data.sessionId];
      if (!s) return;

      if (data.type === "offer") s.viewer?.send(JSON.stringify(data));
      if (data.type === "answer") s.broadcaster?.send(JSON.stringify(data));

      if (data.type === "ice-candidate") {
        if (data.from === "viewer") s.broadcaster?.send(JSON.stringify(data));
        else s.viewer?.send(JSON.stringify(data));
      }
      return;
    }

    // 🔥 INPUT DEBUG
    if (data.type === "input") {
      console.log("🎮 SERVER GOT:", data);

      sessions[data.sessionId]?.broadcaster?.send(JSON.stringify(data));
    }
  });
});

server.listen(3000, () => {
  console.log("🚀 Server running");
});