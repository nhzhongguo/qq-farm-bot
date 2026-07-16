const crypto = require('node:crypto');
const { WxLoginClient } = require('./wx-login-client');

const DEFAULT_TTL_MS = 3 * 60 * 1000;
const DEFAULT_CREATE_COOLDOWN_MS = 1500;
const DEFAULT_CHECK_INTERVAL_MS = 1500;
const DEFAULT_MAX_ACTIVE_SESSIONS = 100;
const DEFAULT_MAX_CREATE_IN_FLIGHT = 10;
const DEFAULT_MAX_CHECK_IN_FLIGHT = 25;

class WxLoginSessionError extends Error {
    constructor(message, statusCode = 400, code = 'WX_LOGIN_SESSION_ERROR') {
        super(message);
        this.name = 'WxLoginSessionError';
        this.statusCode = statusCode;
        this.code = code;
    }
}

class WxLoginSessionManager {
    constructor(options = {}) {
        this.clientFactory = options.clientFactory || (config => new WxLoginClient(config));
        this.now = options.now || (() => Date.now());
        this.randomId = options.randomId || (() => crypto.randomUUID());
        this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
        this.createCooldownMs = options.createCooldownMs ?? DEFAULT_CREATE_COOLDOWN_MS;
        this.checkIntervalMs = options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
        this.maxActiveSessions = options.maxActiveSessions ?? DEFAULT_MAX_ACTIVE_SESSIONS;
        this.maxCreateInFlight = options.maxCreateInFlight ?? DEFAULT_MAX_CREATE_IN_FLIGHT;
        this.maxCheckInFlight = options.maxCheckInFlight ?? DEFAULT_MAX_CHECK_IN_FLIGHT;

        this.sessions = new Map();
        this.ownerCreateState = new Map();
        this.createInFlight = 0;
        this.checkInFlight = 0;
    }

    cleanup() {
        const now = this.now();
        for (const [sessionId, session] of this.sessions.entries()) {
            if (session.expiresAt <= now) this.sessions.delete(sessionId);
        }
    }

    async create(owner, config = {}) {
        const ownerKey = this.#normalizeOwner(owner);
        const requestedAt = this.now();
        this.cleanup();

        const previousState = this.ownerCreateState.get(ownerKey) || {
            generation: 0,
            startedAt: Number.NEGATIVE_INFINITY,
        };
        if (requestedAt - previousState.startedAt < this.createCooldownMs) {
            throw new WxLoginSessionError('二维码刷新过于频繁，请稍后重试', 429, 'CREATE_RATE_LIMITED');
        }
        if (this.createInFlight >= this.maxCreateInFlight) {
            throw new WxLoginSessionError('微信扫码服务繁忙，请稍后重试', 429, 'CREATE_CAPACITY_REACHED');
        }

        const ownerSessionIds = this.#ownerSessionIds(ownerKey);
        if (this.sessions.size - ownerSessionIds.length >= this.maxActiveSessions) {
            throw new WxLoginSessionError('微信扫码会话已达上限，请稍后重试', 429, 'SESSION_CAPACITY_REACHED');
        }

        const generation = previousState.generation + 1;
        this.ownerCreateState.set(ownerKey, { generation, startedAt: requestedAt });
        for (const sessionId of ownerSessionIds) this.sessions.delete(sessionId);

        const configSecrets = this.#configSecrets(config);
        this.createInFlight += 1;
        let client;
        let qr;
        try {
            client = await this.clientFactory(config);
            if (!client || typeof client.getQr !== 'function') {
                throw new WxLoginSessionError('微信登录客户端配置无效', 500, 'INVALID_CLIENT');
            }
            qr = await client.getQr();
        } catch (error) {
            if (!this.#isLatestCreate(ownerKey, generation)) {
                throw new WxLoginSessionError('该二维码已被更新的请求替代', 409, 'CREATE_SUPERSEDED');
            }
            throw this.#asSessionError(error, '获取微信二维码失败', configSecrets);
        } finally {
            this.createInFlight = Math.max(0, this.createInFlight - 1);
        }

        if (!this.#isLatestCreate(ownerKey, generation)) {
            throw new WxLoginSessionError('该二维码已被更新的请求替代', 409, 'CREATE_SUPERSEDED');
        }

        const upstreamUuid = this.#privateString(qr && qr.uuid, 512);
        const qrCode = this.#privateString(qr && qr.qrCode, 2 * 1024 * 1024);
        if (!upstreamUuid || !qrCode) {
            throw new WxLoginSessionError('微信登录服务未返回有效二维码', 502, 'INVALID_QR_RESPONSE');
        }

        const createdAt = this.now();
        this.cleanup();
        if (this.sessions.size >= this.maxActiveSessions) {
            throw new WxLoginSessionError('微信扫码会话已达上限，请稍后重试', 429, 'SESSION_CAPACITY_REACHED');
        }

        const sessionId = this.#newSessionId();
        const session = {
            id: sessionId,
            owner: ownerKey,
            client,
            upstreamUuid,
            secrets: [...configSecrets, upstreamUuid],
            qrCode,
            scanStatus: 'waiting',
            nickname: '',
            wxid: '',
            scanResult: null,
            checkPromise: null,
            codePromise: null,
            createdAt,
            expiresAt: createdAt + this.ttlMs,
            nextCheckAt: createdAt,
        };
        this.sessions.set(sessionId, session);

        return {
            sessionId,
            qrCode,
            expiresAt: session.expiresAt,
        };
    }

    async check(sessionId, owner) {
        const { id, session } = this.#getOwnedSession(sessionId, owner);
        this.#assertUsable(id, session);

        if (session.scanStatus === 'success') return session.scanResult;
        if (session.checkPromise) return session.checkPromise;

        const checkedAt = this.now();
        if (checkedAt < session.nextCheckAt) {
            return {
                status: session.scanStatus,
                expiresAt: session.expiresAt,
                retryAfterMs: session.nextCheckAt - checkedAt,
            };
        }
        if (this.checkInFlight >= this.maxCheckInFlight) {
            throw new WxLoginSessionError('微信登录状态检查繁忙，请稍后重试', 429, 'CHECK_CAPACITY_REACHED');
        }

        session.nextCheckAt = checkedAt + this.checkIntervalMs;
        let resolveShared;
        let rejectShared;
        const sharedPromise = new Promise((resolve, reject) => {
            resolveShared = resolve;
            rejectShared = reject;
        });
        session.checkPromise = sharedPromise;
        this.checkInFlight += 1;

        const finish = () => {
            this.checkInFlight = Math.max(0, this.checkInFlight - 1);
            if (session.checkPromise === sharedPromise) session.checkPromise = null;
        };
        this.#checkUpstream(id, session).then(
            (result) => {
                finish();
                resolveShared(result);
            },
            (error) => {
                finish();
                rejectShared(error);
            },
        );
        return sharedPromise;
    }

    async getCode(sessionId, owner) {
        const { id, session } = this.#getOwnedSession(sessionId, owner);
        this.#assertUsable(id, session);

        if (session.scanStatus !== 'success' || !session.wxid) {
            throw new WxLoginSessionError('请先完成微信扫码登录', 409, 'SCAN_NOT_COMPLETE');
        }
        if (!session.codePromise) session.codePromise = this.#exchangeCode(id, session);
        return session.codePromise;
    }

    cancel(sessionId, owner) {
        const ownerKey = this.#normalizeOwner(owner);
        const id = String(sessionId || '').trim();
        const session = this.sessions.get(id);
        if (!session || session.owner !== ownerKey) return false;
        return this.sessions.delete(id);
    }

    async #checkUpstream(sessionId, session) {
        if (!session.client || typeof session.client.checkQr !== 'function') {
            throw new WxLoginSessionError('微信登录客户端配置无效', 500, 'INVALID_CLIENT');
        }

        let upstreamResult;
        try {
            upstreamResult = await session.client.checkQr(session.upstreamUuid);
        } catch (error) {
            throw this.#asSessionError(error, '检查微信扫码状态失败', session.secrets);
        }
        this.#assertUsable(sessionId, session);

        const status = String((upstreamResult && upstreamResult.status) || '').trim().toLowerCase();
        if (status === 'waiting' || status === 'confirming') {
            session.scanStatus = status;
            return { status, expiresAt: session.expiresAt };
        }
        if (status !== 'success') {
            throw new WxLoginSessionError('微信登录服务返回了无效状态', 502, 'INVALID_SCAN_RESPONSE');
        }

        const wxid = this.#privateString(upstreamResult.wxid, 512);
        if (!wxid) {
            throw new WxLoginSessionError('扫码成功，但微信账号信息不完整', 502, 'INVALID_SCAN_RESPONSE');
        }

        session.wxid = wxid;
        session.secrets.push(wxid);
        session.nickname = this.#publicNickname(upstreamResult.nickname, session.secrets);
        session.scanStatus = 'success';
        session.scanResult = {
            status: 'success',
            nickname: session.nickname,
            expiresAt: session.expiresAt,
        };
        return session.scanResult;
    }

    async #exchangeCode(sessionId, session) {
        try {
            if (!session.client || typeof session.client.getFarmCode !== 'function') {
                throw new WxLoginSessionError('微信登录客户端配置无效', 500, 'INVALID_CLIENT');
            }

            let upstreamResult;
            try {
                upstreamResult = await session.client.getFarmCode(session.wxid);
            } catch (error) {
                throw this.#asSessionError(error, '获取农场登录 Code 失败', session.secrets);
            }
            this.#assertUsable(sessionId, session);

            const rawCode = typeof upstreamResult === 'string' ? upstreamResult : upstreamResult && upstreamResult.code;
            const code = this.#privateString(rawCode, 4096);
            if (!code) {
                throw new WxLoginSessionError('微信登录服务未返回有效的农场登录 Code', 502, 'INVALID_FARM_CODE');
            }

            return {
                status: 'success',
                code,
                nickname: session.nickname,
                expiresAt: session.expiresAt,
            };
        } catch (error) {
            throw this.#asSessionError(error, '获取农场登录 Code 失败', session.secrets);
        }
    }

    #getOwnedSession(sessionId, owner) {
        const ownerKey = this.#normalizeOwner(owner);
        const id = String(sessionId || '').trim();
        const session = this.sessions.get(id);
        if (!session || session.owner !== ownerKey) {
            throw new WxLoginSessionError('微信扫码会话不存在或已失效', 404, 'SESSION_NOT_FOUND');
        }
        return { id, session };
    }

    #normalizeOwner(owner) {
        const ownerKey = String(owner || '').trim();
        if (!ownerKey) throw new WxLoginSessionError('未登录', 401, 'UNAUTHORIZED');
        return ownerKey;
    }

    #assertUsable(sessionId, session) {
        if (this.sessions.get(sessionId) !== session) {
            throw new WxLoginSessionError('微信扫码会话已取消', 410, 'SESSION_CANCELLED');
        }
        if (session.expiresAt <= this.now()) {
            this.sessions.delete(sessionId);
            throw new WxLoginSessionError('微信二维码已失效，请刷新后重试', 410, 'SESSION_EXPIRED');
        }
    }

    #isLatestCreate(owner, generation) {
        const state = this.ownerCreateState.get(owner);
        return Boolean(state && state.generation === generation);
    }

    #ownerSessionIds(owner) {
        const ids = [];
        for (const [sessionId, session] of this.sessions.entries()) {
            if (session.owner === owner) ids.push(sessionId);
        }
        return ids;
    }

    #newSessionId() {
        for (let attempt = 0; attempt < 10; attempt += 1) {
            const id = String(this.randomId() || '').trim();
            if (id && id.length <= 512 && !this.sessions.has(id)) return id;
        }
        throw new WxLoginSessionError('无法创建微信扫码会话', 500, 'SESSION_ID_UNAVAILABLE');
    }

    #privateString(value, maxLength) {
        const text = String(value === undefined || value === null ? '' : value).trim();
        if (!text || text.length > maxLength || this.#hasControlCharacters(text)) return '';
        return text;
    }

    #hasControlCharacters(value) {
        for (const character of value) {
            const code = character.charCodeAt(0);
            if (code <= 31 || code === 127) return true;
        }
        return false;
    }

    #publicNickname(value, secrets) {
        const nickname = this.#privateString(value, 100) || '微信用户';
        return this.#redact(nickname, secrets).slice(0, 100) || '微信用户';
    }

    #configSecrets(config) {
        if (!config || typeof config !== 'object') return [];
        return [config.apiKey, config.api_key]
            .map(value => String(value || '').trim())
            .filter(Boolean);
    }

    #redact(value, secrets) {
        let text = Array.from(String(value || ''), (character) => {
            const code = character.charCodeAt(0);
            return code <= 31 || code === 127 ? ' ' : character;
        })
            .join('')
            .replace(/\s+/g, ' ')
            .trim();
        for (const secretValue of secrets || []) {
            const secret = String(secretValue || '');
            if (!secret) continue;
            text = text.split(secret).join('[已隐藏]');
            const encoded = encodeURIComponent(secret);
            if (encoded !== secret) text = text.split(encoded).join('[已隐藏]');
        }
        return text;
    }

    #asSessionError(error, fallbackMessage, secrets = []) {
        if (error instanceof WxLoginSessionError) return error;

        const rawStatus = Number(error && error.statusCode);
        const statusCode = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599
            ? rawStatus
            : 502;
        const rawCode = String((error && error.code) || '').trim();
        const code = /^[A-Z][A-Z0-9_]{1,63}$/.test(rawCode) ? rawCode : 'WX_LOGIN_UPSTREAM_ERROR';
        const message = this.#redact(error && error.message, secrets).slice(0, 200) || fallbackMessage;
        return new WxLoginSessionError(message, statusCode, code);
    }
}

const wxLoginSessionManager = new WxLoginSessionManager();

module.exports = {
    WxLoginSessionError,
    WxLoginSessionManager,
    wxLoginSessionManager,
};
