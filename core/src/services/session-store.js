const fs = require('node:fs');
const crypto = require('node:crypto');
const { getDataFile, ensureDataDir } = require('../config/runtime-paths');
const {
    writeJsonFileAtomic,
    writeTextFileAtomic,
    createDebouncedWriter,
    flushWritersFor,
} = require('../services/json-db');

const SESSION_FILE = getDataFile('sessions.json');
const SESSION_BACKUP_FILE = `${SESSION_FILE}.bak`;
const DEFAULT_ABSOLUTE_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_IDLE_TTL_MS = 2 * 60 * 60 * 1000;

const sessions = new Map();
let loaded = false;

const writer = createDebouncedWriter(() => {
    writeSessionsToDisk();
}, 300, SESSION_FILE);

function getAbsoluteTtlMs() {
    return Math.max(1_000, Number(process.env.SESSION_ABSOLUTE_TTL_MS) || DEFAULT_ABSOLUTE_TTL_MS);
}

function getIdleTtlMs() {
    return Math.max(1_000, Number(process.env.SESSION_IDLE_TTL_MS) || DEFAULT_IDLE_TTL_MS);
}

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function normalizeSession(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const tokenHash = String(entry.tokenHash || '').trim();
    const username = String(entry.username || '').trim();
    const createdAt = Number(entry.createdAt);
    const lastSeenAt = Number(entry.lastSeenAt);
    const expiresAt = Number(entry.expiresAt);
    if (!tokenHash || !username) return null;
    if (!Number.isFinite(createdAt) || !Number.isFinite(lastSeenAt) || !Number.isFinite(expiresAt)) {
        return null;
    }
    return { tokenHash, username, createdAt, lastSeenAt, expiresAt };
}

function readSessionsFromDisk() {
    ensureDataDir();
    const readEntries = (filePath) => {
        const raw = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(raw);
        return Array.isArray(data && data.sessions) ? data.sessions : [];
    };

    if (fs.existsSync(SESSION_FILE)) {
        try {
            return readEntries(SESSION_FILE).map(normalizeSession).filter(Boolean);
        } catch {
            // fall through to backup
        }
    }

    if (fs.existsSync(SESSION_BACKUP_FILE)) {
        try {
            const recovered = readEntries(SESSION_BACKUP_FILE).map(normalizeSession).filter(Boolean);
            writeJsonFileAtomic(SESSION_FILE, { schemaVersion: 1, sessions: recovered });
            return recovered;
        } catch {
            return [];
        }
    }

    return [];
}

function writeSessionsToDisk() {
    ensureDataDir();
    if (fs.existsSync(SESSION_FILE)) {
        try {
            const currentRaw = fs.readFileSync(SESSION_FILE, 'utf8');
            JSON.parse(currentRaw);
            writeTextFileAtomic(SESSION_BACKUP_FILE, currentRaw);
        } catch {
            // Main file is unreadable; keep the last good backup untouched.
        }
    }
    const payload = { schemaVersion: 1, sessions: [...sessions.values()] };
    writeJsonFileAtomic(SESSION_FILE, payload);
    writeJsonFileAtomic(SESSION_BACKUP_FILE, payload);
}

function ensureLoaded() {
    if (!loaded) load();
}

function load() {
    flushWritersFor(SESSION_FILE);
    sessions.clear();
    for (const session of readSessionsFromDisk()) {
        sessions.set(session.tokenHash, session);
    }
    loaded = true;
}

function reload() {
    flushWritersFor(SESSION_FILE);
    sessions.clear();
    loaded = false;
    load();
}

function findSession(tokenHash, options, shouldTouch) {
    ensureLoaded();
    if (!tokenHash) return null;
    const session = sessions.get(tokenHash);
    if (!session) return null;

    const now = Number.isFinite(Number(options && options.now)) ? Number(options.now) : Date.now();
    const idleTtlMs = Number(options && options.idleTtlMs) > 0 ? Number(options.idleTtlMs) : getIdleTtlMs();
    if (now >= session.expiresAt || now - session.lastSeenAt >= idleTtlMs) {
        sessions.delete(tokenHash);
        writer.schedule();
        writer.flush();
        return null;
    }

    if (shouldTouch && now !== session.lastSeenAt) {
        session.lastSeenAt = now;
        writer.schedule();
    }
    return session;
}

function create(token, username, options = {}) {
    ensureLoaded();
    if (!token || !username) {
        throw new Error('token and username are required');
    }
    const now = Date.now();
    const absoluteTtlMs = Number(options.absoluteTtlMs) > 0 ? Number(options.absoluteTtlMs) : getAbsoluteTtlMs();
    const session = {
        tokenHash: hashToken(token),
        username: String(username),
        createdAt: now,
        lastSeenAt: now,
        expiresAt: now + absoluteTtlMs,
    };
    sessions.set(session.tokenHash, session);
    writer.schedule();
    writer.flush();
    return session;
}

function get(token, options) {
    return findSession(hashToken(token), options, false);
}

function touch(token, options) {
    return findSession(hashToken(token), options, true);
}

function getByHash(tokenHash, options) {
    return findSession(tokenHash, options, false);
}

function touchByHash(tokenHash, options) {
    return findSession(tokenHash, options, true);
}

function remove(token) {
    return removeByHash(hashToken(token));
}

function removeByHash(tokenHash) {
    ensureLoaded();
    if (!tokenHash) return null;
    const session = sessions.get(tokenHash);
    if (!session) return null;
    sessions.delete(tokenHash);
    writer.schedule();
    writer.flush();
    return session;
}

function removeByUsername(username) {
    ensureLoaded();
    const removed = [];
    const target = String(username || '');
    if (!target) return removed;
    for (const [tokenHash, session] of sessions) {
        if (session.username === target) {
            removed.push(session);
            sessions.delete(tokenHash);
        }
    }
    if (removed.length) {
        writer.schedule();
        writer.flush();
    }
    return removed;
}

function renameUser(oldUsername, newUsername) {
    ensureLoaded();
    const from = String(oldUsername || '');
    const to = String(newUsername || '');
    if (!from || !to || from === to) return false;

    let changed = false;
    for (const session of sessions.values()) {
        if (session.username === from) {
            session.username = to;
            changed = true;
        }
    }
    if (changed) {
        writer.schedule();
        writer.flush();
    }
    return changed;
}

function list() {
    ensureLoaded();
    return [...sessions.values()];
}

function listByUsername(username) {
    ensureLoaded();
    const target = String(username || '');
    if (!target) return [];
    return [...sessions.values()].filter(session => session.username === target);
}

function flush() {
    writer.flush();
}

module.exports = {
    create,
    get,
    touch,
    getByHash,
    touchByHash,
    remove,
    removeByHash,
    removeByUsername,
    renameUser,
    hashToken,
    list,
    listByUsername,
    load,
    reload,
    flush,
};
