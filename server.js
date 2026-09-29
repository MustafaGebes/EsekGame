const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({
    server,
    maxPayload: 24 * 1024
});

app.use(express.json({
    limit: '64kb'
}));

app.use(express.static(__dirname));


// ============================================================
// ANA SAYFA
// ============================================================

app.get('/', (_req, res) => {
    res.sendFile(
        path.join(
            __dirname,
            'index.html'
        )
    );
});


// ============================================================
// KALICI VERİLER
// ============================================================

const DATA_DIR =
    path.join(
        __dirname,
        'data'
    );

const ACCOUNTS_FILE =
    path.join(
        DATA_DIR,
        'accounts.json'
    );


if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(
        DATA_DIR,
        {
            recursive: true
        }
    );
}


let accounts = {};


// ============================================================
// HESAPLARI YÜKLE
// ============================================================

function loadAccounts() {

    if (
        !fs.existsSync(
            ACCOUNTS_FILE
        )
    ) {
        accounts = {};

        saveAccounts();

        return;
    }


    try {

        const raw =
            fs.readFileSync(
                ACCOUNTS_FILE,
                'utf8'
            );


        if (
            !raw.trim()
        ) {
            accounts = {};
            return;
        }


        const parsed =
            JSON.parse(
                raw
            );


        /*
         * Yeni format:
         *
         * {
         *   "accounts": {
         *      ...
         *   }
         * }
         */

        if (
            parsed &&
            typeof parsed === 'object' &&
            parsed.accounts &&
            typeof parsed.accounts === 'object' &&
            !Array.isArray(
                parsed.accounts
            )
        ) {

            accounts =
                parsed.accounts;

            return;
        }


        /*
         * Eski formatı da destekle.
         */

        if (
            parsed &&
            typeof parsed === 'object' &&
            !Array.isArray(
                parsed
            )
        ) {

            accounts =
                parsed;

            return;
        }


        accounts = {};

    } catch (error) {

        console.error(
            'accounts.json okunamadı:',
            error.message
        );

        /*
         * Hatalı dosyada üstüne boş
         * hesap yazmıyoruz.
         */
        accounts = {};
    }
}


// ============================================================
// HESAPLARI KAYDET
// ============================================================

function saveAccounts() {

    try {

        if (
            !fs.existsSync(
                DATA_DIR
            )
        ) {
            fs.mkdirSync(
                DATA_DIR,
                {
                    recursive: true
                }
            );
        }


        const data = {
            accounts
        };


        const tempFile =
            ACCOUNTS_FILE +
            '.tmp';


        fs.writeFileSync(
            tempFile,
            JSON.stringify(
                data,
                null,
                2
            ),
            'utf8'
        );


        fs.renameSync(
            tempFile,
            ACCOUNTS_FILE
        );

    } catch (error) {

        console.error(
            'Hesaplar kaydedilemedi:',
            error.message
        );
    }
}


loadAccounts();


// ============================================================
// AUTH TOKENLARI
// ============================================================

const authTokens =
    new Map();


// ============================================================
// KULLANICI ADI
// ============================================================

function normalizeUsername(
    value
) {

    return String(
        value ?? ''
    )
        .normalize(
            'NFKC'
        )
        .trim()
        .toLocaleLowerCase(
            'tr-TR'
        );
}


function displayUsername(
    value
) {

    return String(
        value ?? ''
    )
        .normalize(
            'NFKC'
        )
        .trim()
        .slice(
            0,
            20
        );
}


function validUsername(
    username
) {

    return /^[\p{L}\p{N}_-]{3,20}$/u
        .test(
            username
        );
}


// ============================================================
// ŞİFRE
// ============================================================

function validPassword(
    password
) {

    return (
        typeof password ===
            'string' &&
        password.length >= 4 &&
        password.length <= 128
    );
}


function hashPassword(
    password
) {

    const salt =
        crypto
            .randomBytes(
                16
            )
            .toString(
                'hex'
            );


    const hash =
        crypto
            .scryptSync(
                password,
                salt,
                64
            )
            .toString(
                'hex'
            );


    return (
        salt +
        ':' +
        hash
    );
}


function verifyPassword(
    password,
    storedHash
) {

    try {

        if (
            typeof storedHash !==
                'string' ||
            !storedHash.includes(
                ':'
            )
        ) {
            return false;
        }


        const parts =
            storedHash.split(
                ':'
            );


        if (
            parts.length !== 2
        ) {
            return false;
        }


        const salt =
            parts[0];


        const originalHash =
            Buffer.from(
                parts[1],
                'hex'
            );


        const calculatedHash =
            crypto.scryptSync(
                password,
                salt,
                64
            );


        if (
            originalHash.length !==
            calculatedHash.length
        ) {
            return false;
        }


        return crypto.timingSafeEqual(
            originalHash,
            calculatedHash
        );

    } catch {

        return false;
    }
}


// ============================================================
// TOKEN
// ============================================================

function createAuthToken() {

    return crypto
        .randomBytes(
            32
        )
        .toString(
            'hex'
        );
}


function getUsernameFromToken(
    token
) {

    if (
        typeof token !==
            'string' ||
        !token
    ) {
        return null;
    }


    return (
        authTokens.get(
            token
        ) ||
        null
    );
}


// ============================================================
// HESAP KAYIT
// ============================================================

app.post(
    '/api/auth/register',
    (req, res) => {

        try {

            const rawUsername =
                displayUsername(
                    req.body?.username
                );


            const username =
                normalizeUsername(
                    rawUsername
                );


            const password =
                String(
                    req.body?.password ??
                    ''
                );


            const passwordConfirm =
                req.body?.passwordConfirm ??
                req.body?.password2 ??
                undefined;


            if (
                !validUsername(
                    rawUsername
                )
            ) {

                return res
                    .status(400)
                    .json({
                        ok: false,

                        message:
                            'Kullanıcı adı 3-20 karakter olmalı ve sadece harf, rakam, alt çizgi veya tire içermelidir.'
                    });
            }


            if (
                !validPassword(
                    password
                )
            ) {

                return res
                    .status(400)
                    .json({
                        ok: false,

                        message:
                            'Şifre 4-128 karakter arasında olmalıdır.'
                    });
            }


            if (
                passwordConfirm !==
                    undefined &&
                password !==
                    String(
                        passwordConfirm
                    )
            ) {

                return res
                    .status(400)
                    .json({
                        ok: false,

                        message:
                            'Şifreler aynı değil.'
                    });
            }


            if (
                accounts[
                    username
                ]
            ) {

                return res
                    .status(409)
                    .json({
                        ok: false,

                        message:
                            'Bu kullanıcı adı zaten kullanılıyor.'
                    });
            }


            accounts[
                username
            ] = {

                username:
                    rawUsername,

                usernameKey:
                    username,

                passwordHash:
                    hashPassword(
                        password
                    ),

                createdAt:
                    new Date()
                        .toISOString()
            };


            saveAccounts();


            const token =
                createAuthToken();


            authTokens.set(
                token,
                username
            );


            return res.json({

                ok: true,

                token,

                username:
                    rawUsername
            });

        } catch (error) {

            console.error(
                'Register hatası:',
                error
            );


            return res
                .status(500)
                .json({

                    ok: false,

                    message:
                        'Hesap oluşturulurken bir hata oluştu.'
                });
        }
    }
);


// ============================================================
// HESAP GİRİŞ
// ============================================================

app.post(
    '/api/auth/login',
    (req, res) => {

        try {

            const username =
                normalizeUsername(
                    req.body?.username
                );


            const password =
                String(
                    req.body?.password ??
                    ''
                );


            const account =
                accounts[
                    username
                ];


            if (
                !account ||
                !verifyPassword(
                    password,
                    account.passwordHash
                )
            ) {

                return res
                    .status(401)
                    .json({

                        ok: false,

                        message:
                            'Kullanıcı adı veya şifre hatalı.'
                    });
            }


            const token =
                createAuthToken();


            authTokens.set(
                token,
                username
            );


            return res.json({

                ok: true,

                token,

                username:
                    account.username
            });

        } catch (error) {

            console.error(
                'Login hatası:',
                error
            );


            return res
                .status(500)
                .json({

                    ok: false,

                    message:
                        'Giriş yapılırken bir hata oluştu.'
                });
        }
    }
);


// ============================================================
// ÇIKIŞ
// ============================================================

app.post(
    '/api/auth/logout',
    (req, res) => {

        const token =
            req.body?.token;


        if (token) {
            authTokens.delete(
                token
            );
        }


        res.json({
            ok: true
        });
    }
);


// ============================================================
// BENİM HESABIM
// ============================================================

app.get(
    '/api/auth/me',
    (req, res) => {

        const authorization =
            req.headers.authorization ||
            '';


        const token =
            authorization.replace(
                /^Bearer\s+/i,
                ''
            );


        const username =
            getUsernameFromToken(
                token
            );


        if (!username) {

            return res
                .status(401)
                .json({
                    ok: false
                });
        }


        const account =
            accounts[
                username
            ];


        if (!account) {

            return res
                .status(401)
                .json({
                    ok: false
                });
        }


        res.json({

            ok: true,

            username:
                account.username
        });
    }
);


// ============================================================
// ŞİFRE DEĞİŞTİR
// ============================================================

app.post(
    '/api/auth/change-password',
    (req, res) => {

        try {

            const token =
                req.body?.token;


            const username =
                getUsernameFromToken(
                    token
                );


            if (!username) {

                return res
                    .status(401)
                    .json({

                        ok: false,

                        message:
                            'Oturum geçersiz.'
                    });
            }


            const account =
                accounts[
                    username
                ];


            if (!account) {

                return res
                    .status(404)
                    .json({

                        ok: false,

                        message:
                            'Hesap bulunamadı.'
                    });
            }


            const oldPassword =
                String(
                    req.body?.oldPassword ??
                    ''
                );


            const newPassword =
                String(
                    req.body?.newPassword ??
                    ''
                );


            if (
                !verifyPassword(
                    oldPassword,
                    account.passwordHash
                )
            ) {

                return res
                    .status(400)
                    .json({

                        ok: false,

                        message:
                            'Mevcut şifre hatalı.'
                    });
            }


            if (
                !validPassword(
                    newPassword
                )
            ) {

                return res
                    .status(400)
                    .json({

                        ok: false,

                        message:
                            'Yeni şifre 4-128 karakter arasında olmalıdır.'
                    });
            }


            account.passwordHash =
                hashPassword(
                    newPassword
                );


            account.updatedAt =
                new Date()
                    .toISOString();


            saveAccounts();


            for (
                const [
                    authToken,
                    tokenUsername
                ]
                of authTokens
            ) {

                if (
                    tokenUsername ===
                    username
                ) {

                    authTokens.delete(
                        authToken
                    );
                }
            }


            res.json({

                ok: true,

                message:
                    'Şifre değiştirildi.'
            });

        } catch (error) {

            console.error(
                'Şifre değiştirme hatası:',
                error
            );


            res
                .status(500)
                .json({

                    ok: false,

                    message:
                        'Şifre değiştirilemedi.'
                });
        }
    }
);


// ============================================================
// KULLANICI ADI DEĞİŞTİR
// ============================================================

app.post(
    '/api/auth/change-username',
    (req, res) => {

        try {

            const token =
                req.body?.token;


            const oldUsername =
                getUsernameFromToken(
                    token
                );


            if (!oldUsername) {

                return res
                    .status(401)
                    .json({

                        ok: false,

                        message:
                            'Oturum geçersiz.'
                    });
            }


            const account =
                accounts[
                    oldUsername
                ];


            if (!account) {

                return res
                    .status(404)
                    .json({

                        ok: false,

                        message:
                            'Hesap bulunamadı.'
                    });
            }


            const newDisplay =
                displayUsername(
                    req.body?.newUsername
                );


            const newUsername =
                normalizeUsername(
                    newDisplay
                );


            if (
                !validUsername(
                    newDisplay
                )
            ) {

                return res
                    .status(400)
                    .json({

                        ok: false,

                        message:
                            'Kullanıcı adı 3-20 karakter olmalı ve sadece harf, rakam, alt çizgi veya tire içermelidir.'
                    });
            }


            if (
                newUsername ===
                oldUsername
            ) {

                return res.json({

                    ok: true,

                    username:
                        account.username
                });
            }


            if (
                accounts[
                    newUsername
                ]
            ) {

                return res
                    .status(409)
                    .json({

                        ok: false,

                        message:
                            'Bu kullanıcı adı zaten kullanılıyor.'
                    });
            }


            delete accounts[
                oldUsername
            ];


            account.username =
                newDisplay;


            account.usernameKey =
                newUsername;


            account.updatedAt =
                new Date()
                    .toISOString();


            accounts[
                newUsername
            ] =
                account;


            for (
                const [
                    authToken,
                    tokenUsername
                ]
                of authTokens
            ) {

                if (
                    tokenUsername ===
                    oldUsername
                ) {

                    authTokens.set(
                        authToken,
                        newUsername
                    );
                }
            }


            saveAccounts();


            res.json({

                ok: true,

                username:
                    newDisplay
            });

        } catch (error) {

            console.error(
                'Kullanıcı adı değiştirme hatası:',
                error
            );


            res
                .status(500)
                .json({

                    ok: false,

                    message:
                        'Kullanıcı adı değiştirilemedi.'
                });
        }
    }
);


// ============================================================
// OYUN DEĞİŞKENLERİ
// ============================================================

const players =
    Object.create(null);

const appleTrees =
    new Map();

const wildAnimals =
    new Map();

let chatHistory = [];


const CHAT_RESET_MS =
    10 * 60 * 1000;

const APPLE_GROW_MS =
    5 * 60 * 1000;

const CHAT_LIMIT =
    100;

const MAX_NEED =
    9;

const MAP_LIMIT =
    510;


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


// ============================================================
// YARDIMCILAR
// ============================================================

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
        const client
        of wss.clients
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


function activePlayerCount() {

    return Object.values(
        players
    )
        .filter(
            p =>
                p.inGame
        )
        .length;
}


function clamp(
    value,
    min,
    max,
    fallback = min
) {

    const n =
        Number(
            value
        );


    if (
        !Number.isFinite(
            n
        )
    ) {
        return fallback;
    }


    return Math.max(
        min,
        Math.min(
            max,
            n
        )
    );
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
        name ||
        'Player'
    );
}


function nameKey(
    value
) {

    return cleanName(
        value
    )
        .normalize(
            'NFKC'
        )
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


// ============================================================
// GUEST SİSTEMİ
// ============================================================

/*
 * ÖNEMLİ:
 *
 * Guest numarası kaydedilmez.
 *
 * O anda oyunda bulunan Guest'lere bakılır
 * ve EN KÜÇÜK BOŞ NUMARA bulunur.
 *
 * Örnek:
 *
 * Guest-000
 * Guest-001
 * Guest-003
 *
 * Yeni kişi:
 *
 * Guest-002
 *
 * Eğer hiç Guest yoksa:
 *
 * Guest-000
 */

function nextGuestName() {

    const usedNumbers =
        new Set();


    for (
        const player
        of Object.values(
            players
        )
    ) {

        if (
            !player.inGame
        ) {
            continue;
        }


        if (
            typeof player.name !==
            'string'
        ) {
            continue;
        }


        const match =
            player.name.match(
                /^Guest-(\d+)$/
            );


        if (!match) {
            continue;
        }


        const number =
            Number(
                match[1]
            );


        if (
            Number.isInteger(
                number
            ) &&
            number >= 0
        ) {

            usedNumbers.add(
                number
            );
        }
    }


    let number = 0;


    while (
        usedNumbers.has(
            number
        )
    ) {

        number++;
    }


    return (
        'Guest-' +
        String(
            number
        ).padStart(
            3,
            '0'
        )
    );
}


// ============================================================
// PLAYER SNAPSHOT
// ============================================================

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


// ============================================================
// OYUNCULARI GÖNDER
// ============================================================

function sendPlayers() {

    const publicPlayers =
        Object.create(null);


    for (
        const [
            id,
            p
        ]
        of Object.entries(
            players
        )
    ) {

        publicPlayers[id] =
            playerSnapshot(
                p
            );
    }


    broadcast({

        type:
            'players',

        players:
            publicPlayers,

        count:
            activePlayerCount()
    });
}


// ============================================================
// SİSTEM CHAT
// ============================================================

function publicSystem(
    text
) {

    const message = {

        id:
            `sys-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,

        system:
            true,

        name:
            'Sistem',

        text:
            cleanText(
                text
            ),

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
            'chat_message',

        message
    });
}


// ============================================================
// NEEDS
// ============================================================

function sendNeeds(
    id
) {

    const p =
        players[id];


    if (!p) {
        return;
    }


    send(
        p.ws,
        {

            type:
                'needs',

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


// ============================================================
// ÖLÜM
// ============================================================

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


    victim.health =
        0;

    victim.alive =
        false;


    const killer =
        killerId
            ? players[
                killerId
            ]
            : null;


    const killerName =
        killer
            ? killer.name
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


// ============================================================
// AKTİF İSİM KONTROLÜ
// ============================================================

function findActiveName(
    name,
    exceptId
) {

    const key =
        nameKey(
            name
        );


    return Object.entries(
        players
    )
        .find(
            ([
                id,
                player
            ]) =>
                id !== exceptId &&
                player.inGame &&
                nameKey(
                    player.name
                ) === key
        );
}


// ============================================================
// ELMA
// ============================================================

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
                    400,
                    0
                ),

            z:
                clamp(
                    z,
                    -400,
                    400,
                    0
                ),

            apples:
                6,

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


// ============================================================
// HAYVAN
// ============================================================

function validAnimalId(
    id
) {

    return /^forest-(wolf|deer|rabbit|boar|fox|goat)-\d{1,3}$/
        .test(
            String(
                id || ''
            )
        );
}


function ensureAnimal(
    id
) {

    if (
        !validAnimalId(
            id
        )
    ) {
        return null;
    }


    if (
        !wildAnimals.has(
            id
        )
    ) {

        wildAnimals.set(
            id,
            {

                id,

                health:
                    9,

                hunger:
                    9,

                thirst:
                    9,

                alive:
                    true,

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
        ).split(
            '-'
        )[1];


    return {

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
        'Vahşi hayvan';
}


// ============================================================
// CHAT
// ============================================================

function parseWhisper(
    text
) {

    const quoted =
        text.match(
            /^\/msg\s+(\S+)\s+"([\s\S]{1,220})"\s*$/i
        );


    if (
        quoted
    ) {

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


    if (
        plain
    ) {

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


// ============================================================
// WEBSOCKET
// ============================================================

wss.on(
    'connection',
    ws => {

        const id =
            crypto
                .randomBytes(
                    5
                )
                .toString(
                    'hex'
                );


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
                'Guest',

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

            lastStarveDamageAt:
                0,

            accountUsername:
                null,

            authToken:
                null,

            hasJoined:
                false
        };


        send(
            ws,
            {

                type:
                    'init',

                id
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


        // ====================================================
        // MESAJ
        // ====================================================

        ws.on(
            'message',
            raw => {

                try {

                    const data =
                        JSON.parse(
                            raw.toString()
                        );


                    const p =
                        players[
                            id
                        ];


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

                        // ====================================
                        // PROFİL
                        // ====================================

                        case 'profile': {

                            p.platform =
                                data.platform ===
                                'mobile'
                                    ? 'mobile'
                                    : 'pc';


                            /*
                             * İsim server tarafından belirlenir.
                             * Client'ın gönderdiği name
                             * kabul edilmez.
                             */

                            if (
                                p.accountUsername
                            ) {

                                const account =
                                    accounts[
                                        p.accountUsername
                                    ];


                                if (
                                    account
                                ) {

                                    p.name =
                                        account.username;
                                }
                            }


                            sendPlayers();

                            break;
                        }


                        // ====================================
                        // OYUNA GİR
                        // ====================================

                        case 'join_request': {

                            const token =
                                String(
                                    data.authToken ||
                                    data.token ||
                                    ''
                                );


                            const accountUsername =
                                getUsernameFromToken(
                                    token
                                );


                            // --------------------------------
                            // HESAPLI OYUNCU
                            // --------------------------------

                            if (
                                accountUsername &&
                                accounts[
                                    accountUsername
                                ]
                            ) {

                                const account =
                                    accounts[
                                        accountUsername
                                    ];


                                const accountName =
                                    account.username;


                                const duplicate =
                                    findActiveName(
                                        accountName,
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
                                                `“${accountName}” adı şu anda oyunda kullanılıyor.`
                                        }
                                    );


                                    break;
                                }


                                p.accountUsername =
                                    accountUsername;


                                p.authToken =
                                    token;


                                p.name =
                                    accountName;

                            }

                            // --------------------------------
                            // GUEST
                            // --------------------------------

                            else {

                                /*
                                 * YENİ GUEST SADECE GERÇEK
                                 * JOIN'DE VERİLİR.
                                 *
                                 * Pause / ESC bunu çalıştırmaz.
                                 */

                                p.name =
                                    nextGuestName();


                                p.accountUsername =
                                    null;


                                p.authToken =
                                    null;
                            }


                            p.platform =
                                data.platform ===
                                'mobile'
                                    ? 'mobile'
                                    : 'pc';


                            p.inGame =
                                true;


                            p.hasJoined =
                                true;


                            p.alive =
                                true;


                            p.health =
                                MAX_NEED;


                            p.hunger =
                                MAX_NEED;


                            p.thirst =
                                MAX_NEED;


                            p.lastNeedTick =
                                Date.now();


                            send(
                                ws,
                                {

                                    type:
                                        'join_accepted',

                                    id,

                                    state:
                                        playerSnapshot(
                                            p
                                        ),

                                    spawn:
                                        SPAWN
                                }
                            );


                            sendPlayers();

                            break;
                        }


                        // ====================================
                        // MENÜ / PRESENCE
                        // ====================================

                        case 'presence': {

                            /*
                             * active:false:
                             *
                             * Oyuncu gerçekten menüye
                             * dönmüş demektir.
                             *
                             * Sonraki girişte yeni/
                             * boş Guest numarası bulunur.
                             */

                            if (
                                data.active !==
                                true
                            ) {

                                p.inGame =
                                    false;


                                p.hasJoined =
                                    false;


                                sendPlayers();

                                break;
                            }


                            /*
                             * Pause sırasında client'ın
                             * active:true göndermesine
                             * gerek yok.
                             */

                            sendPlayers();

                            break;
                        }


                        // ====================================
                        // HAREKET
                        // ====================================

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
                                undefined
                            ) {

                                const ping =
                                    Number(
                                        data.pingMs
                                    );


                                if (
                                    Number.isFinite(
                                        ping
                                    )
                                ) {

                                    p.pingMs =
                                        clamp(
                                            ping,
                                            0,
                                            10000,
                                            p.pingMs
                                        );
                                }
                            }

                            break;
                        }


                        // ====================================
                        // PING
                        // ====================================

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

                            const ping =
                                Number(
                                    data.pingMs
                                );


                            if (
                                Number.isFinite(
                                    ping
                                )
                            ) {

                                p.pingMs =
                                    clamp(
                                        ping,
                                        0,
                                        10000,
                                        p.pingMs
                                    );
                            }

                            break;
                        }


                        // ====================================
                        // CHAT
                        // ====================================

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
                                    )
                                        .find(
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


                        // ====================================
                        // ELMA DURUMU
                        // ====================================

                        case 'apple_state_request': {

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
                                const item
                                of trees
                            ) {

                                const treeId =
                                    String(
                                        item.id ||
                                        ''
                                    );


                                if (
                                    !/^apple-[A-Za-z0-9_-]{1,40}$/
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


                        // ====================================
                        // ELMA TOPLA
                        // ====================================

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


                            if (
                                !state
                            ) {

                                send(
                                    ws,
                                    {

                                        type:
                                            'apple_pick_result',

                                        ok:
                                            false,

                                        treeId
                                    }
                                );


                                break;
                            }


                            const distance =
                                Math.hypot(
                                    p.x -
                                    state.x,

                                    p.z -
                                    state.z
                                );


                            if (
                                distance > 6 ||
                                state.apples <= 0
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


                        // ====================================
                        // SU
                        // ====================================

                        case 'drink': {

                            if (
                                !p.inGame ||
                                !p.alive
                            ) {
                                break;
                            }


                            const atBeachWater =
                                p.x >= -310 &&
                                p.x <= -35 &&
                                p.z >= -459 &&
                                p.z <= -444;


                            const atForestPond =
                                Math.hypot(
                                    p.x -
                                    FOREST_POND.x,

                                    p.z -
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
                                            'action_denied',

                                        action:
                                            'drink',

                                        message:
                                            'Suya biraz daha yaklaş.'
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


                        // ====================================
                        // OYUNCUYA SALDIRI
                        // ====================================

                        case 'attack_player': {

                            if (
                                !p.inGame ||
                                !p.alive
                            ) {
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
                                4
                            ) {
                                break;
                            }


                            p.lastAttackAt =
                                Date.now();


                            const damage =
                                1;


                            target.health =
                                Math.max(
                                    0,
                                    target.health -
                                    damage
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


                            sendNeeds(
                                targetId
                            );


                            if (
                                target.health <=
                                0
                            ) {

                                killPlayer(
                                    targetId,

                                    id,

                                    `${target.name}, ${p.name} tarafından öldürüldü.`
                                );
                            }


                            break;
                        }


                        // ====================================
                        // HAYVANA SALDIR
                        // ====================================

                        case 'attack_animal': {

                            if (
                                !p.inGame ||
                                !p.alive
                            ) {
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
                                Math.hypot(
                                    p.x -
                                    ax,

                                    p.z -
                                    az
                                ) >
                                4
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


                            if (
                                !animal.alive
                            ) {

                                publicSystem(
                                    `${p.name}, ${animalLabel(animalId)} adlı hayvanı yendi.`
                                );
                            }


                            break;
                        }


                        // ====================================
                        // HAYVAN SALDIRISI
                        // ====================================

                        case 'animal_attack': {

                            if (
                                !p.inGame ||
                                !p.alive
                            ) {
                                break;
                            }


                            if (
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


                            if (
                                !animal ||
                                !animal.alive
                            ) {
                                break;
                            }


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


                            sendNeeds(
                                id
                            );


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


                        // ====================================
                        // HAYVAN BAKIMI
                        // ====================================

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
                                !animal.alive
                            ) {
                                break;
                            }


                            if (
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


                        // ====================================
                        // HAYVAN DURUMLARI
                        // ====================================

                        case 'animal_states_request': {

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
                                const animalId
                                of ids
                            ) {

                                const state =
                                    ensureAnimal(
                                        animalId
                                    );


                                if (
                                    state
                                ) {

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


                        // ====================================
                        // RESPAWN
                        // ====================================

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

                } catch (error) {

                    console.warn(
                        `Geçersiz istemci mesajı (${id}):`,
                        error.message
                    );
                }
            }
        );


        // ====================================================
        // BAĞLANTI KAPANDI
        // ====================================================

        ws.on(
            'close',
            () => {

                delete players[
                    id
                ];


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


// ============================================================
// OYUNCU AÇLIK / SUSUZLUK
// ============================================================

setInterval(
    () => {

        const now =
            Date.now();


        for (
            const [
                id,
                p
            ]
            of Object.entries(
                players
            )
        ) {

            if (
                !p.inGame ||
                !p.alive
            ) {
                continue;
            }


            const elapsed =
                now -
                p.lastNeedTick;


            const steps =
                Math.floor(
                    elapsed /
                    30000
                );


            if (
                steps <= 0
            ) {
                continue;
            }


            p.lastNeedTick +=
                steps *
                30000;


            p.hunger =
                Math.max(
                    0,
                    p.hunger -
                    0.25 *
                    steps
                );


            p.thirst =
                Math.max(
                    0,
                    p.thirst -
                    0.5 *
                    steps
                );


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
                30000
            ) {

                p.health =
                    Math.max(
                        0,
                        p.health -
                        0.5
                    );


                p.lastStarveDamageAt =
                    now;


                if (
                    p.health <=
                    0
                ) {

                    killPlayer(
                        id,

                        null,

                        p.thirst <= 0
                            ? `${p.name} susuzluktan hayatını kaybetti.`
                            : `${p.name} açlıktan hayatını kaybetti.`
                    );
                }
            }


            sendNeeds(
                id
            );
        }

    },
    1000
);


// ============================================================
// HAYVAN İHTİYAÇLARI
// ============================================================

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


            if (
                steps <= 0
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
                        `${animalLabel(animal.id)} vahşi hayvanı ${
                            animal.thirst <= 0
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


// ============================================================
// ELMA BÜYÜMESİ
// ============================================================

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


// ============================================================
// OYUNCU LİSTESİ
// ============================================================

setInterval(
    sendPlayers,
    100
);


// ============================================================
// CHAT TEMİZLEME
// ============================================================

setInterval(
    () => {

        chatHistory =
            [];


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


// ============================================================
// SERVER SAĞLIK
// ============================================================

app.get(
    '/health',
    (_req, res) => {

        res.json({

            ok:
                true,

            players:
                activePlayerCount(),

            accounts:
                Object.keys(
                    accounts
                ).length
        });
    }
);


// ============================================================
// SERVER BAŞLAT
// ============================================================

const PORT =
    process.env.PORT ||
    3000;


server.listen(
    PORT,
    () => {

        console.log(
            '======================================'
        );


        console.log(
            `EsekGame server ${PORT} portunda çalışıyor.`
        );


        console.log(
            `Kayıtlı hesap: ${
                Object.keys(
                    accounts
                ).length
            }`
        );


        console.log(
            'Guest sistemi: boş olan en küçük numara kullanılıyor.'
        );


        console.log(
            '======================================'
        );
    }
);
