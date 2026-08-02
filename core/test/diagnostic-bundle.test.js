const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-diag-test-'));
const diagPath = path.join(dataDir, 'diagnostic_bundles.json');

const { createDiagnosticBundle } = require('../src/services/diagnostic-bundle');

let diag;

before(() => {
    diag = createDiagnosticBundle({
        filePath: diagPath,
        retentionDays: 7,
        maxRecords: 10,
        now: () => 1000000,
    });
});

after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test('generates a diagnostic bundle with redacted sensitive fields', () => {
    const bundle = diag.generate({
        accountId: 'acc-1',
        accountName: 'test-account',
        trigger: 'task_failed',
        taskRuns: [{ id: 'run-1', status: 'failed', error: 'timeout' }],
        statusSnapshot: { online: true, level: 10 },
        recentLogs: [{ level: 'error', message: 'connection lost' }],
        configSummary: { apiKey: 'sk-secret-12345', autoFarm: true, serverUrl: 'http://example.com' },
        error: 'farm task timeout',
    });

    assert.equal(typeof bundle.id, 'string');
    assert.ok(bundle.id.length > 10);
    assert.equal(bundle.accountId, 'acc-1');
    assert.equal(bundle.accountName, 'test-account');
    assert.equal(bundle.trigger, 'task_failed');
    assert.equal(bundle.error, 'farm task timeout');
    assert.equal(bundle.taskRuns.length, 1);
    assert.equal(bundle.statusSnapshot.online, true);
    assert.equal(bundle.recentLogs.length, 1);
    assert.equal(bundle.configSummary.apiKey, 'sk****45');
    assert.equal(bundle.configSummary.autoFarm, true);
    assert.equal(bundle.configSummary.serverUrl, 'http://example.com');
});

test('lists bundles with account filter', () => {
    diag.generate({ accountId: 'acc-1', trigger: 'manual' });
    diag.generate({ accountId: 'acc-2', trigger: 'manual' });

    const acc1Bundles = diag.list({ accountId: 'acc-1', limit: 10 });
    assert.ok(acc1Bundles.every(b => b.accountId === 'acc-1'));

    const allBundles = diag.list({ limit: 10 });
    assert.ok(allBundles.length >= 2);
});

test('gets a bundle by id', () => {
    const bundle = diag.generate({ accountId: 'acc-3', trigger: 'test' });
    const found = diag.get(bundle.id);
    assert.ok(found);
    assert.equal(found.accountId, 'acc-3');
    assert.equal(found.trigger, 'test');
});

test('returns null for non-existent bundle id', () => {
    const found = diag.get('non-existent-id');
    assert.equal(found, null);
});

test('retains bounded records and drops old entries', () => {
    const shortDiag = createDiagnosticBundle({
        filePath: path.join(dataDir, 'diag_short.json'),
        retentionDays: 0,
        maxRecords: 2,
        now: () => 2000000,
    });

    for (let i = 0; i < 4; i++) {
        shortDiag.generate({ accountId: `acc-${i}`, trigger: 'test' });
    }

    const bundles = shortDiag.list({ limit: 10 });
    assert.ok(bundles.length <= 2);
});

test('limits recent logs to 50 entries', () => {
    const logs = Array.from({ length: 100 }, (_, i) => ({ message: `log-${i}` }));
    const bundle = diag.generate({
        accountId: 'acc-logs',
        recentLogs: logs,
    });
    assert.equal(bundle.recentLogs.length, 50);
});

test('handles empty and malformed data gracefully', () => {
    fs.writeFileSync(diagPath, 'not json', 'utf8');
    const bundles = diag.list({ limit: 10 });
    assert.ok(Array.isArray(bundles));
});
