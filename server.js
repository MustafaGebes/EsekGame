'use strict';

/*
==========================================================
 EŞEK SIMULATOR - MULTIPLAYER SERVER
 Current Simulator protocol:
   join_request
   join_accepted
   presence
   move
   ping
   chat
   chat_history
   apple_state_request
   apple_pick
   drink
   carrot_state_request
   carrot_pick
   attack_player
   attack_animal
   animal_attack
   animal_care
   animal_states_request
   respawn

 Node.js + Express + ws
==========================================================
*/

const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const WebSocket = require('ws');


// ========================================================
// BASIC SERVER
// ========================================================

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({
    server,
    maxPayload: 64 * 1024
});

app.use(express.json({ limit: '64kb' }));
app.use(express.static(__dirname));


// ========================================================
// PATHS
// ========================================================

const ROOT_DIR = __dirname;

const DATA_DIR = path.join(ROOT_DIR, 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');


// ========================================================
// CONSTANTS
// ========================================================

const PORT = Number(process.env.PORT) || 3000;

const MAP_LIMIT = 510;

const MAX_NEED = 9;
const MAX_HEALTH = 9;

const SPAWN = {
    x: 180,
    y: 0,
    z: 210
};

const APP_VERSION = '2026-09-29-6';


// --------------------------------------------------------
// NEEDS
// --------------------------------------------------------

const NEED_TICK_MS = 10 * 1000;

// User requested faster hunger/thirst drain.
const HUNGER_DRAIN = 0.50;
const THIRST_DRAIN = 0.75;

// Starvation damage every 5 seconds.
const STARVATION_DAMAGE_MS = 5000;

const STARVATION_DAMAGE_ONE = 0.5;
const STARVATION_DAMAGE_BOTH = 1.0;

// Heal 5 seconds after taking damage.
const HEAL_DELAY_MS = 5000;
const HEAL_TICK_MS = 1000;
const HEAL_AMOUNT = 0.5;


// --------------------------------------------------------
// APPLES
// --------------------------------------------------------

const APPLE_GROW_MS = 5 * 60 * 1000;

const APPLE_MAX = 20;
const APPLE_GROW_AMOUNT = 5;

const APPLE_START_AMOUNT = 20;

const APPLE_PICK_DISTANCE = 7;


// --------------------------------------------------------
// CARROTS
// --------------------------------------------------------

const CARROT_RESPAWN_MS = 5 * 60 * 1000;

const CARROT_BATCH_AMOUNT = 20;

const CARROT_PICK_DISTANCE = 5;


// --------------------------------------------------------
// CHAT
// --------------------------------------------------------

const CHAT_LIMIT = 100;

const CHAT_RESET_MS = 10 * 60 * 1000;

const CHAT_COOLDOWN_MS = 450;


// --------------------------------------------------------
// COMBAT
// --------------------------------------------------------

const PLAYER_ATTACK_COOLDOWN = 550;

const PLAYER_ATTACK_DISTANCE = 4;

const PLAYER_ATTACK_DAMAGE = 1;

const ANIMAL_ATTACK_COOLDOWN = 1800;

const ANIMAL_ATTACK_DISTANCE = 3.2;

const ANIMAL_ATTACK_DAMAGE = 0.5;


// --------------------------------------------------------
// RIVER / WATER
// --------------------------------------------------------

const FOREST_POND = {
    x: 300,
    z: -8,
    radius: 14
};


// ========================================================
// STATE
// ========================================================

const players = Object.create(null);

const appleTrees = new Map();

const carrotPatches = new Map();

const wildAnimals = new Map();

let chatHistory = [];


// ========================================================
// ACCOUNT SYSTEM
// ========================================================

let accounts = Object.create(null);


// ========================================================
// SAFE FILE HELPERS
// ========================================================

function ensureDataDirectory() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
    } catch (error) {
        console.error('data klasörü oluşturulamadı:', error);
    }
}


function loadAccounts() {
    ensureDataDirectory();

    let file = ACCOUNTS_FILE;

    // Backward compatibility with an old root accounts.json.
    const legacyFile = path.join(ROOT_DIR, 'accounts.json');

    if (!fs.existsSync(file) && fs.existsSync(legacyFile)) {
        file = legacyFile;
    }

    if (!fs.existsSync(file)) {
        accounts = Object.create(null);

        try {
            fs.writeFileSync(
                ACCOUNTS_FILE,
                JSON.stringify({ accounts: {} }, null, 2),
                'utf8'
            );
        } catch (error) {
            console.warn('accounts.json oluşturulamadı:', error.message);
        }

        return;
    }

    try {
        const raw = fs.readFileSync(file, 'utf8');

        if (!raw.trim()) {
            accounts = Object.create(null);
            return;
        }

        const parsed = JSON.parse(raw);

        if (
            parsed &&
            typeof parsed === 'object' &&
            parsed.accounts &&
            typeof parsed.accounts === 'object'
        ) {
            accounts = Object.assign(
                Object.create(null),
                parsed.accounts
            );
        } else if (
            parsed &&
            typeof parsed === 'object'
        ) {
            // Old format compatibility.
            accounts = Object.assign(
                Object.create(null),
                parsed
            );
        } else {
            accounts = Object.create(null);
        }

    } catch (error) {
        console.error(
            'accounts.json okunamadı. Mevcut dosya korunuyor:',
            error.message
        );

        accounts = Object.create(null);
    }
}


function saveAccounts() {
    ensureDataDirectory();

    const tempFile = `${ACCOUNTS_FILE}.tmp`;

    const data = JSON.stringify(
        {
            accounts
        },
        null,
        2
    );

    try {
        fs.writeFileSync(tempFile, data, 'utf8');
        fs.renameSync(tempFile, ACCOUNTS_FILE);
    } catch (error) {
        console.error(
            'accounts.json kaydedilemedi:',
            error.message
        );

        try {
            if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
            }
        } catch (_) {}
    }
}


loadAccounts();


// ========================================================
// CRYPTO / AUTH
// ========================================================

function randomToken() {
    return crypto.randomBytes(32).toString('hex');
}


function hashPassword(password) {
    return crypto
        .createHash('sha256')
        .update(String(password))
        .digest('hex');
}


function cleanUsername(value) {
    return String(value ?? '')
        .replace(/[^\p{L}\p{N}_-]/gu, '')
        .trim()
        .slice(0, 20);
}


function usernameKey(value) {
    return cleanUsername(value)
        .normalize('NFKC')
        .toLocaleLowerCase('tr-TR');
}


function validateUsername(value) {
    const username = cleanUsername(value);

    if (username.length < 3) {
        return {
            ok: false,
            message: 'Kullanıcı adı en az 3 karakter olmalı.'
        };
    }

    if (username.length > 20) {
        return {
            ok: false,
            message: 'Kullanıcı adı en fazla 20 karakter olabilir.'
        };
    }

    return {
        ok: true,
        username
    };
}


function findAccount(username) {
    const key = usernameKey(username);

    for (const [storedUsername, account] of Object.entries(accounts)) {
        if (usernameKey(storedUsername) === key) {
            return {
                key: storedUsername,
                account
            };
        }
    }

    return null;
}


function authAccountFromRequest(req) {
    const auth = String(
        req.headers.authorization || ''
    );

    if (!auth.startsWith('Bearer ')) {
        return null;
    }

    const token = auth.slice(7).trim();

    if (!token) {
        return null;
    }

    for (const [username, account] of Object.entries(accounts)) {
        if (
            account &&
            account.token &&
            account.token === token
        ) {
            return {
                username,
                account
            };
        }
    }

    return null;
}


// ========================================================
// HTTP ACCOUNT ROUTES
// ========================================================

app.get('/health', (_req, res) => {
    res.json({
        ok: true,
        version: APP_VERSION,
        players: activePlayerCount(),
        connectedSockets: wss.clients.size
    });
});


app.get('/api/version', (_req, res) => {
    res.json({
        ok: true,
        version: APP_VERSION
    });
});


app.post('/api/register', (req, res) => {
    const check = validateUsername(req.body?.username);

    if (!check.ok) {
        return res.status(400).json({
            ok: false,
            message: check.message
        });
    }

    const username = check.username;

    const password = String(
        req.body?.password || ''
    );

    const passwordConfirm = String(
        req.body?.passwordConfirm ??
        req.body?.password2 ??
        password
    );

    if (password.length < 4) {
        return res.status(400).json({
            ok: false,
            message: 'Şifre en az 4 karakter olmalı.'
        });
    }

    if (password !== passwordConfirm) {
        return res.status(400).json({
            ok: false,
            message: 'Şifreler eşleşmiyor.'
        });
    }

    if (findAccount(username)) {
        return res.status(409).json({
            ok: false,
            message: 'Bu kullanıcı adı zaten kullanılıyor.'
        });
    }

    const token = randomToken();

    accounts[username] = {
        username,
        passwordHash: hashPassword(password),
        token,
        createdAt: new Date().toISOString()
    };

    saveAccounts();

    return res.json({
        ok: true,
        username,
        token
    });
});


app.post('/api/login', (req, res) => {
    const username = cleanUsername(
        req.body?.username
    );

    const password = String(
        req.body?.password || ''
    );

    const found = findAccount(username);

    if (!found) {
        return res.status(401).json({
            ok: false,
            message: 'Kullanıcı adı veya şifre yanlış.'
        });
    }

    if (
        found.account.passwordHash !==
        hashPassword(password)
    ) {
        return res.status(401).json({
            ok: false,
            message: 'Kullanıcı adı veya şifre yanlış.'
        });
    }

    const token = randomToken();

    found.account.token = token;

    saveAccounts();

    return res.json({
        ok: true,
        username: found.account.username,
        token
    });
});


app.get('/api/me', (req, res) => {
    const auth = authAccountFromRequest(req);

    if (!auth) {
        return res.status(401).json({
            ok: false,
            message: 'Oturum bulunamadı.'
        });
    }

    return res.json({
        ok: true,
        username: auth.account.username
    });
});


app.post('/api/logout', (req, res) => {
    const auth = authAccountFromRequest(req);

    if (auth) {
        auth.account.token = null;
        saveAccounts();
    }

    res.json({
        ok: true
    });
});


app.post('/api/change-username', (req, res) => {
    const auth = authAccountFromRequest(req);

    if (!auth) {
        return res.status(401).json({
            ok: false,
            message: 'Oturum bulunamadı.'
        });
    }

    const check = validateUsername(
        req.body?.newUsername
    );

    if (!check.ok) {
        return res.status(400).json({
            ok: false,
            message: check.message
        });
    }

    const newUsername = check.username;

    if (
        usernameKey(newUsername) !==
        usernameKey(auth.username) &&
        findAccount(newUsername)
    ) {
        return res.status(409).json({
            ok: false,
            message: 'Bu kullanıcı adı zaten kullanılıyor.'
        });
    }

    const oldUsername = auth.username;

    const account = auth.account;

    delete accounts[oldUsername];

    account.username = newUsername;

    accounts[newUsername] = account;

    saveAccounts();

    return res.json({
        ok: true,
        username: newUsername
    });
});


app.post('/api/change-password', (req, res) => {
    const auth = authAccountFromRequest(req);

    if (!auth) {
        return res.status(401).json({
            ok: false,
            message: 'Oturum bulunamadı.'
        });
    }

    const oldPassword = String(
        req.body?.oldPassword || ''
    );

    const newPassword = String(
        req.body?.newPassword || ''
    );

    if (
        auth.account.passwordHash !==
        hashPassword(oldPassword)
    ) {
        return res.status(401).json({
            ok: false,
            message: 'Mevcut şifre yanlış.'
        });
    }

    if (newPassword.length < 4) {
        return res.status(400).json({
            ok: false,
            message: 'Yeni şifre en az 4 karakter olmalı.'
        });
    }

    auth.account.passwordHash =
        hashPassword(newPassword);

    auth.account.token = randomToken();

    saveAccounts();

    return res.json({
        ok: true,
        token: auth.account.token
    });
});


// ========================================================
// GENERAL HELPERS
// ========================================================

function send(ws, payload) {
    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {
        try {
            ws.send(JSON.stringify(payload));
        } catch (_) {}
    }
}


function broadcast(payload) {
    const encoded = JSON.stringify(payload);

    for (const client of wss.clients) {
        if (
            client.readyState === WebSocket.OPEN
        ) {
            try {
                client.send(encoded);
            } catch (_) {}
        }
    }
}


function broadcastExcept(exceptId, payload) {
    const encoded = JSON.stringify(payload);

    for (const [id, player] of Object.entries(players)) {
        if (id === exceptId) continue;

        if (
            player.ws &&
            player.ws.readyState === WebSocket.OPEN
        ) {
            try {
                player.ws.send(encoded);
            } catch (_) {}
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

    if (!Number.isFinite(n)) {
        return fallback;
    }

    return Math.max(
        min,
        Math.min(max, n)
    );
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


function nameKey(value) {
    return cleanName(value)
        .normalize('NFKC')
        .toLocaleLowerCase('tr-TR');
}


function activePlayerCount() {
    return Object.values(players)
        .filter(
            player =>
                player.inGame === true
        )
        .length;
}


// ========================================================
// GUEST NAME SYSTEM
// ========================================================

function getUsedGuestNumbers() {
    const used = new Set();

    for (const player of Object.values(players)) {
        if (!player.inGame) continue;

        const match = /^Guest-(\d+)$/.exec(
            String(player.name || '')
        );

        if (!match) continue;

        const number = Number(match[1]);

        if (
            Number.isInteger(number) &&
            number >= 0
        ) {
            used.add(number);
        }
    }

    return used;
}


function nextGuestName() {
    const used = getUsedGuestNumbers();

    let number = 0;

    while (used.has(number)) {
        number++;
    }

    return `Guest-${String(number).padStart(3, '0')}`;
}


function findActiveName(
    name,
    exceptId = null
) {
    const key = nameKey(name);

    for (const [id, player] of Object.entries(players)) {
        if (id === exceptId) continue;
        if (!player.inGame) continue;

        if (
            nameKey(player.name) === key
        ) {
            return [id, player];
        }
    }

    return null;
}


// ========================================================
// PLAYER SNAPSHOT
// ========================================================

function playerSnapshot(player) {
    return {
        id: player.id,

        x: player.x,
        y: player.y,
        z: player.z,

        yaw: player.yaw,
        pitch: player.pitch,

        isCrouching: player.isCrouching,
        isMoving: player.isMoving,
        isJumping: player.isJumping,

        name: player.name,

        platform: player.platform,

        pingMs: player.pingMs,

        inGame: player.inGame,

        alive: player.alive,

        health: player.health,
        hunger: player.hunger,
        thirst: player.thirst
    };
}


// ========================================================
// PLAYER LIST
// ========================================================

function sendPlayers() {
    const publicPlayers = {};

    for (const [id, player] of Object.entries(players)) {
        if (!player.inGame) continue;

        publicPlayers[id] =
            playerSnapshot(player);
    }

    broadcast({
        type: 'players',
        players: publicPlayers,
        count: activePlayerCount()
    });
}


// ========================================================
// NEEDS
// ========================================================

function sendNeeds(id) {
    const player = players[id];

    if (!player) return;

    send(player.ws, {
        type: 'needs',

        health: player.health,
        hunger: player.hunger,
        thirst: player.thirst,

        alive: player.alive
    });
}


function markPlayerDamaged(player) {
    player.lastDamageAt = Date.now();
}


function damagePlayer(
    id,
    amount,
    reason = null,
    killerId = null
) {
    const player = players[id];

    if (!player) return false;

    if (!player.inGame) return false;

    if (!player.alive) return false;

    const damage =
        Math.max(0, Number(amount) || 0);

    if (damage <= 0) return false;

    player.health = Math.max(
        0,
        player.health - damage
    );

    markPlayerDamaged(player);

    sendNeeds(id);

    broadcast({
        type: 'player_damage',

        id,

        damage,

        health: player.health,

        reason
    });

    if (player.health <= 0) {
        killPlayer(
            id,
            killerId,
            reason
        );
    }

    return true;
}


function healPlayer(
    id,
    amount
) {
    const player = players[id];

    if (!player) return;

    if (!player.inGame) return;

    if (!player.alive) return;

    if (player.health >= MAX_HEALTH) {
        return;
    }

    if (
        player.hunger <= 0 ||
        player.thirst <= 0
    ) {
        return;
    }

    const heal =
        Math.max(0, Number(amount) || 0);

    player.health = Math.min(
        MAX_HEALTH,
        player.health + heal
    );

    sendNeeds(id);
}


// ========================================================
// DEATH
// ========================================================

function killPlayer(
    victimId,
    killerId = null,
    cause = null
) {
    const victim = players[victimId];

    if (!victim) return;

    if (!victim.alive) return;

    victim.health = 0;
    victim.alive = false;

    victim.lastKiller =
        killerId || null;

    const killer =
        killerId
            ? players[killerId]
            : null;

    let reason;

    if (cause) {
        reason = cause;
    } else if (killer) {
        reason =
            `${victim.name}, ${killer.name} tarafından öldürüldü.`;
    } else {
        reason =
            `${victim.name} hayatını kaybetti.`;
    }

    publicSystem(reason);

    broadcast({
        type: 'player_death',

        id: victimId,

        killerId:
            killerId || null,

        killerName:
            killer
                ? killer.name
                : null,

        reason
    });

    sendNeeds(victimId);
}


// ========================================================
// SYSTEM CHAT
// ========================================================

function publicSystem(text) {
    const message = {
        id:
            `sys-${Date.now()}-${crypto
                .randomBytes(3)
                .toString('hex')}`,

        system: true,

        name: 'Sistem',

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
            chatHistory.slice(-CHAT_LIMIT);
    }

    broadcast({
        type: 'chat_message',
        message
    });
}


// ========================================================
// WHISPER
// ========================================================

function parseWhisper(text) {
    const quoted =
        text.match(
            /^\/msg\s+(\S+)\s+"([\s\S]{1,220})"\s*$/i
        );

    if (quoted) {
        return {
            target: cleanName(
                quoted[1]
            ),

            text: cleanText(
                quoted[2]
            )
        };
    }

    const plain =
        text.match(
            /^\/msg\s+(\S+)\s+([\s\S]{1,220})$/i
        );

    if (plain) {
        return {
            target: cleanName(
                plain[1]
            ),

            text: cleanText(
                plain[2]
            )
        };
    }

    return null;
}


// ========================================================
// APPLE SYSTEM
// ========================================================

function appleState(
    treeId,
    x,
    z
) {
    const now = Date.now();

    let state =
        appleTrees.get(treeId);

    if (!state) {
        state = {
            id: treeId,

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

            apples:
                APPLE_START_AMOUNT,

            lastGrowAt:
                now
        };

        appleTrees.set(
            treeId,
            state
        );

        return state;
    }

    const elapsed =
        Math.floor(
            (now - state.lastGrowAt) /
            APPLE_GROW_MS
        );

    if (elapsed > 0) {
        state.apples =
            Math.min(
                APPLE_MAX,
                state.apples +
                elapsed *
                APPLE_GROW_AMOUNT
            );

        state.lastGrowAt +=
            elapsed *
            APPLE_GROW_MS;
    }

    return state;
}


// ========================================================
// CARROT SYSTEM
// ========================================================

function carrotState(
    patchId,
    x,
    z
) {
    const now = Date.now();

    let state =
        carrotPatches.get(
            patchId
        );

    if (!state) {
        state = {
            id: patchId,

            x: clamp(
                x,
                -MAP_LIMIT,
                MAP_LIMIT,
                0
            ),

            z: clamp(
                z,
                -MAP_LIMIT,
                MAP_LIMIT,
                0
            ),

            carrots:
                CARROT_BATCH_AMOUNT,

            lastRespawnAt:
                now
        };

        carrotPatches.set(
            patchId,
            state
        );

        return state;
    }

    const elapsed =
        Math.floor(
            (now - state.lastRespawnAt) /
            CARROT_RESPAWN_MS
        );

    if (elapsed > 0) {
        state.carrots =
            Math.min(
                CARROT_BATCH_AMOUNT,
                state.carrots +
                elapsed *
                CARROT_BATCH_AMOUNT
            );

        state.lastRespawnAt +=
            elapsed *
            CARROT_RESPAWN_MS;
    }

    return state;
}


// ========================================================
// ANIMAL SYSTEM
// ========================================================

function validAnimalId(id) {
    return /^forest-(wolf|deer|rabbit|boar|fox|goat)-\d{1,3}$/
        .test(
            String(id || '')
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
        String(id).split('-')[1];

    return {
        wolf: 'Kurt',
        deer: 'Geyik',
        rabbit: 'Tavşan',
        boar: 'Yaban domuzu',
        fox: 'Tilki',
        goat: 'Keçi'
    }[kind] || 'Vahşi hayvan';
}


// ========================================================
// WATER CHECK
// ========================================================

function isAtWater(
    x,
    z
) {
    const atBeachWater =
        x >= -310 &&
        x <= -35 &&
        z >= -459 &&
        z <= -444;

    const atForestPond =
        Math.hypot(
            x - FOREST_POND.x,
            z - FOREST_POND.z
        ) <=
        FOREST_POND.radius + 4;

    return (
        atBeachWater ||
        atForestPond
    );
}


// ========================================================
// WEBSOCKET CONNECTION
// ========================================================

wss.on(
    'connection',
    ws => {

        const id =
            crypto
                .randomBytes(5)
                .toString('hex');

        console.log(
            `Oyuncu bağlandı: ${id}`
        );


        players[id] = {
            id,

            ws,

            x: SPAWN.x,
            y: SPAWN.y,
            z: SPAWN.z,

            yaw: 0,
            pitch: 0,

            isCrouching: false,
            isMoving: false,
            isJumping: false,

            // IMPORTANT:
            // Do not consume a Guest number
            // until actual join_request.
            name: 'Player',

            platform: 'pc',

            pingMs: null,

            inGame: false,

            alive: true,

            health: MAX_HEALTH,
            hunger: MAX_NEED,
            thirst: MAX_NEED,

            lastNeedTick:
                Date.now(),

            lastDamageAt:
                0,

            lastStarveDamageAt:
                0,

            lastAttackAt:
                0,

            lastAnimalAttackAt:
                0,

            lastChatAt:
                0
        };


        const player =
            players[id];


        // ------------------------------------------------
        // INITIAL MESSAGE
        // ------------------------------------------------

        send(ws, {
            type: 'init',

            id,

            version:
                APP_VERSION,

            spawn:
                SPAWN
        });


        send(ws, {
            type: 'chat_history',

            messages:
                chatHistory.slice(-50)
        });


        sendPlayers();


        // =================================================
        // MESSAGE
        // =================================================

        ws.on(
            'message',
            raw => {

                try {

                    const data =
                        JSON.parse(
                            raw.toString()
                        );

                    const p =
                        players[id];

                    if (!p) {
                        return;
                    }

                    if (
                        !data ||
                        typeof data.type !==
                        'string'
                    ) {
                        return;
                    }


                    // =====================================
                    // PROFILE
                    // =====================================

                    switch (data.type) {

                        case 'profile': {

                            const requestedName =
                                cleanName(
                                    data.name
                                );


                            // If player is already in game,
                            // do not silently change their name.
                            if (
                                p.inGame &&
                                nameKey(
                                    requestedName
                                ) !==
                                nameKey(
                                    p.name
                                )
                            ) {

                                send(ws, {
                                    type:
                                        'profile_error',

                                    message:
                                        'Oyundayken oyuncu adı değiştirilemez.'
                                });

                                break;
                            }


                            p.name =
                                requestedName;

                            p.platform =
                                data.platform ===
                                'mobile'
                                    ? 'mobile'
                                    : 'pc';

                            sendPlayers();

                            break;
                        }


                        // =================================
                        // JOIN REQUEST
                        // =================================

                        case 'join_request': {

                            /*
                             IMPORTANT:
                             This is the actual game entry.

                             Server replies with:

                               join_accepted

                             NOT "joined".
                            */


                            let requestedName =
                                cleanName(
                                    data.name
                                );


                            // ---------------------------------
                            // Guest handling
                            // ---------------------------------

                            const isGuest =
                                /^guest-\d+$/i
                                    .test(
                                        requestedName
                                    );


                            if (
                                !requestedName ||
                                requestedName ===
                                'Player'
                            ) {
                                requestedName =
                                    nextGuestName();
                            }


                            if (isGuest) {

                                // Always assign the
                                // smallest free Guest number.
                                requestedName =
                                    nextGuestName();
                            }


                            // ---------------------------------
                            // Duplicate name
                            // ---------------------------------

                            const duplicate =
                                findActiveName(
                                    requestedName,
                                    id
                                );


                            if (duplicate) {

                                send(ws, {
                                    type:
                                        'join_denied',

                                    message:
                                        `“${requestedName}” adı şu anda oyunda kullanılıyor. Başka bir isim seç.`
                                });

                                break;
                            }


                            // ---------------------------------
                            // Reset dead player only if
                            // entering from a non-game state.
                            // ---------------------------------

                            if (
                                !p.alive &&
                                p.inGame
                            ) {

                                send(ws, {
                                    type:
                                        'join_denied',

                                    message:
                                        'Önce yeniden doğ veya menüye dön.'
                                });

                                break;
                            }


                            if (!p.alive) {

                                p.health =
                                    MAX_HEALTH;

                                p.hunger =
                                    MAX_NEED;

                                p.thirst =
                                    MAX_NEED;

                                p.alive =
                                    true;
                            }


                            p.name =
                                requestedName;

                            p.platform =
                                data.platform ===
                                'mobile'
                                    ? 'mobile'
                                    : 'pc';


                            p.inGame = true;


                            p.lastNeedTick =
                                Date.now();

                            p.lastDamageAt =
                                0;

                            p.lastStarveDamageAt =
                                0;


                            // ---------------------------------
                            // ACCEPT
                            // ---------------------------------

                            send(ws, {
                                type:
                                    'join_accepted',

                                id,

                                state:
                                    playerSnapshot(
                                        p
                                    ),

                                spawn:
                                    SPAWN,

                                player:
                                    playerSnapshot(
                                        p
                                    ),

                                version:
                                    APP_VERSION
                            });


                            sendPlayers();

                            break;
                        }


                        // =================================
                        // PRESENCE
                        // =================================

                        case 'presence': {

                            /*
                             active:false
                               = player returned to menu.

                             IMPORTANT:
                             Pause does NOT call this.

                             Therefore pause does not
                             release Guest number.
                            */


                            if (
                                data.name !==
                                undefined
                            ) {
                                p.name =
                                    cleanName(
                                        data.name
                                    );
                            }


                            p.platform =
                                data.platform ===
                                'mobile'
                                    ? 'mobile'
                                    : 'pc';


                            if (
                                data.active !==
                                true
                            ) {

                                p.inGame =
                                    false;

                                sendPlayers();

                                break;
                            }


                            // Active presence from menu:
                            // only allow if name isn't occupied.
                            const duplicate =
                                findActiveName(
                                    p.name,
                                    id
                                );


                            if (!duplicate) {
                                p.inGame =
                                    true;
                            }


                            sendPlayers();

                            break;
                        }


                        // =================================
                        // MOVE
                        // =================================

                        case 'move': {

                            if (
                                !p.inGame ||
                                !p.alive
                            ) {
                                break;
                            }


                            p.x =
                                clamp(
                                    data.x,
                                    -MAP_LIMIT,
                                    MAP_LIMIT,
                                    p.x
                                );


                            p.y =
                                clamp(
                                    data.y,
                                    -10,
                                    100,
                                    p.y
                                );


                            p.z =
                                clamp(
                                    data.z,
                                    -MAP_LIMIT,
                                    MAP_LIMIT,
                                    p.z
                                );


                            p.yaw =
                                clamp(
                                    data.yaw,
                                    -Math.PI * 20,
                                    Math.PI * 20,
                                    p.yaw
                                );


                            p.pitch =
                                clamp(
                                    data.pitch,
                                    -2,
                                    2,
                                    p.pitch
                                );


                            p.isCrouching =
                                data.isCrouching ===
                                true;


                            p.isMoving =
                                data.isMoving ===
                                true;


                            p.isJumping =
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

                                p.pingMs =
                                    clamp(
                                        data.pingMs,
                                        0,
                                        10000,
                                        p.pingMs ||
                                        0
                                    );
                            }


                            break;
                        }


                        // =================================
                        // PING
                        // =================================

                        case 'ping': {

                            send(ws, {
                                type:
                                    'pong',

                                timestamp:
                                    Number(
                                        data.timestamp
                                    )
                            });

                            break;
                        }


                        case 'ping_result': {

                            if (
                                Number.isFinite(
                                    Number(
                                        data.pingMs
                                    )
                                )
                            ) {

                                p.pingMs =
                                    clamp(
                                        data.pingMs,
                                        0,
                                        10000,
                                        0
                                    );
                            }

                            break;
                        }


                        // =================================
                        // CHAT HISTORY
                        // =================================

                        case 'chat_history': {

                            send(ws, {
                                type:
                                    'chat_history',

                                messages:
                                    chatHistory.slice(
                                        -50
                                    )
                            });

                            break;
                        }


                        // =================================
                        // CHAT
                        // =================================

                        case 'chat': {

                            if (
                                !p.inGame ||
                                !p.alive
                            ) {
                                break;
                            }


                            const now =
                                Date.now();


                            if (
                                now -
                                p.lastChatAt <
                                CHAT_COOLDOWN_MS
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


                            p.lastChatAt =
                                now;


                            // --------------------------------
                            // WHISPER
                            // --------------------------------

                            const whisper =
                                parseWhisper(
                                    rawText
                                );


                            if (
                                /^\/msg\b/i
                                    .test(
                                        rawText
                                    )
                            ) {

                                if (!whisper) {

                                    send(ws, {
                                        type:
                                            'chat_error',

                                        message:
                                            'Kullanım: /msg OyuncuAdı "mesaj"'
                                    });

                                    break;
                                }


                                const target =
                                    Object.entries(
                                        players
                                    ).find(
                                        ([
                                            targetId,
                                            targetPlayer
                                        ]) => {

                                            return (
                                                targetId !==
                                                id &&

                                                targetPlayer
                                                    .inGame &&

                                                targetPlayer
                                                    .alive &&

                                                nameKey(
                                                    targetPlayer
                                                        .name
                                                ) ===
                                                nameKey(
                                                    whisper
                                                        .target
                                                )
                                            );
                                        }
                                    );


                                if (!target) {

                                    send(ws, {
                                        type:
                                            'chat_error',

                                        message:
                                            `${whisper.target} adlı oyuncu şu an oyunda değil.`
                                    });

                                    break;
                                }


                                const message = {

                                    id:
                                        `whisper-${now}-${id}`,

                                    clientId:
                                        cleanText(
                                            data.clientId,
                                            80
                                        ),

                                    private:
                                        true,

                                    fromId:
                                        id,

                                    toId:
                                        target[0],

                                    name:
                                        p.name,

                                    toName:
                                        target[1].name,

                                    text:
                                        whisper.text,

                                    time:
                                        new Date(
                                            now
                                        ).toISOString()
                                };


                                send(ws, {
                                    type:
                                        'chat_message',

                                    message
                                });


                                send(
                                    target[1].ws,
                                    {
                                        type:
                                            'chat_message',

                                        message
                                    }
                                );


                                break;
                            }


                            // --------------------------------
                            // NORMAL CHAT
                            // --------------------------------

                            const message = {

                                id:
                                    `${now}-${id}`,

                                clientId:
                                    cleanText(
                                        data.clientId,
                                        80
                                    ),

                                name:
                                    p.name,

                                platform:
                                    p.platform,

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
                                    'chat_message',

                                message
                            });


                            break;
                        }


                        // =================================
                        // APPLE STATE REQUEST
                        // =================================

                        case 'apple_state_request': {

                            const states = {};


                            const trees =
                                Array.isArray(
                                    data.trees
                                )
                                    ? data.trees.slice(
                                        0,
                                        300
                                    )
                                    : [];


                            for (
                                const item of trees
                            ) {

                                const treeId =
                                    String(
                                        item.id || ''
                                    );


                                if (
                                    !/^apple-[A-Za-z0-9_-]{1,60}$/
                                        .test(
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


                                states[treeId] =
                                    state.apples;
                            }


                            send(ws, {
                                type:
                                    'apple_states',

                                states
                            });


                            break;
                        }


                        // =================================
                        // APPLE PICK
                        // =================================

                        case 'apple_pick': {

                            if (
                                !p.inGame ||
                                !p.alive
                            ) {
                                break;
                            }


                            // Full hunger:
                            // cannot eat.
                            if (
                                p.hunger >=
                                MAX_NEED
                            ) {

                                send(ws, {
                                    type:
                                        'apple_pick_result',

                                    ok:
                                        false,

                                    treeId:
                                        String(
                                            data.treeId ||
                                            ''
                                        ),

                                    message:
                                        'Açlığın zaten dolu.'
                                });

                                break;
                            }


                            const treeId =
                                String(
                                    data.treeId || ''
                                );


                            const state =
                                appleTrees.get(
                                    treeId
                                );


                            const distance =
                                state
                                    ? Math.hypot(
                                        p.x -
                                        state.x,

                                        p.z -
                                        state.z
                                    )
                                    : Infinity;


                            if (
                                !state ||
                                distance >
                                APPLE_PICK_DISTANCE ||
                                state.apples <= 0
                            ) {

                                send(ws, {
                                    type:
                                        'apple_pick_result',

                                    ok:
                                        false,

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
                                    p.hunger +
                                    1.5
                                );


                            broadcast({
                                type:
                                    'apple_update',

                                treeId,

                                apples:
                                    state.apples
                            });


                            send(ws, {
                                type:
                                    'apple_pick_result',

                                ok:
                                    true,

                                treeId,

                                apples:
                                    state.apples,

                                health:
                                    p.health,

                                hunger:
                                    p.hunger,

                                thirst:
                                    p.thirst
                            });


                            break;
                        }


                        // =================================
                        // CARROT STATE REQUEST
                        // =================================

                        case 'carrot_state_request': {

                            const states = {};


                            const patches =
                                Array.isArray(
                                    data.patches
                                )
                                    ? data.patches.slice(
                                        0,
                                        200
                                    )
                                    : [];


                            for (
                                const item of patches
                            ) {

                                const patchId =
                                    String(
                                        item.id || ''
                                    );


                                if (
                                    !/^carrot-[A-Za-z0-9_-]{1,60}$/
                                        .test(
                                            patchId
                                        )
                                ) {
                                    continue;
                                }


                                const state =
                                    carrotState(
                                        patchId,
                                        item.x,
                                        item.z
                                    );


                                states[patchId] =
                                    state.carrots;
                            }


                            send(ws, {
                                type:
                                    'carrot_states',

                                states
                            });


                            break;
                        }


                        // =================================
                        // CARROT PICK
                        // =================================

                        case 'carrot_pick': {

                            if (
                                !p.inGame ||
                                !p.alive
                            ) {
                                break;
                            }


                            // IMPORTANT:
                            // Check hunger BEFORE
                            // consuming the carrot.
                            if (
                                p.hunger >=
                                MAX_NEED
                            ) {

                                send(ws, {
                                    type:
                                        'carrot_pick_result',

                                    ok:
                                        false,

                                    patchId:
                                        String(
                                            data.patchId ||
                                            ''
                                        ),

                                    message:
                                        'Açlığın zaten dolu.'
                                });

                                break;
                            }


                            const patchId =
                                String(
                                    data.patchId ||
                                    ''
                                );


                            const patch =
                                carrotPatches.get(
                                    patchId
                                );


                            const distance =
                                patch
                                    ? Math.hypot(
                                        p.x -
                                        patch.x,

                                        p.z -
                                        patch.z
                                    )
                                    : Infinity;


                            if (
                                !patch ||
                                distance >
                                CARROT_PICK_DISTANCE ||
                                patch.carrots <= 0
                            ) {

                                send(ws, {
                                    type:
                                        'carrot_pick_result',

                                    ok:
                                        false,

                                    patchId,

                                    message:
                                        'Havuç kalmadı veya havuca yaklaşmalısın.'
                                });

                                break;
                            }


                            patch.carrots--;


                            p.hunger =
                                Math.min(
                                    MAX_NEED,
                                    p.hunger +
                                    1
                                );


                            broadcast({
                                type:
                                    'carrot_update',

                                patchId,

                                carrots:
                                    patch.carrots
                            });


                            send(ws, {
                                type:
                                    'carrot_pick_result',

                                ok:
                                    true,

                                patchId,

                                carrots:
                                    patch.carrots,

                                health:
                                    p.health,

                                hunger:
                                    p.hunger,

                                thirst:
                                    p.thirst
                            });


                            break;
                        }


                        // =================================
                        // DRINK
                        // =================================

                        case 'drink': {

                            if (
                                !p.inGame ||
                                !p.alive
                            ) {
                                break;
                            }


                            // Full thirst:
                            // cannot drink.
                            if (
                                p.thirst >=
                                MAX_NEED
                            ) {

                                send(ws, {
                                    type:
                                        'action_denied',

                                    action:
                                        'drink',

                                    message:
                                        'Susuzluğun zaten dolu.'
                                });

                                break;
                            }


                            if (
                                !isAtWater(
                                    p.x,
                                    p.z
                                )
                            ) {

                                send(ws, {
                                    type:
                                        'action_denied',

                                    action:
                                        'drink',

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
                                type:
                                    'action_ok',

                                action:
                                    'drink',

                                health:
                                    p.health,

                                hunger:
                                    p.hunger,

                                thirst:
                                    p.thirst
                            });


                            break;
                        }


                        // =================================
                        // PLAYER ATTACK
                        // =================================

                        case 'attack_player': {

                            if (
                                !p.inGame ||
                                !p.alive
                            ) {
                                break;
                            }


                            const now =
                                Date.now();


                            if (
                                now -
                                p.lastAttackAt <
                                PLAYER_ATTACK_COOLDOWN
                            ) {
                                break;
                            }


                            const targetId =
                                String(
                                    data.targetId ||
                                    ''
                                );


                            const target =
                                players[
                                    targetId
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
                                    p.x -
                                    target.x,

                                    p.z -
                                    target.z
                                );


                            if (
                                distance >
                                PLAYER_ATTACK_DISTANCE
                            ) {

                                send(ws, {
                                    type:
                                        'attack_result',

                                    ok:
                                        false,

                                    message:
                                        'Vurmak için yaklaş.'
                                });

                                break;
                            }


                            p.lastAttackAt =
                                now;


                            const damage =
                                PLAYER_ATTACK_DAMAGE;


                            damagePlayer(
                                targetId,
                                damage,
                                `${target.name}, ${p.name} tarafından saldırıya uğradı.`,
                                id
                            );


                            broadcast({
                                type:
                                    'combat_hit',

                                attackerId:
                                    id,

                                targetId,

                                damage,

                                health:
                                    target.health,

                                targetName:
                                    target.name
                            });


                            send(ws, {
                                type:
                                    'attack_result',

                                ok:
                                    true,

                                targetId,

                                damage
                            });


                            break;
                        }


                        // =================================
                        // ATTACK ANIMAL
                        // =================================

                        case 'attack_animal': {

                            if (
                                !p.inGame ||
                                !p.alive
                            ) {
                                break;
                            }


                            const now =
                                Date.now();


                            if (
                                now -
                                p.lastAttackAt <
                                PLAYER_ATTACK_COOLDOWN
                            ) {
                                break;
                            }


                            const animalId =
                                String(
                                    data.animalId ||
                                    ''
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
                                ) > 4
                            ) {
                                break;
                            }


                            p.lastAttackAt =
                                now;


                            animal.health =
                                Math.max(
                                    0,
                                    animal.health - 1
                                );


                            if (
                                animal.health <=
                                0
                            ) {
                                animal.health =
                                    0;

                                animal.alive =
                                    false;
                            }


                            broadcast({
                                type:
                                    'animal_state',

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


                            send(ws, {
                                type:
                                    'attack_result',

                                ok:
                                    true,

                                animalId,

                                damage:
                                    1
                            });


                            if (
                                !animal.alive
                            ) {

                                publicSystem(
                                    `${p.name}, ${String(data.animalName || animalLabel(animalId))} adlı hayvanı yendi.`
                                );
                            }


                            break;
                        }


                        // =================================
                        // ANIMAL ATTACK
                        // =================================

                        case 'animal_attack': {

                            if (
                                !p.inGame ||
                                !p.alive
                            ) {
                                break;
                            }


                            const now =
                                Date.now();


                            if (
                                now -
                                p.lastAnimalAttackAt <
                                ANIMAL_ATTACK_COOLDOWN
                            ) {
                                break;
                            }


                            const animalId =
                                String(
                                    data.animalId ||
                                    ''
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
                                ) >
                                ANIMAL_ATTACK_DISTANCE
                            ) {
                                break;
                            }


                            p.lastAnimalAttackAt =
                                now;


                            damagePlayer(
                                id,
                                ANIMAL_ATTACK_DAMAGE,
                                `${animalLabel(animalId)} saldırısı.`
                            );


                            broadcast({
                                type:
                                    'animal_bite',

                                animalId,

                                targetId:
                                    id,

                                damage:
                                    ANIMAL_ATTACK_DAMAGE,

                                health:
                                    p.health
                            });


                            break;
                        }


                        // =================================
                        // ANIMAL CARE
                        // =================================

                        case 'animal_care': {

                            if (
                                !p.inGame ||
                                !p.alive
                            ) {
                                break;
                            }


                            const animalId =
                                String(
                                    data.animalId ||
                                    ''
                                );


                            const animal =
                                ensureAnimal(
                                    animalId
                                );


                            if (
                                !animal ||
                                !animal.alive
                            ) {
                                break;
                            }


                            const now =
                                Date.now();


                            if (
                                now -
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
                                    p.x
                                );


                            const z =
                                clamp(
                                    data.z,
                                    -MAP_LIMIT,
                                    MAP_LIMIT,
                                    p.z
                                );


                            if (
                                data.action ===
                                'eat'
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
                                        animal.hunger + 1
                                    );

                            } else if (
                                data.action ===
                                'drink'
                            ) {

                                if (
                                    !isAtWater(
                                        x,
                                        z
                                    )
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
                                now;


                            broadcast({
                                type:
                                    'animal_state',

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


                        // =================================
                        // ANIMAL STATES
                        // =================================

                        case 'animal_states_request': {

                            const states = {};


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
                                const animalId of ids
                            ) {

                                const state =
                                    ensureAnimal(
                                        animalId
                                    );


                                if (!state) {
                                    continue;
                                }


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


                            send(ws, {
                                type:
                                    'animal_states',

                                states
                            });


                            break;
                        }


                        // =================================
                        // RESPAWN
                        // =================================

                        case 'respawn': {

                            if (
                                !p.inGame ||
                                p.alive
                            ) {
                                break;
                            }


                            p.alive =
                                true;

                            p.health =
                                MAX_HEALTH;

                            p.hunger =
                                MAX_NEED;

                            p.thirst =
                                MAX_NEED;


                            p.x =
                                SPAWN.x;

                            p.y =
                                SPAWN.y;

                            p.z =
                                SPAWN.z;


                            p.lastNeedTick =
                                Date.now();

                            p.lastDamageAt =
                                0;

                            p.lastStarveDamageAt =
                                0;


                            send(ws, {
                                type:
                                    'respawned',

                                spawn:
                                    SPAWN,

                                state:
                                    playerSnapshot(
                                        p
                                    )
                            });


                            sendNeeds(id);

                            sendPlayers();

                            break;
                        }


                        // =================================
                        // UNKNOWN
                        // =================================

                        default: {

                            // Unknown message is intentionally ignored.
                            break;
                        }
                    }

                } catch (error) {

                    console.warn(
                        `Geçersiz istemci mesajı (${id}):`,
                        error.message
                    );
                }
            }
        );


        // =================================================
        // CLOSE
        // =================================================

        ws.on(
            'close',
            () => {

                const oldPlayer =
                    players[id];

                if (oldPlayer) {

                    /*
                     Guest numbers are automatically
                     released here because the player
                     disappears from players.
                    */

                    delete players[id];
                }


                console.log(
                    `Oyuncu ayrıldı: ${id}`
                );


                sendPlayers();
            }
        );


        // =================================================
        // ERROR
        // =================================================

        ws.on(
            'error',
            error => {

                console.warn(
                    `WebSocket hatası (${id}):`,
                    error.message
                );
            }
        );
    }
);


// ========================================================
// PLAYER NEED / HEAL LOOP
// ========================================================

setInterval(
    () => {

        const now =
            Date.now();


        for (
            const [id, player]
            of Object.entries(players)
        ) {

            if (
                !player.inGame ||
                !player.alive
            ) {
                continue;
            }


            // --------------------------------------------
            // HUNGER / THIRST
            // --------------------------------------------

            const elapsed =
                now -
                player.lastNeedTick;


            const steps =
                Math.floor(
                    elapsed /
                    NEED_TICK_MS
                );


            if (steps > 0) {

                player.lastNeedTick +=
                    steps *
                    NEED_TICK_MS;


                player.hunger =
                    Math.max(
                        0,
                        player.hunger -
                        HUNGER_DRAIN *
                        steps
                    );


                player.thirst =
                    Math.max(
                        0,
                        player.thirst -
                        THIRST_DRAIN *
                        steps
                    );
            }


            // --------------------------------------------
            // STARVATION DAMAGE
            // --------------------------------------------

            const hungerEmpty =
                player.hunger <= 0;

            const thirstEmpty =
                player.thirst <= 0;


            if (
                hungerEmpty ||
                thirstEmpty
            ) {

                if (
                    now -
                    player.lastStarveDamageAt >=
                    STARVATION_DAMAGE_MS
                ) {

                    let damage;

                    if (
                        hungerEmpty &&
                        thirstEmpty
                    ) {

                        damage =
                            STARVATION_DAMAGE_BOTH;

                    } else {

                        damage =
                            STARVATION_DAMAGE_ONE;
                    }


                    player.lastStarveDamageAt =
                        now;


                    damagePlayer(
                        id,
                        damage,

                        hungerEmpty &&
                        thirstEmpty
                            ? 'Açlık ve susuzluk.'
                            : hungerEmpty
                                ? 'Açlık.'
                                : 'Susuzluk.'
                    );
                }
            }


            // --------------------------------------------
            // HEALING
            // --------------------------------------------

            if (
                player.alive &&
                player.health <
                    MAX_HEALTH &&
                player.hunger > 0 &&
                player.thirst > 0 &&
                player.lastDamageAt > 0 &&
                now -
                    player.lastDamageAt >=
                    HEAL_DELAY_MS
            ) {

                if (
                    now %
                    HEAL_TICK_MS <
                    1000
                ) {

                    healPlayer(
                        id,
                        HEAL_AMOUNT
                    );
                }
            }


            sendNeeds(id);
        }

    },
    1000
);


// ========================================================
// ANIMAL NEED LOOP
// ========================================================

setInterval(
    () => {

        const now =
            Date.now();


        const hasPlayers =
            Object.values(players)
                .some(
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


            const elapsed =
                now -
                animal.lastNeedTick;


            const steps =
                Math.floor(
                    elapsed /
                    NEED_TICK_MS
                );


            if (!steps) {
                continue;
            }


            animal.lastNeedTick +=
                steps *
                NEED_TICK_MS;


            animal.hunger =
                Math.max(
                    0,
                    animal.hunger -
                    HUNGER_DRAIN *
                    steps
                );


            animal.thirst =
                Math.max(
                    0,
                    animal.thirst -
                    THIRST_DRAIN *
                    steps
                );


            if (
                animal.hunger <= 0 ||
                animal.thirst <= 0
            ) {

                if (
                    now -
                    animal.lastStarveDamageAt >=
                    STARVATION_DAMAGE_MS
                ) {

                    const damage =
                        animal.hunger <= 0 &&
                        animal.thirst <= 0
                            ? 1
                            : 0.5;


                    animal.health =
                        Math.max(
                            0,
                            animal.health -
                            damage
                        );


                    animal.lastStarveDamageAt =
                        now;


                    if (
                        animal.health <=
                        0
                    ) {

                        animal.health =
                            0;

                        animal.alive =
                            false;


                        publicSystem(
                            `${animalLabel(animal.id)} vahşi hayvanı ${animal.thirst <= 0 ? 'susuzluktan' : 'açlıktan'} öldü.`
                        );
                    }
                }
            }


            broadcast({
                type:
                    'animal_state',

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


// ========================================================
// APPLE GROW LOOP
// ========================================================

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
                        'apple_update',

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


// ========================================================
// CARROT RESPawn LOOP
// ========================================================

setInterval(
    () => {

        for (
            const state
            of carrotPatches.values()
        ) {

            const before =
                state.carrots;


            carrotState(
                state.id,
                state.x,
                state.z
            );


            if (
                state.carrots !==
                before
            ) {

                broadcast({
                    type:
                        'carrot_update',

                    patchId:
                        state.id,

                    carrots:
                        state.carrots
                });
            }
        }

    },
    10000
);


// ========================================================
// PLAYER BROADCAST
// ========================================================

setInterval(
    () => {

        sendPlayers();

    },
    100
);


// ========================================================
// CHAT RESET
// ========================================================

setInterval(
    () => {

        chatHistory = [];


        broadcast({
            type:
                'chat_reset',

            time:
                new Date()
                    .toISOString()
        });

    },
    CHAT_RESET_MS
);


// ========================================================
// SERVER ERROR
// ========================================================

server.on(
    'error',
    error => {

        console.error(
            'SERVER ERROR:',
            error
        );

    }
);


// ========================================================
// START
// ========================================================

server.listen(
    PORT,
    '0.0.0.0',
    () => {

        console.log('');
        console.log('==========================================');
        console.log('       EŞEK SIMULATOR SERVER');
        console.log('==========================================');
        console.log(
            `Port       : ${PORT}`
        );
        console.log(
            `Version    : ${APP_VERSION}`
        );
        console.log(
            `HTTP       : http://localhost:${PORT}`
        );
        console.log(
            `WebSocket  : ws://localhost:${PORT}`
        );
        console.log(
            `Players    : ${activePlayerCount()}`
        );
        console.log('==========================================');
        console.log('');
        console.log(
            'Server hazır.'
        );
        console.log('');
    }
);
