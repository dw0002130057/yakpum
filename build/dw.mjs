// 대웅제약 품목 → 상병코드(3단) 목록 만들기: site/data/dw.json  { "E78": [[품목코드, 제품명], ...] }
// 천리안 상세화면의 상병코드 자동매칭(index.html sickOf)과 같은 규칙
import { readFile, writeFile } from 'node:fs/promises';
const D = new URL('../site/data/', import.meta.url).pathname;
const rd = async (f) => JSON.parse(await readFile(D + f, 'utf8'));
const idx = await rd('idx.json'), sick = await rd('sick.json').catch(() => []);
const FIX = [[/펙수클루정40/, ['K210']]];
const SYN = [['I10','고혈압'],['E11','제2형당뇨'],['E11','인슐린비의존당뇨'],['E78','고지혈'],['E78','이상지질혈'],['E78','고콜레스테롤혈'],['K25','위궤양'],['K26','십이지장궤양'],['K29','위염'],['K21','위식도역류'],['B98','헬리코박터'],['K76','지방간'],['K80','담석'],['M81','골다공'],['F32','우울']];
const nz = (t) => String(t || '').replace(/[\s\-·,()\[\]]/g, '');
const dec = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const strip = (s) => dec(dec(String(s || '').replace(/<[^>]*>/g, ' '))).replace(/<[^>]*>/g, ' ');
const IX = [];
for (const r of sick) { if (r[0].length !== 3 || !r[1] || /^기타|상세불명/.test(r[1]) || r[0] === 'R81') continue; const n0 = nz(r[1]), c = n0.replace(/(질환|병|증|장애)$/, ''); if (c.length >= 3 || (c === n0 && c.length >= 2)) IX.push([r[0], c]); }
SYN.forEach((a) => IX.push([a[0], a[1]]));
IX.sort((a, b) => b[1].length - a[1].length);
const codesOf = (d) => {
  const fix = FIX.find((f) => f[0].test(d.ITEM_NAME || '')); if (fix) return fix[1];
  const raw = String(d.EE_DOC_DATA || ''), t = nz(strip(raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, ' $1 ').replace(/title="([^"]*)"/g, '> $1 <')));
  const used = [], out = new Set();
  for (const [cd, c] of IX) { const i = t.indexOf(c); if (i < 0 || used.some((u) => i >= u[0] && i + c.length <= u[1])) continue; used.push([i, i + c.length]); out.add(cd); }
  return [...out];
};
const shardCache = new Map();
const shard = async (seq) => { const k = String(Number(String(seq).slice(-3)) % 1000).padStart(3, '0'); if (!shardCache.has(k)) shardCache.set(k, await rd('d/' + k + '.json')); return shardCache.get(k); };
const map = {};
let n = 0;
for (const r of idx) {
  if (!/대웅제약/.test(r[2]) || (r[7] && r[7] !== '정상')) continue;
  const d = (await shard(r[0]))[r[0]]; if (!d) continue; n++;
  for (const cd of codesOf(d)) (map[cd] ||= []).push([r[0], r[1].replace(/\(.*$/, ''), r[8] || 0]);
}
await writeFile(D + 'dw.json', JSON.stringify(map));
const meta = await rd('meta.json'); meta.dw = Date.now(); await writeFile(D + 'meta.json', JSON.stringify(meta));
console.log('✔ 대웅제약', n, '품목 →', Object.keys(map).length, '개 상병코드');
