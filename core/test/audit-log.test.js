const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-audit-test-'));
const auditPath = path.join(dataDir, 'audit_log.json');

const { createAuditLog } = require('../src/services/audit-log');

let auditLog;

before(() => {
    auditLog = createAuditLog({
        filePath: auditPath,
        retentionDays: 30,
        maxRecords: 100,
        now: () => 1000000,
    });
});

after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test('records an audit entry with redacted sensitive fields', () => {
    const entry = auditLog.record({
        actor: 'admin',
        action: 'user.create',
        target: 'username:newuser',
        details: { password: 'MySecret123!', email: 'test@example.com', role: 'user' },
        ip: '127.0.0.1',
        severity: 'info',
    });

    assert.equal(typeof entry.id, 'string');
    assert.ok(entry.id.length > 10);
    assert.equal(entry.actor, 'admin');
    assert.equal(entry.action, 'user.create');
    assert.equal(entry.target, 'username:newuser');
    assert.equal(entry.details.password, 'My****3!');
    assert.equal(entry.details.email, 'test@example.com');
    assert.equal(entry.details.role, 'user');
    assert.equal(entry.ip, '127.0.0.1');
    assert.equal(entry.severity, 'info');
    assert.equal(entry.timestamp, 1000000);
});

test('lists entries with actor filter', () => {
    auditLog.record({ actor: 'admin', action: 'config.update', target: 'system:wxConfig' });
    auditLog.record({ actor: 'user1', action: 'account.start', target: 'account:123' });

    const adminEntries = auditLog.list({ actor: 'admin', limit: 10 });
    assert.ok(adminEntries.every(e => e.actor === 'admin'));

    const allEntries = auditLog.list({ limit: 10 });
    assert.ok(allEntries.length >= 2);
});

test('lists entries with action filter', () => {
    const configEntries = auditLog.list({ action: 'config.update', limit: 10 });
    assert.ok(configEntries.every(e => e.action === 'config.update'));
});

test('lists entries with severity filter', () => {
    auditLog.record({ actor: 'admin', action: 'card.delete', target: 'card:XYZ', severity: 'danger' });

    const dangerEntries = auditLog.list({ severity: 'danger', limit: 10 });
    assert.ok(dangerEntries.every(e => e.severity === 'danger'));
});

test('retains bounded records and drops old entries', () => {
    const shortAudit = createAuditLog({
        filePath: path.join(dataDir, 'audit_short.json'),
        retentionDays: 0,
        maxRecords: 3,
        now: () => 2000000,
    });

    for (let i = 0; i < 5; i++) {
        shortAudit.record({ actor: 'admin', action: 'test', target: `item:${i}` });
    }

    const entries = shortAudit.list({ limit: 10 });
    assert.ok(entries.length <= 3);
});

test('persists entries across instances', () => {
    const audit1 = createAuditLog({ filePath: auditPath });
    audit1.record({ actor: 'persist_test', action: 'test.persist', target: 'test:1' });

    const audit2 = createAuditLog({ filePath: auditPath });
    const entries = audit2.list({ actor: 'persist_test', limit: 10 });
    assert.ok(entries.length >= 1);
    assert.equal(entries[0].action, 'test.persist');
});

test('handles empty and malformed data gracefully', () => {
    fs.writeFileSync(auditPath, 'not json', 'utf8');
    const entries = auditLog.list({ limit: 10 });
    assert.ok(Array.isArray(entries));
});
