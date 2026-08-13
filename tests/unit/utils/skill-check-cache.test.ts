/**
 * skill 更新檢查的 TTL 快取（#45）
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SKILL_CHECK_TTL_MS,
  invalidateSkillCheckCache,
  readSkillCheckCache,
  writeSkillCheckCache,
} from '@/utils/skill-check-cache'

describe('skill check cache', () => {
  let configPath: string

  beforeEach(async () => {
    configPath = await mkdtemp(join(tmpdir(), 'dbcli-skill-cache-'))
  })

  afterEach(async () => {
    await rm(configPath, { recursive: true, force: true })
  })

  test('快取不存在時回報 miss', async () => {
    expect(await readSkillCheckCache(configPath, '1.53.0')).toBeNull()
  })

  test('有效期內回報上次的掃描結果', async () => {
    await writeSkillCheckCache(configPath, '1.53.0', ['claude'])
    expect(await readSkillCheckCache(configPath, '1.53.0')).toEqual(['claude'])
  })

  test('空結果也會被快取——「沒有過期的 skill」同樣值得跳過下一次掃描', async () => {
    await writeSkillCheckCache(configPath, '1.53.0', [])
    expect(await readSkillCheckCache(configPath, '1.53.0')).toEqual([])
  })

  test('超過 TTL 後回報 miss', async () => {
    await writeSkillCheckCache(configPath, '1.53.0', ['claude'], {
      now: Date.now() - SKILL_CHECK_TTL_MS - 1,
    })
    expect(await readSkillCheckCache(configPath, '1.53.0')).toBeNull()
  })

  test('dbcli 版本變了就重新掃描——新版本帶來的是新的 skill 內容', async () => {
    await writeSkillCheckCache(configPath, '1.53.0', [])
    expect(await readSkillCheckCache(configPath, '1.54.0')).toBeNull()
  })

  test('安裝 skill 後快取失效', async () => {
    await writeSkillCheckCache(configPath, '1.53.0', ['claude'])
    await invalidateSkillCheckCache(configPath)
    expect(await readSkillCheckCache(configPath, '1.53.0')).toBeNull()
  })

  test('快取檔壞掉時視為 miss，不讓命令失敗', async () => {
    await Bun.file(join(configPath, 'skill-check.json')).write('{ not json')
    expect(await readSkillCheckCache(configPath, '1.53.0')).toBeNull()
  })
})
