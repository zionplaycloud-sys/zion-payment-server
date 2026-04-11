const WebSocket = require("ws");
const { mouse, keyboard, Button, Point } = require("@nut-tree-fork/nut-js");

// 🔥 CONNECT TO SERVER
const ws = new WebSocket("ws://localhost:3000");

// 🔥 CHANGE TO YOUR SCREEN SIZE
const SCREEN_WIDTH = 1920;
const SCREEN_HEIGHT = 1080;

ws.onopen = () => {
  console.log("Agent connected ✅");

  ws.send(JSON.stringify({
    type: "join-agent"
  }));
};

ws.onmessage = async (msg) => {
  try {
    const data = JSON.parse(msg.data);

    if (data.type !== "input") return;

    // 🔥 DEBUG LOG (VERY IMPORTANT)
    console.log("INPUT RECEIVED:", data);

    /////////////////////////////////////////////////////
    // 🖱 MOUSE MOVE (ABSOLUTE + RELATIVE SUPPORT)
    /////////////////////////////////////////////////////
    if (data.event === "mousemove") {

  // POINTER LOCK MODE (RELATIVE)
  if (data.relative) {
    const pos = await mouse.getPosition();

    const newX = pos.x + data.x;
    const newY = pos.y + data.y;

    await mouse.setPosition(new Point(newX, newY));

    console.log("Relative move:", data.x, data.y);
  }

  // NORMAL MODE
  else {
    const x = Math.floor(data.x * SCREEN_WIDTH);
    const y = Math.floor(data.y * SCREEN_HEIGHT);

    await mouse.setPosition(new Point(x, y));

    console.log("Absolute move:", x, y);
  }
}
    /////////////////////////////////////////////////////
    // 🖱 CLICK
    /////////////////////////////////////////////////////
    if (data.event === "mousedown") {
      await mouse.click(Button.LEFT);
      console.log("Mouse click");
    }

    /////////////////////////////////////////////////////
    // ⌨ KEY DOWN
    /////////////////////////////////////////////////////
    if (data.event === "keydown") {
      await keyboard.pressKey(data.key);
      console.log("Key down:", data.key);
    }

    /////////////////////////////////////////////////////
    // ⌨ KEY UP
    /////////////////////////////////////////////////////
    if (data.event === "keyup") {
      await keyboard.releaseKey(data.key);
      console.log("Key up:", data.key);
    }

  } catch (err) {
    console.log("Agent error:", err.message);
  }
};