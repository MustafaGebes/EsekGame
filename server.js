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
const RPG_DATA = require(path.join(ROOT, "games", "eseksimulator", "rpg-data.js"));

const DATA_DIR = path.join(ROOT, "data");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");
const PLAYER_PETS_FILE = path.join(DATA_DIR, "player-pets.json");

const MAIN_INDEX = path.join(ROOT, "index.html");
const SIMULATOR_INDEX = path.join(ROOT, "games", "eseksimulator", "index.html");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(ACCOUNTS_FILE)) {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify({ accounts: {} }, null, 2), "utf8");
}

function loadPlayerPetsStore() {
    try {
        const data = JSON.parse(fs.readFileSync(PLAYER_PETS_FILE, "utf8"));
        return data && data.profiles && typeof data.profiles === "object" ? data : { profiles: {} };
    } catch (_) {
        return { profiles: {} };
    }
}
let playerPetsStore = loadPlayerPetsStore();
function persistPlayerPetsStore() {
    const tempFile = `${PLAYER_PETS_FILE}.tmp`;
    try {
        fs.writeFileSync(tempFile, JSON.stringify(playerPetsStore, null, 2), { encoding: "utf8", mode: 0o600 });
        fs.renameSync(tempFile, PLAYER_PETS_FILE);
    } catch (err) {
        try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (_) {}
        console.error("Pet seçimi kaydedilemedi:", err.message);
    }
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
const AMMO_ITEM_ID = 'ammo_magazine';
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

const PET_SHOP = RPG_DATA.trader;
const PET_SHOP_RANGE = RPG_DATA.trader.range;
const PET_TYPES = Object.freeze({
    dog: { name: "Bekçi Köpek", damageMultiplier: 1.25, damageTakenMultiplier: 1, maxStaminaBonus: 0, sprintCostMultiplier: 1, staminaRegenMultiplier: 1 },
    rabbit: { name: "Çevik Tavşan", damageMultiplier: 1, damageTakenMultiplier: 1, maxStaminaBonus: 20, sprintCostMultiplier: 0.8, staminaRegenMultiplier: 1.4 },
    turtle: { name: "Sağlam Kaplumbağa", damageMultiplier: 1, damageTakenMultiplier: 0.8, maxStaminaBonus: 0, sprintCostMultiplier: 1, staminaRegenMultiplier: 1 }
});

function getCatalogItem(id) { return RPG_DATA.items.find(item => item.id === String(id || "")) || null; }
function inventoryHas(progress, id) { return !!progress && Array.isArray(progress.inventory) && progress.inventory.some(entry => entry.id === id && entry.quantity > 0); }
function getBagCapacity(progress) { return RPG_DATA.bagSlotsBase + Math.max(0, Math.min(3, Number(progress && progress.bagLevel) || 0)) * RPG_DATA.bagSlotsPerUpgrade; }
function xpForLevel(level) { return level >= RPG_DATA.maxLevel ? 0 : RPG_DATA.xpBase + Math.max(0, level - 1) * RPG_DATA.xpPerLevel; }
function totalXpForLevel(level) { let total = 0; for (let current = 1; current < Math.min(level, RPG_DATA.maxLevel); current++) total += xpForLevel(current); return total; }
function getPlayerLevel(xp) { let level = 1, remaining = Math.max(0, Number(xp) || 0); while (level < RPG_DATA.maxLevel && remaining >= xpForLevel(level)) { remaining -= xpForLevel(level); level++; } return level; }
function getXpWithinLevel(xp) { let remaining = Math.max(0, Number(xp) || 0), level = 1; while (level < RPG_DATA.maxLevel && remaining >= xpForLevel(level)) { remaining -= xpForLevel(level); level++; } return { level, current: level >= RPG_DATA.maxLevel ? 0 : remaining, next: xpForLevel(level) }; }
function getArmorItem(progress) { const item = getCatalogItem(progress && progress.equippedArmor); return item && item.kind === "armor" ? item : null; }
function getBuffMultiplier(progress, key, now = Date.now()) { const buff = progress && progress.buffs && progress.buffs[key]; return buff && buff.expiresAt > now ? Math.max(0.5, Math.min(3, Number(buff.multiplier) || 1)) : 1; }
function getMaxHealth(player) { const armor = getArmorItem(player && player.progress); return MAX_NEED + (armor ? Number(armor.healthBonus) || 0 : 0); }
function createDefaultProgress() {
    return { petId: null, stamina: 100, xp: 0, coins: RPG_DATA.startingCoins, bagLevel: 0, inventory: [], equippedWeapon: null, equippedArmor: null, ammo: 0, buffs: {} };
}
function normalizeProgress(raw) {
    const p = createDefaultProgress();
    if (!raw || typeof raw !== "object") return p;
    p.xp = Math.max(0, Math.min(totalXpForLevel(RPG_DATA.maxLevel), Math.floor(Number(raw.xp) || 0)));
    p.coins = Math.max(0, Math.min(999999999, Math.floor(Number.isFinite(Number(raw.coins)) ? Number(raw.coins) : RPG_DATA.startingCoins)));
    p.bagLevel = Math.max(0, Math.min(3, Math.floor(Number(raw.bagLevel) || 0)));
    const merged = new Map();
    for (const entry of Array.isArray(raw.inventory) ? raw.inventory : []) {
        const item = getCatalogItem(entry && entry.id);
        if (!item || item.kind === "bag") continue;
        const quantity = ['food', 'ammo'].includes(item.kind) ? Math.max(1, Math.min(999, Math.floor(Number(entry.quantity) || 1))) : 1;
        merged.set(item.id, Math.min(['food', 'ammo'].includes(item.kind) ? 999 : 1, (merged.get(item.id) || 0) + quantity));
    }
    p.inventory = Array.from(merged, ([id, quantity]) => ({ id, quantity })).slice(0, getBagCapacity(p));
    const legacyPetId = Object.prototype.hasOwnProperty.call(PET_TYPES, String(raw.petId || "")) ? String(raw.petId) : null;
    if (legacyPetId && !inventoryHas(p, legacyPetId) && p.inventory.length < getBagCapacity(p)) p.inventory.push({ id: legacyPetId, quantity: 1 });
    const hasKind = (id, kind) => !!id && inventoryHas(p, id) && getCatalogItem(id)?.kind === kind;
    p.petId = hasKind(raw.petId, "pet") ? String(raw.petId) : (legacyPetId && hasKind(legacyPetId, "pet") ? legacyPetId : null);
    p.equippedWeapon = hasKind(raw.equippedWeapon, "weapon") ? String(raw.equippedWeapon) : null;
    p.equippedArmor = hasKind(raw.equippedArmor, "armor") ? String(raw.equippedArmor) : null;
    p.ammo = Math.max(0, Math.min(GUN_MAGAZINE, Math.floor(Number(raw.ammo) || 0)));
    p.buffs = {};
    for (const key of ["damage", "speed", "staminaRegen"]) {
        const buff = raw.buffs && raw.buffs[key], expiresAt = Number(buff && buff.expiresAt), multiplier = Number(buff && buff.multiplier);
        if (Number.isFinite(expiresAt) && expiresAt > Date.now() && Number.isFinite(multiplier)) p.buffs[key] = { expiresAt, multiplier: Math.max(0.5, Math.min(3, multiplier)), label: String(buff.label || key).slice(0, 32) };
    }
    const armor = getArmorItem(p);
    const maxStamina = 100 + (p.petId ? PET_TYPES[p.petId].maxStaminaBonus : 0) + (armor ? Number(armor.staminaBonus) || 0 : 0);
    const storedStamina = Number(raw.stamina);
    p.stamina = Number.isFinite(storedStamina) ? Math.max(0, Math.min(maxStamina, storedStamina)) : maxStamina;
    return p;
}
function loadProgressForKey(key) { return normalizeProgress(playerPetsStore.profiles[key]); }
function savePlayerProgress(player) {
    if (!player || !player.progressKey || !player.progress) return;
    playerPetsStore.profiles[player.progressKey] = normalizeProgress(player.progress);
    persistPlayerPetsStore();
}
function getMaxStamina(player) {
    const pet = player && player.progress && PET_TYPES[player.progress.petId], armor = getArmorItem(player && player.progress);
    return 100 + (pet ? pet.maxStaminaBonus : 0) + (armor ? Number(armor.staminaBonus) || 0 : 0);
}
function getPetDamageMultiplier(player) {
    const pet = player && player.progress && PET_TYPES[player.progress.petId];
    return (pet ? pet.damageMultiplier : 1) * getBuffMultiplier(player && player.progress, "damage");
}
function getPetDamageTakenMultiplier(player) {
    const pet = player && player.progress && PET_TYPES[player.progress.petId], armor = getArmorItem(player && player.progress);
    return (pet ? pet.damageTakenMultiplier : 1) * (armor ? 1 - Math.max(0, Math.min(0.75, Number(armor.damageReduction) || 0)) : 1);
}
function getStaminaCostMultiplier(player) {
    const pet = player && player.progress && PET_TYPES[player.progress.petId], armor = getArmorItem(player && player.progress);
    return (pet ? pet.sprintCostMultiplier : 1) * (armor ? Number(armor.staminaCostMultiplier) || 1 : 1);
}
function getStaminaRegenMultiplier(player) {
    const pet = player && player.progress && PET_TYPES[player.progress.petId], armor = getArmorItem(player && player.progress);
    return (pet ? pet.staminaRegenMultiplier : 1) * (armor ? Number(armor.staminaRegenMultiplier) || 1 : 1) * getBuffMultiplier(player && player.progress, "staminaRegen");
}
function getSpeedMultiplier(player) {
    const armor = getArmorItem(player && player.progress);
    return (armor ? Number(armor.speedMultiplier) || 1 : 1) * getBuffMultiplier(player && player.progress, "speed");
}
function getRpgSnapshot(player) {
    const p = player && player.progress || createDefaultProgress(), levelData = getXpWithinLevel(p.xp), weapon = getCatalogItem(p.equippedWeapon), armor = getArmorItem(p);
    return {
        xp: p.xp, level: levelData.level, xpInLevel: levelData.current, xpToNext: levelData.next, coins: p.coins,
        bagLevel: p.bagLevel, bagCapacity: getBagCapacity(p), inventory: p.inventory.map(entry => ({ ...entry })),
        equippedWeapon: p.equippedWeapon, equippedWeaponType: weapon ? weapon.weaponType : "none", ammo: p.ammo,
        equippedArmor: p.equippedArmor, petId: p.petId, buffs: { ...p.buffs },
        stats: { maxHealth: getMaxHealth(player), maxStamina: getMaxStamina(player), speedMultiplier: getSpeedMultiplier(player), staminaRegenBuffMultiplier: getBuffMultiplier(p, "staminaRegen") }
    };
}
function sendRpgState(player) { if (player && player.inGame) sendTo(player, { type: "rpg_state", state: getRpgSnapshot(player) }); }
function inventorySlotCount(progress) { return (progress.inventory || []).length; }
function nearTrader(player) { return Math.hypot(player.x - PET_SHOP.x, player.z - PET_SHOP.z) <= PET_SHOP_RANGE; }
function handleRpgShopRequest(player) {
    if (!player.inGame || !player.alive) return;
    if (!nearTrader(player)) { sendTo(player, { type: "rpg_action_result", ok: false, message: "Tüccar menüsünü açmak için çiftlikteki tezgâha yaklaş." }); return; }
    sendTo(player, { type: "rpg_shop_open", categories: RPG_DATA.categories, items: RPG_DATA.items, state: getRpgSnapshot(player) });
}
function handleRpgBuy(player, data) {
    if (!player.inGame || !player.alive || !player.progress) return;
    if (!nearTrader(player)) { sendTo(player, { type: "rpg_action_result", ok: false, message: "Alışveriş için tüccarın yanında olmalısın." }); return; }
    const item = getCatalogItem(data && data.itemId), p = player.progress;
    if (!item) { sendTo(player, { type: "rpg_action_result", ok: false, message: "Bu ürün tüccarda yok." }); return; }
    if (getPlayerLevel(p.xp) < item.requiredLevel) { sendTo(player, { type: "rpg_action_result", ok: false, message: `Bu ürün için seviye ${item.requiredLevel} olmalısın.` }); return; }
    const exactItem = p.inventory.find(entry => entry.id === item.id);
    if (!['food', 'ammo'].includes(item.kind) && item.kind !== 'bag' && exactItem) { sendTo(player, { type: "rpg_action_result", ok: false, message: "Bu ürüne zaten sahipsin." }); return; }
    const replacements = item.kind === "weapon"
        ? p.inventory.filter(entry => { const old = getCatalogItem(entry.id); return old && old.kind === "weapon" && old.weaponType === item.weaponType; })
        : item.kind === "armor" ? p.inventory.filter(entry => getCatalogItem(entry.id)?.kind === "armor") : [];
    const tradeInCoins = replacements.reduce((total, entry) => total + Math.floor((getCatalogItem(entry.id)?.price || 0) * 0.25), 0);
    if (p.coins + tradeInCoins < item.price) { sendTo(player, { type: "rpg_action_result", ok: false, message: "Yeterli coin'in yok." }); return; }
    if (item.kind === "bag") {
        if (item.bagLevel !== p.bagLevel + 1) { sendTo(player, { type: "rpg_action_result", ok: false, message: "Çantaları sırayla yükseltmelisin." }); return; }
        p.bagLevel = item.bagLevel;
    } else {
        const existing = p.inventory.find(entry => entry.id === item.id);
        if (!existing && inventorySlotCount(p) - replacements.length >= getBagCapacity(p)) { sendTo(player, { type: "rpg_action_result", ok: false, message: "Çantan dolu. Bir çanta yükseltmesi al veya yiyeceklerini kullan." }); return; }
        const oldWeapon = replacements.some(entry => entry.id === p.equippedWeapon);
        const oldArmor = replacements.some(entry => entry.id === p.equippedArmor);
        const oldMaxHealth = getMaxHealth(player), oldMaxStamina = getMaxStamina(player);
        if (replacements.length) p.inventory = p.inventory.filter(entry => !replacements.some(old => old.id === entry.id));
        if (['food', 'ammo'].includes(item.kind) && existing) existing.quantity = Math.min(999, existing.quantity + 1);
        else p.inventory.push({ id: item.id, quantity: 1 });
        if (item.kind === "weapon" && (oldWeapon || !p.equippedWeapon)) {
            p.equippedWeapon = item.id; player.weapon = item.weaponType; p.ammo = item.weaponType === "gun" ? (item.ammo || GUN_MAGAZINE) : 0;
        }
        if (item.kind === "armor" && (oldArmor || !p.equippedArmor)) p.equippedArmor = item.id;
        if (item.kind === "pet" && !p.petId) p.petId = item.id;
        player.health = Math.min(getMaxHealth(player), player.health + Math.max(0, getMaxHealth(player) - oldMaxHealth));
        p.stamina = Math.min(getMaxStamina(player), p.stamina + Math.max(0, getMaxStamina(player) - oldMaxStamina));
    }
    p.coins = Math.max(0, p.coins + tradeInCoins - item.price);
    savePlayerProgress(player);
    sendTo(player, { type: "rpg_action_result", ok: true, message: `${item.name} alındı.${tradeInCoins ? ` Eski ekipman takası: +${tradeInCoins} coin.` : ""}` });
    sendRpgState(player); sendNeeds(player); broadcastPlayers();
}
function handleRpgEquip(player, data) {
    if (!player.inGame || !player.alive || !player.progress) return;
    const p = player.progress, slot = String(data && data.slot || ""), itemId = String(data && data.itemId || ""), item = itemId ? getCatalogItem(itemId) : null;
    if (slot === "weapon") {
        if (item && (item.kind !== "weapon" || !inventoryHas(p, item.id))) return;
        p.equippedWeapon = item ? item.id : null; player.weapon = item ? item.weaponType : "none";
        sendTo(player, { type: "weapon_equipped", weapon: player.weapon, ammo: p.ammo, magazine: GUN_MAGAZINE });
    } else if (slot === "armor") {
        if (item && (item.kind !== "armor" || !inventoryHas(p, item.id))) return;
        const oldMaxHealth = getMaxHealth(player), oldMaxStamina = getMaxStamina(player); p.equippedArmor = item ? item.id : null;
        player.health = Math.min(getMaxHealth(player), player.health + Math.max(0, getMaxHealth(player) - oldMaxHealth));
        p.stamina = Math.min(getMaxStamina(player), p.stamina + Math.max(0, getMaxStamina(player) - oldMaxStamina));
    } else if (slot === "pet") {
        if (item && (item.kind !== "pet" || !inventoryHas(p, item.id))) return;
        const oldMax = getMaxStamina(player); p.petId = item ? item.id : null;
        p.stamina = Math.min(getMaxStamina(player), p.stamina + Math.max(0, getMaxStamina(player) - oldMax));
    } else return;
    savePlayerProgress(player); sendRpgState(player); sendNeeds(player); broadcastPlayers();
}
function handleRpgUse(player, data) {
    if (!player.inGame || !player.alive || !player.progress) return;
    const p = player.progress, itemId = String(data && data.itemId || ""), item = getCatalogItem(itemId);
    if (!item || !['food', 'ammo'].includes(item.kind) || !inventoryHas(p, itemId)) { sendTo(player, { type: "rpg_action_result", ok: false, message: "Bu eşya çantanda yok." }); return; }
    const entry = p.inventory.find(value => value.id === itemId);
    if (item.kind === 'ammo') {
        if (player.weapon !== 'gun') { sendTo(player, { type: 'rpg_action_result', ok: false, message: 'Şarjör doldurmak için silahı kuşan.' }); return; }
        if (player.ammo >= GUN_MAGAZINE) { sendTo(player, { type: 'rpg_action_result', ok: false, message: 'Mevcut şarjörün zaten dolu.' }); return; }
        entry.quantity--;
        if (entry.quantity <= 0) p.inventory = p.inventory.filter(value => value.id !== itemId);
        player.ammo = GUN_MAGAZINE; p.ammo = player.ammo;
        savePlayerProgress(player);
        sendTo(player, { type: 'rpg_action_result', ok: true, message: 'Şarjör takıldı: 12 mermi hazır.' });
        sendTo(player, { type: 'weapon_result', ok: true, ammo: player.ammo, magazine: GUN_MAGAZINE });
        sendRpgState(player); return;
    }
    entry.quantity--;
    if (entry.quantity <= 0) p.inventory = p.inventory.filter(value => value.id !== itemId);
    player.hunger = clampNeed(player.hunger + (Number(item.hunger) || 0)); player.thirst = clampNeed(player.thirst + (Number(item.thirst) || 0));
    if (Number(item.stamina) > 0) p.stamina = Math.min(getMaxStamina(player), p.stamina + Number(item.stamina));
    if (item.buffs && Number(item.durationMs) > 0) {
        const expiresAt = Date.now() + Number(item.durationMs);
        for (const [key, multiplier] of Object.entries(item.buffs)) {
            const previous = p.buffs[key];
            p.buffs[key] = { expiresAt, multiplier: Math.max(Number(multiplier) || 1, previous && previous.expiresAt > Date.now() ? previous.multiplier : 1), label: item.name };
        }
    }
    savePlayerProgress(player); sendTo(player, { type: "rpg_action_result", ok: true, message: `${item.name} kullanıldı.` }); sendNeeds(player); sendRpgState(player);
}
function handleRpgStateRequest(player) { if (player.inGame) sendRpgState(player); }
function handlePetSelect(player, data) { handleRpgEquip(player, { slot: "pet", itemId: data && data.petId }); }

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
const MAX_WS_BUFFERED_BYTES = 256 * 1024;
const MOVE_MIN_INTERVAL_MS = 25;

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
        isSprinting: false,
        lastMoveAcceptedAt: 0,

        health: MAX_NEED,
        hunger: MAX_NEED,
        thirst: MAX_NEED,
        armor: 0,
        alive: true,
        progressKey: null,
        progress: createDefaultProgress(),
        lastStaminaUpdateAt: Date.now(),

        weapon: "none",
        ammo: GUN_MAGAZINE,
        nextRpgAttackAt: 0,
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
const HOSTILE_SAFE_RADIUS = Math.max(100, Number(RPG_DATA.enemySafeRadius) || 410);
function clampHostilePosition(x, z) {
    const distance = Math.hypot(x, z);
    if (distance <= HOSTILE_SAFE_RADIUS) return { x, z };
    const scale = HOSTILE_SAFE_RADIUS / distance;
    return { x: x * scale, z: z * scale };
}
function clampEnemyToZone(enemy, x, z) {
    const zone = RPG_DATA.enemyZones.find(value => value.id === enemy.zoneId);
    if (!zone) return clampHostilePosition(x, z);
    const leash = Math.max(4, Number(zone.radius) || 44) * 0.92;
    const dx = x - zone.x, dz = z - zone.z, distance = Math.hypot(dx, dz);
    if (distance <= leash) return clampHostilePosition(x, z);
    const scale = leash / distance;
    return clampHostilePosition(zone.x + dx * scale, zone.z + dz * scale);
}
function createHostileDonkeys() {
    const enemies = new Map();
    for (const zone of RPG_DATA.enemyZones) {
        for (let i = 0; i < zone.count; i++) {
            const angle = i * 2.399963229728653;
            const maxOffset = Math.min(22, (Number(zone.radius) || 36) * 0.52);
            const distance = 8 + (maxOffset - 8) * Math.sqrt((i + 1) / (zone.count + 1));
            const spawn = clampEnemyToZone({ zoneId: zone.id }, zone.x + Math.cos(angle) * distance, zone.z + Math.sin(angle) * distance);
            const id = `${zone.id}-donkey-${i + 1}`;
            const x = spawn.x, z = spawn.z;
            const maxHealth = Math.round(12 + zone.level * 0.72);
            enemies.set(id, { id, zoneId: zone.id, level: zone.level, name: zone.name, color: zone.color, armorColor: zone.armorColor, boss: false, spawnX: x, spawnZ: z, x, z, health: maxHealth, maxHealth, alive: true, respawnAt: 0, nextAttackAt: 0 });
        }
        if (zone.boss) {
            const spawn = clampEnemyToZone({ zoneId: zone.id }, zone.x, zone.z);
            const id = `${zone.id}-boss`, x = spawn.x, z = spawn.z;
            const maxHealth = Math.round(12 + zone.level * 0.72 + 90);
            enemies.set(id, { id, zoneId: zone.id, level: zone.level, name: zone.bossName || zone.name, color: zone.bossColor || zone.color, armorColor: zone.bossArmorColor || zone.armorColor, boss: true, spawnX: x, spawnZ: z, x, z, health: maxHealth, maxHealth, alive: true, respawnAt: 0, nextAttackAt: 0 });
        }
    }
    return enemies;
}
const hostileDonkeys = createHostileDonkeys();
function hostileDonkeyPublicState(enemy) {
    return { id: enemy.id, zoneId: enemy.zoneId, level: enemy.level, name: enemy.name, color: enemy.color, armorColor: enemy.armorColor, boss: enemy.boss, x: enemy.x, z: enemy.z, health: enemy.health, maxHealth: enemy.maxHealth, alive: enemy.alive, respawnAt: enemy.respawnAt };
}
function sendHostileDonkeyStates(player) {
    if (!player || !player.inGame) return;
    sendTo(player, { type: "hostile_donkeys", zones: RPG_DATA.enemyZones, enemies: Array.from(hostileDonkeys.values(), hostileDonkeyPublicState) });
}
function broadcastHostileDonkey(enemy) { broadcast({ type: "hostile_donkey_state", enemy: hostileDonkeyPublicState(enemy) }); }

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

function sendSerialized(ws, payload, dropIfBackedUp = false) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // Snapshot packets are replaced by the next tick, so don't queue stale positions
    // behind a slow connection. Reliable game events still use send().
    if (dropIfBackedUp && ws.bufferedAmount > MAX_WS_BUFFERED_BYTES) return;
    try {
        ws.send(payload);
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
        isSprinting: p.isSprinting,
        health: p.health,
        armor: p.armor,
        stamina: p.progress ? p.progress.stamina : 100,
        maxStamina: getMaxStamina(p),
        petId: p.progress ? p.progress.petId : null,
        level: p.progress ? getPlayerLevel(p.progress.xp) : 1,
        equippedArmor: p.progress ? p.progress.equippedArmor : null,
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
    const payload = JSON.stringify({ type: "players", players: obj, count });
    for (const p of players.values()) {
        if (!p.inGame) continue;
        sendSerialized(p.ws, payload, true);
    }
}

function broadcastOnlineCount() {
    const count = activePlayerCount();
    for (const p of players.values()) sendTo(p, { type: "online_count", count });
}

function sendNeeds(player) {
    const rpg = getRpgSnapshot(player);
    sendTo(player, {
        type: "needs",
        health: player.health,
        maxHealth: getMaxHealth(player),
        armor: player.armor,
        hunger: player.hunger,
        thirst: player.thirst,
        stamina: player.progress ? player.progress.stamina : 100,
        maxStamina: getMaxStamina(player),
        petId: player.progress ? player.progress.petId : null,
        xp: rpg.xp,
        level: rpg.level,
        xpInLevel: rpg.xpInLevel,
        xpToNext: rpg.xpToNext,
        coins: rpg.coins,
        buffs: rpg.buffs,
        speedMultiplier: rpg.stats.speedMultiplier,
        staminaRegenBuffMultiplier: rpg.stats.staminaRegenBuffMultiplier,
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

    if (isAccount && found) {
        player.progressKey = `account:${String(found.key).toLowerCase()}`;
    } else {
        const clientProgressId = String((data && data.progressId) || "").trim();
        const safeProgressId = /^[a-zA-Z0-9_-]{20,64}$/.test(clientProgressId) ? clientProgressId : player.id;
        const progressHash = crypto.createHash("sha256").update(safeProgressId).digest("hex").slice(0, 32);
        player.progressKey = `guest:${progressHash}`;
    }
    player.progress = loadProgressForKey(player.progressKey);
    player.progress.stamina = getMaxStamina(player);
    player.lastStaminaUpdateAt = Date.now();

    player.health = getMaxHealth(player);
    player.hunger = MAX_NEED;
    player.thirst = MAX_NEED;
    player.armor = 0;
    player.lastDamageAt = Date.now();

    player.x = SPAWN.x;
    player.y = SPAWN.y;
    player.z = SPAWN.z;
    player.yaw = 0;
    player.pitch = 0;

    const savedWeapon = getCatalogItem(player.progress.equippedWeapon);
    player.weapon = savedWeapon ? savedWeapon.weaponType : "none";
    player.ammo = player.progress.ammo;
    // Do not silently refill a spent magazine on reconnect; spare magazines live in inventory.
    player.nextRpgAttackAt = 0;
    player.nextBearBiteAt = 0;
    sendTo(player, {
        type: "join_accepted",
        state: {
            name: player.name,
            health: player.health,
            hunger: player.hunger,
            thirst: player.thirst,
            armor: player.armor,
            maxHealth: getMaxHealth(player),
            stamina: player.progress.stamina,
            maxStamina: getMaxStamina(player),
            petId: player.progress.petId
        }
    });

    sendRpgState(player);
    sendHostileDonkeyStates(player);

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
    const damage = Math.max(0, Number(amount) || 0) * getPetDamageTakenMultiplier(target);
    if (damage <= 0) return;
    target.lastDamageAt = Date.now();
    const armor = clampNeed(target.armor);
    if (armor > 0) {
        // Kalkan hasarı önce kendi dayanıklılığından karşılar; kalan hasar %50 azaltılarak cana gider.
        const absorbed = Math.min(armor, damage);
        const overflow = damage - absorbed;
        target.armor = clampNeed(armor - absorbed);
        target.health = Math.max(0, Math.min(getMaxHealth(target), target.health - overflow * 0.5));
    } else {
        target.health = Math.max(0, Math.min(getMaxHealth(target), target.health - damage));
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

    const now = Date.now();
    if (now - player.lastMoveAcceptedAt < MOVE_MIN_INTERVAL_MS) return;
    player.lastMoveAcceptedAt = now;
    const elapsed = Math.max(0, Math.min(0.35, (now - (player.lastStaminaUpdateAt || now)) / 1000));
    const sprintRequested = !!data.isSprinting && !!data.isMoving && !data.isCrouching;
    if (player.progress) {
        if (sprintRequested && player.progress.stamina > 0) {
            player.progress.stamina = Math.max(0, player.progress.stamina - 22 * getStaminaCostMultiplier(player) * elapsed);
        } else {
            player.progress.stamina = Math.min(getMaxStamina(player), player.progress.stamina + 12 * getStaminaRegenMultiplier(player) * elapsed);
        }
    }
    player.lastStaminaUpdateAt = now;

    if (typeof data.x === "number") player.x = data.x;
    if (typeof data.y === "number") player.y = data.y;
    if (typeof data.z === "number") player.z = data.z;
    if (typeof data.yaw === "number") player.yaw = data.yaw;
    if (typeof data.pitch === "number") player.pitch = data.pitch;

    player.isMoving = !!data.isMoving;
    player.isJumping = !!data.isJumping;
    player.isCrouching = !!data.isCrouching;
    player.isSprinting = sprintRequested && player.progress.stamina > 0;

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

function damageHostileDonkey(player, enemyId, baseDamage, weaponType) {
    if (!player.inGame || !player.alive || !player.progress) return false;
    const enemy = hostileDonkeys.get(String(enemyId || ""));
    if (!enemy || !enemy.alive) return false;
    const range = weaponType === "gun" ? 42 : weaponType === "sword" ? 7 : 5.5;
    if (Math.hypot(player.x - enemy.x, player.z - enemy.z) > range) return false;
    const now = Date.now(), cooldown = weaponType === "gun" ? 350 : weaponType === "sword" ? 480 : 650;
    if (now < player.nextRpgAttackAt) return false;
    player.nextRpgAttackAt = now + cooldown;
    const weapon = getCatalogItem(player.progress.equippedWeapon);
    const weaponMultiplier = weapon && weapon.weaponType === weaponType ? Number(weapon.damageMultiplier) || 1 : 1;
    enemy.health = Math.max(0, enemy.health - Math.max(0.5, Number(baseDamage) || 0) * getPetDamageMultiplier(player) * weaponMultiplier);
    if (enemy.health <= 0) {
        enemy.alive = false;
        enemy.respawnAt = now + RPG_DATA.respawnMs;
        const oldLevel = getPlayerLevel(player.progress.xp), levelGap = oldLevel - enemy.level;
        const xpScale = levelGap <= 0 ? 1.1 : Math.max(0.08, 1 - levelGap * 0.035);
        const coinScale = levelGap <= 0 ? 1 : Math.max(0.12, 1 - levelGap * 0.025);
        const earnedXp = Math.round(enemy.level * 5 * xpScale * (enemy.boss ? 2 : 1)), oldXp = player.progress.xp;
        const earnedCoins = Math.max(2, Math.round((4 + enemy.level * 2) * coinScale * (enemy.boss ? 3 : 1)));
        player.progress.xp = Math.min(totalXpForLevel(RPG_DATA.maxLevel), player.progress.xp + earnedXp);
        const xpGranted = player.progress.xp - oldXp;
        player.progress.coins = Math.min(999999999, player.progress.coins + earnedCoins);
        const newLevel = getPlayerLevel(player.progress.xp);
        savePlayerProgress(player);
        sendTo(player, { type: "rpg_reward", xp: xpGranted, coins: earnedCoins, enemyLevel: enemy.level, level: newLevel, levelUp: newLevel > oldLevel, message: `${enemy.boss ? "BOSS YENİLDİ! " : ""}Lv ${enemy.level} ${enemy.name} yenildi · +${xpGranted} XP · +${earnedCoins} coin` });
        if (newLevel > oldLevel) sendTo(player, { type: "rpg_level_up", level: newLevel, message: `Seviye atladın! Yeni seviyen ${newLevel}.` });
        sendNeeds(player); sendRpgState(player); broadcastPlayers();
    }
    broadcastHostileDonkey(enemy);
    return true;
}

function handleAttackAnimal(player, data) {
    if (!player.inGame || !player.alive) return;

    if (data && data.hostileDonkeyId) {
        damageHostileDonkey(player, data.hostileDonkeyId, FIST_DAMAGE, "fist");
        return;
    }

    const animalId = String((data && data.animalId) || "");
    if (!animalId) return;

    damageAnimal(animalId, ANIMAL_ATTACK_DAMAGE * getPetDamageMultiplier(player));
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
    sendTo(player, { type: 'ammo_pick_result', ok: false, ammo: player.ammo, message: 'Mermi kutusu artık ücretsiz değil. Tüccardan şarjör satın alıp çantandan kullan.' });
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
    state.health = Math.max(0, state.health - amount * getPetDamageMultiplier(player));
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
    if (!player.inGame || !player.alive || !player.progress) return;
    const weapon = String((data && data.weapon) || "none");
    if (weapon === "none") {
        player.weapon = "none";
        player.progress.equippedWeapon = null;
    } else {
        const owned = getCatalogItem(player.progress.equippedWeapon);
        if (!owned || owned.kind !== "weapon" || owned.weaponType !== weapon || !inventoryHas(player.progress, owned.id)) {
            sendTo(player, { type: "weapon_result", ok: false, message: "Önce tüccardan bu silahı almalısın." });
            return;
        }
        player.weapon = owned.weaponType;
        if (weapon === "gun") player.ammo = Math.max(0, Math.min(GUN_MAGAZINE, Number(player.progress.ammo) || 0));
    }
    if (weapon === "none") {
        player.weapon = "none";
    }
    player.progress.ammo = player.ammo;
    savePlayerProgress(player);
    sendTo(player, { type: "weapon_equipped", weapon: player.weapon, ammo: player.ammo, magazine: GUN_MAGAZINE });
    sendRpgState(player);
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
        player.progress.ammo = player.ammo;
        savePlayerProgress(player);
        sendTo(player, { type: "weapon_result", ok: true, ammo: player.ammo, magazine: GUN_MAGAZINE });
        const targetId = data.targetId ? String(data.targetId) : null;
        const targetAnimalId = data.targetAnimalId ? String(data.targetAnimalId) : null;
        const targetHunterId = data.targetHunterId ? String(data.targetHunterId) : null;
        const targetHostileDonkeyId = data.targetHostileDonkeyId ? String(data.targetHostileDonkeyId) : null;
        if (targetId) {
            const target = players.get(targetId);
            if (target && target.inGame && target.alive) damagePlayer(target, GUN_DAMAGE, player.id, player.name);
        } else if (targetHostileDonkeyId) {
            damageHostileDonkey(player, targetHostileDonkeyId, GUN_DAMAGE, "gun");
        } else if (targetAnimalId) {
            damageAnimal(targetAnimalId, GUN_DAMAGE * getPetDamageMultiplier(player));
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
        const targetHostileDonkeyId = data.targetHostileDonkeyId ? String(data.targetHostileDonkeyId) : null;

        if (targetId) {
            const target = players.get(targetId);
            if (target && target.inGame && target.alive) {
                damagePlayer(target, SWORD_DAMAGE, player.id, player.name);
            }
        } else if (targetHostileDonkeyId) {
            damageHostileDonkey(player, targetHostileDonkeyId, SWORD_DAMAGE, "sword");
        } else if (targetAnimalId) {
            damageAnimal(targetAnimalId, SWORD_DAMAGE * getPetDamageMultiplier(player));
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
    player.health = getMaxHealth(player);
    player.hunger = MAX_NEED;
    player.thirst = MAX_NEED;
    player.armor = 0;
    player.lastDamageAt = Date.now();
    if (player.progress) {
        player.progress.stamina = getMaxStamina(player);
    }

    player.x = SPAWN.x;
    player.y = SPAWN.y;
    player.z = SPAWN.z;

    sendTo(player, {
        type: "respawned",
        spawn: { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z },
        state: {
            health: player.health, maxHealth: getMaxHealth(player), armor: player.armor, hunger: player.hunger, thirst: player.thirst,
            stamina: player.progress ? player.progress.stamina : 100,
            maxStamina: getMaxStamina(player), petId: player.progress ? player.progress.petId : null
        }
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

            case "hostile_donkeys_request":
                sendHostileDonkeyStates(player);
                break;

            case "rpg_state_request":
                handleRpgStateRequest(player);
                break;

            case "rpg_shop_request":
                handleRpgShopRequest(player);
                break;

            case "rpg_buy":
                handleRpgBuy(player, data);
                break;

            case "rpg_equip":
                handleRpgEquip(player, data);
                break;

            case "rpg_use":
                handleRpgUse(player, data);
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

            case "pet_select":
                handlePetSelect(player, data);
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

// Pozisyon yayını (~100ms); istemcilerdeki enterpolasyon hareketi yumuşatır.
setInterval(() => {
    if (activePlayerCount() > 0) broadcastPlayers();
}, 100);

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

// Düşman eşekler sunucu tarafından hareket ettirilir; ölümden 10 saniye sonra aynı bölgede canlanırlar.
setInterval(() => {
    const now = Date.now();
    for (const enemy of hostileDonkeys.values()) {
        if (!enemy.alive) {
            if (enemy.respawnAt && now >= enemy.respawnAt) {
                enemy.alive = true; enemy.health = enemy.maxHealth; enemy.respawnAt = 0; enemy.nextAttackAt = now + 900;
                enemy.x = enemy.spawnX; enemy.z = enemy.spawnZ; broadcastHostileDonkey(enemy);
            }
            continue;
        }
        const elapsed = Math.max(0.05, Math.min(0.5, (now - (enemy.lastAiAt || now - 250)) / 1000));
        enemy.lastAiAt = now;
        let target = null, bestDistance = 12 + Math.min(100, enemy.level) * 0.13;
        for (const player of players.values()) {
            if (!player.inGame || !player.alive) continue;
            const distance = Math.hypot(player.x - enemy.x, player.z - enemy.z);
            const zone = RPG_DATA.enemyZones.find(value => value.id === enemy.zoneId);
            const insideZone = zone && Math.hypot(player.x - zone.x, player.z - zone.z) <= (Number(zone.radius) || 44);
            if (insideZone && distance < bestDistance) { bestDistance = distance; target = player; }
        }
        let moved = false;
        if (target && bestDistance > 3.2) {
            const pursuitSpeed = (5.8 + enemy.level * 0.022) * (enemy.boss ? 1.18 : 1);
            const scaledStep = Math.min(bestDistance - 2.8, pursuitSpeed * elapsed);
            const next = clampEnemyToZone(enemy, enemy.x + (target.x - enemy.x) / bestDistance * scaledStep, enemy.z + (target.z - enemy.z) / bestDistance * scaledStep);
            moved = Math.hypot(next.x - enemy.x, next.z - enemy.z) > 0.01;
            enemy.x = next.x; enemy.z = next.z;
        } else if (target && now >= enemy.nextAttackAt) {
            enemy.nextAttackAt = now + 1800;
            damagePlayer(target, (1.4 + enemy.level * 0.025) * (enemy.boss ? 1.65 : 1), null, enemy.name, `${enemy.name} saldırdı.`);
        } else if (!target) {
            const homeDistance = Math.hypot(enemy.spawnX - enemy.x, enemy.spawnZ - enemy.z);
            if (homeDistance > 1) {
                const step = Math.min(homeDistance, 1.35 * elapsed);
                const next = clampEnemyToZone(enemy, enemy.x + (enemy.spawnX - enemy.x) / homeDistance * step, enemy.z + (enemy.spawnZ - enemy.z) / homeDistance * step);
                moved = Math.hypot(next.x - enemy.x, next.z - enemy.z) > 0.01;
                enemy.x = next.x; enemy.z = next.z;
            }
        }
        if (moved) broadcastHostileDonkey(enemy);
    }
}, 250);

// İhtiyaç azalması ve hasar kesildikten sonra sağlık yenilenmesi (2 sn'de bir).
setInterval(() => {
    const now = Date.now();
    for (const p of players.values()) {
        if (!p.inGame || !p.alive) continue;
        const armor = getArmorItem(p.progress);
        const regenerating = p.health < getMaxHealth(p) && now - (p.lastDamageAt || 0) >= 5000 && p.hunger > 0 && p.thirst > 0;
        const needDrain = regenerating ? 0.06 : 0.03;
        p.hunger = clampNeed(p.hunger - needDrain * (armor ? Number(armor.hungerDrainMultiplier) || 1 : 1));
        p.thirst = clampNeed(p.thirst - (regenerating ? 0.08 : 0.04) * (armor ? Number(armor.thirstDrainMultiplier) || 1 : 1));
        if (regenerating) p.health = Math.min(getMaxHealth(p), p.health + 0.5);
        if (p.hunger <= 0 || p.thirst <= 0) {
            p.health = Math.max(0, p.health - 0.1);
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
