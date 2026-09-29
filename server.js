// server.js
// ESEKGAMES - Ortak Multiplayer Server
// Node.js + Express + WebSocket

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

// ============================================================
// DOSYALAR
// ============================================================

const ROOT = __dirname;

const DATA_DIR = path.join(ROOT, "data");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");

const MAIN_INDEX = path.join(ROOT, "index.html");
const SIMULATOR_INDEX = path.join(
    ROOT,
    "games",
    "eseksimulator",
    "index.html"
);

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(ACCOUNTS_FILE)) {
    fs.writeFileSync(
        ACCOUNTS_FILE,
        JSON.stringify({ accounts: {} }, null, 2),
        "utf8"
    );
}

// ============================================================
// EXPRESS
// ============================================================

app.use(express.json({ limit: "1mb" }));

// Statik dosyalar
app.use(express.static(ROOT));

// ============================================================
// ANA SAYFA
// ============================================================

app.get("/", (req, res) => {
    if (fs.existsSync(MAIN_INDEX)) {
        return res.sendFile(MAIN_INDEX);
    }

    return res.status(404).send(
        "EsekGames ana sayfa dosyası bulunamadı: index.html"
    );
});

// ============================================================
// EŞEK SIMULATOR
// ============================================================

app.get("/games/eseksimulator", (req, res) => {
    if (fs.existsSync(SIMULATOR_INDEX)) {
        return res.sendFile(SIMULATOR_INDEX);
    }

    return res.status(404).send(
        "Eşek Simulator dosyası bulunamadı: games/eseksimulator/index.html"
    );
});

// ============================================================
// HEALTH
// ============================================================

app.get("/health", (req, res) => {
    res.json({
        ok: true,
        players: activePlayerCount(),
        uptime: process.uptime()
    });
});

// ============================================================
// ACCOUNT SİSTEMİ
// ============================================================

function loadAccounts() {
    try {
        const raw = fs.readFileSync(ACCOUNTS_FILE, "utf8");
        const data = JSON.parse(raw);

        if (!data.accounts || typeof data.accounts !== "object") {
            data.accounts = {};
        }

        return data;
    } catch (err) {
        console.error("accounts.json okunamadı:", err);

        return {
            accounts: {}
        };
    }
}

function saveAccounts(data) {
    fs.writeFileSync(
        ACCOUNTS_FILE,
        JSON.stringify(data, null, 2),
        "utf8"
    );
}

function hashPassword(password) {
    return crypto
        .createHash("sha256")
        .update(String(password))
        .digest("hex");
}

function normalizeUsername(username) {
    return String(username || "")
        .trim()
        .replace(/\s+/g, " ");
}

function validUsername(username) {
    return (
        username.length >= 3 &&
        username.length <= 24 &&
        /^[a-zA-Z0-9_ğüşöçıİĞÜŞÖÇ -]+$/.test(username)
    );
}

function findAccount(username) {
    const db = loadAccounts();

    const target = username.toLowerCase();

    for (const key of Object.keys(db.accounts)) {
        if (key.toLowerCase() === target) {
            return {
                key,
                account: db.accounts[key]
            };
        }
    }

    return null;
}

// ============================================================
// REGISTER
// ============================================================

app.post("/api/register", (req, res) => {
    const username = normalizeUsername(req.body.username);
    const password = String(req.body.password || "");

    if (!validUsername(username)) {
        return res.status(400).json({
            ok: false,
            error: "Kullanıcı adı 3-24 karakter olmalı."
        });
    }

    if (password.length < 4) {
        return res.status(400).json({
            ok: false,
            error: "Şifre en az 4 karakter olmalı."
        });
    }

    const db = loadAccounts();

    if (findAccount(username)) {
        return res.status(409).json({
            ok: false,
            error: "Bu kullanıcı adı zaten kullanılıyor."
        });
    }

    db.accounts[username] = {
        username,
        password: hashPassword(password),
        createdAt: Date.now()
    };

    saveAccounts(db);

    return res.json({
        ok: true,
        username
    });
});

// ============================================================
// LOGIN
// ============================================================

app.post("/api/login", (req, res) => {
    const username = normalizeUsername(req.body.username);
    const password = String(req.body.password || "");

    const found = findAccount(username);

    if (!found) {
        return res.status(401).json({
            ok: false,
            error: "Kullanıcı adı veya şifre yanlış."
        });
    }

    if (found.account.password !== hashPassword(password)) {
        return res.status(401).json({
            ok: false,
            error: "Kullanıcı adı veya şifre yanlış."
        });
    }

    return res.json({
        ok: true,
        username: found.account.username
    });
});

// ============================================================
// ŞİFRE DEĞİŞTİR
// ============================================================

app.post("/api/change-password", (req, res) => {
    const username = normalizeUsername(req.body.username);
    const oldPassword = String(req.body.oldPassword || "");
    const newPassword = String(req.body.newPassword || "");

    const found = findAccount(username);

    if (!found) {
        return res.status(404).json({
            ok: false,
            error: "Hesap bulunamadı."
        });
    }

    if (found.account.password !== hashPassword(oldPassword)) {
        return res.status(401).json({
            ok: false,
            error: "Mevcut şifre yanlış."
        });
    }

    if (newPassword.length < 4) {
        return res.status(400).json({
            ok: false,
            error: "Yeni şifre en az 4 karakter olmalı."
        });
    }

    const db = loadAccounts();

    db.accounts[found.key].password = hashPassword(newPassword);

    saveAccounts(db);

    return res.json({
        ok: true
    });
});

// ============================================================
// KULLANICI ADI DEĞİŞTİR
// ============================================================

app.post("/api/change-username", (req, res) => {
    const oldUsername = normalizeUsername(req.body.username);
    const newUsername = normalizeUsername(req.body.newUsername);
    const password = String(req.body.password || "");

    if (!validUsername(newUsername)) {
        return res.status(400).json({
            ok: false,
            error: "Yeni kullanıcı adı geçersiz."
        });
    }

    const found = findAccount(oldUsername);

    if (!found) {
        return res.status(404).json({
            ok: false,
            error: "Hesap bulunamadı."
        });
    }

    if (found.account.password !== hashPassword(password)) {
        return res.status(401).json({
            ok: false,
            error: "Şifre yanlış."
        });
    }

    const alreadyExists = findAccount(newUsername);

    if (alreadyExists) {
        return res.status(409).json({
            ok: false,
            error: "Bu kullanıcı adı zaten kullanılıyor."
        });
    }

    const db = loadAccounts();

    const oldKey = found.key;

    db.accounts[newUsername] = {
        ...db.accounts[oldKey],
        username: newUsername,
        updatedAt: Date.now()
    };

    delete db.accounts[oldKey];

    saveAccounts(db);

    return res.json({
        ok: true,
        username: newUsername
    });
});

// ============================================================
// OYUNCULAR
// ============================================================

const players = new Map();

let nextPlayerId = 1;

// ============================================================
// GUEST NUMARASI
// ============================================================

function guestName(number) {
    return `Guest-${String(number).padStart(3, "0")}`;
}

function isGuestNameUsed(name) {
    for (const player of players.values()) {
        if (player.name === name) {
            return true;
        }
    }

    return false;
}

function getSmallestFreeGuestNumber() {
    let number = 0;

    while (isGuestNameUsed(guestName(number))) {
        number++;
    }

    return number;
}

function allocateGuestName() {
    const number = getSmallestFreeGuestNumber();

    return {
        name: guestName(number),
        number
    };
}

// ============================================================
// OYUNCU SAYISI
// ============================================================

function activePlayerCount() {
    let count = 0;

    for (const player of players.values()) {
        if (player.inGame) {
            count++;
        }
    }

    return count;
}

// ============================================================
// WEBSOCKET YARDIMCILARI
// ============================================================

function send(ws, data) {
    if (!ws) return;

    if (ws.readyState !== WebSocket.OPEN) {
        return;
    }

    try {
        ws.send(JSON.stringify(data));
    } catch (err) {
        console.error("WS gönderme hatası:", err.message);
    }
}

function broadcast(data, exceptId = null) {
    for (const player of players.values()) {
        if (exceptId !== null && player.id === exceptId) {
            continue;
        }

        send(player.ws, data);
    }
}

function broadcastGame(data, exceptId = null) {
    for (const player of players.values()) {
        if (!player.inGame) {
            continue;
        }

        if (exceptId !== null && player.id === exceptId) {
            continue;
        }

        send(player.ws, data);
    }
}

function getPublicPlayer(player) {
    return {
        id: player.id,
        name: player.name,
        account: player.account,
        guest: player.guest,
        inGame: player.inGame,

        x: player.x,
        y: player.y,
        z: player.z,

        rotation: player.rotation,

        health: player.health,
        hunger: player.hunger,
        thirst: player.thirst,

        weapon: player.weapon,
        ammo: player.ammo
    };
}

function sendPlayerList() {
    const list = [];

    for (const player of players.values()) {
        if (!player.inGame) continue;

        list.push(getPublicPlayer(player));
    }

    broadcast({
        type: "player_list",
        players: list,
        count: list.length
    });
}

// ============================================================
// PLAYER DEFAULT
// ============================================================

function createPlayer(ws) {
    const id = nextPlayerId++;

    const player = {
        id,
        ws,

        name: null,
        account: false,
        guest: false,
        guestNumber: null,

        inGame: false,

        game: null,

        x: 0,
        y: 0,
        z: 0,

        rotation: 0,

        health: 100,
        hunger: 100,
        thirst: 100,

        weapon: null,
        ammo: 0,

        connectedAt: Date.now(),
        lastSeen: Date.now(),

        dead: false,

        inventory: {
            carrot: 0,
            apple: 0,
            sword: 0,
            gun: 0
        }
    };

    players.set(id, player);

    return player;
}

// ============================================================
// JOIN
// ============================================================

function joinGame(player, data) {
    if (player.inGame) {
        send(player.ws, {
            type: "join_accepted",
            player: getPublicPlayer(player),
            alreadyJoined: true
        });

        return;
    }

    const requestedName = normalizeUsername(data && data.name);

    const isAccount = !!(data && data.account);

    if (isAccount) {
        const found = findAccount(requestedName);

        if (!found) {
            send(player.ws, {
                type: "join_rejected",
                error: "Hesap bulunamadı."
            });

            return;
        }

        player.name = found.account.username;
        player.account = true;
        player.guest = false;
        player.guestNumber = null;
    } else {
        const guest = allocateGuestName();

        player.name = guest.name;
        player.account = false;
        player.guest = true;
        player.guestNumber = guest.number;
    }

    player.game = data && data.game
        ? String(data.game)
        : "eseksimulator";

    player.inGame = true;

    player.x = 0;
    player.y = 0;
    player.z = 0;

    player.rotation = 0;

    player.health = 100;
    player.hunger = 100;
    player.thirst = 100;

    player.weapon = null;
    player.ammo = 0;

    player.dead = false;

    send(player.ws, {
        type: "join_accepted",
        player: getPublicPlayer(player)
    });

    broadcastGame({
        type: "player_joined",
        player: getPublicPlayer(player)
    }, player.id);

    sendPlayerList();
}

// ============================================================
// LEAVE GAME
// ============================================================

function leaveGame(player, reason = "leave") {
    if (!player.inGame) {
        return;
    }

    const oldName = player.name;
    const oldId = player.id;

    player.inGame = false;
    player.game = null;

    // Guest numarası burada kalıcı olarak tutulmaz.
    // Bir sonraki girişte tekrar en küçük boş numara seçilir.
    player.name = null;
    player.guest = false;
    player.account = false;
    player.guestNumber = null;

    broadcastGame({
        type: "player_left",
        id: oldId,
        name: oldName,
        reason
    }, oldId);

    sendPlayerList();
}

// ============================================================
// MOVEMENT
// ============================================================

function handleMove(player, data) {
    if (!player.inGame) return;

    if (typeof data.x === "number") {
        player.x = data.x;
    }

    if (typeof data.y === "number") {
        player.y = data.y;
    }

    if (typeof data.z === "number") {
        player.z = data.z;
    }

    if (typeof data.rotation === "number") {
        player.rotation = data.rotation;
    }

    player.lastSeen = Date.now();

    broadcastGame({
        type: "player_moved",
        id: player.id,
        x: player.x,
        y: player.y,
        z: player.z,
        rotation: player.rotation
    }, player.id);
}

// ============================================================
// PRESENCE
// ============================================================

function handlePresence(player, data) {
    if (!data) return;

    const online = !!data.online;

    if (online) {
        if (!player.inGame) {
            joinGame(player, {
                game: data.game || "eseksimulator",
                name: data.name,
                account: !!data.account
            });
        }

        return;
    }

    // Presence false geldiğinde oyundan çık.
    leaveGame(player, "presence_off");
}

// ============================================================
// CHAT
// ============================================================

function handleChat(player, data) {
    if (!player.inGame) return;

    let message = String(data.message || "").trim();

    if (!message) return;

    if (message.length > 300) {
        message = message.slice(0, 300);
    }

    broadcastGame({
        type: "chat",
        id: player.id,
        name: player.name,
        message,
        time: Date.now()
    });
}

// ============================================================
// HASAR
// ============================================================

function damagePlayer(target, amount, attackerId = null, reason = "damage") {
    if (!target.inGame) return;

    if (!Number.isFinite(amount) || amount <= 0) {
        return;
    }

    target.health -= amount;

    if (target.health < 0) {
        target.health = 0;
    }

    send(target.ws, {
        type: "health_update",
        health: target.health,
        reason
    });

    broadcastGame({
        type: "player_damaged",
        id: target.id,
        health: target.health,
        amount,
        attackerId,
        reason
    });

    if (target.health <= 0) {
        killPlayer(target, reason);
    }
}

// ============================================================
// ÖLÜM / RESPAWN
// ============================================================

function killPlayer(player, reason = "dead") {
    if (player.dead) {
        return;
    }

    player.dead = true;
    player.health = 0;

    send(player.ws, {
        type: "player_dead",
        reason
    });

    broadcastGame({
        type: "player_dead_broadcast",
        id: player.id,
        reason
    });

    // 5 saniye sonra doğ
    setTimeout(() => {
        if (!players.has(player.id)) {
            return;
        }

        if (!player.inGame) {
            return;
        }

        player.dead = false;
        player.health = 100;
        player.hunger = 100;
        player.thirst = 100;

        player.x = 0;
        player.y = 0;
        player.z = 0;

        send(player.ws, {
            type: "respawn",
            player: getPublicPlayer(player)
        });

        broadcastGame({
            type: "player_respawned",
            player: getPublicPlayer(player)
        });
    }, 5000);
}

// ============================================================
// NEEDS
// ============================================================

function handleNeeds(player, data) {
    if (!player.inGame || player.dead) return;

    if (typeof data.hunger === "number") {
        player.hunger = Math.max(
            0,
            Math.min(100, data.hunger)
        );
    }

    if (typeof data.thirst === "number") {
        player.thirst = Math.max(
            0,
            Math.min(100, data.thirst)
        );
    }

    if (typeof data.health === "number") {
        player.health = Math.max(
            0,
            Math.min(100, data.health)
        );
    }

    send(player.ws, {
        type: "needs_update",
        health: player.health,
        hunger: player.hunger,
        thirst: player.thirst
    });
}

// ============================================================
// WEAPON
// ============================================================

function handleWeaponAttack(player, data) {
    if (!player.inGame || player.dead) return;

    const weapon = String(data.weapon || "");

    if (weapon === "gun") {
        if (player.ammo <= 0) {
            send(player.ws, {
                type: "weapon_error",
                error: "Mermi yok."
            });

            return;
        }

        player.ammo--;

        send(player.ws, {
            type: "ammo_update",
            ammo: player.ammo
        });

        broadcastGame({
            type: "gun_shot",
            id: player.id,
            x: player.x,
            y: player.y,
            z: player.z,
            rotation: player.rotation,
            ammo: player.ammo
        }, player.id);

        return;
    }

    if (weapon === "sword") {
        broadcastGame({
            type: "sword_attack",
            id: player.id,
            x: player.x,
            y: player.y,
            z: player.z,
            rotation: player.rotation
        }, player.id);
    }
}

// ============================================================
// ITEM DROP
// ============================================================

function handleDropItem(player, data) {
    if (!player.inGame) return;

    const item = String(data.item || "");

    const allowed = [
        "carrot",
        "apple",
        "sword",
        "gun"
    ];

    if (!allowed.includes(item)) {
        return;
    }

    if (!player.inventory[item] || player.inventory[item] <= 0) {
        return;
    }

    player.inventory[item]--;

    const dropped = {
        id: crypto.randomUUID(),
        item,

        x: typeof data.x === "number"
            ? data.x
            : player.x,

        y: typeof data.y === "number"
            ? data.y
            : player.y,

        z: typeof data.z === "number"
            ? data.z
            : player.z,

        ownerId: player.id,

        createdAt: Date.now()
    };

    // Yer seviyesinin altına düşmesini engellemek
    if (dropped.y < 0) {
        dropped.y = 0;
    }

    broadcastGame({
        type: "item_dropped",
        item: dropped
    });

    send(player.ws, {
        type: "inventory_update",
        inventory: player.inventory
    });
}

// ============================================================
// ITEM PICKUP
// ============================================================

function handlePickupItem(player, data) {
    if (!player.inGame) return;

    const itemId = String(data.itemId || "");

    if (!itemId) return;

    // Basit olarak istemcinin gönderdiği pozisyondaki item
    // için pickup olayı yayınlanır.
    broadcastGame({
        type: "item_picked_up",
        itemId,
        playerId: player.id,
        playerName: player.name
    });

    send(player.ws, {
        type: "pickup_confirmed",
        itemId
    });
}

// ============================================================
// INVENTORY
// ============================================================

function handleInventory(player, data) {
    if (!player.inGame) return;

    if (!data || !data.item) return;

    const item = String(data.item);

    if (!(item in player.inventory)) {
        return;
    }

    let amount = Number(data.amount);

    if (!Number.isFinite(amount)) {
        amount = 1;
    }

    amount = Math.max(0, Math.floor(amount));

    player.inventory[item] += amount;

    send(player.ws, {
        type: "inventory_update",
        inventory: player.inventory
    });
}

// ============================================================
// WEAPON EQUIP
// ============================================================

function handleEquip(player, data) {
    if (!player.inGame) return;

    const weapon = String(data.weapon || "");

    if (
        weapon !== "sword" &&
        weapon !== "gun" &&
        weapon !== "none"
    ) {
        return;
    }

    if (weapon === "sword") {
        if (player.inventory.sword <= 0) {
            return;
        }
    }

    if (weapon === "gun") {
        if (player.inventory.gun <= 0) {
            return;
        }
    }

    player.weapon = weapon === "none"
        ? null
        : weapon;

    if (weapon === "gun" && player.ammo <= 0) {
        player.ammo = 6;
    }

    send(player.ws, {
        type: "weapon_equipped",
        weapon: player.weapon,
        ammo: player.ammo
    });
}

// ============================================================
// WEBSOCKET
// ============================================================

wss.on("connection", (ws, req) => {
    const player = createPlayer(ws);

    console.log(
        `[WS] Bağlandı: #${player.id} ${req.socket.remoteAddress || ""}`
    );

    send(ws, {
        type: "connected",
        id: player.id
    });

    send(ws, {
        type: "server_info",
        version: "1.0.0",
        players: activePlayerCount()
    });

    ws.on("message", (raw) => {
        let data;

        try {
            data = JSON.parse(raw.toString());
        } catch (err) {
            send(ws, {
                type: "error",
                error: "Geçersiz JSON."
            });

            return;
        }

        if (!data || typeof data !== "object") {
            return;
        }

        const type = String(data.type || "");

        switch (type) {

            // --------------------------------------------
            // OYUNA GİR
            // --------------------------------------------

            case "join_request":
                joinGame(player, data);
                break;

            // --------------------------------------------
            // PRESENCE
            // --------------------------------------------

            case "presence":
                handlePresence(player, data);
                break;

            // --------------------------------------------
            // ÇIKIŞ
            // --------------------------------------------

            case "leave_game":
                leaveGame(player, "client_leave");
                break;

            // --------------------------------------------
            // HAREKET
            // --------------------------------------------

            case "move":
            case "player_move":
            case "movement":
                handleMove(player, data);
                break;

            // --------------------------------------------
            // CHAT
            // --------------------------------------------

            case "chat":
            case "chat_message":
                handleChat(player, data);
                break;

            // --------------------------------------------
            // NEEDS
            // --------------------------------------------

            case "needs":
            case "needs_update":
                handleNeeds(player, data);
                break;

            // --------------------------------------------
            // WEAPON
            // --------------------------------------------

            case "weapon_attack":
            case "attack":
                handleWeaponAttack(player, data);
                break;

            // --------------------------------------------
            // ITEM DROP
            // --------------------------------------------

            case "drop_item":
            case "item_drop":
                handleDropItem(player, data);
                break;

            // --------------------------------------------
            // ITEM PICKUP
            // --------------------------------------------

            case "pickup_item":
            case "item_pickup":
                handlePickupItem(player, data);
                break;

            // --------------------------------------------
            // INVENTORY
            // --------------------------------------------

            case "inventory_add":
            case "inventory":
                handleInventory(player, data);
                break;

            // --------------------------------------------
            // EQUIP
            // --------------------------------------------

            case "equip":
            case "equip_weapon":
                handleEquip(player, data);
                break;

            // --------------------------------------------
            // PING
            // --------------------------------------------

            case "ping":
                send(ws, {
                    type: "pong",
                    time: Date.now()
                });
                break;

            // --------------------------------------------
            // BİLİNMEYEN
            // --------------------------------------------

            default:
                send(ws, {
                    type: "unknown_message",
                    messageType: type
                });

                break;
        }
    });

    ws.on("close", () => {
        console.log(`[WS] Ayrıldı: #${player.id}`);

        leaveGame(player, "disconnect");

        players.delete(player.id);

        sendPlayerList();
    });

    ws.on("error", (err) => {
        console.error(
            `[WS] #${player.id} hata:`,
            err.message
        );
    });
});

// ============================================================
// SERVER LOOP
// ============================================================

// Oyuncuların bağlantılarını canlı tut
setInterval(() => {
    for (const player of players.values()) {
        if (!player.ws) continue;

        if (player.ws.readyState !== WebSocket.OPEN) {
            continue;
        }

        send(player.ws, {
            type: "server_tick",
            time: Date.now()
        });
    }
}, 15000);

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
