import WebSocket from "ws";

const SESSION_ID = process.argv[2]; // pass sessionId when starting

if (!SESSION_ID) {
    console.error("❌ No sessionId provided");
    process.exit(1);
}

console.log("🎮 Stream Agent starting for session:", SESSION_ID);

const ws = new WebSocket("ws://127.0.0.1:3000");

let pc;

ws.onopen = async () => {
    console.log("🟢 Connected to WebRTC server");

    ws.send(JSON.stringify({
        type: "join-agent",
        sessionId: SESSION_ID
    }));

    pc = new RTCPeerConnection();

    // 🎥 CAPTURE SCREEN
    const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
            frameRate: 30,
            width: 1280,
            height: 720
        },
        audio: false
    });

    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            ws.send(JSON.stringify({
                type: "ice-candidate",
                sessionId: SESSION_ID,
                from: "agent",
                candidate: e.candidate
            }));
        }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    ws.send(JSON.stringify({
        type: "offer",
        sessionId: SESSION_ID,
        offer
    }));
};

ws.onmessage = async (msg) => {
    const data = JSON.parse(msg.data);

    if (data.type === "answer") {
        await pc.setRemoteDescription(data.answer);
        console.log("✅ Connected to viewer");
    }

    if (data.type === "ice-candidate") {
        await pc.addIceCandidate(data.candidate);
    }
};

ws.onerror = (err) => {
    console.error("❌ WS Error:", err);
};

ws.onclose = () => {
    console.log("🔴 Stream agent disconnected");
};