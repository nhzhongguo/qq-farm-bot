const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const imgDir = path.resolve(__dirname, '../src/gameConfig/seed_images_named')

// 例外组：1014_穗华 / 1101_种植经验 字节相同但 id 各不相同，且 ItemInfo 中无 asset_name
// 回退路径，删除任一个都会导致对应物品图片 404，故必须同时保留。
const ALLOWED_DUPLICATES = new Set(['1014_穗华_suihua.png', '1101_种植经验_exp.png'])

test('seed_images_named has no MD5-duplicate files beyond the documented exception', () => {
  const files = fs.readdirSync(imgDir).filter(f => fs.statSync(path.join(imgDir, f)).isFile())
  const byHash = new Map()
  for (const file of files) {
    const hash = crypto.createHash('md5').update(fs.readFileSync(path.join(imgDir, file))).digest('hex')
    if (!byHash.has(hash)) byHash.set(hash, [])
    byHash.get(hash).push(file)
  }
  const duplicateGroups = [...byHash.values()].filter(group => group.length > 1)
  for (const group of duplicateGroups) {
    for (const file of group) {
      assert.ok(
        ALLOWED_DUPLICATES.has(file),
        `duplicate file not in allowlist: ${file} (group: ${group.join(', ')})`
      )
    }
  }
})
