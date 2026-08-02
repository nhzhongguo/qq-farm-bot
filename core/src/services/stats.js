const process = require('node:process');
const path = require('node:path');
const fs = require('node:fs');

function getStatsFilePath(accountId) {
    const dataDir = process.env.FARM_DATA_DIR || path.join(__dirname, '../../data');
    return path.join(dataDir, 'stats', `${accountId}.json`);
}

function getHistoryFilePath(accountId) {
    const dataDir = process.env.FARM_DATA_DIR || path.join(__dirname, '../../data');
    return path.join(dataDir, 'stats', `history-${accountId}.json`);
}

function loadDailyHistory(accountId) {
    try {
        const filePath = getHistoryFilePath(accountId);
        if (!fs.existsSync(filePath)) return [];
        const raw = fs.readFileSync(filePath, 'utf8');
        if (!raw || !raw.trim()) return [];
        const history = JSON.parse(raw);
        return Array.isArray(history.daily) ? history.daily : [];
    } catch {
        return [];
    }
}

// 将某天的统计快照归档到历史（同一天覆盖，保留最近 90 天）
function archiveDailySnapshot(accountId, data) {
    try {
        const daily = loadDailyHistory(accountId);
        const idx = daily.findIndex(d => d.date === data.date);
        if (idx >= 0) {
            daily[idx] = data;
        } else {
            daily.push(data);
        }
        const trimmed = daily.slice(-90);
        const filePath = getHistoryFilePath(accountId);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify({ daily: trimmed }, null, 2), 'utf8');
        fs.renameSync(tmpPath, filePath);
    } catch {
        // ignore
    }
}

// 收益趋势：返回最近 N 天的每日快照（含相对前一天的增量）
function getStatsTrend(accountId, days = 30) {
    const daily = loadDailyHistory(accountId).slice(-Math.max(1, Math.min(days, 90)));
    return daily.map((d, i) => {
        const prev = daily[i - 1];
        const gold = Number(d.gold) || 0;
        const exp = Number(d.exp) || 0;
        return {
            date: d.date,
            gold,
            exp,
            goldGained: prev ? Math.max(0, gold - (Number(prev.gold) || 0)) : gold,
            expGained: prev ? Math.max(0, exp - (Number(prev.exp) || 0)) : exp,
            operations: d.operations || {},
            savedAt: d.savedAt || 0,
        };
    });
}

function getTodayKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function loadPersistedStats(accountId) {
    try {
        const filePath = getStatsFilePath(accountId);
        if (!fs.existsSync(filePath)) return null;
        const raw = fs.readFileSync(filePath, 'utf8');
        if (!raw || !raw.trim()) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function savePersistedStats(accountId, data) {
    try {
        const filePath = getStatsFilePath(accountId);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tmpPath, filePath);
    } catch {
        // ignore
    }
}

const operations = {
    harvest: 0,
    water: 0,
    weed: 0,
    bug: 0,
    fertilize: 0,
    plant: 0,
    steal: 0,
    helpWater: 0,
    helpWeed: 0,
    helpBug: 0,
    taskClaim: 0,
    sell: 0,
    upgrade: 0,
    levelUp: 0,
};

let currentDateKey = null;

const lastState = {
    gold: -1,
    exp: -1,
    coupon: -1,
};

const initialState = {
    gold: null,
    exp: null,
    coupon: null,
};

const session = {
    goldGained: 0,
    expGained: 0,
    couponGained: 0,
    lastExpGain: 0,
    lastGoldGain: 0,
};

let currentAccountId = null;
let saveTimer = null;

function recordOperation(type, count = 1) {
    checkAndResetDailyStats();
    if (operations[type] !== undefined) {
        operations[type] += count;
        scheduleSave();
    }
}

function checkAndResetDailyStats() {
    if (!currentAccountId) return;
    const todayKey = getTodayKey();
    if (currentDateKey && currentDateKey !== todayKey) {
        console.warn(`[统计] 检测到跨天，重置每日统计 (${currentDateKey} -> ${todayKey})`);
        Object.keys(operations).forEach((key) => {
            operations[key] = 0;
        });
    }
    currentDateKey = todayKey;
}

function scheduleSave() {
    if (!currentAccountId) return;
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        doSave();
    }, 2000);
}

function doSave() {
    if (!currentAccountId) return;
    const todayKey = getTodayKey();
    const data = {
        date: todayKey,
        operations: { ...operations },
        initialState: { ...initialState },
        gold: lastState.gold >= 0 ? lastState.gold : null,
        exp: lastState.exp >= 0 ? lastState.exp : null,
        savedAt: Date.now(),
    };
    savePersistedStats(currentAccountId, data);
    // 同步归档到每日历史，供趋势曲线使用
    archiveDailySnapshot(currentAccountId, data);
}

function initStats(gold, exp, coupon = 0) {
    const g = Number.isFinite(Number(gold)) ? Number(gold) : 0;
    const e = Number.isFinite(Number(exp)) ? Number(exp) : 0;
    const c = Number.isFinite(Number(coupon)) ? Number(coupon) : 0;
    lastState.gold = g;
    lastState.exp = e;
    lastState.coupon = c;
    initialState.gold = g;
    initialState.exp = e;
    initialState.coupon = c;
}

function initStatsWithPersistence(accountId, gold, exp, coupon = 0) {
    currentAccountId = accountId;
    const todayKey = getTodayKey();
    currentDateKey = todayKey;
    const saved = loadPersistedStats(accountId);

    if (saved && saved.date === todayKey) {
        Object.keys(saved.operations || {}).forEach((key) => {
            if (operations[key] !== undefined) {
                operations[key] = Number(saved.operations[key]) || 0;
            }
        });
        console.warn(`[统计] 已恢复今日统计数据: ${JSON.stringify(saved.operations)}`);
    } else {
        if (saved && saved.date) {
            console.warn(`[统计] 日期已变更，归档昨日数据 (${saved.date} -> ${todayKey})`);
            archiveDailySnapshot(accountId, {
                date: saved.date,
                operations: saved.operations || {},
                initialState: saved.initialState || {},
                gold: saved.gold !== undefined ? saved.gold : (saved.initialState && saved.initialState.gold !== undefined ? saved.initialState.gold : null),
                exp: saved.exp !== undefined ? saved.exp : (saved.initialState && saved.initialState.exp !== undefined ? saved.initialState.exp : null),
                savedAt: saved.savedAt || Date.now(),
            });
        }
        Object.keys(operations).forEach((key) => {
            operations[key] = 0;
        });
        if (saved) {
            console.warn(`[统计] 日期已变更，重置统计 (${saved.date} -> ${todayKey})`);
        }
    }

    initStats(gold, exp, coupon);
}

function updateStats(currentGold, currentExp) {
    if (lastState.gold === -1) lastState.gold = currentGold;
    if (lastState.exp === -1) lastState.exp = currentExp;

    if (currentGold > lastState.gold) {
        const delta = currentGold - lastState.gold;
        session.lastGoldGain = delta;
    } else if (currentGold < lastState.gold) {
        session.lastGoldGain = 0;
    }
    lastState.gold = currentGold;

    if (currentExp > lastState.exp) {
        const delta = currentExp - lastState.exp;
        const now = Date.now();
        if (delta === session.lastExpGain && (now - (session.lastExpTime || 0) < 1000)) {
            console.warn(`[系统] 忽略重复经验增量 +${delta}`);
        } else {
            session.lastExpGain = delta;
            session.lastExpTime = now;
            console.warn(`[系统] 经验 +${delta} (总计: ${currentExp})`);
        }
    } else {
        session.lastExpGain = 0;
    }
    lastState.exp = currentExp;
}

function recordGoldExp(gold, exp) {
    updateStats(gold, exp);
}

function setInitialValues(gold, exp, coupon = 0) {
    initStats(gold, exp, coupon);
}

function resetSessionGains() {
    session.goldGained = 0;
    session.expGained = 0;
    session.couponGained = 0;
    session.lastGoldGain = 0;
    session.lastExpGain = 0;
    session.lastExpTime = 0;
}

function recomputeSessionTotals(currentGold, currentExp, currentCoupon) {
    if (initialState.gold === null || initialState.exp === null || initialState.coupon === null) {
        initialState.gold = currentGold;
        initialState.exp = currentExp;
        initialState.coupon = currentCoupon;
    }
    session.goldGained = currentGold - initialState.gold;
    session.expGained = currentExp - initialState.exp;
    session.couponGained = currentCoupon - initialState.coupon;
}

function getStats(statusData, userState, connected, limits) {
    checkAndResetDailyStats();
    const statusObj = (statusData && typeof statusData === 'object') ? statusData : {};
    const userObj = (userState && typeof userState === 'object') ? userState : {};

    const rawGold = (userObj.gold !== null && userObj.gold !== undefined) ? userObj.gold : statusObj.gold;
    const rawExp = (userObj.exp !== null && userObj.exp !== undefined) ? userObj.exp : statusObj.exp;
    const rawCoupon = (userObj.coupon !== null && userObj.coupon !== undefined) ? userObj.coupon : statusObj.coupon;
    const rawGoldBean = (userObj.goldBean !== null && userObj.goldBean !== undefined) ? userObj.goldBean : statusObj.goldBean;
    const currentGold = Number.isFinite(Number(rawGold)) ? Number(rawGold) : 0;
    const currentExp = Number.isFinite(Number(rawExp)) ? Number(rawExp) : 0;
    const currentCoupon = Number.isFinite(Number(rawCoupon)) ? Number(rawCoupon) : 0;
    const currentGoldBean = Number.isFinite(Number(rawGoldBean)) ? Number(rawGoldBean) : 0;

    if (connected) {
        updateStats(currentGold, currentExp);
        recomputeSessionTotals(currentGold, currentExp, currentCoupon);
    }

    const operationsSnapshot = { ...operations };
    return {
        connection: { connected },
        status: {
            name: userObj.name || statusObj.name,
            level: statusObj.level || userObj.level || 0,
            gold: currentGold,
            coupon: Number.isFinite(Number(userObj.coupon)) ? Number(userObj.coupon) : 0,
            goldBean: currentGoldBean,
            exp: currentExp,
            platform: statusObj.platform || userObj.platform || 'qq',
        },
        uptime: process.uptime(),
        operations: operationsSnapshot,
        sessionExpGained: session.expGained,
        sessionGoldGained: session.goldGained,
        sessionCouponGained: session.couponGained,
        lastExpGain: session.lastExpGain,
        lastGoldGain: session.lastGoldGain,
        limits,
    };
}

function saveStats() {
    doSave();
}

module.exports = {
    recordOperation,
    initStats,
    initStatsWithPersistence,
    updateStats,
    setInitialValues,
    recordGoldExp,
    resetSessionGains,
    getStats,
    saveStats,
    getTodayKey,
    loadPersistedStats,
    checkAndResetDailyStats,
    getStatsTrend,
    getHistoryFilePath,
    loadDailyHistory,
    archiveDailySnapshot,
};
