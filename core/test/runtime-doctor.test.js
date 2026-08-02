const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createRuntimeDoctor } = require('../src/services/runtime-doctor');

function createTempDirectory() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-doctor-'));
}

test('runtime doctor reports a healthy writable data directory and required resources', () => {
    const root = createTempDirectory();
    const dataDir = path.join(root, 'data');
    const resourceFile = path.join(root, 'Plant.json');
    const manifestFile = path.join(root, 'version.json');
    fs.mkdirSync(dataDir);
    fs.writeFileSync(resourceFile, '{}');
    fs.writeFileSync(manifestFile, JSON.stringify({ version: '2.4.0', build: '20260719' }));

    const doctor = createRuntimeDoctor({
        dataDir,
        versionManifestPath: manifestFile,
        requiredResources: [{ id: 'plant-config', label: '植物配置', path: resourceFile }],
    });
    const report = doctor.check();

    assert.equal(report.ok, true);
    assert.equal(report.version, '2.4.0');
    assert.equal(report.checks.some(check => check.id === 'data-directory' && check.status === 'ok'), true);
    assert.equal(report.checks.some(check => check.id === 'plant-config' && check.status === 'ok'), true);
    assert.equal(report.checks.some(check => check.id === 'version-manifest' && check.status === 'ok'), true);
});

test('runtime doctor reports missing resources without throwing or exposing filesystem details', () => {
    const root = createTempDirectory();
    const doctor = createRuntimeDoctor({
        dataDir: path.join(root, 'data'),
        versionManifestPath: path.join(root, 'version.json'),
        requiredResources: [{ id: 'game-config', label: '游戏配置', path: path.join(root, 'missing.json') }],
    });

    const report = doctor.check();

    assert.equal(report.ok, false);
    assert.equal(report.checks.some(check => check.id === 'game-config' && check.status === 'error'), true);
    assert.equal(JSON.stringify(report).includes(root), false);
});

test('runtime doctor includes system health checks (node version, memory, disk)', () => {
    const root = createTempDirectory();
    const dataDir = path.join(root, 'data');
    fs.mkdirSync(dataDir);
    fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify({ version: '2.4.0' }));

    const doctor = createRuntimeDoctor({
        dataDir,
        versionManifestPath: path.join(root, 'version.json'),
    });
    const report = doctor.check();

    assert.equal(report.checks.some(check => check.id === 'node-version'), true);
    assert.equal(report.checks.some(check => check.id === 'memory'), true);
    assert.equal(report.checks.some(check => check.id === 'disk'), true);
    assert.equal(report.platform, process.platform);
    assert.equal(report.arch, process.arch);
});

test('runtime doctor reports summary counts correctly', () => {
    const root = createTempDirectory();
    const dataDir = path.join(root, 'data');
    fs.mkdirSync(dataDir);
    fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify({ version: '2.4.0' }));

    const doctor = createRuntimeDoctor({
        dataDir,
        versionManifestPath: path.join(root, 'version.json'),
        requiredResources: [{ id: 'missing', label: '缺失', path: path.join(root, 'no.json') }],
    });
    const report = doctor.check();

    assert.equal(report.summary.total, report.checks.length);
    const okCount = report.checks.filter(c => c.status === 'ok').length;
    const warnCount = report.checks.filter(c => c.status === 'warn').length;
    const errorCount = report.checks.filter(c => c.status === 'error').length;
    assert.equal(report.summary.ok, okCount);
    assert.equal(report.summary.warn, warnCount);
    assert.equal(report.summary.error, errorCount);
    assert.equal(report.summary.total, okCount + warnCount + errorCount);
});

test('runtime doctor checks store integrity', () => {
    const root = createTempDirectory();
    const dataDir = path.join(root, 'data');
    const storeFile = path.join(root, 'store.json');
    fs.mkdirSync(dataDir);
    fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify({ version: '2.4.0' }));
    fs.writeFileSync(storeFile, JSON.stringify({ accounts: [] }));

    const doctor = createRuntimeDoctor({
        dataDir,
        versionManifestPath: path.join(root, 'version.json'),
        storeFilePath: storeFile,
        requiredStoreFields: ['accounts'],
    });
    const report = doctor.check();

    const storeCheck = report.checks.find(c => c.id === 'store-integrity');
    assert.ok(storeCheck);
    assert.equal(storeCheck.status, 'ok');
});

test('runtime doctor warns on missing required store fields', () => {
    const root = createTempDirectory();
    const dataDir = path.join(root, 'data');
    const storeFile = path.join(root, 'store.json');
    fs.mkdirSync(dataDir);
    fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify({ version: '2.4.0' }));
    fs.writeFileSync(storeFile, JSON.stringify({ other: 'value' }));

    const doctor = createRuntimeDoctor({
        dataDir,
        versionManifestPath: path.join(root, 'version.json'),
        storeFilePath: storeFile,
        requiredStoreFields: ['accounts'],
    });
    const report = doctor.check();

    const storeCheck = report.checks.find(c => c.id === 'store-integrity');
    assert.ok(storeCheck);
    assert.equal(storeCheck.status, 'warn');
});

test('runtime doctor checks scheduler snapshot', () => {
    const root = createTempDirectory();
    const dataDir = path.join(root, 'data');
    fs.mkdirSync(dataDir);
    fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify({ version: '2.4.0' }));

    const doctor = createRuntimeDoctor({
        dataDir,
        versionManifestPath: path.join(root, 'version.json'),
        schedulerSnapshotFn: () => ({ running: [{ id: 'a' }, { id: 'b' }] }),
    });
    const report = doctor.check();

    const schedulerCheck = report.checks.find(c => c.id === 'scheduler');
    assert.ok(schedulerCheck);
    assert.equal(schedulerCheck.status, 'ok');
    assert.equal(schedulerCheck.details.running, 2);
});

test('runtime doctor handles scheduler errors gracefully', () => {
    const root = createTempDirectory();
    const dataDir = path.join(root, 'data');
    fs.mkdirSync(dataDir);
    fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify({ version: '2.4.0' }));

    const doctor = createRuntimeDoctor({
        dataDir,
        versionManifestPath: path.join(root, 'version.json'),
        schedulerSnapshotFn: () => { throw new Error('boom'); },
    });
    const report = doctor.check();

    const schedulerCheck = report.checks.find(c => c.id === 'scheduler');
    assert.ok(schedulerCheck);
    assert.equal(schedulerCheck.status, 'error');
});

test('runtime doctor sanitizes data dir path from report output', () => {
    const root = createTempDirectory();
    const dataDir = path.join(root, 'data');
    fs.mkdirSync(dataDir);
    fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify({ version: '2.4.0' }));

    const doctor = createRuntimeDoctor({
        dataDir,
        versionManifestPath: path.join(root, 'version.json'),
    });
    const report = doctor.check();
    const text = JSON.stringify(report);

    assert.equal(text.includes(dataDir), false, 'report should not leak data dir path');
    assert.equal(text.includes(root), false, 'report should not leak parent path');
});
