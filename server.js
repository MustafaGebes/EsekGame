// server.js
// ESEKGAMES - Eşek Game Online Server
// Node.js + Express + WebSocket
// index.html'in konuştuğu protokole göre yazıldı:
//   init, join_request(token), join_accepted{state}, players{}, move,
//   chat/chat_message/chat_history/chat_reset, pong, ping_result,
//   needs, apple_*, carrot_*, animal_*, combat_hit, player_death,
//   respawn/respawned, weapon_equip/weapon_attack/weapon_result

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
const SERVER_VERSION = "1.0.0";

// ============================================================
// DOSYALAR
// ============================================================

const ROOT = __dirname;

const DATA_DIR = path.join(ROOT, "data");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");

const MAIN_INDEX = path.join(ROOT, "index.html");
const SIMULATOR_INDEX = path.join(ROOT, "games", "eseksimulator", "index.html");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(ACCOUNTS_FILE)) {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify({ accounts: {} }, null, 2), "utf8");
}

// ============================================================
// EXPRESS
// ============================================================

app.use(express.json({ limit: "1mb" }));
app.use(express.static(ROOT));

app.get("/", (req, res) => {
    if (fs.existsSync(MAIN_INDEX)) return res.sendFile(MAIN_INDEX);
    return res.status(404).send("EsekGames ana sayfa dosyası bulunamadı: index.html");
});

app.get("/games/eseksimulator", (req, res) => {
    if (fs.existsSync(SIMULATOR_INDEX)) return res.sendFile(SIMULATOR_INDEX);
    return res.status(404).send("Eşek Simulator dosyası bulunamadı: games/eseksimulator/index.html");
});

app.get("/health", (req, res) => {
    res.json({ ok: true, players: activePlayerCount(), uptime: process.uptime() });
});

// ============================================================
// ACCOUNT SİSTEMİ (token'lı)
// ============================================================

function loadAccounts() {
    try {
        const data = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"));
        if (!data.accounts || typeof data.accounts !== "object") data.accounts = {};
        return data;
    } catch (err) {
        console.error("accounts.json okunamadı:", err);
        return { accounts: {} };
    }
}

function saveAccounts(data) {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(data, null, 2), "utf8");
}

function hashPassword(password) {
    return crypto.createHash("sha256").update(String(password)).digest("hex");
}

function makeToken() {
    return crypto.randomBytes(24).toString("hex");
}

function normalizeUsername(username) {
    return String(username || "").trim().replace(/\s+/g, " ");
}

function validUsername(username) {
    return (
        username.length >= 3 &&
        username.length <= 20 &&
        /^[a-zA-Z0-9_ğüşöçıİĞÜŞÖÇ-]+$/.test(username)
    );
}

const MIN_PASSWORD = 6;

function findAccount(username) {
    const db = loadAccounts();
    const target = String(username || "").toLowerCase();
    for (const key of Object.keys(db.accounts)) {
        if (key.toLowerCase() === target) {
            return { key, account: db.accounts[key] };
        }
    }
    return null;
}

function findAccountByToken(token) {
    if (!token) return null;
    const db = loadAccounts();
    for (const key of Object.keys(db.accounts)) {
        if (db.accounts[key].token === token) {
            return { key, account: db.accounts[key] };
        }
    }
    return null;
}

// REGISTER
app.post("/api/register", (req, res) => {
    const username = normalizeUsername(req.body.username);
    const password = String(req.body.password || "");

    if (!validUsername(username)) {
        return res.status(400).json({ ok: false, error: "Kullanıcı adı 3-20 karakter olmalı." });
    }
    if (password.length < MIN_PASSWORD) {
        return res.status(400).json({ ok: false, error: "Şifre en az 6 karakter olmalı." });
    }
    if (findAccount(username)) {
        return res.status(409).json({ ok: false, error: "Bu kullanıcı adı zaten kullanılıyor." });
    }

    const db = loadAccounts();
    const token = makeToken();

    db.accounts[username] = {
        username,
        password: hashPassword(password),
        token,
        createdAt: Date.now()
    };
    saveAccounts(db);

    return res.json({ ok: true, username, token });
});

// LOGIN
app.post("/api/login", (req, res) => {
    const username = normalizeUsername(req.body.username);
    const password = String(req.body.password || "");

    const found = findAccount(username);

    if (!found || found.account.password !== hashPassword(password)) {
        return res.status(401).json({ ok: false, error: "Kullanıcı adı veya şifre yanlış." });
    }

    const db = loadAccounts();
    const token = makeToken();
    db.accounts[found.key].token = token;
    saveAccounts(db);

    return res.json({ ok: true, username: found.account.username, token });
});

// ŞİFRE DEĞİŞTİR
app.post("/api/change-password", (req, res) => {
    const username = normalizeUsername(req.body.username);
    const oldPassword = String(req.body.oldPassword || "");
    const newPassword = String(req.body.newPassword || "");

    const found = findAccount(username);
    if (!found) return res.status(404).json({ ok: false, error: "Hesap bulunamadı." });
    if (found.account.password !== hashPassword(oldPassword)) {
        return res.status(401).json({ ok: false, error: "Mevcut şifre yanlış." });
    }
    if (newPassword.length < 4) {
        return res.status(400).json({ ok: false, error: "Yeni şifre en az 4 karakter olmalı." });
    }

    const db = loadAccounts();
    db.accounts[found.key].password = hashPassword(newPassword);
    saveAccounts(db);

    return res.json({ ok: true });
});

// KULLANICI ADI DEĞİŞTİR
app.post("/api/change-username", (req, res) => {
    const oldUsername = normalizeUsername(req.body.username);
    const newUsername = normalizeUsername(req.body.newUsername);
    const password = String(req.body.password || "");

    if (!validUsername(newUsername)) {
        return res.status(400).json({ ok: false, error: "Yeni kullanıcı adı geçersiz." });
    }

    const found = findAccount(oldUsername);
    if (!found) return res.status(404).json({ ok: false, error: "Hesap bulunamadı." });
    if (found.account.password !== hashPassword(password)) {
        return res.status(401).json({ ok: false, error: "Şifre yanlış." });
    }
    if (findAccount(newUsername)) {
        return res.status(409).json({ ok: false, error: "Bu kullanıcı adı zaten kullanılıyor." });
    }

    const db = loadAccounts();
    db.accounts[newUsername] = {
        ...db.accounts[found.key],
        username: newUsername,
        updatedAt: Date.now()
    };
    delete db.accounts[found.key];
    saveAccounts(db);

    return res.json({ ok: true, username: newUsername });
});

// ============================================================
// HUB (EsekGames sitesi) UYUMLU AUTH UÇLARI
// Hub /api/auth/* çağırır ve hataları { message } olarak okur.
// ============================================================

function authFail(res, status, message) {
    return res.status(status).json({ ok: false, message });
}

// HUB REGISTER
app.post("/api/auth/register", (req, res) => {
    const username = normalizeUsername(req.body.username);
    const password = String(req.body.password || "");
    const confirm = String(req.body.passwordConfirm || "");

    if (!validUsername(username)) {
        return authFail(res, 400, "Kullanıcı adı 3-20 karakter olmalı.");
    }
    if (password.length < MIN_PASSWORD) {
        return authFail(res, 400, "Şifre en az 6 karakter olmalı.");
    }
    if (confirm && password !== confirm) {
        return authFail(res, 400, "Şifreler aynı değil.");
    }
    if (findAccount(username)) {
        return authFail(res, 409, "Bu kullanıcı adı zaten kullanılıyor.");
    }

    const db = loadAccounts();
    const token = makeToken();

    db.accounts[username] = {
        username,
        password: hashPassword(password),
        token,
        createdAt: Date.now()
    };
    saveAccounts(db);

    return res.json({ ok: true, username, token });
});

// HUB LOGIN
app.post("/api/auth/login", (req, res) => {
    const username = normalizeUsername(req.body.username);
    const password = String(req.body.password || "");

    const found = findAccount(username);

    if (!found || found.account.password !== hashPassword(password)) {
        return authFail(res, 401, "Kullanıcı adı veya şifre yanlış.");
    }

    const db = loadAccounts();
    const token = makeToken();
    db.accounts[found.key].token = token;
    saveAccounts(db);

    return res.json({ ok: true, username: found.account.username, token });
});

// HUB AD DEĞİŞTİR: { token, username(yeni ad) }
app.post("/api/auth/change-name", (req, res) => {
    const token = String(req.body.token || "");
    const newUsername = normalizeUsername(req.body.username);

    const found = findAccountByToken(token);
    if (!found) return authFail(res, 401, "Oturum bulunamadı, tekrar giriş yap.");

    if (!validUsername(newUsername)) {
        return authFail(res, 400, "Kullanıcı adı 3-20 karakter olmalı.");
    }
    if (newUsername.toLowerCase() === found.account.username.toLowerCase()) {
        return res.json({ ok: true, username: found.account.username, token });
    }
    if (findAccount(newUsername)) {
        return authFail(res, 409, "Bu kullanıcı adı zaten kullanılıyor.");
    }

    const db = loadAccounts();
    db.accounts[newUsername] = {
        ...db.accounts[found.key],
        username: newUsername,
        updatedAt: Date.now()
    };
    delete db.accounts[found.key];
    saveAccounts(db);

    return res.json({ ok: true, username: newUsername, token });
});

// HUB ŞİFRE DEĞİŞTİR: { token, oldPassword, newPassword, newPasswordConfirm }
app.post("/api/auth/change-password", (req, res) => {
    const token = String(req.body.token || "");
    const oldPassword = String(req.body.oldPassword || "");
    const newPassword = String(req.body.newPassword || "");
    const confirm = String(req.body.newPasswordConfirm || "");

    const found = findAccountByToken(token);
    if (!found) return authFail(res, 401, "Oturum bulunamadı, tekrar giriş yap.");

    if (found.account.password !== hashPassword(oldPassword)) {
        return authFail(res, 401, "Mevcut şifre yanlış.");
    }
    if (newPassword.length < MIN_PASSWORD) {
        return authFail(res, 400, "Yeni şifre en az 6 karakter olmalı.");
    }
    if (confirm && newPassword !== confirm) {
        return authFail(res, 400, "Yeni şifreler aynı değil.");
    }

    const db = loadAccounts();
    db.accounts[found.key].password = hashPassword(newPassword);
    saveAccounts(db);

    return res.json({ ok: true, username: found.account.username, token });
});

// HUB SURUM KONTROLÜ
app.get("/api/version", (req, res) => {
    res.json({ ok: true, version: SERVER_VERSION });
});

// ============================================================
// OYUN SABİTLERİ
// ============================================================

const MAX_NEED = 9;
const SPAWN = { x: 151.2, y: 0.28, z: 211.2 }; // Çiftlik girişi (istemcideki barnSpawn)

const APPLE_MAX = 4;
const APPLE_RESPAWN_MS = 45000;

const CARROT_RESPAWN_MS = 5 * 60 * 1000; // istemcideki CARROT_RESPAWN_MS ile aynı

const FIST_DAMAGE = 1.5;
const SWORD_DAMAGE = 3;
const GUN_DAMAGE = 4;
const ANIMAL_ATTACK_DAMAGE = 3;
const ANIMAL_BITE_DAMAGE = 1;

const GUN_MAGAZINE = 12;
const SUPPLY_STATION = { x: 165, z: 268 };
const SUPPLY_STATION_RANGE = 12;
const ARMOR_PICKUP_COOLDOWN_MS = 60000;
const BERRY_RESPAWN_MS = 90000;
const CAVE_BEAR_CENTER = { x: 423, z: 45 };
const CAVE_BEAR_ATTACK_RADIUS = 50;
const CAVE_BEAR_DAMAGE = 2;
const CAMP_SITE = { x: 245, z: -205 };
const CAMPFIRE_RANGE = 10;
const CAMPFIRE_INTERACT_RANGE = 8;
const HUNTER_MAX_HEALTH = 12;
const HUNTER_RESPAWN_MS = 5 * 60 * 1000;
const HUNTER_SHOT_RANGE = 34;
const HUNTER_SHOT_INTERVAL_MS = 3000;
const HUNTER_SHOT_DAMAGE = 1;
const HUNTER_SPAWNS = [
    { id: 'camp-hunter-1', x: 235, z: -205 },
    { id: 'camp-hunter-2', x: 255, z: -205 },
    { id: 'camp-hunter-3', x: 245, z: -193 }
];
let campfireLit = false;

function berryMulberry32(seed){return function(){let t=seed+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
function makeBerryBushSpots(){
    const rand=berryMulberry32(0xB37D5EED),spots=[];
    for(let attempt=0;attempt<12000&&spots.length<30;attempt++){
        const a=rand()*Math.PI*2,r=62+rand()*92,x=255+Math.cos(a)*r,z=35+Math.sin(a)*r;
        if(x<215||x>450||z<-105||z>205)continue;
        if(Math.hypot((x-330)/31,(z-100)/25)<1.20)continue;
        if(Math.hypot(x-423,z-45)<48)continue;
        if(Math.hypot(x-300,z+8)<22)continue;
        if(spots.some(q=>Math.hypot(q.x-x,q.z-z)<9))continue;
        spots.push({id:`berry-bush-${spots.length}`,x,z});
    }
    return spots;
}
const BERRY_BUSH_SPOTS=makeBerryBushSpots();
const berryBushStates=new Map();

const CHAT_RESET_MS = 10 * 60 * 1000; // 10 dakika
const CHAT_HISTORY_LIMIT = 100;

// ============================================================
// OYUNCULAR
// ============================================================

const players = new Map(); // id (string) -> player
let nextPlayerId = 1;

function createPlayer(ws) {
    const id = "p" + nextPlayerId++;

    const player = {
        id,
        ws,

        name: null,
        isAccount: false,
        guestNumber: null,

        inGame: false,
        platform: "pc",
        pingMs: null,

        x: SPAWN.x,
        y: SPAWN.y,
        z: SPAWN.z,
        yaw: 0,
        pitch: 0,

        isMoving: false,
        isJumping: false,
        isCrouching: false,

        health: MAX_NEED,
        hunger: MAX_NEED,
        thirst: MAX_NEED,
        armor: 0,
        alive: true,

        weapon: "none",
        ammo: GUN_MAGAZINE,
        nextArmorPickupAt: 0,
        nextBearBiteAt: 0,
        lastDamageAt: Date.now(),

        connectedAt: Date.now()
    };

    players.set(id, player);
    return player;
}

function activePlayerCount() {
    let count = 0;
    for (const p of players.values()) if (p.inGame) count++;
    return count;
}

// ============================================================
// DÜNYA DURUMU (elma / havuç / hayvan)
// ============================================================

const apples = new Map();   // treeId -> count
const carrots = new Map();  // carrotId -> { available, respawnAt }
const animals = new Map();  // animalId -> { health, hunger, thirst, alive }
const hunters = new Map(HUNTER_SPAWNS.map(h => [h.id, {
    health: HUNTER_MAX_HEALTH, alive: true, respawnAt: 0, nextShotAt: 0
}]));

function getAppleCount(treeId) {
    if (!apples.has(treeId)) apples.set(treeId, APPLE_MAX);
    return apples.get(treeId);
}

function getCarrot(carrotId) {
    if (!carrots.has(carrotId)) carrots.set(carrotId, { available: true, respawnAt: 0 });
    return carrots.get(carrotId);
}

function getBerryBush(berryId) {
    if (!berryBushStates.has(berryId)) berryBushStates.set(berryId, { available: true, respawnAt: 0 });
    return berryBushStates.get(berryId);
}

function getAnimal(animalId) {
    if (!animals.has(animalId)) {
        animals.set(animalId, { health: MAX_NEED, hunger: MAX_NEED, thirst: MAX_NEED, alive: true });
    }
    return animals.get(animalId);
}

// ============================================================
// SOHBET GEÇMİŞİ
// ============================================================

let chatHistory = [];

// ============================================================
// WEBSOCKET YARDIMCILARI
// ============================================================

function send(ws, data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
        ws.send(JSON.stringify(data));
    } catch (err) {
        console.error("WS gönderme hatası:", err.message);
    }
}

function sendTo(player, data) {
    send(player.ws, data);
}

function broadcast(data) {
    for (const p of players.values()) {
        if (!p.inGame) continue;
        send(p.ws, data);
    }
}

function broadcastExcept(data, exceptId) {
    for (const p of players.values()) {
        if (!p.inGame || p.id === exceptId) continue;
        send(p.ws, data);
    }
}

function getPublicPlayer(p) {
    return {
        inGame: p.inGame,
        name: p.name,
        platform: p.platform,
        pingMs: p.pingMs,
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: p.yaw,
        pitch: p.pitch,
        isMoving: p.isMoving,
        isJumping: p.isJumping,
        isCrouching: p.isCrouching,
        health: p.health,
        armor: p.armor,
        alive: p.alive
    };
}

function broadcastPlayers() {
    const obj = {};
    let count = 0;
    for (const p of players.values()) {
        if (!p.inGame) continue;
        obj[p.id] = getPublicPlayer(p);
        count++;
    }
    broadcast({ type: "players", players: obj, count });
}

function broadcastOnlineCount() {
    const count = activePlayerCount();
    for (const p of players.values()) sendTo(p, { type: "online_count", count });
}

function sendNeeds(player) {
    sendTo(player, {
        type: "needs",
        health: player.health,
        armor: player.armor,
        hunger: player.hunger,
        thirst: player.thirst,
        alive: player.alive
    });
}

function clampNeed(v) {
    return Math.max(0, Math.min(MAX_NEED, Number(v) || 0));
}

// ============================================================
// GUEST İSİM
// ============================================================

function guestName(number) {
    return "Guest-" + String(number).padStart(3, "0");
}

function isNameUsed(name, exceptId = null) {
    for (const p of players.values()) {
        if (p.inGame && p.id !== exceptId && p.name === name) return true;
    }
    return false;
}

function allocateGuestName() {
    let number = 0;
    while (isNameUsed(guestName(number))) number++;
    return guestName(number);
}

// ============================================================
// JOIN / LEAVE
// ============================================================

function joinGame(player, data) {
    const token = String((data && data.token) || "");
    const platform = data && data.platform === "mobile" ? "mobile" : "pc";

    let name = null;
    let isAccount = false;

    const found = findAccountByToken(token);
    if (found) {
        name = found.account.username;
        isAccount = true;
    }

    if (name && isNameUsed(name, player.id)) {
        sendTo(player, {
            type: "join_denied",
            message: "Bu oyuncu adı şu an kullanılıyor. Başka bir cihazda açık kalmış olabilir."
        });
        return;
    }

    if (!name) {
        name = allocateGuestName();
        isAccount = false;
    }

    player.name = name;
    player.isAccount = isAccount;
    player.platform = platform;
    player.inGame = true;
    player.alive = true;

    player.health = MAX_NEED;
    player.hunger = MAX_NEED;
    player.thirst = MAX_NEED;
    player.armor = 0;
    player.lastDamageAt = Date.now();

    player.x = SPAWN.x;
    player.y = SPAWN.y;
    player.z = SPAWN.z;
    player.yaw = 0;
    player.pitch = 0;

    player.weapon = "none";
    player.ammo = GUN_MAGAZINE;
    player.nextBearBiteAt = 0;
    sendTo(player, {
        type: "join_accepted",
        state: {
            name: player.name,
            health: player.health,
            hunger: player.hunger,
            thirst: player.thirst,
            armor: player.armor
        }
    });

    sendTo(player, { type: "chat_history", messages: chatHistory.slice(-CHAT_HISTORY_LIMIT) });

    broadcastPlayers();
    broadcastOnlineCount();
}

function leaveGame(player) {
    if (!player.inGame) return;
    player.inGame = false;
    player.name = null;
    player.isAccount = false;
    broadcastPlayers();
    broadcastOnlineCount();
}

// ============================================================
// HASAR / ÖLÜM
// ============================================================

function applyPlayerDamage(target, amount) {
    const damage = Math.max(0, Number(amount) || 0);
    if (damage <= 0) return;
    target.lastDamageAt = Date.now();
    const armor = clampNeed(target.armor);
    if (armor > 0) {
        // Kalkan hasarı önce kendi dayanıklılığından karşılar; kalan hasar %50 azaltılarak cana gider.
        const absorbed = Math.min(armor, damage);
        const overflow = damage - absorbed;
        target.armor = clampNeed(armor - absorbed);
        target.health = clampNeed(target.health - overflow * 0.5);
    } else {
        target.health = clampNeed(target.health - damage);
    }
}
function damagePlayer(target, amount, attackerId, killerName, reason) {
    if (!target.inGame || !target.alive) return;

    applyPlayerDamage(target, amount);

    broadcast({
        type: "combat_hit",
        attackerId: attackerId || null,
        targetId: target.id,
        health: target.health,
        armor: target.armor
    });

    sendNeeds(target);

    if (target.health <= 0) {
        target.alive = false;

        broadcast({
            type: "player_death",
            id: target.id,
            reason: reason || (killerName ? `${killerName} seni yendi.` : "Canın tükendi."),
            killerName: killerName || null
        });

        broadcastPlayers();
    }
}

function damageAnimal(animalId, amount) {
    const animal = getAnimal(animalId);
    if (!animal.alive) return;

    animal.health = clampNeed(animal.health - amount);
    if (animal.health <= 0) animal.alive = false;

    broadcast({
        type: "animal_state",
        id: animalId,
        health: animal.health,
        hunger: animal.hunger,
        thirst: animal.thirst,
        alive: animal.alive
    });
}

// ============================================================
// MESAJ İŞLEYİCİLER
// ============================================================

function handleMove(player, data) {
    if (!player.inGame) return;

    if (typeof data.x === "number") player.x = data.x;
    if (typeof data.y === "number") player.y = data.y;
    if (typeof data.z === "number") player.z = data.z;
    if (typeof data.yaw === "number") player.yaw = data.yaw;
    if (typeof data.pitch === "number") player.pitch = data.pitch;

    player.isMoving = !!data.isMoving;
    player.isJumping = !!data.isJumping;
    player.isCrouching = !!data.isCrouching;

    if (data.platform === "mobile" || data.platform === "pc") player.platform = data.platform;
    if (Number.isFinite(Number(data.pingMs))) player.pingMs = Number(data.pingMs);
}

function handlePresence(player, data) {
    if (!data) return;

    if (data.platform === "mobile" || data.platform === "pc") player.platform = data.platform;

    if (data.active) {
        if (player.inGame) broadcastPlayers();
        return;
    }

    leaveGame(player);
}

function handleChat(player, data) {
    if (!player.inGame) return;

    let text = String(data.text || "").trim();
    if (!text) return;
    if (text.length > 220) text = text.slice(0, 220);

    const clientId = String(data.clientId || "");
    const time = new Date().toISOString();

    // Fısıltı: /msg isim mesaj
    const whisper =
        text.match(/^\/msg\s+(\S+)\s+"([\s\S]{1,220})"\s*$/i) ||
        text.match(/^\/msg\s+(\S+)\s+([\s\S]{1,220})$/i);

    if (whisper) {
        const toName = whisper[1];
        const whisperText = whisper[2];

        let target = null;
        for (const p of players.values()) {
            if (p.inGame && p.name && p.name.toLowerCase() === toName.toLowerCase()) {
                target = p;
                break;
            }
        }

        if (!target) {
            sendTo(player, { type: "chat_error", message: `"${toName}" adında bir oyuncu bulunamadı.` });
            return;
        }

        const message = {
            name: player.name,
            toName: target.name,
            text: whisperText,
            time,
            clientId,
            private: true
        };

        sendTo(target, { type: "chat_message", message });
        sendTo(player, { type: "chat_message", message });
        return;
    }

    const message = { name: player.name, text, time, clientId };

    chatHistory.push(message);
    if (chatHistory.length > CHAT_HISTORY_LIMIT) {
        chatHistory = chatHistory.slice(-CHAT_HISTORY_LIMIT);
    }

    broadcast({ type: "chat_message", message });
}

function handleAppleStateRequest(player, data) {
    const trees = (data && data.trees) || [];
    const states = {};

    for (const tree of trees) {
        const id = String(tree.id || "");
        if (!id) continue;
        states[id] = getAppleCount(id);
    }

    sendTo(player, { type: "apple_states", states });
}

function handleApplePick(player, data) {
    if (!player.inGame || !player.alive) return;

    const treeId = String((data && data.treeId) || "");
    if (!treeId) return;
    if (player.hunger >= MAX_NEED) {
        sendTo(player, { type: "apple_pick_result", ok: false, message: "Karnın zaten tok, daha fazla elma yiyemezsin." });
        return;
    }
    const count = getAppleCount(treeId);

    if (count <= 0) {
        sendTo(player, { type: "apple_pick_result", ok: false, message: "Bu ağaçta elma kalmamış." });
        return;
    }

    apples.set(treeId, count - 1);

    player.hunger = clampNeed(player.hunger + 1.5);
    sendNeeds(player);

    sendTo(player, {
        type: "apple_pick_result",
        ok: true,
        health: player.health,
        hunger: player.hunger,
        thirst: player.thirst
    });

    broadcast({ type: "apple_update", treeId, apples: apples.get(treeId) });
}

function handleDrink(player) {
    if (!player.inGame || !player.alive) return;

    if (player.thirst >= MAX_NEED) {
        sendTo(player, { type: "action_denied", action: "drink", message: "Susuzluğun zaten dolu, daha fazla su içemezsin." });
        return;
    }
    player.thirst = clampNeed(player.thirst + 2);
    sendNeeds(player);

    sendTo(player, {
        type: "action_ok",
        action: "drink",
        health: player.health,
        hunger: player.hunger,
        thirst: player.thirst
    });
}

function handleCarrotStateRequest(player, data) {
    const list = (data && data.carrots) || [];
    const states = {};

    for (const c of list) {
        const id = String(c.id || "");
        if (!id) continue;
        states[id] = getCarrot(id).available;
    }

    sendTo(player, { type: "carrot_states", states });
}

function handleCarrotPick(player, data) {
    if (!player.inGame || !player.alive) return;

    const carrotId = String((data && data.carrotId) || "");
    if (!carrotId) return;
    if (player.hunger >= MAX_NEED) {
        sendTo(player, { type: "carrot_pick_result", carrotId, ok: false, message: "Karnın zaten tok, havucu şimdi alamazsın." });
        return;
    }
    const carrot = getCarrot(carrotId);

    if (!carrot.available) {
        sendTo(player, { type: "carrot_pick_result", carrotId, ok: false });
        return;
    }

    carrot.available = false;
    carrot.respawnAt = Date.now() + CARROT_RESPAWN_MS;

    player.hunger = clampNeed(player.hunger + 2);
    sendNeeds(player);
    sendTo(player, { type: "carrot_pick_result", carrotId, ok: true, health: player.health, hunger: player.hunger, thirst: player.thirst });
    broadcast({ type: "carrot_update", carrotId, available: false });
}

function handleBerryStateRequest(player) {
    const states={};
    for(const spot of BERRY_BUSH_SPOTS){const state=getBerryBush(spot.id);states[spot.id]={available:state.available,respawnAt:state.respawnAt};}
    sendTo(player,{type:"berry_states",states});
}
function handleBerryPick(player,data) {
    if(!player.inGame||!player.alive)return;
    const berryId=String((data&&data.berryId)||""),spot=BERRY_BUSH_SPOTS.find(x=>x.id===berryId);
    if(!spot){sendTo(player,{type:"berry_pick_result",berryId,ok:false,message:"Bu dut çalısı bulunamadı."});return;}
    if(Math.hypot(player.x-spot.x,player.z-spot.z)>6.5){sendTo(player,{type:"berry_pick_result",berryId,ok:false,message:"Dut çalısına yaklaş."});return;}
    if(player.hunger>=MAX_NEED){sendTo(player,{type:"berry_pick_result",berryId,ok:false,message:"Karnın zaten tok; dut yiyemezsin."});return;}
    const state=getBerryBush(berryId);
    if(!state.available){sendTo(player,{type:"berry_pick_result",berryId,ok:false,message:"Bu çalıdaki dutlar henüz yetişmedi."});return;}
    state.available=false;state.respawnAt=Date.now()+BERRY_RESPAWN_MS;
    player.hunger=clampNeed(player.hunger+1.5);sendNeeds(player);
    sendTo(player,{type:"berry_pick_result",berryId,ok:true,health:player.health,hunger:player.hunger,thirst:player.thirst});
    broadcast({type:"berry_update",berryId,available:false,respawnAt:state.respawnAt});
    setTimeout(()=>{if(state.respawnAt&&Date.now()>=state.respawnAt){state.available=true;state.respawnAt=0;broadcast({type:"berry_update",berryId,available:true,respawnAt:0});}},BERRY_RESPAWN_MS+25);
}

function handleAnimalStatesRequest(player, data) {
    const ids = (data && data.ids) || [];
    const states = {};

    for (const rawId of ids) {
        const id = String(rawId || "");
        if (!id) continue;
        const a = getAnimal(id);
        states[id] = { health: a.health, hunger: a.hunger, thirst: a.thirst, alive: a.alive };
    }

    sendTo(player, { type: "animal_states", states });
}

function handleAnimalCare(player, data) {
    if (!player.inGame || !player.alive) return;

    const animalId = String((data && data.animalId) || "");
    if (!animalId) return;

    const animal = getAnimal(animalId);
    if (!animal.alive) return;

    const action = String((data && data.action) || "");

    if (action === "feed") animal.hunger = clampNeed(animal.hunger + 2);
    else if (action === "water" || action === "drink") animal.thirst = clampNeed(animal.thirst + 2);
    else if (action === "heal") animal.health = clampNeed(animal.health + 1);

    broadcast({
        type: "animal_state",
        id: animalId,
        health: animal.health,
        hunger: animal.hunger,
        thirst: animal.thirst,
        alive: animal.alive,
        care: action
    });
}

function handleAttackAnimal(player, data) {
    if (!player.inGame || !player.alive) return;

    const animalId = String((data && data.animalId) || "");
    if (!animalId) return;

    damageAnimal(animalId, ANIMAL_ATTACK_DAMAGE);
}

function handleAnimalAttack(player, data) {
    if (!player.inGame || !player.alive) return;

    // Vahşi hayvan saldırdı: yakındaki oyuncuyu ısır.
    const x = Number(data && data.x);
    const z = Number(data && data.z);

    if (!Number.isFinite(x) || !Number.isFinite(z)) return;

    for (const p of players.values()) {
        if (!p.inGame || !p.alive) continue;

        const d = Math.hypot(p.x - x, p.z - z);
        if (d <= 4.5) {
            applyPlayerDamage(p, ANIMAL_BITE_DAMAGE);

            sendTo(p, {
                type: "animal_bite",
                targetId: p.id,
                animalId: String((data && data.animalId) || ""),
                health: p.health,
                armor: p.armor
            });

            sendNeeds(p);

            if (p.health <= 0) {
                p.alive = false;
                broadcast({ type: "player_death", id: p.id, reason: "Vahşi bir hayvan seni alt etti.", killerName: null });
                broadcastPlayers();
            }
            break;
        }
    }
}

function handleAttackPlayer(player, data) {
    if (!player.inGame || !player.alive) return;

    const targetId = String((data && data.targetId) || "");
    const target = players.get(targetId);

    if (!target || !target.inGame || !target.alive) return;

    damagePlayer(target, FIST_DAMAGE, player.id, player.name);
}

function isNearSupplyStation(player) {
    return Math.hypot(player.x - SUPPLY_STATION.x, player.z - SUPPLY_STATION.z) <= SUPPLY_STATION_RANGE;
}
function handleAmmoPick(player) {
    if (!player.inGame || !player.alive) return;
    if (!isNearSupplyStation(player)) {
        sendTo(player, { type: "ammo_pick_result", ok: false, ammo: player.ammo, message: "Mermi almak için çiftlikteki istasyona yaklaş." });
        return;
    }
    if (player.weapon !== "gun") {
        sendTo(player, { type: "ammo_pick_result", ok: false, ammo: player.ammo, message: "Mermi almak için tabancayı kuşan." });
        return;
    }
    if (player.ammo >= GUN_MAGAZINE) {
        sendTo(player, { type: "ammo_pick_result", ok: false, ammo: player.ammo, message: "Şarjörün zaten dolu. Mermi kutusunun stoğu sınırsız." });
        return;
    }
    player.ammo = GUN_MAGAZINE;
    sendTo(player, { type: "ammo_pick_result", ok: true, ammo: player.ammo, magazine: GUN_MAGAZINE, message: "12 mermi yüklendi; kutunun stoğu sınırsız." });
}
function handleArmorPick(player) {
    if (!player.inGame || !player.alive) return;
    if (!isNearSupplyStation(player)) {
        sendTo(player, { type: "armor_pick_result", ok: false, armor: player.armor, message: "Zırh almak için çiftlikteki istasyona yaklaş." });
        return;
    }
    if (player.armor >= MAX_NEED) {
        sendTo(player, { type: "armor_pick_result", ok: false, armor: player.armor, message: "Zırhın zaten dolu." });
        return;
    }
    const now = Date.now();
    if (now < player.nextArmorPickupAt) {
        sendTo(player, { type: "armor_pick_result", ok: false, armor: player.armor, message: `Zırh istasyonu ${Math.ceil((player.nextArmorPickupAt - now) / 1000)} sn sonra hazır.` });
        return;
    }
    player.armor = MAX_NEED;
    player.nextArmorPickupAt = now + ARMOR_PICKUP_COOLDOWN_MS;
    sendNeeds(player);
    sendTo(player, { type: "armor_pick_result", ok: true, armor: player.armor, health: player.health, hunger: player.hunger, thirst: player.thirst, respawnMs: ARMOR_PICKUP_COOLDOWN_MS });
}
function handleBearAttack(player,data) {
    if(!player.inGame||!player.alive)return;
    const bearId=String((data&&data.bearId)||"");
    if(!/^cave-bear-[1-3]$/.test(bearId))return;
    if(Math.hypot(player.x-CAVE_BEAR_CENTER.x,player.z-CAVE_BEAR_CENTER.z)>CAVE_BEAR_ATTACK_RADIUS)return;
    const now=Date.now();if(now<(player.nextBearBiteAt||0))return;
    player.nextBearBiteAt=now+1250;
    damagePlayer(player,CAVE_BEAR_DAMAGE,null,null,"Mağaradaki ayı seni ısırdı.");
}
function hunterPublicState(id, state) {
    return { id, health: state.health, alive: state.alive, respawnAt: state.respawnAt || 0 };
}
function handleHunterStateRequest(player) {
    if (!player.inGame) return;
    const states = {};
    for (const [id, state] of hunters) states[id] = hunterPublicState(id, state);
    sendTo(player, { type: "hunter_states", states, campfireLit });
}
function damageHunter(player, hunterId, amount, weapon) {
    const spawn = HUNTER_SPAWNS.find(h => h.id === hunterId);
    const state = hunters.get(hunterId);
    if (!spawn || !state || !state.alive || !player.inGame || !player.alive) return false;
    const limit = weapon === "gun" ? 42 : weapon === "sword" ? 10.5 : 7.5;
    if (Math.hypot(player.x - spawn.x, player.z - spawn.z) > limit) return false;
    state.health = Math.max(0, state.health - amount);
    if (state.health <= 0) {
        state.alive = false;
        state.respawnAt = Date.now() + HUNTER_RESPAWN_MS;
    }
    broadcast({ type: "hunter_state", ...hunterPublicState(hunterId, state) });
    return true;
}
function handleAttackHunter(player, data) {
    if (!player.inGame || !player.alive || player.weapon !== "none") return;
    const hunterId = String((data && data.hunterId) || "");
    damageHunter(player, hunterId, FIST_DAMAGE, "fist");
}
function handleCampfireToggle(player) {
    if (!player.inGame || !player.alive) return;
    if (Math.hypot(player.x - CAMP_SITE.x, player.z - CAMP_SITE.z) > CAMPFIRE_RANGE) {
        sendTo(player, { type: "action_denied", message: "Kamp ateşi için kamp alanına yaklaş." });
        return;
    }
    campfireLit = !campfireLit;
    broadcast({ type: "campfire_state", lit: campfireLit });
}

function handleWeaponEquip(player, data) {
    if (!player.inGame) return;
    const weapon = String((data && data.weapon) || "none");
    if (weapon === "gun") {
        player.weapon = "gun";
        player.ammo = Math.max(0, Math.min(GUN_MAGAZINE, Number(player.ammo) || 0));
    } else if (weapon === "sword") {
        player.weapon = "sword";
    } else {
        player.weapon = "none";
    }
    sendTo(player, { type: "weapon_equipped", weapon: player.weapon, ammo: player.ammo, magazine: GUN_MAGAZINE });
}

function handleWeaponAttack(player, data) {
    if (!player.inGame || !player.alive) return;

    const weapon = String((data && data.weapon) || "");

    if (weapon === "gun") {
        if (player.weapon !== "gun") {
            sendTo(player, { type: "weapon_result", ok: false, message: "Elinde silah yok.", ammo: player.ammo, magazine: GUN_MAGAZINE });
            return;
        }
        if (player.ammo <= 0) {
            sendTo(player, { type: "weapon_result", ok: false, message: "Mermi bitti. Çiftlikteki kutudan 12 mermi al.", ammo: 0, magazine: GUN_MAGAZINE });
            return;
        }
        player.ammo = Math.max(0, player.ammo - 1);
        sendTo(player, { type: "weapon_result", ok: true, ammo: player.ammo, magazine: GUN_MAGAZINE });
        const targetId = data.targetId ? String(data.targetId) : null;
        const targetAnimalId = data.targetAnimalId ? String(data.targetAnimalId) : null;
        const targetHunterId = data.targetHunterId ? String(data.targetHunterId) : null;
        if (targetId) {
            const target = players.get(targetId);
            if (target && target.inGame && target.alive) damagePlayer(target, GUN_DAMAGE, player.id, player.name);
        } else if (targetAnimalId) {
            damageAnimal(targetAnimalId, GUN_DAMAGE);
        } else if (targetHunterId) {
            damageHunter(player, targetHunterId, GUN_DAMAGE, "gun");
        }
        return;
    }

    if (weapon === "sword") {
        if (player.weapon !== "sword") {
            sendTo(player, { type: "weapon_result", ok: false, message: "Elinde kılıç yok.", ammo: player.ammo });
            return;
        }

        const targetId = data.targetId ? String(data.targetId) : null;
        const targetAnimalId = data.targetAnimalId ? String(data.targetAnimalId) : null;
        const targetHunterId = data.targetHunterId ? String(data.targetHunterId) : null;

        if (targetId) {
            const target = players.get(targetId);
            if (target && target.inGame && target.alive) {
                damagePlayer(target, SWORD_DAMAGE, player.id, player.name);
            }
        } else if (targetAnimalId) {
            damageAnimal(targetAnimalId, SWORD_DAMAGE);
        } else if (targetHunterId) {
            damageHunter(player, targetHunterId, SWORD_DAMAGE, "sword");
        }
        return;
    }

    sendTo(player, { type: "weapon_result", ok: false, message: "Geçersiz silah.", ammo: player.ammo });
}

function handleRespawn(player) {
    if (!player.inGame) return;

    player.alive = true;
    player.health = MAX_NEED;
    player.hunger = MAX_NEED;
    player.thirst = MAX_NEED;
    player.armor = 0;
    player.lastDamageAt = Date.now();

    player.x = SPAWN.x;
    player.y = SPAWN.y;
    player.z = SPAWN.z;

    sendTo(player, {
        type: "respawned",
        spawn: { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z },
        state: { health: player.health, armor: player.armor, hunger: player.hunger, thirst: player.thirst }
    });

    broadcastPlayers();
}

// ============================================================
// WEBSOCKET BAĞLANTISI
// ============================================================

wss.on("connection", (ws, req) => {
    const player = createPlayer(ws);

    console.log(`[WS] Bağlandı: ${player.id} ${req.socket.remoteAddress || ""}`);

    sendTo(player, { type: "init", id: player.id });
    broadcastOnlineCount();

    ws.on("message", (raw) => {
        let data;

        try {
            data = JSON.parse(raw.toString());
        } catch (err) {
            return;
        }

        if (!data || typeof data !== "object") return;

        const type = String(data.type || "");

        switch (type) {
            case "join_request":
                joinGame(player, data);
                break;

            case "presence":
                handlePresence(player, data);
                break;

            case "move":
                handleMove(player, data);
                break;

            case "chat":
                handleChat(player, data);
                break;

            case "ping":
                sendTo(player, { type: "pong", timestamp: data.timestamp });
                break;

            case "ping_result":
                if (Number.isFinite(Number(data.pingMs))) player.pingMs = Number(data.pingMs);
                break;

            case "apple_state_request":
                handleAppleStateRequest(player, data);
                break;

            case "apple_pick":
                handleApplePick(player, data);
                break;

            case "drink":
                handleDrink(player);
                break;

            case "carrot_state_request":
                handleCarrotStateRequest(player, data);
                break;

            case "carrot_pick":
                handleCarrotPick(player, data);
                break;

            case "berry_state_request":
                handleBerryStateRequest(player);
                break;

            case "berry_pick":
                handleBerryPick(player, data);
                break;

            case "animal_states_request":
                handleAnimalStatesRequest(player, data);
                break;

            case "animal_care":
                handleAnimalCare(player, data);
                break;

            case "attack_animal":
                handleAttackAnimal(player, data);
                break;

            case "animal_attack":
                handleAnimalAttack(player, data);
                break;

            case "bear_attack":
                handleBearAttack(player, data);
                break;

            case "hunter_state_request":
                handleHunterStateRequest(player);
                break;

            case "attack_hunter":
                handleAttackHunter(player, data);
                break;

            case "campfire_state_request":
                if (player.inGame) sendTo(player, { type: "campfire_state", lit: campfireLit });
                break;

            case "campfire_toggle":
                handleCampfireToggle(player);
                break;

            case "attack_player":
                handleAttackPlayer(player, data);
                break;

            case "weapon_equip":
                handleWeaponEquip(player, data);
                break;

            case "weapon_attack":
                handleWeaponAttack(player, data);
                break;
            case "ammo_pick":
                handleAmmoPick(player);
                break;
            case "armor_pick":
                handleArmorPick(player);
                break;

            case "respawn":
                handleRespawn(player);
                break;

            default:
                break;
        }
    });

    ws.on("close", () => {
        console.log(`[WS] Ayrıldı: ${player.id}`);
        leaveGame(player);
        players.delete(player.id);
        broadcastPlayers();
        broadcastOnlineCount();
    });

    ws.on("error", (err) => {
        console.error(`[WS] ${player.id} hata:`, err.message);
    });
});

// ============================================================
// SUNUCU DÖNGÜLERİ
// ============================================================

// Pozisyon yayını (~150ms)
setInterval(() => {
    if (activePlayerCount() > 0) broadcastPlayers();
}, 150);

// Avcıların mermi animasyonu/hasarı ve öldükten 5 dakika sonra yeniden doğması.
setInterval(() => {
    const now = Date.now();
    for (const [id, state] of hunters) {
        if (!state.alive && state.respawnAt && now >= state.respawnAt) {
            state.alive = true;
            state.health = HUNTER_MAX_HEALTH;
            state.respawnAt = 0;
            state.nextShotAt = now + 1500;
            broadcast({ type: "hunter_state", ...hunterPublicState(id, state) });
        }
        if (!state.alive || now < state.nextShotAt) continue;
        const spawn = HUNTER_SPAWNS.find(h => h.id === id);
        if (!spawn) continue;
        let target = null;
        let bestDistance = HUNTER_SHOT_RANGE;
        for (const p of players.values()) {
            if (!p.inGame || !p.alive) continue;
            const d = Math.hypot(p.x - spawn.x, p.z - spawn.z);
            if (d < bestDistance) { bestDistance = d; target = p; }
        }
        if (!target) continue;
        state.nextShotAt = now + HUNTER_SHOT_INTERVAL_MS;
        broadcast({ type: "hunter_shot", hunterId: id, targetId: target.id, x: target.x, y: target.y, z: target.z });
        damagePlayer(target, HUNTER_SHOT_DAMAGE, null, "Kamp avcısı", "Kamp avcısı tüfeğiyle sana ateş etti.");
    }
}, 400);

// İhtiyaç azalması ve hasar kesildikten sonra sağlık yenilenmesi (2 sn'de bir).
setInterval(() => {
    const now = Date.now();
    for (const p of players.values()) {
        if (!p.inGame || !p.alive) continue;
        const regenerating = p.health < MAX_NEED && now - (p.lastDamageAt || 0) >= 5000 && p.hunger > 0 && p.thirst > 0;
        const needDrain = regenerating ? 0.06 : 0.03;
        p.hunger = clampNeed(p.hunger - needDrain);
        p.thirst = clampNeed(p.thirst - (regenerating ? 0.08 : 0.04));
        if (regenerating) p.health = clampNeed(p.health + 0.5);
        if (p.hunger <= 0 || p.thirst <= 0) {
            p.health = clampNeed(p.health - 0.1);
            p.lastDamageAt = now;
            if (p.health <= 0) {
                p.alive = false;
                sendTo(p, {
                    type: "needs",
                    health: 0,
                    armor: p.armor,
                    hunger: p.hunger,
                    thirst: p.thirst,
                    alive: false
                });
                broadcast({ type: "player_death", id: p.id, reason: "Açlık/susuzluk canını tüketti.", killerName: null });
                broadcastPlayers();
                continue;
            }
        }
        sendNeeds(p);
    }
}, 2000);
// Elma yenilenmesi
setInterval(() => {
    for (const [treeId, count] of apples.entries()) {
        if (count < APPLE_MAX) {
            apples.set(treeId, count + 1);
            broadcast({ type: "apple_update", treeId, apples: count + 1 });
        }
    }
}, APPLE_RESPAWN_MS);

// Havuç yenilenmesi
setInterval(() => {
    const now = Date.now();
    for (const [carrotId, carrot] of carrots.entries()) {
        if (!carrot.available && carrot.respawnAt && now >= carrot.respawnAt) {
            carrot.available = true;
            carrot.respawnAt = 0;
            broadcast({ type: "carrot_update", carrotId, available: true });
        }
    }
}, 5000);

// Sohbet 10 dakikada bir temizlenir
setInterval(() => {
    chatHistory = [];
    broadcast({ type: "chat_reset" });
}, CHAT_RESET_MS);

// Kopuk bağlantı temizliği
setInterval(() => {
    for (const p of players.values()) {
        if (p.ws.readyState !== WebSocket.OPEN && p.ws.readyState !== WebSocket.CONNECTING) {
            leaveGame(p);
            players.delete(p.id);
        }
    }
}, 30000);

// ============================================================
// SERVER
// ============================================================

server.listen(PORT, () => {
    console.log("");
    console.log("==========================================");
    console.log("       ESEKGAMES SERVER BAŞLADI");
    console.log("==========================================");
    console.log(`Port: ${PORT}`);
    console.log(`Ana site: /`);
    console.log(`Simulator: /games/eseksimulator`);
    console.log(`WebSocket: aktif`);
    console.log("==========================================");
    console.log("");
});
