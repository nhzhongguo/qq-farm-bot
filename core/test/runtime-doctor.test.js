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
    assert.deepEqual(report.checks.map(check => check.status), ['ok', 'ok', 'ok']);
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
