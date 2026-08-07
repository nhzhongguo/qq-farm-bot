const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-session-test-'));
process.env.FARM_DATA_DIR = dataDir;

const sessionStore = require('../src/services/session-store');

test.after(() => {
    sessionStore.flush();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test('sessions persist across reload and only store token hashes', () => {
    const token = 'raw-token-1';
    sessionStore.create(token, 'alice', { absoluteTtlMs: 60_000 });
    sessionStore.flush();

    const raw = fs.readFileSync(path.join(dataDir, 'sessions.json'), 'utf8');
    assert.equal(raw.includes(token), false);

    sessionStore.reload();
    const restored = sessionStore.get(token, { idleTtlMs: 60_000 });
    assert.equal(restored && restored.username, 'alice');
});

test('touch refreshes idle time and expired sessions are removed', () => {
    const token = 'raw-token-2';
    sessionStore.create(token, 'bob', { absoluteTtlMs: 60_000 });
    const now = Date.now() + 5_000;
    const touched = sessionStore.touch(token, { idleTtlMs: 10_000, now });
    assert.equal(touched && touched.lastSeenAt, now);
    assert.equal(sessionStore.touch(token, { idleTtlMs: 10_000, now: now + 10_000 }), null);
});

test('absolute expiry is enforced after reload', () => {
    const token = 'raw-token-3';
    sessionStore.create(token, 'carol', { absoluteTtlMs: 5_000 });
    sessionStore.flush();
    sessionStore.reload();
    assert.equal(sessionStore.get(token, { idleTtlMs: 60_000, now: Date.now() + 5_000 }), null);
});

test('sessions can be removed or renamed by username', () => {
    sessionStore.create('raw-token-4', 'dave', { absoluteTtlMs: 60_000 });
    sessionStore.create('raw-token-5', 'dave', { absoluteTtlMs: 60_000 });
    assert.equal(sessionStore.removeByUsername('dave').length, 2);
    assert.equal(sessionStore.get('raw-token-4', { idleTtlMs: 60_000 }), null);

    sessionStore.create('raw-token-6', 'erin', { absoluteTtlMs: 60_000 });
    sessionStore.renameUser('erin', 'erin_new');
    assert.equal(sessionStore.get('raw-token-6', { idleTtlMs: 60_000 }).username, 'erin_new');
});
