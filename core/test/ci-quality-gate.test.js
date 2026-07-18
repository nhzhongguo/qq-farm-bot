const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const rootDir = path.resolve(__dirname, '../..')
const readJson = relativePath => JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), 'utf8'))
const readText = relativePath => fs.readFileSync(path.join(rootDir, relativePath), 'utf8')

test('root scripts expose non-mutating checks and an explicit smoke command', () => {
  const rootPackage = readJson('package.json')
  const corePackage = readJson('core/package.json')
  const webPackage = readJson('web/package.json')

  assert.equal(rootPackage.scripts['lint:check'], 'pnpm lint:core:check && pnpm lint:web:check')
  assert.equal(rootPackage.scripts['lint:fix'], 'pnpm lint:core:fix && pnpm lint:web:fix')
  assert.equal(rootPackage.scripts.lint, 'pnpm lint:check')
  assert.equal(rootPackage.scripts['test:e2e:smoke'], 'pnpm -C web test:e2e e2e/auth-smoke.spec.ts')
  assert.match(corePackage.scripts.test, /ci-quality-gate\.test\.js/)

  assert.equal(corePackage.scripts.lint, 'eslint .')
  assert.equal(corePackage.scripts['lint:fix'], 'eslint . --fix')
  assert.equal(webPackage.scripts.lint, 'eslint "src/**/*.{ts,vue}"')
  assert.equal(webPackage.scripts['lint:fix'], 'eslint "src/**/*.{ts,vue}" --fix')
})

test('GitHub Actions quality gate is pinned, ordered, cached, and has no publish step', () => {
  const workflow = readText('.github/workflows/ci.yml')

  assert.ok(workflow.includes("NODE_VERSION: '20.19.0'"))
  assert.ok(workflow.includes("PNPM_VERSION: '10.30.2'"))
  assert.ok(workflow.includes('pnpm/action-setup@v4'))
  assert.ok(workflow.includes('actions/setup-node@v4'))
  assert.ok(workflow.includes('node-version: $' + '{{ env.NODE_VERSION }}'))
  assert.ok(workflow.includes('version: $' + '{{ env.PNPM_VERSION }}'))
  assert.ok(workflow.includes('cache: pnpm'))
  assert.ok(workflow.includes('pnpm install --frozen-lockfile'))

  const steps = [
    'pnpm install --frozen-lockfile',
    'pnpm test',
    'pnpm lint:check',
    'pnpm build:web',
    'pnpm --dir web exec playwright install --with-deps chromium',
    'pnpm test:e2e:smoke',
  ]
  let previousIndex = -1
  for (const step of steps) {
    const index = workflow.indexOf(step)
    assert.notEqual(index, -1, `workflow is missing ${step}`)
    assert.ok(index > previousIndex, `${step} must run after the previous quality gate`)
    previousIndex = index
  }

  assert.doesNotMatch(workflow, /--fix/)
  assert.doesNotMatch(workflow, /git\s+push|secrets\./)
})
