const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;
const APP_VERSION = "2026-09-29-ESEK-WEAPONS-1";

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({
    server,
    maxPayload: 32 * 1024
});

app.use(express.json({ limit: "32kb" }));

/* =========================================================
   DOSYALAR
   ========================================================= */

const DATA_DIR = path.join(__dirname, "data");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

let accounts = {};

function loadAccounts() {
    if (!fs.existsSync(ACCOUNTS_FILE)) {
        accounts = {};
        saveAccounts();
        return;
    }

    try {
        const raw = fs.readFileSync(ACCOUNTS_FILE, "utf8");
        const data = JSON.parse(raw);

        if (
            data &&
            typeof data === "object" &&
            data.accounts &&
            typeof data.accounts === "object"
        ) {
            accounts = data.accounts;
        } else {
            accounts = {};
        }
    } catch (err) {
        console.error("accounts.json okunamadı:", err.message);

        // ÖNEMLİ:
        // Bozuk dosyayı otomatik olarak silmiyoruz.
        accounts = {};
    }
}

function saveAccounts() {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    const tempFile = ACCOUNTS_FILE + ".tmp";

    fs.writeFileSync(
        tempFile,
        JSON.stringify(
            {
                accounts
            },
            null,
            2
        ),
        "utf8"
    );

    fs.renameSync(tempFile, ACCOUNTS_FILE);
}

loadAccounts();

/* =========================================================
   GENEL YARDIMCILAR
   ========================================================= */

function send(ws, data) {
    if (!ws) return;

    if (ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify(data));
        } catch (_) {}
    }
}

function broadcast(data, exceptId = null) {
    const message = JSON.stringify(data);

    for (const id in players) {
        if (id === exceptId) continue;

        const p = players[id];

        if (
            p &&
            p.ws &&
            p.ws.readyState === WebSocket.OPEN
        ) {
            try {
                p.ws.send(message);
            } catch (_) {}
        }
    }
}

function broadcastGame(data) {
    const message = JSON.stringify(data);

    for (const id in players) {
        const p = players[id];

        if (
            p &&
            p.inGame &&
            p.ws &&
            p.ws.readyState === WebSocket.OPEN
        ) {
            try {
                p.ws.send(message);
            } catch (_) {}
        }
    }
}

function cleanText(value) {
    return String(value ?? "")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
        .trim()
        .slice(0, 300);
}

function cleanName(value) {
    return String(value ?? "")
        .trim()
        .slice(0, 20);
}

function normalizeUsername(value) {
    return String(value ?? "")
        .trim()
        .normalize("NFKC")
        .toLocaleLowerCase("tr-TR");
}

function validUsername(value) {
    return /^[A-Za-z0-9_çğıöşüÇĞİÖŞÜ-]{3,20}$/.test(
        String(value || "")
    );
}

function clamp(value, min, max, fallback = 0) {
    const n = Number(value);

    if (!Number.isFinite(n)) {
        return fallback;
    }

    return Math.max(min, Math.min(max, n));
}

/* =========================================================
   HESAP SİSTEMİ
   ========================================================= */

function hashPassword(password, salt) {
    return crypto
        .scryptSync(String(password), salt, 64)
        .toString("hex");
}

function makeAccount(username, password) {
    const salt = crypto
        .randomBytes(16)
        .toString("hex");

    return {
        username,
        salt,
        passwordHash: hashPassword(password, salt),
        token: crypto
            .randomBytes(32)
            .toString("hex"),
        createdAt: Date.now()
    };
}

function findAccountByToken(token) {
    if (!token) return null;

    return Object.values(accounts).find(
        account =>
            account &&
            account.token === token
    ) || null;
}

function findAccountByUsername(username) {
    const key = normalizeUsername(username);

    return accounts[key] || null;
}

/* =========================================================
   REGISTER
   ========================================================= */

app.post("/api/auth/register", (req, res) => {
    const username = String(
        req.body?.username || ""
    ).trim();

    const password = String(
        req.body?.password || ""
    );

    const passwordConfirm = String(
        req.body?.passwordConfirm ??
        req.body?.password2 ??
        ""
    );

    if (!validUsername(username)) {
        return res.status(400).json({
            message:
                "Kullanıcı adı 3-20 karakter olmalı ve yalnızca harf, rakam, _ veya - içermeli."
        });
    }

    if (password.length < 6) {
        return res.status(400).json({
            message:
                "Şifre en az 6 karakter olmalı."
        });
    }

    if (passwordConfirm !== password) {
        return res.status(400).json({
            message:
                "Şifreler aynı değil."
        });
    }

    const key = normalizeUsername(username);

    if (accounts[key]) {
        return res.status(409).json({
            message:
                "Bu kullanıcı adı zaten kullanılıyor."
        });
    }

    accounts[key] = makeAccount(
        username,
        password
    );

    saveAccounts();

    return res.json({
        ok: true,
        username: accounts[key].username,
        token: accounts[key].token
    });
});

/* =========================================================
   LOGIN
   ========================================================= */

app.post("/api/auth/login", (req, res) => {
    const username = String(
        req.body?.username || ""
    ).trim();

    const password = String(
        req.body?.password || ""
    );

    const account =
        findAccountByUsername(username);

    if (!account) {
        return res.status(401).json({
            message:
                "Kullanıcı adı veya şifre hatalı."
        });
    }

    const hash = hashPassword(
        password,
        account.salt
    );

    if (hash !== account.passwordHash) {
        return res.status(401).json({
            message:
                "Kullanıcı adı veya şifre hatalı."
        });
    }

    // Her girişte yeni token.
    account.token = crypto
        .randomBytes(32)
        .toString("hex");

    saveAccounts();

    return res.json({
        ok: true,
        username: account.username,
        token: account.token
    });
});

/* =========================================================
   USERNAME DEĞİŞTİR
   ========================================================= */

app.post("/api/auth/change-username", (req, res) => {
    const token = String(
        req.body?.token || ""
    );

    const newUsername = String(
        req.body?.username || ""
    ).trim();

    const account =
        findAccountByToken(token);

    if (!account) {
        return res.status(401).json({
            message: "Oturum geçersiz."
        });
    }

    if (!validUsername(newUsername)) {
        return res.status(400).json({
            message:
                "Kullanıcı adı geçersiz."
        });
    }

    const newKey =
        normalizeUsername(newUsername);

    const oldKey =
        normalizeUsername(account.username);

    if (
        newKey !== oldKey &&
        accounts[newKey]
    ) {
        return res.status(409).json({
            message:
                "Bu kullanıcı adı zaten kullanılıyor."
        });
    }

    delete accounts[oldKey];

    account.username = newUsername;

    accounts[newKey] = account;

    saveAccounts();

    return res.json({
        ok: true,
        username: account.username
    });
});

/* =========================================================
   ŞİFRE DEĞİŞTİR
   ========================================================= */

app.post("/api/auth/change-password", (req, res) => {
    const token = String(
        req.body?.token || ""
    );

    const oldPassword = String(
        req.body?.oldPassword || ""
    );

    const newPassword = String(
        req.body?.newPassword || ""
    );

    const account =
        findAccountByToken(token);

    if (!account) {
        return res.status(401).json({
            message: "Oturum geçersiz."
        });
    }

    const oldHash = hashPassword(
        oldPassword,
        account.salt
    );

    if (oldHash !== account.passwordHash) {
        return res.status(401).json({
            message:
                "Mevcut şifre hatalı."
        });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({
            message:
                "Yeni şifre en az 6 karakter olmalı."
        });
    }

    account.salt =
        crypto.randomBytes(16).toString("hex");

    account.passwordHash =
        hashPassword(
            newPassword,
            account.salt
        );

    saveAccounts();

    return res.json({
        ok: true
    });
});

/* =========================================================
   OYUNCULAR
   ========================================================= */

const players = {};

const MAX_HEALTH = 9;
const MAX_HUNGER = 100;
const MAX_THIRST = 100;

const MAP_LIMIT = 5000;

const SPAWN = {
    x: 0,
    y: 1,
    z: 0
};

/* =========================================================
   GUEST NUMARASI
   ========================================================= */

function guestNumberIsActive(number) {
    const wanted =
        `Guest-${String(number).padStart(3, "0")}`;

    return Object.values(players).some(
        p =>
            p &&
            p.inGame &&
            p.name === wanted
    );
}

function nextGuestName() {
    let number = 0;

    while (guestNumberIsActive(number)) {
        number++;
    }

    return `Guest-${String(number).padStart(3, "0")}`;
}

function findActiveName(name, exceptId) {
    return Object.values(players).find(
        p =>
            p &&
            p.id !== exceptId &&
            p.inGame &&
            p.name === name
    );
}

/* =========================================================
   PLAYER SNAPSHOT
   ========================================================= */

function playerSnapshot(p) {
    return {
        id: p.id,
        name: p.name,

        x: p.x,
        y: p.y,
        z: p.z,

        yaw: p.yaw,
        pitch: p.pitch,

        health: p.health,
        hunger: p.hunger,
        thirst: p.thirst,

        alive: p.alive,

        platform: p.platform,

        isCrouching: p.isCrouching,
        isMoving: p.isMoving,
        isJumping: p.isJumping,

        weapon: p.weapon,
        ammo: p.ammo
    };
}

function publicPlayerSnapshot(p) {
    return {
        id: p.id,
        name: p.name,

        x: p.x,
        y: p.y,
        z: p.z,

        yaw: p.yaw,
        pitch: p.pitch,

        health: p.health,
        alive: p.alive,

        platform: p.platform,

        isCrouching: p.isCrouching,
        isMoving: p.isMoving,
        isJumping: p.isJumping,

        weapon: p.weapon,
        ammo: p.ammo
    };
}

function sendPlayers() {
    const list = Object.values(players)
        .filter(p => p && p.inGame)
        .map(publicPlayerSnapshot);

    broadcastGame({
        type: "players",
        players: list
    });
}

/* =========================================================
   CHAT
   ========================================================= */

const chatHistory = [];

function pushChat(message) {
    chatHistory.push(message);

    if (chatHistory.length > 100) {
        chatHistory.shift();
    }
}

/* =========================================================
   ANIMALS
   ========================================================= */

const animals = {};

function ensureAnimal(id) {
    if (!id) return null;

    if (!animals[id]) {
        animals[id] = {
            id,
            health: 5,
            hunger: 100,
            thirst: 100,
            alive: true
        };
    }

    return animals[id];
}

/* =========================================================
   SYSTEM MESSAGE
   ========================================================= */

function publicSystem(text) {
    const message = {
        type: "system_message",
        text: cleanText(text),
        time: Date.now()
    };

    broadcastGame(message);
    pushChat(message);
}

/* =========================================================
   WEBSOCKET
   ========================================================= */

wss.on("connection", ws => {
    const id =
        crypto.randomUUID();

    const player = {
        id,
        ws,

        name: null,
        accountUsername: null,

        platform: "pc",

        inGame: false,
        alive: true,

        x: SPAWN.x,
        y: SPAWN.y,
        z: SPAWN.z,

        yaw: 0,
        pitch: 0,

        health: MAX_HEALTH,
        hunger: MAX_HUNGER,
        thirst: MAX_THIRST,

        isCrouching: false,
        isMoving: false,
        isJumping: false,

        weapon: "none",
        ammo: 0,

        pingMs: 0,

        lastNeedTick: Date.now(),
        lastChatAt: 0,
        lastAttackAt: 0,
        lastWeaponAttackAt: 0,

        ws
    };

    players[id] = player;

    send(ws, {
        type: "server_info",
        version: APP_VERSION
    });

    send(ws, {
        type: "connected",
        id
    });

    send(ws, {
        type: "chat_history",
        messages: chatHistory.slice(-50)
    });

    sendPlayers();

    /* =====================================================
       MESSAGE
       ===================================================== */

    ws.on("message", raw => {
        let data;

        try {
            data = JSON.parse(
                raw.toString()
            );
        } catch (_) {
            return;
        }

        if (
            !data ||
            typeof data.type !== "string"
        ) {
            return;
        }

        const p = players[id];

        if (!p) return;

        switch (data.type) {

            /* =============================================
               PROFILE
               ============================================= */

            case "profile": {

                p.platform =
                    data.platform === "mobile"
                        ? "mobile"
                        : "pc";

                break;
            }

            /* =============================================
               JOIN
               ============================================= */

            case "join_request": {

                const account =
                    findAccountByToken(
                        String(data.token || "")
                    );

                const candidate =
                    account
                        ? cleanName(account.username)
                        : nextGuestName();

                const duplicate =
                    findActiveName(
                        candidate,
                        id
                    );

                if (duplicate) {
                    send(ws, {
                        type: "join_denied",
                        message:
                            "Bu kullanıcı adı şu anda oyunda kullanılıyor."
                    });

                    break;
                }

                p.name = candidate;

                p.accountUsername =
                    account
                        ? account.username
                        : null;

                p.platform =
                    data.platform === "mobile"
                        ? "mobile"
                        : "pc";

                p.inGame = true;
                p.alive = true;

                p.health = MAX_HEALTH;
                p.hunger = MAX_HUNGER;
                p.thirst = MAX_THIRST;

                p.x = SPAWN.x;
                p.y = SPAWN.y;
                p.z = SPAWN.z;

                p.yaw = 0;
                p.pitch = 0;

                p.weapon = "none";
                p.ammo = 0;

                p.lastNeedTick =
                    Date.now();

                send(ws, {
                    type: "join_accepted",
                    id,
                    state: playerSnapshot(p),
                    spawn: SPAWN
                });

                publicSystem(
                    `${p.name} oyuna katıldı.`
                );

                sendPlayers();

                break;
            }

            /* =============================================
               PRESENCE
               ============================================= */

            case "presence": {

                p.platform =
                    data.platform === "mobile"
                        ? "mobile"
                        : "pc";

                if (data.active !== true) {

                    if (p.inGame && p.name) {
                        publicSystem(
                            `${p.name} oyundan çıktı.`
                        );
                    }

                    p.inGame = false;
                    p.weapon = "none";
                    p.ammo = 0;

                    sendPlayers();
                }

                break;
            }

            /* =============================================
               MOVE
               ============================================= */

            case "move": {

                if (!p.inGame || !p.alive) {
                    break;
                }

                p.x = clamp(
                    data.x,
                    -MAP_LIMIT,
                    MAP_LIMIT,
                    p.x
                );

                p.y = clamp(
                    data.y,
                    -10,
                    100,
                    p.y
                );

                p.z = clamp(
                    data.z,
                    -MAP_LIMIT,
                    MAP_LIMIT,
                    p.z
                );

                p.yaw = clamp(
                    data.yaw,
                    -Math.PI * 20,
                    Math.PI * 20,
                    p.yaw
                );

                p.pitch = clamp(
                    data.pitch,
                    -2,
                    2,
                    p.pitch
                );

                p.isCrouching =
                    data.isCrouching === true;

                p.isMoving =
                    data.isMoving === true;

                p.isJumping =
                    data.isJumping === true;

                if (
                    data.pingMs !== undefined &&
                    Number.isFinite(
                        Number(data.pingMs)
                    )
                ) {
                    p.pingMs =
                        clamp(
                            data.pingMs,
                            0,
                            10000,
                            p.pingMs
                        );
                }

                break;
            }

            /* =============================================
               PING
               ============================================= */

            case "ping": {

                send(ws, {
                    type: "pong",
                    timestamp:
                        Number(data.timestamp)
                });

                break;
            }

            case "ping_result": {

                if (
                    Number.isFinite(
                        Number(data.pingMs)
                    )
                ) {
                    p.pingMs =
                        clamp(
                            data.pingMs,
                            0,
                            10000,
                            p.pingMs
                        );
                }

                break;
            }

            /* =============================================
               CHAT HISTORY
               ============================================= */

            case "chat_history": {

                send(ws, {
                    type: "chat_history",
                    messages:
                        chatHistory.slice(-50)
                });

                break;
            }

            /* =============================================
               CHAT
               ============================================= */

            case "chat": {

                if (!p.inGame || !p.alive) {
                    break;
                }

                const now = Date.now();

                if (
                    now - p.lastChatAt <
                    450
                ) {
                    break;
                }

                const text =
                    cleanText(data.text);

                if (!text) break;

                p.lastChatAt = now;

                const message = {
                    type: "chat",
                    id: p.id,
                    name: p.name,
                    text,
                    time: now
                };

                pushChat(message);
                broadcastGame(message);

                break;
            }

            /* =============================================
               WEAPON EQUIP
               ============================================= */

            case "weapon_equip": {

                if (!p.inGame || !p.alive) {
                    break;
                }

                let weapon = "none";

                if (
                    data.weapon === "gun"
                ) {
                    weapon = "gun";
                }

                if (
                    data.weapon === "sword"
                ) {
                    weapon = "sword";
                }

                p.weapon = weapon;

                if (
                    weapon === "gun" &&
                    p.ammo <= 0
                ) {
                    p.ammo = 12;
                }

                if (weapon !== "gun") {
                    p.ammo = 0;
                }

                send(ws, {
                    type: "weapon_equipped",
                    weapon: p.weapon,
                    ammo: p.ammo
                });

                sendPlayers();

                break;
            }

            /* =============================================
               WEAPON ATTACK
               ============================================= */

            case "weapon_attack": {

                if (!p.inGame || !p.alive) {
                    break;
                }

                const now = Date.now();

                if (
                    now - p.lastWeaponAttackAt <
                    280
                ) {
                    break;
                }

                const weapon =
                    data.weapon === "gun"
                        ? "gun"
                        : data.weapon === "sword"
                            ? "sword"
                            : "none";

                if (weapon === "none") {
                    break;
                }

                const range =
                    weapon === "gun"
                        ? 30
                        : 4.8;

                const damage =
                    weapon === "gun"
                        ? 2
                        : 2;

                /* -----------------------------------------
                   MERMİ
                   ----------------------------------------- */

                if (weapon === "gun") {

                    if (p.ammo <= 0) {

                        send(ws, {
                            type: "weapon_result",
                            ok: false,
                            message: "Mermi bitti.",
                            ammo: 0
                        });

                        break;
                    }

                    p.ammo--;
                }

                p.lastWeaponAttackAt = now;

                let hit = false;

                const targetId =
                    String(
                        data.targetId || ""
                    );

                /* -----------------------------------------
                   OYUNCU HEDEFİ
                   ----------------------------------------- */

                const target =
                    players[targetId];

                if (
                    target &&
                    target.id !== p.id &&
                    target.inGame &&
                    target.alive
                ) {

                    const distance =
                        Math.hypot(
                            p.x - target.x,
                            p.z - target.z
                        );

                    if (distance <= range) {

                        target.health =
                            Math.max(
                                0,
                                target.health -
                                damage
                            );

                        hit = true;

                        send(target.ws, {
                            type: "damage_taken",
                            fromId: p.id,
                            fromName: p.name,
                            weapon,
                            damage,
                            health:
                                target.health
                        });

                        if (
                            target.health <= 0
                        ) {

                            target.health = 0;
                            target.alive = false;
                            target.inGame = true;

                            target.weapon =
                                "none";

                            target.ammo = 0;

                            send(target.ws, {
                                type: "player_died",
                                killerId: p.id,
                                killerName:
                                    p.name
                            });

                            publicSystem(
                                `${target.name}, ${p.name} tarafından yenildi.`
                            );
                        }
                    }
                }

                /* -----------------------------------------
                   HAYVAN HEDEFİ
                   ----------------------------------------- */

                const animalId =
                    String(
                        data.animalId || ""
                    );

                if (animalId) {

                    const animal =
                        ensureAnimal(
                            animalId
                        );

                    const ax =
                        clamp(
                            data.targetX,
                            -MAP_LIMIT,
                            MAP_LIMIT,
                            p.x
                        );

                    const az =
                        clamp(
                            data.targetZ,
                            -MAP_LIMIT,
                            MAP_LIMIT,
                            p.z
                        );

                    const distance =
                        Math.hypot(
                            p.x - ax,
                            p.z - az
                        );

                    if (
                        animal &&
                        animal.alive &&
                        distance <= range
                    ) {

                        animal.health =
                            Math.max(
                                0,
                                animal.health -
                                damage
                            );

                        hit = true;

                        broadcastGame({
                            type: "animal_state",
                            id: animalId,
                            health:
                                animal.health,
                            hunger:
                                animal.hunger,
                            thirst:
                                animal.thirst,
                            alive:
                                animal.alive
                        });

                        if (
                            animal.health <= 0
                        ) {
                            animal.alive = false;

                            publicSystem(
                                `${p.name} vahşi hayvanı yendi.`
                            );
                        }
                    }
                }

                send(ws, {
                    type: "weapon_result",
                    ok: true,
                    weapon,
                    hit,
                    damage,
                    ammo: p.ammo,
                    range
                });

                sendPlayers();

                break;
            }

            /* =============================================
               ESKİ ATTACK PLAYER
               ============================================= */

            case "attack_player": {

                if (!p.inGame || !p.alive) {
                    break;
                }

                if (
                    Date.now() -
                    p.lastAttackAt <
                    550
                ) {
                    break;
                }

                const targetId =
                    String(
                        data.targetId || ""
                    );

                const target =
                    players[targetId];

                if (
                    !target ||
                    !target.inGame ||
                    !target.alive ||
                    target.id === p.id
                ) {
                    break;
                }

                const distance =
                    Math.hypot(
                        p.x - target.x,
                        p.z - target.z
                    );

                if (distance > 4.8) {
                    break;
                }

                p.lastAttackAt =
                    Date.now();

                const damage = 2;

                target.health =
                    Math.max(
                        0,
                        target.health -
                        damage
                    );

                send(target.ws, {
                    type: "damage_taken",
                    fromId: p.id,
                    fromName: p.name,
                    weapon: "sword",
                    damage,
                    health:
                        target.health
                });

                if (
                    target.health <= 0
                ) {

                    target.health = 0;
                    target.alive = false;

                    target.weapon =
                        "none";

                    target.ammo = 0;

                    send(target.ws, {
                        type: "player_died",
                        killerId: p.id,
                        killerName:
                            p.name
                    });

                    publicSystem(
                        `${target.name}, ${p.name} tarafından yenildi.`
                    );
                }

                send(ws, {
                    type: "attack_result",
                    ok: true,
                    targetId,
                    damage
                });

                sendPlayers();

                break;
            }

            /* =============================================
               ANIMAL ATTACK
               ============================================= */

            case "attack_animal": {

                if (!p.inGame || !p.alive) {
                    break;
                }

                if (
                    Date.now() -
                    p.lastAttackAt <
                    550
                ) {
                    break;
                }

                const animalId =
                    String(
                        data.animalId || ""
                    );

                const animal =
                    ensureAnimal(
                        animalId
                    );

                const ax =
                    clamp(
                        data.x,
                        -MAP_LIMIT,
                        MAP_LIMIT,
                        p.x
                    );

                const az =
                    clamp(
                        data.z,
                        -MAP_LIMIT,
                        MAP_LIMIT,
                        p.z
                    );

                if (
                    !animal ||
                    !animal.alive ||
                    Math.hypot(
                        p.x - ax,
                        p.z - az
                    ) > 4.8
                ) {
                    break;
                }

                p.lastAttackAt =
                    Date.now();

                animal.health =
                    Math.max(
                        0,
                        animal.health - 1
                    );

                if (
                    animal.health === 0
                ) {
                    animal.alive = false;
                }

                broadcastGame({
                    type: "animal_state",
                    id: animalId,
                    health:
                        animal.health,
                    hunger:
                        animal.hunger,
                    thirst:
                        animal.thirst,
                    alive:
                        animal.alive
                });

                send(ws, {
                    type: "attack_result",
                    ok: true,
                    animalId,
                    damage: 1
                });

                break;
            }

            /* =============================================
               DROP ITEM
               ============================================= */

            case "drop_item": {

                if (!p.inGame || !p.alive) {
                    break;
                }

                const item =
                    String(
                        data.item || ""
                    );

                const allowed = [
                    "carrot",
                    "sword",
                    "gun",
                    "ammo",
                    "apple"
                ];

                if (
                    !allowed.includes(item)
                ) {
                    break;
                }

                /*
                 * Eşyanın yere düşeceği konum.
                 * İstemci gerçek terrain yüksekliğini
                 * hesaplayıp y gönderebilir.
                 */

                const x =
                    clamp(
                        data.x,
                        -MAP_LIMIT,
                        MAP_LIMIT,
                        p.x
                    );

                const z =
                    clamp(
                        data.z,
                        -MAP_LIMIT,
                        MAP_LIMIT,
                        p.z
                    );

                const y =
                    clamp(
                        data.y,
                        -10,
                        100,
                        p.y
                    );

                broadcastGame({
                    type: "item_dropped",
                    item,
                    ownerId: p.id,
                    x,
                    y,
                    z,
                    time: Date.now()
                });

                break;
            }

            /* =============================================
               PICKUP ITEM
               ============================================= */

            case "pickup_item": {

                if (!p.inGame || !p.alive) {
                    break;
                }

                const itemId =
                    String(
                        data.itemId || ""
                    );

                if (!itemId) {
                    break;
                }

                broadcastGame({
                    type: "item_picked",
                    itemId,
                    playerId: p.id,
                    playerName: p.name
                });

                break;
            }

            /* =============================================
               USE ITEM
               ============================================= */

            case "use_item": {

                if (!p.inGame || !p.alive) {
                    break;
                }

                const item =
                    String(
                        data.item || ""
                    );

                if (item === "carrot") {

                    p.hunger =
                        Math.min(
                            MAX_HUNGER,
                            p.hunger + 15
                        );

                    send(ws, {
                        type: "need_update",
                        hunger:
                            p.hunger,
                        thirst:
                            p.thirst,
                        health:
                            p.health
                    });
                }

                break;
            }

            /* =============================================
               DEATH / RESPAWN
               ============================================= */

            case "respawn": {

                if (!p.inGame) {
                    break;
                }

                p.alive = true;

                p.health =
                    MAX_HEALTH;

                p.hunger =
                    MAX_HUNGER;

                p.thirst =
                    MAX_THIRST;

                p.x = SPAWN.x;
                p.y = SPAWN.y;
                p.z = SPAWN.z;

                p.weapon = "none";
                p.ammo = 0;

                send(ws, {
                    type: "respawned",
                    state:
                        playerSnapshot(p),
                    spawn: SPAWN
                });

                sendPlayers();

                break;
            }

            /* =============================================
               LEAVE GAME
               ============================================= */

            case "leave_game": {

                if (p.inGame) {

                    publicSystem(
                        `${p.name || "Oyuncu"} oyundan çıktı.`
                    );
                }

                p.inGame = false;

                p.weapon = "none";
                p.ammo = 0;

                sendPlayers();

                break;
            }

            default:
                break;
        }
    });

    /* =====================================================
       DISCONNECT
       ===================================================== */

    ws.on("close", () => {

        const p =
            players[id];

        if (
            p &&
            p.inGame &&
            p.name
        ) {
            publicSystem(
                `${p.name} bağlantıyı kesti.`
            );
        }

        delete players[id];

        sendPlayers();
    });

    ws.on("error", () => {
        // close eventi temizliği yapacak.
    });
});

/* =========================================================
   İHTİYAÇ SİSTEMİ
   ========================================================= */

setInterval(() => {

    const now = Date.now();

    for (const id in players) {

        const p =
            players[id];

        if (
            !p ||
            !p.inGame ||
            !p.alive
        ) {
            continue;
        }

        const delta =
            (now - p.lastNeedTick) /
            1000;

        if (delta < 0.5) {
            continue;
        }

        p.lastNeedTick = now;

        /*
         * Açlık ve susuzluk zamanla azalır.
         */

        p.hunger =
            Math.max(
                0,
                p.hunger -
                delta * 0.7
            );

        p.thirst =
            Math.max(
                0,
                p.thirst -
                delta * 0.9
            );

        /*
         * Açlık veya susuzluk sıfırsa
         * can azalır.
         */

        let damage = 0;

        if (p.hunger <= 0) {
            damage +=
                0.5 * delta;
        }

        if (p.thirst <= 0) {
            damage +=
                0.5 * delta;
        }

        if (damage > 0) {

            p.health =
                Math.max(
                    0,
                    p.health -
                    damage
                );
        }

        if (p.health <= 0) {

            p.health = 0;
            p.alive = false;

            p.weapon = "none";
            p.ammo = 0;

            send(p.ws, {
                type: "player_died",
                reason:
                    p.hunger <= 0 &&
                    p.thirst <= 0
                        ? "açlık_ve_susuzluk"
                        : p.hunger <= 0
                            ? "açlık"
                            : "susuzluk"
            });
        }

        send(p.ws, {
            type: "need_update",
            health: p.health,
            hunger: p.hunger,
            thirst: p.thirst
        });
    }

}, 1000);

/* =========================================================
   ONLINE SAYISI
   ========================================================= */

setInterval(() => {

    const online =
        Object.values(players)
            .filter(
                p =>
                    p &&
                    p.inGame
            )
            .length;

    broadcast({
        type: "online_count",
        count: online
    });

}, 1000);

/* =========================================================
   HEALTH CHECK
   ========================================================= */

app.get("/health", (req, res) => {

    res.json({
        ok: true,
        version: APP_VERSION,
        players:
            Object.values(players)
                .filter(
                    p =>
                        p &&
                        p.inGame
                )
                .length,
        uptime:
            process.uptime()
    });

});

/* =========================================================
   ROOT
   ========================================================= */

app.get("/", (req, res) => {

    res.send(
        "EsekGames Server çalışıyor."
    );

});

/* =========================================================
   STATIK DOSYALAR
   ========================================================= */

app.use(
    express.static(
        path.join(__dirname)
    )
);

/* =========================================================
   404
   ========================================================= */

app.use((req, res) => {

    res.status(404).json({
        message: "Bulunamadı."
    });

});

/* =========================================================
   SERVER START
   ========================================================= */

server.listen(PORT, "0.0.0.0", () => {

    console.log(
        `EsekGames server ${PORT} portunda çalışıyor.`
    );

    console.log(
        `Sürüm: ${APP_VERSION}`
    );

});
