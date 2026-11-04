// 2026-11-04 원자재 추천 모델 비교 시험 실행기(OPENAI_PROVIDER_DESIGN_v1.md 4절). 배포하지 않는다 — Cloud Shell에서만 실행.
// 실제 운영 코드(lib/materialSuggest.js)의 buildPrompt·callOpenAI·callDeepSeek·parseAIText를 그대로 쓴다(시험한 코드 = 배포할 코드).
// 샘플 파일(품목·정답·원자재 목록)은 회사 정보라 저장소에 두지 않는다. 키는 환경변수로만 받고 출력하지 않는다.
//
// 실행: (cloud-run/mro-functions 폴더에서)
//   read -s OPENAI_API_KEY && export OPENAI_API_KEY
//   node tests/ai_model_compare.js --sample ~/aitest/sample.json --arms A,B,C,D,E --reps 2 --out ~/aitest/result.csv
//   (F=DeepSeek은 DEEPSEEK_API_KEY가 있을 때만)
// sample.json: { "raw": [["RM001","고무"], ...], "items": [{ "no":1, "cat":"①일반 품목", "name":"…", "answer":["폴리에틸렌","VCI 방청제"] | null }] }
//   answer가 null이면("모름") 정확도에서 빼고 형식·속도만 센다.
const fs = require('fs'), path = require('path');
const ms = require(path.join(__dirname, '..', 'lib', 'materialSuggest.js'));

const ARMS = {
  A: { provider: 'OPENAI', model: 'gpt-6-luna', effort: 'none' },
  B: { provider: 'OPENAI', model: 'gpt-6-luna', effort: 'low' },
  C: { provider: 'OPENAI', model: 'gpt-5.4-mini', effort: 'none' },
  D: { provider: 'OPENAI', model: 'gpt-5.4-mini', effort: 'low' },
  E: { provider: 'OPENAI', model: 'gpt-5.4-nano', effort: 'low' },
  F: { provider: 'DEEPSEEK', model: 'deepseek-v4-flash', effort: 'low' }
};
const TIMEOUT_MS = 45000; // Cloud Run AI_TOTAL_BUDGET_MS와 같음

function arg(name, dflt) { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : dflt; }
const norm = s => String(s || '').replace(/\s+/g, '').toLowerCase();

function callArm(arm, prompt) {
  if (arm.provider === 'DEEPSEEK') return ms.callDeepSeek(fetch, process.env.DEEPSEEK_API_KEY, prompt, TIMEOUT_MS);
  return ms.callOpenAI(fetch, process.env.OPENAI_API_KEY, arm.model, arm.effort, prompt, TIMEOUT_MS);
}

// 정답 대조: 순서 무관 완전일치 1, 하나 이상 겹침 0.5, 없음 0
function score(pred, answer) {
  const P = pred.map(norm), A = answer.map(norm);
  const hit = P.filter(x => A.includes(x)).length;
  const exact = hit === A.length && P.length === A.length;
  return { s: exact ? 1 : (hit > 0 ? 0.5 : 0), top1: P.length > 0 && A.includes(P[0]), extra: pred.filter(x => !A.includes(norm(x))) };
}

async function pool(tasks, n) {
  const out = new Array(tasks.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < tasks.length) { const k = i++; out[k] = await tasks[k](); } }));
  return out;
}

(async () => {
  const sample = JSON.parse(fs.readFileSync(arg('sample'), 'utf8'));
  const arms = String(arg('arms', 'A,B,C,D,E')).split(',').map(s => s.trim()).filter(Boolean);
  const reps = parseInt(arg('reps', '2'), 10), conc = parseInt(arg('conc', '5'), 10);
  const outPath = arg('out', 'ai_compare_result.csv');
  const masterNames = new Set(sample.raw.map(r => norm(r[1])));
  const rows = [];
  for (const key of arms) {
    const arm = ARMS[key];
    if (!arm) { console.log('모르는 조합: ' + key); continue; }
    if (arm.provider === 'OPENAI' && !process.env.OPENAI_API_KEY) { console.log(key + ': OPENAI_API_KEY 없음 — 건너뜀'); continue; }
    if (arm.provider === 'DEEPSEEK' && !process.env.DEEPSEEK_API_KEY) { console.log(key + ': DEEPSEEK_API_KEY 없음 — 건너뜀'); continue; }
    const tasks = [];
    for (let rep = 1; rep <= reps; rep++) {
      for (const it of sample.items) {
        tasks.push(async () => {
          const r = await callArm(arm, ms.buildPrompt(sample.raw, it.name));
          const p = ms.parseAIText(r.text);
          const mats = p ? p.materials.filter(m => m && m.korean) : [];
          const pred = mats.map(m => String(m.korean).trim());
          const listMiss = mats.filter(m => m.isNew === false && !masterNames.has(norm(m.korean))).length;
          const sc = (p && it.answer) ? score(pred, it.answer) : null;
          return { arm: key, rep, no: it.no, cat: it.cat, name: it.name, ok: !!p, err: r.error || (p ? '' : 'PARSE'), ms: r.ms,
            pred: pred.join(', '), isNew: mats.map(m => m.isNew ? 'Y' : 'N').join(''), over2: pred.length > 2,
            listMiss, answer: it.answer ? it.answer.join(', ') : '(모름)', s: sc ? sc.s : '', top1: sc ? (sc.top1 ? 1 : 0) : '',
            extra: sc ? sc.extra.join(', ') : '', inTok: r.usage ? r.usage.inTok : '', outTok: r.usage ? r.usage.outTok : '', rTok: r.usage ? r.usage.reasoningTok : '' };
        });
      }
    }
    const t0 = Date.now();
    const res = await pool(tasks, conc);
    rows.push(...res);
    console.log(key + ' 완료 ' + res.length + '건, ' + Math.round((Date.now() - t0) / 1000) + '초');
  }

  // CSV(회사 정보 — Cloud Shell 안에만 둔다)
  const cols = ['arm', 'rep', 'no', 'cat', 'name', 'ok', 'err', 'ms', 'pred', 'isNew', 'over2', 'listMiss', 'answer', 's', 'top1', 'extra', 'inTok', 'outTok', 'rTok'];
  const q = v => '"' + String(v === undefined ? '' : v).replace(/"/g, '""') + '"';
  fs.writeFileSync(outPath, '﻿' + [cols.join(',')].concat(rows.map(r => cols.map(c => q(r[c])).join(','))).join('\n'));

  // 요약표
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  console.log('\n조합 | 모델/강도 | 건수 | JSON오류 | 시간초과 | 평균초 | 최대초 | 정확도% | 1순위% | 목록불일치 | 3개이상 | 흔들림% | 입력토큰 | 출력토큰 | 추론토큰');
  for (const key of arms) {
    const R = rows.filter(r => r.arm === key); if (!R.length) continue;
    const scored = R.filter(r => r.s !== '');
    const byNo = {}; R.forEach(r => { (byNo[r.no] = byNo[r.no] || {})[r.rep] = norm(r.pred.split(', ').sort().join(',')); });
    const pairs = Object.values(byNo).filter(v => v[1] !== undefined && v[2] !== undefined);
    const flips = pairs.filter(v => v[1] !== v[2]).length;
    const tok = k => { const v = R.map(r => r[k]).filter(x => x !== ''); return v.length ? Math.round(avg(v)) : '-'; };
    console.log([key, ARMS[key].model + '/' + ARMS[key].effort, R.length, R.filter(r => !r.ok).length, R.filter(r => r.err === 'TIMEOUT').length,
      (avg(R.map(r => r.ms)) / 1000).toFixed(1), (Math.max(...R.map(r => r.ms)) / 1000).toFixed(1),
      scored.length ? (100 * avg(scored.map(r => r.s))).toFixed(1) : '-', scored.length ? (100 * avg(scored.map(r => r.top1))).toFixed(1) : '-',
      R.reduce((x, r) => x + r.listMiss, 0), R.filter(r => r.over2).length, pairs.length ? (100 * flips / pairs.length).toFixed(1) : '-',
      tok('inTok'), tok('outTok'), tok('rTok')].join(' | '));
  }
  // 유형별 정확도
  console.log('\n유형별 정확도% (조합별)');
  const cats = [...new Set(rows.map(r => r.cat))].sort();
  for (const key of arms) {
    const R = rows.filter(r => r.arm === key && r.s !== ''); if (!R.length) continue;
    console.log(key + ' | ' + cats.map(c => { const v = R.filter(r => r.cat === c); return c + ' ' + (v.length ? (100 * avg(v.map(r => r.s))).toFixed(0) : '-'); }).join(' | '));
  }
  console.log('\n저장: ' + outPath);
})();
