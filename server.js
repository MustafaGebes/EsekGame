const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

const players = new Map();

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8"
};

const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split("?")[0]);

  if (url === "/") {
    url = "/EsekGame.html";
  }

  const filePath = path.join(__dirname, url);

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Bulunamadı");
      return;
    }

    res.writeHead(200, {
      "Content-Type":
        mime[path.extname(filePath)] ||
        "application/octet-stream"
    });

    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

function broadcast() {
  const data = Object.fromEntries(players);

  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(
        JSON.stringify({
          type: "players",
          players: data,
          me: client.esekId
        })
      );
    }
  }
}

wss.on("connection", (socket) => {
  const id = Math.random().toString(36).slice(2, 9);

  socket.esekId = id;

  players.set(id, {
    x: 0,
    z: 0
  });

  broadcast();

  socket.on("message", (raw) => {
    try {
      const data = JSON.parse(raw);

      if (data.type === "move") {
        const player = players.get(id);

        if (!player) {
          return;
        }

        player.x = Math.max(
          -14,
          Math.min(14, Number(data.x) || 0)
        );

        player.z = Math.max(
          -14,
          Math.min(14, Number(data.z) || 0)
        );

        broadcast();
      }
    } catch (error) {
      // Geçersiz mesajı görmezden gel
    }
  });

  socket.on("close", () => {
    players.delete(id);
    broadcast();
  });
});

const PORT = Number(process.env.PORT) || 8080;

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `EŞEK GAME ONLINE SUNUCUSU - port ${PORT}`
  );
});
