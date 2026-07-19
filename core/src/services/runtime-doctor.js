const fs = require('node:fs');
const process = require('node:process');

function createCheck(id, label, status, message) {
    return { id, label, status, message };
}

function createRuntimeDoctor({ dataDir, versionManifestPath, requiredResources = [] }) {
    function checkDataDirectory() {
        try {
            fs.accessSync(dataDir, fs.constants.R_OK | fs.constants.W_OK);
            return createCheck('data-directory', '数据目录', 'ok', '可读写');
        } catch {
            return createCheck('data-directory', '数据目录', 'error', '不可读写');
        }
    }

    function checkManifest() {
        try {
            const data = JSON.parse(fs.readFileSync(versionManifestPath, 'utf8'));
            const version = String(data.version || '').trim();
            if (!version) throw new Error('missing version');
            return { check: createCheck('version-manifest', '版本信息', 'ok', version), version };
        } catch {
            return { check: createCheck('version-manifest', '版本信息', 'error', '不可读取'), version: 'unknown' };
        }
    }

    function checkResource(resource) {
        try {
            const stat = fs.statSync(resource.path);
            if (!stat.isFile()) throw new Error('not file');
            return createCheck(resource.id, resource.label, 'ok', '可用');
        } catch {
            return createCheck(resource.id, resource.label, 'error', '不可用');
        }
    }

    function check() {
        const manifest = checkManifest();
        const checks = [
            checkDataDirectory(),
            manifest.check,
            ...requiredResources.map(checkResource),
        ];
        return {
            checkedAt: new Date().toISOString(),
            nodeVersion: process.version,
            version: manifest.version,
            ok: checks.every(check => check.status === 'ok'),
            checks,
        };
    }

    return { check };
}

module.exports = { createRuntimeDoctor };
