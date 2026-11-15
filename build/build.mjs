// 공공데이터를 전부 받아 사이트가 바로 읽을 파일(site/data)로 만든다.
// 실행: SERVICE_KEY=... node build/build.mjs   (GitHub Actions가 매달 자동 실행)
// 하나라도 실패하면 오류로 끝나서, 이전에 올라간 사이트는 그대로 유지된다.
import { mkdir, writeFile } from 'node:fs/promises';

const KEY = process.env.SERVICE_KEY || '';
if (!KEY) throw new Error('SERVICE_KEY 가 없습니다 (GitHub 저장소 Settings > Secrets 에 등록 필요)');
const OUT = new URL('../site/data/', import.meta.url).pathname;
const SHARDS = 1000;

const EP = {
  permit: 'https://apis.data.go.kr/1471000/DrugPrdtPrmsnInfoService08/getDrugPrdtPrmsnDtlInq08',
  pill: 'https://apis.data.go.kr/1471000/MdcinGrnIdntfcInfoService03/getMdcinGrnIdntfcInfoList03',
  dur: 'https://apis.data.go.kr/1471000/DURPrdlstInfoService03',
  recall: 'https://apis.data.go.kr/1471000/MdcinRtrvlSleStpgeInfoService05/getMdcinRtrvlSleStpgelList05',
  sick: 'https://apis.data.go.kr/B551182/diseaseInfoService1/getDissNameCodeList1',
  price: 'https://apis.data.go.kr/B551182/dgamtCrtrInfoService1.2/getDgamtList',
};
const DUR_OPS = {
  usjnt: 'getUsjntTabooInfoList03', age: 'getSpcifyAgrdeTabooInfoList03', preg: 'getPwnmTabooInfoList03',
  dose: 'getCpctyAtentInfoList03', period: 'getMdctnPdAtentInfoList03', elder: 'getOdsnAtentInfoList03',
  dup: 'getEfcyDplctInfoList03', split: 'getSeobangjeongPartitnAtentInfoList03',
};

/* ---------- 공공데이터 부르기 ---------- */
let calls = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function url(base, params) {
  const q = ['serviceKey=' + (KEY.includes('%') ? KEY : encodeURIComponent(KEY))];
  for (const [k, v] of Object.entries(params)) if (v !== '' && v != null) q.push(k + '=' + encodeURIComponent(v));
  return base + '?' + q.join('&');
}
const ent = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function parse(text) {
  text = String(text || '').trim();
  if (text[0] === '{') {
    const j = JSON.parse(text), head = j.header || j.response?.header || {}, body = j.body || j.response?.body || {};
    if (head.resultCode && head.resultCode !== '00') throw new Error('공공데이터 오류: ' + head.resultMsg);
    let it = body.items || [];
    if (it && it.item) it = it.item;
    if (!Array.isArray(it)) it = it ? [it] : [];
    return { total: Number(body.totalCount || it.length), items: it.map((x) => (x && x.item ? x.item : x)) };
  }
  const err = text.match(/<returnAuthMsg>([^<]*)</) || text.match(/<resultCode>(?!00)([^<]*)<\/resultCode>\s*<resultMsg>([^<]*)/);
  if (err) throw new Error('공공데이터 오류: ' + err.slice(1).join(' '));
  const total = Number((text.match(/<totalCount>(\d+)</) || [])[1] || 0);
  const items = (text.match(/<item>[\s\S]*?<\/item>/g) || []).map((blk) => {
    const o = {};
    for (const m of blk.slice(6, -7).matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)) o[m[1]] = ent(m[2]);
    return o;
  });
  return { total, items };
}
async function get(base, params, tries = 8) {
  for (let i = 1; ; i++) {
    try {
      calls++;
      const res = await fetch(url(base, params), { signal: AbortSignal.timeout(300000) });
      const text = await res.text();
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + text.slice(0, 200));
      return parse(text);
    } catch (e) {
      if (i >= tries) throw new Error(base.split('/').pop() + ' ' + JSON.stringify(params) + ' → ' + e.message);
      await sleep(10000 * i);
    }
  }
}
/** 목록 전체를 쪽(page) 단위로 받음. 동시에 conc개씩 */
async function all(base, params, per, conc, label, map) {
  const first = await get(base, { ...params, numOfRows: per, pageNo: 1 });
  const pages = Math.ceil(first.total / per), out = map ? first.items.map(map) : [...first.items];
  let next = 2;
  async function worker() {
    while (next <= pages) {
      const p = next++;
      const r = await get(base, { ...params, numOfRows: per, pageNo: p });
      for (const it of r.items) out.push(map ? map(it) : it);
      if (p % 50 === 0) console.log(`  ${label}: ${p}/${pages}쪽`);
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  console.log(`✔ ${label}: ${out.length} / ${first.total}건`);
  if (out.length < first.total * 0.98) throw new Error(`${label}: 받은 건수가 너무 적습니다 (${out.length}/${first.total})`);
  return out;
}
async function pool(list, conc, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: conc }, async () => { while (i < list.length) { const n = i++; await fn(list[n], n); } }));
}

/* ---------- 받기 ---------- */
const t0 = Date.now();
console.log('허가정보 받는 중…');
const permits = await all(EP.permit, { type: 'json' }, 500, 4, '허가정보');
console.log('낱알·회수 받는 중…');
const pills = await all(EP.pill, { type: 'json' }, 500, 4, '낱알');
const recalls = await all(EP.recall, { type: 'json' }, 500, 2, '회수·판매중지');
console.log('DUR 받는 중…');
const dur = {};
const slim = (r) => ({ seq: String(r.ITEM_SEQ || ''), cls: r.CLASS_NAME || '', t: r.TYPE_NAME || '', c: r.PROHBT_CONTENT || '', d: r.NOTIFICATION_DATE || '',
  ms: r.MIXTURE_ITEM_SEQ || '', mn: r.MIXTURE_ITEM_NAME || '', mi: r.MIXTURE_INGR_KOR_NAME || '' });
for (const [k, op] of Object.entries(DUR_OPS)) dur[k] = await all(EP.dur + '/' + op, { type: 'json' }, 500, k === 'usjnt' ? 6 : 3, 'DUR ' + k, slim);

console.log('약가 받는 중 (업체별)…');
const firmKey = (s) => String(s || '').replace(/\(주\)|㈜|주식회사|\(유\)|유한회사|\(재\)|재단법인|\s/g, '').trim();
const firms = [...new Set(permits.map((p) => firmKey(p.ENTP_NAME)).filter((f) => f.length >= 2))];
const prices = new Map(); // 제품코드(mdsCd) → 약가 행
let firmFail = 0;
await pool(firms, 4, async (f, n) => {
  try {
    const rows = await all(EP.price, { mnfEntpNm: f }, 1000, 1, '약가 ' + f);
    for (const r of rows) if (r.mdsCd) { const old = prices.get(r.mdsCd); if (!old || String(r.adtStaDd) > String(old.adtStaDd)) prices.set(r.mdsCd, r); }
  } catch (e) { firmFail++; console.log('  ! 약가 ' + f + ' 실패: ' + e.message.slice(0, 120)); }
  if (n % 100 === 0) console.log(`  약가: 업체 ${n}/${firms.length}`);
});
console.log(`✔ 약가: ${prices.size}개 제품 (업체 ${firms.length}곳 중 실패 ${firmFail})`);
if (firmFail > firms.length * 0.1) throw new Error('약가를 받지 못한 업체가 너무 많습니다');

/* ---------- 파일 만들기 ---------- */
await mkdir(OUT + 'd', { recursive: true });
const ediOf = (p) => String(p.EDI_CODE || '').split(',')[0].trim();
const shardOf = (seq) => String(Number(String(seq).slice(-3)) % SHARDS).padStart(3, '0');
const pillBySeq = new Map(pills.map((p) => [String(p.ITEM_SEQ), p]));
const classBySeq = new Map();

// DUR → 제품별
const durBySeq = new Map();
for (const [k, rows] of Object.entries(dur)) {
  for (const r of rows) {
    const seq = r.seq;
    if (!seq) continue;
    if (r.cls && !classBySeq.has(seq)) classBySeq.set(seq, r.cls);
    const item = { t: r.t, c: r.c, d: r.d };
    if (k === 'usjnt') Object.assign(item, { ms: r.ms, mn: r.mn, mi: r.mi });
    if (!durBySeq.has(seq)) durBySeq.set(seq, {});
    (durBySeq.get(seq)[k] ||= []).push(item);
  }
}

// 검색 목록: [품목코드, 제품명, 업체, 주성분, 전문/일반, 보험코드, 허가일, 상태, 약가, 분류]
const idx = permits.map((p) => {
  const pr = prices.get(ediOf(p));
  return [String(p.ITEM_SEQ), p.ITEM_NAME || '', p.ENTP_NAME || '', p.MAIN_ITEM_INGR || '', p.ETC_OTC_CODE || '', String(p.EDI_CODE || ''),
    p.ITEM_PERMIT_DATE || '', p.CANCEL_NAME || '', pr ? Number(pr.mxCprc) || 0 : 0, classBySeq.get(String(p.ITEM_SEQ)) || ''];
}).sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
await writeFile(OUT + 'idx.json', JSON.stringify(idx));

// 제품별 상세 (1000개 묶음 파일)
const shards = Array.from({ length: SHARDS }, () => ({}));
const keep = ['ITEM_SEQ', 'ITEM_NAME', 'ITEM_ENG_NAME', 'ENTP_NAME', 'MAIN_ITEM_INGR', 'MAIN_INGR_ENG', 'MATERIAL_NAME', 'INGR_NAME', 'ETC_OTC_CODE',
  'EDI_CODE', 'ATC_CODE', 'BAR_CODE', 'CHART', 'PACK_UNIT', 'STORAGE_METHOD', 'VALID_TERM', 'ITEM_PERMIT_DATE', 'CHANGE_DATE', 'PERMIT_KIND_NAME',
  'NEWDRUG_CLASS_NAME', 'CNSGN_MANUF', 'RARE_DRUG_YN', 'CANCEL_NAME', 'EE_DOC_DATA', 'UD_DOC_DATA', 'NB_DOC_DATA'];
for (const p of permits) {
  const seq = String(p.ITEM_SEQ), o = {};
  for (const k of keep) if (p[k] != null && p[k] !== '') o[k] = p[k];
  const pl = pillBySeq.get(seq);
  if (pl && pl.ITEM_IMAGE) o.IMG = pl.ITEM_IMAGE;
  if (classBySeq.has(seq)) o.CLASS_NAME = classBySeq.get(seq);
  const pr = prices.get(ediOf(p));
  if (pr) o.PRICE = { itmNm: pr.itmNm, mxCprc: pr.mxCprc, unit: pr.unit, payTpNm: pr.payTpNm, spcGnlTpNm: pr.spcGnlTpNm, adtStaDd: pr.adtStaDd, gnlNmCd: pr.gnlNmCd };
  if (durBySeq.has(seq)) o.DUR = durBySeq.get(seq);
  shards[Number(shardOf(seq))][seq] = o;
}
await Promise.all(shards.map((s, i) => writeFile(OUT + 'd/' + String(i).padStart(3, '0') + '.json', JSON.stringify(s))));

// 약가 목록 (성분코드·약가 화면용)
await writeFile(OUT + 'price.json', JSON.stringify([...prices.values()].map((r) => [r.itmNm, r.mnfEntpNm, r.gnlNmCd, r.mdsCd, r.mxCprc, r.unit, r.payTpNm, r.spcGnlTpNm, r.injcPthNm, r.adtStaDd])));
// 낱알·회수
const pk = ['ITEM_SEQ', 'ITEM_NAME', 'ENTP_NAME', 'ITEM_IMAGE', 'DRUG_SHAPE', 'COLOR_CLASS1', 'COLOR_CLASS2', 'PRINT_FRONT', 'PRINT_BACK', 'FORM_CODE_NAME'];
await writeFile(OUT + 'pills.json', JSON.stringify(pills.map((p) => pk.map((k) => p[k] || ''))));
const rk = ['PRDUCT', 'ENTRPS', 'RTRVL_RESN', 'RECALL_COMMAND_DATE', 'ENFRC_YN', 'RTRVL_CMMND_DT', 'ITEM_SEQ'];
await writeFile(OUT + 'recall.json', JSON.stringify(recalls.map((p) => rk.map((k) => p[k] || ''))));

// 상병코드 (질병정보서비스) — 실패해도 나머지는 올림
let sick = [];
try {
  const seen = new Map();
  for (const sickType of [1, 2]) for (const L of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const rows = await all(EP.sick, { sickType, medTp: 1, diseaseType: 'SICK_CD', searchText: L }, 1000, 2, `상병 ${sickType}단 ${L}`);
    for (const it of rows) {
      const ks = Object.keys(it), cd = it[ks.find((k) => /cd$/i.test(k))] || '', nm = it[ks.find((k) => /nm$/i.test(k) && !/eng/i.test(k))] || '', en = it[ks.find((k) => /eng/i.test(k))] || '';
      if (cd && !seen.has(cd)) seen.set(cd, [cd, nm, en]);
    }
  }
  sick = [...seen.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  console.log('✔ 상병코드', sick.length, '개');
} catch (e) { console.log('⚠ 상병코드 실패(다음 달 다시 시도):', e.message); }
await writeFile(OUT + 'sick.json', JSON.stringify(sick));

const meta = { built: new Date().toISOString(), counts: { permits: permits.length, pills: pills.length, recalls: recalls.length, sick: sick.length, prices: prices.size, dur: Object.fromEntries(Object.entries(dur).map(([k, v]) => [k, v.length])) }, calls, minutes: Math.round((Date.now() - t0) / 60000) };
await writeFile(OUT + 'meta.json', JSON.stringify(meta));
console.log('완료', JSON.stringify(meta));
