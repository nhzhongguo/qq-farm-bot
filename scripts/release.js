#!/usr/bin/env node
/**
 * 发布脚本：校验版本一致性、更新构建时间戳、校验 CHANGELOG、打 Git 标签。
 * 用法：
 *   node scripts/release.js            # 校验并输出发布摘要（不修改）
 *   node scripts/release.js --tag      # 校验通过后打 Git 标签 vX.Y.Z
 *   node scripts/release.js --bump     # 提升版本号到下一个 patch（需手动提交）
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');

function readJson(relativePath) {
    return JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), 'utf8'));
}

function getVersion() {
    return readJson('version.json').version;
}

function checkVersionsConsistent(version) {
    const failures = [];
    for (const pkg of ['package.json', 'core/package.json', 'web/package.json']) {
        const pkgVersion = readJson(pkg).version;
        if (pkgVersion !== version) {
            failures.push(`${pkg} 版本 ${pkgVersion} 与 version.json ${version} 不一致`);
        }
    }
    return failures;
}

function checkChangelog(version) {
    const changelog = fs.readFileSync(path.join(rootDir, 'CHANGELOG.md'), 'utf8');
    if (!changelog.includes(`## v${version}`)) {
        return [`CHANGELOG.md 缺少 v${version} 章节`];
    }
    return [];
}

function checkBuildTimestamp(version) {
    const manifest = readJson('version.json');
    const today = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    if (manifest.build && manifest.build !== String(today)) {
        return [`version.json build=${manifest.build}，今天为 ${today}（可运行 --touch 刷新）`];
    }
    return [];
}

function bumpPatch(version) {
    const parts = version.split('.').map(Number);
    if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) {
        throw new Error(`无法解析版本号: ${version}`);
    }
    parts[2] += 1;
    return parts.join('.');
}

function main() {
    const args = process.argv.slice(2);
    const wantTag = args.includes('--tag');
    const wantBump = args.includes('--bump');
    const wantTouch = args.includes('--touch');

    let version = getVersion();
    if (wantBump) {
        version = bumpPatch(version);
    }

    const failures = [
        ...checkVersionsConsistent(version),
        ...checkChangelog(version),
    ];
    if (wantTouch || wantBump) {
        // build 时间戳仅在显式请求时视为问题
    } else {
        failures.push(...checkBuildTimestamp(version));
    }

    if (failures.length > 0) {
        console.error('❌ 发布校验失败：');
        for (const f of failures) {
            console.error(`  - ${f}`);
        }
        process.exitCode = 1;
        return;
    }

    console.log(`✅ 版本一致性校验通过：v${version}`);
    console.log(`   - version.json / package.json / core / web 一致`);
    console.log(`   - CHANGELOG.md 包含 v${version} 章节`);

    if (wantTouch) {
        const manifest = readJson('version.json');
        manifest.build = new Date().toISOString().slice(0, 10).replaceAll('-', '');
        fs.writeFileSync(path.join(rootDir, 'version.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
        console.log(`   - version.json build 已刷新为 ${manifest.build}`);
    }

    if (wantBump) {
        const manifest = readJson('version.json');
        manifest.version = version;
        manifest.build = new Date().toISOString().slice(0, 10).replaceAll('-', '');
        for (const pkg of ['package.json', 'core/package.json', 'web/package.json']) {
            const p = readJson(pkg);
            p.version = version;
            fs.writeFileSync(path.join(rootDir, pkg), `${JSON.stringify(p, null, 2)}\n`, 'utf8');
        }
        fs.writeFileSync(path.join(rootDir, 'version.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
        console.log(`   - 4 处版本号已提升至 v${version}（请手动补充 CHANGELOG 后提交）`);
    }

    if (wantTag) {
        const tags = execSync('git tag --list', { encoding: 'utf8' }).split('\n').map(t => t.trim()).filter(Boolean);
        const tag = `v${version}`;
        if (tags.includes(tag)) {
            console.error(`❌ 标签 ${tag} 已存在，拒绝重复打标签`);
            process.exitCode = 1;
            return;
        }
        execSync(`git tag ${tag}`, { cwd: rootDir, stdio: 'inherit' });
        console.log(`   - 已打 Git 标签 ${tag}`);
    }

    console.log('发布摘要：');
    console.log(`  - 版本：v${version}`);
    console.log(`  - 时间：${new Date().toLocaleString('zh-CN')}`);
    if (wantTag) {
        console.log(`  - 标签：v${version}（回退: git checkout v${version}）`);
    }
}

main();
