const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const WebSocket = require('ws');

const APP_VERSION = "2026-09-29-6";

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
            const raw = JSON.parse(
                fs.readFileSync(file, 'utf8')
            );

            if (
                raw &&
                typeof raw === 'object' &&
                !Array.isArray(raw)
            ) {
                const source =
                    raw.accounts &&
                    typeof raw.accounts === 'object' &&
                    !Array.isArray(raw.accounts)
                        ? raw.accounts
                        : raw;

                accounts = source;

                if (
                    file !== ACCOUNTS_FILE &&
                    Object.keys(accounts).length
                ) {
                    saveAccounts();
                }

                return;
            }
        } catch (e) {
            console.warn(
                `${file} okunamadı:`,
                e.message
            );
        }
    }
}

function saveAccounts() {
    fs.mkdirSync(DATA_DIR, {
        recursive: true
    });

    const tmp =
        ACCOUNTS_FILE + '.tmp';

    fs.writeFileSync(
        tmp,
        JSON.stringify(
            { accounts },
            null,
            2
        ),
        'utf8'
    );

    fs.renameSync(
        tmp,
        ACCOUNTS_FILE
    );
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
        .scryptSync(
            String(password),
            salt,
            64
        )
        .toString('hex');
}

function makeAccount(
    username,
    password
) {
    const salt =
        crypto
            .randomBytes(16)
            .toString('hex');

    return {
        username,
        salt,
        passwordHash:
            hashPassword(
                password,
                salt
            ),
        token:
            crypto
                .randomBytes(32)
                .toString('hex')
    };
}

function findAccountByToken(token) {
    if (!token) return null;

    return (
        Object.values(accounts)
            .find(
                a =>
                    a &&
                    a.token === token
            ) || null
    );
}

app.post(
    '/api/auth/register',
    (req, res) => {
        const username =
            String(
                req.body?.username || ''
            ).trim();

        const password =
            String(
                req.body?.password || ''
            );

        const passwordConfirm =
            String(
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
                message:
                    'Şifre en az 6 karakter olmalı.'
            });
        }

        if (
            passwordConfirm !==
            password
        ) {
            return res.status(400).json({
                message:
                    'Şifreler aynı değil.'
            });
        }

        const key =
            normalizeUsername(
                username
            );

        if (accounts[key]) {
            return res.status(409).json({
                message:
                    'Bu kullanıcı adı zaten alınmış.'
            });
        }

        const account =
            makeAccount(
                username,
                password
            );

        accounts[key] =
            account;

        saveAccounts();

        res.json({
            ok: true,
            username:
                account.username,
            token:
                account.token
        });
    }
);

app.post(
    '/api/auth/login',
    (req, res) => {
        const username =
            String(
                req.body?.username || ''
            ).trim();

        const password =
            String(
                req.body?.password || ''
            );

        const account =
            accounts[
                normalizeUsername(
                    username
                )
            ];

        if (!account) {
            return res.status(401).json({
                message:
                    'Kullanıcı adı veya şifre hatalı.'
            });
        }

        const hash =
            hashPassword(
                password,
                account.salt
            );

        if (
            !crypto.timingSafeEqual(
                Buffer.from(
                    hash,
                    'hex'
                ),
                Buffer.from(
                    account.passwordHash,
                    'hex'
                )
            )
        ) {
            return res.status(401).json({
                message:
                    'Kullanıcı adı veya şifre hatalı.'
            });
        }

        account.token =
            crypto
                .randomBytes(32)
                .toString('hex');

        saveAccounts();

        res.json({
            ok: true,
            username:
                account.username,
            token:
                account.token
        });
    }
);

function findAccountByUsername(
    username
) {
    const key =
        normalizeUsername(
            username
        );

    if (accounts[key]) {
        return {
            key,
            account:
                accounts[key]
        };
    }

    for (
        const [
            storedKey,
            account
        ] of Object.entries(accounts)
    ) {
        if (
            account &&
            normalizeUsername(
                account.username
            ) === key
        ) {
            return {
                key: storedKey,
                account
            };
        }
    }

    return null;
}

app.get(
    '/api/auth/me',
    (req, res) => {
        const token =
            String(
                req.query?.token ||
                req.headers[
                    'x-auth-token'
                ] ||
                ''
            );

        const account =
            findAccountByToken(
                token
            );

        if (!account) {
            return res.status(401).json({
                ok: false,
                message:
                    'Oturum geçersiz.'
            });
        }

        res.json({
            ok: true,
            username:
                account.username,
            token:
                account.token
        });
    }
);

app.post(
    '/api/auth/logout',
    (req, res) => {
        const account =
            findAccountByToken(
                String(
                    req.body?.token ||
                    ''
                )
            );

        if (account) {
            account.token =
                crypto
                    .randomBytes(32)
                    .toString('hex');

            saveAccounts();
        }

        res.json({
            ok: true
        });
    }
);

app.post(
    [
        '/api/auth/change-username',
        '/api/auth/change-name'
    ],
    (req, res) => {
        try {
            const account =
                findAccountByToken(
                    String(
                        req.body?.token ||
                        ''
                    )
                );

            if (!account) {
                return res.status(401).json({
                    ok: false,
                    message:
                        'Oturum geçersiz.'
                });
            }

            const username =
                String(
                    req.body?.username ||
                    ''
                ).trim();

            if (
                !validUsername(
                    username
                )
            ) {
                return res.status(400).json({
                    ok: false,
                    message:
                        'Kullanıcı adı 3-20 karakter olmalı.'
                });
            }

            const oldKey =
                normalizeUsername(
                    account.username
                );

            const newKey =
                normalizeUsername(
                    username
                );

            const found =
                findAccountByUsername(
                    username
                );

            if (
                found &&
                found.account !== account
            ) {
                return res.status(409).json({
                    ok: false,
                    message:
                        'Bu kullanıcı adı zaten alınmış.'
                });
            }

            delete accounts[oldKey];

            account.username =
                username;

            accounts[newKey] =
                account;

            saveAccounts();

            for (
                const p of Object.values(
                    players
                )
            ) {
                if (
                    p.accountUsername &&
                    normalizeUsername(
                        p.accountUsername
                    ) === oldKey
                ) {
                    p.accountUsername =
                        username;

                    p.name =
                        username;
                }
            }

            sendPlayers();

            res.json({
                ok: true,
                username:
                    account.username,
                token:
                    account.token
            });
        } catch (e) {
            console.error(
                'Ad değiştirme hatası:',
                e
            );

            res.status(500).json({
                ok: false,
                message:
                    'Ad değiştirilemedi.'
            });
        }
    }
);

app.post(
    '/api/auth/change-password',
    (req, res) => {
        try {
            const account =
                findAccountByToken(
                    String(
                        req.body?.token ||
                        ''
                    )
                );

            if (!account) {
                return res.status(401).json({
                    ok: false,
                    message:
                        'Oturum geçersiz.'
                });
            }

            const oldPassword =
                String(
                    req.body?.oldPassword ??
                    req.body?.currentPassword ??
                    ''
                );

            const newPassword =
                String(
                    req.body?.newPassword ||
                    ''
                );

            const confirm =
                String(
                    req.body?.newPasswordConfirm ??
                    req.body?.newPassword2 ??
                    ''
                );

            let valid = false;

            try {
                const hash =
                    hashPassword(
                        oldPassword,
                        account.salt
                    );

                const a =
                    Buffer.from(
                        hash,
                        'hex'
                    );

                const b =
                    Buffer.from(
                        String(
                            account.passwordHash
                        ),
                        'hex'
                    );

                valid =
                    a.length ===
                        b.length &&
                    crypto.timingSafeEqual(
                        a,
                        b
                    );
            } catch (_) {}

            if (!valid) {
                return res.status(401).json({
                    ok: false,
                    message:
                        'Mevcut şifre yanlış.'
                });
            }

            if (
                newPassword.length < 6
            ) {
                return res.status(400).json({
                    ok: false,
                    message:
                        'Yeni şifre en az 6 karakter olmalı.'
                });
            }

            if (
                newPassword !==
                confirm
            ) {
                return res.status(400).json({
                    ok: false,
                    message:
                        'Yeni şifreler aynı değil.'
                });
            }

            account.salt =
                crypto
                    .randomBytes(16)
                    .toString('hex');

            account.passwordHash =
                hashPassword(
                    newPassword,
                    account.salt
                );

            account.token =
                crypto
                    .randomBytes(32)
                    .toString('hex');

            saveAccounts();

            res.json({
                ok: true,
                token:
                    account.token,
                username:
                    account.username
            });
        } catch (e) {
            console.error(
                'Şifre değiştirme hatası:',
                e
            );

            res.status(500).json({
                ok: false,
                message:
                    'Şifre değiştirilemedi.'
            });
        }
    }
);

app.use(
    express.static(__dirname)
);

app.get(
    '/',
    (_req, res) =>
        res.sendFile(
            path.join(
                __dirname,
                'index.html'
            )
        )
);

app.get(
    '/health',
    (_req, res) =>
        res.json({
            ok: true,
            players:
                activePlayerCount()
        })
);

const players =
    Object.create(null);

const appleTrees =
    new Map();

const carrots =
    new Map();

const wildAnimals =
    new Map();

let chatHistory = [];

function nextGuestName() {
    const used =
        new Set();

    for (
        const player of Object.values(
            players
        )
    ) {
        if (
            !player ||
            !player.inGame ||
            typeof player.name !==
                'string'
        ) {
            continue;
        }

        const match =
            player.name.match(
                /^Guest-(\d+)$/
            );

        if (!match) continue;

        const n =
            Number(
                match[1]
            );

        if (
            Number.isInteger(n) &&
            n >= 0
        ) {
            used.add(n);
        }
    }

    let n = 0;

    while (
        used.has(n)
    ) {
        n++;
    }

    return `Guest-${String(n).padStart(3, '0')}`;
}

const CHAT_RESET_MS =
    10 * 60 * 1000;

const APPLE_GROW_MS =
    5 * 60 * 1000;

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
    return Object.values(
        players
    ).filter(
        p => p.inGame
    ).length;
}

function send(
    ws,
    payload
) {
    if (
        ws.readyState ===
        WebSocket.OPEN
    ) {
        ws.send(
            JSON.stringify(
                payload
            )
        );
    }
}

function broadcast(
    payload
) {
    const encoded =
        JSON.stringify(
            payload
        );

    for (
        const client of
            wss.clients
    ) {
        if (
            client.readyState ===
            WebSocket.OPEN
        ) {
            client.send(
                encoded
            );
        }
    }
}

function clamp(
    value,
    min,
    max,
    fallback = min
) {
    const n =
        Number(value);

    return Number.isFinite(n)
        ? Math.max(
              min,
              Math.min(
                  max,
                  n
              )
          )
        : fallback;
}

function cleanName(
    value
) {
    const name =
        String(
            value ?? ''
        )
            .replace(
                /[\u0000-\u001f\u007f]/g,
                ''
            )
            .trim()
            .slice(
                0,
                20
            );

    return (
        name || 'Player'
    );
}

function nameKey(
    value
) {
    return cleanName(
        value
    )
        .normalize('NFKC')
        .toLocaleLowerCase(
            'tr-TR'
        );
}

function cleanText(
    value,
    limit = 220
) {
    return String(
        value ?? ''
    )
        .replace(
            /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,
            ''
        )
        .trim()
        .slice(
            0,
            limit
        );
}

function sendPlayers() {
    const publicPlayers =
        Object.create(null);

    for (
        const [
            id,
            p
        ] of Object.entries(
            players
        )
    ) {
        publicPlayers[id] =
            playerSnapshot(p);
    }

    broadcast({
        type: 'players',
        players:
            publicPlayers,
        count:
            activePlayerCount()
    });
}

function publicSystem(
    text
) {
    const message = {
        id:
            `sys-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        system: true,
        name: 'Sistem',
        text:
            cleanText(
                text,
                220
            ),
        time:
            new Date().toISOString()
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
}

function sendNeeds(
    id
) {
    const p =
        players[id];

    if (p) {
        send(
            p.ws,
            {
                type: 'needs',
                health:
                    p.health,
                hunger:
                    p.hunger,
                thirst:
                    p.thirst,
                alive:
                    p.alive
            }
        );
    }
}

function killPlayer(
    victimId,
    killerId,
    cause
) {
    const victim =
        players[
            victimId
        ];

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

    publicSystem(
        reason
    );

    broadcast({
        type:
            'player_death',
        id:
            victimId,
        killerId:
            killerId || null,
        killerName:
            killerName || null,
        reason
    });
}

function findActiveName(
    name,
    exceptId
) {
    const key =
        nameKey(name);

    return Object.entries(
        players
    ).find(
        ([
            id,
            p
        ]) =>
            id !== exceptId &&
            p.inGame &&
            nameKey(p.name) ===
                key
    );
}

function appleState(
    treeId,
    x,
    z
) {
    let state =
        appleTrees.get(
            treeId
        );

    const now =
        Date.now();

    if (!state) {
        state = {
            id:
                treeId,
            x:
                clamp(
                    x,
                    -400,
                    400
                ),
            z:
                clamp(
                    z,
                    -400,
                    400
                ),
            apples: 10,
            lastGrowAt:
                now
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

    if (
        elapsed > 0
    ) {
        state.apples =
            Math.min(
                20,
                state.apples +
                    elapsed * 5
            );

        state.lastGrowAt +=
            elapsed *
            APPLE_GROW_MS;
    }

    return state;
}

function carrotState(
    id,
    x,
    z
) {
    let state =
        carrots.get(id);

    const now =
        Date.now();

    if (!state) {
        state = {
            id,
            x:
                clamp(
                    x,
                    -400,
                    400
                ),
            z:
                clamp(
                    z,
                    -400,
                    400
                ),
            available: true,
            respawnAt: 0
        };

        carrots.set(
            id,
            state
        );
    }

    if (
        !state.available &&
        state.respawnAt &&
        now >=
            state.respawnAt
    ) {
        state.available =
            true;

        state.respawnAt =
            0;
    }

    return state;
}

function validCarrotId(
    id
) {
    return /^carrot-[A-Za-z0-9_-]{1,40}$/.test(
        String(
            id || ''
        )
    );
}

function validAnimalId(
    id
) {
    return /^forest-(wolf|deer|rabbit|boar|fox|goat)-\d{1,3}$/.test(
        String(
            id || ''
        )
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

function animalLabel(
    id
) {
    const kind =
        String(
            id
        ).split('-')[1];

    return (
        {
            wolf:
                'Kurt',
            deer:
                'Geyik',
            rabbit:
                'Tavşan',
            boar:
                'Yaban domuzu',
            fox:
                'Tilki',
            goat:
                'Keçi'
        }[kind] ||
        'Vahşi hayvan'
    );
}

function parseWhisper(
    text
) {
    const quoted =
        text.match(
            /^\/msg\s+(\S+)\s+"([\s\S]{1,220})"\s*$/i
        );

    if (quoted) {
        return {
            target:
                cleanName(
                    quoted[1]
                ),
            text:
                cleanText(
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
            target:
                cleanName(
                    plain[1]
                ),
            text:
                cleanText(
                    plain[2]
                )
        };
    }

    return null;
}

function playerSnapshot(
    p
) {
    return {
        x:
            p.x,
        y:
            p.y,
        z:
            p.z,
        yaw:
            p.yaw,
        pitch:
            p.pitch,
        isCrouching:
            p.isCrouching,
        isMoving:
            p.isMoving,
        isJumping:
            p.isJumping,
        name:
            p.name,
        platform:
            p.platform,
        pingMs:
            p.pingMs,
        inGame:
            p.inGame,
        alive:
            p.alive,
        health:
            p.health,
        hunger:
            p.hunger,
        thirst:
            p.thirst
    };
}

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
            ws,
            x:
                SPAWN.x,
            y:
                SPAWN.y,
            z:
                SPAWN.z,
            yaw:
                0,
            pitch:
                0,
            isCrouching:
                false,
            isMoving:
                false,
            isJumping:
                false,
            name:
                null,
            platform:
                'pc',
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
            lastDamageAt:
                0,
            lastStarveDamageAt:
                0,
            accountUsername:
                null
        };

        /*
         * Eşek Simulator bu mesajı bekliyor.
         */
        send(
            ws,
            {
                type:
                    'init',
                id
            }
        );

        /*
         * Eski istemciler için.
         */
        send(
            ws,
            {
                type:
                    'welcome',
                id,
                version:
                    APP_VERSION
            }
        );

        send(
            ws,
            {
                type:
                    'chat_history',
                messages:
                    chatHistory.slice(
                        -50
                    )
            }
        );

        sendPlayers();

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

                    if (
                        !p ||
                        !data ||
                        typeof data.type !==
                            'string'
                    ) {
                        return;
                    }

                    switch (
                        data.type
                    ) {
                        case 'profile': {
                            p.platform =
                                data.platform ===
                                'mobile'
                                    ? 'mobile'
                                    : 'pc';

                            break;
                        }

                        case 'join_request': {
                            const account =
                                findAccountByToken(
                                    String(
                                        data.token ||
                                        ''
                                    )
                                );

                            /*
                             * Hesapla giriyorsa hesap adı,
                             * misafirle giriyorsa en küçük
                             * boş Guest numarası.
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

                            if (
                                duplicate
                            ) {
                                send(
                                    ws,
                                    {
                                        type:
                                            'join_denied',
                                        message:
                                            'Bu kullanıcı adı şu anda oyunda kullanılıyor.'
                                    }
                                );

                                break;
                            }

                            if (
                                !p.alive &&
                                p.inGame
                            ) {
                                send(
                                    ws,
                                    {
                                        type:
                                            'join_denied',
                                        message:
                                            'Ölüm ekranından yeniden doğ veya önce menüye dön.'
                                    }
                                );

                                break;
                            }

                            if (
                                !p.alive
                            ) {
                                p.health =
                                    MAX_NEED;
                                p.hunger =
                                    MAX_NEED;
                                p.thirst =
                                    MAX_NEED;
                                p.alive =
                                    true;
                            }

                            p.name =
                                candidate;

                            p.accountUsername =
                                account
                                    ? account.username
                                    : null;

                            p.platform =
                                data.platform ===
                                'mobile'
                                    ? 'mobile'
                                    : 'pc';

                            p.inGame =
                                true;

                            p.lastNeedTick =
                                Date.now();

                            const acceptedState =
                                playerSnapshot(
                                    p
                                );

                            /*
                             * ASIL ÖNEMLİ KISIM:
                             * Simulator "join_accepted"
                             * bekliyor.
                             */
                            send(
                                ws,
                                {
                                    type:
                                        'join_accepted',
                                    id,
                                    state:
                                        acceptedState,
                                    spawn:
                                        SPAWN
                                }
                            );

                            /*
                             * Eski kodlarla uyumluluk.
                             */
                            send(
                                ws,
                                {
                                    type:
                                        'joined',
                                    id,
                                    state:
                                        acceptedState,
                                    spawn:
                                        SPAWN
                                }
                            );

                            sendPlayers();

                            break;
                        }

                        case 'presence': {
                            p.platform =
                                data.platform ===
                                'mobile'
                                    ? 'mobile'
                                    : 'pc';

                            /*
                             * Pause sırasında presence
                             * false gönderilirse oyuncu
                             * online listesinden çıkar.
                             *
                             * Resume sırasında true
                             * gelmesi oyuncuyu yeniden
                             * "join" yapmak zorunda bırakmaz.
                             */
                            if (
                                data.active !==
                                true
                            ) {
                                p.inGame =
                                    false;
                            } else {
                                p.inGame =
                                    true;
                            }

                            sendPlayers();

                            break;
                        }

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
                                        10000
                                    );
                            }

                            break;
                        }

                        case 'ping': {
                            send(
                                ws,
                                {
                                    type:
                                        'pong',
                                    timestamp:
                                        Number(
                                            data.timestamp
                                        )
                                }
                            );

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
                                        10000
                                    );
                            }

                            break;
                        }

                        case 'chat_history': {
                            send(
                                ws,
                                {
                                    type:
                                        'chat_history',
                                    messages:
                                        chatHistory.slice(
                                            -50
                                        )
                                }
                            );

                            break;
                        }

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
                                450
                            ) {
                                break;
                            }

                            const rawText =
                                cleanText(
                                    data.text
                                );

                            if (
                                !rawText
                            ) {
                                break;
                            }

                            p.lastChatAt =
                                now;

                            const whisper =
                                parseWhisper(
                                    rawText
                                );

                            if (
                                /^\/msg\b/i.test(
                                    rawText
                                )
                            ) {
                                if (
                                    !whisper
                                ) {
                                    send(
                                        ws,
                                        {
                                            type:
                                                'chat_error',
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

                                if (
                                    !target
                                ) {
                                    send(
                                        ws,
                                        {
                                            type:
                                                'chat_error',
                                            message:
                                                `${whisper.target} adlı oyuncu şu an oyunda değil.`
                                        }
                                    );

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

                                send(
                                    ws,
                                    {
                                        type:
                                            'chat_message',
                                        message
                                    }
                                );

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

                        case 'apple_state_request': {
                            const states =
                                {};

                            for (
                                const item of
                                    (
                                        Array.isArray(
                                            data.trees
                                        )
                                            ? data.trees.slice(
                                                  0,
                                                  240
                                              )
                                            : []
                                    )
                            ) {
                                const treeId =
                                    String(
                                        item.id ||
                                            ''
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
                                        'apple_states',
                                    states
                                }
                            );

                            break;
                        }

                        case 'carrot_state_request': {
                            const states =
                                {};

                            for (
                                const item of
                                    (
                                        Array.isArray(
                                            data.carrots
                                        )
                                            ? data.carrots.slice(
                                                  0,
                                                  160
                                              )
                                            : []
                                    )
                            ) {
                                const carrotId =
                                    String(
                                        item.id ||
                                            ''
                                    );

                                if (
                                    !validCarrotId(
                                        carrotId
                                    )
                                ) {
                                    continue;
                                }

                                const state =
                                    carrotState(
                                        carrotId,
                                        item.x,
                                        item.z
                                    );

                                states[
                                    carrotId
                                ] =
                                    state.available;
                            }

                            send(
                                ws,
                                {
                                    type:
                                        'carrot_states',
                                    states
                                }
                            );

                            break;
                        }

                        case 'carrot_pick': {
                            if (
                                !p.inGame ||
                                !p.alive
                            ) {
                                break;
                            }

                            const carrotId =
                                String(
                                    data.carrotId ||
                                        ''
                                );

                            const state =
                                carrots.get(
                                    carrotId
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
                                    4.5 ||
                                !state.available
                            ) {
                                send(
                                    ws,
                                    {
                                        type:
                                            'carrot_pick_result',
                                        ok:
                                            false,
                                        carrotId
                                    }
                                );

                                break;
                            }

                            /*
                             * ÖNCE açlık dolu mu kontrol et.
                             * Böylece doluysa havuç kaybolmaz.
                             */
                            if (
                                p.hunger >=
                                MAX_NEED
                            ) {
                                send(
                                    ws,
                                    {
                                        type:
                                            'carrot_pick_result',
                                        ok:
                                            false,
                                        carrotId,
                                        message:
                                            'Açlık barın dolu.'
                                    }
                                );

                                break;
                            }

                            state.available =
                                false;

                            state.respawnAt =
                                Date.now() +
                                5 *
                                    60 *
                                    1000;

                            p.hunger =
                                Math.min(
                                    MAX_NEED,
                                    p.hunger +
                                        1.0
                                );

                            broadcast({
                                type:
                                    'carrot_update',
                                carrotId,
                                available:
                                    false
                            });

                            send(
                                ws,
                                {
                                    type:
                                        'carrot_pick_result',
                                    ok:
                                        true,
                                    carrotId,
                                    available:
                                        false,
                                    health:
                                        p.health,
                                    hunger:
                                        p.hunger,
                                    thirst:
                                        p.thirst
                                }
                            );

                            break;
                        }

                        case 'apple_pick': {
                            if (
                                !p.inGame ||
                                !p.alive
                            ) {
                                break;
                            }

                            const treeId =
                                String(
                                    data.treeId ||
                                        ''
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
                                    6 ||
                                state.apples <=
                                    0
                            ) {
                                send(
                                    ws,
                                    {
                                        type:
                                            'apple_pick_result',
                                        ok:
                                            false,
                                        treeId,
                                        message:
                                            'Elma kalmadı veya ağaca yaklaşmalısın.'
                                    }
                                );

                                break;
                            }

                            if (
                                p.hunger >=
                                MAX_NEED
                            ) {
                                send(
                                    ws,
                                    {
                                        type:
                                            'apple_pick_result',
                                        ok:
                                            false,
                                        treeId,
                                        message:
                                            'Açlık barın dolu.'
                                    }
                                );

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

                            send(
                                ws,
                                {
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
                                }
                            );

                            break;
                        }

                        case 'drink': {
                            if (
                                !p.inGame ||
                                !p.alive
                            ) {
                                break;
                            }

                            const atBeachWater =
                                p.x >=
                                    -310 &&
                                p.x <=
                                    -35 &&
                                p.z >=
                                    -459 &&
                                p.z <=
                                    -444;

                            const atForestPond =
                                Math.hypot(
                                    p.x -
                                        FOREST_POND.x,
                                    p.z -
                                        FOREST_POND.z
                                ) <=
                                FOREST_POND.radius +
                                    4;

                            const riverSegments = [
                                [
                                    [
                                        300,
                                        -8
                                    ],
                                    [
                                        309,
                                        18
                                    ],
                                    [
                                        322,
                                        43
                                    ],
                                    [
                                        340,
                                        68
                                    ],
                                    [
                                        354,
                                        96
                                    ],
                                    [
                                        365,
                                        124
                                    ],
                                    [
                                        374,
                                        151
                                    ]
                                ],
                                [
                                    [
                                        300,
                                        -8
                                    ],
                                    [
                                        278,
                                        17
                                    ],
                                    [
                                        255,
                                        42
                                    ],
                                    [
                                        237,
                                        67
                                    ],
                                    [
                                        219,
                                        91
                                    ],
                                    [
                                        205,
                                        114
                                    ]
                                ],
                                [
                                    [
                                        374,
                                        151
                                    ],
                                    [
                                        392,
                                        172
                                    ],
                                    [
                                        407,
                                        197
                                    ],
                                    [
                                        421,
                                        224
                                    ],
                                    [
                                        432,
                                        253
                                    ]
                                ]
                            ];

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
                                                (
                                                    px -
                                                    ax
                                                ) *
                                                    dx +
                                                (
                                                    pz -
                                                    az
                                                ) *
                                                    dz
                                            ) /
                                                l2
                                        )
                                    );

                                return Math.hypot(
                                    px -
                                        (
                                            ax +
                                            t *
                                                dx
                                        ),
                                    pz -
                                        (
                                            az +
                                            t *
                                                dz
                                        )
                                );
                            }

                            let riverDistance =
                                Infinity;

                            for (
                                const line of
                                    riverSegments
                            ) {
                                for (
                                    let i = 0;
                                    i <
                                    line.length -
                                        1;
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
                                                line[
                                                    i +
                                                        1
                                                ][0],
                                                line[
                                                    i +
                                                        1
                                                ][1]
                                            )
                                        );
                                }
                            }

                            const atRiver =
                                riverDistance <=
                                4.2;

                            if (
                                !atBeachWater &&
                                !atForestPond &&
                                !atRiver
                            ) {
                                send(
                                    ws,
                                    {
                                        type:
                                            'action_denied',
                                        action:
                                            'drink',
                                        message:
                                            'Suya biraz daha yaklaş.'
                                    }
                                );

                                break;
                            }

                            if (
                                p.thirst >=
                                MAX_NEED
                            ) {
                                send(
                                    ws,
                                    {
                                        type:
                                            'action_denied',
                                        action:
                                            'drink',
                                        message:
                                            'Susuzluk barın zaten dolu.'
                                    }
                                );

                                break;
                            }

                            p.thirst =
                                Math.min(
                                    MAX_NEED,
                                    p.thirst +
                                        2
                                );

                            send(
                                ws,
                                {
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
                                }
                            );

                            break;
                        }

                        case 'attack_player': {
                            if (
                                !p.inGame ||
                                !p.alive ||
                                Date.now() -
                                    p.lastAttackAt <
                                    550
                            ) {
                                break;
                            }

                            p.lastAttackAt =
                                Date.now();

                            const target =
                                players[
                                    String(
                                        data.targetId ||
                                            ''
                                    )
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
                                4.0
                            ) {
                                send(
                                    ws,
                                    {
                                        type:
                                            'attack_result',
                                        ok:
                                            false,
                                        message:
                                            'Vurmak için yaklaş.'
                                    }
                                );

                                break;
                            }

                            const damage =
                                1;

                            target.health =
                                Math.max(
                                    0,
                                    target.health -
                                        damage
                                );

                            target.lastDamageAt =
                                Date.now();

                            broadcast({
                                type:
                                    'combat_hit',
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
                                    `${target.name}, ${p.name} tarafından öldürüldü.`
                                );
                            }

                            send(
                                ws,
                                {
                                    type:
                                        'attack_result',
                                    ok:
                                        true,
                                    targetId:
                                        data.targetId,
                                    damage
                                }
                            );

                            break;
                        }

                        case 'attack_animal': {
                            if (
                                !p.inGame ||
                                !p.alive ||
                                Date.now() -
                                    p.lastAttackAt <
                                    550
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
                                    p.x -
                                        ax,
                                    p.z -
                                        az
                                ) >
                                    4.0
                            ) {
                                break;
                            }

                            p.lastAttackAt =
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

                            send(
                                ws,
                                {
                                    type:
                                        'attack_result',
                                    ok:
                                        true,
                                    animalId,
                                    damage:
                                        1
                                }
                            );

                            if (
                                !animal.alive
                            ) {
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
                                    p.x -
                                        ax,
                                    p.z -
                                        az
                                ) >
                                    3.2
                            ) {
                                break;
                            }

                            p.lastAnimalAttackAt =
                                Date.now();

                            p.health =
                                Math.max(
                                    0,
                                    p.health -
                                        0.5
                                );

                            p.lastDamageAt =
                                Date.now();

                            broadcast({
                                type:
                                    'animal_bite',
                                animalId,
                                targetId:
                                    id,
                                damage:
                                    0.5,
                                health:
                                    p.health
                            });

                            sendNeeds(
                                id
                            );

                            if (
                                p.health <=
                                0
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
                            ) {
                                break;
                            }

                            const animal =
                                ensureAnimal(
                                    String(
                                        data.animalId ||
                                            ''
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
                                        x -
                                            220,
                                        z +
                                            55
                                    ) >
                                    150
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
                                'drink'
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
                                    x >=
                                        -310 &&
                                    x <=
                                        -35 &&
                                    z >=
                                        -459 &&
                                    z <=
                                        -444;

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

                        case 'animal_states_request': {
                            const states =
                                {};

                            for (
                                const animalId of
                                    (
                                        Array.isArray(
                                            data.ids
                                        )
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
                                        'animal_states',
                                    states
                                }
                            );

                            break;
                        }

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
                                MAX_NEED;

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

                            send(
                                ws,
                                {
                                    type:
                                        'respawned',
                                    spawn:
                                        SPAWN,
                                    state:
                                        playerSnapshot(
                                            p
                                        )
                                }
                            );

                            sendPlayers();

                            break;
                        }

                        default:
                            break;
                    }
                } catch (
                    error
                ) {
                    console.warn(
                        `Geçersiz istemci mesajı (${id}):`,
                        error.message
                    );
                }
            }
        );

        ws.on(
            'close',
            () => {
                delete players[id];

                console.log(
                    `Oyuncu ayrıldı: ${id}`
                );

                sendPlayers();
            }
        );

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

setInterval(
    () => {
        const now =
            Date.now();

        for (
            const [
                id,
                p
            ] of Object.entries(
                players
            )
        ) {
            if (
                !p.inGame ||
                !p.alive
            ) {
                continue;
            }

            /*
             * Açlık ve susuzluk
             * hızlı azalıyor.
             */
            const elapsed =
                now -
                p.lastNeedTick;

            const steps =
                Math.floor(
                    elapsed /
                        10000
                );

            if (
                steps > 0
            ) {
                p.lastNeedTick +=
                    steps *
                    10000;

                p.hunger =
                    Math.max(
                        0,
                        p.hunger -
                            0.50 *
                                steps
                    );

                p.thirst =
                    Math.max(
                        0,
                        p.thirst -
                            0.75 *
                                steps
                    );
            }

            /*
             * Biri 0 ise:
             * 0.5 can hasarı.
             *
             * İkisi de 0 ise:
             * 1 can hasarı.
             */
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
                        p.health -
                            damage
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
                                p.thirst <=
                                0
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

            /*
             * Son hasardan 5 saniye sonra
             * saniyede 0.5 can yenilenir.
             */
            if (
                p.alive &&
                p.health > 0 &&
                p.health <
                    MAX_NEED &&
                p.hunger > 0 &&
                p.thirst > 0 &&
                now -
                    (
                        p.lastDamageAt ||
                        0
                    ) >=
                    5000
            ) {
                p.health =
                    Math.min(
                        MAX_NEED,
                        p.health +
                            0.5
                    );
            }

            sendNeeds(
                id
            );
        }
    },
    1000
);

setInterval(
    () => {
        const now =
            Date.now();

        const hasPlayers =
            Object.values(
                players
            ).some(
                p =>
                    p.inGame &&
                    p.alive
            );

        for (
            const animal of
                wildAnimals.values()
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

            if (
                !steps
            ) {
                continue;
            }

            animal.lastNeedTick +=
                steps *
                30000;

            animal.hunger =
                Math.max(
                    0,
                    animal.hunger -
                        0.25 *
                            steps
                );

            animal.thirst =
                Math.max(
                    0,
                    animal.thirst -
                        0.5 *
                            steps
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

                    publicSystem(
                        `${animalLabel(
                            animal.id
                        )} vahşi hayvanı ${
                            animal.thirst <=
                            0
                                ? 'susuzluktan'
                                : 'açlıktan'
                        } öldü.`
                    );
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

setInterval(
    () => {
        for (
            const state of
                appleTrees.values()
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

setInterval(
    sendPlayers,
    100
);

setInterval(
    () => {
        chatHistory = [];

        broadcast({
            type:
                'chat_reset',
            time:
                new Date().toISOString()
        });
    },
    CHAT_RESET_MS
);

const MAP_LIMIT =
    510;

const PORT =
    process.env.PORT || 3000;

server.listen(
    PORT,
    () =>
        console.log(
            `Sunucu ${PORT} portunda çalışıyor.`
        )
);
