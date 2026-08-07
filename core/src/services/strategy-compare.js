const { loadDailyHistory } = require('./stats');
const { getPlantRankings } = require('./analytics');
const { getPlantingStrategy } = require('../models/store');

const STRATEGY_LABELS = {
    preferred: '优先种植种子',
    level: '最高等级作物',
    max_exp: '最大经验/时',
    max_fert_exp: '最大普通肥经验/时',
    max_profit: '最大净利润/时',
    max_fert_profit: '最大普通肥净利润/时',
    bag_priority: '背包种子优先',
};

/**
 * 策略对比服务
 * 基于 stats 日归档计算近 N 天收益表现，对比不同策略的理论最优值
 * 仅提示，不自动修改配置
 */

const DEFAULT_WINDOW_DAYS = 7;

const STRATEGY_SORT_KEY_MAP = {
    max_exp: 'exp',
    max_profit: 'profit',
    max_fert_exp: 'fert',
    max_fert_profit: 'fert_profit',
    level: 'level',
};

const STRATEGY_METRIC_FIELD_MAP = {
    max_exp: 'expPerHour',
    max_profit: 'profitPerHour',
    max_fert_exp: 'normalFertilizerExpPerHour',
    max_fert_profit: 'normalFertilizerProfitPerHour',
    level: 'level',
};

/**
 * 获取账号当前策略下的近 N 天平均收益
 * @param {string} accountId
 * @param {number} [days]
 * @returns {{ goldAvg: number, expAvg: number, days: number, strategy: string }} 平均金币/经验、天数、策略名
 */
function getCurrentStrategyPerformance(accountId, days = DEFAULT_WINDOW_DAYS) {
    const daily = loadDailyHistory(accountId).slice(-days);
    if (daily.length === 0) {
        return { goldAvg: 0, expAvg: 0, days: 0, strategy: getPlantingStrategy(accountId) || 'unknown' };
    }
    let totalGold = 0;
    let totalExp = 0;
    for (const d of daily) {
        totalGold += Math.max(0, Number(d.goldGained) || 0);
        totalExp += Math.max(0, Number(d.expGained) || 0);
    }
    return {
        goldAvg: Math.round(totalGold / daily.length),
        expAvg: Math.round(totalExp / daily.length),
        days: daily.length,
        strategy: getPlantingStrategy(accountId) || 'unknown',
    };
}

/**
 * 基于 analytics 静态排名，给出当前等级可种植的 Top-N 推荐作物（按指定策略排序）
 * @param {string} accountId
 * @param {string} strategyKey 如 'max_exp' 'max_profit' 等
 * @param {number} [limit]
 * @returns {Array<{seedId, name, level, metricValue, metric}>} 推荐作物列表
 */
function getStrategyRecommendations(accountId, strategyKey, limit = 5, currentLevel = null) {
    const normalizedLevel = currentLevel === null || currentLevel === undefined || Number.isNaN(Number(currentLevel))
        ? null
        : Number(currentLevel);
    const sortKey = STRATEGY_SORT_KEY_MAP[strategyKey] || strategyKey;
    const rankings = getPlantRankings(sortKey);
    
    const available = rankings.filter(p => {
        const lvl = p.level;
        if (lvl === null || lvl === undefined) return true;
        return normalizedLevel === null || Number(lvl) <= normalizedLevel;
    });
    
    return available.slice(0, limit).map(p => ({
        seedId: p.seedId,
        name: p.name,
        level: p.level,
        metric: strategyKey,
        metricValue: Number(p[STRATEGY_METRIC_FIELD_MAP[strategyKey] || strategyKey]) || 0,
    }));
}

/**
 * 计算当前策略 vs 理论最优策略的收益差距
 * 使用 analytics 静态排名的理论值作为上界参考
 * @param {string} accountId
 * @param {number} [days]
 * @returns {{
 *   current: { strategy: string, goldAvg: number, expAvg: number },
 *   theoretical: Array<{ strategy: string, label: string, goldPerHour: number, expPerHour: number, topCrop: string }>,
 *   gap: { goldPct: number, expPct: number },
 *   recommendation: string
 * }} 对比结果含当前/理论/差距/建议
 */
function compareStrategyPerformance(accountId, days = DEFAULT_WINDOW_DAYS) {
    const current = getCurrentStrategyPerformance(accountId, days);
    const currentStrategy = current.strategy;
    
    // 理论最优：遍历主要策略的 Top-1 理论收益
    const strategyKeys = ['max_exp', 'max_profit', 'max_fert_exp', 'max_fert_profit'];
    const theoretical = [];
    
    for (const key of strategyKeys) {
        const rankings = getPlantRankings(STRATEGY_SORT_KEY_MAP[key] || key);
        const top = rankings[0];
        if (top) {
            theoretical.push({
                strategy: key,
                label: STRATEGY_LABELS[key] || key,
                goldPerHour: top.goldPerHour || 0,
                expPerHour: top.expPerHour || 0,
                profitPerHour: top.profitPerHour || 0,
                normalFertilizerProfitPerHour: top.normalFertilizerProfitPerHour || 0,
                topCrop: top.name,
            });
        }
    }
    
    // 当前策略的理论值
    const currentTheoretical = theoretical.find(t => t.strategy === currentStrategy);
    
    // 实际收益转小时率（粗略：假设每天活跃 16 小时）
    const activeHoursPerDay = 16;
    const actualGoldPerHour = current.goldAvg / activeHoursPerDay;
    const actualExpPerHour = current.expAvg / activeHoursPerDay;
    
    // 差距：以最优理论值为分母
    const bestGoldPerHour = Math.max(...theoretical.map(t => t.goldPerHour), 1);
    const bestExpPerHour = Math.max(...theoretical.map(t => t.expPerHour), 1);
    
    const goldPct = currentTheoretical && currentTheoretical.goldPerHour > 0
        ? Math.round((actualGoldPerHour / currentTheoretical.goldPerHour) * 100)
        : Math.round((actualGoldPerHour / bestGoldPerHour) * 100);
    const expPct = currentTheoretical && currentTheoretical.expPerHour > 0
        ? Math.round((actualExpPerHour / currentTheoretical.expPerHour) * 100)
        : Math.round((actualExpPerHour / bestExpPerHour) * 100);
    
    // 生成建议文案
    let recommendation = '';
    if (current.days < 3) {
        recommendation = '数据天数不足（<3天），建议运行更久后再对比。';
    } else if (goldPct < 60 || expPct < 60) {
        const best = theoretical.reduce((a, b) => a.goldPerHour > b.goldPerHour ? a : b);
        recommendation = `当前策略「${STRATEGY_LABELS[currentStrategy] || currentStrategy}」收益偏低（金币达标 ${goldPct}%、经验达标 ${expPct}%）。建议尝试「${best.label}」（推荐作物：${best.topCrop}），或在设置页调整种植策略。`;
    } else if (goldPct < 85 || expPct < 85) {
        recommendation = `当前策略表现尚可（金币达标 ${goldPct}%、经验达标 ${expPct}%），可微调种子优先级或施肥策略进一步优化。`;
    } else {
        recommendation = `当前策略「${STRATEGY_LABELS[currentStrategy] || currentStrategy}」表现优秀（金币达标 ${goldPct}%、经验达标 ${expPct}%），继续保持。`;
    }
    
    return {
        current: { ...current, label: STRATEGY_LABELS[currentStrategy] || currentStrategy },
        theoretical,
        gap: { goldPct: Math.min(goldPct, 200), expPct: Math.min(expPct, 200) },
        recommendation,
    };
}

module.exports = {
    STRATEGY_LABELS,
    getCurrentStrategyPerformance,
    getStrategyRecommendations,
    compareStrategyPerformance,
    DEFAULT_WINDOW_DAYS,
};