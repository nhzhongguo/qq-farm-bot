const crypto = require('node:crypto');
/**
 * 管理面板 HTTP 服务
 * 改写为接收 DataProvider 模式
 */

const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');
const express = require('express');
const { Server: SocketIOServer } = require('socket.io');
const { version } = require('../../package.json');
const { CONFIG, updateRuntimeConfig, getRuntimeConfig, getDefaultSystemConfig } = require('../config/config');
const { getLevelExpProgress } = require('../config/gameConfig');
const { getDataDir, getResourcePath } = require('../config/runtime-paths');
const store = require('../models/store');
const { addOrUpdateAccount, deleteAccount } = store;
const { findAccountByRef, normalizeAccountRef, resolveAccountId } = require('../services/account-resolver');
const { createModuleLogger } = require('../services/logger');
const { MiniProgramLoginSession } = require('../services/qrlogin');
const { getSchedulerRegistrySnapshot } = require('../services/scheduler');
const taskRunStore = require('../services/task-run-store');
const { WxLoginClient, WxLoginClientError } = require('../services/wx-login-client');
const { WxLoginSessionError, wxLoginSessionManager } = require('../services/wx-login-session');
const userStore = require('../models/user-store');
const { rateLimitMiddleware, resetRateLimitStore } = require('../services/security');
const { createRuntimeDoctor, safeStat, safeReadJson, createCheck } = require('../services/runtime-doctor');
const diagnosticBundle = require('../services/diagnostic-bundle');
const strategyTemplate = require('../services/strategy-template');
const alertRuleEngine = require('../services/alert-rule-engine');
const auditLog = require('../services/audit-log');

const adminLogger = createModuleLogger('admin');

function getWxLoginRuntimeConfig() {
    const storedConfig = store.getGlobalWxConfig();
    return {
        ...storedConfig,
        apiKey: process.env.WX_PROXY_API_KEY || storedConfig.apiKey || '',
        proxyApiUrl: process.env.WX_PROXY_API_URL || storedConfig.proxyApiUrl || storedConfig.apiBase,
        appId: process.env.WX_PROXY_APP_ID || storedConfig.appId || 'wx5306c5978fdb76e4',
    };
}

function toPublicWxConfig(config) {
    const value = config && typeof config === 'object' ? config : {};
    const apiKey = String(value.apiKey || '').trim();
    return {
        enabled: value.enabled !== false,
        apiBase: String(value.apiBase || '').trim(),
        proxyApiUrl: String(value.proxyApiUrl || '').trim(),
        appId: String(value.appId || '').trim(),
        autoAddAccount: value.autoAddAccount !== false,
        userIsolation: value.userIsolation !== false,
        apiKeyConfigured: Boolean(apiKey),
        apiKeyHint: apiKey ? `已配置（末尾 ${apiKey.slice(-4)}）` : '未配置',
    };
}

let app = null;
let server = null;
let provider = null; // DataProvider
let io = null;
let runtimeTimers = [];

function emitRealtimeStatus(accountId, status) {
    if (!io) return;
    const id = String(accountId || '').trim();
    if (!id) return;

    // 推送到特定账号房间（只有订阅了该账号的用户能收到）
    io.to(`account:${id}`).emit('status:update', { accountId: id, status });
}

// ============ WebSocket 推送节流 ============
// 账号日志/系统日志高频产生时，按账号 200ms 合并为批量推送，减少 UI 渲染压力。
// 前端同时兼容"单条对象"与"批量数组"两种 payload。
const LOG_BATCH_WINDOW_MS = 200;
const logBatchQueues = new Map(); // `${channel}:${accountId}` -> { timer, entries }

function flushLogBatch(key) {
    const q = logBatchQueues.get(key);
    if (!q) return;
    if (q.timer) {
        clearTimeout(q.timer);
        q.timer = null;
    }
    const batch = q.entries.splice(0, q.entries.length);
    logBatchQueues.delete(key);
    if (!batch.length) return;
    const separator = key.indexOf(':');
    const channel = key.slice(0, separator);
    const accountId = key.slice(separator + 1);
    if (channel === 'log') {
        io.to(`account:${accountId}`).emit('log:new', batch);
    } else if (channel === 'account-log') {
        io.to(`account:${accountId}`).emit('account-log:new', batch);
    }
}

function enqueueRealtimeBatch(channel, accountId, entry) {
    if (!io) return;
    const key = `${channel}:${accountId}`;
    let q = logBatchQueues.get(key);
    if (!q) {
        q = { timer: null, entries: [] };
        logBatchQueues.set(key, q);
    }
    q.entries.push(entry);
    if (q.timer) return;
    q.timer = setTimeout(() => {
        q.timer = null;
        flushLogBatch(key);
    }, LOG_BATCH_WINDOW_MS);
}

function emitRealtimeLog(entry) {
    const payload = (entry && typeof entry === 'object') ? entry : {};
    const id = String(payload.accountId || '').trim();

    // 如果没有指定账号ID，不推送给任何人（防止数据泄露）
    if (!id) return;

    enqueueRealtimeBatch('log', id, payload);
}

function emitRealtimeAccountLog(entry) {
    const payload = (entry && typeof entry === 'object') ? entry : {};
    const id = String(payload.accountId || '').trim();

    // 如果没有指定账号ID，不推送给任何人（防止数据泄露）
    if (!id) return;

    enqueueRealtimeBatch('account-log', id, payload);
}

function startAdminServer(dataProvider) {
    if (app) return;
    provider = dataProvider;

    app = express();
    app.disable('x-powered-by');
    const trustProxyEnv = String(process.env.TRUST_PROXY || '').trim().toLowerCase();
    app.set('trust proxy', trustProxyEnv === '1' || trustProxyEnv === 'true' ? 1 : false);
    app.use(express.json({ limit: '1mb' }));

    // Baseline HTTP security headers (helmet-lite, no extra dependency)
    app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('X-XSS-Protection', '0');
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
        res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
        if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
            res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }
        next();
    });

    function getClientIp(req) {
        if (req.ip) {
            return req.ip;
        }
        
        const remoteAddr = req.connection?.remoteAddress || req.socket?.remoteAddress;
        if (remoteAddr) {
            if (remoteAddr.startsWith('::ffff:')) {
                return remoteAddr.substring(7);
            }
            return remoteAddr;
        }
        
        return 'unknown';
    }

    const tokens = new Set();
    const tokenSessions = new Map();
    const sessionAbsoluteTtlMs = Math.max(1_000, Number(process.env.SESSION_ABSOLUTE_TTL_MS) || 12 * 60 * 60 * 1000);
    const sessionIdleTtlMs = Math.max(1_000, Number(process.env.SESSION_IDLE_TTL_MS) || 2 * 60 * 60 * 1000);

    const issueToken = () => crypto.randomBytes(24).toString('hex');
    const invalidateToken = (token) => {
        tokens.delete(token);
        tokenUserMap.delete(token);
        tokenSessions.delete(token);
        if (io) {
            for (const socket of io.sockets.sockets.values()) {
                if (String(socket.data.adminToken || '') === String(token)) {
                    socket.disconnect(true);
                }
            }
        }
    };
    const getValidSessionUser = (token, touch = true) => {
        if (!token || !tokens.has(token)) return null;
        const session = tokenSessions.get(token);
        const now = Date.now();
        if (!session || now >= session.expiresAt || now - session.lastSeenAt >= sessionIdleTtlMs) {
            invalidateToken(token);
            return null;
        }
        const user = tokenUserMap.get(token);
        if (!user) {
            invalidateToken(token);
            return null;
        }
        if (touch) session.lastSeenAt = now;
        return user;
    };
    const authRequired = (req, res, next) => {
        const token = req.headers['x-admin-token'];
        const currentUser = getValidSessionUser(token);
        if (!currentUser) {
            return res.status(401).json({ ok: false, error: 'Unauthorized' });
        }
        req.adminToken = token;
        req.currentUser = currentUser;

        // 管理员不检查封禁和过期
        if (req.currentUser && req.currentUser.role !== 'admin') {
            // 检查用户状态（每次请求都检查）
            if (req.currentUser.card) {
                // 检查是否被封禁
                if (req.currentUser.card.enabled === false) {
                    console.log('[请求拒绝] 用户已被封禁:', req.currentUser.username);
                    invalidateToken(token);
                    return res.status(403).json({ ok: false, error: '账号已被封禁，请联系管理员' });
                }

                // 检查是否过期
                if (req.currentUser.card.expiresAt) {
                    const now = Date.now();
                    if (req.currentUser.card.expiresAt < now) {
                        console.log('[请求拒绝] 用户已过期:', req.currentUser.username);
                        invalidateToken(token);
                        return res.status(403).json({ ok: false, error: '账号已过期，请续费后重新登录' });
                    }
                }
            }
        }

        next();
    };

    app.use((req, res, next) => {
        const allowedOrigins = CONFIG.ALLOWED_ORIGINS || ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'];
        const origin = req.headers.origin;
        
        if (origin && allowedOrigins.includes(origin)) {
            res.header('Access-Control-Allow-Origin', origin);
        } else if (!origin) {
            res.header('Access-Control-Allow-Origin', '*');
        }
        
        res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS, PUT');
        res.header('Access-Control-Allow-Headers', 'Content-Type, x-account-id, x-admin-token');
        res.header('Access-Control-Allow-Credentials', 'true');
        res.header('Access-Control-Max-Age', '86400');
        
        if (req.method === 'OPTIONS') return res.sendStatus(200);
        next();
    });

    const webDist = path.join(__dirname, '../../../web/dist');
    if (fs.existsSync(webDist)) {
        app.use(express.static(webDist));
    } else {
        adminLogger.warn('web build not found', { webDist });
        app.get('/', (req, res) => res.send('web build not found. Please build the web project.'));
    }
    app.use('/game-config', express.static(getResourcePath('gameConfig')));

    // Token 到用户映射（用于用户系统）
    const tokenUserMap = new Map();

    // 检查用户是否有权访问（管理员或普通用户）
    const checkUserAccess = (req, res, next) => {
        const token = req.headers['x-admin-token'];
        const currentUser = getValidSessionUser(token);
        if (!currentUser) {
            return res.status(401).json({ ok: false, error: 'Unauthorized' });
        }
        req.adminToken = token;
        req.currentUser = currentUser;

        // 管理员不检查封禁和过期
        if (req.currentUser && req.currentUser.role !== 'admin') {
            // 检查用户状态（每次请求都检查）
            if (req.currentUser.card) {
                // 检查是否被封禁
                if (req.currentUser.card.enabled === false) {
                    console.log('[请求拒绝] 用户已被封禁:', req.currentUser.username);
                    invalidateToken(token);
                    return res.status(403).json({ ok: false, error: '账号已被封禁，请联系管理员' });
                }

                // 检查是否过期
                if (req.currentUser.card.expiresAt) {
                    const now = Date.now();
                    if (req.currentUser.card.expiresAt < now) {
                        console.log('[请求拒绝] 用户已过期:', req.currentUser.username);
                        invalidateToken(token);
                        return res.status(403).json({ ok: false, error: '账号已过期，请续费后重新登录' });
                    }
                }
            }
        }

        next();
    };

    // 定期清理过期用户（每5分钟检查一次）
    const cleanupExpiredUsers = () => {
        const now = Date.now();
        const usersToCleanup = [];

        for (const [token, user] of tokenUserMap.entries()) {
            if (!getValidSessionUser(token, false)) {
                usersToCleanup.push({ token, username: user.username, reason: 'session_expired' });
                continue;
            }
            if (user.role === 'admin') continue; // 管理员不检查卡密状态

            // 检查是否被封禁
            if (user.card && user.card.enabled === false) {
                console.log(`[自动检查] 用户 ${user.username} 已被封禁，执行清理...`);
                usersToCleanup.push({ token, username: user.username, reason: 'banned' });
                continue;
            }

            // 检查是否过期
            if (user.card && user.card.expiresAt && user.card.expiresAt < now) {
                console.log(`[自动检查] 用户 ${user.username} 已过期，执行清理...`);
                usersToCleanup.push({ token, username: user.username, reason: 'expired' });
            }
        }

        for (const { token, username, reason } of usersToCleanup) {
            invalidateToken(token);
            const label = reason === 'banned' ? '被封禁' : reason === 'expired' ? '过期' : '会话过期';
            console.log(`[自动清理] 用户 ${username} 已${label}，已强制下线`);
        }
    };

    // 启动定期清理
    runtimeTimers.push(setInterval(cleanupExpiredUsers, 5 * 60 * 1000)); // 每5分钟检查一次

    // Public write endpoints: HTTP rate limits (IP based)
    const loginRateLimit = rateLimitMiddleware({
        name: 'login',
        windowMs: 60 * 1000,
        maxRequests: 20,
    });
    const registerRateLimit = rateLimitMiddleware({
        name: 'register',
        windowMs: 60 * 1000,
        maxRequests: 10,
    });
    const cardClaimRateLimit = rateLimitMiddleware({
        name: 'card-claim',
        windowMs: 60 * 1000,
        maxRequests: 10,
    });

    // 测试阶段：关闭密码校验，仅按用户名登录。
    const disablePasswordLogin = process.env.FARM_TEST === '1';

    // 登录与鉴权
    app.post('/api/login', loginRateLimit, (req, res) => {
        const { username, password } = req.body || {};
        const clientIp = getClientIp(req);
        const userAgent = req.headers['user-agent'] || 'unknown';

        if (username && (disablePasswordLogin || password)) {
            const user = disablePasswordLogin
                ? userStore.validateUserWithoutPassword(username, clientIp)
                : userStore.validateUser(username, password, clientIp);
            
            if (user && user.error) {
                const statusCode = user.error === 'rate_limit' ? 429 : 
                                   user.error === 'locked' ? 423 : 401;
                
                adminLogger.warn('登录失败', { 
                    username, 
                    error: user.error, 
                    ip: clientIp,
                    message: user.message 
                });

                userStore.addLoginLog({
                    event: 'login_failed',
                    username,
                    errorType: user.error,
                    ip: clientIp,
                    userAgent
                });
                
                return res.status(statusCode).json({ 
                    ok: false, 
                    error: user.message,
                    errorType: user.error,
                    remainingMs: user.remainingMs 
                });
            }
            
            if (!user) {
                adminLogger.warn('登录失败', { username, ip: clientIp, reason: 'invalid_credentials' });
                
                userStore.addLoginLog({
                    event: 'login_failed',
                    username,
                    errorType: 'invalid_credentials',
                    ip: clientIp,
                    userAgent
                });
                
                return res.status(401).json({ ok: false, error: '用户名或密码错误' });
            }

            adminLogger.info('登录检查', { username, role: user.role, cardInfo: user.card ? 'exists' : 'none' });

            if (user.role !== 'admin') {
                if (user.card && user.card.enabled === false) {
                    adminLogger.warn('登录拒绝', { username, reason: 'banned' });
                    return res.status(403).json({ ok: false, error: '账号已被封禁，请联系管理员' });
                }

                if (user.card && user.card.expiresAt) {
                    const now = Date.now();
                    if (user.card.expiresAt < now) {
                        adminLogger.warn('登录拒绝', { username, reason: 'expired' });
                        return res.status(403).json({ ok: false, error: '账号已过期，请续费后重新登录' });
                    }
                }
            }

            const token = issueToken();
            tokens.add(token);
            tokenUserMap.set(token, user);
            const createdAt = Date.now();
            tokenSessions.set(token, {
                createdAt,
                lastSeenAt: createdAt,
                expiresAt: createdAt + sessionAbsoluteTtlMs,
            });
            
            adminLogger.info('登录成功', { username, role: user.role, ip: clientIp });

            userStore.addLoginLog({
                event: 'login_success',
                username,
                errorType: null,
                ip: clientIp,
                userAgent
            });
            
            return res.json({ 
                ok: true, 
                data: { 
                    token, 
                    role: user.role, 
                    card: user.card, 
                    accountLimit: user.accountLimit || userStore.DEFAULT_ACCOUNT_LIMIT || 2,
                    pushLimit: user.pushLimit || 50,
                    operationRateLimit: user.operationRateLimit || 30,
                    user: { username: user.username },
                    mustChangePassword: user.mustChangePassword || false,
                    sessionExpiresAt: createdAt + sessionAbsoluteTtlMs,
                } 
            });
        }

        return res.status(401).json({ ok: false, error: '请输入用户名和密码' });
    });

    // 注册接口
    app.post('/api/register', registerRateLimit, (req, res) => {
        const { username, password, cardCode } = req.body || {};
        if (!username || !password || !cardCode) {
            return res.status(400).json({ ok: false, error: '请填写完整信息' });
        }
        const result = userStore.registerUser(username, password, cardCode);
        if (!result.ok) {
            return res.status(400).json(result);
        }
        res.json({ ok: true, data: result.user });
    });

    // 获取登录日志（管理员）
    app.get('/api/admin/login-logs', authRequired, (req, res) => {
        if (!req.currentUser || req.currentUser.role !== 'admin') {
            return res.status(403).json({ ok: false, error: '无权限访问' });
        }
        
        const limit = Math.min(Math.max(Number.Number.parseInt(req.query.limit) || 100, 1), 500);
        const offset = Math.max(Number.Number.parseInt(req.query.offset) || 0, 0);
        
        const result = userStore.getLoginLogs(limit, offset);
        res.json({ ok: true, data: result });
    });

    // 清空登录日志（管理员）
    app.delete('/api/admin/login-logs', authRequired, (req, res) => {
        if (!req.currentUser || req.currentUser.role !== 'admin') {
            return res.status(403).json({ ok: false, error: '无权限访问' });
        }
        
        const result = userStore.clearLoginLogs();
        adminLogger.info('登录日志已清空', { admin: req.currentUser.username });
        res.json(result);
    });

    // 查询卡密信息接口（用于续费前预览）
    app.get('/api/card/info/:code', (req, res) => {
        try {
            const { code } = req.params;
            const cards = userStore.getAllCards();
            const card = cards.find(c => c.code === code);
            
            if (!card) {
                return res.status(404).json({ ok: false, error: '卡密不存在' });
            }
            
            if (!card.enabled) {
                return res.status(400).json({ ok: false, error: '卡密已被禁用' });
            }
            
            if (card.usedBy) {
                return res.status(400).json({ ok: false, error: '卡密已被使用' });
            }
            
            res.json({ 
                ok: true, 
                data: {
                    type: card.type || 'time',
                    days: card.days,
                    description: card.description
                }
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 用户续费接口
    app.post('/api/user/renew', checkUserAccess, (req, res) => {
        const { cardCode } = req.body || {};
        const username = req.currentUser?.username;

        if (!username) {
            return res.status(401).json({ ok: false, error: '未登录' });
        }

        if (!cardCode) {
            return res.status(400).json({ ok: false, error: '请提供卡密' });
        }

        const result = userStore.renewUser(username, cardCode);
        if (!result.ok) {
            return res.status(400).json(result);
        }

        // 更新 token 中的用户信息
        for (const [token, user] of tokenUserMap.entries()) {
            if (user.username === username) {
                user.card = result.card;
                user.accountLimit = result.accountLimit;
                tokenUserMap.set(token, user);
                break;
            }
        }

        res.json({ ok: true, data: { card: result.card, accountLimit: result.accountLimit, cardType: result.cardType } });
    });

    // 修改密码接口
    app.post('/api/user/change-password', checkUserAccess, (req, res) => {
        const { oldPassword, newPassword } = req.body || {};
        const username = req.currentUser?.username;

        if (!username) {
            return res.status(401).json({ ok: false, error: '未登录' });
        }

        if (!oldPassword || !newPassword) {
            return res.status(400).json({ ok: false, error: '请提供原密码和新密码' });
        }

        const result = userStore.changePassword(username, oldPassword, newPassword);
        if (result.ok) {
            for (const [token, user] of tokenUserMap.entries()) {
                if (user.username === username) {
                    user.mustChangePassword = false;
                    tokenUserMap.set(token, user);
                }
            }
        }
        res.json(result);
    });

    // Global API auth: public allowlist only; everything else requires token
    app.use('/api', (req, res, next) => {
        const publicExactPaths = new Set([
            '/login',
            '/register',
            '/card-claim/status',
            '/card-claim/claim',
            '/game-version',
            '/ping',
        ]);
        if (publicExactPaths.has(req.path)) return next();
        // card info preview for renew UI (path param)
        if (req.method === 'GET' && /^\/card\/info\/[^/]+$/.test(req.path)) return next();
        return authRequired(req, res, () => {
            // A default or reset password must not grant a usable management session.
            // Keep the small allowlist necessary to prove the session, change the password,
            // or terminate it; every operational endpoint stays unavailable until then.
            const passwordChangeAllowlist = new Set([
                '/auth/validate',
                '/user/change-password',
                '/logout',
            ]);
            if (req.currentUser?.mustChangePassword && !passwordChangeAllowlist.has(req.path)) {
                return res.status(403).json({
                    ok: false,
                    code: 'PASSWORD_CHANGE_REQUIRED',
                    error: '请先修改初始密码后再使用系统',
                });
            }
            return next();
        });
    });

    // 管理员密码修改已移除，统一使用 /api/user/change-password 接口

    app.get('/api/ping', (req, res) => {
        res.json({ ok: true, data: { ok: true, uptime: process.uptime(), version } });
    });

    app.get('/api/game-version', (req, res) => {
        const runtimeConfig = getRuntimeConfig();
        res.json({ ok: true, clientVersion: runtimeConfig.clientVersion });
    });

    app.get('/api/auth/validate', (req, res) => {
        res.json({ ok: true, data: { valid: true } });
    });

    // API: 调度任务快照（用于调度收敛排查）
    app.get('/api/scheduler', async (req, res) => {
        try {
            const id = getAccId(req);

            // 检查权限（如果指定了账号ID）
            if (id && !checkAccountAccess(req, id)) {
                return res.status(403).json({ ok: false, error: '无权访问此账号' });
            }

            if (provider && typeof provider.getSchedulerStatus === 'function') {
                const data = await provider.getSchedulerStatus(id);
                return res.json({ ok: true, data });
            }
            return res.json({ ok: true, data: { runtime: getSchedulerRegistrySnapshot(), worker: null, workerError: 'DataProvider does not support scheduler status' } });
        } catch (e) {
            return handleApiError(res, e);
        }
    });

    app.post('/api/logout', (req, res) => {
        const token = req.adminToken;
        if (token) {
            invalidateToken(token);
        }
        res.json({ ok: true });
    });

    const getAccountList = (username = null) => {
        try {
            // 检查是否启用用户隔离
            const wxConfig = store.getGlobalWxConfig();
            const userIsolation = wxConfig.userIsolation !== false;

            if (provider && typeof provider.getAccounts === 'function') {
                const data = provider.getAccounts();
                if (data && Array.isArray(data.accounts)) {
                    // 如果指定了用户名且启用了用户隔离，只返回该用户的账号
                    if (username && userIsolation) {
                        return data.accounts.filter(a => a.username === username);
                    }
                    return data.accounts;
                }
            }
        } catch {
            // ignore provider failures
        }
        const data = store.getAccounts ? store.getAccounts() : { accounts: [] };
        let accounts = Array.isArray(data.accounts) ? data.accounts : [];
        // 检查是否启用用户隔离
        const wxConfig = store.getGlobalWxConfig();
        const userIsolation = wxConfig.userIsolation !== false;
        // 如果指定了用户名且启用了用户隔离，只返回该用户的账号
        if (username && userIsolation) {
            accounts = accounts.filter(a => a.username === username);
        }
        return accounts;
    };

    // 检查用户是否有权访问指定账号
    const checkAccountAccess = (req, accountId) => {
        const currentUser = req.currentUser;
        if (!currentUser) return false;
        // 管理员可以访问所有账号
        if (currentUser.role === 'admin') return true;
        // 普通用户只能访问自己的账号
        const accounts = getAccountList();
        const account = accounts.find(a => a.id === accountId);
        if (!account) return false;
        return account.username === currentUser.username;
    };

    // 获取当前用户可访问的账号ID列表
    const getAccessibleAccountIds = (req) => {
        const currentUser = req.currentUser;
        if (!currentUser) return [];
        // 管理员可以访问所有账号
        if (currentUser.role === 'admin') {
            const accounts = getAccountList();
            return accounts.map(a => a.id);
        }
        // 普通用户只能访问自己的账号
        const accounts = getAccountList(currentUser.username);
        return accounts.map(a => a.id);
    };

    // 根据用户对象获取可访问的账号ID列表（用于WebSocket）
    const getAccessibleAccountIdsForUser = (user) => {
        if (!user) return [];
        // 管理员可以访问所有账号
        if (user.role === 'admin') {
            const accounts = getAccountList();
            return accounts.map(a => a.id);
        }
        // 普通用户只能访问自己的账号
        const accounts = getAccountList(user.username);
        return accounts.map(a => a.id);
    };

    const isSoftRuntimeError = (err) => {
        const msg = String((err && err.message) || '');
        return msg === '账号未运行' || msg === 'API Timeout';
    };

    function handleApiError(res, err) {
        if (isSoftRuntimeError(err)) {
            return res.json({ ok: false, error: err.message });
        }
        return res.status(500).json({ ok: false, error: err.message });
    }

    const resolveAccId = (rawRef) => {
        const input = normalizeAccountRef(rawRef);
        if (!input) return '';

        if (provider && typeof provider.resolveAccountId === 'function') {
            const resolvedByProvider = normalizeAccountRef(provider.resolveAccountId(input));
            if (resolvedByProvider) return resolvedByProvider;
        }

        const resolved = resolveAccountId(getAccountList(), input);
        return resolved || input;
    };

    // Helper to get account ID from header
    function getAccId(req) {
        return resolveAccId(req.headers['x-account-id']);
    }

    // API: 完整状态
    app.get('/api/status', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.json({ ok: false, error: 'Missing x-account-id' });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const data = provider.getStatus(id);
            if (data && data.status) {
                const { level, exp } = data.status;
                const progress = getLevelExpProgress(level, exp);
                data.levelProgress = progress;
            }
            res.json({ ok: true, data });
        } catch (e) {
            res.json({ ok: false, error: e.message });
        }
    });

    app.post('/api/automation', async (req, res) => {
        const id = getAccId(req);
        if (!id) {
            return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        }

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            let lastData = null;
            for (const [k, v] of Object.entries(req.body)) {
                lastData = await provider.setAutomation(id, k, v);
            }
            res.json({ ok: true, data: lastData || {} });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/fertilizer/buy', async (req, res) => {
        const id = getAccId(req);
        if (!id) {
            return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        }

        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const type = String(req.body?.type || 'organic');
            const count = Number(req.body?.count) || 0;
            const bought = await provider.buyFertilizer(id, type, count);
            res.json({ ok: true, bought });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 检测化肥容器并自动购买
    app.post('/api/fertilizer/check-and-buy', async (req, res) => {
        const id = getAccId(req);
        if (!id) {
            return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        }

        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const buyOrganic = req.body?.buyOrganic ?? false;
            const buyNormal = req.body?.buyNormal ?? false;
            const organicCount = Number(req.body?.organicCount) || 0;
            const organicThresholdHours = Number(req.body?.organicThresholdHours) || 0;
            const normalCount = Number(req.body?.normalCount) || 0;
            const normalThresholdHours = Number(req.body?.normalThresholdHours) || 0;

            const result = await provider.checkAndBuyFertilizer(id, {
                buyOrganic,
                buyNormal,
                organicCount,
                organicThresholdHours,
                normalCount,
                normalThresholdHours,
            });
            res.json({ ok: true, ...result });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 农田详情
    app.get('/api/lands', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const data = await provider.getLands(id);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 好友列表
    app.get('/api/friends', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        const forceSync = req.query.forceSync === 'true';

        try {
            const data = await provider.getFriends(id, forceSync);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // 清除好友列表缓存
    app.post('/api/friends/clear-cache', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            await provider.clearFriendsCache(id);
            res.json({ ok: true });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // 访客
    app.get('/api/interact-records', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        try {
            const data = await provider.getInteractRecords(id);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });
    // API: 好友农田详情
    app.get('/api/friend/:gid/lands', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const data = await provider.getFriendLands(id, req.params.gid);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 对指定好友执行单次操作（偷菜/浇水/除草/捣乱）
    app.post('/api/friend/:gid/op', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const opType = String((req.body || {}).opType || '');
            const data = await provider.doFriendOp(id, req.params.gid, opType);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 好友批量操作（一键帮助/一键偷取/一键捣乱）
    app.post('/api/friends/batch-op', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const opType = String((req.body || {}).opType || '');
            if (!opType) {
                return res.status(400).json({ ok: false, error: '缺少 opType 参数' });
            }
            const data = await provider.doBatchFriendOp(id, opType);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 好友黑名单
    app.get('/api/friend-blacklist', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        const gids = store.getFriendBlacklist ? store.getFriendBlacklist(id) : [];
        
        // 尝试获取好友列表以附加昵称和头像
        let friendsList = [];
        try {
            if (provider && typeof provider.getFriends === 'function') {
                friendsList = await provider.getFriends(id) || [];
            }
        } catch {
            // 忽略获取好友列表失败
        }
        
        // 构建好友信息映射
        const friendMap = new Map();
        for (const f of friendsList) {
            const gid = Number(f && f.gid);
            if (gid > 0) {
                friendMap.set(gid, {
                    name: f.name || f.remark || '',
                    avatarUrl: f.avatarUrl || f.avatar_url || '',
                });
            }
        }
        
        // 构建带好友信息的黑名单
        const list = gids.map(gid => {
            const info = friendMap.get(Number(gid)) || {};
            return {
                gid: Number(gid),
                name: info.name || '',
                avatarUrl: info.avatarUrl || '',
            };
        });
        
        res.json({ ok: true, data: list });
    });

    app.post('/api/friend-blacklist/toggle', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        const gid = Number((req.body || {}).gid);
        if (!gid) return res.status(400).json({ ok: false, error: 'Missing gid' });
        const current = store.getFriendBlacklist ? store.getFriendBlacklist(id) : [];
        let next;
        if (current.includes(gid)) {
            next = current.filter(g => g !== gid);
        } else {
            next = [...current, gid];
        }
        const savedGids = store.setFriendBlacklist ? store.setFriendBlacklist(id, next) : next;
        
        // 同步配置到 worker 进程
        if (provider && typeof provider.broadcastConfig === 'function') {
            provider.broadcastConfig(id);
        }
        
        // 尝试获取好友列表以附加昵称和头像
        let friendsList = [];
        try {
            if (provider && typeof provider.getFriends === 'function') {
                friendsList = await provider.getFriends(id) || [];
            }
        } catch {
            // 忽略获取好友列表失败
        }
        
        // 构建好友信息映射
        const friendMap = new Map();
        for (const f of friendsList) {
            const fGid = Number(f && f.gid);
            if (fGid > 0) {
                friendMap.set(fGid, {
                    name: f.name || f.remark || '',
                    avatarUrl: f.avatarUrl || f.avatar_url || '',
                });
            }
        }
        
        // 构建带好友信息的黑名单
        const saved = savedGids.map(g => {
            const info = friendMap.get(Number(g)) || {};
            return {
                gid: Number(g),
                name: info.name || '',
                avatarUrl: info.avatarUrl || '',
            };
        });
        
        res.json({ ok: true, data: saved });
    });

    // ============ 好友GID管理 API ============
    function buildKnownFriendGidSettings(accountId) {
        return {
            knownFriendGids: store.getKnownFriendGids ? store.getKnownFriendGids(accountId) : [],
            knownFriendGidSyncCooldownSec: store.getKnownFriendGidSyncCooldownSec
                ? store.getKnownFriendGidSyncCooldownSec(accountId)
                : 600,
        };
    }

    // 获取已知好友GID设置
    app.get('/api/friend-known-gids', (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            return res.json({ ok: true, data: buildKnownFriendGidSettings(id) });
        } catch (e) {
            return handleApiError(res, e);
        }
    });

    // 保存已知好友GID设置
    app.post('/api/friend-known-gids', (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            if (body.knownFriendGids !== undefined && store.setKnownFriendGids) {
                store.setKnownFriendGids(id, body.knownFriendGids);
            }
            if (body.knownFriendGidSyncCooldownSec !== undefined && store.setKnownFriendGidSyncCooldownSec) {
                store.setKnownFriendGidSyncCooldownSec(id, body.knownFriendGidSyncCooldownSec);
            }
            // 同步配置到 worker 进程
            if (provider && typeof provider.broadcastConfig === 'function') {
                provider.broadcastConfig(id);
            }
            return res.json({ ok: true, data: buildKnownFriendGidSettings(id) });
        } catch (e) {
            return handleApiError(res, e);
        }
    });

    // 添加单个好友GID
    app.post('/api/friend-known-gids/add', (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        const gid = Number((req.body || {}).gid);
        if (!Number.isFinite(gid) || gid <= 0) {
            return res.status(400).json({ ok: false, error: 'GID 无效' });
        }

        try {
            const current = store.getKnownFriendGids ? store.getKnownFriendGids(id) : [];
            const next = Array.isArray(current) ? [...current, gid] : [gid];
            if (store.setKnownFriendGids) {
                store.setKnownFriendGids(id, next);
            }
            const cooldownSec = (req.body || {}).knownFriendGidSyncCooldownSec;
            if (cooldownSec !== undefined && store.setKnownFriendGidSyncCooldownSec) {
                store.setKnownFriendGidSyncCooldownSec(id, cooldownSec);
            }
            // 同步配置到 worker 进程
            if (provider && typeof provider.broadcastConfig === 'function') {
                provider.broadcastConfig(id);
            }
            return res.json({ ok: true, data: buildKnownFriendGidSettings(id) });
        } catch (e) {
            return handleApiError(res, e);
        }
    });

    // 移除单个好友GID
    app.post('/api/friend-known-gids/remove', (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        const gid = Number((req.body || {}).gid);
        if (!Number.isFinite(gid) || gid <= 0) {
            return res.status(400).json({ ok: false, error: 'GID 无效' });
        }

        try {
            const current = store.getKnownFriendGids ? store.getKnownFriendGids(id) : [];
            const next = Array.isArray(current) ? current.filter(item => Number(item) !== gid) : [];
            if (store.setKnownFriendGids) {
                store.setKnownFriendGids(id, next);
            }
            // 同步配置到 worker 进程
            if (provider && typeof provider.broadcastConfig === 'function') {
                provider.broadcastConfig(id);
            }
            return res.json({ ok: true, data: buildKnownFriendGidSettings(id) });
        } catch (e) {
            return handleApiError(res, e);
        }
    });

    // 批量添加好友GID
    app.post('/api/friend-known-gids/batch-add', (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        const gids = (req.body || {}).gids;
        if (!Array.isArray(gids) || gids.length === 0) {
            return res.status(400).json({ ok: false, error: 'GID 列表无效' });
        }

        try {
            const current = store.getKnownFriendGids ? store.getKnownFriendGids(id) : [];
            const currentSet = new Set(current.map(Number));
            let addedCount = 0;
            for (const gid of gids) {
                const num = Number(gid);
                if (!Number.isFinite(num) || num <= 0) continue;
                if (!currentSet.has(num)) {
                    currentSet.add(num);
                    addedCount++;
                }
            }
            const next = Array.from(currentSet);
            if (store.setKnownFriendGids) {
                store.setKnownFriendGids(id, next);
            }
            // 同步配置到 worker 进程
            if (provider && typeof provider.broadcastConfig === 'function') {
                provider.broadcastConfig(id);
            }
            return res.json({ 
                ok: true, 
                data: buildKnownFriendGidSettings(id),
                addedCount,
            });
        } catch (e) {
            return handleApiError(res, e);
        }
    });

    // 批量删除未同步的好友GID
    app.post('/api/friend-known-gids/batch-remove', (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        const gids = (req.body || {}).gids;
        if (!Array.isArray(gids) || gids.length === 0) {
            return res.json({ ok: true, data: buildKnownFriendGidSettings(id), removedCount: 0 });
        }

        try {
            const current = store.getKnownFriendGids ? store.getKnownFriendGids(id) : [];
            const removeSet = new Set(gids.map(Number).filter(n => Number.isFinite(n) && n > 0));
            const next = current.filter(gid => !removeSet.has(Number(gid)));
            const removedCount = current.length - next.length;

            if (removedCount > 0 && store.setKnownFriendGids) {
                store.setKnownFriendGids(id, next);
            }

            return res.json({ 
                ok: true, 
                data: buildKnownFriendGidSettings(id),
                removedCount,
            });
        } catch (e) {
            return handleApiError(res, e);
        }
    });

    // API: 蔬菜黑名单
    app.get('/api/plant-blacklist', authRequired, (req, res) => {
        try {
            const accountId = getAccId(req);
            if (!accountId) return res.status(400).json({ ok: false, error: 'Missing accountId' });

            // 检查权限
            if (!checkAccountAccess(req, accountId)) {
                return res.status(403).json({ ok: false, error: '无权访问此账号' });
            }

            const list = store.getPlantBlacklist ? store.getPlantBlacklist(accountId) : [];
            res.json({ ok: true, data: list });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    app.post('/api/plant-blacklist', authRequired, (req, res) => {
        try {
            const accountId = getAccId(req);
            if (!accountId) return res.status(400).json({ ok: false, error: 'Missing accountId' });

            // 检查权限
            if (!checkAccountAccess(req, accountId)) {
                return res.status(403).json({ ok: false, error: '无权访问此账号' });
            }

            const seedId = Number((req.body || {}).seedId);
            if (!seedId) return res.status(400).json({ ok: false, error: 'Missing seedId' });

            const current = store.getPlantBlacklist ? store.getPlantBlacklist(accountId) : [];

            if (!current.includes(seedId)) {
                const next = [...current, seedId];
                if (store.setPlantBlacklist) {
                    store.setPlantBlacklist(accountId, next);
                }
            }

            if (provider && typeof provider.broadcastConfig === 'function') {
                provider.broadcastConfig(accountId);
            }

            const saved = store.getPlantBlacklist ? store.getPlantBlacklist(accountId) : [];
            res.json({ ok: true, data: saved });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    app.delete('/api/plant-blacklist/:seedId', authRequired, (req, res) => {
        try {
            const accountId = getAccId(req);
            if (!accountId) return res.status(400).json({ ok: false, error: 'Missing accountId' });

            // 检查权限
            if (!checkAccountAccess(req, accountId)) {
                return res.status(403).json({ ok: false, error: '无权访问此账号' });
            }

            const seedId = Number(req.params.seedId);
            if (!seedId) return res.status(400).json({ ok: false, error: 'Missing seedId' });

            const current = store.getPlantBlacklist ? store.getPlantBlacklist(accountId) : [];
            const next = current.filter(id => id !== seedId);

            if (store.setPlantBlacklist) {
                store.setPlantBlacklist(accountId, next);
            }

            if (provider && typeof provider.broadcastConfig === 'function') {
                provider.broadcastConfig(accountId);
            }

            const saved = store.getPlantBlacklist ? store.getPlantBlacklist(accountId) : [];
            res.json({ ok: true, data: saved });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 批量添加蔬菜黑名单
    app.post('/api/plant-blacklist/batch', authRequired, (req, res) => {
        try {
            const accountId = getAccId(req);
            if (!accountId) return res.status(400).json({ ok: false, error: 'Missing accountId' });

            // 检查权限
            if (!checkAccountAccess(req, accountId)) {
                return res.status(403).json({ ok: false, error: '无权访问此账号' });
            }

            const seedIds = (req.body || {}).seedIds || [];
            if (!Array.isArray(seedIds)) {
                return res.status(400).json({ ok: false, error: 'seedIds must be an array' });
            }

            const current = store.getPlantBlacklist ? store.getPlantBlacklist(accountId) : [];
            const merged = [...new Set([...current, ...seedIds.map(Number).filter(n => Number.isFinite(n) && n > 0)])];

            if (store.setPlantBlacklist) {
                store.setPlantBlacklist(accountId, merged);
            }

            if (provider && typeof provider.broadcastConfig === 'function') {
                provider.broadcastConfig(accountId);
            }

            const saved = store.getPlantBlacklist ? store.getPlantBlacklist(accountId) : [];
            res.json({ ok: true, data: saved });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 清空蔬菜黑名单
    app.delete('/api/plant-blacklist', authRequired, (req, res) => {
        try {
            const accountId = getAccId(req);
            if (!accountId) return res.status(400).json({ ok: false, error: 'Missing accountId' });

            // 检查权限
            if (!checkAccountAccess(req, accountId)) {
                return res.status(403).json({ ok: false, error: '无权访问此账号' });
            }

            if (store.setPlantBlacklist) {
                store.setPlantBlacklist(accountId, []);
            }

            if (provider && typeof provider.broadcastConfig === 'function') {
                provider.broadcastConfig(accountId);
            }

            res.json({ ok: true, data: [] });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 种子列表
    app.get('/api/seeds', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const data = await provider.getSeeds(id);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 背包物品
    app.get('/api/bag', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const data = await provider.getBag(id);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 使用背包物品
    app.post('/api/bag/use', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const { itemId, count } = req.body;
            if (!itemId) return res.status(400).json({ ok: false, error: '缺少 itemId' });
            const data = await provider.useItem(id, Number(itemId), Math.max(1, Number(count) || 1));
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 出售背包物品
    app.post('/api/bag/sell', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const { items } = req.body;
            if (!Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ ok: false, error: '缺少出售物品列表' });
            }
            const data = await provider.sellItems(id, items);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 获取背包种子列表
    app.get('/api/bag/seeds', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const data = await provider.getBagSeeds(id);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 每日礼包状态总览
    app.get('/api/daily-gifts', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const data = await provider.getDailyGifts(id);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 启动账号
    app.post('/api/accounts/:id/start', (req, res) => {
        try {
            const accountId = resolveAccId(req.params.id);

            // 检查权限
            if (!checkAccountAccess(req, accountId)) {
                return res.status(403).json({ ok: false, error: '无权访问此账号' });
            }

            const ok = provider.startAccount(accountId);
            if (!ok) {
                return res.status(404).json({ ok: false, error: 'Account not found' });
            }
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 停止账号
    app.post('/api/accounts/:id/stop', (req, res) => {
        try {
            const accountId = resolveAccId(req.params.id);

            // 检查权限
            if (!checkAccountAccess(req, accountId)) {
                return res.status(403).json({ ok: false, error: '无权访问此账号' });
            }

            const ok = provider.stopAccount(accountId);
            if (!ok) {
                return res.status(404).json({ ok: false, error: 'Account not found' });
            }
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 批量启动账号
    app.post('/api/accounts/batch/start', authRequired, (req, res) => {
        try {
            const { accountIds } = req.body || {};
            if (!Array.isArray(accountIds) || accountIds.length === 0) {
                return res.status(400).json({ ok: false, error: '请提供账号 ID 列表' });
            }
            const results = [];
            for (const rawId of accountIds) {
                const accountId = resolveAccId(rawId);
                if (!checkAccountAccess(req, accountId)) {
                    results.push({ id: rawId, ok: false, error: '无权访问' });
                    continue;
                }
                try {
                    const ok = provider.startAccount(accountId);
                    results.push({ id: rawId, ok });
                } catch (e) {
                    results.push({ id: rawId, ok: false, error: e.message });
                }
            }
            auditLog.record({
                actor: req.currentUser.username, action: 'account.batch.start', target: `count:${accountIds.length}`,
                details: { accountIds }, ip: getClientIp(req),
            });
            res.json({ ok: true, data: { results } });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 批量停止账号
    app.post('/api/accounts/batch/stop', authRequired, (req, res) => {
        try {
            const { accountIds } = req.body || {};
            if (!Array.isArray(accountIds) || accountIds.length === 0) {
                return res.status(400).json({ ok: false, error: '请提供账号 ID 列表' });
            }
            const results = [];
            for (const rawId of accountIds) {
                const accountId = resolveAccId(rawId);
                if (!checkAccountAccess(req, accountId)) {
                    results.push({ id: rawId, ok: false, error: '无权访问' });
                    continue;
                }
                try {
                    const ok = provider.stopAccount(accountId);
                    results.push({ id: rawId, ok });
                } catch (e) {
                    results.push({ id: rawId, ok: false, error: e.message });
                }
            }
            auditLog.record({
                actor: req.currentUser.username, action: 'account.batch.stop', target: `count:${accountIds.length}`,
                details: { accountIds }, ip: getClientIp(req), severity: 'warning',
            });
            res.json({ ok: true, data: { results } });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 批量重启账号
    app.post('/api/accounts/batch/restart', authRequired, (req, res) => {
        try {
            const { accountIds } = req.body || {};
            if (!Array.isArray(accountIds) || accountIds.length === 0) {
                return res.status(400).json({ ok: false, error: '请提供账号 ID 列表' });
            }
            const results = [];
            for (const rawId of accountIds) {
                const accountId = resolveAccId(rawId);
                if (!checkAccountAccess(req, accountId)) {
                    results.push({ id: rawId, ok: false, error: '无权访问' });
                    continue;
                }
                try {
                    provider.stopAccount(accountId);
                    const ok = provider.startAccount(accountId);
                    results.push({ id: rawId, ok });
                } catch (e) {
                    results.push({ id: rawId, ok: false, error: e.message });
                }
            }
            auditLog.record({
                actor: req.currentUser.username, action: 'account.batch.restart', target: `count:${accountIds.length}`,
                details: { accountIds }, ip: getClientIp(req), severity: 'warning',
            });
            res.json({ ok: true, data: { results } });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 农场一键操作
    app.post('/api/farm/operate', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const { opType } = req.body; // 'harvest', 'clear', 'plant', 'all'
            await provider.doFarmOp(id, opType);
            res.json({ ok: true });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 数据分析
    app.get('/api/analytics', async (req, res) => {
        try {
            const sortBy = req.query.sort || 'exp';
            const { getPlantRankings } = require('../services/analytics');
            const data = getPlantRankings(sortBy);
            res.json({ ok: true, data });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 收益趋势（金币/经验/操作数 7/30/90 天）
    app.get('/api/stats/trend', async (req, res) => {
        const id = getAccId(req);
        if (!id) {
            return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        }
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }
        try {
            const days = Math.min(Math.max(Number.parseInt(req.query.days, 10) || 30, 1), 90);
            const { getStatsTrend } = require('../services/stats');
            const points = getStatsTrend(id, days);
            res.json({ ok: true, data: { accountId: id, days, points } });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 设置页统一保存（单次写入+单次广播）
    app.post('/api/settings/save', async (req, res) => {
        const id = getAccId(req);
        if (!id) {
            return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        }

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const data = await provider.saveSettings(id, req.body || {});
            res.json({ ok: true, data: data || {} });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 设置面板主题
    app.post('/api/settings/theme', async (req, res) => {
        try {
            const theme = String((req.body || {}).theme || '');
            const data = await provider.setUITheme(theme);
            res.json({ ok: true, data: data || {} });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 保存下线提醒配置
    app.post('/api/settings/offline-reminder', async (req, res) => {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const currentUser = req.currentUser;

            // 必须登录才能保存下线提醒配置
            if (!currentUser) {
                return res.status(401).json({ ok: false, error: '未登录' });
            }

            // 保存到用户隔离的配置中
            const data = store.setOfflineReminder
                ? store.setOfflineReminder(body, currentUser.username)
                : {};
            res.json({ ok: true, data: data || {} });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 测试下线提醒推送（不落盘）
    app.post('/api/settings/offline-reminder/test', async (req, res) => {
        try {
            const currentUser = req.currentUser;
            const saved = store.getOfflineReminder && currentUser
                ? store.getOfflineReminder(currentUser.username)
                : {};
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const cfg = { ...(saved || {}), ...body };

            const channel = String(cfg.channel || '').trim().toLowerCase();
            const endpoint = String(cfg.endpoint || '').trim();
            const token = String(cfg.token || '').trim();
            const titleBase = String(cfg.title || '账号下线提醒').trim();
            const msgBase = String(cfg.msg || '账号下线').trim();

            if (!channel) {
                return res.status(400).json({ ok: false, error: '推送渠道不能为空' });
            }
            if (channel === 'webhook' && !endpoint) {
                return res.status(400).json({ ok: false, error: 'Webhook 渠道需要填写接口地址' });
            }

            const now = new Date();
            const ts = now.toISOString().replace('T', ' ').slice(0, 19);
            const { sendPushooMessage } = require('../services/push');
            const ret = await sendPushooMessage({
                channel,
                endpoint,
                token,
                title: `${titleBase}（测试）`,
                content: `${msgBase}\n\n这是一条下线提醒测试消息。\n时间: ${ts}`,
            });

            if (!ret) {
                return res.status(400).json({ ok: false, error: '推送失败：无返回结果' });
            }
            
            const isSuccess = ret.ok || 
                ret.code === 'ok' || 
                ret.code === '0' || 
                String(ret.msg || '').includes('成功') ||
                String(ret.raw?.status || '').toLowerCase() === 'success';
            
            if (!isSuccess && ret.msg && !String(ret.msg).includes('成功')) {
                return res.status(400).json({ ok: false, error: ret.msg || '推送失败', data: ret });
            }
            return res.json({ ok: true, data: ret, message: ret.msg || '推送成功' });
        } catch (e) {
            return res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 获取配置
    app.get('/api/settings', async (req, res) => {
        try {
            const id = getAccId(req);
            const currentUser = req.currentUser;

            // 检查权限（如果指定了账号ID）
            if (id && !checkAccountAccess(req, id)) {
                return res.status(403).json({ ok: false, error: '无权访问此账号' });
            }

            // 直接从主进程的 store 读取，确保即使账号未运行也能获取配置
            const intervals = id ? store.getIntervals(id) : {};
            const strategy = id ? store.getPlantingStrategy(id) : null;
            const preferredSeed = id ? store.getPreferredSeed(id) : null;
            const friendQuietHours = id ? store.getFriendQuietHours(id) : null;
            const automation = id ? store.getAutomation(id) : {};
            const stealDelaySeconds = id && (typeof store.getStealDelaySeconds === 'function') ? store.getStealDelaySeconds(id) : 0;
            const plantOrderRandom = id && (typeof store.getPlantOrderRandom === 'function') ? store.getPlantOrderRandom(id) : false;
            const plantDelaySeconds = id && (typeof store.getPlantDelaySeconds === 'function') ? store.getPlantDelaySeconds(id) : 0;
            const fertilizerBuyOrganicCount = id && (typeof store.getFertilizerBuyOrganicCount === 'function') ? store.getFertilizerBuyOrganicCount(id) : 0;
            const fertilizerBuyOrganicThresholdHours = id && (typeof store.getFertilizerBuyOrganicThresholdHours === 'function') ? store.getFertilizerBuyOrganicThresholdHours(id) : 10;
            const fertilizerBuyNormalCount = id && (typeof store.getFertilizerBuyNormalCount === 'function') ? store.getFertilizerBuyNormalCount(id) : 0;
            const fertilizerBuyNormalThresholdHours = id && (typeof store.getFertilizerBuyNormalThresholdHours === 'function') ? store.getFertilizerBuyNormalThresholdHours(id) : 10;
            const fertilizerBuyCheckIntervalMinutes = id && (typeof store.getFertilizerBuyCheckIntervalMinutes === 'function') ? store.getFertilizerBuyCheckIntervalMinutes(id) : 30;
            const bagSeedPriority = id && (typeof store.getBagSeedPriority === 'function') ? store.getBagSeedPriority(id) : [];
            const bagSeedFallbackStrategy = id && (typeof store.getBagSeedFallbackStrategy === 'function') ? store.getBagSeedFallbackStrategy(id) : 'level';
            const ui = store.getUI();
            // 获取用户隔离的下线提醒配置
            const offlineReminder = store.getOfflineReminder && currentUser
                ? store.getOfflineReminder(currentUser.username)
                : { channel: 'webhook', reloginUrlMode: 'none', endpoint: '', token: '', title: '账号下线提醒', msg: '账号下线', offlineDeleteSec: 0 };
            res.json({ ok: true, data: { intervals, strategy, preferredSeed, friendQuietHours, automation, stealDelaySeconds, plantOrderRandom, plantDelaySeconds, fertilizerBuyOrganicCount, fertilizerBuyOrganicThresholdHours, fertilizerBuyNormalCount, fertilizerBuyNormalThresholdHours, fertilizerBuyCheckIntervalMinutes, bagSeedPriority, bagSeedFallbackStrategy, ui, offlineReminder } });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 获取默认配置
    app.get('/api/settings/default', (req, res) => {
        try {
            const defaultConfig = store.getDefaultAccountConfig ? store.getDefaultAccountConfig() : null;
            if (!defaultConfig) {
                return res.status(500).json({ ok: false, error: '无法获取默认配置' });
            }
            res.json({ ok: true, data: defaultConfig });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ 管理员权限中间件 ============
    const adminRequired = (req, res, next) => {
        if (!req.currentUser || req.currentUser.role !== 'admin') {
            return res.status(403).json({ ok: false, error: '需要管理员权限' });
        }
        next();
    };

    // ============ 公告管理 API ============
    // 获取公告（所有用户可访问）
    app.get('/api/announcement', authRequired, (req, res) => {
        try {
            const currentUser = req.currentUser;
            const announcement = store.getAnnouncement();
            const shouldShow = store.shouldShowAnnouncement(currentUser?.username);
            res.json({
                ok: true,
                data: {
                    ...announcement,
                    shouldShow,
                },
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 标记公告已读
    app.post('/api/announcement/read', authRequired, (req, res) => {
        try {
            const currentUser = req.currentUser;
            if (currentUser?.username) {
                store.markAnnouncementRead(currentUser.username);
            }
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 设置公告（仅管理员）
    app.post('/api/admin/announcement', authRequired, adminRequired, (req, res) => {
        try {
            const { content, showOnce } = req.body || {};
            const announcement = store.setAnnouncement(content, showOnce);
            res.json({ ok: true, data: announcement });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ 系统配置 API（仅管理员） ============

    // 获取系统配置
    app.get('/api/admin/system-config', authRequired, adminRequired, (req, res) => {
        try {
            const savedConfig = store.getSystemConfig();
            const defaultConfig = getDefaultSystemConfig();
            const currentRuntime = getRuntimeConfig();
            res.json({
                ok: true,
                data: {
                    saved: savedConfig,
                    default: defaultConfig,
                    current: currentRuntime,
                },
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.get('/api/task-runs', (req, res) => {
        try {
            const requestedAccountId = getAccId(req);
            if (requestedAccountId && !checkAccountAccess(req, requestedAccountId)) {
                return res.status(403).json({ ok: false, error: '无权访问此账号' });
            }
            const accountIds = requestedAccountId ? [requestedAccountId] : getAccessibleAccountIds(req);
            const runs = taskRunStore.listRuns({
                accountIds,
                limit: req.query.limit,
                status: req.query.status,
                taskName: req.query.taskName,
            });
            return res.json({ ok: true, data: { schemaVersion: taskRunStore.SCHEMA_VERSION, runs } });
        } catch (error) {
            return handleApiError(res, error);
        }
    });

    app.get('/api/admin/doctor', authRequired, adminRequired, (req, res) => {
        const storeFilePath = path.join(getDataDir(), 'store.json');
    const storageChecks = [];
    const dataDir = getDataDir();
    const storageFiles = [
        { file: 'users.json', hasBak: true },
        { file: 'cards.json', hasBak: true },
        { file: 'accounts.json', hasBak: true },
        { file: 'store.json', hasBak: false },
        { file: 'login-logs.json', hasBak: false },
        { file: 'card-logs.json', hasBak: false },
        { file: 'card-claim.json', hasBak: false },
    ];
    for (const { file, hasBak } of storageFiles) {
        const filePath = path.join(dataDir, file);
        const stat = safeStat(filePath);
        const label = file.replace('.json', '');
        if (!stat) {
            storageChecks.push(createCheck(`storage-${label}`, `数据文件 ${file}`, 'error', '文件不存在'));
        } else if (stat.size === 0) {
            storageChecks.push(createCheck(`storage-${label}`, `数据文件 ${file}`, 'error', '文件为空'));
        } else {
            const data = safeReadJson(filePath);
            if (data === null) {
                storageChecks.push(createCheck(`storage-${label}`, `数据文件 ${file}`, 'error', 'JSON 解析失败'));
            } else if (data === undefined) {
                storageChecks.push(createCheck(`storage-${label}`, `数据文件 ${file}`, 'error', 'JSON 解析失败'));
            } else {
                storageChecks.push(createCheck(`storage-${label}`, `数据文件 ${file}`, 'ok', '可读', { size: stat.size }));
            }
        }
        if (hasBak) {
            const bakPath = path.join(dataDir, `${file}.bak`);
            const bakStat = safeStat(bakPath);
            const bakLabel = `${label}.bak`;
            if (!bakStat) {
                storageChecks.push(createCheck(`storage-${bakLabel}`, `备份文件 ${file}.bak`, 'warn', '备份文件不存在'));
            } else if (bakStat.size === 0) {
                storageChecks.push(createCheck(`storage-${bakLabel}`, `备份文件 ${file}.bak`, 'warn', '备份文件为空'));
            } else {
                const bakData = safeReadJson(bakPath);
                if (bakData === null || bakData === undefined) {
                    storageChecks.push(createCheck(`storage-${bakLabel}`, `备份文件 ${file}.bak`, 'warn', '备份 JSON 解析失败'));
                } else {
                    storageChecks.push(createCheck(`storage-${bakLabel}`, `备份文件 ${file}.bak`, 'ok', '可读', { size: bakStat.size }));
                }
            }
        }
    }
        const doctor = createRuntimeDoctor({
            dataDir: getDataDir(),
            versionManifestPath: path.resolve(__dirname, '../../..', 'version.json'),
            requiredResources: [
                { id: 'plant-config', label: '植物配置', path: getResourcePath('gameConfig', 'Plant.json') },
                { id: 'item-config', label: '物品配置', path: getResourcePath('gameConfig', 'ItemInfo.json') },
                { id: 'core-proto', label: '核心协议', path: getResourcePath('proto', 'corepb.proto') },
            ],
            storeFilePath,
            requiredStoreFields: ['accounts'],
            schedulerSnapshotFn: () => {
                try {
                    return getSchedulerRegistrySnapshot();
                } catch (e) {
                    return { running: [], error: e.message };
                }
            },
        });
        try {
            auditLog.record({
                actor: req.currentUser?.username || 'system',
                action: 'admin.doctor.check',
                target: 'runtime',
                severity: 'info',
                ip: getClientIp(req),
            });
        } catch {
            // 审计日志失败不影响 doctor 检查结果
        }
        res.json({ ok: true, data: doctor.check() });
    });

    // ============ 审计日志 API（仅管理员） ============

    app.get('/api/admin/audit-log', authRequired, adminRequired, (req, res) => {
        try {
            const entries = auditLog.list({
                actor: req.query.actor,
                action: req.query.action,
                severity: req.query.severity,
                limit: req.query.limit,
            });
            res.json({ ok: true, data: { schemaVersion: auditLog.SCHEMA_VERSION, entries } });
        } catch (error) {
            handleApiError(res, error);
        }
    });

    // ============ 诊断包 API（仅管理员） ============

    app.get('/api/admin/diagnostic-bundles', authRequired, adminRequired, (req, res) => {
        try {
            const bundles = diagnosticBundle.list({
                accountId: req.query.accountId,
                limit: req.query.limit,
            });
            res.json({ ok: true, data: { schemaVersion: diagnosticBundle.SCHEMA_VERSION, bundles } });
        } catch (error) {
            handleApiError(res, error);
        }
    });

    app.get('/api/admin/diagnostic-bundles/:id', authRequired, adminRequired, (req, res) => {
        try {
            const bundle = diagnosticBundle.get(req.params.id);
            if (!bundle) {
                return res.status(404).json({ ok: false, error: '诊断包不存在' });
            }
            res.json({ ok: true, data: bundle });
        } catch (error) {
            handleApiError(res, error);
        }
    });

    app.post('/api/admin/diagnostic-bundles', authRequired, adminRequired, (req, res) => {
        try {
            const { accountId, accountName, trigger } = req.body || {};
            if (!accountId) {
                return res.status(400).json({ ok: false, error: '请提供账号 ID' });
            }

            // 从 provider 获取账号状态和最近任务
            let statusSnapshot = null;
            let taskRuns = [];
            let configSummary = null;
            const error = null;

            try {
                const accountData = provider.getAccounts();
                const account = (accountData.accounts || []).find(a => a.id === accountId);
                if (account) {
                    statusSnapshot = {
                        online: account.online || false,
                        status: account.status || 'unknown',
                        lastSeen: account.lastSeen || null,
                    };
                }
            } catch { /* ignore */ }

            try {
                const { getRecentTaskRuns } = require('../services/task-run-store');
                taskRuns = getRecentTaskRuns({ accountId, limit: 10 });
            } catch { /* ignore */ }

            try {
                const runtimeConfig = getRuntimeConfig();
                configSummary = {
                    serverUrl: runtimeConfig.serverUrl,
                    clientVersion: runtimeConfig.clientVersion,
                    platform: runtimeConfig.platform,
                };
            } catch { /* ignore */ }

            const bundle = diagnosticBundle.generate({
                accountId, accountName, trigger: trigger || 'manual',
                taskRuns, statusSnapshot, configSummary, error,
            });

            auditLog.record({
                actor: req.currentUser.username,
                action: 'diagnostic.generate',
                target: `account:${accountId}`,
                ip: getClientIp(req),
            });

            res.json({ ok: true, data: bundle });
        } catch (error) {
            handleApiError(res, error);
        }
    });

    // ============ 策略模板 API（已登录用户） ============

    app.get('/api/strategy-templates', authRequired, (req, res) => {
        try {
            res.json({ ok: true, data: { templates: strategyTemplate.listTemplates() } });
        } catch (error) {
            handleApiError(res, error);
        }
    });

    app.get('/api/strategy-templates/:id', authRequired, (req, res) => {
        try {
            const template = strategyTemplate.getTemplate(req.params.id);
            if (!template) return res.status(404).json({ ok: false, error: '模板不存在' });
            res.json({ ok: true, data: template });
        } catch (error) {
            handleApiError(res, error);
        }
    });

    app.post('/api/strategy-templates', authRequired, (req, res) => {
        try {
            const { name, description, configData } = req.body || {};
            if (!configData) return res.status(400).json({ ok: false, error: '请提供配置数据' });
            const template = strategyTemplate.saveTemplate(name, description, configData);
            auditLog.record({
                actor: req.currentUser.username, action: 'template.save', target: `template:${template.name}`,
                ip: getClientIp(req),
            });
            res.json({ ok: true, data: template });
        } catch (error) {
            handleApiError(res, error);
        }
    });

    app.delete('/api/strategy-templates/:id', authRequired, (req, res) => {
        try {
            const template = strategyTemplate.getTemplate(req.params.id);
            const ok = strategyTemplate.deleteTemplate(req.params.id);
            if (!ok) return res.status(404).json({ ok: false, error: '模板不存在' });
            auditLog.record({
                actor: req.currentUser.username, action: 'template.delete', target: `template:${template?.name || req.params.id}`,
                ip: getClientIp(req), severity: 'warning',
            });
            res.json({ ok: true });
        } catch (error) {
            handleApiError(res, error);
        }
    });

    app.post('/api/strategy-templates/validate', authRequired, (req, res) => {
        try {
            const result = strategyTemplate.validateImport(req.body || {});
            res.json({ ok: true, data: result });
        } catch (error) {
            handleApiError(res, error);
        }
    });

    // ============ 告警规则 API（仅管理员） ============

    app.get('/api/admin/alert-rules', authRequired, adminRequired, (req, res) => {
        try {
            const rules = alertRuleEngine.listRules();
            const triggers = alertRuleEngine.listTriggers({ limit: req.query.limit });
            res.json({ ok: true, data: { rules, triggers } });
        } catch (error) {
            handleApiError(res, error);
        }
    });

    app.post('/api/admin/alert-rules', authRequired, adminRequired, (req, res) => {
        try {
            const rule = alertRuleEngine.createRule({
                ...req.body,
                username: req.currentUser.username,
            });
            auditLog.record({
                actor: req.currentUser.username, action: 'alert-rule.create', target: `rule:${rule.name}`,
                ip: getClientIp(req),
            });
            res.json({ ok: true, data: rule });
        } catch (error) {
            handleApiError(res, error);
        }
    });

    app.post('/api/admin/alert-rules/:id/toggle', authRequired, adminRequired, (req, res) => {
        try {
            const { enabled } = req.body || {};
            const rule = alertRuleEngine.toggleRule(req.params.id, enabled);
            if (!rule) return res.status(404).json({ ok: false, error: '规则不存在' });
            res.json({ ok: true, data: rule });
        } catch (error) {
            handleApiError(res, error);
        }
    });

    app.delete('/api/admin/alert-rules/:id', authRequired, adminRequired, (req, res) => {
        try {
            const rule = alertRuleEngine.getRule(req.params.id);
            const ok = alertRuleEngine.deleteRule(req.params.id);
            if (!ok) return res.status(404).json({ ok: false, error: '规则不存在' });
            auditLog.record({
                actor: req.currentUser.username, action: 'alert-rule.delete', target: `rule:${rule?.name || req.params.id}`,
                ip: getClientIp(req), severity: 'warning',
            });
            res.json({ ok: true });
        } catch (error) {
            handleApiError(res, error);
        }
    });

    // 将触发的告警投递到外部渠道（webhook / pushoo 全渠道）
    async function deliverAlertTrigger(trigger, rule) {
        const { sendPushooMessage } = require('../services/push');
        const ts = new Date(trigger.triggeredAt || Date.now()).toISOString().replace('T', ' ').slice(0, 19);
        const conditionLabel = alertRuleEngine.CONDITION_TYPES[rule.condition] || rule.condition;
        const title = `【农场告警】${rule.name}`;
        const content = [
            `规则: ${rule.name}`,
            `条件: ${conditionLabel}（阈值 ${rule.threshold}，当前 ${trigger.actualValue}）`,
            rule.username ? `账号: ${rule.username}` : '',
            `时间: ${ts}`,
        ].filter(Boolean).join('\n');
        const result = await sendPushooMessage({
            channel: rule.channel,
            endpoint: rule.endpoint,
            token: rule.token,
            title,
            content,
        });
        return result;
    }

    // 手动评估告警规则（运营排查用），触发时按规则渠道投递
    app.post('/api/admin/alert-rules/evaluate', authRequired, adminRequired, async (req, res) => {
        try {
            const { consecutiveFailures, offlineDurationSec, taskErrorCount, username } = req.body || {};
            const context = {
                username: String(username || '').trim() || req.currentUser.username,
                consecutiveFailures: Number(consecutiveFailures) || 0,
                offlineDurationSec: Number(offlineDurationSec) || 0,
                taskErrorCount: Number(taskErrorCount) || 0,
            };
            const triggered = alertRuleEngine.evaluate(context, deliverAlertTrigger);
            auditLog.record({
                actor: req.currentUser.username, action: 'alert-rule.evaluate', target: `count:${triggered.length}`,
                details: { triggered: triggered.map(t => t.ruleName) }, ip: getClientIp(req),
            });
            res.json({ ok: true, data: { triggered, count: triggered.length } });
        } catch (error) {
            handleApiError(res, error);
        }
    });

    // 发送测试告警消息到指定渠道（不创建规则）
    app.post('/api/admin/alert-rules/test', authRequired, adminRequired, async (req, res) => {
        try {
            const { channel, endpoint, token } = req.body || {};
            const chan = String(channel || '').trim();
            if (!chan || !alertRuleEngine.CHANNEL_TYPES[chan]) {
                return res.status(400).json({ ok: false, error: '不支持的告警通道' });
            }
            if (chan === 'webhook' && !String(endpoint || '').trim()) {
                return res.status(400).json({ ok: false, error: 'Webhook 渠道需要填写接口地址' });
            }
            if (chan !== 'log' && chan !== 'webhook' && !String(token || '').trim()) {
                return res.status(400).json({ ok: false, error: '该推送渠道需要填写 Token' });
            }
            const rule = {
                name: '告警测试',
                condition: 'consecutive_failures',
                threshold: 1,
                channel: chan,
                endpoint,
                token,
            };
            const trigger = {
                id: 'test',
                ruleId: 'test',
                ruleName: rule.name,
                condition: rule.condition,
                threshold: 1,
                actualValue: 1,
                username: req.currentUser.username,
                triggeredAt: Date.now(),
                channel: chan,
                endpoint: String(endpoint || '').trim(),
            };
            const result = await deliverAlertTrigger(trigger, rule);
            const ok = !!(result && (result.ok || result.code === 'ok' || result.code === '0'));
            if (!ok) {
                return res.status(400).json({ ok: false, error: result?.msg || '推送失败', data: result });
            }
            auditLog.record({
                actor: req.currentUser.username, action: 'alert-rule.test', target: `channel:${chan}`,
                ip: getClientIp(req),
            });
            res.json({ ok: true, data: result });
        } catch (error) {
            handleApiError(res, error);
        }
    });

    // 保存系统配置
    app.post('/api/admin/system-config', authRequired, adminRequired, (req, res) => {
        try {
            const { serverUrl, clientVersion, platform, os } = req.body || {};
            const newConfig = { serverUrl, clientVersion, platform, os };
            const saved = store.setSystemConfig(newConfig);
            updateRuntimeConfig(saved);
            const current = getRuntimeConfig();
            auditLog.record({
                actor: req.currentUser.username,
                action: 'config.update',
                target: 'system:config',
                details: newConfig,
                ip: getClientIp(req),
            });
            res.json({ ok: true, data: { saved, current } });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 重置系统配置为默认值
    app.post('/api/admin/system-config/reset', authRequired, adminRequired, (req, res) => {
        try {
            const defaultConfig = getDefaultSystemConfig();
            store.setSystemConfig(defaultConfig);
            updateRuntimeConfig(defaultConfig);
            const current = getRuntimeConfig();
            auditLog.record({
                actor: req.currentUser.username,
                action: 'config.reset',
                target: 'system:config',
                details: defaultConfig,
                ip: getClientIp(req),
                severity: 'warning',
            });
            res.json({ ok: true, data: { saved: defaultConfig, current } });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ 全局微信配置 API（仅管理员） ============

    // 获取全局微信配置
    app.get('/api/admin/wx-config', authRequired, adminRequired, (req, res) => {
        try {
            const config = store.getGlobalWxConfig();
            res.json({ ok: true, data: toPublicWxConfig(config) });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 保存全局微信配置
    app.post('/api/admin/wx-config', authRequired, adminRequired, (req, res) => {
        try {
            const config = req.body || {};
            const saved = store.setGlobalWxConfig(config);
            res.json({ ok: true, data: toPublicWxConfig(saved) });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ 卡密管理 API（仅管理员） ============

    // 获取所有卡密
    app.get('/api/admin/cards', authRequired, adminRequired, (req, res) => {
        try {
            const cards = userStore.getAllCards();
            res.json({ ok: true, data: cards });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 创建卡密
    app.post('/api/admin/cards', authRequired, adminRequired, (req, res) => {
        try {
            const { description, days, count, type } = req.body || {};
            if (!description || days === undefined) {
                return res.status(400).json({ ok: false, error: '请提供描述和天数' });
            }

            const cardType = type === 'quota' ? 'quota' : 'time';

            // 批量创建
            if (count && Number.Number.parseInt(count, 10) > 1) {
                const cards = userStore.createCardsBatch(description, days, count, cardType);
                auditLog.record({
                    actor: req.currentUser.username, action: 'card.create.batch', target: `count:${cards.length}`,
                    details: { description, days, count, type: cardType }, ip: getClientIp(req),
                });
                return res.json({ ok: true, data: cards, batch: true, count: cards.length });
            }

            const card = userStore.createCard(description, days, cardType);
            auditLog.record({
                actor: req.currentUser.username, action: 'card.create', target: `card:${card.code}`,
                details: { description, days, type: cardType }, ip: getClientIp(req),
            });
            res.json({ ok: true, data: card });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 批量删除卡密（必须放在 /:code 路由之前，避免被当作 code 参数）
    app.post('/api/admin/cards/batch-delete', authRequired, adminRequired, (req, res) => {
        try {
            const { codes } = req.body || {};
            if (!Array.isArray(codes) || codes.length === 0) {
                return res.status(400).json({ ok: false, error: '请提供要删除的卡密列表' });
            }
            const result = userStore.deleteCardsBatch(codes);
            auditLog.record({
                actor: req.currentUser.username, action: 'card.delete.batch', target: `count:${codes.length}`,
                details: { codes }, ip: getClientIp(req), severity: 'warning',
            });
            res.json(result);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 更新卡密
    app.post('/api/admin/cards/:code', authRequired, adminRequired, (req, res) => {
        try {
            const { code } = req.params;
            const updates = req.body || {};
            const card = userStore.updateCard(code, updates);
            if (!card) {
                return res.status(404).json({ ok: false, error: '卡密不存在' });
            }
            res.json({ ok: true, data: card });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 删除卡密
    app.delete('/api/admin/cards/:code', authRequired, adminRequired, (req, res) => {
        try {
            const { code } = req.params;
            const ok = userStore.deleteCard(code);
            if (!ok) {
                return res.status(404).json({ ok: false, error: '卡密不存在' });
            }
            auditLog.record({
                actor: req.currentUser.username, action: 'card.delete', target: `card:${code}`,
                ip: getClientIp(req), severity: 'warning',
            });
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 获取卡密消费流水（注册激活/续费使用/领取）
    app.get('/api/admin/card-logs', authRequired, adminRequired, (req, res) => {
        try {
            const limit = Math.min(Number.parseInt(req.query.limit, 10) || 200, 1000);
            const offset = Number.parseInt(req.query.offset, 10) || 0;
            const action = typeof req.query.action === 'string' ? req.query.action : null;
            const result = userStore.getCardLogs(limit, offset, action);
            res.json({ ok: true, data: result });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 清空卡密消费流水
    app.delete('/api/admin/card-logs', authRequired, adminRequired, (req, res) => {
        try {
            const result = userStore.clearCardLogs();
            auditLog.record({
                actor: req.currentUser.username, action: 'card.logs.clear',
                details: { cleared: result.cleared }, ip: getClientIp(req), severity: 'warning',
            });
            res.json({ ok: true, data: result });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ 卡密领取功能 API ============
    // 获取卡密领取功能状态
    app.get('/api/card-claim/status', (req, res) => {
        try {
            const status = userStore.getCardClaimStatus();
            res.json({ ok: true, enabled: status.enabled });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 设置卡密领取功能状态（仅管理员）
    app.post('/api/admin/card-claim/status', authRequired, adminRequired, (req, res) => {
        try {
            const { enabled } = req.body;
            const status = userStore.setCardClaimStatus(enabled);
            res.json({ ok: true, enabled: status.enabled });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 用户领取卡密
    app.post('/api/card-claim/claim', cardClaimRateLimit, (req, res) => {
        try {
            const ua = req.headers['user-agent'] || '';
            const identity = `${getClientIp(req)}|${ua}`;
            const username = req.body?.username || null;
            
            // 清理过期记录
            userStore.clearExpiredClaimRecords();
            
            const result = userStore.claimCardByUA(identity, username);
            
            if (!result.ok) {
                const response = { ok: false, error: result.error };
                if (result.remainingMs) {
                    response.remainingMs = result.remainingMs;
                }
                return res.status(400).json(response);
            }
            
            res.json({
                ok: true,
                cardCode: result.cardCode,
                days: result.days,
                description: result.description
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 获取卡密领取记录（仅管理员）
    app.get('/api/admin/card-claim/records', authRequired, adminRequired, (req, res) => {
        try {
            const records = userStore.getCardClaimRecords();
            res.json({ ok: true, data: records });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ 用户管理 API（仅管理员） ============
    // 获取所有用户
    app.get('/api/admin/users', authRequired, adminRequired, (req, res) => {
        try {
            const users = userStore.getAllUsers();
            res.json({ ok: true, data: users });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 更新用户
    app.post('/api/admin/users/:username', authRequired, adminRequired, (req, res) => {
        try {
            const { username } = req.params;
            const updates = req.body || {};
            const user = userStore.updateUser(username, updates);
            if (!user) {
                return res.status(404).json({ ok: false, error: '用户不存在' });
            }
            res.json({ ok: true, data: user });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 编辑用户（管理员编辑用户信息）
    app.post('/api/admin/users/:username/edit', authRequired, adminRequired, (req, res) => {
        try {
            const { username } = req.params;
            const { newUsername, password, accountLimit, pushLimit, operationRateLimit, expiresAt, isPermanent } = req.body || {};
            
            const result = userStore.editUser(username, {
                newUsername,
                password,
                accountLimit,
                pushLimit,
                operationRateLimit,
                expiresAt,
                isPermanent
            });
            
            if (!result.ok) {
                return res.status(400).json(result);
            }

            if (result.user.username !== username && store.renameUserOwnership) {
                store.renameUserOwnership(username, result.user.username);
            }

            // 更新该用户所有会话中的信息
            for (const [token, user] of tokenUserMap.entries()) {
                if (user.username === username || user.username === newUsername) {
                    user.username = result.user.username;
                    user.card = result.user.card;
                    user.accountLimit = result.user.accountLimit;
                    tokenUserMap.set(token, user);
                }
            }

            res.json({ ok: true, data: result.user });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 删除用户
    app.delete('/api/admin/users/:username', authRequired, adminRequired, (req, res) => {
        try {
            const { username } = req.params;
            const currentUser = req.currentUser;

            // 不能删除自己
            if (currentUser && currentUser.username === username) {
                return res.status(400).json({ ok: false, error: '不能删除自己的账号' });
            }

            // 管理员可以删除其他管理员
            const result = userStore.deleteUser(username, true);
            if (!result.ok) {
                return res.status(400).json(result);
            }
            const accountData = provider.getAccounts();
            const ownedAccounts = (accountData.accounts || []).filter(account => account.username === username);
            for (const account of ownedAccounts) {
                provider.stopAccount(account.id);
            }
            if (store.deleteAccountsByUser) store.deleteAccountsByUser(username);
            if (store.deleteUserConfig) store.deleteUserConfig(username);
            // 强制下线该用户的所有会话
            for (const [token, user] of tokenUserMap.entries()) {
                if (user.username === username) {
                    invalidateToken(token);
                }
            }
            auditLog.record({
                actor: currentUser.username, action: 'user.delete', target: `username:${username}`,
                ip: getClientIp(req), severity: 'danger',
            });
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 管理员为用户续费
    app.post('/api/admin/users/:username/renew', authRequired, adminRequired, (req, res) => {
        try {
            const { username } = req.params;
            const { cardCode } = req.body || {};

            if (!cardCode) {
                return res.status(400).json({ ok: false, error: '请提供卡密' });
            }

            const result = userStore.renewUser(username, cardCode);
            if (!result.ok) {
                return res.status(400).json(result);
            }

            // 更新该用户所有会话中的卡密信息
            for (const [token, user] of tokenUserMap.entries()) {
                if (user.username === username) {
                    user.card = result.card;
                    user.accountLimit = result.accountLimit;
                    tokenUserMap.set(token, user);
                }
            }

            res.json({ ok: true, data: { card: result.card, accountLimit: result.accountLimit, cardType: result.cardType } });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 获取当前登录用户信息
    app.get('/api/user/me', authRequired, (req, res) => {
        try {
            const user = req.currentUser;
            if (!user) {
                return res.status(401).json({ ok: false, error: '未登录' });
            }
            res.json({
                ok: true,
                data: {
                    username: user.username,
                    role: user.role,
                    card: user.card,
                    accountLimit: user.accountLimit || userStore.DEFAULT_ACCOUNT_LIMIT || 2
                }
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 保存用户微信登录配置（仅管理员可以保存全局配置）
    app.post('/api/user/wxlogin-config', authRequired, adminRequired, (req, res) => {
        try {
            const user = req.currentUser;
            if (!user) {
                return res.status(401).json({ ok: false, error: '未登录' });
            }

            const config = req.body || {};
            const saved = store.setGlobalWxConfig(config);
            res.json({ ok: true, config: toPublicWxConfig(saved) });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 获取用户微信登录配置（普通用户获取全局配置）
    app.get('/api/user/wxlogin-config', authRequired, (req, res) => {
        try {
            const user = req.currentUser;
            if (!user) {
                return res.status(401).json({ ok: false, error: '未登录' });
            }

            const globalConfig = getWxLoginRuntimeConfig();
            const apiKeyMode = Boolean(String(globalConfig.apiKey || '').trim());
            const endpoint = apiKeyMode ? globalConfig.proxyApiUrl : globalConfig.apiBase;
            res.json({
                ok: true,
                config: {
                    enabled: globalConfig.enabled !== false,
                    configured: Boolean(String(endpoint || '').trim()),
                    mode: apiKeyMode ? 'proxy' : 'local',
                    autoAddAccount: globalConfig.autoAddAccount !== false,
                    userIsolation: globalConfig.userIsolation !== false,
                },
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 账号管理
    app.get('/api/accounts', (req, res) => {
        try {
            const currentUser = req.currentUser;
            let data;

            if (currentUser) {
                // 管理员可以看到所有账号，普通用户只能看到自己的账号
                const allAccounts = provider.getAccounts();
                if (currentUser.role === 'admin') {
                    data = allAccounts;
                } else {
                    data = {
                        ...allAccounts,
                        accounts: allAccounts.accounts.filter(a => a.username === currentUser.username)
                    };
                }
            } else {
                // 未登录用户返回空列表
                data = { accounts: [], nextId: 1 };
            }

            res.json({ ok: true, data });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 更新账号备注（兼容旧接口）
    app.post('/api/account/remark', (req, res) => {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const rawRef = body.id || body.accountId || body.uin || req.headers['x-account-id'];
            const accountList = getAccountList();
            const target = findAccountByRef(accountList, rawRef);
            if (!target || !target.id) {
                return res.status(404).json({ ok: false, error: 'Account not found' });
            }

            const remark = String(body.remark !== undefined ? body.remark : body.name || '').trim();
            if (!remark) {
                return res.status(400).json({ ok: false, error: 'Missing remark' });
            }

            const accountId = String(target.id);
            if (!checkAccountAccess(req, accountId)) {
                return res.status(403).json({ ok: false, error: '无权访问此账号' });
            }
            const data = addOrUpdateAccount({ id: accountId, name: remark });
            if (provider && typeof provider.setRuntimeAccountName === 'function') {
                provider.setRuntimeAccountName(accountId, remark);
            }
            if (provider && provider.addAccountLog) {
                provider.addAccountLog('update', `更新账号备注: ${remark}`, accountId, remark);
            }
            res.json({ ok: true, data });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/accounts', (req, res) => {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const currentUser = req.currentUser;
            const isUpdate = !!body.id;

            // 检查权限：普通用户只能更新自己的账号
            if (isUpdate && currentUser && currentUser.role !== 'admin') {
                if (!checkAccountAccess(req, resolveAccId(body.id))) {
                    return res.status(403).json({ ok: false, error: '无权访问此账号' });
                }
            }

            // 检查额度：新增账号时检查用户额度限制
            if (!isUpdate && currentUser && currentUser.role !== 'admin') {
                const userAccounts = getAccountList(currentUser.username);
                const currentCount = userAccounts.length;
                const accountLimit = currentUser.accountLimit || userStore.DEFAULT_ACCOUNT_LIMIT || 2;
                
                if (currentCount >= accountLimit) {
                    return res.status(403).json({ 
                        ok: false, 
                        error: `账号数量已达上限（${accountLimit}个），请购买额度卡密增加额度` 
                    });
                }
            }

            const resolvedUpdateId = isUpdate ? resolveAccId(body.id) : '';
            const payload = isUpdate ? { ...body, id: resolvedUpdateId || String(body.id) } : body;
            let wasRunning = false;
            if (isUpdate && provider.isAccountRunning) {
                wasRunning = provider.isAccountRunning(payload.id);
            }

            // 检查是否仅修改了备注信息
            let onlyRemarkChanged = false;
            if (isUpdate) {
                const oldAccounts = provider.getAccounts();
                const oldAccount = oldAccounts.accounts.find(a => a.id === payload.id);
                if (oldAccount) {
                    // 检查 payload 中是否只包含 id 和 name 字段
                    const payloadKeys = Object.keys(payload);
                    const onlyIdAndName = payloadKeys.length === 2 && payloadKeys.includes('id') && payloadKeys.includes('name');
                    if (onlyIdAndName) {
                        onlyRemarkChanged = true;
                    }
                }
            }

            // 如果是新增账号，自动关联当前用户
            if (!isUpdate && currentUser) {
                payload.username = currentUser.username;
            }

            const data = addOrUpdateAccount(payload);
            if (provider.addAccountLog) {
                const accountId = isUpdate ? String(payload.id) : String((data.accounts[data.accounts.length - 1] || {}).id || '');
                const accountName = payload.name || '';
                provider.addAccountLog(
                    isUpdate ? 'update' : 'add',
                    isUpdate ? `更新账号: ${accountName || accountId}` : `添加账号: ${accountName || accountId}`,
                    accountId,
                    accountName
                );
            }
            // 如果是新增，自动启动
            if (!isUpdate) {
                const newAcc = data.accounts[data.accounts.length - 1];
                if (newAcc) provider.startAccount(newAcc.id);
            } else if (wasRunning && !onlyRemarkChanged) {
                // 如果是更新，且之前在运行，且不是仅修改备注，则重启
                provider.restartAccount(payload.id);
            }
            res.json({ ok: true, data });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.delete('/api/accounts/:id', (req, res) => {
        try {
            const resolvedId = resolveAccId(req.params.id) || String(req.params.id || '');

            // 检查权限
            if (!checkAccountAccess(req, resolvedId)) {
                return res.status(403).json({ ok: false, error: '无权访问此账号' });
            }

            const before = provider.getAccounts();
            const target = findAccountByRef(before.accounts || [], req.params.id);
            provider.stopAccount(resolvedId);
            const data = deleteAccount(resolvedId);
            if (provider.addAccountLog) {
                provider.addAccountLog('delete', `删除账号: ${(target && target.name) || req.params.id}`, resolvedId, target ? target.name : '');
            }
            res.json({ ok: true, data });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 账号日志
    app.get('/api/account-logs', (req, res) => {
        try {
            const limit = Number.Number.parseInt(req.query.limit) || 100;
            const currentUser = req.currentUser;

            let list = provider.getAccountLogs ? provider.getAccountLogs(limit) : [];
            if (!Array.isArray(list)) list = [];

            // 所有用户（包括管理员）只能看到自己账号的操作日志
            if (currentUser) {
                const accessibleIds = getAccessibleAccountIds(req);
                list = list.filter(log => {
                    const logAccountId = log.accountId || log.id;
                    return accessibleIds.includes(logAccountId);
                });
            }

            // 与当前 web 前端保持一致：直接返回数组
            res.json(list);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 日志
    app.get('/api/logs', (req, res) => {
        const queryAccountIdRaw = (req.query.accountId || '').toString().trim();
        const id = queryAccountIdRaw ? (queryAccountIdRaw === 'all' ? '' : resolveAccId(queryAccountIdRaw)) : getAccId(req);
        const currentUser = req.currentUser;

        // 必须登录才能查看日志
        if (!currentUser) {
            return res.status(401).json({ ok: false, error: '未登录' });
        }

        // 如果指定了账号ID，检查权限
        if (id && !checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        // 如果没有指定账号ID，获取当前用户可访问的所有账号的日志
        if (!id) {
            // 所有用户（包括管理员）只能获取自己可访问账号的日志
            const accessibleIds = getAccessibleAccountIds(req);
            const allLogs = [];
            const options = {
                limit: Number.Number.parseInt(req.query.limit) || 100,
                tag: req.query.tag || '',
                module: req.query.module || '',
                event: req.query.event || '',
                keyword: req.query.keyword || '',
                isWarn: req.query.isWarn,
                timeFrom: req.query.timeFrom || '',
                timeTo: req.query.timeTo || '',
            };

            // 获取每个可访问账号的日志
            for (const accId of accessibleIds) {
                const logs = provider.getLogs(accId, options);
                if (Array.isArray(logs)) {
                    allLogs.push(...logs);
                }
            }

            // 按时间排序并限制数量
            allLogs.sort((a, b) => (b.time || 0) - (a.time || 0));
            const limitedLogs = allLogs.slice(0, options.limit);

            return res.json({ ok: true, data: limitedLogs });
        }

        // 指定了账号ID且通过权限检查，返回该账号的日志
        const options = {
            limit: Number.Number.parseInt(req.query.limit) || 100,
            tag: req.query.tag || '',
            module: req.query.module || '',
            event: req.query.event || '',
            keyword: req.query.keyword || '',
            isWarn: req.query.isWarn,
            timeFrom: req.query.timeFrom || '',
            timeTo: req.query.timeTo || '',
        };
        const list = provider.getLogs(id, options);
        res.json({ ok: true, data: list });
    });

    // API: 清空当前账号运行日志
    app.delete('/api/logs', (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const data = provider.clearLogs(id);

            if (io && provider && typeof provider.getLogs === 'function') {
                const accountLogs = provider.getLogs(id, { limit: 100 });
                io.to(`account:${id}`).emit('logs:snapshot', {
                    accountId: id,
                    logs: Array.isArray(accountLogs) ? accountLogs : [],
                });

                const allLogs = provider.getLogs('', { limit: 100 });
                io.to('account:all').emit('logs:snapshot', {
                    accountId: 'all',
                    logs: Array.isArray(allLogs) ? allLogs : [],
                });
            }

            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // ============ QR Code Login APIs (无需账号选择) ============
    // 这些接口不需要 authRequired 也能调用（用于登录流程）
    app.post('/api/qr/create', async (req, res) => {
        try {
            const result = await MiniProgramLoginSession.requestLoginCode();
            res.json({ ok: true, data: result });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/qr/check', async (req, res) => {
        const { code } = req.body || {};
        if (!code) {
            return res.status(400).json({ ok: false, error: 'Missing code' });
        }

        try {
            const result = await MiniProgramLoginSession.queryStatus(code);

            if (result.status === 'OK') {
                const ticket = result.ticket;
                const uin = result.uin || '';
                const nickname = result.nickname || ''; // 获取昵称
                const appid = '1112386029'; // Farm appid

                const authCode = await MiniProgramLoginSession.getAuthCode(ticket, appid);

                let avatar = '';
                if (uin) {
                    avatar = `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=640`;
                }

                res.json({ ok: true, data: { status: 'OK', code: authCode, uin, avatar, nickname } });
            } else if (result.status === 'Used') {
                res.json({ ok: true, data: { status: 'Used' } });
            } else if (result.status === 'Wait') {
                res.json({ ok: true, data: { status: 'Wait' } });
            } else {
                res.json({ ok: true, data: { status: 'Error', error: result.msg } });
            }
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ 微信扫码登录（服务端持有上游凭证和会话） ============
    const handleWxLoginError = (res, error) => {
        if (error instanceof WxLoginSessionError) {
            return res.status(error.statusCode).json({ ok: false, error: error.message, code: error.code });
        }
        adminLogger.warn('WX QR login failed', { errorType: error && error.name ? error.name : 'Error' });
        return res.status(502).json({ ok: false, error: '微信扫码服务暂时不可用，请稍后重试' });
    };

    app.post('/api/wx-login/qr', async (req, res) => {
        try {
            const result = await wxLoginSessionManager.create(
                req.currentUser && req.currentUser.username,
                getWxLoginRuntimeConfig(),
            );
            res.json({ ok: true, data: result });
        } catch (error) {
            handleWxLoginError(res, error);
        }
    });

    app.get('/api/admin/wx-config/health', authRequired, adminRequired, async (req, res) => {
        try {
            const config = getWxLoginRuntimeConfig();
            const client = new WxLoginClient(config, { timeoutMs: 5000 });
            const result = await client.probe();
            res.json({
                ok: true,
                data: {
                    status: 'reachable',
                    reachable: result.reachable,
                    statusCode: result.statusCode,
                    checkedAt: Date.now(),
                },
            });
        } catch (error) {
            const safeError = error instanceof WxLoginClientError
                ? error
                : new WxLoginClientError('微信登录服务暂时不可用，请稍后重试', 503, 'WX_LOGIN_SERVICE_UNAVAILABLE');
            res.status(safeError.statusCode).json({
                ok: false,
                data: { status: 'unavailable', reachable: false, checkedAt: Date.now() },
                error: safeError.message,
                code: safeError.code,
            });
        }
    });

    app.post('/api/wx-login/check', async (req, res) => {
        const sessionId = String((req.body && req.body.sessionId) || '').trim();
        if (!sessionId) return res.status(400).json({ ok: false, error: '缺少微信扫码会话 ID' });
        try {
            const result = await wxLoginSessionManager.check(sessionId, req.currentUser && req.currentUser.username);
            res.json({ ok: true, data: result });
        } catch (error) {
            handleWxLoginError(res, error);
        }
    });

    app.post('/api/wx-login/code', async (req, res) => {
        const sessionId = String((req.body && req.body.sessionId) || '').trim();
        if (!sessionId) return res.status(400).json({ ok: false, error: '缺少微信扫码会话 ID' });
        try {
            const result = await wxLoginSessionManager.getCode(sessionId, req.currentUser && req.currentUser.username);
            res.json({ ok: true, data: result });
        } catch (error) {
            handleWxLoginError(res, error);
        }
    });

    app.delete('/api/wx-login/:sessionId', (req, res) => {
        try {
            wxLoginSessionManager.cancel(req.params.sessionId, req.currentUser && req.currentUser.username);
            res.json({ ok: true });
        } catch (error) {
            handleWxLoginError(res, error);
        }
    });

    app.post('/api/proxy', (req, res) => {
        res.status(410).json({ code: -1, msg: '微信扫码接口已升级，请刷新页面后重试' });
    });

    app.get('*', (req, res) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/game-config')) {
             return res.status(404).json({ ok: false, error: 'Not Found' });
        }
        if (fs.existsSync(webDist)) {
            res.sendFile(path.join(webDist, 'index.html'));
        } else {
            res.status(404).send('web build not found. Please build the web project.');
        }
    });

    const applySocketSubscription = (socket, accountRef = '') => {
        const incoming = String(accountRef || '').trim();
        const resolved = incoming && incoming !== 'all' ? resolveAccId(incoming) : '';

        // 获取当前用户信息
        const token = socket.data.adminToken;
        const currentUser = token ? tokenUserMap.get(token) : null;

        // 检查权限：如果指定了账号ID，检查用户是否有权访问
        if (resolved && currentUser) {
            // 管理员可以访问所有账号
            if (currentUser.role !== 'admin') {
                const accounts = getAccountList();
                const account = accounts.find(a => a.id === resolved);
                if (!account || account.username !== currentUser.username) {
                    // 无权访问，拒绝订阅
                    socket.emit('subscribed', { accountId: 'all', error: '无权访问此账号' });
                    // 只订阅all频道（空数据）
                    for (const room of socket.rooms) {
                        if (room.startsWith('account:')) socket.leave(room);
                    }
                    socket.join('account:all');
                    socket.data.accountId = '';
                    return;
                }
            }
        }

        for (const room of socket.rooms) {
            if (room.startsWith('account:')) socket.leave(room);
        }
        if (resolved) {
            socket.join(`account:${resolved}`);
            socket.data.accountId = resolved;
        } else {
            socket.join('account:all');
            socket.data.accountId = '';
        }
        socket.emit('subscribed', { accountId: socket.data.accountId || 'all' });

        try {
            const targetId = socket.data.accountId || '';
            const user = socket.data.user;

            if (targetId && provider && typeof provider.getStatus === 'function') {
                const currentStatus = provider.getStatus(targetId);
                socket.emit('status:update', { accountId: targetId, status: currentStatus });
            }
            if (provider && typeof provider.getLogs === 'function') {
                let currentLogs = provider.getLogs(targetId, { limit: 100 });
                if (!Array.isArray(currentLogs)) currentLogs = [];

                // 过滤日志：只返回用户有权限访问的账号的日志
                if (user) {
                    const accessibleIds = getAccessibleAccountIdsForUser(user);
                    currentLogs = currentLogs.filter(log => {
                        const logAccountId = log.accountId || log.id;
                        // 如果没有账号ID，只返回给用户自己的日志（系统日志）
                        if (!logAccountId) return true;
                        return accessibleIds.includes(logAccountId);
                    });
                }

                socket.emit('logs:snapshot', {
                    accountId: targetId || 'all',
                    logs: currentLogs,
                });
            }
            if (provider && typeof provider.getAccountLogs === 'function') {
                let currentAccountLogs = provider.getAccountLogs(100);
                if (!Array.isArray(currentAccountLogs)) currentAccountLogs = [];

                // 过滤账号操作日志：只返回用户有权限访问的账号的日志
                if (user) {
                    const accessibleIds = getAccessibleAccountIdsForUser(user);
                    currentAccountLogs = currentAccountLogs.filter(log => {
                        const logAccountId = log.accountId || log.id;
                        return accessibleIds.includes(logAccountId);
                    });
                }

                socket.emit('account-logs:snapshot', {
                    logs: currentAccountLogs,
                });
            }
        } catch {
            // ignore snapshot push errors
        }
    };

    const port = CONFIG.adminPort || 3007;
    server = app.listen(port, '0.0.0.0', () => {
        adminLogger.info('admin panel started', { url: `http://localhost:${port}`, port });
    });

    io = new SocketIOServer(server, {
        path: '/socket.io',
        cors: {
            origin(origin, callback) {
                const allowedOrigins = CONFIG.ALLOWED_ORIGINS || [
                    'http://localhost:5173',
                    'http://localhost:3000',
                    'http://127.0.0.1:5173',
                ];
                if (!origin || allowedOrigins.includes(origin)) {
                    return callback(null, true);
                }
                return callback(new Error('Origin not allowed'));
            },
            methods: ['GET', 'POST'],
            allowedHeaders: ['x-admin-token', 'x-account-id'],
        },
    });

    io.use((socket, next) => {
        const authToken = socket.handshake.auth && socket.handshake.auth.token
            ? String(socket.handshake.auth.token)
            : '';
        const headerToken = socket.handshake.headers && socket.handshake.headers['x-admin-token']
            ? String(socket.handshake.headers['x-admin-token'])
            : '';
        const token = authToken || headerToken;
        const currentUser = getValidSessionUser(token);
        if (!currentUser) {
            return next(new Error('Unauthorized'));
        }
        socket.data.adminToken = token;
        // 存储用户信息到socket
        socket.data.user = currentUser;
        return next();
    });

    io.on('connection', (socket) => {
        const initialAccountRef = (socket.handshake.auth && socket.handshake.auth.accountId)
            || (socket.handshake.query && socket.handshake.query.accountId)
            || '';
        applySocketSubscription(socket, initialAccountRef);
        socket.emit('ready', { ok: true, ts: Date.now() });

        socket.on('subscribe', (payload) => {
            const body = (payload && typeof payload === 'object') ? payload : {};
            applySocketSubscription(socket, body.accountId || '');
        });
    });
}

function stopAdminServer() {
    try { resetRateLimitStore(); } catch { /* ignore */ }
    for (const timer of runtimeTimers) {
        clearInterval(timer);
    }
    runtimeTimers = [];
    if (io) {
        try { io.close(); } catch { /* ignore */ }
        io = null;
    }
    if (server) {
        try { server.close(); } catch { /* ignore */ }
        server = null;
    }
    app = null;
    provider = null;
}

module.exports = {
    startAdminServer,
    stopAdminServer,
    // test helper
    resetPublicRateLimits: resetRateLimitStore,
    emitRealtimeStatus,
    emitRealtimeLog,
    emitRealtimeAccountLog,
};
