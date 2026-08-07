const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');
const metrics = require('./metrics');

function ensureParentDir(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function readTextFile(filePath, fallback = '') {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return fallback;
    }
}

function readJsonFile(filePath, fallbackFactory = () => ({})) {
    const fallback = typeof fallbackFactory === 'function' ? fallbackFactory() : (fallbackFactory || {});
    const started = process.hrtime.bigint();
    try {
        if (!fs.existsSync(filePath)) return fallback;
        const raw = fs.readFileSync(filePath, 'utf8');
        if (!raw || !raw.trim()) return fallback;
        return JSON.parse(raw);
    } catch {
        return fallback;
    } finally {
        const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
        metrics.recordPersistenceSample('read', filePath, durationMs, true);
    }
}

function writeJsonFileAtomic(filePath, data, space = 2) {
    const json = JSON.stringify(data, null, space);
    writeTextFileAtomic(filePath, json);
}

function writeTextFileAtomic(filePath, text = '') {
    ensureParentDir(filePath);
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const started = process.hrtime.bigint();

    try {
        fs.writeFileSync(tmpPath, String(text), 'utf8');
        fs.renameSync(tmpPath, filePath);
    } finally {
        try {
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        } catch {
            // ignore cleanup errors
        }
        const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
        metrics.recordPersistenceSample('write', filePath, durationMs, true);
    }
}

// ============ 批量写入合并（debounce） ============
// 高频追加型数据（日志类）通过 debounced writer 合并多次写入为一次原子写，
// 显著减少同步 IO。进程正常退出时统一 flush 兜底，避免丢失最后一批数据。

const activeWriters = new Set();
const writersByFile = new Map(); // filePath -> Set<writer>
let exitHookRegistered = false;

function registerExitHook() {
    if (exitHookRegistered) return;
    exitHookRegistered = true;
    process.on('exit', () => {
        for (const writer of activeWriters) {
            try {
                writer.flush();
            } catch {
                // ignore flush errors on exit
            }
        }
    });
}

/**
 * 创建一个合并写入器：多次 schedule() 只触发一次最终 fn()，
 * 以最后一次 schedule 为起点顺延 delayMs；flush() 立即执行。
 * @param {() => void} fn - 最终执行的真实写入函数
 * @param {number} [delayMs] - 合并窗口毫秒数，默认 300
 * @param {string} [filePath] - 关联的目标文件（用于跨实例 flush）
 */
function createDebouncedWriter(fn, delayMs = 300, filePath = null) {
    registerExitHook();
    let timer = null;
    let pending = false;

    const writer = {
        schedule() {
            pending = true;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                pending = false;
                try {
                    fn();
                } catch {
                    // 合并写入失败不抛出，避免中断业务调用链
                }
            }, delayMs);
        },
        flush() {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            if (pending) {
                pending = false;
                try {
                    fn();
                } catch {
                    // ignore
                }
            }
        },
        isPending() {
            return pending;
        },
    };
    activeWriters.add(writer);
    if (filePath) {
        let set = writersByFile.get(filePath);
        if (!set) {
            set = new Set();
            writersByFile.set(filePath, set);
        }
        set.add(writer);
    }
    return writer;
}

/** 立即落盘写入同一文件的所有合并写入器（跨实例读取前调用） */
function flushWritersFor(filePath) {
    const set = writersByFile.get(filePath);
    if (!set) return;
    for (const writer of set) {
        try {
            writer.flush();
        } catch {
            // ignore
        }
    }
}

module.exports = {
    readTextFile,
    readJsonFile,
    writeTextFileAtomic,
    writeJsonFileAtomic,
    createDebouncedWriter,
    flushWritersFor,
};
