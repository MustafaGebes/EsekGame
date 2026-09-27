const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, maxPayload: 16 * 1024 });

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/health', (_req, res) => res.json({ ok: true, players: activePlayerCount() }));

const players = Object.create(null);
let chatHistory = [];
const CHAT_RESET_MS = 10 * 60 * 1000;
const CHAT_LIMIT = 100;

function activePlayerCount() {
    return Object.values(players).filter(player => player.inGame).length;
}
function send(ws, payload) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}
function broadcast(payload) {
    const encoded = JSON.stringify(payload);
    for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) client.send(encoded);
    }
}
function sendPlayerSnapshot() {
    broadcast({ type: 'players', players, count: activePlayerCount() });
}
function cleanName(value) {
    const name = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 20);
    return name || 'Player';
}
function cleanChatText(value) {
    return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, 220);
}
function cleanNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? Math.max(-500, Math.min(500, num)) : fallback;
}

wss.on('connection', (ws) => {
    const id = Math.random().toString(36).slice(2, 9);
    console.log(`Oyuncu bağlandı: ${id}`);
    players[id] = {
        x: 0, y: 0, z: 0, yaw: 0, pitch: 0,
        isCrouching: false, isMoving: false, isJumping: false,
        name: 'Player', platform: 'pc', pingMs: null, inGame: false
    };

    send(ws, { type: 'init', id });
    send(ws, { type: 'chat_history', messages: chatHistory.slice(-50) });
    sendPlayerSnapshot();

    ws.on('message', (raw) => {
        try {
            const data = JSON.parse(raw.toString());
            const player = players[id];
            if (!player || !data || typeof data.type !== 'string') return;

            if (data.type === 'profile') {
                player.name = cleanName(data.name);
                player.platform = data.platform === 'mobile' ? 'mobile' : 'pc';
                if (data.pingMs !== null && data.pingMs !== undefined && Number.isFinite(Number(data.pingMs))) player.pingMs = Math.max(0, Math.min(10000, Math.round(Number(data.pingMs))));
            } else if (data.type === 'presence') {
                player.name = cleanName(data.name ?? player.name);
                player.platform = data.platform === 'mobile' ? 'mobile' : 'pc';
                player.inGame = data.active === true;
            } else if (data.type === 'move') {
                player.x = cleanNumber(data.x, player.x);
                player.y = cleanNumber(data.y, player.y);
                player.z = cleanNumber(data.z, player.z);
                player.yaw = cleanNumber(data.yaw, player.yaw);
                player.pitch = cleanNumber(data.pitch, player.pitch);
                player.isCrouching = data.isCrouching === true;
                player.isMoving = data.isMoving === true;
                player.isJumping = data.isJumping === true;
                player.name = cleanName(data.name ?? player.name);
                player.platform = data.platform === 'mobile' ? 'mobile' : 'pc';
                if (data.pingMs !== null && data.pingMs !== undefined && Number.isFinite(Number(data.pingMs))) player.pingMs = Math.max(0, Math.min(10000, Math.round(Number(data.pingMs))));
            } else if (data.type === 'ping') {
                send(ws, { type: 'pong', timestamp: Number(data.timestamp) });
            } else if (data.type === 'ping_result') {
                const ping = Number(data.pingMs);
                if (Number.isFinite(ping)) player.pingMs = Math.max(0, Math.min(10000, Math.round(ping)));
            } else if (data.type === 'chat_history') {
                send(ws, { type: 'chat_history', messages: chatHistory.slice(-50) });
            } else if (data.type === 'chat') {
                const now = Date.now();
                if (now - (ws.lastChatAt || 0) < 650) return;
                const text = cleanChatText(data.text);
                if (!text) return;
                ws.lastChatAt = now;
                const message = {
                    id: `${now}-${id}`,
                    name: cleanName(player.name),
                    platform: player.platform,
                    text,
                    time: new Date(now).toISOString()
                };
                chatHistory.push(message);
                if (chatHistory.length > CHAT_LIMIT) chatHistory = chatHistory.slice(-CHAT_LIMIT);
                broadcast({ type: 'chat_message', message });
            }
        } catch (error) {
            console.warn('Geçersiz istemci mesajı:', error.message);
        }
    });

    ws.on('close', () => {
        delete players[id];
        console.log(`Oyuncu ayrıldı: ${id}`);
        sendPlayerSnapshot();
    });
    ws.on('error', error => console.warn(`WebSocket hatası (${id}):`, error.message));
});

// Presence, platform ve ping listesini bütün istemcilere güncel tut.
setInterval(sendPlayerSnapshot, 100);
// Sunucu saatiyle tam 10 dakikada bir sohbet geçmişi sıfırlanır.
setInterval(() => {
    chatHistory = [];
    broadcast({ type: 'chat_reset', time: new Date().toISOString() });
}, CHAT_RESET_MS);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sunucu ${PORT} portunda çalışıyor.`));
