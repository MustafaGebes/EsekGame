const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const WebSocket = require('ws');

const APP_VERSION = "2026-09-29-5";

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, maxPayload: 24 * 1024 });
app.use(express.json({ limit: '32kb' }));

const DATA_DIR = path.join(__dirname, 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const LEGACY_ACCOUNTS_FILE = path.join(__dirname, 'accounts.json');
let accounts = {};

function loadAccountsSafely() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const candidates = [ACCOUNTS_FILE, LEGACY_ACCOUNTS_FILE];

    for (const file of candidates) {
        if (!fs.existsSync(file)) continue;

        try {
            const raw = JSON.parse(fs.readFileSync(file, 'utf8'));

            if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
                // Hem {accounts:{...}} hem eski doğrudan hesap objesini destekle.
                const source =
                    raw.accounts &&
                    typeof raw.accounts === 'object' &&
                    !Array.isArray(raw.accounts)
                        ? raw.accounts
                        : raw;

                accounts = source;

                if (file !== ACCOUNTS_FILE && Object.keys(accounts).length) {
                    saveAccounts();
                }

                return;
            }
        } catch (e) {
            console.warn(`${file} okunamadı:`, e.message);
            // Bozuk dosyayı ASLA boş dosyayla ezme.
        }
    }
}

function saveAccounts() {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    const tmp = ACCOUNTS_FILE + '.tmp';

    fs.writeFileSync(
        tmp,
        JSON.stringify({ accounts }, null, 2),
        'utf8'
    );

    fs.renameSync(tmp, ACCOUNTS_FILE);
}

loadAccountsSafely();

function normalizeUsername(value) {
    return String(value ?? '')
        .trim()
        .normalize('NFKC')
        .toLocaleLowerCase('tr-TR');
}

function validUsername(value) {
    return /^[A-Za-z0-9_çğıöşüÇĞİÖŞÜ-]{3,20}$/.test(
        String(value || '')
    );
}

function hashPassword(password, salt) {
    return crypto
        .scryptSync(String(password), salt, 64)
        .toString('hex');
}

function makeAccount(username, password) {
    const salt = crypto.randomBytes(16).toString('hex');

    return {
        username,
        salt,
        passwordHash: hashPassword(password, salt),
        token: crypto.randomBytes(32).toString('hex')
    };
}

function findAccountByToken(token) {
    if (!token) return null;

    return (
        Object.values(accounts).find(
            a => a && a.token === token
        ) || null
    );
}

app.post('/api/auth/register', (req, res) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const passwordConfirm = String(
        req.body?.passwordConfirm ??
        req.body?.password2 ??
        ''
    );

    if (!validUsername(username)) {
        return res.status(400).json({
            message:
                'Kullanıcı adı 3-20 karakter olmalı ve yalnızca harf, rakam, _ veya - içermeli.'
        });
    }

    if (password.length < 6) {
        return res.status(400).json({
            message: 'Şifre en az 6 karakter olmalı.'
        });
    }

    if (passwordConfirm !== password) {
        return res.status(400).json({
            message: 'Şifreler aynı değil.'
        });
    }

    const key = normalizeUsername(username);

    if (accounts[key]) {
        return res.status(409).json({
            message: 'Bu kullanıcı adı zaten alınmış.'
        });
    }

    const account = makeAccount(username, password);

    accounts[key] = account;

    saveAccounts();

    res.json({
        ok: true,
        username: account.username,
        token: account.token
    });
});

app.post('/api/auth/login', (req, res) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    const account = accounts[normalizeUsername(username)];

    if (!account) {
        return res.status(401).json({
            message: 'Kullanıcı adı veya şifre hatalı.'
        });
    }

    const hash = hashPassword(password, account.salt);

    if (
        !crypto.timingSafeEqual(
            Buffer.from(hash, 'hex'),
            Buffer.from(account.passwordHash, 'hex')
        )
    ) {
        return res.status(401).json({
            message: 'Kullanıcı adı veya şifre hatalı.'
        });
    }

    account.token = crypto.randomBytes(32).toString('hex');

    saveAccounts();

    res.json({
        ok: true,
        username: account.username,
        token: account.token
    });
});

function findAccountByUsername(username) {
    const key = normalizeUsername(username);

    if (accounts[key]) {
        return {
            key,
            account: accounts[key]
        };
    }

    for (const [storedKey, account] of Object.entries(accounts)) {
        if (
            account &&
            normalizeUsername(account.username) === key
        ) {
            return {
                key: storedKey,
                account
            };
        }
    }

    return null;
}

app.get('/api/auth/me', (req, res) => {
    const token = String(
        req.query?.token ||
        req.headers['x-auth-token'] ||
        ''
    );

    const account = findAccountByToken(token);

    if (!account) {
        return res.status(401).json({
            ok: false,
            message: 'Oturum geçersiz.'
        });
    }

    res.json({
        ok: true,
        username: account.username,
        token: account.token
    });
});

app.post('/api/auth/logout', (req, res) => {
    const account = findAccountByToken(
        String(req.body?.token || '')
    );

    if (account) {
        account.token = crypto.randomBytes(32).toString('hex');
        saveAccounts();
    }

    res.json({
        ok: true
    });
});

app.post(
    ['/api/auth/change-username', '/api/auth/change-name'],
    (req, res) => {
        try {
            const account = findAccountByToken(
                String(req.body?.token || '')
            );

            if (!account) {
                return res.status(401).json({
                    ok: false,
                    message: 'Oturum geçersiz.'
                });
            }

            const username = String(
                req.body?.username || ''
            ).trim();

            if (!validUsername(username)) {
                return res.status(400).json({
                    ok: false,
                    message: 'Kullanıcı adı 3-20 karakter olmalı.'
                });
            }

            const oldKey = normalizeUsername(account.username);
            const newKey = normalizeUsername(username);

            const found = findAccountByUsername(username);

            if (found && found.account !== account) {
                return res.status(409).json({
                    ok: false,
                    message: 'Bu kullanıcı adı zaten alınmış.'
                });
            }

            delete accounts[oldKey];

            account.username = username;

            accounts[newKey] = account;

            saveAccounts();

            for (const p of Object.values(players)) {
                if (
                    p.accountUsername &&
                    normalizeUsername(p.accountUsername) === oldKey
                ) {
                    p.accountUsername = username;
                    p.name = username;
                }
            }

            sendPlayers();

            res.json({
                ok: true,
                username: account.username,
                token: account.token
            });
        } catch (e) {
            console.error('Ad değiştirme hatası:', e);

            res.status(500).json({
                ok: false,
                message: 'Ad değiştirilemedi.'
            });
        }
    }
);

app.post('/api/auth/change-password', (req, res) => {
    try {
        const account = findAccountByToken(
            String(req.body?.token || '')
        );

        if (!account) {
            return res.status(401).json({
                ok: false,
                message: 'Oturum geçersiz.'
            });
        }

        const oldPassword = String(
            req.body?.oldPassword ??
            req.body?.currentPassword ??
            ''
        );

        const newPassword = String(
            req.body?.newPassword || ''
        );

        const confirm = String(
            req.body?.newPasswordConfirm ??
            req.body?.newPassword2 ??
            ''
        );

        let valid = false;

        try {
            const hash = hashPassword(
                oldPassword,
                account.salt
            );

            const a = Buffer.from(hash, 'hex');
            const b = Buffer.from(
                String(account.passwordHash),
                'hex'
            );

            valid =
                a.length === b.length &&
                crypto.timingSafeEqual(a, b);
        } catch (_) {}

        if (!valid) {
            return res.status(401).json({
                ok: false,
                message: 'Mevcut şifre yanlış.'
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                ok: false,
                message: 'Yeni şifre en az 6 karakter olmalı.'
            });
        }

        if (newPassword !== confirm) {
            return res.status(400).json({
                ok: false,
                message: 'Yeni şifreler aynı değil.'
            });
        }

        account.salt = crypto.randomBytes(16).toString('hex');

        account.passwordHash = hashPassword(
            newPassword,
            account.salt
        );

        account.token = crypto.randomBytes(32).toString('hex');

        saveAccounts();

        res.json({
            ok: true,
            token: account.token,
            username: account.username
        });
    } catch (e) {
        console.error('Şifre değiştirme hatası:', e);

        res.status(500).json({
            ok: false,
            message: 'Şifre değiştirilemedi.'
        });
    }
});

app.use(express.static(__dirname));

app.get('/', (_req, res) => {
    res.sendFile(
        path.join(__dirname, 'index.html')
    );
});

app.get('/health', (_req, res) => {
    res.json({
        ok: true,
        players: activePlayerCount()
    });
});

const players = Object.create(null);
const appleTrees = new Map();
const carrots = new Map();
const wildAnimals = new Map();

let chatHistory = [];

function nextGuestName() {
    const used = new Set();

    for (const player of Object.values(players)) {
        if (
            !player ||
            !player.inGame ||
            typeof player.name !== 'string'
        ) continue;

        const match = player.name.match(
            /^Guest-(\d+)$/
        );

        if (!match) continue;

        const n = Number(match[1]);

        if (
            Number.isInteger(n) &&
            n >= 0
        ) {
            used.add(n);
        }
    }

    let n = 0;

    while (used.has(n)) {
        n++;
    }

    return `Guest-${String(n).padStart(3, '0')}`;
}

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

function activePlayerCount() {
    return Object.values(players)
        .filter(p => p.inGame)
        .length;
}

function send(ws, payload) {
    if (
        ws.readyState === WebSocket.OPEN
    ) {
        ws.send(JSON.stringify(payload));
    }
}

function broadcast(payload) {
    const encoded = JSON.stringify(payload);

    for (const client of wss.clients) {
        if (
            client.readyState === WebSocket.OPEN
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
    const n = Number(value);

    return Number.isFinite(n)
        ? Math.max(min, Math.min(max, n))
        : fallback;
}

function cleanName(value) {
    const name = String(value ?? '')
        .replace(
            /[\u0000-\u001f\u007f]/g,
            ''
        )
        .trim()
        .slice(0, 20);

    return name || 'Player';
}

function nameKey(value) {
    return cleanName(value)
        .normalize('NFKC')
        .toLocaleLowerCase('tr-TR');
}

function cleanText(
    value,
    limit = 220
) {
    return String(value ?? '')
        .replace(
            /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,
            ''
        )
        .trim()
        .slice(0, limit);
}

function playerSnapshot(p) {
    return {
        id: p.id,
        name: p.name,
        accountUsername: p.accountUsername || null,
        x: p.x,
        y: p.y,
        z: p.z,
        rotation: p.rotation,
        health: p.health,
        hunger: p.hunger,
        thirst: p.thirst,
        alive: p.alive,
        inGame: p.inGame
    };
}

function sendPlayers() {
    const publicPlayers = Object.create(null);

    for (const [id, p] of Object.entries(players)) {
        publicPlayers[id] = playerSnapshot(p);
    }

    broadcast({
        type: 'players',
        players: publicPlayers
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

function publicSystem(message) {
    broadcast({
        type: 'system_message',
        message: cleanText(message, 220)
    });
}

function ensureAnimal(id) {
    id = String(id || '');

    if (!id) return null;

    if (!wildAnimals.has(id)) {
        wildAnimals.set(id, {
            id,
            health: 5,
            hunger: MAX_NEED,
            thirst: MAX_NEED,
            alive: true,
            lastCareAt: 0,
            lastNeedTick: Date.now(),
            lastStarveDamageAt: 0
        });
    }

    return wildAnimals.get(id);
}

function animalLabel(id) {
    const s = String(id || '');

    if (s.includes('deer')) return 'geyik';
    if (s.includes('boar')) return 'yaban domuzu';
    if (s.includes('wolf')) return 'kurt';

    return 'vahşi hayvan';
}

function killPlayer(
    id,
    killerId = null,
    message = ''
) {
    const p = players[id];

    if (!p) return;

    p.health = 0;
    p.alive = false;
    p.lastDamageAt = Date.now();

    send(p.ws, {
        type: 'dead',
        killerId,
        message: message || 'Öldün.'
    });

    if (message) {
        publicSystem(message);
    }

    sendPlayers();
}

function appleState(
    treeId,
    x,
    z
) {
    let state = appleTrees.get(treeId);

    if (!state) {
        state = {
            id: treeId,
            x: Number(x) || 0,
            z: Number(z) || 0,
            apples: 10,
            max: 20,
            nextGrowAt:
                Date.now() + APPLE_GROW_MS
        };

        appleTrees.set(treeId, state);
    }

    const now = Date.now();

    if (
        state.apples < state.max &&
        now >= state.nextGrowAt
    ) {
        const steps = Math.floor(
            (now - state.nextGrowAt) /
                APPLE_GROW_MS
        ) + 1;

        state.apples = Math.min(
            state.max,
            state.apples + steps * 5
        );

        state.nextGrowAt =
            now + APPLE_GROW_MS;
    }

    return state;
}

function makePlayer(id, ws) {
    return {
        id,
        ws,

        name: `Guest-${String(id).slice(-3)}`,

        accountUsername: null,

        x: SPAWN.x,
        y: SPAWN.y,
        z: SPAWN.z,

        rotation: 0,

        health: MAX_NEED,
        hunger: MAX_NEED,
        thirst: MAX_NEED,

        alive: true,
        inGame: false,

        lastNeedTick: Date.now(),
        lastStarveDamageAt: 0,
        lastDamageAt: 0,
        lastAttackAt: 0,
        lastAnimalAttackAt: 0,

        lastMoveAt: 0
    };
}

const riverSegments = [
    [
        [-240, -180],
        [-210, -160],
        [-175, -145],
        [-140, -130],
        [-105, -125],
        [-70, -110]
    ],
    [
        [-70, -110],
        [-35, -95],
        [0, -90],
        [35, -85],
        [70, -75],
        [105, -65],
        [140, -50]
    ],
    [
        [140, -50],
        [175, -30],
        [205, -5],
        [225, 25],
        [245, 60]
    ]
];

function inRiver(
    x,
    z
) {
    const px = Number(x);
    const pz = Number(z);

    function pointToSegmentDistance(
        px,
        pz,
        ax,
        az,
        bx,
        bz
    ) {
        const dx = bx - ax;
        const dz = bz - az;
        const l2 = dx * dx + dz * dz || 1;

        const t = Math.max(
            0,
            Math.min(
                1,
                (
                    (px - ax) * dx +
                    (pz - az) * dz
                ) / l2
            )
        );

        return Math.hypot(
            px - (ax + t * dx),
            pz - (az + t * dz)
        );
    }

    let distance = Infinity;

    for (const line of riverSegments) {
        for (
            let i = 0;
            i < line.length - 1;
            i++
        ) {
            distance = Math.min(
                distance,
                pointToSegmentDistance(
                    px,
                    pz,
                    line[i][0],
                    line[i][1],
                    line[i + 1][0],
                    line[i + 1][1]
                )
            );
        }
    }

    return distance <= 4.2;
}

function inWater(
    x,
    z
) {
    const atBeach =
        x >= -310 &&
        x <= -35 &&
        z >= -459 &&
        z <= -444;

    const atPond =
        Math.hypot(
            x - FOREST_POND.x,
            z - FOREST_POND.z
        ) <= FOREST_POND.radius;

    return (
        atBeach ||
        atPond ||
        inRiver(x, z)
    );
}

wss.on('connection', (ws) => {
    const id =
        crypto.randomUUID();

    const p =
        makePlayer(id, ws);

    players[id] = p;

    send(ws, {
        type: 'welcome',
        id,
        version: APP_VERSION,
        state: playerSnapshot(p),
        players: Object.fromEntries(
            Object.entries(players)
                .map(([key, value]) => [
                    key,
                    playerSnapshot(value)
                ])
        )
    });

    ws.on('message', raw => {
        try {
            const data =
                JSON.parse(raw.toString());

            if (!data || typeof data !== 'object') {
                return;
            }

            switch (data.type) {
                case 'join_request': {
                    if (p.inGame) break;

                    const accountUsername =
                        cleanName(
                            data.accountUsername ||
                            data.username ||
                            ''
                        );

                    if (
                        accountUsername &&
                        accountUsername !== 'Player'
                    ) {
                        p.accountUsername =
                            accountUsername;

                        p.name =
                            accountUsername;
                    } else {
                        p.accountUsername = null;
                        p.name =
                            nextGuestName();
                    }

                    p.inGame = true;
                    p.alive = true;
                    p.health = MAX_NEED;
                    p.hunger = MAX_NEED;
                    p.thirst = MAX_NEED;
                    p.x = SPAWN.x;
                    p.y = SPAWN.y;
                    p.z = SPAWN.z;
                    p.lastNeedTick = Date.now();
                    p.lastDamageAt = 0;
                    p.lastStarveDamageAt = 0;

                    send(ws, {
                        type: 'joined',
                        state: playerSnapshot(p)
                    });

                    sendPlayers();
                    break;
                }

                case 'presence': {
                    const active =
                        Boolean(data.inGame);

                    p.inGame = active;

                    if (!active) {
                        p.accountUsername =
                            p.accountUsername ||
                            null;
                    }

                    sendPlayers();
                    break;
                }

                case 'move': {
                    if (
                        !p.inGame ||
                        !p.alive
                    ) break;

                    p.x = clamp(
                        data.x,
                        -MAP_LIMIT,
                        MAP_LIMIT,
                        p.x
                    );

                    p.y = clamp(
                        data.y,
                        -100,
                        100,
                        p.y
                    );

                    p.z = clamp(
                        data.z,
                        -MAP_LIMIT,
                        MAP_LIMIT,
                        p.z
                    );

                    p.rotation =
                        Number.isFinite(
                            Number(data.rotation)
                        )
                            ? Number(data.rotation)
                            : p.rotation;

                    p.lastMoveAt =
                        Date.now();

                    break;
                }

                case 'chat': {
                    if (!p.inGame) break;

                    const text =
                        cleanText(
                            data.message,
                            220
                        );

                    if (!text) break;

                    const item = {
                        id: crypto.randomUUID(),
                        playerId: id,
                        name: p.name,
                        message: text,
                        time: Date.now()
                    };

                    chatHistory.push(item);

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
                        type: 'chat',
                        item
                    });

                    break;
                }

                case 'chat_history': {
                    send(ws, {
                        type: 'chat_history',
                        items: chatHistory
                    });

                    break;
                }

                case 'apple_state_request': {
                    const treeId =
                        String(
                            data.treeId || ''
                        );

                    if (!treeId) break;

                    const state = appleState(
                        treeId,
                        data.x,
                        data.z
                    );

                    send(ws, {
                        type: 'apple_update',
                        treeId,
                        apples: state.apples
                    });

                    break;
                }

                case 'apple_pick': {
                    if (
                        !p.inGame ||
                        !p.alive
                    ) break;

                    if (
                        p.hunger >= MAX_NEED
                    ) {
                        send(ws, {
                            type: 'action_denied',
                            action: 'eat',
                            message:
                                'Açlık barın dolu.'
                        });

                        break;
                    }

                    const treeId =
                        String(
                            data.treeId || ''
                        );

                    const state =
                        appleState(
                            treeId,
                            data.x,
                            data.z
                        );

                    if (!state) break;

                    const distance =
                        Math.hypot(
                            p.x - state.x,
                            p.z - state.z
                        );

                    if (distance > 6) {
                        send(ws, {
                            type: 'action_denied',
                            action: 'eat',
                            message:
                                'Elma ağacına yaklaş.'
                        });

                        break;
                    }

                    if (
                        state.apples <= 0
                    ) {
                        send(ws, {
                            type: 'action_denied',
                            action: 'eat',
                            message:
                                'Bu ağaçta elma yok.'
                        });

                        break;
                    }

                    state.apples--;

                    p.hunger =
                        Math.min(
                            MAX_NEED,
                            p.hunger + 1.5
                        );

                    send(ws, {
                        type: 'action_ok',
                        action: 'eat',
                        hunger: p.hunger,
                        thirst: p.thirst,
                        health: p.health
                    });

                    broadcast({
                        type: 'apple_update',
                        treeId,
                        apples: state.apples
                    });

                    break;
                }

                case 'carrot_state_request': {
                    const carrotId =
                        String(
                            data.carrotId || ''
                        );

                    if (!carrotId) break;

                    let state =
                        carrots.get(carrotId);

                    if (!state) {
                        state = {
                            id: carrotId,
                            x: Number(data.x) || 0,
                            z: Number(data.z) || 0,
                            available: true,
                            respawnAt: 0
                        };

                        carrots.set(
                            carrotId,
                            state
                        );
                    }

                    if (
                        !state.available &&
                        Date.now() >=
                            state.respawnAt
                    ) {
                        state.available = true;
                        state.respawnAt = 0;
                    }

                    send(ws, {
                        type: 'carrot_update',
                        carrotId,
                        available:
                            state.available
                    });

                    break;
                }

                case 'carrot_pick': {
                    if (
                        !p.inGame ||
                        !p.alive
                    ) break;

                    const carrotId =
                        String(
                            data.carrotId || ''
                        );

                    let state =
                        carrots.get(carrotId);

                    if (!state) {
                        state = {
                            id: carrotId,
                            x: Number(data.x) || 0,
                            z: Number(data.z) || 0,
                            available: true,
                            respawnAt: 0
                        };

                        carrots.set(
                            carrotId,
                            state
                        );
                    }

                    if (
                        !state.available
                    ) {
                        send(ws, {
                            type: 'action_denied',
                            action: 'eat',
                            message:
                                'Bu havuç daha çıkmadı.'
                        });

                        break;
                    }

                    if (
                        p.hunger >= MAX_NEED
                    ) {
                        send(ws, {
                            type: 'action_denied',
                            action: 'eat',
                            message:
                                'Açlık barın dolu.'
                        });

                        break;
                    }

                    const distance =
                        Math.hypot(
                            p.x - state.x,
                            p.z - state.z
                        );

                    if (distance > 5) {
                        send(ws, {
                            type: 'action_denied',
                            action: 'eat',
                            message:
                                'Havuça yaklaş.'
                        });

                        break;
                    }

                    state.available = false;

                    state.respawnAt =
                        Date.now() +
                        5 * 60 * 1000;

                    p.hunger =
                        Math.min(
                            MAX_NEED,
                            p.hunger + 1
                        );

                    send(ws, {
                        type: 'action_ok',
                        action: 'eat',
                        hunger: p.hunger,
                        thirst: p.thirst,
                        health: p.health
                    });

                    broadcast({
                        type: 'carrot_update',
                        carrotId,
                        available: false
                    });

                    break;
                }

                case 'drink': {
                    if (
                        !p.inGame ||
                        !p.alive
                    ) break;

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

                    let riverDistance =
                        Infinity;

                    function pointToSegmentDistance(
                        px,
                        pz,
                        ax,
                        az,
                        bx,
                        bz
                    ) {
                        const dx =
                            bx - ax;

                        const dz =
                            bz - az;

                        const l2 =
                            dx * dx +
                            dz * dz ||
                            1;

                        const t =
                            Math.max(
                                0,
                                Math.min(
                                    1,
                                    (
                                        (px - ax) * dx +
                                        (pz - az) * dz
                                    ) / l2
                                )
                            );

                        return Math.hypot(
                            px -
                                (
                                    ax +
                                    t * dx
                                ),
                            pz -
                                (
                                    az +
                                    t * dz
                                )
                        );
                    }

                    for (
                        const line of riverSegments
                    ) {
                        for (
                            let i = 0;
                            i < line.length - 1;
                            i++
                        ) {
                            riverDistance =
                                Math.min(
                                    riverDistance,
                                    pointToSegmentDistance(
                                        p.x,
                                        p.z,
                                        line[i][0],
                                        line[i][1],
                                        line[i + 1][0],
                                        line[i + 1][1]
                                    )
                                );
                        }
                    }

                    const atRiver =
                        riverDistance <= 4.2;

                    if (
                        !atBeachWater &&
                        !atForestPond &&
                        !atRiver
                    ) {
                        send(ws, {
                            type: 'action_denied',
                            action: 'drink',
                            message:
                                'Suya biraz daha yaklaş.'
                        });

                        break;
                    }

                    if (
                        p.thirst >= MAX_NEED
                    ) {
                        send(ws, {
                            type: 'action_denied',
                            action: 'drink',
                            message:
                                'Susuzluk barın zaten dolu.'
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

                case 'attack_player': {
                    if (
                        !p.inGame ||
                        !p.alive ||
                        Date.now() -
                            p.lastAttackAt <
                            550
                    ) break;

                    p.lastAttackAt =
                        Date.now();

                    const target =
                        players[
                            String(
                                data.targetId || ''
                            )
                        ];

                    if (
                        !target ||
                        !target.inGame ||
                        !target.alive ||
                        target === p
                    ) break;

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
                            target.health -
                                damage
                        );

                    target.lastDamageAt =
                        Date.now();

                    broadcast({
                        type: 'combat_hit',
                        attackerId: id,
                        targetId:
                            data.targetId,
                        damage,
                        health:
                            target.health,
                        targetName:
                            target.name
                    });

                    sendNeeds(
                        String(data.targetId)
                    );

                    if (
                        target.health <= 0
                    ) {
                        killPlayer(
                            String(
                                data.targetId
                            ),
                            id,
                            `${target.name}, ${p.name} tarafından öldürüldü.`
                        );
                    }

                    send(ws, {
                        type: 'attack_result',
                        ok: true,
                        targetId:
                            data.targetId,
                        damage
                    });

                    break;
                }

                case 'attack_animal': {
                    if (
                        !p.inGame ||
                        !p.alive ||
                        Date.now() -
                            p.lastAttackAt <
                            550
                    ) break;

                    const animalId =
                        String(
                            data.animalId || ''
                        );

                    const animal =
                        ensureAnimal(
                            animalId
                        );

                    const ax = clamp(
                        data.x,
                        -MAP_LIMIT,
                        MAP_LIMIT,
                        p.x
                    );

                    const az = clamp(
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
                    ) break;

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

                    broadcast({
                        type: 'animal_state',
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
                        type: 'attack_result',
                        ok: true,
                        animalId,
                        damage: 1
                    });

                    if (!animal.alive) {
                        publicSystem(
                            `${p.name}, ${String(
                                data.animalName ||
                                'bir vahşi hayvan'
                            )} adlı hayvanı yendi.`
                        );
                    }

                    break;
                }

                case 'animal_attack': {
                    if (
                        !p.inGame ||
                        !p.alive ||
                        Date.now() -
                            p.lastAnimalAttackAt <
                            1800
                    ) break;

                    const animalId =
                        String(
                            data.animalId || ''
                        );

                    const animal =
                        ensureAnimal(
                            animalId
                        );

                    const ax = clamp(
                        data.x,
                        -MAP_LIMIT,
                        MAP_LIMIT,
                        p.x
                    );

                    const az = clamp(
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
                    ) break;

                    p.lastAnimalAttackAt =
                        Date.now();

                    p.health =
                        Math.max(
                            0,
                            p.health - 0.5
                        );

                    p.lastDamageAt =
                        Date.now();

                    broadcast({
                        type: 'animal_bite',
                        animalId,
                        targetId: id,
                        damage: 0.5,
                        health: p.health
                    });

                    sendNeeds(id);

                    if (
                        p.health <= 0
                    ) {
                        killPlayer(
                            id,
                            null,
                            `${p.name} vahşi hayvanların saldırısında hayatını kaybetti.`
                        );
                    }

                    break;
                }

                case 'animal_care': {
                    if (
                        !p.inGame ||
                        !p.alive
                    ) break;

                    const animal =
                        ensureAnimal(
                            String(
                                data.animalId || ''
                            )
                        );

                    if (
                        !animal ||
                        !animal.alive ||
                        Date.now() -
                            animal.lastCareAt <
                            8000
                    ) break;

                    const x = clamp(
                        data.x,
                        -MAP_LIMIT,
                        MAP_LIMIT,
                        p.x
                    );

                    const z = clamp(
                        data.z,
                        -MAP_LIMIT,
                        MAP_LIMIT,
                        p.z
                    );

                    if (
                        data.action === 'eat'
                    ) {
                        if (
                            Math.hypot(
                                x - 220,
                                z + 55
                            ) > 150
                        ) break;

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

                        if (
                            !atPond &&
                            !atBeach
                        ) break;

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
                        type: 'animal_state',
                        id: animal.id,
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

                case 'animal_states_request': {
                    const states = {};

                    for (
                        const animalId of (
                            Array.isArray(data.ids)
                                ? data.ids.slice(
                                      0,
                                      80
                                  )
                                : []
                        )
                    ) {
                        const state =
                            ensureAnimal(
                                animalId
                            );

                        if (state) {
                            states[animalId] = {
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

                    send(ws, {
                        type: 'animal_states',
                        states
                    });

                    break;
                }

                case 'respawn': {
                    if (
                        !p.inGame ||
                        p.alive
                    ) break;

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
                        state:
                            playerSnapshot(p)
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

setInterval(() => {
    const now = Date.now();

    for (
        const [id, p] of Object.entries(players)
    ) {
        if (
            !p.inGame ||
            !p.alive
        ) continue;

        // Açlık/susuzluk eskisinden belirgin şekilde daha hızlı azalır.
        const elapsed =
            now - p.lastNeedTick;

        const steps =
            Math.floor(
                elapsed / 10000
            );

        if (steps > 0) {
            p.lastNeedTick +=
                steps * 10000;

            p.hunger =
                Math.max(
                    0,
                    p.hunger -
                        0.50 * steps
                );

            p.thirst =
                Math.max(
                    0,
                    p.thirst -
                        0.75 * steps
                );
        }

        // Açlık veya susuzluk bittiyse hasar:
        // biri 0 ise yarım kalp,
        // ikisi de 0 ise bir kalp.
        // Hasar aralığı 5 saniyedir.
        if (
            (
                p.hunger <= 0 ||
                p.thirst <= 0
            ) &&
            now -
                (
                    p.lastStarveDamageAt ||
                    0
                ) >=
                5000
        ) {
            const damage =
                (
                    p.hunger <= 0 &&
                    p.thirst <= 0
                )
                    ? 1
                    : 0.5;

            p.health =
                Math.max(
                    0,
                    p.health - damage
                );

            p.lastStarveDamageAt =
                now;

            p.lastDamageAt =
                now;

            if (
                p.health <= 0
            ) {
                const cause =
                    p.hunger <= 0 &&
                    p.thirst <= 0
                        ? 'açlık ve susuzluktan'
                        : (
                            p.thirst <= 0
                                ? 'susuzluktan'
                                : 'açlıktan'
                        );

                killPlayer(
                    id,
                    null,
                    `${p.name} ${cause} hayatını kaybetti.`
                );
            }
        }

        // Son hasardan 5 saniye sonra,
        // saniyede yarım kalp iyileş.
        if (
            p.alive &&
            p.health > 0 &&
            p.health < MAX_NEED &&
            p.hunger > 0 &&
            p.thirst > 0 &&
            now -
                (p.lastDamageAt || 0) >=
                5000
        ) {
            p.health =
                Math.min(
                    MAX_NEED,
                    p.health + 0.5
                );
        }

        sendNeeds(id);
    }
}, 1000);

setInterval(() => {
    const now = Date.now();

    const hasPlayers =
        Object.values(players)
            .some(
                p =>
                    p.inGame &&
                    p.alive
            );

    for (
        const animal of wildAnimals.values()
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

        if (!steps) continue;

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
                    animal.health - 0.5
                );

            animal.lastStarveDamageAt =
                now;

            if (
                animal.health <= 0
            ) {
                animal.alive = false;

                publicSystem(
                    `${animalLabel(
                        animal.id
                    )} vahşi hayvanı ${
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

setInterval(() => {
    for (
        const state of appleTrees.values()
    ) {
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

setInterval(
    sendPlayers,
    100
);

setInterval(() => {
    chatHistory = [];

    broadcast({
        type: 'chat_reset',
        time:
            new Date().toISOString()
    });
}, CHAT_RESET_MS);

const MAP_LIMIT = 510;

const PORT =
    process.env.PORT || 3000;

server.listen(
    PORT,
    () =>
        console.log(
            `Sunucu ${PORT} portunda çalışıyor.`
        )
);
