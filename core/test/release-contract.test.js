const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const rootDir = path.resolve(__dirname, '../..')

function readJson(relativePath) {
    return JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), 'utf8'));
}

test('release manifest matches every package version and describes the upgrade', () => {
    const manifest = readJson('version.json');
    const rootPackage = readJson('package.json');
    const corePackage = readJson('core/package.json');
    const webPackage = readJson('web/package.json');

    assert.equal(manifest.version, '2.4.0');
    assert.match(manifest.build, /^20260719$/);
    assert.match(manifest.upgrade, /商业级|可观测|质量门/);
    assert.equal(rootPackage.version, manifest.version);
    assert.equal(corePackage.version, manifest.version);
    assert.equal(webPackage.version, manifest.version);
});

test('release scripts expose non-mutating checks and a smoke command', () => {
    const rootPackage = readJson('package.json');

    assert.equal(rootPackage.scripts.lint, 'pnpm lint:check');
    assert.equal(rootPackage.scripts['lint:check'], 'pnpm lint:core:check && pnpm lint:web:check');
    assert.equal(rootPackage.scripts['lint:fix'], 'pnpm lint:core:fix && pnpm lint:web:fix');
    assert.equal(rootPackage.scripts['test:e2e:smoke'], 'pnpm -C web test:e2e e2e/auth-smoke.spec.ts');
});
