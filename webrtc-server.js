import WebSocket, { WebSocketServer } from "ws";
import http from "http";

const server = http.createServer();
const wss = new WebSocketServer({ server });

const sessions = {};

wss.on("connection", (ws) => {
  console.log("🔌 Connected");

  let currentSessionId = null;
  let role = null;

  ws.on("message", (msg) => {
    let data;
    try {
      data = JSON.parse(msg.toString());
    } catch {
      console.log("⚠️ Invalid JSON message ignored");
      return;
    }

    // ===============================
    // 👀 VIEWER JOIN
    // ===============================
    if (data.type === "join-viewer") {
      if (!data.sessionId) {
        console.log("⚠️ join-viewer missing sessionId");
        return;
      }
      currentSessionId = data.sessionId;
      role = "viewer";

      sessions[currentSessionId] = sessions[currentSessionId] || {};
      sessions[currentSessionId].viewer = ws;

      console.log("👀 Viewer joined:", currentSessionId);

      // 🔥 trigger stream if agent exists
      if (sessions[currentSessionId].broadcaster) {
        sessions[currentSessionId].broadcaster.send(JSON.stringify({
          type: "viewer-ready"
        }));
        console.log("🚀 viewer-ready sent to agent");
      }

      return;
    }

    // ===============================
    // 🟢 AGENT JOIN
    // ===============================
if (
  data.type === "join-agent" ||
  data.type === "join-broadcaster" ||
  data.type === "agent-join" // 🔥 ADD THIS
) {
      if (!data.sessionId) {
        console.log("⚠️ join-agent missing sessionId");
        return;
      }
      currentSessionId = data.sessionId;
      role = "agent";

      sessions[currentSessionId] = sessions[currentSessionId] || {};
      sessions[currentSessionId].broadcaster = ws;

      console.log("🟢 Agent joined:", currentSessionId);

      // 🔥 trigger if viewer exists
      if (sessions[currentSessionId].viewer) {
        ws.send(JSON.stringify({
          type: "viewer-ready"
        }));
        console.log("🚀 viewer-ready sent to agent");
      }

      return;
    }

    // ===============================
    // 🔁 SIGNALING
    // ===============================
    if (["offer", "answer", "ice-candidate"].includes(data.type)) {
      if (!data.sessionId) {
        console.log(`⚠️ ${data.type} missing sessionId`);
        return;
      }
      const s = sessions[data.sessionId];
      if (!s) return;

      if (data.type === "offer") {
        console.log("📡 Offer → viewer");
        s.viewer?.send(JSON.stringify(data));
      }

      if (data.type === "answer") {
        console.log("📡 Answer → agent");
        s.broadcaster?.send(JSON.stringify(data));
      }

      if (data.type === "ice-candidate") {
        if (data.from === "viewer") {
          s.broadcaster?.send(JSON.stringify(data));
        } else {
          s.viewer?.send(JSON.stringify(data));
        }
      }

      return;
    }

    
  });

  // ===============================
  // 🔥 CLEANUP ON DISCONNECT (IMPORTANT FIX)
  // ===============================
  ws.on("close", () => {
    console.log("❌ Disconnected");

    if (currentSessionId && sessions[currentSessionId]) {
      if (role === "viewer") {
        delete sessions[currentSessionId].viewer;
      }

      if (role === "agent") {
        delete sessions[currentSessionId].broadcaster;
      }

      // 🔥 remove empty session
      if (
        !sessions[currentSessionId].viewer &&
        !sessions[currentSessionId].broadcaster
      ) {
        delete sessions[currentSessionId];
      }
    }
  });
});

server.listen(3000, () => {
  console.log("🚀 Server running on ws://localhost:3000");
});
