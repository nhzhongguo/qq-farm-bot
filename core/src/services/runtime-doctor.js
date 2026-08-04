const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const process = require('node:process');

/**
 * 运行环境 Doctor
 * 提供系统健康检查和资源验证，输出不包含敏感路径/凭据的信息。
 */

const MIN_NODE_MAJOR = 18;
const WARN_MEMORY_MB = 256;
const WARN_DISK_PERCENT = 90;
const CRITICAL_DISK_PERCENT = 95;

function createCheck(id, label, status, message, extra) {
    const check = { id, label, status, message };
    if (extra && typeof extra === 'object') {
        check.details = extra;
    }
    return check;
}

function safeStat(target) {
    try {
        return fs.statSync(target);
    } catch {
        return null;
    }
}

function safeReadJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

function checkDataDirectory(dataDir) {
    if (!dataDir) {
        return createCheck('data-directory', '数据目录', 'error', '未配置');
    }
    try {
        fs.accessSync(dataDir, fs.constants.R_OK | fs.constants.W_OK);
        // 尝试写入临时文件以验证可写
        const probe = path.join(dataDir, `.doctor-probe-${process.pid}-${Date.now()}.tmp`);
        fs.writeFileSync(probe, 'ok');
        fs.unlinkSync(probe);
        return createCheck('data-directory', '数据目录', 'ok', '可读写');
    } catch {
        return createCheck('data-directory', '数据目录', 'error', '不可读写');
    }
}

function checkVersionManifest(versionManifestPath) {
    const data = safeReadJson(versionManifestPath);
    if (!data) {
        return { check: createCheck('version-manifest', '版本信息', 'error', '不可读取'), version: 'unknown' };
    }
    const version = String(data.version || '').trim();
    if (!version) {
        return { check: createCheck('version-manifest', '版本信息', 'error', '缺少版本字段'), version: 'unknown' };
    }
    return { check: createCheck('version-manifest', '版本信息', 'ok', version, { build: data.build || null }), version };
}

function checkResource(resource) {
    if (!resource || !resource.path) {
        return createCheck(resource?.id || 'resource', resource?.label || '资源', 'error', '未配置路径');
    }
    const stat = safeStat(resource.path);
    if (!stat) {
        return createCheck(resource.id, resource.label, 'error', '文件不存在');
    }
    if (resource.expectDir && !stat.isDirectory()) {
        return createCheck(resource.id, resource.label, 'error', '应为目录');
    }
    if (!resource.expectDir && !stat.isFile()) {
        return createCheck(resource.id, resource.label, 'error', '应为文件');
    }
    return createCheck(resource.id, resource.label, 'ok', '可用');
}

function checkNodeVersion() {
    const version = process.version;
    const major = Number.parseInt(version.slice(1).split('.')[0], 10);
    if (!Number.isFinite(major)) {
        return createCheck('node-version', 'Node.js 版本', 'warn', `无法解析版本 ${version}`);
    }
    if (major < MIN_NODE_MAJOR) {
        return createCheck(
            'node-version',
            'Node.js 版本',
            'warn',
            `${version}（建议 ≥ ${MIN_NODE_MAJOR}.x）`,
        );
    }
    return createCheck('node-version', 'Node.js 版本', 'ok', version, { major });
}

function checkMemory() {
    const free = os.freemem();
    const total = os.totalmem();
    const freeMb = Math.round(free / 1024 / 1024);
    const totalMb = Math.round(total / 1024 / 1024);
    if (free <= 0) {
        return createCheck('memory', '内存', 'error', '无法获取内存信息', { freeMb, totalMb });
    }
    if (freeMb < WARN_MEMORY_MB) {
        return createCheck(
            'memory',
            '内存',
            'warn',
            `可用内存 ${freeMb} MB（建议 ≥ ${WARN_MEMORY_MB} MB）`,
            { freeMb, totalMb },
        );
    }
    return createCheck('memory', '内存', 'ok', `可用 ${freeMb} MB / 共 ${totalMb} MB`, { freeMb, totalMb });
}

function checkDisk(dataDir) {
    // 仅做基本检查；完整磁盘统计依赖平台相关 API，保持轻量。
    if (!dataDir) {
        return createCheck('disk', '磁盘', 'warn', '未指定数据目录，跳过');
    }
    const stat = safeStat(dataDir);
    if (!stat) {
        return createCheck('disk', '磁盘', 'warn', '数据目录不可访问');
    }
    try {
        // 使用 fs.statfs（Node 18.15+）若可用
        if (typeof fs.statfs === 'function') {
            const fsStat = fs.statfsSync(dataDir);
            const total = fsStat.blocks * fsStat.bsize;
            const free = fsStat.bfree * fsStat.bsize;
            const usedPercent = total > 0 ? Math.round(((total - free) / total) * 100) : 100;
            const freeGb = (free / 1024 / 1024 / 1024).toFixed(2);
            const totalGb = (total / 1024 / 1024 / 1024).toFixed(2);
            if (usedPercent >= CRITICAL_DISK_PERCENT) {
                return createCheck('disk', '磁盘', 'error', `已用 ${usedPercent}%（剩余 ${freeGb} GB）`, { usedPercent, freeGb, totalGb });
            }
            if (usedPercent >= WARN_DISK_PERCENT) {
                return createCheck('disk', '磁盘', 'warn', `已用 ${usedPercent}%（剩余 ${freeGb} GB）`, { usedPercent, freeGb, totalGb });
            }
            return createCheck('disk', '磁盘', 'ok', `已用 ${usedPercent}%（剩余 ${freeGb} GB / 共 ${totalGb} GB）`, { usedPercent, freeGb, totalGb });
        }
        return createCheck('disk', '磁盘', 'ok', '数据目录可访问');
    } catch {
        return createCheck('disk', '磁盘', 'warn', '磁盘统计不可用');
    }
}

function checkConfigIntegrity(options) {
    const { configFilePath, requiredKeys = [] } = options || {};
    if (!configFilePath) {
        return createCheck('config-integrity', '配置完整性', 'warn', '未配置路径');
    }
    const data = safeReadJson(configFilePath);
    if (!data) {
        return createCheck('config-integrity', '配置完整性', 'error', '配置文件不可读');
    }
    const missing = requiredKeys.filter((key) => !(key in data));
    if (missing.length > 0) {
        return createCheck('config-integrity', '配置完整性', 'warn', `缺少字段: ${missing.join(', ')}`);
    }
    return createCheck('config-integrity', '配置完整性', 'ok', '关键字段完整');
}

function checkStoreIntegrity(options) {
    const { storeFilePath, requiredFields = [] } = options || {};
    if (!storeFilePath) {
        return createCheck('store-integrity', '存储完整性', 'warn', '未配置路径');
    }
    const stat = safeStat(storeFilePath);
    if (!stat) {
        // 文件不存在视为"未初始化"，非错误
        return createCheck('store-integrity', '存储完整性', 'warn', '存储文件未初始化');
    }
    if (stat.size === 0) {
        return createCheck('store-integrity', '存储完整性', 'error', '存储文件为空');
    }
    const data = safeReadJson(storeFilePath);
    if (!data) {
        return createCheck('store-integrity', '存储完整性', 'error', '存储文件解析失败');
    }
    const missing = requiredFields.filter((key) => !(key in data));
    if (missing.length > 0) {
        return createCheck('store-integrity', '存储完整性', 'warn', `缺少字段: ${missing.join(', ')}`);
    }
    return createCheck('store-integrity', '存储完整性', 'ok', `有效（${stat.size} 字节）`, { size: stat.size });
}

function checkScheduler(options) {
    const { schedulerSnapshotFn } = options || {};
    if (typeof schedulerSnapshotFn !== 'function') {
        return createCheck('scheduler', '调度器', 'warn', '未提供调度器状态');
    }
    try {
        const snapshot = schedulerSnapshotFn();
        if (!snapshot || typeof snapshot !== 'object') {
            return createCheck('scheduler', '调度器', 'warn', '调度器返回空');
        }
        const running = Array.isArray(snapshot.running) ? snapshot.running.length : 0;
        return createCheck('scheduler', '调度器', 'ok', `运行中 ${running} 个任务`, { running });
    } catch (e) {
        return createCheck('scheduler', '调度器', 'error', `查询失败: ${e.message}`);
    }
}

function sanitizeReport(report, dataDir) {
    // 防止输出中泄露绝对路径等敏感信息
    if (!dataDir) return report;
    let text;
    try {
        text = JSON.stringify(report);
    } catch {
        return report;
    }
    if (text.includes(dataDir)) {
        const sanitized = text.split(dataDir).join('[data-dir]');
        try {
            return JSON.parse(sanitized);
        } catch {
            return report;
        }
    }
    return report;
}

function createRuntimeDoctor(options = {}) {
    const {
        dataDir,
        versionManifestPath,
        requiredResources = [],
        configFilePath,
        requiredConfigKeys = [],
        storeFilePath,
        requiredStoreFields = [],
        schedulerSnapshotFn,
        extraChecks = [],
    } = options;

    function check() {
        const manifestResult = checkVersionManifest(versionManifestPath);
        const checks = [
            checkDataDirectory(dataDir),
            manifestResult.check,
            checkNodeVersion(),
            checkMemory(),
            checkDisk(dataDir),
            ...requiredResources.map(checkResource),
            checkConfigIntegrity({ configFilePath, requiredKeys: requiredConfigKeys }),
            checkStoreIntegrity({ storeFilePath, requiredFields: requiredStoreFields }),
            checkScheduler({ schedulerSnapshotFn }),
            ...extraChecks,
        ].filter(Boolean);

        // ok 仅要求无 error；warn 不视为致命问题
        const errorCount = checks.filter((check) => check.status === 'error').length;
        const warnCount = checks.filter((check) => check.status === 'warn').length;
        const okCount = checks.filter((check) => check.status === 'ok').length;
        const ok = errorCount === 0;

        const report = {
            checkedAt: new Date().toISOString(),
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
            version: manifestResult.version,
            ok,
            summary: { total: checks.length, ok: okCount, warn: warnCount, error: errorCount },
            checks,
        };

        return sanitizeReport(report, dataDir);
    }

    return { check };
}

module.exports = {
    createRuntimeDoctor,
    createCheck,
    checkDataDirectory,
    checkVersionManifest,
    checkResource,
    checkNodeVersion,
    checkMemory,
    checkDisk,
    checkConfigIntegrity,
    checkStoreIntegrity,
    checkScheduler,
    safeStat,
    safeReadJson,
};
