const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-http-test-'));
process.env.FARM_DATA_DIR = dataDir;
process.env.ADMIN_PORT = process.env.ADMIN_PORT || '13019';
process.env.SESSION_ABSOLUTE_TTL_MS = '2000';
process.env.SESSION_IDLE_TTL_MS = '2000';

const { startAdminServer, stopAdminServer, resetPublicRateLimits } = require('../src/controllers/admin');

function request(method, pathName, { headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
        const payload = body == null ? null : Buffer.from(JSON.stringify(body), 'utf8');
        const req = http.request({
            host: '127.0.0.1',
            port: Number(process.env.ADMIN_PORT || 3007),
            method,
            path: pathName,
            headers: {
                ...(payload
                    ? {
                        'Content-Type': 'application/json',
                        'Content-Length': String(payload.length),
                    }
                    : {}),
                ...headers,
            },
        }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                let json = null;
                try { json = JSON.parse(text); } catch { /* non-json */ }
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    text,
                    json,
                });
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

async function waitReady(timeoutMs = 8000) {
    const started = Date.now();
    let lastError = null;
    while (Date.now() - started < timeoutMs) {
        try {
            const res = await request('GET', '/api/game-version');
            if (res.status === 200) return;
            lastError = new Error(`unexpected status ${res.status}`);
        } catch (error) {
            lastError = error;
        }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw lastError || new Error('admin server did not become ready');
}

before(() => {
    startAdminServer({
        getSchedulerStatus: async () => ({ runtime: {}, worker: null }),
    });
});

after(() => {
    stopAdminServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test('security headers and public allowlist', async () => {
    await waitReady();

    const publicRes = await request('GET', '/api/game-version');
    assert.equal(publicRes.status, 200);
    assert.equal(publicRes.headers['x-content-type-options'], 'nosniff');
    assert.equal(publicRes.headers['x-frame-options'], 'SAMEORIGIN');
    assert.equal(publicRes.headers['referrer-policy'], 'no-referrer');
    assert.equal(publicRes.headers['x-powered-by'], undefined);

    const pingRes = await request('GET', '/api/ping');
    assert.equal(pingRes.status, 200);
    assert.equal(pingRes.json?.ok, true);

    const claimStatus = await request('GET', '/api/card-claim/status');
    assert.equal(claimStatus.status, 200);
    assert.equal(claimStatus.json?.ok, true);
});

test('protected api rejects missing token', async () => {
    await waitReady();

    const statusRes = await request('GET', '/api/status');
    assert.equal(statusRes.status, 401);
    assert.equal(statusRes.json?.ok, false);

    const usersRes = await request('GET', '/api/admin/users');
    assert.equal(usersRes.status, 401);

    const schedulerRes = await request('GET', '/api/scheduler');
    assert.equal(schedulerRes.status, 401);
});

test('login issues token and unlocks protected route', async () => {
    await waitReady();

    const loginRes = await request('POST', '/api/login', {
        body: { username: 'admin', password: 'admin' },
    });
    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.json?.ok, true);
    const token = loginRes.json?.data?.token;
    assert.equal(typeof token, 'string');
    assert.ok(token.length > 10);

    const authValidate = await request('GET', '/api/auth/validate', {
        headers: { 'x-admin-token': token },
    });
    assert.equal(authValidate.status, 200);
    assert.equal(authValidate.json?.ok, true);

    const badToken = await request('GET', '/api/auth/validate', {
        headers: { 'x-admin-token': 'not-a-real-token' },
    });
    assert.equal(badToken.status, 401);
});

test('initial administrator must change the default password before accessing operations', async () => {
    await waitReady();

    const loginRes = await request('POST', '/api/login', {
        body: { username: 'admin', password: 'admin' },
    });
    const token = loginRes.json?.data?.token;
    assert.equal(typeof token, 'string');

    const blocked = await request('GET', '/api/scheduler', {
        headers: { 'x-admin-token': token },
    });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json?.code, 'PASSWORD_CHANGE_REQUIRED');

    const changed = await request('POST', '/api/user/change-password', {
        headers: { 'x-admin-token': token },
        body: { oldPassword: 'admin', newPassword: 'Admin123!' },
    });
    assert.equal(changed.status, 200);
    assert.equal(changed.json?.ok, true);

    const scheduler = await request('GET', '/api/scheduler', {
        headers: { 'x-admin-token': token },
    });
    assert.equal(scheduler.status, 200);
});

test('expired management sessions are rejected and removed', async () => {
    await waitReady();

    const loginRes = await request('POST', '/api/login', {
        body: { username: 'admin', password: 'Admin123!' },
    });
    const token = loginRes.json?.data?.token;
    assert.equal(typeof token, 'string');

    await new Promise(resolve => setTimeout(resolve, 2100));

    const expired = await request('GET', '/api/auth/validate', {
        headers: { 'x-admin-token': token },
    });
    assert.equal(expired.status, 401);
    assert.equal(expired.json?.ok, false);
});

test('runtime doctor is admin-only and does not expose local paths', async () => {
    await waitReady();

    const unauthenticated = await request('GET', '/api/admin/doctor');
    assert.equal(unauthenticated.status, 401);

    const loginRes = await request('POST', '/api/login', {
        body: { username: 'admin', password: 'Admin123!' },
    });
    const token = loginRes.json?.data?.token;
    const reportRes = await request('GET', '/api/admin/doctor', {
        headers: { 'x-admin-token': token },
    });

    assert.equal(reportRes.status, 200);
    assert.equal(reportRes.json?.ok, true);
    assert.equal(reportRes.json?.data?.version, '2.4.0');
    assert.equal(Array.isArray(reportRes.json?.data?.checks), true);
    assert.doesNotMatch(JSON.stringify(reportRes.json), /qq-farm-http-test/);
});

test('wechat QR login stays same-origin and reports an unavailable local service', async () => {
    await waitReady();

    const loginRes = await request('POST', '/api/login', {
        body: { username: 'admin', password: 'Admin123!' },
    });
    const token = loginRes.json?.data?.token;
    assert.equal(typeof token, 'string');
    const headers = { 'x-admin-token': token };

    const saveRes = await request('POST', '/api/admin/wx-config', {
        headers,
        body: {
            enabled: true,
            apiBase: 'http://127.0.0.1:1/api',
            apiKey: '',
            proxyApiUrl: 'https://wx.example.test/api',
            appId: 'wx5306c5978fdb76e4',
            autoAddAccount: true,
            userIsolation: true,
        },
    });
    assert.equal(saveRes.status, 200);
    assert.equal('apiKey' in saveRes.json?.data, false);
    assert.equal(saveRes.json?.data?.apiKeyConfigured, false);

    const adminConfig = await request('GET', '/api/admin/wx-config', { headers });
    assert.equal(adminConfig.status, 200);
    assert.equal('apiKey' in adminConfig.json?.data, false);

    const configRes = await request('GET', '/api/user/wxlogin-config', { headers });
    assert.equal(configRes.status, 200);
    assert.equal(configRes.json?.config?.mode, 'local');
    assert.equal('apiBase' in configRes.json.config, false);
    assert.equal('apiKey' in configRes.json.config, false);

    const qrRes = await request('POST', '/api/wx-login/qr', { headers, body: {} });
    assert.equal(qrRes.status, 503);
    assert.equal(qrRes.json?.code, 'WX_LOCAL_SERVICE_UNAVAILABLE');
    assert.match(String(qrRes.json?.error || ''), /本机微信协议服务未启动/);
    assert.doesNotMatch(JSON.stringify(qrRes.json), /127\.0\.0\.1|wx\.example\.test/);
});

test('login endpoint attaches rate-limit headers', async () => {
    await waitReady();
    resetPublicRateLimits();

    const res = await request('POST', '/api/login', {
        body: { username: 'header-check', password: 'wrong-password' },
    });
    // Business-layer invalid login is fine; HTTP middleware must still stamp limit headers.
    assert.ok([401, 423, 429].includes(res.status));
    assert.equal(String(res.headers['x-ratelimit-limit']), '20');
    assert.ok(res.headers['x-ratelimit-remaining'] !== undefined);
});

test('register endpoint enforces HTTP rate limit', async () => {
    await waitReady();
    resetPublicRateLimits();

    let blocked = null;
    for (let i = 0; i < 15; i += 1) {
        const res = await request('POST', '/api/register', {
            body: { username: `u${i}`, password: 'Abc123!', cardCode: 'NOPE' },
        });
        if (res.status === 429) {
            blocked = res;
            break;
        }
    }

    assert.ok(blocked, 'expected register to be rate limited');
    assert.equal(blocked.status, 429);
    assert.equal(blocked.json?.ok, false);
    assert.match(String(blocked.json?.error || ''), /请求过于频繁，请稍后重试/);
    assert.equal(String(blocked.headers['x-ratelimit-limit']), '10');
});

test('card claim endpoint enforces HTTP rate limit', async () => {
    await waitReady();
    resetPublicRateLimits();

    let blocked = null;
    for (let i = 0; i < 15; i += 1) {
        const res = await request('POST', '/api/card-claim/claim', {
            body: {},
        });
        if (res.status === 429) {
            blocked = res;
            break;
        }
    }

    assert.ok(blocked, 'expected card claim to be rate limited');
    assert.equal(blocked.status, 429);
    assert.equal(blocked.json?.ok, false);
    assert.match(String(blocked.json?.error || ''), /请求过于频繁，请稍后重试/);
    assert.equal(String(blocked.headers['x-ratelimit-limit']), '10');
});
