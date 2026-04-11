const http = require("http");

let clients = [];

const server = http.createServer((req, res) => {

  if (req.url === "/stream") {
    console.log("Viewer connected");

    res.writeHead(200, {
      "Content-Type": "video/mp2t",
      "Connection": "keep-alive"
    });

    clients.push(res);

    req.on("close", () => {
      clients = clients.filter(c => c !== res);
      console.log("Viewer disconnected");
    });

  } else if (req.url === "/stream-input") {
    console.log("FFmpeg connected");

    req.on("data", chunk => {
      clients.forEach(client => client.write(chunk));
    });

    req.on("end", () => {
      console.log("Stream ended");
    });

    // ❌ DO NOT CLOSE CONNECTION HERE
    // res.end("OK");  <-- REMOVE THIS

  } else {
    res.end("Server running");
  }

});

server.listen(8080, () => {
  console.log("Server running on http://127.0.0.1:8080");
});