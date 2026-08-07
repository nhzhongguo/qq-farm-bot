/**
 * 轻量运行指标：记录 API 请求耗时/错误与 JSON 持久化耗时，提供 p50/p95 汇总。
 * 仅保存在内存（上限 MAX_SAMPLES 条），不落盘、不采集敏感字段。
 * 路由会归一化数字段（如账号 id -> :n），避免账号标识进入指标。
 */
const process = require('node:process');

const MAX_SAMPLES = 2000;

const samples = []; // { kind, method, route, status, durationMs, ts }

/** 供 json-db 在读写完成后上报耗时（fileKind: 'read' | 'write'）。 */
function recordPersistenceSample(fileKind, filePath, durationMs, ok) {
    samples.push({ kind: 'persistence', fileKind, durationMs, ok: Boolean(ok), ts: Date.now() });
    if (samples.length > MAX_SAMPLES) {
        samples.splice(0, samples.length - MAX_SAMPLES);
    }
}

function normalizeRoute(method, pathName) {
    const clean = String(pathName || '/').split('?')[0];
    const normalized = clean.replace(/\/\d+(?=\/|$)/g, '/:n');
    return `${method} ${normalized}`;
}

function recordRequest(method, route, status, durationMs) {
    samples.push({ kind: 'api', method, route, status, durationMs, ts: Date.now() });
    if (samples.length > MAX_SAMPLES) {
        samples.splice(0, samples.length - MAX_SAMPLES);
    }
}

/** Express 计时中间件：在所有 API 路由之前挂载，finish 时记录。 */
function createTimingMiddleware() {
    return (req, res, next) => {
        const started = process.hrtime.bigint();
        res.on('finish', () => {
            const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
            recordRequest(req.method, normalizeRoute(req.method, req.originalUrl || req.url), res.statusCode, durationMs);
        });
        next();
    };
}

function percentile(sorted, p) {
    if (!sorted.length) return 0;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[idx];
}

function summarize(limit = MAX_SAMPLES) {
    const recent = samples.slice(-limit);
    const byRoute = new Map();
    for (const s of recent) {
        if (s.kind !== 'api') continue;
        const list = byRoute.get(s.route);
        if (list) list.push(s);
        else byRoute.set(s.route, [s]);
    }

    const routes = [];
    for (const [route, list] of byRoute) {
        const durations = list.map(x => x.durationMs).sort((a, b) => a - b);
        const errors = list.filter(x => x.status >= 400).length;
        routes.push({
            route,
            count: list.length,
            errors,
            errorRate: list.length ? Math.round((errors / list.length) * 10000) / 10000 : 0,
            p50: Math.round(percentile(durations, 50) * 100) / 100,
            p95: Math.round(percentile(durations, 95) * 100) / 100,
            max: Math.round(durations[durations.length - 1] * 100) / 100,
        });
    }
    routes.sort((a, b) => b.p95 - a.p95 || b.count - a.count);

    const persistence = recent.filter(s => s.kind === 'persistence');
    const writeTimes = persistence.filter(s => s.fileKind === 'write').map(s => s.durationMs).sort((a, b) => a - b);
    const readTimes = persistence.filter(s => s.fileKind === 'read').map(s => s.durationMs).sort((a, b) => a - b);

    return {
        generatedAt: new Date().toISOString(),
        total: recent.length,
        api: { count: recent.filter(s => s.kind === 'api').length, routes },
        persistence: {
            write: {
                count: writeTimes.length,
                p50: Math.round(percentile(writeTimes, 50) * 100) / 100,
                p95: Math.round(percentile(writeTimes, 95) * 100) / 100,
                max: writeTimes.length ? Math.round(writeTimes[writeTimes.length - 1] * 100) / 100 : 0,
            },
            read: {
                count: readTimes.length,
                p50: Math.round(percentile(readTimes, 50) * 100) / 100,
                p95: Math.round(percentile(readTimes, 95) * 100) / 100,
                max: readTimes.length ? Math.round(readTimes[readTimes.length - 1] * 100) / 100 : 0,
            },
        },
    };
}

function clearMetrics() {
    samples.length = 0;
}

module.exports = {
    MAX_SAMPLES,
    createTimingMiddleware,
    recordRequest,
    recordPersistenceSample,
    summarize,
    percentile,
    clearMetrics,
};
