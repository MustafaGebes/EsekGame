// server.js - ESEKGAMES Full Multiplayer Server (v3 - Fixed Clone + Same Account)
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 10000;

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");
const MAIN_INDEX = path.join(ROOT, "index.html");
const SIMULATOR_INDEX = path.join(ROOT, "games", "eseksimulator", "index.html");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(ACCOUNTS_FILE)) fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify({ accounts: {} }, null, 2));

app.use(express.json({ limit: "1mb" }));
app.use(express.static(ROOT));

app.get("/", (req, res) => fs.existsSync(MAIN_INDEX) ? res.sendFile(MAIN_INDEX) : res.status(404).send("index.html yok"));
app.get("/games/eseksimulator", (req, res) => fs.existsSync(SIMULATOR_INDEX) ? res.sendFile(SIMULATOR_INDEX) : res.status(404).send("simulator yok"));
app.get("/health", (req, res) => res.json({ ok: true, players: activePlayerCount(), uptime: process.uptime() }));

// ============ HESAP SİSTEMİ ============
function loadAccounts() {
    try {
        const data = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"));
        if (!data.accounts || typeof data.accounts !== "object") data.accounts = {};
        return data;
    } catch { return { accounts: {} }; }
}
function saveAccounts(data) { fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(data, null, 2), "utf8"); }
function hashPassword(p) { return crypto.createHash("sha256").update(String(p)).digest("hex"); }
function normalizeUsername(u) { return String(u || "").trim().replace(/\s+/g, " "); }
function validUsername(u) { return u.length >= 3 && u.length <= 24 && /^[a-zA-Z0-9_ğüşöçıİĞÜŞÖÇ -]+$/.test(u); }
function findAccount(username) {
    const db = loadAccounts();
    const target = username.toLowerCase();
    for (const key of Object.keys(db.accounts)) {
        if (key.toLowerCase() === target) return { key, account: db.accounts[key] };
    }
    return null;
}

function makeToken(username) {
    const payload = `${username}:${Date.now()}:${crypto.randomBytes(8).toString("hex")}`;
    return crypto.createHash("sha256").update(payload).digest("hex");
}
const activeTokens = new Map(); // token -> { username, createdAt }

app.post("/api/register", (req, res) => {
    const username = normalizeUsername(req.body.username);
    const password = String(req.body.password || "");
    if (!validUsername(username)) return res.status(400).json({ ok: false, error: "Kullanıcı adı 3-24 karakter olmalı." });
    if (password.length < 4) return res.status(400).json({ ok: false, error: "Şifre en az 4 karakter olmalı." });
    const db = loadAccounts();
    if (findAccount(username)) return res.status(409).json({ ok: false, error: "Bu kullanıcı adı zaten kullanılıyor." });
    db.accounts[username] = { username, password: hashPassword(password), createdAt: Date.now() };
    saveAccounts(db);
    const token = makeToken(username);
    activeTokens.set(token, { username, createdAt: Date.now() });
    return res.json({ ok: true, username, token });
});

app.post("/api/login", (req, res) => {
    const username = normalizeUsername(req.body.username);
    const password = String(req.body.password || "");
    const found = findAccount(username);
    if (!found) return res.status(401).json({ ok: false, error: "Kullanıcı adı veya şifre yanlış." });
    if (found.account.password !== hashPassword(password)) return res.status(401).json({ ok: false, error: "Kullanıcı adı veya şifre yanlış." });
    const token = makeToken(found.account.username);
    activeTokens.set(token, { username: found.account.username, createdAt: Date.now() });
    return res.json({ ok: true, username: found.account.username, token });
});

app.post("/api/change-password", (req, res) => {
    const username = normalizeUsername(req.body.username);
    const oldPassword = String(req.body.oldPassword || "");
    const newPassword = String(req.body.newPassword || "");
    const found = findAccount(username);
    if (!found) return res.status(404).json({ ok: false, error: "Hesap bulunamadı." });
    if (found.account.password !== hashPassword(oldPassword)) return res.status(401).json({ ok: false, error: "Mevcut şifre yanlış." });
    if (newPassword.length < 4) return res.status(400).json({ ok: false, error: "Yeni şifre en az 4 karakter olmalı." });
    const db = loadAccounts();
    db.accounts[found.key].password = hashPassword(newPassword);
    saveAccounts(db);
    return res.json({ ok: true });
});

app.post("/api/change-username", (req, res) => {
    const oldUsername = normalizeUsername(req.body.username);
    const newUsername = normalizeUsername(req.body.newUsername);
    const password = String(req.body.password || "");
    if (!validUsername(newUsername)) return res.status(400).json({ ok: false, error: "Yeni kullanıcı adı geçersiz." });
    const found = findAccount(oldUsername);
    if (!found) return res.status(404).json({ ok: false, error: "Hesap bulunamadı." });
    if (found.account.password !== hashPassword(password)) return res.status(401).json({ ok: false, error: "Şifre yanlış." });
    if (findAccount(newUsername)) return res.status(409).json({ ok: false, error: "Bu kullanıcı adı zaten kullanılıyor." });
    const db = loadAccounts();
    db.accounts[newUsername] = { ...db.accounts[found.key], username: newUsername, updatedAt: Date.now() };
    delete db.accounts[found.key];
    saveAccounts(db);
    return res.json({ ok: true, username: newUsername });
});

// ============ OYUNCU / DÜNYA STATE ============
const players = new Map();
let nextPlayerId = 1;

const worldState = {
    chatMessages: [],
    apples: {},
    animals: {},
    carrots: {}
};

const CARROT_IDS = Array.from({ length: 10 }, (_, i) => `carrot-${i}`);
for (const id of CARROT_IDS) worldState.carrots[id] = true;

function guestName(n) { return `Guest-${String(n).padStart(3, "0")}`; }
function isGuestNameUsed(name) {
    for (const p of players.values()) if (p.name === name) return true;
    return false;
}
function getSmallestFreeGuestNumber() {
    let n = 0;
    while (isGuestNameUsed(guestName(n))) n++;
    return n;
}
function allocateGuestName() {
    const n = getSmallestFreeGuestNumber();
    return { name: guestName(n), number: n };
}
function activePlayerCount() {
    let c = 0;
    for (const p of players.values()) if (p.inGame) c++;
    return c;
}

function send(ws, data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify(data)); } catch (e) { console.error("WS send:", e.message); }
}
function broadcast(data, exceptId = null) {
    for (const p of players.values()) {
        if (exceptId !== null && p.id === exceptId) continue;
        send(p.ws, data);
    }
}
function broadcastGame(data, exceptId = null) {
    for (const p of players.values()) {
        if (!p.inGame) continue;
        if (exceptId !== null && p.id === exceptId) continue;
        send(p.ws, data);
    }
}

function getPublicPlayer(p) {
    return {
        id: p.id,
        name: p.name,
        account: p.account,
        guest: p.guest,
        inGame: p.inGame,
        x: p.x, y: p.y, z: p.z,
        yaw: p.yaw, pitch: p.pitch,
        health: p.health, hunger: p.hunger, thirst: p.thirst,
        alive: !p.dead,
        isCrouching: p.isCrouching,
        isMoving: p.isMoving,
        isJumping: p.isJumping,
        platform: p.platform,
        pingMs: p.pingMs
    };
}

function sendPlayersUpdate() {
    const list = {};
    for (const p of players.values()) {
        if (!p.inGame) continue;
        list[p.id] = getPublicPlayer(p);
    }
    // Sadece "players" gönder — "player_list" client tarafından işlenmiyor
    broadcast({ type: "players", players: list, count: Object.keys(list).length });
}

// ============ PLAYER ============
function createPlayer(ws) {
    const id = nextPlayerId++;
    const player = {
        id, ws,
        name: null, account: false, guest: false, guestNumber: null,
        token: null,
        inGame: false,
        x: 0, y: 0.28, z: 0,
        yaw: 0, pitch: 0,
        health: 9, hunger: 9, thirst: 9,
        isCrouching: false, isMoving: false, isJumping: false,
        platform: "pc", pingMs: null,
        dead: false,
        inventory: { carrot: 0, apple: 0, sword: 0, gun: 0 },
        weapon: null, ammo: 0,
        connectedAt: Date.now(), lastSeen: Date.now()
    };
    players.set(id, player);
    return player;
}

// ============ JOIN ============
function joinGame(player, data) {
    if (player.inGame) {
        send(player.ws, { type: "join_accepted", state: getPublicPlayer(player), alreadyJoined: true });
        return;
    }

    let requestedName = null;
    let isAccount = false;

    // Token ile hesap kontrolü
    if (data && data.token && activeTokens.has(data.token)) {
        const acc = activeTokens.get(data.token);
        requestedName = acc.username;
        isAccount = true;
    }

    if (isAccount) {
        const found = findAccount(requestedName);
        if (!found) {
            send(player.ws, { type: "join_denied", message: "Hesap bulunamadı." });
            return;
        }

        // ⚠️ AYNI HESAP ZATEN OYUNDA MI?
        for (const p of players.values()) {
            if (p === player) continue;
            if (!p.inGame) continue;
            if (p.account && p.name &&
                p.name.toLowerCase() === found.account.username.toLowerCase()) {
                send(player.ws, {
                    type: "join_denied",
                    message: `"${found.account.username}" hesabı şu an başka bir cihazda oyunda. Önce oradan çıkış yap.`
                });
                return;
            }
        }

        player.name = found.account.username;
        player.account = true;
        player.guest = false;
        player.guestNumber = null;
        player.token = data.token;
    } else {
        // Misafir isim zorlaması varsa kontrol et
        const desired = data && data.name ? normalizeUsername(data.name) : null;

        if (desired && validUsername(desired)) {
            // Aynı isim başka oyuncuda varsa reddet
            let nameTaken = false;
            for (const p of players.values()) {
                if (p === player) continue;
                if (p.inGame && p.name && p.name.toLowerCase() === desired.toLowerCase()) {
                    nameTaken = true;
                    break;
                }
            }
            if (nameTaken) {
                send(player.ws, {
                    type: "join_denied",
                    message: `"${desired}" adı şu an kullanılıyor. Başka bir ad dene.`
                });
                return;
            }
            player.name = desired;
            player.account = false;
            player.guest = true;
            player.guestNumber = null;
        } else {
            const guest = allocateGuestName();
            player.name = guest.name;
            player.account = false;
            player.guest = true;
            player.guestNumber = guest.number;
        }
    }

    player.inGame = true;
    player.platform = data && data.platform === "mobile" ? "mobile" : "pc";
    player.x = 0; player.y = 0.28; player.z = 0;
    player.yaw = 0; player.pitch = 0;
    player.health = 9; player.hunger = 9; player.thirst = 9;
    player.dead = false;
    player.lastSeen = Date.now();

    send(player.ws, {
        type: "join_accepted",
        state: { ...getPublicPlayer(player), needs: { health: 9, hunger: 9, thirst: 9 } }
    });
    send(player.ws, { type: "chat_history", messages: worldState.chatMessages.slice(-100) });
    send(player.ws, { type: "apple_states", states: worldState.apples });
    send(player.ws, { type: "animal_states", states: worldState.animals });
    send(player.ws, { type: "carrot_states", states: worldState.carrots });

    broadcastGame({ type: "player_joined", player: getPublicPlayer(player) }, player.id);
    sendPlayersUpdate();
}

// ============ LEAVE ============
function leaveGame(player, reason = "leave") {
    if (!player.inGame) return;
    const oldId = player.id, oldName = player.name;
    player.inGame = false;
    player.name = null;
    player.account = false;
    player.guest = false;
    player.guestNumber = null;
    player.token = null;
    broadcastGame({ type: "player_left", id: oldId, name: oldName, reason }, oldId);
    sendPlayersUpdate();
}

// ============ MOVE ============
function handleMove(player, data) {
    if (!player.inGame) return;
    if (typeof data.x === "number") player.x = data.x;
    if (typeof data.y === "number") player.y = data.y;
    if (typeof data.z === "number") player.z = data.z;
    if (typeof data.yaw === "number") player.yaw = data.yaw;
    if (typeof data.pitch === "number") player.pitch = data.pitch;
    if (typeof data.isCrouching === "boolean") player.isCrouching = data.isCrouching;
    if (typeof data.isMoving === "boolean") player.isMoving = data.isMoving;
    if (typeof data.isJumping === "boolean") player.isJumping = data.isJumping;
    if (typeof data.platform === "string") player.platform = data.platform;
    if (typeof data.pingMs === "number") player.pingMs = data.pingMs;
    player.lastSeen = Date.now();

    broadcastGame({
        type: "player_moved",
        id: player.id,
        x: player.x, y: player.y, z: player.z,
        yaw: player.yaw, pitch: player.pitch,
        isCrouching: player.isCrouching,
        isMoving: player.isMoving,
        isJumping: player.isJumping
    }, player.id);
}

// ============ PRESENCE ============
function handlePresence(player, data) {
    if (!data) return;
    const active = !!data.active;
    if (active) {
        if (!player.inGame) {
            joinGame(player, { token: player.token, platform: data.platform });
        }
    } else {
        leaveGame(player, "presence_off");
    }
}

// ============ CHAT ============
function handleChat(player, data) {
    if (!player.inGame) return;
    let text = String(data.text || data.message || "").trim();
    if (!text) return;
    if (text.length > 220) text = text.slice(0, 220);

    const clientId = data.clientId || null;

    // Whisper: /msg <name> <text>
    const whisperMatch = text.match(/^\/msg\s+(\S+)\s+(.+)$/i);
    if (whisperMatch) {
        const targetName = whisperMatch[1];
        const messageText = whisperMatch[2].slice(0, 220);
        let target = null;
        for (const p of players.values()) {
            if (p.inGame && p.name && p.name.toLowerCase() === targetName.toLowerCase()) {
                target = p;
                break;
            }
        }
        if (!target) {
            send(player.ws, { type: "chat_error", message: "Kullanıcı bulunamadı: " + targetName });
            return;
        }
        const msg = {
            id: crypto.randomUUID(),
            clientId, private: true,
            name: player.name, toName: target.name,
            text: messageText, time: new Date().toISOString()
        };
        send(target.ws, { type: "chat_message", message: msg });
        send(player.ws, { type: "chat_message", message: msg });
        return;
    }

    const msg = {
        id: crypto.randomUUID(),
        clientId,
        name: player.name,
        text,
        time: new Date().toISOString()
    };
    worldState.chatMessages.push(msg);
    if (worldState.chatMessages.length > 100) worldState.chatMessages.shift();

    broadcastGame({ type: "chat_message", message: msg });
    broadcastGame({ type: "chat", message: msg });
}

// ============ NEEDS ============
function handleNeeds(player, data) {
    if (!player.inGame) return;
    if (typeof data.health === "number") player.health = Math.max(0, Math.min(9, data.health));
    if (typeof data.hunger === "number") player.hunger = Math.max(0, Math.min(9, data.hunger));
    if (typeof data.thirst === "number") player.thirst = Math.max(0, Math.min(9, data.thirst));
    send(player.ws, {
        type: "needs",
        health: player.health, hunger: player.hunger, thirst: player.thirst,
        alive: !player.dead
    });
    send(player.ws, {
        type: "needs_update",
        health: player.health, hunger: player.hunger, thirst: player.thirst
    });
    if (player.health <= 0 && !player.dead) killPlayer(player, "needs_zero");
}

// ============ APPLE ============
function handleApplePick(player, data) {
    if (!player.inGame) return;
    const treeId = String(data.treeId || "");
    if (!treeId) { send(player.ws, { type: "apple_pick_result", ok: false, message: "Geçersiz ağaç." }); return; }
    const current = worldState.apples[treeId] != null ? worldState.apples[treeId] : 6;
    if (current <= 0) {
        send(player.ws, { type: "apple_pick_result", ok: false, message: "Bu ağaçta elma kalmadı." });
        return;
    }
    worldState.apples[treeId] = current - 1;
    player.hunger = Math.min(9, player.hunger + 1.5);
    send(player.ws, {
        type: "apple_pick_result", ok: true, treeId,
        apples: worldState.apples[treeId],
        health: player.health, hunger: player.hunger, thirst: player.thirst
    });
    send(player.ws, { type: "needs", health: player.health, hunger: player.hunger, thirst: player.thirst });
    broadcastGame({ type: "apple_update", treeId, apples: worldState.apples[treeId] }, player.id);
}

// ============ DRINK ============
function handleDrink(player) {
    if (!player.inGame) return;
    player.thirst = Math.min(9, player.thirst + 2);
    send(player.ws, {
        type: "action_ok", action: "drink",
        health: player.health, hunger: player.hunger, thirst: player.thirst
    });
    send(player.ws, { type: "needs", health: player.health, hunger: player.hunger, thirst: player.thirst });
}

// ============ CARROT ============
function handleCarrotPick(player, data) {
    if (!player.inGame) return;
    const carrotId = String(data.carrotId || "");
    if (!carrotId) return;
    if (worldState.carrots[carrotId] === false) {
        send(player.ws, { type: "carrot_pick_result", ok: false, carrotId, message: "Havuç şu an yok." });
        return;
    }
    worldState.carrots[carrotId] = false;
    player.inventory.carrot++;
    send(player.ws, { type: "carrot_pick_result", ok: true, carrotId, inventory: player.inventory });
    broadcastGame({ type: "carrot_update", carrotId, available: false }, player.id);

    setTimeout(() => {
        worldState.carrots[carrotId] = true;
        broadcastGame({ type: "carrot_update", carrotId, available: true });
    }, 5 * 60 * 1000);
}

function handleCarrotStateRequest(player, data) {
    if (!player.inGame) return;
    if (data && Array.isArray(data.carrots)) {
        for (const c of data.carrots) {
            if (!(c.id in worldState.carrots)) worldState.carrots[c.id] = true;
        }
    } else {
        for (const id of CARROT_IDS) {
            if (!(id in worldState.carrots)) worldState.carrots[id] = true;
        }
    }
    send(player.ws, { type: "carrot_states", states: worldState.carrots });
}

// ============ ANIMAL ============
function handleAnimalStatesRequest(player, data) {
    if (!player.inGame) return;
    if (data && Array.isArray(data.ids)) {
        for (const id of data.ids) {
            if (!worldState.animals[id]) {
                worldState.animals[id] = { health: 9, hunger: 9, thirst: 9, alive: true };
            }
        }
    }
    send(player.ws, { type: "animal_states", states: worldState.animals });
}

function handleAnimalAttack(player, data) {
    if (!player.inGame || player.dead) return;
    const animalId = String(data.animalId || "");
    if (!animalId) return;
    const state = worldState.animals[animalId] || { health: 9, hunger: 9, thirst: 9, alive: true };
    state.health = Math.max(0, state.health - 1);
    if (state.health <= 0) state.alive = false;
    worldState.animals[animalId] = state;
    broadcastGame({ type: "animal_state", id: animalId, ...state }, player.id);
}

function handleAnimalCare(player, data) {
    if (!player.inGame) return;
    const animalId = String(data.animalId || "");
    if (!animalId) return;
    const action = String(data.action || "");
    const state = worldState.animals[animalId] || { health: 9, hunger: 9, thirst: 9, alive: true };
    if (action === "eat") state.hunger = Math.min(9, state.hunger + 2);
    if (action === "drink") state.thirst = Math.min(9, state.thirst + 2);
    worldState.animals[animalId] = state;
    broadcastGame({ type: "animal_state", id: animalId, ...state, care: action }, player.id);
}

function handleAnimalBiteAnimal(player, data) {
    if (!player.inGame) return;
    broadcastGame({ type: "animal_attack_broadcast", animalId: data.animalId, x: data.x, z: data.z }, player.id);
}

// ============ COMBAT ============
function damagePlayer(target, amount, attackerId, reason) {
    if (!target || !target.inGame) return;
    target.health = Math.max(0, target.health - amount);
    send(target.ws, { type: "needs", health: target.health, hunger: target.hunger, thirst: target.thirst, alive: target.health > 0 });
    send(target.ws, { type: "health_update", health: target.health, reason });
    broadcastGame({
        type: "player_damaged", id: target.id, health: target.health,
        amount, attackerId, reason
    });
    if (target.health <= 0) killPlayer(target, reason || "combat");
}

function killPlayer(player, reason) {
    if (player.dead) return;
    player.dead = true;
    player.health = 0;
    send(player.ws, { type: "player_death", id: player.id, reason });
    broadcastGame({ type: "player_death", id: player.id, reason });
    setTimeout(() => {
        if (!players.has(player.id) || !player.inGame) return;
        player.dead = false;
        player.health = 9; player.hunger = 9; player.thirst = 9;
        player.x = 0; player.y = 0.28; player.z = 0;
        send(player.ws, {
            type: "respawned",
            spawn: { x: 0, y: 0.28, z: 0 },
            state: { health: 9, hunger: 9, thirst: 9 }
        });
        broadcastGame({ type: "player_respawned", player: getPublicPlayer(player) });
    }, 5000);
}

function handleRespawn(player) {
    if (!player.inGame) return;
    if (!player.dead) {
        send(player.ws, {
            type: "respawned",
            spawn: { x: player.x, y: player.y, z: player.z },
            state: { health: player.health, hunger: player.hunger, thirst: player.thirst }
        });
        return;
    }
    player.dead = false;
    player.health = 9; player.hunger = 9; player.thirst = 9;
    send(player.ws, {
        type: "respawned",
        spawn: { x: 0, y: 0.28, z: 0 },
        state: { health: 9, hunger: 9, thirst: 9 }
    });
    broadcastGame({ type: "player_respawned", player: getPublicPlayer(player) });
}

function handleAttackPlayer(player, data) {
    if (!player.inGame || player.dead) return;
    const targetId = Number(data.targetId);
    const target = players.get(targetId);
    if (!target || !target.inGame || target.dead) return;
    const d = Math.hypot(target.x - player.x, target.z - player.z);
    if (d > 6) return;
    damagePlayer(target, 1, player.id, "player_attack");
    broadcastGame({ type: "combat_hit", attackerId: player.id, targetId: target.id, health: target.health });
    send(player.ws, { type: "combat_hit", attackerId: player.id, targetId: target.id, health: target.health });
}

// ============ WEAPON ============
function handleWeaponAttack(player, data) {
    if (!player.inGame || player.dead) return;
    const weapon = String(data.weapon || "");
    if (weapon === "gun") {
        if (player.ammo <= 0) {
            send(player.ws, { type: "weapon_result", ok: false, message: "Mermi yok." });
            return;
        }
        player.ammo--;
        send(player.ws, { type: "weapon_result", ok: true, ammo: player.ammo });
        broadcastGame({ type: "gun_shot", id: player.id, x: player.x, y: player.y, z: player.z, yaw: player.yaw, ammo: player.ammo }, player.id);
        if (data.targetId) {
            const target = players.get(Number(data.targetId));
            if (target && target.inGame && !target.dead) damagePlayer(target, 3, player.id, "gun");
        }
        if (data.targetAnimalId) {
            const state = worldState.animals[data.targetAnimalId] || { health: 9, hunger: 9, thirst: 9, alive: true };
            state.health = Math.max(0, state.health - 4);
            if (state.health <= 0) state.alive = false;
            worldState.animals[data.targetAnimalId] = state;
            broadcastGame({ type: "animal_state", id: data.targetAnimalId, ...state });
        }
    } else if (weapon === "sword") {
        broadcastGame({ type: "sword_attack", id: player.id, x: player.x, y: player.y, z: player.z, yaw: player.yaw }, player.id);
        if (data.targetId) {
            const target = players.get(Number(data.targetId));
            if (target && target.inGame && !target.dead) damagePlayer(target, 2, player.id, "sword");
        }
        if (data.targetAnimalId) {
            const state = worldState.animals[data.targetAnimalId] || { health: 9, hunger: 9, thirst: 9, alive: true };
            state.health = Math.max(0, state.health - 2);
            if (state.health <= 0) state.alive = false;
            worldState.animals[data.targetAnimalId] = state;
            broadcastGame({ type: "animal_state", id: data.targetAnimalId, ...state });
        }
    }
}

function handleWeaponEquip(player, data) {
    if (!player.inGame) return;
    const weapon = String(data.weapon || "");
    if (!["sword", "gun", "none"].includes(weapon)) return;
    player.weapon = weapon === "none" ? null : weapon;
    if (weapon === "gun" && player.ammo <= 0) player.ammo = 12;
    send(player.ws, { type: "weapon_equipped", weapon: player.weapon || "none", ammo: player.ammo });
}

// ============ WEBSOCKET ============
wss.on("connection", (ws, req) => {
    const player = createPlayer(ws);
    console.log(`[WS] Bağlandı: #${player.id}`);

    send(ws, { type: "init", id: player.id });
    send(ws, { type: "connected", id: player.id });
    send(ws, { type: "server_info", version: "3.0.0", players: activePlayerCount() });

    // Yeni bağlanan oyuncuya mevcut oyuncu listesini gönder
    sendPlayersUpdate();

    ws.on("message", (raw) => {
        let data;
        try { data = JSON.parse(raw.toString()); }
        catch { send(ws, { type: "error", error: "Geçersiz JSON." }); return; }
        if (!data || typeof data !== "object") return;

        const type = String(data.type || "");
        try {
            switch (type) {
                case "join_request": joinGame(player, data); break;
                case "presence": handlePresence(player, data); break;
                case "leave_game": leaveGame(player, "client_leave"); break;

                case "move":
                case "player_move":
                case "movement": handleMove(player, data); break;

                case "chat":
                case "chat_message": handleChat(player, data); break;

                case "needs":
                case "needs_update": handleNeeds(player, data); break;

                case "apple_pick": handleApplePick(player, data); break;
                case "apple_state_request":
                    send(player.ws, { type: "apple_states", states: worldState.apples });
                    break;

                case "drink": handleDrink(player); break;

                case "carrot_pick": handleCarrotPick(player, data); break;
                case "carrot_state_request": handleCarrotStateRequest(player, data); break;

                case "animal_states_request": handleAnimalStatesRequest(player, data); break;
                case "animal_attack": handleAnimalAttack(player, data); break;
                case "animal_care": handleAnimalCare(player, data); break;
                case "animal_attack_animal": handleAnimalBiteAnimal(player, data); break;

                case "attack_player": handleAttackPlayer(player, data); break;
                case "attack_animal": handleAnimalAttack(player, data); break;

                case "respawn": handleRespawn(player); break;

                case "weapon_attack":
                case "attack": handleWeaponAttack(player, data); break;

                case "weapon_equip":
                case "equip":
                case "equip_weapon": handleWeaponEquip(player, data); break;

                case "ping":
                    send(ws, { type: "pong", timestamp: data.timestamp, time: Date.now() });
                    break;

                case "ping_result":
                    if (typeof data.pingMs === "number") {
                        player.pingMs = data.pingMs;
                        sendPlayersUpdate();
                    }
                    break;

                default:
                    send(ws, { type: "unknown_message", messageType: type });
                    break;
            }
        } catch (err) {
            console.error(`[WS] #${player.id} mesaj hatası (${type}):`, err.message);
        }
    });

    ws.on("close", () => {
        console.log(`[WS] Ayrıldı: #${player.id}`);
        leaveGame(player, "disconnect");
        players.delete(player.id);
        sendPlayersUpdate();
    });

    ws.on("error", (err) => console.error(`[WS] #${player.id} hata:`, err.message));
});

// ============ CHAT RESET (10 dk) ============
setInterval(() => {
    worldState.chatMessages = [];
    broadcast({ type: "chat_reset" });
}, 10 * 60 * 1000);

// ============ SERVER LOOP ============
setInterval(() => {
    for (const p of players.values()) {
        if (!p.ws || p.ws.readyState !== WebSocket.OPEN) continue;
        send(p.ws, { type: "server_tick", time: Date.now() });
    }
}, 15000);

server.listen(PORT, () => {
    console.log("");
    console.log("==========================================");
    console.log("       ESEKGAMES SERVER BAŞLADI (v3)");
    console.log("==========================================");
    console.log(`Port: ${PORT}`);
    console.log(`WebSocket: aktif`);
    console.log(`Aynı hesap koruması: AKTİF`);
    console.log("==========================================");
});
