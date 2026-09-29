const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const WebSocket = require("ws");

const APP_VERSION = "2026-09-29-3";

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({
    server,
    maxPayload: 24 * 1024
});

app.use(express.json({ limit: "32kb" }));

/* =========================================================
   HESAPLAR
========================================================= */

const ACCOUNTS_FILE = path.join(
    __dirname,
    "accounts.json"
);

let accounts = {};

try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
        accounts =
            JSON.parse(
                fs.readFileSync(
                    ACCOUNTS_FILE,
                    "utf8"
                )
            ) || {};
    }
} catch (error) {
    console.log(
        "accounts.json okunamadı:",
        error.message
    );

    accounts = {};
}

function saveAccounts() {
    try {
        fs.writeFileSync(
            ACCOUNTS_FILE,
            JSON.stringify(
                accounts,
                null,
                2
            ),
            "utf8"
        );
    } catch (error) {
        console.log(
            "accounts.json kaydedilemedi:",
            error.message
        );
    }
}

function normalizeUsername(username) {
    return String(username || "")
        .trim()
        .normalize("NFKC")
        .toLocaleLowerCase("tr-TR");
}

function validUsername(username) {
    return /^[A-Za-z0-9_çğıöşüÇĞİÖŞÜ-]{3,20}$/.test(
        String(username || "")
    );
}

function createPasswordHash(
    password,
    salt
) {
    return crypto
        .scryptSync(
            String(password),
            salt,
            64
        )
        .toString("hex");
}

function createAccount(
    username,
    password
) {
    const salt =
        crypto
            .randomBytes(16)
            .toString("hex");

    return {
        username,
        salt,

        passwordHash:
            createPasswordHash(
                password,
                salt
            ),

        token:
            crypto
                .randomBytes(32)
                .toString("hex")
    };
}

function getAccountByToken(token) {
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
            const username =
                String(
                    req.body?.username ||
                        ""
                ).trim();

            const password =
                String(
                    req.body?.password ||
                        ""
                );

            const passwordConfirm =
                String(
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

            if (
                password !==
                passwordConfirm
            ) {
                return res.status(400).json({
                    ok: false,
                    message:
                        "Şifreler aynı değil."
                });
            }

            const key =
                normalizeUsername(
                    username
                );

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
                username:
                    account.username,
                token:
                    account.token
            });
        } catch (error) {
            console.log(
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
            const username =
                String(
                    req.body?.username ||
                        ""
                ).trim();

            const password =
                String(
                    req.body?.password ||
                        ""
                );

            const key =
                normalizeUsername(
                    username
                );

            const account =
                accounts[key];

            if (!account) {
                return res.status(401).json({
                    ok: false,
                    message:
                        "Kullanıcı adı veya şifre hatalı."
                });
            }

            const passwordHash =
                createPasswordHash(
                    password,
                    account.salt
                );

            const a =
                Buffer.from(
                    passwordHash,
                    "hex"
                );

            const b =
                Buffer.from(
                    account.passwordHash,
                    "hex"
                );

            if (
                a.length !==
                    b.length ||
                !crypto.timingSafeEqual(
                    a,
                    b
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
                username:
                    account.username,
                token:
                    account.token
            });
        } catch (error) {
            console.log(
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
   AD DEĞİŞTİR
========================================================= */

app.post(
    "/api/auth/change-username",
    (req, res) => {
        try {
            const token =
                String(
                    req.body?.token ||
                        ""
                );

            const newUsername =
                String(
                    req.body?.username ||
                        ""
                ).trim();

            const account =
                getAccountByToken(
                    token
                );

            if (!account) {
                return res.status(401).json({
                    ok: false,
                    message:
                        "Oturum geçersiz."
                });
            }

            if (
                !validUsername(
                    newUsername
                )
            ) {
                return res.status(400).json({
                    ok: false,
                    message:
                        "Kullanıcı adı 3-20 karakter olmalı."
                });
            }

            const oldKey =
                normalizeUsername(
                    account.username
                );

            const newKey =
                normalizeUsername(
                    newUsername
                );

            if (
                oldKey !== newKey &&
                accounts[newKey]
            ) {
                return res.status(409).json({
                    ok: false,
                    message:
                        "Bu kullanıcı adı zaten alınmış."
                });
            }

            delete accounts[oldKey];

            account.username =
                newUsername;

            accounts[newKey] =
                account;

            saveAccounts();

            /*
             * O anda oyunda olan hesap sahibinin
             * ismini de değiştir.
             */
            for (
                const player
                of Object.values(players)
            ) {
                if (
                    player.accountUsername ===
                    account.username
                ) {
                    player.name =
                        account.username;
                }
            }

            sendPlayers();

            return res.json({
                ok: true,
                username:
                    account.username,
                token:
                    account.token
            });
        } catch (error) {
            console.log(
                "Ad değiştirme hatası:",
                error
            );

            return res.status(500).json({
                ok: false,
                message:
                    "Ad değiştirilemedi."
            });
        }
    }
);

/* =========================================================
   ŞİFRE DEĞİŞTİR
========================================================= */

app.post(
    "/api/auth/change-password",
    (req, res) => {
        try {
            const token =
                String(
                    req.body?.token ||
                        ""
                );

            const oldPassword =
                String(
                    req.body?.oldPassword ||
                        ""
                );

            const newPassword =
                String(
                    req.body?.newPassword ||
                        ""
                );

            const newPasswordConfirm =
                String(
                    req.body
                        ?.newPasswordConfirm ||
                        ""
                );

            const account =
                getAccountByToken(
                    token
                );

            if (!account) {
                return res.status(401).json({
                    ok: false,
                    message:
                        "Oturum geçersiz."
                });
            }

            const oldHash =
                createPasswordHash(
                    oldPassword,
                    account.salt
                );

            const a =
                Buffer.from(
                    oldHash,
                    "hex"
                );

            const b =
                Buffer.from(
                    account.passwordHash,
                    "hex"
                );

            if (
                a.length !==
                    b.length ||
                !crypto.timingSafeEqual(
                    a,
                    b
                )
            ) {
                return res.status(401).json({
                    ok: false,
                    message:
                        "Mevcut şifre yanlış."
                });
            }

            if (
                newPassword.length < 6
            ) {
                return res.status(400).json({
                    ok: false,
                    message:
                        "Yeni şifre en az 6 karakter olmalı."
                });
            }

            if (
                newPassword !==
                newPasswordConfirm
            ) {
                return res.status(400).json({
                    ok: false,
                    message:
                        "Yeni şifreler aynı değil."
                });
            }

            const newSalt =
                crypto
                    .randomBytes(16)
                    .toString("hex");

            account.salt =
                newSalt;

            account.passwordHash =
                createPasswordHash(
                    newPassword,
                    newSalt
                );

            /*
             * Güvenlik için token da yenileniyor.
             */
            account.token =
                crypto
                    .randomBytes(32)
                    .toString("hex");

            saveAccounts();

            return res.json({
                ok: true,
                token:
                    account.token
            });
        } catch (error) {
            console.log(
                "Şifre değiştirme hatası:",
                error
            );

            return res.status(500).json({
                ok: false,
                message:
                    "Şifre değiştirilemedi."
            });
        }
    }
);

/* =========================================================
   SÜRÜM BİLGİSİ
========================================================= */

app.get(
    "/api/version",
    (req, res) => {
        res.json({
            ok: true,
            version:
                APP_VERSION
        });
    }
);

/* =========================================================
   DOSYALAR
========================================================= */

app.use(
    express.static(
        __dirname
    )
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

/* =========================================================
   OYUN
========================================================= */

const players =
    Object.create(null);

const appleTrees =
    new Map();

const wildAnimals =
    new Map();

let guestCounter = 0;

let chatHistory = [];

const CHAT_LIMIT = 100;

const CHAT_RESET_MS =
    10 * 60 * 1000;

const APPLE_GROW_MS =
    5 * 60 * 1000;

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
   GUEST
========================================================= */

function nextGuestName() {
    const number =
        guestCounter++;

    return (
        "Guest-" +
        String(number)
            .padStart(3, "0")
    );
}

/* =========================================================
   YARDIMCI
========================================================= */

function send(
    ws,
    data
) {
    if (
        ws &&
        ws.readyState ===
            WebSocket.OPEN
    ) {
        ws.send(
            JSON.stringify(data)
        );
    }
}

function broadcast(data) {
    const text =
        JSON.stringify(data);

    for (
        const client
        of wss.clients
    ) {
        if (
            client.readyState ===
            WebSocket.OPEN
        ) {
            client.send(text);
        }
    }
}

function cleanName(name) {
    return String(
        name || ""
    )
        .replace(
            /[\u0000-\u001f\u007f]/g,
            ""
        )
        .trim()
        .slice(0, 20);
}

function cleanText(
    text,
    max = 220
) {
    return String(
        text || ""
    )
        .replace(
            /[\u0000-\u001f\u007f]/g,
            ""
        )
        .trim()
        .slice(0, max);
}

function nameKey(name) {
    return cleanName(
        name
    )
        .normalize("NFKC")
        .toLocaleLowerCase(
            "tr-TR"
        );
}

function clamp(
    value,
    min,
    max,
    fallback
) {
    const number =
        Number(value);

    if (
        !Number.isFinite(
            number
        )
    ) {
        return fallback;
    }

    return Math.max(
        min,
        Math.min(
            max,
            number
        )
    );
}

function activePlayerCount() {
    return Object.values(
        players
    ).filter(
        player =>
            player.inGame
    ).length;
}

/* =========================================================
   OYUNCU
========================================================= */

function playerSnapshot(
    player
) {
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
    const list =
        {};

    for (
        const [
            id,
            player
        ] of Object.entries(
            players
        )
    ) {
        list[id] =
            playerSnapshot(
                player
            );
    }

    broadcast({
        type: "players",
        players: list,
        count:
            activePlayerCount()
    });
}

/* =========================================================
   AKTİF İSİM
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
            nameKey(
                player.name
            ) === key
    );
}

/* =========================================================
   CHAT
========================================================= */

function systemMessage(
    text
) {
    const message = {
        id:
            "system-" +
            Date.now(),

        system: true,

        name: "Sistem",

        text:
            cleanText(text),

        time:
            new Date()
                .toISOString()
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
}

function parseWhisper(
    text
) {
    let match =
        text.match(
            /^\/msg\s+(\S+)\s+"([\s\S]{1,220})"\s*$/i
        );

    if (match) {
        return {
            target:
                cleanName(
                    match[1]
                ),

            text:
                cleanText(
                    match[2]
                )
        };
    }

    match =
        text.match(
            /^\/msg\s+(\S+)\s+([\s\S]{1,220})$/i
        );

    if (match) {
        return {
            target:
                cleanName(
                    match[1]
                ),

            text:
                cleanText(
                    match[2]
                )
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
    id,
    killerId,
    reason
) {
    const player =
        players[id];

    if (
        !player ||
        !player.alive
    ) {
        return;
    }

    player.health = 0;
    player.alive = false;

    const killer =
        killerId
            ? players[killerId]
            : null;

    systemMessage(
        reason ||
            (
                killer
                    ? `${player.name}, ${killer.name} tarafından öldürüldü.`
                    : `${player.name} öldü.`
            )
    );

    broadcast({
        type:
            "player_death",

        id,

        killerId:
            killerId || null,

        killerName:
            killer
                ? killer.name
                : null
    });

    sendNeeds(id);
}

/* =========================================================
   ELMALAR
========================================================= */

function appleState(
    id,
    x,
    z
) {
    let state =
        appleTrees.get(id);

    const now =
        Date.now();

    if (!state) {
        state = {
            id,

            x: clamp(
                x,
                -400,
                400,
                0
            ),

            z: clamp(
                z,
                -400,
                400,
                0
            ),

            apples: 6,

            lastGrowAt:
                now
        };

        appleTrees.set(
            id,
            state
        );
    }

    const grown =
        Math.floor(
            (
                now -
                state.lastGrowAt
            ) /
                APPLE_GROW_MS
        );

    if (grown > 0) {
        state.apples =
            Math.min(
                10,
                state.apples +
                    grown
            );

        state.lastGrowAt +=
            grown *
            APPLE_GROW_MS;
    }

    return state;
}

/* =========================================================
   HAYVAN
========================================================= */

function validAnimalId(
    id
) {
    return /^forest-(wolf|deer|rabbit|boar|fox|goat)-\d{1,3}$/.test(
        String(id || "")
    );
}

function ensureAnimal(
    id
) {
    if (
        !validAnimalId(id)
    ) {
        return null;
    }

    if (
        !wildAnimals.has(id)
    ) {
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

                lastStarveDamageAt:
                    0,

                lastCareAt:
                    0
            }
        );
    }

    return wildAnimals.get(
        id
    );
}

function animalLabel(id) {
    const type =
        String(id)
            .split("-")[1];

    const names = {
        wolf: "Kurt",
        deer: "Geyik",
        rabbit: "Tavşan",
        boar:
            "Yaban domuzu",
        fox: "Tilki",
        goat: "Keçi"
    };

    return (
        names[type] ||
        "Hayvan"
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

        players[id] = {
            ws,

            x: SPAWN.x,
            y: SPAWN.y,
            z: SPAWN.z,

            yaw: 0,
            pitch: 0,

            isCrouching:
                false,

            isMoving:
                false,

            isJumping:
                false,

            name:
                null,

            accountUsername:
                null,

            platform:
                "pc",

            pingMs:
                null,

            inGame:
                false,

            alive:
                true,

            health:
                MAX_NEED,

            hunger:
                MAX_NEED,

            thirst:
                MAX_NEED,

            lastNeedTick:
                Date.now(),

            lastAttackAt:
                0,

            lastAnimalAttackAt:
                0,

            lastChatAt:
                0,

            lastStarveDamageAt:
                0
        };

        send(
            ws,
            {
                type:
                    "init",

                id
            }
        );

        send(
            ws,
            {
                type:
                    "server_version",

                version:
                    APP_VERSION
            }
        );

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

        sendPlayers();

        ws.on(
            "message",
            raw => {
                let data;

                try {
                    data =
                        JSON.parse(
                            raw.toString()
                        );
                } catch {
                    return;
                }

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

                /* =====================================
                   PROFİL / PLATFORM
                ===================================== */

                if (
                    data.type ===
                    "profile"
                ) {
                    player.platform =
                        data.platform ===
                        "mobile"
                            ? "mobile"
                            : "pc";

                    return;
                }

                /* =====================================
                   OYUNA GİRİŞ
                ===================================== */

                if (
                    data.type ===
                    "join_request"
                ) {
                    const account =
                        getAccountByToken(
                            String(
                                data.token ||
                                    ""
                            )
                        );

                    let playerName;

                    if (account) {
                        playerName =
                            cleanName(
                                account.username
                            );
                    } else {
                        playerName =
                            nextGuestName();
                    }

                    const duplicate =
                        findActiveName(
                            playerName,
                            id
                        );

                    if (duplicate) {
                        send(
                            ws,
                            {
                                type:
                                    "join_denied",

                                message:
                                    "Bu isim şu anda oyunda kullanılıyor."
                            }
                        );

                        return;
                    }

                    player.name =
                        playerName;

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

                    sendNeeds(id);
                    sendPlayers();

                    return;
                }

                /* =====================================
                   GERÇEK MENÜDEN ÇIKIŞ
                ===================================== */

                if (
                    data.type ===
                    "presence"
                ) {
                    player.platform =
                        data.platform ===
                        "mobile"
                            ? "mobile"
                            : "pc";

                    if (
                        data.active !==
                        true
                    ) {
                        player.inGame =
                            false;
                    }

                    sendPlayers();

                    return;
                }

                /* =====================================
                   HAREKET
                ===================================== */

                if (
                    data.type ===
                    "move"
                ) {
                    if (
                        !player.inGame ||
                        !player.alive
                    ) {
                        return;
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
                            -100,
                            100,
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
                                10000,
                                player.pingMs
                            );
                    }

                    return;
                }

                /* =====================================
                   PING
                ===================================== */

                if (
                    data.type ===
                    "ping"
                ) {
                    send(
                        ws,
                        {
                            type:
                                "pong",

                            timestamp:
                                Number(
                                    data.timestamp
                                )
                        }
                    );

                    return;
                }

                /* =====================================
                   CHAT
                ===================================== */

                if (
                    data.type ===
                    "chat"
                ) {
                    if (
                        !player.inGame ||
                        !player.alive
                    ) {
                        return;
                    }

                    if (
                        Date.now() -
                            player.lastChatAt <
                        450
                    ) {
                        return;
                    }

                    const text =
                        cleanText(
                            data.text
                        );

                    if (!text) {
                        return;
                    }

                    player.lastChatAt =
                        Date.now();

                    if (
                        /^\/msg\b/i.test(
                            text
                        )
                    ) {
                        const whisper =
                            parseWhisper(
                                text
                            );

                        if (
                            !whisper
                        ) {
                            send(
                                ws,
                                {
                                    type:
                                        "chat_error",

                                    message:
                                        'Kullanım: /msg Oyuncu "mesaj"'
                                }
                            );

                            return;
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

                        if (
                            !target
                        ) {
                            send(
                                ws,
                                {
                                    type:
                                        "chat_error",

                                    message:
                                        "Oyuncu bulunamadı."
                                }
                            );

                            return;
                        }

                        const message = {
                            id:
                                "whisper-" +
                                Date.now(),

                            private:
                                true,

                            fromId:
                                id,

                            toId:
                                target[0],

                            name:
                                player.name,

                            toName:
                                target[1]
                                    .name,

                            text:
                                whisper.text,

                            time:
                                new Date()
                                    .toISOString()
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

                        return;
                    }

                    const message = {
                        id:
                            Date.now() +
                            "-" +
                            id,

                        name:
                            player.name,

                        platform:
                            player.platform,

                        text,

                        time:
                            new Date()
                                .toISOString()
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

                    return;
                }

                /* =====================================
                   ELMA DURUMU
                ===================================== */

                if (
                    data.type ===
                    "apple_state_request"
                ) {
                    const states =
                        {};

                    const trees =
                        Array.isArray(
                            data.trees
                        )
                            ? data.trees.slice(
                                  0,
                                  250
                              )
                            : [];

                    for (
                        const tree
                        of trees
                    ) {
                        const treeId =
                            String(
                                tree.id ||
                                    ""
                            );

                        if (
                            !/^apple-[A-Za-z0-9_-]+$/.test(
                                treeId
                            )
                        ) {
                            continue;
                        }

                        const state =
                            appleState(
                                treeId,
                                tree.x,
                                tree.z
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

                    return;
                }

                /* =====================================
                   ELMA TOPLA
                ===================================== */

                if (
                    data.type ===
                    "apple_pick"
                ) {
                    if (
                        !player.inGame ||
                        !player.alive
                    ) {
                        return;
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

                    if (
                        !state ||
                        state.apples <= 0
                    ) {
                        send(
                            ws,
                            {
                                type:
                                    "apple_pick_result",

                                ok:
                                    false,

                                treeId
                            }
                        );

                        return;
                    }

                    const distance =
                        Math.hypot(
                            player.x -
                                state.x,
                            player.z -
                                state.z
                        );

                    if (
                        distance > 7
                    ) {
                        return;
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

                    sendNeeds(id);

                    return;
                }

                /* =====================================
                   SU
                ===================================== */

                if (
                    data.type ===
                    "drink"
                ) {
                    if (
                        !player.inGame ||
                        !player.alive
                    ) {
                        return;
                    }

                    const beach =
                        player.x >= -310 &&
                        player.x <= -35 &&
                        player.z >= -459 &&
                        player.z <= -444;

                    const pond =
                        Math.hypot(
                            player.x -
                                FOREST_POND.x,
                            player.z -
                                FOREST_POND.z
                        ) <=
                        FOREST_POND.radius +
                            5;

                    if (
                        !beach &&
                        !pond
                    ) {
                        return;
                    }

                    player.thirst =
                        Math.min(
                            MAX_NEED,
                            player.thirst +
                                2
                        );

                    sendNeeds(id);

                    return;
                }

                /* =====================================
                   OYUNCUYA SALDIR
                ===================================== */

                if (
                    data.type ===
                    "attack_player"
                ) {
                    if (
                        !player.inGame ||
                        !player.alive
                    ) {
                        return;
                    }

                    if (
                        Date.now() -
                            player.lastAttackAt <
                        550
                    ) {
                        return;
                    }

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
                        !target.alive
                    ) {
                        return;
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
                        return;
                    }

                    player.lastAttackAt =
                        Date.now();

                    target.health =
                        Math.max(
                            0,
                            target.health -
                                1
                        );

                    broadcast({
                        type:
                            "combat_hit",

                        attackerId:
                            id,

                        targetId:
                            data.targetId,

                        damage: 1,

                        health:
                            target.health
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

                    return;
                }

                /* =====================================
                   HAYVANA SALDIR
                ===================================== */

                if (
                    data.type ===
                    "attack_animal"
                ) {
                    if (
                        !player.inGame ||
                        !player.alive
                    ) {
                        return;
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

                    if (
                        !animal ||
                        !animal.alive
                    ) {
                        return;
                    }

                    const ax =
                        Number.isFinite(
                            Number(data.x)
                        )
                            ? Number(data.x)
                            : player.x;

                    const az =
                        Number.isFinite(
                            Number(data.z)
                        )
                            ? Number(data.z)
                            : player.z;

                    if (
                        Math.hypot(
                            player.x -
                                ax,
                            player.z -
                                az
                        ) > 4
                    ) {
                        return;
                    }

                    if (
                        Date.now() -
                            player.lastAttackAt <
                        550
                    ) {
                        return;
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
                        animal.health <=
                        0
                    ) {
                        animal.alive =
                            false;
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

                    return;
                }

                /* =====================================
                   HAYVAN SALDIRISI
                ===================================== */

                if (
                    data.type ===
                    "animal_attack"
                ) {
                    if (
                        !player.inGame ||
                        !player.alive
                    ) {
                        return;
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

                    if (
                        !animal ||
                        !animal.alive
                    ) {
                        return;
                    }

                    const ax =
                        Number.isFinite(
                            Number(data.x)
                        )
                            ? Number(data.x)
                            : player.x;

                    const az =
                        Number.isFinite(
                            Number(data.z)
                        )
                            ? Number(data.z)
                            : player.z;

                    if (
                        Math.hypot(
                            player.x -
                                ax,
                            player.z -
                                az
                        ) > 3.5
                    ) {
                        return;
                    }

                    if (
                        Date.now() -
                            player.lastAnimalAttackAt <
                        1800
                    ) {
                        return;
                    }

                    player.lastAnimalAttackAt =
                        Date.now();

                    player.health =
                        Math.max(
                            0,
                            player.health -
                                0.5
                        );

                    sendNeeds(id);

                    if (
                        player.health <=
                        0
                    ) {
                        killPlayer(
                            id,
                            null,
                            `${player.name} vahşi hayvan saldırısında öldü.`
                        );
                    }

                    return;
                }

                /* =====================================
                   HAYVAN BESLE / SU VER
                ===================================== */

                if (
                    data.type ===
                    "animal_care"
                ) {
                    const animal =
                        ensureAnimal(
                            String(
                                data.animalId ||
                                    ""
                            )
                        );

                    if (
                        !animal ||
                        !animal.alive
                    ) {
                        return;
                    }

                    if (
                        Date.now() -
                            animal.lastCareAt <
                        8000
                    ) {
                        return;
                    }

                    if (
                        data.action ===
                        "eat"
                    ) {
                        animal.hunger =
                            Math.min(
                                MAX_NEED,
                                animal.hunger +
                                    1
                            );
                    }

                    if (
                        data.action ===
                        "drink"
                    ) {
                        animal.thirst =
                            Math.min(
                                MAX_NEED,
                                animal.thirst +
                                    1
                            );
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
                            animal.alive
                    });

                    return;
                }

                /* =====================================
                   HAYVAN DURUMLARI
                ===================================== */

                if (
                    data.type ===
                    "animal_states_request"
                ) {
                    const states =
                        {};

                    const ids =
                        Array.isArray(
                            data.ids
                        )
                            ? data.ids.slice(
                                  0,
                                  100
                              )
                            : [];

                    for (
                        const animalId
                        of ids
                    ) {
                        const animal =
                            ensureAnimal(
                                animalId
                            );

                        if (
                            animal
                        ) {
                            states[
                                animalId
                            ] = {
                                health:
                                    animal.health,

                                hunger:
                                    animal.hunger,

                                thirst:
                                    animal.thirst,

                                alive:
                                    animal.alive
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

                    return;
                }

                /* =====================================
                   RESPAWN
                ===================================== */

                if (
                    data.type ===
                    "respawn"
                ) {
                    if (
                        !player.inGame ||
                        player.alive
                    ) {
                        return;
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

                    return;
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
                console.log(
                    "WebSocket hatası:",
                    error.message
                );
            }
        );
    }
);

/* =========================================================
   AÇLIK / SUSUZLUK
========================================================= */

setInterval(
    () => {
        const now =
            Date.now();

        for (
            const [
                id,
                player
            ] of Object.entries(
                players
            )
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
                    elapsed / 30000
                );

            if (
                steps <= 0
            ) {
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
                    player.hunger <=
                        0 ||
                    player.thirst <=
                        0
                ) &&
                now -
                    player.lastStarveDamageAt >=
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
                    player.health <=
                    0
                ) {
                    killPlayer(
                        id,
                        null,
                        `${player.name} ${
                            player.thirst <=
                            0
                                ? "susuzluktan"
                                : "açlıktan"
                        } öldü.`
                    );
                }
            }

            sendNeeds(id);
        }
    },
    1000
);

/* =========================================================
   HAYVAN İHTİYAÇLARI
========================================================= */

setInterval(
    () => {
        const now =
            Date.now();

        for (
            const animal
            of wildAnimals.values()
        ) {
            if (
                !animal.alive
            ) {
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

            if (
                steps <= 0
            ) {
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
                    animal.hunger <=
                        0 ||
                    animal.thirst <=
                        0
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
                    animal.health <=
                    0
                ) {
                    animal.alive =
                        false;

                    systemMessage(
                        `${animalLabel(
                            animal.id
                        )} ${
                            animal.thirst <=
                            0
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
                before !==
                state.apples
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
   CHAT TEMİZLE
========================================================= */

setInterval(
    () => {
        chatHistory = [];

        broadcast({
            type:
                "chat_reset",

            time:
                new Date()
                    .toISOString()
        });
    },
    CHAT_RESET_MS
);

/* =========================================================
   SUNUCU
========================================================= */

const PORT =
    process.env.PORT || 3000;

server.listen(
    PORT,
    () => {
        console.log("");
        console.log(
            "======================================"
        );
        console.log(
            "       ESEK SUNUCUSU AÇILDI"
        );
        console.log(
            "======================================"
        );
        console.log(
            "Adres: http://localhost:" +
                PORT
        );
        console.log(
            "Sürüm: " +
                APP_VERSION
        );
        console.log(
            "======================================"
        );
        console.log("");
    }
);
