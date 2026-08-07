const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-session-persist-'));
process.env.FARM_DATA_DIR = dataDir;
process.env.ADMIN_PORT = '13029';
process.env.SESSION_ABSOLUTE_TTL_MS = '60000';
process.env.SESSION_IDLE_TTL_MS = '60000';
delete process.env.FARM_TEST;
delete process.env.NODE_ENV;
delete process.env.ALLOW_INSECURE_TEST_LOGIN;

const { startAdminServer, stopAdminServer } = require('../src/controllers/admin');
const sessionStore = require('../src/services/session-store');

const provider = {
    getSchedulerStatus: async () => ({ runtime: {}, worker: null }),
};

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
                resolve({ status: res.statusCode, json });
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

async function waitReady(timeoutMs = 8000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        try {
            const res = await request('GET', '/api/game-version');
            if (res.status === 200) return;
        } catch {
            // server may still be starting
        }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('admin server did not become ready');
}

test.after(() => {
    stopAdminServer();
    sessionStore.flush();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test('management session survives an admin server restart', async () => {
    startAdminServer(provider);
    await waitReady();

    const login = await request('POST', '/api/login', {
        body: { username: 'admin', password: 'admin' },
    });
    const token = login.json && login.json.data && login.json.data.token;
    assert.equal(typeof token, 'string');

    stopAdminServer();
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Simulate a fresh process by clearing the in-memory store and reading disk again.
    sessionStore.reload();
    startAdminServer(provider);
    await waitReady();

    const validate = await request('GET', '/api/auth/validate', {
        headers: { 'x-admin-token': token },
    });
    assert.equal(validate.status, 200);
    stopAdminServer();
    await new Promise((resolve) => setTimeout(resolve, 200));
});

test('FARM_TEST alone does not bypass password login', async () => {
    process.env.FARM_TEST = '1';
    delete process.env.NODE_ENV;
    delete process.env.ALLOW_INSECURE_TEST_LOGIN;

    startAdminServer(provider);
    await waitReady();

    const withoutPassword = await request('POST', '/api/login', {
        body: { username: 'admin' },
    });
    assert.equal(withoutPassword.status, 401);

    const withPassword = await request('POST', '/api/login', {
        body: { username: 'admin', password: 'admin' },
    });
    assert.equal(withPassword.status, 200);
    stopAdminServer();
});
