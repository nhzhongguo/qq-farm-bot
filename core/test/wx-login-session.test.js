const assert = require('node:assert/strict');
const test = require('node:test');
const { WxLoginSessionError, WxLoginSessionManager } = require('../src/services/wx-login-session');

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function createFakeClient(overrides = {}) {
    return {
        getQr: async () => ({
            uuid: 'private-upstream-uuid',
            qrCode: 'data:image/png;base64,abc',
        }),
        checkQr: async () => ({ status: 'waiting' }),
        getFarmCode: async () => ({ code: 'farm-code-1' }),
        ...overrides,
    };
}

function idSequence(prefix = 'wx-session') {
    let next = 0;
    return () => `${prefix}-${++next}`;
}

function assertSessionError(error, expected) {
    assert.ok(error instanceof WxLoginSessionError);
    assert.equal(error.statusCode, expected.statusCode);
    assert.equal(error.code, expected.code);
    if (expected.message) assert.match(error.message, expected.message);
    return true;
}

test('create binds the session to its owner and hides all upstream credentials', async () => {
    const seenConfigs = [];
    const seenUuids = [];
    const manager = new WxLoginSessionManager({
        clientFactory: (config) => {
            seenConfigs.push(config);
            return createFakeClient({
                checkQr: async (uuid) => {
                    seenUuids.push(uuid);
                    return { status: 'waiting' };
                },
            });
        },
        randomId: () => 'public-session-id',
    });

    const created = await manager.create('alice', { apiKey: 'private-api-key' });
    assert.deepEqual(Object.keys(created).sort(), ['expiresAt', 'qrCode', 'sessionId']);
    assert.equal(created.sessionId, 'public-session-id');
    assert.doesNotMatch(JSON.stringify(created), /private-upstream-uuid|private-api-key|wxid/i);
    assert.deepEqual(seenConfigs, [{ apiKey: 'private-api-key' }]);

    await assert.rejects(
        manager.check(created.sessionId, 'bob'),
        error => assertSessionError(error, { statusCode: 404, code: 'SESSION_NOT_FOUND' }),
    );
    assert.deepEqual(await manager.check(created.sessionId, 'alice'), {
        status: 'waiting',
        expiresAt: created.expiresAt,
    });
    assert.deepEqual(seenUuids, ['private-upstream-uuid']);
});

test('scan success stores wxid privately and getCode is allowed only afterwards', async () => {
    const codeRequest = createDeferred();
    let checkCalls = 0;
    let codeCalls = 0;
    const manager = new WxLoginSessionManager({
        clientFactory: () => createFakeClient({
            checkQr: async () => {
                checkCalls += 1;
                if (checkCalls === 1) return { status: 'confirming' };
                return { status: 'success', wxid: 'private-wxid', nickname: '小明' };
            },
            getFarmCode: async (wxid) => {
                codeCalls += 1;
                assert.equal(wxid, 'private-wxid');
                return codeRequest.promise;
            },
        }),
        randomId: () => 'session-success',
        checkIntervalMs: 0,
    });

    const created = await manager.create('alice', { apiKey: 'private-api-key' });
    await assert.rejects(
        manager.getCode(created.sessionId, 'alice'),
        error => assertSessionError(error, { statusCode: 409, code: 'SCAN_NOT_COMPLETE' }),
    );
    assert.equal(codeCalls, 0);

    assert.deepEqual(await manager.check(created.sessionId, 'alice'), {
        status: 'confirming',
        expiresAt: created.expiresAt,
    });
    const scanResult = await manager.check(created.sessionId, 'alice');
    assert.deepEqual(scanResult, {
        status: 'success',
        nickname: '小明',
        expiresAt: created.expiresAt,
    });
    assert.doesNotMatch(JSON.stringify(scanResult), /private-wxid|private-upstream-uuid|private-api-key/);

    const firstCode = manager.getCode(created.sessionId, 'alice');
    const concurrentCode = manager.getCode(created.sessionId, 'alice');
    assert.equal(codeCalls, 1);
    codeRequest.resolve({ code: 'farm-code-1' });

    const expected = {
        status: 'success',
        code: 'farm-code-1',
        nickname: '小明',
        expiresAt: created.expiresAt,
    };
    assert.deepEqual(await firstCode, expected);
    assert.deepEqual(await concurrentCode, expected);
    assert.deepEqual(await manager.getCode(created.sessionId, 'alice'), expected);
    assert.equal(codeCalls, 1);

    const cachedScan = await manager.check(created.sessionId, 'alice');
    assert.equal('code' in cachedScan, false);
    assert.equal(checkCalls, 2);
});

test('concurrent checks share one upstream operation and cache successful scan state', async () => {
    const upstreamCheck = createDeferred();
    let checkCalls = 0;
    const manager = new WxLoginSessionManager({
        clientFactory: () => createFakeClient({
            checkQr: async () => {
                checkCalls += 1;
                return upstreamCheck.promise;
            },
        }),
        randomId: () => 'session-concurrent-check',
        checkIntervalMs: 0,
    });

    const created = await manager.create('alice');
    const first = manager.check(created.sessionId, 'alice');
    const second = manager.check(created.sessionId, 'alice');
    assert.equal(checkCalls, 1);

    upstreamCheck.resolve({ status: 'success', wxid: 'private-wxid', nickname: '并发用户' });
    const expected = {
        status: 'success',
        nickname: '并发用户',
        expiresAt: created.expiresAt,
    };
    assert.deepEqual(await first, expected);
    assert.deepEqual(await second, expected);
    assert.deepEqual(await manager.check(created.sessionId, 'alice'), expected);
    assert.equal(checkCalls, 1);
});

test('expired sessions reject checks and farm-code exchange', async () => {
    let now = 1000;
    const manager = new WxLoginSessionManager({
        clientFactory: () => createFakeClient({
            checkQr: async () => ({ status: 'success', wxid: 'private-wxid', nickname: '过期用户' }),
        }),
        randomId: () => 'session-expired',
        now: () => now,
        ttlMs: 100,
    });

    const created = await manager.create('alice');
    await manager.check(created.sessionId, 'alice');
    now = 1100;

    await assert.rejects(
        manager.getCode(created.sessionId, 'alice'),
        error => assertSessionError(error, { statusCode: 410, code: 'SESSION_EXPIRED' }),
    );
    await assert.rejects(
        manager.check(created.sessionId, 'alice'),
        error => assertSessionError(error, { statusCode: 404, code: 'SESSION_NOT_FOUND' }),
    );
});

test('an in-flight check cannot complete after expiration or cancellation', async () => {
    let now = 1000;
    const upstreamCheck = createDeferred();
    const manager = new WxLoginSessionManager({
        clientFactory: () => createFakeClient({ checkQr: async () => upstreamCheck.promise }),
        randomId: () => 'session-in-flight-expiry',
        now: () => now,
        ttlMs: 100,
        checkIntervalMs: 0,
    });

    const created = await manager.create('alice');
    const check = manager.check(created.sessionId, 'alice');
    const rejected = assert.rejects(
        check,
        error => assertSessionError(error, { statusCode: 410, code: 'SESSION_EXPIRED' }),
    );
    now = 1100;
    upstreamCheck.resolve({ status: 'success', wxid: 'private-wxid', nickname: '过期用户' });
    await rejected;

    const cancelCheck = createDeferred();
    now = 2000;
    const secondManager = new WxLoginSessionManager({
        clientFactory: () => createFakeClient({ checkQr: async () => cancelCheck.promise }),
        randomId: () => 'session-cancelled',
        now: () => now,
        checkIntervalMs: 0,
    });
    const second = await secondManager.create('alice');
    const pending = secondManager.check(second.sessionId, 'alice');
    assert.equal(secondManager.cancel(second.sessionId, 'alice'), true);
    cancelCheck.resolve({ status: 'success', wxid: 'private-wxid', nickname: '取消用户' });
    await assert.rejects(
        pending,
        error => assertSessionError(error, { statusCode: 410, code: 'SESSION_CANCELLED' }),
    );
});

test('refresh replaces the previous owner session and concurrent creates keep the newest generation', async () => {
    const manager = new WxLoginSessionManager({
        clientFactory: () => createFakeClient(),
        randomId: idSequence('refresh'),
        createCooldownMs: 0,
    });

    const first = await manager.create('alice');
    const second = await manager.create('alice');
    await assert.rejects(
        manager.check(first.sessionId, 'alice'),
        error => assertSessionError(error, { statusCode: 404, code: 'SESSION_NOT_FOUND' }),
    );
    assert.equal((await manager.check(second.sessionId, 'alice')).status, 'waiting');

    const qrRequests = [];
    const concurrentManager = new WxLoginSessionManager({
        clientFactory: () => createFakeClient({
            getQr: async () => {
                const request = createDeferred();
                qrRequests.push(request);
                return request.promise;
            },
        }),
        randomId: idSequence('concurrent-create'),
        createCooldownMs: 0,
    });

    const oldCreate = concurrentManager.create('alice');
    const newCreate = concurrentManager.create('alice');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(qrRequests.length, 2);
    qrRequests[1].resolve({ uuid: 'new-private-uuid', qrCode: 'new-qr' });
    const newest = await newCreate;
    qrRequests[0].resolve({ uuid: 'old-private-uuid', qrCode: 'old-qr' });
    await assert.rejects(
        oldCreate,
        error => assertSessionError(error, { statusCode: 409, code: 'CREATE_SUPERSEDED' }),
    );
    assert.equal(newest.qrCode, 'new-qr');
});

test('rapid polling is throttled without another upstream request', async () => {
    let now = 1000;
    let checkCalls = 0;
    const manager = new WxLoginSessionManager({
        clientFactory: () => createFakeClient({
            checkQr: async () => {
                checkCalls += 1;
                return { status: 'waiting' };
            },
        }),
        randomId: () => 'session-throttle',
        now: () => now,
        checkIntervalMs: 1500,
    });

    const created = await manager.create('alice');
    await manager.check(created.sessionId, 'alice');
    const throttled = await manager.check(created.sessionId, 'alice');
    assert.deepEqual(throttled, {
        status: 'waiting',
        expiresAt: created.expiresAt,
        retryAfterMs: 1500,
    });
    assert.equal(checkCalls, 1);

    now = 2500;
    await manager.check(created.sessionId, 'alice');
    assert.equal(checkCalls, 2);
});

test('a synchronous upstream check failure is shared, then can be retried', async () => {
    let checkCalls = 0;
    const manager = new WxLoginSessionManager({
        clientFactory: () => createFakeClient({
            checkQr: () => {
                checkCalls += 1;
                if (checkCalls === 1) throw new Error('temporary failure');
                return Promise.resolve({ status: 'waiting' });
            },
        }),
        randomId: () => 'session-sync-failure',
        checkIntervalMs: 0,
    });

    const created = await manager.create('alice');
    const first = manager.check(created.sessionId, 'alice');
    const duplicate = manager.check(created.sessionId, 'alice');
    await assert.rejects(first, /temporary failure/);
    await assert.rejects(duplicate, /temporary failure/);
    assert.equal(checkCalls, 1);

    assert.equal((await manager.check(created.sessionId, 'alice')).status, 'waiting');
    assert.equal(checkCalls, 2);
});

test('global create and check capacities reject unrelated work but preserve deduplication', async () => {
    const qrRequest = createDeferred();
    const createManager = new WxLoginSessionManager({
        clientFactory: () => createFakeClient({ getQr: async () => qrRequest.promise }),
        randomId: () => 'capacity-create',
        maxCreateInFlight: 1,
    });

    const firstCreate = createManager.create('alice');
    await assert.rejects(
        createManager.create('bob'),
        error => assertSessionError(error, { statusCode: 429, code: 'CREATE_CAPACITY_REACHED' }),
    );
    qrRequest.resolve({ uuid: 'private-uuid', qrCode: 'qr-code' });
    await firstCreate;

    const checkRequest = createDeferred();
    let checkCalls = 0;
    const checkManager = new WxLoginSessionManager({
        clientFactory: () => createFakeClient({
            checkQr: async () => {
                checkCalls += 1;
                return checkRequest.promise;
            },
        }),
        randomId: idSequence('capacity-check'),
        maxCheckInFlight: 1,
        checkIntervalMs: 0,
    });
    const alice = await checkManager.create('alice');
    const bob = await checkManager.create('bob');
    const aliceCheck = checkManager.check(alice.sessionId, 'alice');
    const aliceDuplicate = checkManager.check(alice.sessionId, 'alice');
    await assert.rejects(
        checkManager.check(bob.sessionId, 'bob'),
        error => assertSessionError(error, { statusCode: 429, code: 'CHECK_CAPACITY_REACHED' }),
    );
    assert.equal(checkCalls, 1);
    checkRequest.resolve({ status: 'waiting' });
    await aliceCheck;
    await aliceDuplicate;
});

test('upstream errors retain safe metadata while redacting apiKey, uuid, and wxid', async () => {
    let codeCalls = 0;
    const manager = new WxLoginSessionManager({
        clientFactory: () => createFakeClient({
            checkQr: async () => ({
                status: 'success',
                wxid: 'private-wxid',
                nickname: 'private-wxid',
            }),
            getFarmCode: async () => {
                codeCalls += 1;
                const error = new Error('bad private-api-key private-upstream-uuid private-wxid');
                error.statusCode = 503;
                error.code = 'WX_LOGIN_SERVICE_UNAVAILABLE';
                throw error;
            },
        }),
        randomId: () => 'session-redaction',
        checkIntervalMs: 0,
    });

    const created = await manager.create('alice', { apiKey: 'private-api-key' });
    const scan = await manager.check(created.sessionId, 'alice');
    assert.doesNotMatch(scan.nickname, /private-wxid/);

    const first = manager.getCode(created.sessionId, 'alice');
    const duplicate = manager.getCode(created.sessionId, 'alice');
    for (const request of [first, duplicate]) {
        await assert.rejects(request, (error) => {
            assertSessionError(error, { statusCode: 503, code: 'WX_LOGIN_SERVICE_UNAVAILABLE' });
            assert.doesNotMatch(error.message, /private-api-key|private-upstream-uuid|private-wxid/);
            return true;
        });
    }
    assert.equal(codeCalls, 1);
});
