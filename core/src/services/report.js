const { getStatsTrend } = require('./stats');
const { listRuns } = require('./task-run-store');

/**
 * 运营报表服务
 *
 * 基于 stats 日归档（loadDailyHistory / getStatsTrend）与 task-run-store 生成账号级运营报表：
 * - 日报：某一天（默认今天）
 * - 周报：连续日期窗口（默认最近 7 天）
 * - 对比：多账号同窗口汇总对比
 *
 * 数据口径与 stats.js / task-run-store 保持一致，禁止另起口径。
 * 输出 JSON（机器可读）与 HTML（浏览器打印/邮件正文），HTML 内所有动态值经 escapeHtml 转义。
 */

const OPERATION_LABELS = {
    harvest: '收获',
    water: '浇水',
    weed: '除草',
    bug: '除虫',
    fertilize: '施肥',
    plant: '种植',
    steal: '偷菜',
    helpWater: '帮浇水',
    helpWeed: '帮除草',
    helpBug: '帮除虫',
    taskClaim: '任务领取',
    sell: '出售',
    upgrade: '土地升级',
    levelUp: '升级',
};

const DEFAULT_DAILY_WINDOW_DAYS = 1;
const DEFAULT_WEEKLY_WINDOW_DAYS = 7;
const MAX_TASK_RUNS = 500;
const MAX_ISSUE_SAMPLE = 5;
const MAX_ISSUE_MESSAGE = 300;

/** HTML 转义：所有进入报表 HTML 的动态值必须经此函数 */
function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function pad2(value) {
    return String(value).padStart(2, '0');
}

/** Date -> 'YYYY-MM-DD'（本地时区） */
function toDateKey(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** 'YYYY-MM-DD' -> Date（本地时区，无效返回 null） */
function parseDateKey(key) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || '').trim());
    if (!match) return null;
    const year = Number.parseInt(match[1], 10);
    const month = Number.parseInt(match[2], 10);
    const day = Number.parseInt(match[3], 10);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
}

function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

/** 按 start/end 生成连续日期键列表（含首尾） */
function enumerateDateKeys(startDate, endDate) {
    const keys = [];
    for (let cursor = new Date(startDate); cursor <= endDate; cursor = addDays(cursor, 1)) {
        keys.push(toDateKey(cursor));
    }
    return keys;
}

function sumOperations(dailyPoints) {
    const total = {};
    for (const point of dailyPoints) {
        const ops = (point && typeof point === 'object' && point.operations) || {};
        for (const [key, value] of Object.entries(ops)) {
            const count = Number(value) || 0;
            if (count > 0) total[key] = (total[key] || 0) + count;
        }
    }
    return total;
}

/** 窗口内任务运行统计（success/failed 与异常明细） */
function summarizeTaskRuns(accountId, startMs, endMs) {
    const runs = listRuns({ accountIds: [String(accountId)], limit: MAX_TASK_RUNS });
    const inWindow = runs.filter(run => run.startedAt >= startMs && run.startedAt <= endMs);
    let success = 0;
    let failed = 0;
    const issues = [];
    for (const run of inWindow) {
        if (run.status === 'failed') {
            failed += 1;
            if (issues.length < MAX_ISSUE_SAMPLE) {
                issues.push({
                    taskName: String(run.taskName || '未知任务'),
                    startedAt: run.startedAt,
                    error: String(run.error || '未知错误').slice(0, MAX_ISSUE_MESSAGE),
                });
            }
        } else if (run.status === 'success') {
            success += 1;
        }
    }
    return { total: inWindow.length, success, failed, issues };
}

/**
 * 生成单个账号在 [startDate, endDate] 窗口的报表数据（闭区间，日期键比较）。
 * @param {string} accountId
 * @param {string} startDate 'YYYY-MM-DD'
 * @param {string} endDate 'YYYY-MM-DD'
 * @returns {object} 报表数据对象
 */
function buildRangeReport(accountId, startDate, endDate) {
    const account = String(accountId || '').trim();
    const start = parseDateKey(startDate);
    const end = parseDateKey(endDate);
    if (!account) throw new Error('accountId 不能为空');
    if (!start || !end || start > end) {
        throw new Error(`无效的日期区间: ${startDate} ~ ${endDate}`);
    }

    const daily = getStatsTrend(account, 90).filter((point) => {
        const key = String(point.date || '');
        return key >= startDate && key <= endDate;
    });

    const windowDays = enumerateDateKeys(start, end);
    const summary = {
        days: windowDays.length,
        dataDays: daily.length,
        goldGained: 0,
        expGained: 0,
    };
    for (const point of daily) {
        summary.goldGained += Math.max(0, Number(point.goldGained) || 0);
        summary.expGained += Math.max(0, Number(point.expGained) || 0);
    }

    const operations = sumOperations(daily);
    for (const [key, value] of Object.entries(operations)) {
        summary[key] = value;
    }

    const startMs = start.getTime();
    const endMs = end.getTime() + 24 * 60 * 60 * 1000 - 1; // 含 end 当天
    const taskSummary = summarizeTaskRuns(account, startMs, endMs);
    summary.taskTotal = taskSummary.total;
    summary.taskSuccess = taskSummary.success;
    summary.taskFailed = taskSummary.failed;
    summary.issueCount = taskSummary.issues.length;

    return {
        accountId: account,
        period: windowDays.length > DEFAULT_DAILY_WINDOW_DAYS ? 'weekly' : 'daily',
        range: { start: startDate, end: endDate },
        summary,
        operations,
        trend: daily.map(point => ({
            date: point.date,
            goldGained: Math.max(0, Number(point.goldGained) || 0),
            expGained: Math.max(0, Number(point.expGained) || 0),
        })),
        issues: taskSummary.issues,
    };
}

/**
 * 生成日报。date 省略时为今天（now 可注入便于测试）。
 */
function generateDailyReport(accountId, date, now = new Date()) {
    const key = parseDateKey(date) ? String(date) : toDateKey(now instanceof Date ? now : new Date(now));
    return buildRangeReport(accountId, key, key);
}

/**
 * 生成周报。endDate 省略时为今天，startDate 省略时取最近 7 天（含今天）。
 */
function generateWeeklyReport(accountId, startDate, endDate, now = new Date()) {
    const today = toDateKey(now instanceof Date ? now : new Date(now));
    const end = parseDateKey(endDate) ? String(endDate) : today;
    const start = parseDateKey(startDate) ? String(startDate) : toDateKey(addDays(parseDateKey(end), -(DEFAULT_WEEKLY_WINDOW_DAYS - 1)));
    return buildRangeReport(accountId, start, end);
}

/**
 * 多账号同窗口对比。accountIds 非空，days 为窗口天数（默认 7，上限 90）。
 */
function generateCompareReport(accountIds, days, now = new Date()) {
    const ids = Array.isArray(accountIds) ? accountIds.map(value => String(value).trim()).filter(Boolean) : [];
    if (ids.length === 0) throw new Error('accountIds 不能为空');
    const windowDays = Math.max(1, Math.min(Number(days) || DEFAULT_WEEKLY_WINDOW_DAYS, 90));
    const today = parseDateKey(toDateKey(now instanceof Date ? now : new Date(now)));
    const start = addDays(today, -(windowDays - 1));
    const end = today;
    return {
        period: 'compare',
        range: { start: toDateKey(start), end: toDateKey(end), days: windowDays },
        accounts: ids.map((id) => {
            const report = buildRangeReport(id, toDateKey(start), toDateKey(end));
            return { accountId: id, summary: report.summary };
        }),
    };
}

/** 报表渲染为脱敏 HTML（浏览器打印 / 邮件正文），所有动态值已转义 */
function renderHtml(report) {
    const data = (report && typeof report === 'object') ? report : {};
    const summary = (data.summary && typeof data.summary === 'object') ? data.summary : {};
    const operations = (data.operations && typeof data.operations === 'object') ? data.operations : {};
    const range = (data.range && typeof data.range === 'object') ? data.range : {};
    const issues = Array.isArray(data.issues) ? data.issues : [];

    const periodLabel = data.period === 'weekly' ? '周报' : data.period === 'compare' ? '对比报表' : '日报';
    const opRows = Object.entries(operations).map(([key, value]) => {
        const label = OPERATION_LABELS[key] || key;
        return `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`;
    }).join('');

    const issueRows = issues.map((issue) => {
        const time = new Date(issue.startedAt).toLocaleString('zh-CN');
        return `<li><b>${escapeHtml(issue.taskName)}</b> @ ${escapeHtml(time)}：${escapeHtml(issue.error)}</li>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>QQ 农场助手 ${escapeHtml(periodLabel)}</title>
<style>
body{font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;margin:24px;color:#222}
h1{font-size:20px;margin:0 0 4px}
.meta{color:#666;font-size:13px;margin-bottom:16px}
table{border-collapse:collapse;width:100%;max-width:640px;margin-bottom:16px}
th,td{border:1px solid #ddd;padding:6px 10px;text-align:left;font-size:14px}
th{background:#f5f5f5}
.summary td{font-weight:600}
ul{padding-left:20px;font-size:13px}
li{margin-bottom:4px}
</style>
</head>
<body>
<h1>QQ 农场助手 ${escapeHtml(periodLabel)}</h1>
<div class="meta">账号 ID：${escapeHtml(data.accountId || '-')} ｜ 区间：${escapeHtml(range.start || '-')} ~ ${escapeHtml(range.end || '-')} ｜ 数据天数：${escapeHtml(summary.dataDays ?? '-')} / ${escapeHtml(summary.days ?? '-')}</div>
<table>
<caption style="text-align:left;font-weight:600;margin-bottom:6px">核心指标</caption>
<tr><th>指标</th><th>数值</th></tr>
<tr class="summary"><td>金币增量</td><td>${escapeHtml(summary.goldGained ?? 0)}</td></tr>
<tr class="summary"><td>经验增量</td><td>${escapeHtml(summary.expGained ?? 0)}</td></tr>
<tr><td>任务总数（成功/失败）</td><td>${escapeHtml(summary.taskTotal ?? 0)}（${escapeHtml(summary.taskSuccess ?? 0)} / ${escapeHtml(summary.taskFailed ?? 0)}）</td></tr>
<tr><td>异常数</td><td>${escapeHtml(summary.issueCount ?? 0)}</td></tr>
</table>
${opRows ? `<table><caption style="text-align:left;font-weight:600;margin-bottom:6px">操作明细</caption><tr><th>操作</th><th>次数</th></tr>${opRows}</table>` : ''}
${issueRows ? `<h2 style="font-size:15px">异常明细</h2><ul>${issueRows}</ul>` : ''}
</body>
</html>`;
}

/** 统一入口：按 type 生成报表（daily|weekly|compare） */
function generateReport(options = {}) {
    const type = String(options.type || 'daily').trim();
    const now = options.now instanceof Date ? options.now : new Date();
    if (type === 'weekly') {
        return generateWeeklyReport(options.accountId, options.startDate, options.endDate, now);
    }
    if (type === 'compare') {
        return generateCompareReport(options.accountIds, options.days, now);
    }
    return generateDailyReport(options.accountId, options.date, now);
}

module.exports = {
    OPERATION_LABELS,
    escapeHtml,
    toDateKey,
    parseDateKey,
    buildRangeReport,
    generateDailyReport,
    generateWeeklyReport,
    generateCompareReport,
    renderHtml,
    generateReport,
};
