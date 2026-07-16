const { Buffer } = require('node:buffer');

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_APP_ID = 'wx5306c5978fdb76e4';

class WxLoginClientError extends Error {
    constructor(message, statusCode = 502, code = 'WX_LOGIN_UPSTREAM_ERROR') {
        super(message);
        this.name = 'WxLoginClientError';
        this.statusCode = statusCode;
        this.code = code;
    }
}

function requireString(value, fieldName) {
    const text = String(value === undefined || value === null ? '' : value).trim();
    if (!text || text.length > 512 || hasControlCharacters(text)) {
        throw new WxLoginClientError(`缺少或无效的${fieldName}`, 400, 'WX_LOGIN_INVALID_ARGUMENT');
    }
    return text;
}

function hasControlCharacters(value) {
    for (const character of value) {
        const code = character.charCodeAt(0);
        if (code <= 31 || code === 127) return true;
    }
    return false;
}

function isValidWxFarmCode(value) {
    const code = typeof value === 'string' ? value.trim() : '';
    return Boolean(code) && code.length <= 4096 && !hasControlCharacters(code);
}

function parseServiceUrl(value) {
    let url;
    try {
        url = new URL(String(value || '').trim());
    } catch {
        throw new WxLoginClientError('微信登录服务地址配置无效', 400, 'WX_LOGIN_INVALID_URL');
    }

    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new WxLoginClientError('微信登录服务地址仅支持不含账号密码的 HTTP/HTTPS 地址', 400, 'WX_LOGIN_INVALID_URL');
    }
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname.toLowerCase());
    if (url.protocol === 'http:' && !loopback) {
        throw new WxLoginClientError('远程微信登录服务必须使用 HTTPS', 400, 'WX_LOGIN_INSECURE_URL');
    }

    url.hash = '';
    return url;
}

function appendPath(baseUrl, path) {
    const url = new URL(baseUrl.toString());
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
    return url;
}

function getHeader(response, name) {
    if (!response || !response.headers) return '';
    if (typeof response.headers.get === 'function') return response.headers.get(name) || '';
    const key = Object.keys(response.headers).find(item => item.toLowerCase() === name.toLowerCase());
    return key ? response.headers[key] : '';
}

async function readResponseBuffer(response, maxBytes) {
    const declaredLength = Number(getHeader(response, 'content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        throw new WxLoginClientError('微信登录服务响应过大', 502, 'WX_LOGIN_RESPONSE_TOO_LARGE');
    }

    const chunks = [];
    let totalBytes = 0;
    const addChunk = (chunk) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buffer.length;
        if (totalBytes > maxBytes) {
            throw new WxLoginClientError('微信登录服务响应过大', 502, 'WX_LOGIN_RESPONSE_TOO_LARGE');
        }
        chunks.push(buffer);
    };

    const body = response && response.body;
    if (body && typeof body.getReader === 'function') {
        const reader = body.getReader();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                addChunk(value);
            }
        } catch (error) {
            if (error instanceof WxLoginClientError) {
                await reader.cancel().catch(() => {});
            }
            throw error;
        } finally {
            reader.releaseLock();
        }
        return Buffer.concat(chunks, totalBytes);
    }

    if (body && typeof body[Symbol.asyncIterator] === 'function') {
        try {
            for await (const chunk of body) addChunk(chunk);
        } catch (error) {
            if (error instanceof WxLoginClientError && typeof body.destroy === 'function') body.destroy();
            throw error;
        }
        return Buffer.concat(chunks, totalBytes);
    }

    if (response && typeof response.text === 'function') {
        const text = await response.text();
        addChunk(text);
        return Buffer.concat(chunks, totalBytes);
    }

    throw new WxLoginClientError('微信登录服务返回了无效响应', 502, 'WX_LOGIN_INVALID_RESPONSE');
}

async function readResponseText(response, maxBytes) {
    return (await readResponseBuffer(response, maxBytes)).toString('utf8');
}

function detectImageMime(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 8) return '';
    if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'image/png';
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
    if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
    return '';
}

function normalizeInlineQrImage(value, maxBytes) {
    const text = String(value || '').trim();
    if (!text || hasControlCharacters(text)) return '';

    const dataMatch = text.match(/^data:image\/(?:png|jpeg|webp);base64,([a-z0-9+/=]+)$/i);
    const encoded = dataMatch ? dataMatch[1] : text;
    if (!/^[a-z0-9+/=]+$/i.test(encoded)) return '';

    const buffer = Buffer.from(encoded, 'base64');
    if (!buffer.length || buffer.length > maxBytes) return '';
    const mime = detectImageMime(buffer);
    if (!mime) return '';
    return `data:${mime};base64,${buffer.toString('base64')}`;
}

function parseJsonObject(text) {
    let payload;
    try {
        payload = JSON.parse(text);
    } catch {
        throw new WxLoginClientError('微信登录服务返回的不是有效 JSON', 502, 'WX_LOGIN_INVALID_JSON');
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new WxLoginClientError('微信登录服务返回了无效 JSON 数据', 502, 'WX_LOGIN_INVALID_JSON');
    }
    return payload;
}

function getData(payload) {
    const data = payload.Data || payload.data;
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

function firstString(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
}

function numericCode(payload) {
    const value = payload.code === undefined ? payload.Code : payload.code;
    if (value === '' || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function responseSucceeded(payload) {
    if (payload.Success === true || payload.success === true) return true;
    return numericCode(payload) === 0;
}

function sanitizeUpstreamMessage(payload, secret) {
    const data = getData(payload);
    let message = firstString(
        payload.Message,
        payload.message,
        payload.msg,
        data.Message,
        data.message,
        data.msg,
        data.jsapiBaseresponse && data.jsapiBaseresponse.errmsg,
        data.JsapiBaseresponse && data.JsapiBaseresponse.Errmsg,
    );
    message = Array.from(message, character => hasControlCharacters(character) ? ' ' : character)
        .join('')
        .replace(/\s+/g, ' ')
        .slice(0, 200);
    if (secret) {
        message = message.split(secret).join('[已隐藏]');
        const encodedSecret = encodeURIComponent(secret);
        if (encodedSecret !== secret) message = message.split(encodedSecret).join('[已隐藏]');
    }
    return message;
}

function upstreamFailure(payload, secret, fallback) {
    const message = sanitizeUpstreamMessage(payload, secret);
    return new WxLoginClientError(message || fallback, 502, 'WX_LOGIN_UPSTREAM_REJECTED');
}

function isLoopbackService(url) {
    const hostname = url.hostname.toLowerCase();
    return ['127.0.0.1', 'localhost', '[::1]'].includes(hostname);
}

class WxLoginClient {
    constructor(config, options = {}) {
        const source = config && typeof config === 'object' ? config : {};
        if (source.enabled === false) {
            throw new WxLoginClientError('微信扫码登录尚未启用，请先在管理设置中启用', 503, 'WX_LOGIN_DISABLED');
        }

        const apiKey = String(source.apiKey || '').trim();
        if (apiKey && hasControlCharacters(apiKey)) {
            throw new WxLoginClientError('微信登录 API Key 配置无效', 400, 'WX_LOGIN_INVALID_API_KEY');
        }
        Object.defineProperty(this, 'apiKey', {
            configurable: false,
            enumerable: false,
            value: apiKey,
            writable: false,
        });
        this.appId = String(source.appId || DEFAULT_APP_ID).trim();
        this.mode = this.apiKey ? 'apiKey' : 'local';

        const endpoint = this.mode === 'apiKey'
            ? source.apiUrl || source.proxyApiUrl
            : source.apiBase;
        if (!String(endpoint || '').trim()) {
            throw new WxLoginClientError('未配置微信登录服务，请先在管理设置中完成配置', 503, 'WX_LOGIN_NOT_CONFIGURED');
        }

        this.baseUrl = parseServiceUrl(endpoint);
        this.fetchImpl = options.fetchImpl || globalThis.fetch;
        if (typeof this.fetchImpl !== 'function') {
            throw new WxLoginClientError('当前运行环境不支持微信登录请求', 503, 'WX_LOGIN_FETCH_UNAVAILABLE');
        }

        this.timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
            ? options.timeoutMs
            : DEFAULT_TIMEOUT_MS;
        this.maxResponseBytes = Number.isFinite(options.maxResponseBytes) && options.maxResponseBytes > 0
            ? options.maxResponseBytes
            : DEFAULT_MAX_RESPONSE_BYTES;
    }

    buildRequest(action, params) {
        if (this.mode === 'apiKey') {
            const url = new URL(this.baseUrl.toString());
            url.searchParams.set('api_key', this.apiKey);
            url.searchParams.set('action', action);
            return { url, body: params };
        }

        if (action === 'getqr') {
            return { url: appendPath(this.baseUrl, 'Login/LoginGetQRCar'), body: {} };
        }
        if (action === 'checkqr') {
            const url = appendPath(this.baseUrl, 'Login/LoginCheckQR');
            url.searchParams.set('uuid', params.uuid);
            return { url, body: null };
        }
        if (action === 'jslogin') {
            return {
                url: appendPath(this.baseUrl, 'Wxapp/JSLogin'),
                body: { Wxid: params.wxid, Appid: params.appid },
            };
        }
        throw new WxLoginClientError('不支持的微信登录操作', 400, 'WX_LOGIN_INVALID_ACTION');
    }

    async request(action, params = {}) {
        const { url, body } = this.buildRequest(action, params);
        const controller = new AbortController();
        let timedOut = false;
        let timer;

        const timeout = new Promise((resolve, reject) => {
            timer = setTimeout(() => {
                timedOut = true;
                controller.abort();
                reject(new WxLoginClientError('微信登录服务请求超时，请稍后重试', 504, 'WX_LOGIN_TIMEOUT'));
            }, this.timeoutMs);
        });

        const fetchRequest = (async () => {
            const options = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                redirect: 'error',
                signal: controller.signal,
            };
            if (body !== null) options.body = JSON.stringify(body);

            const response = await this.fetchImpl(url.toString(), options);
            const text = await readResponseText(response, this.maxResponseBytes);
            const payload = parseJsonObject(text);
            const status = Number(response && response.status);
            const httpOk = response && response.ok !== undefined
                ? response.ok
                : !Number.isFinite(status) || (status >= 200 && status < 300);
            if (!httpOk) {
                throw new WxLoginClientError('微信登录服务请求失败，请稍后重试', 502, 'WX_LOGIN_UPSTREAM_HTTP_ERROR');
            }
            return payload;
        })();

        try {
            return await Promise.race([fetchRequest, timeout]);
        } catch (error) {
            if (error instanceof WxLoginClientError) throw error;
            if (timedOut || (error && error.name === 'AbortError')) {
                throw new WxLoginClientError('微信登录服务请求超时，请稍后重试', 504, 'WX_LOGIN_TIMEOUT');
            }
            if (isLoopbackService(this.baseUrl)) {
                throw new WxLoginClientError('本机微信协议服务未启动，请先启动微信协议服务后重试', 503, 'WX_LOCAL_SERVICE_UNAVAILABLE');
            }
            throw new WxLoginClientError('微信登录服务暂时不可用，请稍后重试', 503, 'WX_LOGIN_SERVICE_UNAVAILABLE');
        } finally {
            clearTimeout(timer);
        }
    }

    async probe() {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.min(this.timeoutMs, 5000));
        try {
            const response = await this.fetchImpl(this.baseUrl.toString(), {
                method: 'GET',
                headers: { Accept: 'application/json,text/plain;q=0.9,*/*;q=0.1' },
                redirect: 'error',
                signal: controller.signal,
            });
            const status = Number(response && response.status);
            return {
                reachable: true,
                statusCode: Number.isFinite(status) ? status : 0,
            };
        } catch (error) {
            if (error && error.name === 'AbortError') {
                throw new WxLoginClientError('微信协议服务连通性检查超时', 504, 'WX_LOGIN_HEALTH_TIMEOUT');
            }
            if (isLoopbackService(this.baseUrl)) {
                throw new WxLoginClientError('本机微信协议服务未启动，请先启动微信协议服务后重试', 503, 'WX_LOCAL_SERVICE_UNAVAILABLE');
            }
            throw new WxLoginClientError('微信登录服务暂时不可用，请稍后重试', 503, 'WX_LOGIN_SERVICE_UNAVAILABLE');
        } finally {
            clearTimeout(timer);
        }
    }

    async resolveQrImage(value) {
        const inlineImage = normalizeInlineQrImage(value, this.maxResponseBytes);
        if (inlineImage) return inlineImage;

        let imageUrl;
        try {
            imageUrl = new URL(String(value || '').trim());
        } catch {
            throw new WxLoginClientError('微信登录服务返回了无效二维码图片', 502, 'WX_LOGIN_INVALID_QR_IMAGE');
        }
        if (!['http:', 'https:'].includes(imageUrl.protocol)
            || imageUrl.username
            || imageUrl.password
            || imageUrl.origin !== this.baseUrl.origin) {
            throw new WxLoginClientError('微信登录服务返回了不受信任的二维码地址', 502, 'WX_LOGIN_UNSAFE_QR_URL');
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const response = await this.fetchImpl(imageUrl.toString(), {
                method: 'GET',
                headers: { Accept: 'image/png,image/jpeg,image/webp' },
                redirect: 'error',
                signal: controller.signal,
            });
            if (!response || response.ok === false) {
                throw new WxLoginClientError('微信二维码图片获取失败', 502, 'WX_LOGIN_QR_IMAGE_UNAVAILABLE');
            }
            const buffer = await readResponseBuffer(response, this.maxResponseBytes);
            const mime = detectImageMime(buffer);
            if (!mime) {
                throw new WxLoginClientError('微信登录服务返回了无效二维码图片', 502, 'WX_LOGIN_INVALID_QR_IMAGE');
            }
            return `data:${mime};base64,${buffer.toString('base64')}`;
        } catch (error) {
            if (error instanceof WxLoginClientError) throw error;
            if (error && error.name === 'AbortError') {
                throw new WxLoginClientError('微信二维码图片获取超时', 504, 'WX_LOGIN_QR_IMAGE_TIMEOUT');
            }
            throw new WxLoginClientError('微信二维码图片获取失败', 502, 'WX_LOGIN_QR_IMAGE_UNAVAILABLE');
        } finally {
            clearTimeout(timer);
        }
    }

    async getQr() {
        const payload = await this.request('getqr');
        if (!responseSucceeded(payload)) {
            throw upstreamFailure(payload, this.apiKey, '获取微信二维码失败');
        }

        const data = getData(payload);
        const uuid = firstString(data.Uuid, data.uuid, data.UUID, payload.Uuid, payload.uuid);
        const qrCode = firstString(
            data.QrBase64,
            data.qrBase64,
            data.QRBase64,
            data.QrCode,
            data.qrCode,
            data.qrcode,
            payload.QrBase64,
            payload.qrBase64,
        );
        if (!uuid || !qrCode) {
            throw new WxLoginClientError('微信登录服务返回的二维码数据不完整', 502, 'WX_LOGIN_INVALID_RESPONSE');
        }
        return { uuid, qrCode: await this.resolveQrImage(qrCode) };
    }

    async checkQr(uuidValue) {
        const uuid = requireString(uuidValue, '微信扫码会话 ID');
        const payload = await this.request('checkqr', { uuid });
        const data = getData(payload);
        const account = data.acctSectResp || data.AcctSectResp || data.acctsectresp || {};
        const wxid = firstString(
            data.wxid,
            data.Wxid,
            data.WxId,
            data.userName,
            data.UserName,
            account.userName,
            account.UserName,
            account.username,
        );
        const nickname = firstString(
            data.nickname,
            data.Nickname,
            data.nickName,
            data.NickName,
            account.nickName,
            account.NickName,
            account.nickname,
        ) || '微信用户';

        if (responseSucceeded(payload) && wxid) return { status: 'success', wxid, nickname };

        const code = numericCode(payload);
        const rawStatus = data.status === undefined ? data.Status : data.status;
        const qrStatus = Number(rawStatus);
        if (code === -2 || qrStatus === 1) return { status: 'confirming' };
        if (code === -1 || (responseSucceeded(payload) && (!Number.isFinite(qrStatus) || qrStatus === 0))) {
            return { status: 'waiting' };
        }

        throw upstreamFailure(payload, this.apiKey, '检查微信扫码状态失败');
    }

    async getFarmCode(wxidValue) {
        const wxid = requireString(wxidValue, '微信账号 ID');
        const appid = requireString(this.appId, '微信小程序 App ID');
        const payload = await this.request('jslogin', { wxid, appid });
        if (!responseSucceeded(payload)) {
            throw upstreamFailure(payload, this.apiKey, '获取农场登录 Code 失败');
        }

        const data = getData(payload);
        const code = firstString(data.code, data.Code, data.authCode, data.AuthCode, payload.authCode);
        if (!isValidWxFarmCode(code)) {
            throw new WxLoginClientError('微信登录服务未返回有效的农场登录 Code', 502, 'WX_LOGIN_INVALID_FARM_CODE');
        }
        return { code };
    }
}

module.exports = {
    DEFAULT_MAX_RESPONSE_BYTES,
    DEFAULT_TIMEOUT_MS,
    WxLoginClient,
    WxLoginClientError,
    isValidWxFarmCode,
};
