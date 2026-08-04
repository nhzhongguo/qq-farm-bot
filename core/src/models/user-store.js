const fs = require('fs');
const { getDataFile, ensureDataDir } = require('../config/runtime-paths');
const { writeJsonFileAtomic, writeTextFileAtomic, createDebouncedWriter, flushWritersFor } = require('../services/json-db');
const crypto = require('crypto');

const USERS_FILE = getDataFile('users.json');
const CARDS_FILE = getDataFile('cards.json');
const LOGIN_ATTEMPTS_FILE = getDataFile('login-attempts.json');
const LOGIN_LOGS_FILE = getDataFile('login-logs.json');
const CARD_CLAIM_FILE = getDataFile('card-claim.json');
const CARD_LOGS_FILE = getDataFile('card-logs.json');

const DEFAULT_ACCOUNT_LIMIT = 2;

let cardClaimEnabled = false;
let cardClaimRecords = [];
let cardLogs = [];

const SALT_LENGTH = 32;
const ITERATIONS = 100000;
const KEY_LENGTH = 64;
const DIGEST = 'sha512';

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000;
const RATE_LIMIT_WINDOW = 60 * 1000;
const MAX_ATTEMPTS_PER_IP = 10;
const CARD_CLAIM_WINDOW_MS = 24 * 60 * 60 * 1000;

function readJsonWithBackup(filePath, fallback) {
    ensureDataDir();
    const backupPath = `${filePath}.bak`;

    if (fs.existsSync(filePath)) {
        try {
            const mainRaw = fs.readFileSync(filePath, 'utf8');
            const data = JSON.parse(mainRaw);
            if (!fs.existsSync(backupPath)) {
                writeTextFileAtomic(backupPath, mainRaw);
            }
            return data;
        } catch (mainError) {
            if (!fs.existsSync(backupPath)) {
                throw new Error(`数据文件损坏且没有可用备份: ${filePath} (${mainError.message})`);
            }
            try {
                const backupRaw = fs.readFileSync(backupPath, 'utf8');
                const recovered = JSON.parse(backupRaw);
                writeTextFileAtomic(filePath, backupRaw);
                console.warn(`[数据恢复] 已从备份恢复: ${filePath}`);
                return recovered;
            } catch (backupError) {
                throw new Error(`数据文件及备份均损坏: ${filePath} (${backupError.message})`);
            }
        }
    }

    if (fs.existsSync(backupPath)) {
        const backupRaw = fs.readFileSync(backupPath, 'utf8');
        const recovered = JSON.parse(backupRaw);
        writeTextFileAtomic(filePath, backupRaw);
        console.warn(`[数据恢复] 主文件缺失，已从备份恢复: ${filePath}`);
        return recovered;
    }

    return fallback;
}

function writeJsonWithBackup(filePath, data) {
    ensureDataDir();
    const backupPath = `${filePath}.bak`;
    // 1) Snapshot the previous good main file first (helps if process dies mid-write).
    // 2) After the new main is written, refresh .bak to the latest good content
    //    so later main-file corruption can still recover the newest state.
    if (fs.existsSync(filePath)) {
        try {
            const currentRaw = fs.readFileSync(filePath, 'utf8');
            JSON.parse(currentRaw);
            writeTextFileAtomic(backupPath, currentRaw);
        } catch {
            // Main file is unreadable; keep any existing backup untouched.
        }
    }
    writeJsonFileAtomic(filePath, data);
    writeJsonFileAtomic(backupPath, data);
}

let loginAttempts = {};
let loginLogs = [];

function loadLoginLogs() {
    try {
        const data = readJsonWithBackup(LOGIN_LOGS_FILE, { logs: [] });
        loginLogs = Array.isArray(data.logs) ? data.logs : [];
    } catch {
        loginLogs = [];
    }
}

function saveLoginLogs() {
    try {
        ensureDataDir();
        const maxLogs = 1000;
        const logsToSave = loginLogs.slice(-maxLogs);
        writeJsonWithBackup(LOGIN_LOGS_FILE, { logs: logsToSave });
    } catch (e) {
        console.error('保存登录日志失败:', e.message);
    }
}

function addLoginLog(entry) {
    loadLoginLogs();
    const logEntry = {
        id: Date.now() + Math.random().toString(36).substr(2, 9),
        timestamp: Date.now(),
        ...entry
    };
    loginLogs.push(logEntry);
    if (loginLogs.length > 1000) {
        loginLogs = loginLogs.slice(-1000);
    }
    // 登录日志为高频追加型数据，合并写入减少同步 IO
    loginLogsWriter.schedule();
    return logEntry;
}

// 登录日志合并写入器（500ms 窗口）
const loginLogsWriter = createDebouncedWriter(() => {
    saveLoginLogs();
}, 500, LOGIN_LOGS_FILE);

function getLoginLogs(limit = 100, offset = 0) {
    // 读取前先落盘，保证读到最新记录
    flushWritersFor(LOGIN_LOGS_FILE);
    loadLoginLogs();
    const sorted = [...loginLogs].sort((a, b) => b.timestamp - a.timestamp);
    return {
        logs: sorted.slice(offset, offset + limit),
        total: loginLogs.length
    };
}

function clearLoginLogs() {
    flushWritersFor(LOGIN_LOGS_FILE);
    loginLogs = [];
    saveLoginLogs();
    return { ok: true };
}

function loadLoginAttempts() {
    try {
        const data = readJsonWithBackup(LOGIN_ATTEMPTS_FILE, {});
        loginAttempts = data || {};
    } catch {
        loginAttempts = {};
    }
}

function saveLoginAttempts() {
    try {
        ensureDataDir();
        writeJsonWithBackup(LOGIN_ATTEMPTS_FILE, loginAttempts);
    } catch (e) {
        console.error('保存登录尝试记录失败:', e.message);
    }
}

function cleanExpiredAttempts() {
    const now = Date.now();
    let cleaned = false;
    
    for (const key of Object.keys(loginAttempts)) {
        const attempt = loginAttempts[key];
        if (attempt.lockedUntil && attempt.lockedUntil < now) {
            delete loginAttempts[key];
            cleaned = true;
        } else if (attempt.windowStart && (now - attempt.windowStart) > RATE_LIMIT_WINDOW) {
            delete loginAttempts[key];
            cleaned = true;
        }
    }
    
    if (cleaned) saveLoginAttempts();
}

function checkRateLimit(ip) {
    cleanExpiredAttempts();
    const ipKey = `ip:${ip}`;
    const now = Date.now();
    
    if (!loginAttempts[ipKey]) {
        loginAttempts[ipKey] = { count: 1, windowStart: now };
        saveLoginAttempts();
        return { allowed: true };
    }
    
    const attempt = loginAttempts[ipKey];
    
    if (now - attempt.windowStart > RATE_LIMIT_WINDOW) {
        loginAttempts[ipKey] = { count: 1, windowStart: now };
        saveLoginAttempts();
        return { allowed: true };
    }
    
    if (attempt.count >= MAX_ATTEMPTS_PER_IP) {
        const remainingMs = RATE_LIMIT_WINDOW - (now - attempt.windowStart);
        return { 
            allowed: false, 
            remainingMs,
            message: `请求过于频繁，请 ${Math.ceil(remainingMs / 1000)} 秒后重试`
        };
    }
    
    attempt.count++;
    saveLoginAttempts();
    return { allowed: true };
}

function checkAccountLockout(username) {
    cleanExpiredAttempts();
    const userKey = `user:${username}`;
    const now = Date.now();
    
    if (loginAttempts[userKey] && loginAttempts[userKey].lockedUntil) {
        if (loginAttempts[userKey].lockedUntil > now) {
            const remainingMs = loginAttempts[userKey].lockedUntil - now;
            return {
                locked: true,
                remainingMs,
                message: `账户已被锁定，请 ${Math.ceil(remainingMs / 1000 / 60)} 分钟后重试`
            };
        } else {
            delete loginAttempts[userKey];
            saveLoginAttempts();
        }
    }
    
    return { locked: false };
}

function recordFailedAttempt(username) {
    const userKey = `user:${username}`;
    const now = Date.now();
    
    if (!loginAttempts[userKey]) {
        loginAttempts[userKey] = { count: 1, firstAttempt: now };
    } else {
        loginAttempts[userKey].count++;
        loginAttempts[userKey].lastAttempt = now;
    }
    
    if (loginAttempts[userKey].count >= MAX_LOGIN_ATTEMPTS) {
        loginAttempts[userKey].lockedUntil = now + LOCKOUT_DURATION;
        saveLoginAttempts();
        return {
            locked: true,
            message: `登录失败次数过多，账户已被锁定 ${LOCKOUT_DURATION / 60000} 分钟`
        };
    }
    
    saveLoginAttempts();
    return {
        locked: false,
        remainingAttempts: MAX_LOGIN_ATTEMPTS - loginAttempts[userKey].count
    };
}

function clearFailedAttempts(username) {
    const userKey = `user:${username}`;
    if (loginAttempts[userKey]) {
        delete loginAttempts[userKey];
        saveLoginAttempts();
    }
}

function validatePasswordStrength(password) {
    const errors = [];
    
    if (password.length < 6) {
        errors.push('密码长度至少6位');
    }
    
    if (password.length > 128) {
        errors.push('密码长度不能超过128位');
    }
    
    let typeCount = 0;
    if (/[a-z]/.test(password)) typeCount++;
    if (/[A-Z]/.test(password)) typeCount++;
    if (/\d/.test(password)) typeCount++;
    if (/[!@#$%^&*(),.?":{}|<>_\-+=[\]\\;'/`~]/.test(password)) typeCount++;
    
    if (typeCount < 2) {
        errors.push('密码必须包含大写字母、小写字母、数字、特殊符号中的至少两种');
    }
    
    const commonPasswords = [
        'password', '123456', 'qwerty', 'abc123', '111111', '000000'
    ];
    if (commonPasswords.includes(password.toLowerCase())) {
        errors.push('密码过于简单，请使用更复杂的密码');
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}

function hashPassword(password, salt = null) {
    if (!salt) {
        salt = crypto.randomBytes(SALT_LENGTH).toString('hex');
    }
    
    const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
    return `${salt}:${hash}`;
}

function safeEqualHex(a, b) {
    const left = Buffer.from(String(a || ''), 'utf8');
    const right = Buffer.from(String(b || ''), 'utf8');
    if (left.length !== right.length) {
        // Keep comparison work roughly constant-time for mismatched lengths.
        const dummy = Buffer.alloc(left.length || 1);
        crypto.timingSafeEqual(dummy, dummy);
        return false;
    }
    return crypto.timingSafeEqual(left, right);
}

function verifyPassword(password, storedPassword) {
    if (storedPassword.includes(':')) {
        const [salt, hash] = storedPassword.split(':');
        const newHash = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
        return safeEqualHex(hash, newHash);
    } else {
        const legacyHash = crypto.createHash('sha256').update(password).digest('hex');
        return safeEqualHex(storedPassword, legacyHash);
    }
}

function needsRehash(storedPassword) {
    return !storedPassword.includes(':');
}

const generateCardCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 16; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
};

let users = [];
let cards = [];

function loadUsers() {
    const data = readJsonWithBackup(USERS_FILE, { users: [] });
    if (!data || !Array.isArray(data.users)) {
        throw new Error(`用户数据格式无效: ${USERS_FILE}`);
    }
    users = data.users;
}

function saveUsers() {
    try {
        writeJsonWithBackup(USERS_FILE, { users });
    } catch (e) {
        console.error('保存用户数据失败:', e.message);
        throw e;
    }
}

function loadCards() {
    const data = readJsonWithBackup(CARDS_FILE, { cards: [] });
    if (!data || !Array.isArray(data.cards)) {
        throw new Error(`卡密数据格式无效: ${CARDS_FILE}`);
    }
    cards = data.cards;
}

function saveCards() {
    try {
        writeJsonWithBackup(CARDS_FILE, { cards });
    } catch (e) {
        console.error('保存卡密数据失败:', e.message);
        throw e;
    }
}

function initDefaultAdmin() {
    loadUsers();
    const adminExists = users.find(u => u.username === 'admin');
    if (!adminExists) {
        const defaultPassword = 'admin';
        users.push({
            username: 'admin',
            password: hashPassword(defaultPassword),
            role: 'admin',
            mustChangePassword: true,
            createdAt: Date.now()
        });
        saveUsers();
        console.log('[用户系统] 已创建默认管理员账号，默认密码: admin');
    } else if (verifyPassword('admin', adminExists.password) && adminExists.mustChangePassword !== true) {
        adminExists.mustChangePassword = true;
        saveUsers();
        console.warn('[用户系统] 检测到默认管理员密码，登录后必须修改密码');
    }
}

function validateUser(username, password, ip = 'unknown') {
    loadUsers();
    loadLoginAttempts();
    
    const rateLimitResult = checkRateLimit(ip);
    if (!rateLimitResult.allowed) {
        return { 
            error: 'rate_limit', 
            message: rateLimitResult.message,
            remainingMs: rateLimitResult.remainingMs
        };
    }
    
    const lockoutResult = checkAccountLockout(username);
    if (lockoutResult.locked) {
        return { 
            error: 'locked', 
            message: lockoutResult.message,
            remainingMs: lockoutResult.remainingMs
        };
    }
    
    const user = users.find(u => u.username === username);
    if (!user) {
        recordFailedAttempt(username);
        return { error: 'invalid_credentials', message: '用户名或密码错误' };
    }
    
    if (!verifyPassword(password, user.password)) {
        const attemptResult = recordFailedAttempt(username);
        if (attemptResult.locked) {
            return { 
                error: 'locked', 
                message: attemptResult.message 
            };
        }
        return { 
            error: 'invalid_credentials', 
            message: `用户名或密码错误，剩余尝试次数: ${attemptResult.remainingAttempts}` 
        };
    }
    
    clearFailedAttempts(username);
    
    if (needsRehash(user.password)) {
        user.password = hashPassword(password);
        saveUsers();
        console.log(`[安全] 用户 ${username} 密码已升级为新哈希算法`);
    }
    
    return {
        username: user.username,
        role: user.role,
        cardCode: user.cardCode || null,
        card: user.card || null,
        accountLimit: user.accountLimit || DEFAULT_ACCOUNT_LIMIT,
        pushLimit: user.pushLimit || 50,
        operationRateLimit: user.operationRateLimit || 30,
        mustChangePassword: user.mustChangePassword === true
    };
}


// 测试阶段：仅按用户名签发会话，跳过密码但保留强制改密标记。
function validateUserWithoutPassword(username, ip = 'unknown') {
    loadUsers();
    loadLoginAttempts();

    const rateLimitResult = checkRateLimit(ip);
    if (!rateLimitResult.allowed) {
        return {
            error: 'rate_limit',
            message: rateLimitResult.message,
            remainingMs: rateLimitResult.remainingMs,
        };
    }

    const user = users.find(u => u.username === username);
    if (!user) {
        return { error: 'invalid_credentials', message: '用户不存在' };
    }

    clearFailedAttempts(username);

    return {
        username: user.username,
        role: user.role,
        cardCode: user.cardCode || null,
        card: user.card || null,
        accountLimit: user.accountLimit || DEFAULT_ACCOUNT_LIMIT,
        mustChangePassword: user.mustChangePassword === true,
    };
}

function registerUser(username, password, cardCode) {
    loadUsers();
    loadCards();

    if (!username || username.length < 3 || username.length > 32) {
        return { ok: false, error: '用户名长度需在3-32位之间' };
    }

    if (!/^\w+$/.test(username)) {
        return { ok: false, error: '用户名只能包含字母、数字和下划线' };
    }

    if (users.find(u => u.username === username)) {
        return { ok: false, error: '用户名已存在' };
    }

    const passwordValidation = validatePasswordStrength(password);
    if (!passwordValidation.valid) {
        return { ok: false, error: passwordValidation.errors.join('；') };
    }

    const card = cards.find(c => c.code === cardCode);
    if (!card) {
        return { ok: false, error: '卡密不存在' };
    }

    if (!card.enabled) {
        return { ok: false, error: '卡密已被禁用' };
    }

    if (card.usedBy) {
        return { ok: false, error: '卡密已被使用' };
    }

    const cardType = card.type || 'time';
    if (cardType === 'quota') {
        return { ok: false, error: '注册只能使用时间卡密，额度卡密请登录后在续费中使用' };
    }

    const now = Date.now();
    
    const newUser = {
        username,
        password: hashPassword(password),
        role: 'user',
        cardCode,
        card: {
            code: card.code,
            description: card.description,
            days: card.days,
            expiresAt: card.days === -1 ? null : (now + card.days * 24 * 60 * 60 * 1000),
            enabled: true
        },
        accountLimit: DEFAULT_ACCOUNT_LIMIT,
        createdAt: now
    };

    users.push(newUser);
    card.usedBy = username;
    card.usedAt = now;
    delete card.claimedAt;
    delete card.claimIdentityHash;

    saveUsers();
    saveCards();
    
    clearFailedAttempts(username);

    addCardLog({
        action: 'register',
        username: newUser.username,
        cardCode: card.code,
        cardType,
        days: card.days,
        at: now
    });

    return { ok: true, user: { username: newUser.username, role: newUser.role, card: newUser.card, accountLimit: newUser.accountLimit } };
}

function renewUser(username, cardCode) {
    loadUsers();
    loadCards();

    const user = users.find(u => u.username === username);
    if (!user) {
        return { ok: false, error: '用户不存在' };
    }

    const card = cards.find(c => c.code === cardCode);
    if (!card) {
        return { ok: false, error: '卡密不存在' };
    }

    if (!card.enabled) {
        return { ok: false, error: '卡密已被禁用' };
    }

    if (card.usedBy) {
        return { ok: false, error: '卡密已被使用' };
    }

    const now = Date.now();
    const cardType = card.type || 'time';
    
    if (cardType === 'quota') {
        // 额度卡密：增加账号额度
        const currentLimit = user.accountLimit || DEFAULT_ACCOUNT_LIMIT;
        user.accountLimit = currentLimit + card.days;
    } else {
        // 时间卡密：增加使用时长
        // 确保用户有card对象
        if (!user.card) {
            user.card = {
                code: card.code,
                description: card.description,
                days: 0,
                expiresAt: null,
                enabled: true
            };
        }
        
        const currentExpires = user.card.expiresAt || 0;
        const currentDays = user.card.days || 0;
        
        // days为-1表示永久
        if (card.days === -1) {
            // 永久卡，设置为永久
            user.card.expiresAt = null;
            user.card.days = -1;
        } else if (user.card.days === -1) {
            // 已经是永久，保持永久
            user.card.expiresAt = null;
        } else {
            // 累加天数
            user.card.days = currentDays + card.days;
            
            // 计算新的过期时间
            if (currentExpires && currentExpires > now) {
                // 未过期，在当前过期时间基础上增加
                user.card.expiresAt = currentExpires + card.days * 24 * 60 * 60 * 1000;
            } else {
                // 已过期或无过期时间，从现在开始计算
                user.card.expiresAt = now + card.days * 24 * 60 * 60 * 1000;
            }
        }
    }

    // 标记卡密已使用
    card.usedBy = username;
    card.usedAt = now;
    delete card.claimedAt;
    delete card.claimIdentityHash;

    saveUsers();
    saveCards();

    addCardLog({
        action: 'renew',
        username,
        cardCode: card.code,
        cardType,
        days: card.days,
        at: now
    });

    return { ok: true, card: user.card, accountLimit: user.accountLimit || DEFAULT_ACCOUNT_LIMIT, cardType };
}

function getAllUsers() {
    loadUsers();
    return users.map(u => ({
        username: u.username,
        role: u.role,
        card: u.card,
        accountLimit: u.accountLimit || DEFAULT_ACCOUNT_LIMIT
    }));
}

function updateUser(username, updates) {
    loadUsers();
    const user = users.find(u => u.username === username);
    if (!user) return null;

    if (updates.expiresAt !== undefined) {
        if (!user.card) user.card = {};
        user.card.expiresAt = updates.expiresAt;
    }

    if (updates.enabled !== undefined) {
        if (!user.card) user.card = {};
        user.card.enabled = updates.enabled;
    }

    saveUsers();

    return { username: user.username, role: user.role, card: user.card, accountLimit: user.accountLimit || DEFAULT_ACCOUNT_LIMIT, pushLimit: user.pushLimit || 50, operationRateLimit: user.operationRateLimit || 30 };
}

function editUser(oldUsername, updates) {
    loadUsers();
    
    const user = users.find(u => u.username === oldUsername);
    if (!user) {
        return { ok: false, error: '用户不存在' };
    }

    if (updates.newUsername && updates.newUsername !== oldUsername) {
        if (!/^\w{3,32}$/.test(updates.newUsername)) {
            return { ok: false, error: '用户名只能包含字母、数字和下划线，长度3-32位' };
        }
        const existingUser = users.find(u => u.username === updates.newUsername);
        if (existingUser) {
            return { ok: false, error: '用户名已存在' };
        }
        user.username = updates.newUsername;
    }

    if (updates.password) {
        const passwordValidation = validatePasswordStrength(updates.password);
        if (!passwordValidation.valid) {
            return { ok: false, error: passwordValidation.errors.join('；') };
        }
        user.password = hashPassword(updates.password);
    }

    if (updates.accountLimit !== undefined) {
        user.accountLimit = Number.parseInt(updates.accountLimit, 10) || DEFAULT_ACCOUNT_LIMIT;
    }

    if (updates.pushLimit !== undefined) {
        user.pushLimit = Math.max(0, Number.parseInt(updates.pushLimit, 10) || 50);
    }

    if (updates.operationRateLimit !== undefined) {
        user.operationRateLimit = Math.max(0, Number.parseInt(updates.operationRateLimit, 10) || 30);
    }

    if (updates.isPermanent) {
        if (!user.card) user.card = {};
        user.card.days = -1;
        user.card.expiresAt = null;
    } else if (updates.expiresAt !== undefined) {
        if (!user.card) user.card = {};
        if (updates.expiresAt === null) {
            user.card.days = 0;
            user.card.expiresAt = null;
        } else {
            const now = Date.now();
            const expiresAt = Number.parseInt(updates.expiresAt, 10);
            user.card.expiresAt = expiresAt;
            const diffMs = expiresAt - now;
            const diffDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
            user.card.days = diffDays > 0 ? diffDays : 0;
        }
    }

    saveUsers();

    return { 
        ok: true, 
        user: { 
            username: user.username, 
            role: user.role, 
            card: user.card, 
            accountLimit: user.accountLimit || DEFAULT_ACCOUNT_LIMIT 
        } 
    };
}

function getAllCards() {
    loadCards();
    return cards;
}

function createCard(description, days, type = 'time') {
    loadCards();

    const newCard = {
        code: generateCardCode(),
        description,
        days: Number.parseInt(days, 10) || 30,
        type: type === 'quota' ? 'quota' : 'time',
        enabled: true,
        usedBy: null,
        usedAt: null,
        createdAt: Date.now()
    };

    cards.push(newCard);
    saveCards();

    return newCard;
}

function createCardsBatch(description, days, count, type = 'time') {
    loadCards();

    const createdCards = [];
    const daysNum = Number.parseInt(days, 10) || 30;
    const countNum = Math.min(Math.max(Number.parseInt(count, 10) || 1, 1), 100);
    const cardType = type === 'quota' ? 'quota' : 'time';

    for (let i = 0; i < countNum; i++) {
        const newCard = {
            code: generateCardCode(),
            description,
            days: daysNum,
            type: cardType,
            enabled: true,
            usedBy: null,
            usedAt: null,
            createdAt: Date.now()
        };
        cards.push(newCard);
        createdCards.push(newCard);
    }

    saveCards();

    return createdCards;
}

function updateCard(code, updates) {
    loadCards();
    const card = cards.find(c => c.code === code);
    if (!card) return null;

    if (updates.description !== undefined) {
        card.description = updates.description;
    }

    if (updates.enabled !== undefined) {
        card.enabled = updates.enabled;
    }

    saveCards();
    return card;
}

function deleteCard(code) {
    loadCards();
    const idx = cards.findIndex(c => c.code === code);
    if (idx === -1) return false;

    cards.splice(idx, 1);
    saveCards();
    return true;
}

function deleteCardsBatch(codes) {
    loadCards();
    if (!Array.isArray(codes) || codes.length === 0) {
        return { ok: false, error: '请提供要删除的卡密列表' };
    }

    let deletedCount = 0;
    const notFoundCodes = [];

    for (const code of codes) {
        const idx = cards.findIndex(c => c.code === code);
        if (idx !== -1) {
            cards.splice(idx, 1);
            deletedCount++;
        } else {
            notFoundCodes.push(code);
        }
    }

    saveCards();
    return {
        ok: true,
        deletedCount,
        notFoundCount: notFoundCodes.length,
        notFoundCodes: notFoundCodes.length > 0 ? notFoundCodes : undefined
    };
}

function deleteUser(username, forceDeleteAdmin = false) {
    loadUsers();
    const idx = users.findIndex(u => u.username === username);
    if (idx === -1) return { ok: false, error: '用户不存在' };

    // 不允许删除管理员账号（除非强制删除）
    if (!forceDeleteAdmin && users[idx].role === 'admin') {
        return { ok: false, error: '不能删除管理员账号' };
    }

    users.splice(idx, 1);
    saveUsers();
    return { ok: true };
}

function changePassword(username, oldPassword, newPassword) {
    loadUsers();
    const user = users.find(u => u.username === username);
    if (!user) {
        return { ok: false, error: '用户不存在' };
    }

    if (!verifyPassword(oldPassword, user.password)) {
        return { ok: false, error: '当前密码错误' };
    }

    const passwordValidation = validatePasswordStrength(newPassword);
    if (!passwordValidation.valid) {
        return { ok: false, error: passwordValidation.errors.join('；') };
    }

    user.password = hashPassword(newPassword);
    if (user.mustChangePassword) {
        delete user.mustChangePassword;
    }

    saveUsers();
    return { ok: true, message: '密码修改成功' };
}

initDefaultAdmin();

// ============ 卡密领取功能 ============
function loadCardClaimRecords() {
    try {
        const data = readJsonWithBackup(CARD_CLAIM_FILE, { enabled: true, records: [] });
        cardClaimEnabled = data.enabled === true;
        cardClaimRecords = Array.isArray(data.records) ? data.records : [];
    } catch (e) {
        console.error('加载卡密领取记录失败:', e.message);
        throw e;
    }
}

function saveCardClaimRecords() {
    try {
        writeJsonWithBackup(CARD_CLAIM_FILE, {
            enabled: cardClaimEnabled,
            records: cardClaimRecords
        });
    } catch (e) {
        console.error('保存卡密领取记录失败:', e.message);
        throw e;
    }
}

function getCardClaimStatus() {
    loadCardClaimRecords();
    return { enabled: cardClaimEnabled };
}

function setCardClaimStatus(enabled) {
    loadCardClaimRecords();
    cardClaimEnabled = !!enabled;
    saveCardClaimRecords();
    return { enabled: cardClaimEnabled };
}

function checkUAClaimLimit(identity) {
    loadCardClaimRecords();
    const now = Date.now();
    const identityHash = crypto.createHash('sha256').update(identity).digest('hex');
    
    const record = cardClaimRecords.find(r => r.identityHash === identityHash || r.uaHash === identityHash);
    if (record) {
        const elapsed = now - record.claimTime;
        if (elapsed < CARD_CLAIM_WINDOW_MS) {
            const remainingMs = CARD_CLAIM_WINDOW_MS - elapsed;
            return {
                allowed: false,
                remainingMs,
                message: '您已经在24小时内领取过一次卡密了！'
            };
        }
    }
    
    return { allowed: true };
}

function releaseExpiredCardReservations(now = Date.now()) {
    let changed = false;
    for (const card of cards) {
        if (!card.usedBy && card.claimedAt && now - card.claimedAt >= CARD_CLAIM_WINDOW_MS) {
            delete card.claimedAt;
            delete card.claimIdentityHash;
            changed = true;
        }
    }
    if (changed) saveCards();
}

function claimCardByUA(identity, username = null) {
    loadCards();
    loadCardClaimRecords();
    releaseExpiredCardReservations();
    
    if (!cardClaimEnabled) {
        return { ok: false, error: '卡密领取功能未开启' };
    }
    
    const uaCheck = checkUAClaimLimit(identity);
    if (!uaCheck.allowed) {
        return { ok: false, error: uaCheck.message, remainingMs: uaCheck.remainingMs };
    }
    
    const unusedTimeCards = cards.filter(c => 
        // Legacy cards may omit type; treat missing type as time cards.
        (c.type === 'time' || !c.type) &&
        !c.usedBy && 
        !c.claimedAt &&
        c.enabled
    );
    
    if (unusedTimeCards.length === 0) {
        return { ok: false, error: '卡密库存不足，请联系管理员！' };
    }
    
    const randomIndex = Math.floor(Math.random() * unusedTimeCards.length);
    const selectedCard = unusedTimeCards[randomIndex];
    
    const identityHash = crypto.createHash('sha256').update(identity).digest('hex');
    selectedCard.claimedAt = Date.now();
    selectedCard.claimIdentityHash = identityHash;
    saveCards();
    cardClaimRecords.push({
        identityHash,
        claimTime: Date.now(),
        cardCode: selectedCard.code,
        username: username || null
    });
    
    saveCardClaimRecords();

    addCardLog({
        action: 'claim',
        username: username || null,
        cardCode: selectedCard.code,
        cardType: 'time',
        days: selectedCard.days,
        at: Date.now()
    });
    
    return {
        ok: true,
        cardCode: selectedCard.code,
        days: selectedCard.days,
        description: selectedCard.description
    };
}

function getCardClaimRecords() {
    loadCardClaimRecords();
    return cardClaimRecords;
}

function clearExpiredClaimRecords() {
    loadCardClaimRecords();
    loadCards();
    const now = Date.now();
    releaseExpiredCardReservations(now);
    
    const beforeCount = cardClaimRecords.length;
    cardClaimRecords = cardClaimRecords.filter(r => 
        now - r.claimTime < CARD_CLAIM_WINDOW_MS
    );
    
    if (cardClaimRecords.length !== beforeCount) {
        saveCardClaimRecords();
    }
    
    return { cleared: beforeCount - cardClaimRecords.length };
}

// ============ 卡密消费流水 ============
function loadCardLogs() {
    try {
        const data = readJsonWithBackup(CARD_LOGS_FILE, []);
        cardLogs = Array.isArray(data) ? data : [];
    } catch (e) {
        console.error('加载卡密流水失败:', e.message);
        cardLogs = [];
    }
}

function saveCardLogs() {
    try {
        writeJsonWithBackup(CARD_LOGS_FILE, cardLogs);
    } catch (e) {
        console.error('保存卡密流水失败:', e.message);
        throw e;
    }
}

function addCardLog(entry) {
    loadCardLogs();
    cardLogs.push({
        action: entry.action,        // register | renew | claim
        username: entry.username || null,
        cardCode: entry.cardCode,
        cardType: entry.cardType || 'time',
        days: entry.days,
        at: entry.at || Date.now()
    });
    // 最多保留 5000 条，防止文件无限增长
    if (cardLogs.length > 5000) {
        cardLogs = cardLogs.slice(cardLogs.length - 5000);
    }
    // 卡密流水为追加型数据，合并写入减少同步 IO
    cardLogsWriter.schedule();
}

// 卡密流水合并写入器（500ms 窗口）
const cardLogsWriter = createDebouncedWriter(() => {
    saveCardLogs();
}, 500, CARD_LOGS_FILE);

function getCardLogs(limit = 200, offset = 0, action = null) {
    // 读取前先落盘，保证读到最新记录
    flushWritersFor(CARD_LOGS_FILE);
    loadCardLogs();
    const filtered = action ? cardLogs.filter(l => l.action === action) : cardLogs;
    const sorted = [...filtered].sort((a, b) => (b.at || 0) - (a.at || 0));
    return {
        total: sorted.length,
        logs: sorted.slice(offset, offset + limit)
    };
}

function clearCardLogs() {
    flushWritersFor(CARD_LOGS_FILE);
    loadCardLogs();
    const count = cardLogs.length;
    cardLogs = [];
    saveCardLogs();
    return { cleared: count };
}

module.exports = {
    validateUser,
    validateUserWithoutPassword,
    registerUser,
    renewUser,
    getAllUsers,
    updateUser,
    editUser,
    getAllCards,
    createCard,
    createCardsBatch,
    updateCard,
    deleteCard,
    deleteCardsBatch,
    deleteUser,
    changePassword,
    DEFAULT_ACCOUNT_LIMIT,
    addLoginLog,
    getLoginLogs,
    clearLoginLogs,
    getCardClaimStatus,
    setCardClaimStatus,
    claimCardByUA,
    getCardClaimRecords,
    clearExpiredClaimRecords,
    addCardLog,
    getCardLogs,
    clearCardLogs,
};
