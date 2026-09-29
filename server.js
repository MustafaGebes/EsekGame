const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, maxPayload: 24 * 1024 });

app.use(express.json({ limit: '32kb' }));
app.use(express.static(__dirname));

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/health', (_req, res) => res.json({
    ok: true,
    players: activePlayerCount()
}));

/* =========================================================
   HESAP SİSTEMİ
   ========================================================= */

const ACCOUNTS_FILE = path.join(__dirname, 'accounts.json');

let accounts = Object.create(null);

try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
        const saved = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));

        if (saved && typeof saved === 'object') {
            accounts = saved;
        }
    }
} catch (error) {
    console.warn('accounts.json okunamadı:', error.message);
    accounts = Object.create(null);
}

function saveAccounts() {
    try {
        fs.writeFileSync(
            ACCOUNTS_FILE,
            JSON.stringify(accounts, null, 2),
            'utf8'
        );
    } catch (error) {
        console.error('accounts.json kaydedilemedi:', error.message);
    }
}

function normalizeUsername(value) {
    return String(value ?? '')
        .trim()
        .normalize('NFKC');
}

function validUsername(username) {
    return (
        username.length >= 3 &&
        username.length <= 20 &&
        /^[A-Za-z0-9_çğıöşüÇĞİÖŞÜ]+$/.test(username)
    );
}

function accountKey(username) {
    return normalizeUsername(username).toLocaleLowerCase('tr-TR');
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const hash = crypto
        .scryptSync(String(password), salt, 64)
        .toString('hex');

    return {
        salt,
        hash
    };
}

function verifyPassword(password, account) {
    if (!account || !account.passwordHash || !account.passwordSalt) {
        return false;
    }

    try {
        const hash = crypto
            .scryptSync(String(password), account.passwordSalt, 64)
            .toString('hex');

        return crypto.timingSafeEqual(
            Buffer.from(hash, 'hex'),
            Buffer.from(account.passwordHash, 'hex')
        );
    } catch {
        return false;
    }
}

function newToken() {
    return crypto.randomBytes(32).toString('hex');
}

function findAccountByToken(token) {
    const cleanToken = String(token || '');

    if (!cleanToken) {
        return null;
    }

    for (const account of Object.values(accounts)) {
        if (account && account.token === cleanToken) {
            return account;
        }
    }

    return null;
}

/* =========================================================
   KAYIT
   ========================================================= */

app.post('/api/auth/register', (req, res) => {
    try {
        const username = normalizeUsername(req.body?.username);
        const password = String(req.body?.password ?? '');
        const passwordConfirm = String(req.body?.passwordConfirm ?? '');

        if (!validUsername(username)) {
            return res.status(400).json({
                ok: false,
                message:
                    'Kullanıcı adı 3-20 karakter olmalı ve sadece harf, rakam veya _ içermelidir.'
            });
        }

        if (password.length < 4 || password.length > 100) {
            return res.status(400).json({
                ok: false,
                message: 'Şifre 4-100 karakter arasında olmalıdır.'
            });
        }

        if (password !== passwordConfirm) {
            return res.status(400).json({
                ok: false,
                message: 'Şifreler aynı değil.'
            });
        }

        const key = accountKey(username);

        if (accounts[key]) {
            return res.status(409).json({
                ok: false,
                message: 'Bu kullanıcı adı zaten alınmış.'
            });
        }

        const passwordData = hashPassword(password);
        const token = newToken();

        accounts[key] = {
            username,
            passwordSalt: passwordData.salt,
            passwordHash: passwordData.hash,
            token,
            createdAt: new Date().toISOString()
        };

        saveAccounts();

        return res.json({
            ok: true,
            username,
            token
        });
    } catch (error) {
        console.error('Kayıt hatası:', error);

        return res.status(500).json({
            ok: false,
            message: 'Hesap oluşturulurken bir hata oluştu.'
        });
    }
});

/* =========================================================
   GİRİŞ
   ========================================================= */

app.post('/api/auth/login', (req, res) => {
    try {
        const username = normalizeUsername(req.body?.username);
        const password = String(req.body?.password ?? '');

        const key = accountKey(username);
        const account = accounts[key];

        if (!account || !verifyPassword(password, account)) {
            return res.status(401).json({
                ok: false,
                message: 'Kullanıcı adı veya şifre yanlış.'
            });
        }

        account.token = newToken();
        account.lastLoginAt = new Date().toISOString();

        saveAccounts();

        return res.json({
            ok: true,
            username: account.username,
            token: account.token
        });
    } catch (error) {
        console.error('Giriş hatası:', error);

        return res.status(500).json({
            ok: false,
            message: 'Giriş yapılırken bir hata oluştu.'
        });
    }
});

/* =========================================================
   OYUNCU SİSTEMİ
   ========================================================= */

const players = Object.create(null);

const appleTrees = new Map();
const wildAnimals = new Map();

let chatHistory = [];

const CHAT_RESET_MS = 10 * 60 * 1000;
const APPLE_GROW_MS = 5 * 60 * 1000;
const CHAT_LIMIT = 100;
const MAX_NEED = 9;

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
   GUEST NUMARASI
   ========================================================= */

let guestCounter = 0;

function nextGuestName() {
    const number = guestCounter++;

    return `Guest-${String(number).padStart(3, '0')}`;
}

/* =========================================================
   GENEL FONKSİYONLAR
   ========================================================= */

function activePlayerCount() {
    return Object.values(players)
        .filter(p => p.inGame)
        .length;
}

function send(ws, payload) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
    }
}

function broadcast(payload) {
    const encoded = JSON.stringify(payload);

    for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(encoded);
        }
    }
}

function clamp(value, min, max, fallback = min) {
    const n = Number(value);

    return Number.isFinite(n)
        ? Math.max(min, Math.min(max, n))
        : fallback;
}

function cleanName(value) {
    const name = String(value ?? '')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .slice(0, 20);

    return name || 'Player';
}

function nameKey(value) {
    return cleanName(value)
        .normalize('NFKC')
        .toLocaleLowerCase('tr-TR');
}

function cleanText(value, limit = 220) {
    return String(value ?? '')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
        .trim()
        .slice(0, limit);
}

/* =========================================================
   OYUNCU SNAPSHOT
   ========================================================= */

function playerSnapshot(p) {
    return {
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: p.yaw,
        pitch: p.pitch,

        isCrouching: p.isCrouching,
        isMoving: p.isMoving,
        isJumping: p.isJumping,

        name: p.name,
        platform: p.platform,
        pingMs: p.pingMs,

        inGame: p.inGame,
        alive: p.alive,

        health: p.health,
        hunger: p.hunger,
        thirst: p.thirst
    };
}

function sendPlayers() {
    const publicPlayers = Object.create(null);

    for (const [id, p] of Object.entries(players)) {
        publicPlayers[id] = playerSnapshot(p);
    }

    broadcast({
        type: 'players',
        players: publicPlayers,
        count: activePlayerCount()
    });
}

/* =========================================================
   CHAT
   ========================================================= */

function publicSystem(text) {
    const message = {
        id: `sys-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        system: true,
        name: 'Sistem',
        text: cleanText(text, 220),
        time: new Date().toISOString()
    };

    chatHistory.push(message);

    if (chatHistory.length > CHAT_LIMIT) {
        chatHistory = chatHistory.slice(-CHAT_LIMIT);
    }

    broadcast({
        type: 'chat_message',
        message
    });
}

function sendNeeds(id) {
    const p = players[id];

    if (!p) return;

    send(p.ws, {
        type: 'needs',
        health: p.health,
        hunger: p.hunger,
        thirst: p.thirst,
        alive: p.alive
    });
}

function parseWhisper(text) {
    const quoted = text.match(
        /^\/msg\s+(\S+)\s+"([\s\S]{1,220})"\s*$/i
    );

    if (quoted) {
        return {
            target: cleanName(quoted[1]),
            text: cleanText(quoted[2])
        };
    }

    const plain = text.match(
        /^\/msg\s+(\S+)\s+([\s\S]{1,220})$/i
    );

    if (plain) {
        return {
            target: cleanName(plain[1]),
            text: cleanText(plain[2])
        };
    }

    return null;
}

/* =========================================================
   AKTİF OYUNCU İSMİ KONTROLÜ
   ========================================================= */

function findActiveName(name, exceptId) {
    const key = nameKey(name);

    return Object.entries(players).find(
        ([id, p]) =>
            id !== exceptId &&
            p.inGame &&
            nameKey(p.name) === key
    );
}

/* =========================================================
   OYUNCU ÖLDÜRME
   ========================================================= */

function killPlayer(victimId, killerId, cause) {
    const victim = players[victimId];

    if (!victim || !victim.alive) return;

    victim.health = 0;
    victim.alive = false;
    victim.lastKiller = killerId || null;

    const killerName =
        killerId && players[killerId]
            ? players[killerId].name
            : null;

    const reason =
        cause ||
        (
            killerName
                ? `${victim.name}, ${killerName} tarafından öldürüldü.`
                : `${victim.name} ${cause || 'hayatını kaybetti'}.`
        );

    publicSystem(reason);

    broadcast({
        type: 'player_death',
        id: victimId,
        killerId: killerId || null,
        killerName: killerName || null,
        reason
    });
}

/* =========================================================
   ELMA SİSTEMİ
   ========================================================= */

function appleState(treeId, x, z) {
    let state = appleTrees.get(treeId);

    const now = Date.now();

    if (!state) {
        state = {
            id: treeId,
            x: clamp(x, -400, 400),
            z: clamp(z, -400, 400),
            apples: 6,
            lastGrowAt: now
        };

        appleTrees.set(treeId, state);
    }

    const elapsed = Math.floor(
        (now - state.lastGrowAt) / APPLE_GROW_MS
    );

    if (elapsed > 0) {
        state.apples = Math.min(
            10,
            state.apples + elapsed
        );

        state.lastGrowAt += elapsed * APPLE_GROW_MS;
    }

    return state;
}

/* =========================================================
   HAYVAN SİSTEMİ
   ========================================================= */

function validAnimalId(id) {
    return /^forest-(wolf|deer|rabbit|boar|fox|goat)-\d{1,3}$/
        .test(String(id || ''));
}

function ensureAnimal(id) {
    if (!validAnimalId(id)) {
        return null;
    }

    if (!wildAnimals.has(id)) {
        wildAnimals.set(id, {
            id,
            health: 9,
            hunger: 9,
            thirst: 9,
            alive: true,
            lastNeedTick: Date.now(),
            lastStarveDamageAt: 0,
            lastCareAt: 0
        });
    }

    return wildAnimals.get(id);
}

function animalLabel(id) {
    const kind = String(id).split('-')[1];

    return {
        wolf: 'Kurt',
        deer: 'Geyik',
        rabbit: 'Tavşan',
        boar: 'Yaban domuzu',
        fox: 'Tilki',
        goat: 'Keçi'
    }[kind] || 'Vahşi hayvan';
}

/* =========================================================
   WEBSOCKET
   ========================================================= */

wss.on('connection', ws => {
    const id = crypto.randomBytes(5).toString('hex');

    console.log(`Oyuncu bağlandı: ${id}`);

    /*
     * Burada artık oyuncuya Guest numarası vermiyoruz.
     * Guest numarası sadece oyuna gerçekten girildiğinde verilecek.
     */
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

        name: 'Guest-000',

        accountUsername: null,

        platform: 'pc',
        pingMs: null,

        inGame: false,
        alive: true,

        health: MAX_NEED,
        hunger: MAX_NEED,
        thirst: MAX_NEED,

        lastNeedTick: Date.now(),
        lastStarveDamageAt: 0,

        lastAttackAt: 0,
        lastAnimalAttackAt: 0,
        lastChatAt: 0
    };

    send(ws, {
        type: 'init',
        id
    });

    send(ws, {
        type: 'chat_history',
        messages: chatHistory.slice(-50)
    });

    sendPlayers();

    /* =====================================================
       MESAJLAR
       ===================================================== */

    ws.on('message', raw => {
        try {
            const data = JSON.parse(raw.toString());

            const p = players[id];

            if (!p || !data || typeof data.type !== 'string') {
                return;
            }

            switch (data.type) {

                /* =================================================
                   PROFILE
                   Artık isim değiştirilemiyor.
                   ================================================= */

                case 'profile': {
                    p.platform =
                        data.platform === 'mobile'
                            ? 'mobile'
                            : 'pc';

                    sendPlayers();

                    break;
                }

                /* =================================================
                   OYUNA GİRİŞ
                   ================================================= */

                case 'join_request': {

                    /*
                     * Önce token üzerinden hesap kontrol edilir.
                     */
                    const account = findAccountByToken(data.token);

                    let candidate;

                    if (account) {

                        /*
                         * Hesaplı oyuncunun adı sunucudan gelir.
                         */
                        candidate = account.username;

                    } else {

                        /*
                         * Misafir oyuncuya her girişte yeni numara.
                         *
                         * İlk misafir:
                         * Guest-000
                         *
                         * İkinci:
                         * Guest-001
                         */
                        candidate = nextGuestName();
                    }

                    const duplicate = findActiveName(
                        candidate,
                        id
                    );

                    if (duplicate) {

                        /*
                         * Hesap adı zaten kullanımda ise
                         * hesaplı oyuncu oyuna alınmaz.
                         */
                        if (account) {
                            send(ws, {
                                type: 'join_denied',
                                message:
                                    'Bu hesap adı şu anda başka bir oyuncu tarafından kullanılıyor.'
                            });

                            break;
                        }

                        /*
                         * Guest numarası çakışırsa yeni numara üret.
                         */
                        candidate = nextGuestName();
                    }

                    if (!p.alive && p.inGame) {
                        send(ws, {
                            type: 'join_denied',
                            message:
                                'Ölüm ekranından yeniden doğ veya önce menüye dön.'
                        });

                        break;
                    }

                    if (!p.alive) {
                        p.health = MAX_NEED;
                        p.hunger = MAX_NEED;
                        p.thirst = MAX_NEED;
                        p.alive = true;
                    }

                    /*
                     * İsim artık istemciden alınmıyor.
                     */
                    p.name = candidate;

                    p.accountUsername =
                        account ? account.username : null;

                    p.platform =
                        data.platform === 'mobile'
                            ? 'mobile'
                            : 'pc';

                    p.inGame = true;
                    p.lastNeedTick = Date.now();

                    send(ws, {
                        type: 'join_accepted',

                        id,

                        state: playerSnapshot(p),

                        spawn: SPAWN,

                        /*
                         * İstemci isterse hesap durumunu
                         * buradan öğrenebilir.
                         */
                        account: account
                            ? {
                                username: account.username
                            }
                            : null
                    });

                    sendPlayers();

                    break;
                }

                /* =================================================
                   PRESENCE
                   ================================================= */

                case 'presence': {

                    p.platform =
                        data.platform === 'mobile'
                            ? 'mobile'
                            : 'pc';

                    /*
                     * active false ise menüye dönülür.
                     */
                    if (data.active !== true) {
                        p.inGame = false;
                    }

                    /*
                     * active true ile doğrudan oyuna sokmuyoruz.
                     * Oyuncunun join_request göndermesi gerekiyor.
                     */
                    sendPlayers();

                    break;
                }

                /* =================================================
                   HAREKET
                   ================================================= */

                case 'move': {

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
                        Number.isFinite(Number(data.pingMs))
                    ) {
                        p.pingMs = clamp(
                            data.pingMs,
                            0,
                            10000
                        );
                    }

                    break;
                }

                /* =================================================
                   PING
                   ================================================= */

                case 'ping': {

                    send(ws, {
                        type: 'pong',
                        timestamp: Number(data.timestamp)
                    });

                    break;
                }

                case 'ping_result': {

                    if (
                        Number.isFinite(
                            Number(data.pingMs)
                        )
                    ) {
                        p.pingMs = clamp(
                            data.pingMs,
                            0,
                            10000
                        );
                    }

                    break;
                }

                /* =================================================
                   CHAT HISTORY
                   ================================================= */

                case 'chat_history': {

                    send(ws, {
                        type: 'chat_history',
                        messages: chatHistory.slice(-50)
                    });

                    break;
                }

                /* =================================================
                   CHAT
                   ================================================= */

                case 'chat': {

                    if (!p.inGame || !p.alive) {
                        break;
                    }

                    const now = Date.now();

                    if (now - p.lastChatAt < 450) {
                        break;
                    }

                    const rawText = cleanText(data.text);

                    if (!rawText) {
                        break;
                    }

                    p.lastChatAt = now;

                    const whisper = parseWhisper(rawText);

                    if (/^\/msg\b/i.test(rawText)) {

                        if (!whisper) {
                            send(ws, {
                                type: 'chat_error',
                                message:
                                    'Kullanım: /msg OyuncuAdı "mesaj"'
                            });

                            break;
                        }

                        const target =
                            Object.entries(players).find(
                                ([targetId, targetPlayer]) =>
                                    targetId !== id &&
                                    targetPlayer.inGame &&
                                    targetPlayer.alive &&
                                    nameKey(targetPlayer.name) ===
                                        nameKey(whisper.target)
                            );

                        if (!target) {
                            send(ws, {
                                type: 'chat_error',
                                message:
                                    `${whisper.target} adlı oyuncu şu an oyunda değil.`
                            });

                            break;
                        }

                        const message = {
                            id: `whisper-${now}-${id}`,
                            clientId: cleanText(
                                data.clientId,
                                80
                            ),
                            private: true,
                            fromId: id,
                            toId: target[0],
                            name: p.name,
                            toName: target[1].name,
                            text: whisper.text,
                            time: new Date(now).toISOString()
                        };

                        send(ws, {
                            type: 'chat_message',
                            message
                        });

                        send(target[1].ws, {
                            type: 'chat_message',
                            message
                        });

                        break;
                    }

                    const message = {
                        id: `${now}-${id}`,
                        clientId: cleanText(
                            data.clientId,
                            80
                        ),
                        name: p.name,
                        platform: p.platform,
                        text: rawText,
                        time: new Date(now).toISOString()
                    };

                    chatHistory.push(message);

                    if (chatHistory.length > CHAT_LIMIT) {
                        chatHistory =
                            chatHistory.slice(-CHAT_LIMIT);
                    }

                    broadcast({
                        type: 'chat_message',
                        message
                    });

                    break;
                }

                /* =================================================
                   ELMA DURUMU
                   ================================================= */

                case 'apple_state_request': {

                    const states = {};

                    for (
                        const item of (
                            Array.isArray(data.trees)
                                ? data.trees.slice(0, 240)
                                : []
                        )
                    ) {

                        const treeId =
                            String(item.id || '');

                        if (
                            !/^apple-[A-Za-z0-9_-]{1,40}$/
                                .test(treeId)
                        ) {
                            continue;
                        }

                        const state =
                            appleState(
                                treeId,
                                item.x,
                                item.z
                            );

                        states[treeId] =
                            state.apples;
                    }

                    send(ws, {
                        type: 'apple_states',
                        states
                    });

                    break;
                }

                /* =================================================
                   ELMA TOPLAMA
                   ================================================= */

                case 'apple_pick': {

                    if (!p.inGame || !p.alive) {
                        break;
                    }

                    const treeId =
                        String(data.treeId || '');

                    const state =
                        appleTrees.get(treeId);

                    const distance =
                        state
                            ? Math.hypot(
                                p.x - state.x,
                                p.z - state.z
                            )
                            : Infinity;

                    if (
                        !state ||
                        distance > 6 ||
                        state.apples <= 0
                    ) {

                        send(ws, {
                            type: 'apple_pick_result',
                            ok: false,
                            treeId,
                            message:
                                'Elma kalmadı veya ağaca yaklaşmalısın.'
                        });

                        break;
                    }

                    state.apples--;

                    p.hunger =
                        Math.min(
                            MAX_NEED,
                            p.hunger + 1.5
                        );

                    broadcast({
                        type: 'apple_update',
                        treeId,
                        apples: state.apples
                    });

                    send(ws, {
                        type: 'apple_pick_result',
                        ok: true,
                        treeId,
                        apples: state.apples,
                        health: p.health,
                        hunger: p.hunger,
                        thirst: p.thirst
                    });

                    break;
                }

                /* =================================================
                   SU İÇME
                   ================================================= */

                case 'drink': {

                    if (!p.inGame || !p.alive) {
                        break;
                    }

                    const atBeachWater =
                        p.x >= -310 &&
                        p.x <= -35 &&
                        p.z >= -459 &&
                        p.z <= -444;

                    const atForestPond =
                        Math.hypot(
                            p.x - FOREST_POND.x,
                            p.z - FOREST_POND.z
                        ) <=
                        FOREST_POND.radius + 4;

                    if (
                        !atBeachWater &&
                        !atForestPond
                    ) {

                        send(ws, {
                            type: 'action_denied',
                            action: 'drink',
                            message:
                                'Suya biraz daha yaklaş.'
                        });

                        break;
                    }

                    p.thirst =
                        Math.min(
                            MAX_NEED,
                            p.thirst + 2
                        );

                    send(ws, {
                        type: 'action_ok',
                        action: 'drink',
                        health: p.health,
                        hunger: p.hunger,
                        thirst: p.thirst
                    });

                    break;
                }

                /* =================================================
                   OYUNCUYA SALDIRI
                   ================================================= */

                case 'attack_player': {

                    if (
                        !p.inGame ||
                        !p.alive ||
                        Date.now() - p.lastAttackAt < 550
                    ) {
                        break;
                    }

                    p.lastAttackAt = Date.now();

                    const target =
                        players[
                            String(data.targetId || '')
                        ];

                    if (
                        !target ||
                        !target.inGame ||
                        !target.alive ||
                        target === p
                    ) {
                        break;
                    }

                    const distance =
                        Math.hypot(
                            p.x - target.x,
                            p.z - target.z
                        );

                    if (distance > 4.0) {

                        send(ws, {
                            type: 'attack_result',
                            ok: false,
                            message:
                                'Vurmak için yaklaş.'
                        });

                        break;
                    }

                    const damage = 1;

                    target.health =
                        Math.max(
                            0,
                            target.health - damage
                        );

                    broadcast({
                        type: 'combat_hit',
                        attackerId: id,
                        targetId: data.targetId,
                        damage,
                        health: target.health,
                        targetName: target.name
                    });

                    sendNeeds(
                        String(data.targetId)
                    );

                    if (target.health <= 0) {

                        killPlayer(
                            String(data.targetId),
                            id,
                            `${target.name}, ${p.name} tarafından öldürüldü.`
                        );
                    }

                    send(ws, {
                        type: 'attack_result',
                        ok: true,
                        targetId: data.targetId,
                        damage
                    });

                    break;
                }

                /* =================================================
                   HAYVANA SALDIRI
                   ================================================= */

                case 'attack_animal': {

                    if (
                        !p.inGame ||
                        !p.alive ||
                        Date.now() - p.lastAttackAt < 550
                    ) {
                        break;
                    }

                    const animalId =
                        String(data.animalId || '');

                    const animal =
                        ensureAnimal(animalId);

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
                        ) > 4.0
                    ) {
                        break;
                    }

                    p.lastAttackAt = Date.now();

                    animal.health =
                        Math.max(
                            0,
                            animal.health - 1
                        );

                    if (animal.health === 0) {
                        animal.alive = false;
                    }

                    broadcast({
                        type: 'animal_state',
                        id: animalId,
                        health: animal.health,
                        hunger: animal.hunger,
                        thirst: animal.thirst,
                        alive: animal.alive
                    });

                    send(ws, {
                        type: 'attack_result',
                        ok: true,
                        animalId,
                        damage: 1
                    });

                    if (!animal.alive) {
                        publicSystem(
                            `${p.name}, ${String(data.animalName || 'bir vahşi hayvan')} adlı hayvanı yendi.`
                        );
                    }

                    break;
                }

                /* =================================================
                   HAYVAN SALDIRISI
                   ================================================= */

                case 'animal_attack': {

                    if (
                        !p.inGame ||
                        !p.alive ||
                        Date.now() - p.lastAnimalAttackAt < 1800
                    ) {
                        break;
                    }

                    const animalId =
                        String(data.animalId || '');

                    const animal =
                        ensureAnimal(animalId);

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
                        ) > 3.2
                    ) {
                        break;
                    }

                    p.lastAnimalAttackAt =
                        Date.now();

                    p.health =
                        Math.max(
                            0,
                            p.health - 0.5
                        );

                    broadcast({
                        type: 'animal_bite',
                        animalId,
                        targetId: id,
                        damage: 0.5,
                        health: p.health
                    });

                    sendNeeds(id);

                    if (p.health <= 0) {

                        killPlayer(
                            id,
                            null,
                            `${p.name} vahşi hayvanların saldırısında hayatını kaybetti.`
                        );
                    }

                    break;
                }

                /* =================================================
                   HAYVAN BAKIMI
                   ================================================= */

                case 'animal_care': {

                    if (!p.inGame || !p.alive) {
                        break;
                    }

                    const animal =
                        ensureAnimal(
                            String(data.animalId || '')
                        );

                    if (
                        !animal ||
                        !animal.alive ||
                        Date.now() - animal.lastCareAt < 8000
                    ) {
                        break;
                    }

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

                    if (data.action === 'eat') {

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
                                animal.hunger + 1
                            );

                    } else if (
                        data.action === 'drink'
                    ) {

                        const atPond =
                            Math.hypot(
                                x - FOREST_POND.x,
                                z - FOREST_POND.z
                            ) <=
                            FOREST_POND.radius + 4;

                        const atBeach =
                            x >= -310 &&
                            x <= -35 &&
                            z >= -459 &&
                            z <= -444;

                        if (!atPond && !atBeach) {
                            break;
                        }

                        animal.thirst =
                            Math.min(
                                MAX_NEED,
                                animal.thirst + 1.25
                            );

                    } else {
                        break;
                    }

                    animal.lastCareAt =
                        Date.now();

                    broadcast({
                        type: 'animal_state',
                        id: animal.id,
                        health: animal.health,
                        hunger: animal.hunger,
                        thirst: animal.thirst,
                        alive: animal.alive,
                        care: data.action
                    });

                    break;
                }

                /* =================================================
                   HAYVAN DURUMLARI
                   ================================================= */

                case 'animal_states_request': {

                    const states = {};

                    for (
                        const animalId of (
                            Array.isArray(data.ids)
                                ? data.ids.slice(0, 80)
                                : []
                        )
                    ) {

                        const state =
                            ensureAnimal(animalId);

                        if (state) {
                            states[animalId] = {
                                health: state.health,
                                hunger: state.hunger,
                                thirst: state.thirst,
                                alive: state.alive
                            };
                        }
                    }

                    send(ws, {
                        type: 'animal_states',
                        states
                    });

                    break;
                }

                /* =================================================
                   RESPAWN
                   ================================================= */

                case 'respawn': {

                    if (
                        !p.inGame ||
                        p.alive
                    ) {
                        break;
                    }

                    p.alive = true;

                    p.health = MAX_NEED;
                    p.hunger = MAX_NEED;
                    p.thirst = MAX_NEED;

                    p.x = SPAWN.x;
                    p.y = SPAWN.y;
                    p.z = SPAWN.z;

                    p.lastNeedTick =
                        Date.now();

                    send(ws, {
                        type: 'respawned',
                        spawn: SPAWN,
                        state: playerSnapshot(p)
                    });

                    sendPlayers();

                    break;
                }

                default:
                    break;
            }

        } catch (error) {

            console.warn(
                `Geçersiz istemci mesajı (${id}):`,
                error.message
            );
        }
    });

    /* =========================================================
       BAĞLANTI KAPANDI
       ========================================================= */

    ws.on('close', () => {

        delete players[id];

        console.log(
            `Oyuncu ayrıldı: ${id}`
        );

        sendPlayers();
    });

    ws.on('error', error => {

        console.warn(
            `WebSocket hatası (${id}):`,
            error.message
        );
    });
});

/* =========================================================
   OYUNCU AÇLIK / SUSUZLUK
   ========================================================= */

setInterval(() => {

    const now = Date.now();

    for (const [playerId, p] of Object.entries(players)) {

        if (!p.inGame || !p.alive) {
            continue;
        }

        const elapsed =
            now - p.lastNeedTick;

        const steps =
            Math.floor(elapsed / 30000);

        if (!steps) {
            continue;
        }

        p.lastNeedTick +=
            steps * 30000;

        p.hunger =
            Math.max(
                0,
                p.hunger - 0.25 * steps
            );

        p.thirst =
            Math.max(
                0,
                p.thirst - 0.5 * steps
            );

        if (
            (p.hunger <= 0 ||
                p.thirst <= 0) &&
            now -
                (p.lastStarveDamageAt || 0) >=
                30000
        ) {

            p.health =
                Math.max(
                    0,
                    p.health - 0.5
                );

            p.lastStarveDamageAt = now;

            if (p.health <= 0) {

                const cause =
                    p.thirst <= 0
                        ? 'susuzluktan'
                        : 'açlıktan';

                killPlayer(
                    playerId,
                    null,
                    `${p.name} ${cause} hayatını kaybetti.`
                );
            }
        }

        sendNeeds(playerId);
    }

}, 1000);

/* =========================================================
   HAYVAN AÇLIK / SUSUZLUK
   ========================================================= */

setInterval(() => {

    const now = Date.now();

    const hasPlayers =
        Object.values(players)
            .some(
                p => p.inGame && p.alive
            );

    for (const animal of wildAnimals.values()) {

        if (
            !hasPlayers ||
            !animal.alive
        ) {
            animal.lastNeedTick = now;
            continue;
        }

        const steps =
            Math.floor(
                (now - animal.lastNeedTick) /
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
            (animal.hunger <= 0 ||
                animal.thirst <= 0) &&
            now -
                animal.lastStarveDamageAt >=
                30000
        ) {

            animal.health =
                Math.max(
                    0,
                    animal.health - 0.5
                );

            animal.lastStarveDamageAt =
                now;

            if (animal.health <= 0) {

                animal.alive = false;

                publicSystem(
                    `${animalLabel(animal.id)} vahşi hayvanı ${
                        animal.thirst <= 0
                            ? 'susuzluktan'
                            : 'açlıktan'
                    } öldü.`
                );
            }
        }

        broadcast({
            type: 'animal_state',
            id: animal.id,
            health: animal.health,
            hunger: animal.hunger,
            thirst: animal.thirst,
            alive: animal.alive
        });
    }

}, 1000);

/* =========================================================
   ELMA BÜYÜMESİ
   ========================================================= */

setInterval(() => {

    for (const state of appleTrees.values()) {

        const before =
            state.apples;

        appleState(
            state.id,
            state.x,
            state.z
        );

        if (
            state.apples !== before
        ) {

            broadcast({
                type: 'apple_update',
                treeId: state.id,
                apples: state.apples
            });
        }
    }

}, 10000);

/* =========================================================
   OYUNCULARI YAYINLA
   ========================================================= */

setInterval(
    sendPlayers,
    100
);

/* =========================================================
   CHAT TEMİZLEME
   ========================================================= */

setInterval(() => {

    chatHistory = [];

    broadcast({
        type: 'chat_reset',
        time: new Date().toISOString()
    });

}, CHAT_RESET_MS);

/* =========================================================
   SUNUCU
   ========================================================= */

const MAP_LIMIT = 510;

const PORT =
    process.env.PORT || 3000;

server.listen(
    PORT,
    () => {
        console.log(
            `Sunucu ${PORT} portunda çalışıyor.`
        );
    }
);
