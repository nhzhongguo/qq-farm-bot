const assert = require('node:assert/strict');
const test = require('node:test');

const metrics = require('../src/services/metrics');

test.beforeEach(() => {
    metrics.clearMetrics();
});

test('timing middleware records api samples with normalized route', async () => {
    const middleware = metrics.createTimingMiddleware();

    const req = { method: 'GET', originalUrl: '/api/accounts/42/friends' };
    const res = new (class {
        statusCode = 200;
        handlers = [];

        on(event, handler) {
            if (event === 'finish') this.handlers.push(handler);
        }

        finish() {
            for (const handler of this.handlers) handler();
        }
    })();

    await new Promise((resolve) => {
        middleware(req, res, () => resolve());
    });
    res.finish();

    const summary = metrics.summarize();
    assert.equal(summary.api.count, 1);
    assert.equal(summary.api.routes[0].route, 'GET /api/accounts/:n/friends');
    assert.equal(summary.api.routes[0].count, 1);
    assert.equal(summary.api.routes[0].errors, 0);
});

test('summarize computes p50/p95 and error rate per route', () => {
    metrics.recordRequest('GET', 'GET /api/a', 200, 10);
    metrics.recordRequest('GET', 'GET /api/a', 200, 20);
    metrics.recordRequest('GET', 'GET /api/a', 500, 100);

    const summary = metrics.summarize();
    const route = summary.api.routes.find(r => r.route === 'GET /api/a');
    assert.ok(route);
    assert.equal(route.count, 3);
    assert.equal(route.errors, 1);
    assert.equal(route.errorRate, 0.3333);
    assert.equal(route.p50, 20);
    assert.equal(route.p95, 100);
    assert.equal(route.max, 100);
});

test('persistence samples roll into read/write p50/p95', () => {
    metrics.recordPersistenceSample('write', '/tmp/a.json', 1, true);
    metrics.recordPersistenceSample('write', '/tmp/a.json', 3, true);
    metrics.recordPersistenceSample('read', '/tmp/a.json', 2, true);

    const summary = metrics.summarize();
    assert.equal(summary.persistence.write.count, 2);
    assert.equal(summary.persistence.write.p50, 1);
    assert.equal(summary.persistence.write.p95, 3);
    assert.equal(summary.persistence.read.count, 1);
    assert.equal(summary.persistence.read.p50, 2);
});

test('max samples are bounded and oldest samples are dropped', () => {
    for (let i = 0; i < metrics.MAX_SAMPLES + 10; i++) {
        metrics.recordRequest('GET', `GET /api/route-${i % 3}`, 200, i);
    }
    const summary = metrics.summarize();
    assert.ok(summary.total <= metrics.MAX_SAMPLES);
});
