// Node 18+ : fetch 내장
import fs from 'node:fs/promises'
import path from 'node:path'
import slugify from 'slugify'

// 한/일 표기 그대로 유지하고 id 슬러그는 영문 기준
const slug = (s) => slugify(s, { lower: true, strict: true })

const LANG_KO = 'ko' // Korean
const LANG_JA = 'ja-Hrkt' // Japanese (kana) - PokeAPI 권장 표기
const LANG_JA_FALLBACK = 'ja' // 혹시 일부 항목에서만 ja가 채워진 경우 대비

const NATIONAL_MAX = 1025 // 2025-09-04 기준. 필요 시 업데이트.  :contentReference[oaicite:1]{index=1}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function statBlock(statsArr) {
  // PokeAPI stats: [{stat.name, base_stat}]
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

function toKoType(en) {
  // 타입 한글 표기 매핑 (필요 시 보완)
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

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'pokemon-calc-builder' } })
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`)
  return res.json()
}

function pickLocalizedName(names, lang) {
  return names.find((n) => n.language?.name === lang)?.name
}

function localizeAbilityName(enName) {
  // 특성 한글 매핑은 PokeAPI에 ko 로컬이 거의 다 있으므로 species가 아닌 "ability" 엔드포인트를 써서 확장 가능.
  // 여기서는 우선 영문 그대로 두고, 후처리 단계에서 ko로 치환하는 훅을 남겨둠.
  return enName
}

async function buildOne(id) {
  // 1) 전투 데이터(타입/스탯/영문명/특성)
  const p = await fetchJSON(`https://pokeapi.co/api/v2/pokemon/${id}`)
  // 2) 로컬라이즈 이름/도감번호
  const s = await fetchJSON(`https://pokeapi.co/api/v2/pokemon-species/${id}`)

  // 영문명
  const enName = p.name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  // 한/일 표기
  const koName =
    pickLocalizedName(s.names, LANG_KO) ||
    pickLocalizedName(s.names, 'ko-kr') || // 드문 예외 대비
    enName
  const jpName = pickLocalizedName(s.names, LANG_JA) || pickLocalizedName(s.names, LANG_JA_FALLBACK) || enName

  // dexNo: species의 'id'가 사실상 전국도감 번호(Gen9까지 일치)
  const dexNo = s.id

  // 타입 → 한글
  const types = p.types.sort((a, b) => a.slot - b.slot).map((t) => toKoType(t.type.name))

  // 스탯
  const baseStats = statBlock(p.stats)

  // 특성(영문 그대로 → 후처리에서 koName으로 바꾸고 싶다면 ability API 추가 호출)
  const abilities = p.abilities
    .map((a) => a.ability?.name)
    .filter(Boolean)
    .map((n) => n.replace(/-/g, ' '))
    .map((w) => w.replace(/\b\w/g, (c) => c.toUpperCase()))
    .map(localizeAbilityName)

  // 내부 id: 영문명 기준 슬러그
  const internalId = slug(enName)

  return {
    id: internalId,
    dexNo,
    koName,
    enName,
    jpName,
    types,
    baseStats,
    abilities
  }
}

async function main() {
  const out = []
  for (let i = 1; i <= NATIONAL_MAX; i++) {
    try {
      const row = await buildOne(i)
      out.push(row)
      // 속도/부하 조절 (PokeAPI 배려). 필요 시 더 늘리세요.
      await sleep(100)
      if (i % 50 === 0) console.log(`...processed #${i}`)
    } catch (e) {
      console.error(`Failed at #${i}:`, e.message)
      // 실패 시 재시도 1회
      await sleep(500)
      try {
        const row = await buildOne(i)
        out.push(row)
      } catch (e2) {
        console.error(`Retry failed at #${i}:`, e2.message)
      }
    }
  }

  // dexNo 기준 정렬 및 출력
  out.sort((a, b) => a.dexNo - b.dexNo)

  const outPath = path.join('src', 'data', 'gen9', 'species.json')
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, JSON.stringify(out, null, 2), 'utf8')
  console.log(`✅ Wrote ${out.length} entries -> ${outPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
