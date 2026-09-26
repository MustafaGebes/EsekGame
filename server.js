const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

let players = {};

wss.on('connection', (ws) => {
    const id = Math.random().toString(36).substring(2, 9);
    console.log(`Oyuncu katıldı: ${id}`);

    players[id] = { 
        x: 0, y: 0, z: 0, 
        yaw: 0, pitch: 0, 
        isCrouching: false,
        isMoving: false,
        isJumping: false
    };

    ws.send(JSON.stringify({ type: 'init', id: id }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'move') {
                if (players[id]) {
                    players[id] = {
                        x: data.x,
                        y: data.y,
                        z: data.z,
                        yaw: data.yaw,
                        pitch: data.pitch,
                        isCrouching: data.isCrouching || false,
                        isMoving: data.isMoving || false,
                        isJumping: data.isJumping || false
                    };
                }
            }
        } catch (e) {
            console.error("Mesaj hatası:", e);
        }
    });

    ws.on('close', () => {
        console.log(`Oyuncu ayrıldı: ${id}`);
        delete players[id];
    });
});

setInterval(() => {
    const dataToSend = JSON.stringify({ type: "players", players: players });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(dataToSend);
        }
    });
}, 50);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});
