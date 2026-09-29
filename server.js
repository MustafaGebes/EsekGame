const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({
    server,
    maxPayload: 24 * 1024
});

app.use(express.json({ limit: "32kb" }));

/* =========================================================
   HESAP SİSTEMİ
========================================================= */

const ACCOUNTS_FILE = path.join(__dirname, "accounts.json");

let accounts = {};

try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
        accounts =
            JSON.parse(
                fs.readFileSync(ACCOUNTS_FILE, "utf8")
            ) || {};
    }
} catch (error) {
    console.warn(
        "accounts.json okunamadı:",
        error.message
    );

    accounts = {};
}

function saveAccounts() {
    try {
        fs.writeFileSync(
            ACCOUNTS_FILE,
            JSON.stringify(accounts, null, 2),
            "utf8"
        );
    } catch (error) {
        console.error(
            "accounts.json kaydedilemedi:",
            error.message
        );
    }
}

function normalizeUsername(value) {
    return String(value || "")
        .trim()
        .normalize("NFKC")
        .toLocaleLowerCase("tr-TR");
}

function validUsername(value) {
    return /^[A-Za-z0-9_çğıöşüÇĞİÖŞÜ-]{3,20}$/.test(
        String(value || "")
    );
}

function hashPassword(password, salt) {
    return crypto
        .scryptSync(String(password), salt, 64)
        .toString("hex");
}

function createAccount(username, password) {
    const salt = crypto
        .randomBytes(16)
        .toString("hex");

    return {
        username: username,
        salt: salt,
        passwordHash: hashPassword(
            password,
            salt
        ),
        token: crypto
            .randomBytes(32)
            .toString("hex")
    };
}

function findAccountByToken(token) {
    if (!token) {
        return null;
    }

    return (
        Object.values(accounts).find(
            account =>
                account &&
                account.token === token
        ) || null
    );
}

/* =========================================================
   KAYIT
========================================================= */

app.post(
    "/api/auth/register",
    (req, res) => {
        try {
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
                    ok: false,
                    message:
                        "Kullanıcı adı 3-20 karakter olmalı. Harf, rakam, _ ve - kullanabilirsin."
                });
            }

            if (password.length < 6) {
                return res.status(400).json({
                    ok: false,
                    message:
                        "Şifre en az 6 karakter olmalı."
                });
            }

            if (password !== passwordConfirm) {
                return res.status(400).json({
                    ok: false,
                    message:
                        "Şifreler aynı değil."
                });
            }

            const key =
                normalizeUsername(username);

            if (accounts[key]) {
                return res.status(409).json({
                    ok: false,
                    message:
                        "Bu kullanıcı adı zaten alınmış."
                });
            }

            const account =
                createAccount(
                    username,
                    password
                );

            accounts[key] = account;

            saveAccounts();

            return res.json({
                ok: true,
                username: account.username,
                token: account.token
            });
        } catch (error) {
            console.error(
                "Kayıt hatası:",
                error
            );

            return res.status(500).json({
                ok: false,
                message:
                    "Hesap oluşturulurken sunucu hatası oluştu."
            });
        }
    }
);

/* =========================================================
   GİRİŞ
========================================================= */

app.post(
    "/api/auth/login",
    (req, res) => {
        try {
            const username = String(
                req.body?.username || ""
            ).trim();

            const password = String(
                req.body?.password || ""
            );

            const account =
                accounts[
                    normalizeUsername(username)
                ];

            if (!account) {
                return res.status(401).json({
                    ok: false,
                    message:
                        "Kullanıcı adı veya şifre hatalı."
                });
            }

            const passwordHash =
                hashPassword(
                    password,
                    account.salt
                );

            const storedHash =
                Buffer.from(
                    account.passwordHash,
                    "hex"
                );

            const receivedHash =
                Buffer.from(
                    passwordHash,
                    "hex"
                );

            if (
                storedHash.length !==
                receivedHash.length ||
                !crypto.timingSafeEqual(
                    storedHash,
                    receivedHash
                )
            ) {
                return res.status(401).json({
                    ok: false,
                    message:
                        "Kullanıcı adı veya şifre hatalı."
                });
            }

            account.token =
                crypto
                    .randomBytes(32)
                    .toString("hex");

            saveAccounts();

            return res.json({
                ok: true,
                username: account.username,
                token: account.token
            });
        } catch (error) {
            console.error(
                "Giriş hatası:",
                error
            );

            return res.status(500).json({
                ok: false,
                message:
                    "Giriş yapılırken sunucu hatası oluştu."
            });
        }
    }
);

/* =========================================================
   DOSYALAR
========================================================= */

app.use(
    express.static(__dirname)
);

app.get(
    "/",
    (req, res) => {
        res.sendFile(
            path.join(
                __dirname,
                "index.html"
            )
        );
    }
);

app.get(
    "/health",
    (req, res) => {
        res.json({
            ok: true,
            players: activePlayerCount()
        });
    }
);

/* =========================================================
   OYUN DEĞİŞKENLERİ
========================================================= */

const players = Object.create(null);

const appleTrees = new Map();

const wildAnimals = new Map();

let chatHistory = [];

let guestCounter = 0;

const CHAT_RESET_MS =
    10 * 60 * 1000;

const APPLE_GROW_MS =
    5 * 60 * 1000;

const CHAT_LIMIT = 100;

const MAX_NEED = 9;

const MAP_LIMIT = 510;

const SPAWN = {
    x: 180,
    y: 0,
    z: 210
};

const FOREST_POND = {
    x: 300,
    z: -8,
    radius: 14
};

/* =========================================================
   GUEST İSİMLERİ
========================================================= */

function nextGuestName() {
    const number = guestCounter++;

    return (
        "Guest-" +
        String(number).padStart(3, "0")
    );
}

/* =========================================================
   GENEL FONKSİYONLAR
========================================================= */

function activePlayerCount() {
    return Object.values(players)
        .filter(player => player.inGame)
        .length;
}

function send(ws, payload) {
    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {
        ws.send(
            JSON.stringify(payload)
        );
    }
}

function broadcast(payload) {
    const encoded =
        JSON.stringify(payload);

    for (
        const client of wss.clients
    ) {
        if (
            client.readyState ===
            WebSocket.OPEN
        ) {
            client.send(encoded);
        }
    }
}

function clamp(
    value,
    min,
    max,
    fallback = min
) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return fallback;
    }

    return Math.max(
        min,
        Math.min(max, number)
    );
}

function cleanName(value) {
    const name = String(
        value ?? ""
    )
        .replace(
            /[\u0000-\u001f\u007f]/g,
            ""
        )
        .trim()
        .slice(0, 20);

    return name || "Player";
}

function nameKey(value) {
    return cleanName(value)
        .normalize("NFKC")
        .toLocaleLowerCase("tr-TR");
}

function cleanText(
    value,
    limit = 220
) {
    return String(
        value ?? ""
    )
        .replace(
            /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,
            ""
        )
        .trim()
        .slice(0, limit);
}

/* =========================================================
   OYUNCU SNAPSHOT
========================================================= */

function playerSnapshot(player) {
    return {
        x: player.x,
        y: player.y,
        z: player.z,

        yaw: player.yaw,
        pitch: player.pitch,

        isCrouching:
            player.isCrouching,

        isMoving:
            player.isMoving,

        isJumping:
            player.isJumping,

        name: player.name,

        platform:
            player.platform,

        pingMs:
            player.pingMs,

        inGame:
            player.inGame,

        alive:
            player.alive,

        health:
            player.health,

        hunger:
            player.hunger,

        thirst:
            player.thirst
    };
}

function sendPlayers() {
    const publicPlayers =
        Object.create(null);

    for (
        const [id, player]
        of Object.entries(players)
    ) {
        publicPlayers[id] =
            playerSnapshot(player);
    }

    broadcast({
        type: "players",
        players: publicPlayers,
        count: activePlayerCount()
    });
}

/* =========================================================
   CHAT
========================================================= */

function publicSystem(text) {
    const message = {
        id:
            "sys-" +
            Date.now() +
            "-" +
            crypto
                .randomBytes(3)
                .toString("hex"),

        system: true,

        name: "Sistem",

        text: cleanText(
            text,
            220
        ),

        time:
            new Date().toISOString()
    };

    chatHistory.push(message);

    if (
        chatHistory.length >
        CHAT_LIMIT
    ) {
        chatHistory =
            chatHistory.slice(
                -CHAT_LIMIT
            );
    }

    broadcast({
        type: "chat_message",
        message
    });
}

function parseWhisper(text) {
    const quoted =
        text.match(
            /^\/msg\s+(\S+)\s+"([\s\S]{1,220})"\s*$/i
        );

    if (quoted) {
        return {
            target:
                cleanName(quoted[1]),

            text:
                cleanText(quoted[2])
        };
    }

    const plain =
        text.match(
            /^\/msg\s+(\S+)\s+([\s\S]{1,220})$/i
        );

    if (plain) {
        return {
            target:
                cleanName(plain[1]),

            text:
                cleanText(plain[2])
        };
    }

    return null;
}

/* =========================================================
   İHTİYAÇLAR
========================================================= */

function sendNeeds(id) {
    const player =
        players[id];

    if (!player) {
        return;
    }

    send(
        player.ws,
        {
            type: "needs",

            health:
                player.health,

            hunger:
                player.hunger,

            thirst:
                player.thirst,

            alive:
                player.alive
        }
    );
}

/* =========================================================
   ÖLÜM
========================================================= */

function killPlayer(
    victimId,
    killerId,
    cause
) {
    const victim =
        players[victimId];

    if (
        !victim ||
        !victim.alive
    ) {
        return;
    }

    victim.health = 0;

    victim.alive = false;

    victim.lastKiller =
        killerId || null;

    const killerName =
        killerId &&
        players[killerId]
            ? players[killerId].name
            : null;

    const reason =
        cause ||
        (
            killerName
                ? `${victim.name}, ${killerName} tarafından öldürüldü.`
                : `${victim.name} hayatını kaybetti.`
        );

    publicSystem(reason);

    broadcast({
        type: "player_death",

        id: victimId,

        killerId:
            killerId || null,

        killerName:
            killerName || null,

        reason
    });
}

/* =========================================================
   AKTİF İSİM KONTROLÜ
========================================================= */

function findActiveName(
    name,
    exceptId
) {
    const key =
        nameKey(name);

    return Object.entries(
        players
    ).find(
        ([id, player]) =>
            id !== exceptId &&
            player.inGame &&
            nameKey(player.name) ===
                key
    );
}

/* =========================================================
   ELMA AĞAÇLARI
========================================================= */

function appleState(
    treeId,
    x,
    z
) {
    let state =
        appleTrees.get(treeId);

    const now =
        Date.now();

    if (!state) {
        state = {
            id: treeId,

            x: clamp(
                x,
                -400,
                400
            ),

            z: clamp(
                z,
                -400,
                400
            ),

            apples: 6,

            lastGrowAt: now
        };

        appleTrees.set(
            treeId,
            state
        );
    }

    const elapsed =
        Math.floor(
            (
                now -
                state.lastGrowAt
            ) /
                APPLE_GROW_MS
        );

    if (elapsed > 0) {
        state.apples =
            Math.min(
                10,
                state.apples +
                    elapsed
            );

        state.lastGrowAt +=
            elapsed *
            APPLE_GROW_MS;
    }

    return state;
}

/* =========================================================
   HAYVANLAR
========================================================= */

function validAnimalId(id) {
    return /^forest-(wolf|deer|rabbit|boar|fox|goat)-\d{1,3}$/.test(
        String(id || "")
    );
}

function ensureAnimal(id) {
    if (!validAnimalId(id)) {
        return null;
    }

    if (!wildAnimals.has(id)) {
        wildAnimals.set(
            id,
            {
                id,

                health: 9,

                hunger: 9,

                thirst: 9,

                alive: true,

                lastNeedTick:
                    Date.now(),

                lastStarveDamageAt: 0,

                lastCareAt: 0
            }
        );
    }

    return wildAnimals.get(id);
}

function animalLabel(id) {
    const kind =
        String(id).split("-")[1];

    return (
        {
            wolf: "Kurt",
            deer: "Geyik",
            rabbit: "Tavşan",
            boar: "Yaban domuzu",
            fox: "Tilki",
            goat: "Keçi"
        }[kind] ||
        "Vahşi hayvan"
    );
}

/* =========================================================
   WEBSOCKET
========================================================= */

wss.on(
    "connection",
    ws => {
        const id =
            crypto
                .randomBytes(5)
                .toString("hex");

        console.log(
            "Oyuncu bağlandı:",
            id
        );

        players[id] = {
            ws,

            x: SPAWN.x,
            y: SPAWN.y,
            z: SPAWN.z,

            yaw: 0,
            pitch: 0,

            isCrouching: false,
            isMoving: false,
            isJumping: false,

            /*
             * Oyuncu henüz oyuna girmedi.
             * Guest numarası burada alınmıyor.
             */
            name: null,

            accountUsername: null,

            platform: "pc",

            pingMs: null,

            inGame: false,

            alive: true,

            health: MAX_NEED,

            hunger: MAX_NEED,

            thirst: MAX_NEED,

            lastNeedTick:
                Date.now(),

            lastAttackAt: 0,

            lastAnimalAttackAt: 0,

            lastChatAt: 0,

            lastStarveDamageAt: 0
        };

        send(
            ws,
            {
                type: "init",
                id
            }
        );

        send(
            ws,
            {
                type: "chat_history",
                messages:
                    chatHistory.slice(-50)
            }
        );

        sendPlayers();

        ws.on(
            "message",
            raw => {
                try {
                    const data =
                        JSON.parse(
                            raw.toString()
                        );

                    const player =
                        players[id];

                    if (
                        !player ||
                        !data ||
                        typeof data.type !==
                            "string"
                    ) {
                        return;
                    }

                    switch (
                        data.type
                    ) {

                        /* =========================
                           PLATFORM
                        ========================= */

                        case "profile": {
                            player.platform =
                                data.platform ===
                                "mobile"
                                    ? "mobile"
                                    : "pc";

                            break;
                        }

                        /* =========================
                           OYUNA GİR
                        ========================= */

                        case "join_request": {
                            const account =
                                findAccountByToken(
                                    String(
                                        data.token ||
                                            ""
                                    )
                                );

                            /*
                             * Hesaplı oyuncu:
                             * hesap kullanıcı adı.
                             *
                             * Misafir:
                             * yeni Guest numarası.
                             */
                            const candidate =
                                account
                                    ? cleanName(
                                          account.username
                                      )
                                    : nextGuestName();

                            const duplicate =
                                findActiveName(
                                    candidate,
                                    id
                                );

                            if (duplicate) {
                                send(
                                    ws,
                                    {
                                        type:
                                            "join_denied",

                                        message:
                                            "Bu kullanıcı adı şu anda oyunda kullanılıyor."
                                    }
                                );

                                break;
                            }

                            if (
                                !player.alive &&
                                player.inGame
                            ) {
                                send(
                                    ws,
                                    {
                                        type:
                                            "join_denied",

                                        message:
                                            "Ölüm ekranından yeniden doğ veya önce menüye dön."
                                    }
                                );

                                break;
                            }

                            if (
                                !player.alive
                            ) {
                                player.health =
                                    MAX_NEED;

                                player.hunger =
                                    MAX_NEED;

                                player.thirst =
                                    MAX_NEED;

                                player.alive =
                                    true;
                            }

                            player.name =
                                candidate;

                            player.accountUsername =
                                account
                                    ? account.username
                                    : null;

                            player.platform =
                                data.platform ===
                                "mobile"
                                    ? "mobile"
                                    : "pc";

                            player.inGame =
                                true;

                            player.lastNeedTick =
                                Date.now();

                            send(
                                ws,
                                {
                                    type:
                                        "join_accepted",

                                    id,

                                    state:
                                        playerSnapshot(
                                            player
                                        ),

                                    spawn:
                                        SPAWN
                                }
                            );

                            sendPlayers();

                            break;
                        }

                        /* =========================
                           MENÜDEN ÇIKIŞ
                        ========================= */

                        case "presence": {
                            player.platform =
                                data.platform ===
                                "mobile"
                                    ? "mobile"
                                    : "pc";

                            /*
                             * ESC ile duraklatma sırasında
                             * client presence:false göndermemeli.
                             *
                             * Gerçekten oyundan çıkarken
                             * false gönderilebilir.
                             */
                            if (
                                data.active !== true
                            ) {
                                player.inGame =
                                    false;
                            }

                            sendPlayers();

                            break;
                        }

                        /* =========================
                           HAREKET
                        ========================= */

                        case "move": {
                            if (
                                !player.inGame ||
                                !player.alive
                            ) {
                                break;
                            }

                            player.x =
                                clamp(
                                    data.x,
                                    -MAP_LIMIT,
                                    MAP_LIMIT,
                                    player.x
                                );

                            player.y =
                                clamp(
                                    data.y,
                                    -10,
                                    100,
                                    player.y
                                );

                            player.z =
                                clamp(
                                    data.z,
                                    -MAP_LIMIT,
                                    MAP_LIMIT,
                                    player.z
                                );

                            player.yaw =
                                clamp(
                                    data.yaw,
                                    -Math.PI * 20,
                                    Math.PI * 20,
                                    player.yaw
                                );

                            player.pitch =
                                clamp(
                                    data.pitch,
                                    -2,
                                    2,
                                    player.pitch
                                );

                            player.isCrouching =
                                data.isCrouching ===
                                true;

                            player.isMoving =
                                data.isMoving ===
                                true;

                            player.isJumping =
                                data.isJumping ===
                                true;

                            if (
                                data.pingMs !==
                                undefined &&
                                Number.isFinite(
                                    Number(
                                        data.pingMs
                                    )
                                )
                            ) {
                                player.pingMs =
                                    clamp(
                                        data.pingMs,
                                        0,
                                        10000
                                    );
                            }

                            break;
                        }

                        /* =========================
                           PING
                        ========================= */

                        case "ping": {
                            send(
                                ws,
                                {
                                    type: "pong",
                                    timestamp:
                                        Number(
                                            data.timestamp
                                        )
                                }
                            );

                            break;
                        }

                        case "ping_result": {
                            if (
                                Number.isFinite(
                                    Number(
                                        data.pingMs
                                    )
                                )
                            ) {
                                player.pingMs =
                                    clamp(
                                        data.pingMs,
                                        0,
                                        10000
                                    );
                            }

                            break;
                        }

                        /* =========================
                           CHAT HISTORY
                        ========================= */

                        case "chat_history": {
                            send(
                                ws,
                                {
                                    type:
                                        "chat_history",

                                    messages:
                                        chatHistory.slice(
                                            -50
                                        )
                                }
                            );

                            break;
                        }

                        /* =========================
                           CHAT
                        ========================= */

                        case "chat": {
                            if (
                                !player.inGame ||
                                !player.alive
                            ) {
                                break;
                            }

                            const now =
                                Date.now();

                            if (
                                now -
                                    player.lastChatAt <
                                450
                            ) {
                                break;
                            }

                            const rawText =
                                cleanText(
                                    data.text
                                );

                            if (!rawText) {
                                break;
                            }

                            player.lastChatAt =
                                now;

                            /*
                             * Özel mesaj
                             */
                            if (
                                /^\/msg\b/i.test(
                                    rawText
                                )
                            ) {
                                const whisper =
                                    parseWhisper(
                                        rawText
                                    );

                                if (!whisper) {
                                    send(
                                        ws,
                                        {
                                            type:
                                                "chat_error",

                                            message:
                                                'Kullanım: /msg OyuncuAdı "mesaj"'
                                        }
                                    );

                                    break;
                                }

                                const target =
                                    Object.entries(
                                        players
                                    ).find(
                                        ([
                                            targetId,
                                            targetPlayer
                                        ]) =>
                                            targetId !==
                                                id &&
                                            targetPlayer.inGame &&
                                            targetPlayer.alive &&
                                            nameKey(
                                                targetPlayer.name
                                            ) ===
                                                nameKey(
                                                    whisper.target
                                                )
                                    );

                                if (!target) {
                                    send(
                                        ws,
                                        {
                                            type:
                                                "chat_error",

                                            message:
                                                `${whisper.target} adlı oyuncu şu an oyunda değil.`
                                        }
                                    );

                                    break;
                                }

                                const message = {
                                    id:
                                        "whisper-" +
                                        now +
                                        "-" +
                                        id,

                                    clientId:
                                        cleanText(
                                            data.clientId,
                                            80
                                        ),

                                    private: true,

                                    fromId: id,

                                    toId:
                                        target[0],

                                    name:
                                        player.name,

                                    toName:
                                        target[1].name,

                                    text:
                                        whisper.text,

                                    time:
                                        new Date(
                                            now
                                        ).toISOString()
                                };

                                send(
                                    ws,
                                    {
                                        type:
                                            "chat_message",

                                        message
                                    }
                                );

                                send(
                                    target[1].ws,
                                    {
                                        type:
                                            "chat_message",

                                        message
                                    }
                                );

                                break;
                            }

                            const message = {
                                id:
                                    now +
                                    "-" +
                                    id,

                                clientId:
                                    cleanText(
                                        data.clientId,
                                        80
                                    ),

                                name:
                                    player.name,

                                platform:
                                    player.platform,

                                text:
                                    rawText,

                                time:
                                    new Date(
                                        now
                                    ).toISOString()
                            };

                            chatHistory.push(
                                message
                            );

                            if (
                                chatHistory.length >
                                CHAT_LIMIT
                            ) {
                                chatHistory =
                                    chatHistory.slice(
                                        -CHAT_LIMIT
                                    );
                            }

                            broadcast({
                                type:
                                    "chat_message",

                                message
                            });

                            break;
                        }

                        /* =========================
                           ELMA DURUMU
                        ========================= */

                        case "apple_state_request": {
                            const states = {};

                            const trees =
                                Array.isArray(
                                    data.trees
                                )
                                    ? data.trees.slice(
                                          0,
                                          240
                                      )
                                    : [];

                            for (
                                const item of trees
                            ) {
                                const treeId =
                                    String(
                                        item.id ||
                                            ""
                                    );

                                if (
                                    !/^apple-[A-Za-z0-9_-]{1,40}$/.test(
                                        treeId
                                    )
                                ) {
                                    continue;
                                }

                                const state =
                                    appleState(
                                        treeId,
                                        item.x,
                                        item.z
                                    );

                                states[
                                    treeId
                                ] =
                                    state.apples;
                            }

                            send(
                                ws,
                                {
                                    type:
                                        "apple_states",

                                    states
                                }
                            );

                            break;
                        }

                        /* =========================
                           ELMA TOPLA
                        ========================= */

                        case "apple_pick": {
                            if (
                                !player.inGame ||
                                !player.alive
                            ) {
                                break;
                            }

                            const treeId =
                                String(
                                    data.treeId ||
                                        ""
                                );

                            const state =
                                appleTrees.get(
                                    treeId
                                );

                            const distance =
                                state
                                    ? Math.hypot(
                                          player.x -
                                              state.x,
                                          player.z -
                                              state.z
                                      )
                                    : Infinity;

                            if (
                                !state ||
                                distance > 6 ||
                                state.apples <= 0
                            ) {
                                send(
                                    ws,
                                    {
                                        type:
                                            "apple_pick_result",

                                        ok: false,

                                        treeId,

                                        message:
                                            "Elma kalmadı veya ağaca yaklaşmalısın."
                                    }
                                );

                                break;
                            }

                            state.apples--;

                            player.hunger =
                                Math.min(
                                    MAX_NEED,
                                    player.hunger +
                                        1.5
                                );

                            broadcast({
                                type:
                                    "apple_update",

                                treeId,

                                apples:
                                    state.apples
                            });

                            send(
                                ws,
                                {
                                    type:
                                        "apple_pick_result",

                                    ok: true,

                                    treeId,

                                    apples:
                                        state.apples,

                                    health:
                                        player.health,

                                    hunger:
                                        player.hunger,

                                    thirst:
                                        player.thirst
                                }
                            );

                            break;
                        }

                        /* =========================
                           SU İÇ
                        ========================= */

                        case "drink": {
                            if (
                                !player.inGame ||
                                !player.alive
                            ) {
                                break;
                            }

                            const atBeachWater =
                                player.x >= -310 &&
                                player.x <= -35 &&
                                player.z >= -459 &&
                                player.z <= -444;

                            const atForestPond =
                                Math.hypot(
                                    player.x -
                                        FOREST_POND.x,
                                    player.z -
                                        FOREST_POND.z
                                ) <=
                                FOREST_POND.radius +
                                    4;

                            if (
                                !atBeachWater &&
                                !atForestPond
                            ) {
                                send(
                                    ws,
                                    {
                                        type:
                                            "action_denied",

                                        action:
                                            "drink",

                                        message:
                                            "Suya biraz daha yaklaş."
                                    }
                                );

                                break;
                            }

                            player.thirst =
                                Math.min(
                                    MAX_NEED,
                                    player.thirst +
                                        2
                                );

                            send(
                                ws,
                                {
                                    type:
                                        "action_ok",

                                    action:
                                        "drink",

                                    health:
                                        player.health,

                                    hunger:
                                        player.hunger,

                                    thirst:
                                        player.thirst
                                }
                            );

                            break;
                        }

                        /* =========================
                           OYUNCUYA SALDIR
                        ========================= */

                        case "attack_player": {
                            if (
                                !player.inGame ||
                                !player.alive
                            ) {
                                break;
                            }

                            if (
                                Date.now() -
                                    player.lastAttackAt <
                                550
                            ) {
                                break;
                            }

                            player.lastAttackAt =
                                Date.now();

                            const target =
                                players[
                                    String(
                                        data.targetId ||
                                            ""
                                    )
                                ];

                            if (
                                !target ||
                                !target.inGame ||
                                !target.alive ||
                                target === player
                            ) {
                                break;
                            }

                            const distance =
                                Math.hypot(
                                    player.x -
                                        target.x,
                                    player.z -
                                        target.z
                                );

                            if (
                                distance > 4
                            ) {
                                send(
                                    ws,
                                    {
                                        type:
                                            "attack_result",

                                        ok: false,

                                        message:
                                            "Vurmak için yaklaş."
                                    }
                                );

                                break;
                            }

                            const damage = 1;

                            target.health =
                                Math.max(
                                    0,
                                    target.health -
                                        damage
                                );

                            broadcast({
                                type:
                                    "combat_hit",

                                attackerId:
                                    id,

                                targetId:
                                    data.targetId,

                                damage,

                                health:
                                    target.health,

                                targetName:
                                    target.name
                            });

                            sendNeeds(
                                String(
                                    data.targetId
                                )
                            );

                            if (
                                target.health <=
                                0
                            ) {
                                killPlayer(
                                    String(
                                        data.targetId
                                    ),
                                    id,
                                    `${target.name}, ${player.name} tarafından öldürüldü.`
                                );
                            }

                            send(
                                ws,
                                {
                                    type:
                                        "attack_result",

                                    ok: true,

                                    targetId:
                                        data.targetId,

                                    damage
                                }
                            );

                            break;
                        }

                        /* =========================
                           HAYVANA SALDIR
                        ========================= */

                        case "attack_animal": {
                            if (
                                !player.inGame ||
                                !player.alive
                            ) {
                                break;
                            }

                            if (
                                Date.now() -
                                    player.lastAttackAt <
                                550
                            ) {
                                break;
                            }

                            const animalId =
                                String(
                                    data.animalId ||
                                        ""
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
                                    player.x
                                );

                            const az =
                                clamp(
                                    data.z,
                                    -MAP_LIMIT,
                                    MAP_LIMIT,
                                    player.z
                                );

                            if (
                                !animal ||
                                !animal.alive ||
                                Math.hypot(
                                    player.x -
                                        ax,
                                    player.z -
                                        az
                                ) > 4
                            ) {
                                break;
                            }

                            player.lastAttackAt =
                                Date.now();

                            animal.health =
                                Math.max(
                                    0,
                                    animal.health -
                                        1
                                );

                            if (
                                animal.health ===
                                0
                            ) {
                                animal.alive =
                                    false;
                            }

                            broadcast({
                                type:
                                    "animal_state",

                                id:
                                    animalId,

                                health:
                                    animal.health,

                                hunger:
                                    animal.hunger,

                                thirst:
                                    animal.thirst,

                                alive:
                                    animal.alive
                            });

                            send(
                                ws,
                                {
                                    type:
                                        "attack_result",

                                    ok: true,

                                    animalId,

                                    damage: 1
                                }
                            );

                            if (
                                !animal.alive
                            ) {
                                publicSystem(
                                    `${player.name}, ${String(
                                        data.animalName ||
                                            "bir vahşi hayvan"
                                    )} adlı hayvanı yendi.`
                                );
                            }

                            break;
                        }

                        /* =========================
                           HAYVAN SALDIRISI
                        ========================= */

                        case "animal_attack": {
                            if (
                                !player.inGame ||
                                !player.alive
                            ) {
                                break;
                            }

                            if (
                                Date.now() -
                                    player.lastAnimalAttackAt <
                                1800
                            ) {
                                break;
                            }

                            const animalId =
                                String(
                                    data.animalId ||
                                        ""
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
                                    player.x
                                );

                            const az =
                                clamp(
                                    data.z,
                                    -MAP_LIMIT,
                                    MAP_LIMIT,
                                    player.z
                                );

                            if (
                                !animal ||
                                !animal.alive ||
                                Math.hypot(
                                    player.x -
                                        ax,
                                    player.z -
                                        az
                                ) > 3.2
                            ) {
                                break;
                            }

                            player.lastAnimalAttackAt =
                                Date.now();

                            player.health =
                                Math.max(
                                    0,
                                    player.health -
                                        0.5
                                );

                            broadcast({
                                type:
                                    "animal_bite",

                                animalId,

                                targetId:
                                    id,

                                damage: 0.5,

                                health:
                                    player.health
                            });

                            sendNeeds(id);

                            if (
                                player.health <=
                                0
                            ) {
                                killPlayer(
                                    id,
                                    null,
                                    `${player.name} vahşi hayvanların saldırısında hayatını kaybetti.`
                                );
                            }

                            break;
                        }

                        /* =========================
                           HAYVAN BESLE / SU VER
                        ========================= */

                        case "animal_care": {
                            if (
                                !player.inGame ||
                                !player.alive
                            ) {
                                break;
                            }

                            const animal =
                                ensureAnimal(
                                    String(
                                        data.animalId ||
                                            ""
                                    )
                                );

                            if (
                                !animal ||
                                !animal.alive ||
                                Date.now() -
                                    animal.lastCareAt <
                                    8000
                            ) {
                                break;
                            }

                            const x =
                                clamp(
                                    data.x,
                                    -MAP_LIMIT,
                                    MAP_LIMIT,
                                    player.x
                                );

                            const z =
                                clamp(
                                    data.z,
                                    -MAP_LIMIT,
                                    MAP_LIMIT,
                                    player.z
                                );

                            if (
                                data.action ===
                                "eat"
                            ) {
                                if (
                                    Math.hypot(
                                        x - 220,
                                        z + 55
                                    ) > 150
                                ) {
                                    break;
                                }

                                animal.hunger =
                                    Math.min(
                                        MAX_NEED,
                                        animal.hunger +
                                            1
                                    );
                            } else if (
                                data.action ===
                                "drink"
                            ) {
                                const atPond =
                                    Math.hypot(
                                        x -
                                            FOREST_POND.x,
                                        z -
                                            FOREST_POND.z
                                    ) <=
                                    FOREST_POND.radius +
                                        4;

                                const atBeach =
                                    x >= -310 &&
                                    x <= -35 &&
                                    z >= -459 &&
                                    z <= -444;

                                if (
                                    !atPond &&
                                    !atBeach
                                ) {
                                    break;
                                }

                                animal.thirst =
                                    Math.min(
                                        MAX_NEED,
                                        animal.thirst +
                                            1.25
                                    );
                            } else {
                                break;
                            }

                            animal.lastCareAt =
                                Date.now();

                            broadcast({
                                type:
                                    "animal_state",

                                id:
                                    animal.id,

                                health:
                                    animal.health,

                                hunger:
                                    animal.hunger,

                                thirst:
                                    animal.thirst,

                                alive:
                                    animal.alive,

                                care:
                                    data.action
                            });

                            break;
                        }

                        /* =========================
                           HAYVAN DURUMLARI
                        ========================= */

                        case "animal_states_request": {
                            const states = {};

                            const ids =
                                Array.isArray(
                                    data.ids
                                )
                                    ? data.ids.slice(
                                          0,
                                          80
                                      )
                                    : [];

                            for (
                                const animalId of ids
                            ) {
                                const state =
                                    ensureAnimal(
                                        animalId
                                    );

                                if (state) {
                                    states[
                                        animalId
                                    ] = {
                                        health:
                                            state.health,

                                        hunger:
                                            state.hunger,

                                        thirst:
                                            state.thirst,

                                        alive:
                                            state.alive
                                    };
                                }
                            }

                            send(
                                ws,
                                {
                                    type:
                                        "animal_states",

                                    states
                                }
                            );

                            break;
                        }

                        /* =========================
                           YENİDEN DOĞ
                        ========================= */

                        case "respawn": {
                            if (
                                !player.inGame ||
                                player.alive
                            ) {
                                break;
                            }

                            player.alive =
                                true;

                            player.health =
                                MAX_NEED;

                            player.hunger =
                                MAX_NEED;

                            player.thirst =
                                MAX_NEED;

                            player.x =
                                SPAWN.x;

                            player.y =
                                SPAWN.y;

                            player.z =
                                SPAWN.z;

                            player.lastNeedTick =
                                Date.now();

                            send(
                                ws,
                                {
                                    type:
                                        "respawned",

                                    spawn:
                                        SPAWN,

                                    state:
                                        playerSnapshot(
                                            player
                                        )
                                }
                            );

                            sendPlayers();

                            break;
                        }

                        default:
                            break;
                    }
                } catch (error) {
                    console.warn(
                        "Geçersiz istemci mesajı:",
                        error.message
                    );
                }
            }
        );

        ws.on(
            "close",
            () => {
                delete players[id];

                console.log(
                    "Oyuncu ayrıldı:",
                    id
                );

                sendPlayers();
            }
        );

        ws.on(
            "error",
            error => {
                console.warn(
                    "WebSocket hatası:",
                    error.message
                );
            }
        );
    }
);

/* =========================================================
   OYUNCU AÇLIK / SUSUZLUK SİSTEMİ
========================================================= */

setInterval(
    () => {
        const now =
            Date.now();

        for (
            const player
            of Object.values(players)
        ) {
            if (
                !player.inGame ||
                !player.alive
            ) {
                continue;
            }

            const elapsed =
                now -
                player.lastNeedTick;

            const steps =
                Math.floor(
                    elapsed /
                        30000
                );

            if (!steps) {
                continue;
            }

            player.lastNeedTick +=
                steps * 30000;

            player.hunger =
                Math.max(
                    0,
                    player.hunger -
                        0.25 * steps
                );

            player.thirst =
                Math.max(
                    0,
                    player.thirst -
                        0.5 * steps
                );

            if (
                (
                    player.hunger <= 0 ||
                    player.thirst <= 0
                ) &&
                now -
                    (
                        player.lastStarveDamageAt ||
                        0
                    ) >=
                    30000
            ) {
                player.health =
                    Math.max(
                        0,
                        player.health -
                            0.5
                    );

                player.lastStarveDamageAt =
                    now;

                if (
                    player.health <= 0
                ) {
                    const cause =
                        player.thirst <= 0
                            ? "susuzluktan"
                            : "açlıktan";

                    killPlayer(
                        Object.keys(
                            players
                        ).find(
                            key =>
                                players[key] ===
                                player
                        ),
                        null,
                        `${player.name} ${cause} hayatını kaybetti.`
                    );
                }
            }

            const playerId =
                Object.keys(
                    players
                ).find(
                    key =>
                        players[key] ===
                        player
                );

            sendNeeds(
                playerId
            );
        }
    },
    1000
);

/* =========================================================
   HAYVAN AÇLIK / SUSUZLUK
========================================================= */

setInterval(
    () => {
        const now =
            Date.now();

        const hasPlayers =
            Object.values(
                players
            ).some(
                player =>
                    player.inGame &&
                    player.alive
            );

        for (
            const animal
            of wildAnimals.values()
        ) {
            if (
                !hasPlayers ||
                !animal.alive
            ) {
                animal.lastNeedTick =
                    now;

                continue;
            }

            const steps =
                Math.floor(
                    (
                        now -
                        animal.lastNeedTick
                    ) /
                        30000
                );

            if (!steps) {
                continue;
            }

            animal.lastNeedTick +=
                steps * 30000;

            animal.hunger =
                Math.max(
                    0,
                    animal.hunger -
                        0.25 * steps
                );

            animal.thirst =
                Math.max(
                    0,
                    animal.thirst -
                        0.5 * steps
                );

            if (
                (
                    animal.hunger <= 0 ||
                    animal.thirst <= 0
                ) &&
                now -
                    animal.lastStarveDamageAt >=
                    30000
            ) {
                animal.health =
                    Math.max(
                        0,
                        animal.health -
                            0.5
                    );

                animal.lastStarveDamageAt =
                    now;

                if (
                    animal.health <= 0
                ) {
                    animal.alive =
                        false;

                    publicSystem(
                        `${animalLabel(
                            animal.id
                        )} vahşi hayvanı ${
                            animal.thirst <= 0
                                ? "susuzluktan"
                                : "açlıktan"
                        } öldü.`
                    );
                }
            }

            broadcast({
                type:
                    "animal_state",

                id:
                    animal.id,

                health:
                    animal.health,

                hunger:
                    animal.hunger,

                thirst:
                    animal.thirst,

                alive:
                    animal.alive
            });
        }
    },
    1000
);

/* =========================================================
   ELMA BÜYÜMESİ
========================================================= */

setInterval(
    () => {
        for (
            const state
            of appleTrees.values()
        ) {
            const before =
                state.apples;

            appleState(
                state.id,
                state.x,
                state.z
            );

            if (
                state.apples !==
                before
            ) {
                broadcast({
                    type:
                        "apple_update",

                    treeId:
                        state.id,

                    apples:
                        state.apples
                });
            }
        }
    },
    10000
);

/* =========================================================
   OYUNCU LİSTESİ
========================================================= */

setInterval(
    sendPlayers,
    100
);

/* =========================================================
   CHAT TEMİZLEME
========================================================= */

setInterval(
    () => {
        chatHistory = [];

        broadcast({
            type:
                "chat_reset",

            time:
                new Date().toISOString()
        });
    },
    CHAT_RESET_MS
);

/* =========================================================
   SUNUCUYU BAŞLAT
========================================================= */

const PORT =
    process.env.PORT || 3000;

server.listen(
    PORT,
    () => {
        console.log(
            "================================="
        );

        console.log(
            "ESEK SUNUCUSU AÇILDI"
        );

        console.log(
            `http://localhost:${PORT}`
        );

        console.log(
            "================================="
        );
    }
);
