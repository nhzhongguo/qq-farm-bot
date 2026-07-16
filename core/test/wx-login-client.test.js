const assert = require('node:assert/strict');
const test = require('node:test');
const { Readable } = require('node:stream');
const { WxLoginClient, WxLoginClientError, isValidWxFarmCode } = require('../src/services/wx-login-client');

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2X7sAAAAASUVORK5CYII=';
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

test('wechat farm codes follow the upstream 4096 character contract', () => {
    assert.equal(isValidWxFarmCode('short-code'), true);
    assert.equal(isValidWxFarmCode('x'.repeat(4096)), true);
    assert.equal(isValidWxFarmCode('x'.repeat(4097)), false);
    assert.equal(isValidWxFarmCode('bad\ncode'), false);
});

function jsonResponse(payload, options = {}) {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return {
        ok: options.ok === undefined ? true : options.ok,
        status: options.status || 200,
        headers: {
            get: name => name.toLowerCase() === 'content-length' ? options.contentLength || '' : '',
        },
        text: async () => text,
    };
}

function assertClientError(error, expected) {
    assert.ok(error instanceof WxLoginClientError);
    assert.equal(error.code, expected.code);
    assert.equal(error.statusCode, expected.statusCode);
    if (expected.message) assert.match(error.message, expected.message);
    return true;
}

test('apiKey mode uses query authentication and normalizes every operation', async () => {
    const calls = [];
    const responses = [
        { code: 0, data: { Uuid: 'uuid-1', QrBase64: PNG_DATA_URL } },
        { code: -2, data: {} },
        { code: 0, data: { Wxid: 'wxid_1', Nickname: '小明' } },
        { code: 0, data: { code: 'farm-code-1' } },
    ];
    const fetchImpl = async (url, options) => {
        calls.push({ url: new URL(url), options });
        return jsonResponse(responses.shift());
    };
    const client = new WxLoginClient({
        apiKey: 'secret key',
        apiUrl: 'https://wx.example.test/api?region=cn',
        appId: 'wx-app-id',
    }, { fetchImpl });

    assert.deepEqual(await client.getQr(), { uuid: 'uuid-1', qrCode: PNG_DATA_URL });
    assert.deepEqual(await client.checkQr('uuid-1'), { status: 'confirming' });
    assert.deepEqual(await client.checkQr('uuid-1'), { status: 'success', wxid: 'wxid_1', nickname: '小明' });
    assert.deepEqual(await client.getFarmCode('wxid_1'), { code: 'farm-code-1' });

    assert.deepEqual(calls.map(call => call.url.searchParams.get('action')), ['getqr', 'checkqr', 'checkqr', 'jslogin']);
    assert.ok(calls.every(call => call.url.searchParams.get('api_key') === 'secret key'));
    assert.equal(calls[0].url.searchParams.get('region'), 'cn');
    assert.deepEqual(JSON.parse(calls[1].options.body), { uuid: 'uuid-1' });
    assert.deepEqual(JSON.parse(calls[3].options.body), { wxid: 'wxid_1', appid: 'wx-app-id' });
});

test('local REST mode uses expected paths and accepts existing field casing', async () => {
    const calls = [];
    const responses = [
        { Success: true, Data: { UUID: 'uuid-local', qrBase64: PNG_BASE64 } },
        { Success: true, Data: { status: 0 } },
        { Success: true, Data: { AcctSectResp: { UserName: 'wx-local', NickName: '本地用户' } } },
        { Success: true, Data: { Code: 'farm-local' } },
    ];
    const client = new WxLoginClient({
        apiBase: 'http://127.0.0.1:8059/api/',
        appId: 'wx-local-app',
    }, {
        fetchImpl: async (url, options) => {
            calls.push({ url: new URL(url), options });
            return jsonResponse(responses.shift());
        },
    });

    assert.deepEqual(await client.getQr(), { uuid: 'uuid-local', qrCode: PNG_DATA_URL });
    assert.deepEqual(await client.checkQr('uuid-local'), { status: 'waiting' });
    assert.deepEqual(await client.checkQr('uuid-local'), { status: 'success', wxid: 'wx-local', nickname: '本地用户' });
    assert.deepEqual(await client.getFarmCode('wx-local'), { code: 'farm-local' });

    assert.deepEqual(calls.map(call => call.url.pathname), [
        '/api/Login/LoginGetQRCar',
        '/api/Login/LoginCheckQR',
        '/api/Login/LoginCheckQR',
        '/api/Wxapp/JSLogin',
    ]);
    assert.equal(calls[1].url.searchParams.get('uuid'), 'uuid-local');
    assert.equal(calls[1].options.body, undefined);
    assert.deepEqual(JSON.parse(calls[3].options.body), { Wxid: 'wx-local', Appid: 'wx-local-app' });
});

test('same-origin QR image URLs are fetched by the backend and converted to data URLs', async () => {
    const calls = [];
    const client = new WxLoginClient({ apiBase: 'https://wx.example.test/api' }, {
        fetchImpl: async (url, options) => {
            calls.push({ url, options });
            if (options.method === 'POST') {
                return jsonResponse({ code: 0, data: { uuid: 'uuid-image', qrCode: 'https://wx.example.test/qr/1.png' } });
            }
            return {
                ok: true,
                status: 200,
                headers: { get: () => 'image/png' },
                body: Readable.from([Buffer.from(PNG_BASE64, 'base64')]),
            };
        },
    });

    assert.deepEqual(await client.getQr(), { uuid: 'uuid-image', qrCode: PNG_DATA_URL });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].options.method, 'GET');
    assert.equal(calls[1].options.redirect, 'error');
});

test('cross-origin QR image URLs are rejected before the browser can request them', async () => {
    let calls = 0;
    const client = new WxLoginClient({ apiBase: 'https://wx.example.test/api' }, {
        fetchImpl: async () => {
            calls += 1;
            return jsonResponse({ code: 0, data: { uuid: 'uuid-image', qrCode: 'https://other.example.test/qr.png' } });
        },
    });

    await assert.rejects(
        client.getQr(),
        error => assertClientError(error, { code: 'WX_LOGIN_UNSAFE_QR_URL', statusCode: 502 }),
    );
    assert.equal(calls, 1);
});

test('missing, disabled, unsafe-protocol, and credentialed configurations are rejected', () => {
    assert.throws(
        () => new WxLoginClient({}),
        error => assertClientError(error, { code: 'WX_LOGIN_NOT_CONFIGURED', statusCode: 503, message: /未配置/ }),
    );
    assert.throws(
        () => new WxLoginClient({ enabled: false, apiBase: 'http://127.0.0.1:8059/api' }),
        error => assertClientError(error, { code: 'WX_LOGIN_DISABLED', statusCode: 503, message: /尚未启用/ }),
    );
    assert.throws(
        () => new WxLoginClient({ apiBase: 'file:///tmp/wx.sock' }),
        error => assertClientError(error, { code: 'WX_LOGIN_INVALID_URL', statusCode: 400 }),
    );
    assert.throws(
        () => new WxLoginClient({ apiBase: 'http://user:password@127.0.0.1:8059/api' }),
        error => assertClientError(error, { code: 'WX_LOGIN_INVALID_URL', statusCode: 400 }),
    );
    assert.throws(
        () => new WxLoginClient({ apiBase: 'http://wx.example.test/api' }),
        error => assertClientError(error, { code: 'WX_LOGIN_INSECURE_URL', statusCode: 400, message: /HTTPS/ }),
    );
});

test('request timeout aborts fetch and returns a 504 client error', async () => {
    let signal;
    const client = new WxLoginClient({ apiBase: 'https://wx.example.test/api' }, {
        timeoutMs: 20,
        fetchImpl: async (url, options) => {
            signal = options.signal;
            return new Promise(() => {});
        },
    });

    await assert.rejects(
        client.getQr(),
        error => assertClientError(error, { code: 'WX_LOGIN_TIMEOUT', statusCode: 504, message: /超时/ }),
    );
    assert.equal(signal.aborted, true);
});

test('connection failure to the default local service has an actionable 503 error', async () => {
    const client = new WxLoginClient({ apiBase: 'http://127.0.0.1:8059/api' }, {
        fetchImpl: async () => {
            throw new Error('connect ECONNREFUSED 127.0.0.1:8059');
        },
    });

    await assert.rejects(
        client.getQr(),
        error => {
            assertClientError(error, { code: 'WX_LOCAL_SERVICE_UNAVAILABLE', statusCode: 503, message: /本机微信协议服务未启动/ });
            assert.doesNotMatch(error.message, /127\.0\.0\.1|8059|ECONNREFUSED/);
            return true;
        },
    );
});

test('health probe uses a credential-free GET request and treats any HTTP response as reachable', async () => {
    let receivedUrl = '';
    let receivedOptions = null;
    const client = new WxLoginClient({ apiKey: 'private-api-key', proxyApiUrl: 'https://wx.example.test/api' }, {
        fetchImpl: async (url, options) => {
            receivedUrl = url;
            receivedOptions = options;
            return { status: 404 };
        },
    });

    assert.deepEqual(await client.probe(), { reachable: true, statusCode: 404 });
    assert.equal(receivedOptions.method, 'GET');
    assert.equal('body' in receivedOptions, false);
    assert.doesNotMatch(receivedUrl, /private-api-key|api_key/);
});

test('response body is capped at one megabyte while streaming', async () => {
    const oversized = Buffer.alloc((1024 * 1024) + 1, 0x61);
    const client = new WxLoginClient({ apiBase: 'https://wx.example.test/api' }, {
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            headers: { get: () => '' },
            body: Readable.from([oversized]),
        }),
    });

    await assert.rejects(
        client.getQr(),
        error => assertClientError(error, { code: 'WX_LOGIN_RESPONSE_TOO_LARGE', statusCode: 502, message: /响应过大/ }),
    );
});

test('invalid JSON and missing normalized fields are rejected', async () => {
    const invalidJsonClient = new WxLoginClient({ apiBase: 'https://wx.example.test/api' }, {
        fetchImpl: async () => jsonResponse('<html>bad gateway</html>'),
    });
    await assert.rejects(
        invalidJsonClient.getQr(),
        error => assertClientError(error, { code: 'WX_LOGIN_INVALID_JSON', statusCode: 502 }),
    );

    const incompleteClient = new WxLoginClient({ apiBase: 'https://wx.example.test/api' }, {
        fetchImpl: async () => jsonResponse({ Success: true, Data: { Uuid: 'uuid-only' } }),
    });
    await assert.rejects(
        incompleteClient.getQr(),
        error => assertClientError(error, { code: 'WX_LOGIN_INVALID_RESPONSE', statusCode: 502 }),
    );
});

test('api keys are redacted from upstream business errors', async () => {
    const client = new WxLoginClient({
        apiKey: 'never-return-this-key',
        proxyApiUrl: 'https://wx.example.test/api',
    }, {
        fetchImpl: async () => jsonResponse({ code: 500, msg: 'bad key never-return-this-key' }),
    });

    await assert.rejects(client.getQr(), (error) => {
        assertClientError(error, { code: 'WX_LOGIN_UPSTREAM_REJECTED', statusCode: 502 });
        assert.doesNotMatch(error.message, /never-return-this-key/);
        assert.match(error.message, /\[已隐藏\]/);
        assert.equal('apiKey' in error, false);
        return true;
    });
    assert.doesNotMatch(JSON.stringify(client), /never-return-this-key/);
});
