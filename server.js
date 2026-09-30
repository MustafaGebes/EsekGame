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
        username.length <= 24 &&
        /^[a-zA-Z0-9_ğüşöçıİĞÜŞÖÇ -]+$/.test(username)
    );
}

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
        return res.status(400).json({ ok: false, error: "Kullanıcı adı 3-24 karakter olmalı." });
    }
    if (password.length < 4) {
        return res.status(400).json({ ok: false, error: "Şifre en az 4 karakter olmalı." });
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
