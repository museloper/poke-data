// Node 18+ required. Generates species.json for gen6, gen7, gen8, gen9 via PokeAPI.
// 출력: src/data/{gen6|gen7|gen8|gen9}/species.json
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const NATIONAL_MAX = 1025 // 필요 시 최신 값으로 업데이트

const LANG_KO = 'ko'
const LANG_JA = 'ja-Hrkt'
const LANG_JA_FALLBACK = 'ja'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'pokemon-calc-builder' } })
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`)
  return res.json()
}

function pickLocalizedName(names, lang) {
  return names.find((n) => n.language?.name === lang)?.name
}

function toTitle(s) {
  return s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function toKoType(en) {
  const map = {
    normal: '노말',
    fire: '불꽃',
    water: '물',
    electric: '전기',
    grass: '풀',
    ice: '얼음',
    fighting: '격투',
    poison: '독',
    ground: '땅',
    flying: '비행',
    psychic: '에스퍼',
    bug: '벌레',
    rock: '바위',
    ghost: '고스트',
    dragon: '드래곤',
    dark: '악',
    steel: '강철',
    fairy: '페어리'
  }
  return map[en] ?? en
}

function statBlock(statsArr) {
  const pick = (n) => statsArr.find((s) => s.stat?.name === n)?.base_stat ?? 0
  return {
    hp: pick('hp'),
    atk: pick('attack'),
    def: pick('defense'),
    spa: pick('special-attack'),
    spd: pick('special-defense'),
    spe: pick('speed')
  }
}

function slugifyId(enName) {
  return enName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function buildOne(id) {
  // p: 전투 데이터(타입/스탯/영문명/특성), s: 도감/로캘 이름
  const p = await fetchJSON(`https://pokeapi.co/api/v2/pokemon/${id}`)
  const s = await fetchJSON(`https://pokeapi.co/api/v2/pokemon-species/${id}`)

  const enName = toTitle(p.name)
  const koName = pickLocalizedName(s.names, LANG_KO) || enName
  const jpName = pickLocalizedName(s.names, LANG_JA) || pickLocalizedName(s.names, LANG_JA_FALLBACK) || enName
  const dexNo = s.id

  const types = p.types.sort((a, b) => a.slot - b.slot).map((t) => toKoType(t.type.name))
  const baseStats = statBlock(p.stats)
  const abilities = p.abilities
    .map((a) => a.ability?.name)
    .filter(Boolean)
    .map((n) => toTitle(n))

  const idSlug = slugifyId(enName)

  return { id: idSlug, dexNo, koName, enName, jpName, types, baseStats, abilities }
}

async function buildAll() {
  const out = []
  for (let i = 1; i <= NATIONAL_MAX; i++) {
    try {
      const row = await buildOne(i)
      out.push(row)
      await sleep(80) // PokeAPI 매너 타임
      if (i % 50 === 0) console.log(`...processed #${i}`)
    } catch (e) {
      console.error(`Failed at #${i}: ${e.message}`)
      await sleep(500)
      try {
        const row = await buildOne(i)
        out.push(row)
      } catch (e2) {
        console.error(`Retry failed at #${i}: ${e2.message}`)
      }
    }
  }
  out.sort((a, b) => a.dexNo - b.dexNo)
  return out
}

function applyPatches(base, patches) {
  if (!patches || Object.keys(patches).length === 0) return base
  const map = new Map(base.map((x) => [x.dexNo, x]))
  for (const [dexStr, patch] of Object.entries(patches)) {
    const dex = Number(dexStr)
    const row = map.get(dex)
    if (!row) continue
    const merged = { ...row, ...patch }
    if (patch.baseStats) {
      merged.baseStats = { ...row.baseStats, ...patch.baseStats }
    }
    map.set(dex, merged)
  }
  return Array.from(map.values()).sort((a, b) => a.dexNo - b.dexNo)
}

async function readJSONIfExists(p) {
  try {
    const txt = await fs.readFile(p, 'utf8')
    return JSON.parse(txt)
  } catch {
    return {}
  }
}

async function main() {
  const base = await buildAll()

  // 세대별 패치(선택)
  const patchDir = 'patches'
  const patchGen6 = await readJSONIfExists(path.join(patchDir, 'gen6-species-patches.json'))
  const patchGen7 = await readJSONIfExists(path.join(patchDir, 'gen7-species-patches.json'))
  const patchGen8 = await readJSONIfExists(path.join(patchDir, 'gen8-species-patches.json'))
  const patchGen9 = await readJSONIfExists(path.join(patchDir, 'gen9-species-patches.json'))

  const out6 = applyPatches(base, patchGen6)
  const out7 = applyPatches(base, patchGen7)
  const out8 = applyPatches(base, patchGen8)
  const out9 = applyPatches(base, patchGen9)

  const baseDir = path.join('src', 'data')
  await fs.mkdir(path.join(baseDir, 'gen6'), { recursive: true })
  await fs.mkdir(path.join(baseDir, 'gen7'), { recursive: true })
  await fs.mkdir(path.join(baseDir, 'gen8'), { recursive: true })
  await fs.mkdir(path.join(baseDir, 'gen9'), { recursive: true })

  await fs.writeFile(path.join(baseDir, 'gen6', 'species.json'), JSON.stringify(out6, null, 2), 'utf8')
  await fs.writeFile(path.join(baseDir, 'gen7', 'species.json'), JSON.stringify(out7, null, 2), 'utf8')
  await fs.writeFile(path.join(baseDir, 'gen8', 'species.json'), JSON.stringify(out8, null, 2), 'utf8')
  await fs.writeFile(path.join(baseDir, 'gen9', 'species.json'), JSON.stringify(out9, null, 2), 'utf8')

  console.log('✅ Wrote species.json for gen6, gen7, gen8, gen9')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
