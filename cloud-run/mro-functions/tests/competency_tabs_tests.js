// node tests/competency_tabs_tests.js — 1단계-라-마(설계서 v1.11 4-2-1·㉒) 기록 탭 자동 인식 시험 (시트 접근 없음)
const c = require('../lib/competency');
let pass = 0, fail = 0;
function t(name, cond) { if (cond) pass++; else { fail++; console.log('FAIL: ' + name); } }

const EX = c.EXTRA_HEADERS;
// 기준 탭 원문(2026-10-20 criteria 응답 rows 그대로 — 역량 이름·배점만, 개인정보 없음)
const CRIT = [["", "■ 역량평가 기준 (40%)"], ["", "항 목", "가중치", "평가 항목 / 배점 비율", "", "평가 기준", "", "평가 결과 (A,B,C)"], ["", "▶ CRM 역량평가"], ["", "- 직무별 전문성", "7%", "직무 전문성", "50%", "A", "100"], ["", "", "", "자기 개발", "30%", "B", "85"], ["", "", "", "자료관리 및 작성, 추출", "20%", "C", "75"], ["", "- 직급별 업무 역량", "6%", "직급 요구역량 충족", "60%", "A", "100"], ["", "", "", "동일 직급 대비 비교", "20%", "B", "85"], ["", "", "", "직급 역량 개선 노력", "20%", "C", "75"], ["", "- 영업 수행 역량", "6%", "대면 영업(고객 지향성)", "50%", "A", "100"], ["", "", "", "협상 능력", "30%", "B", "90"], ["", "", "", "커뮤니케이션", "20%", "C", "75"], ["", "- 개선 기획 역량", "6%", "추가 매출계획 이행", "70%", "A", "100"], ["", "", "", "역마진 관리", "20%", "B", "80"], ["", "", "", "원가 개선 제안", "10%", "C", "60"], ["", "- 문제해결 및 위기관리 능력", "4%", "문제해결 능력", "50%", "A", "100"], ["", "", "", "위기관리 대처", "30%", "B", "90"], ["", "", "", "원가 방어 판단", "20%", "C", "70"], ["", "- 팀워크 기여도", "6%", "팀워크 기여", "60%", "A", "100"], ["", "", "", "긍정적 사고", "20%", "B", "80"], ["", "", "", "팀원 퇴사 대처", "20%", "C", "60"], ["", "- 근태 및 업무태도 준수", "5%", "업무 태도", "40%", "A", "100"], ["", "", "", "근태 관리(지각 외)", "40%", "B", "80"], ["", "", "", "부서간 협조", "20%", "C", "60"], ["", "계", "40%"]];
// 지금 5개 탭 머리글(설계서 4-2 [확인] + 2026-10-20 응답 칸 순서)
const H = {
  selfDev: ['순번','이름','사무소','자기개발 항목','자기개발 사유','수행 기간 (YYMMDD~YYMMDD)','완료 여부 (Y/N)','자기 성취 평가 요약','팀장 의견'].concat(EX),
  gradeComp: ['순번','이름','사무소','개선 직급 역량 항목','직급 역량 개선 사유','수행 기간 (YYMMDD~YYMMDD)','완료 여부 (Y/N)','자기 성취 평가','팀장 의견'].concat(EX),
  faceSales: ['순번','이름','사무소','고객사','대면자','직급','미팅 일시(YYMMDD-HH)','미팅 시간(분)','기대 성과','팀장 의견 (상중하)'].concat(EX),
  costSave: ['순번','이름','사무소','고객사','공급사','원가 개선 항목','원가 개선 사유','수행 기간 (YYMMDD~YYMMDD)','완료 여부 (Y/N)','기대 성과','팀장 의견 (상중하)'].concat(EX),
  addSales: ['사무소','담당','구분','고객사','품목','개선/확대 규모','예상이익','이익률','추진계획','달성 여부 (Y/N)','실적 반영 시점(YYMM~)','당해년도 실적결산 (매출/이익)','팀장 의견'].concat(EX)
};
// 지금 인사평가 파일 탭(4-2 표의 gid [확인]) + 기준·설정·숨김 탭
const P = function (sheetId, title, index, hidden) { return { properties: hidden ? { sheetId: sheetId, title: title, index: index, hidden: true } : { sheetId: sheetId, title: title, index: index } }; };
const NOW = [P(0, '역량-직무별전문성-자기개발', 0), P(1406147068, '역량-직급별업무역량-직급역량개선노력', 1), P(1204504857, '역량-영업수행역량-대면영업', 2),
  P(1981522387, '역량-개선기획역량-원가개선제안', 3), P(772700407, '역량-개선기획역량-추가매출계획이행', 4), P(11, 'CRM-역량평가-기준', 5), P(12, '인사평가설정', 6), P(13, '직급별_요구역량', 7, true)];
const RENAMED = NOW.map(function (s) {
  const m = { '역량-직급별업무역량-직급역량개선노력': '역량-직급별업무역량-직급역량', '역량-개선기획역량-원가개선제안': '역량-개선기획역량-원가개선', '역량-개선기획역량-추가매출계획이행': '역량-개선기획역량-추가매출' };
  return P(s.properties.sheetId, m[s.properties.title] || s.properties.title, s.properties.index, s.properties.hidden);
});

// ---- 회귀: 지금 5개 탭(이름 줄이기 전)
let rt = c.recordTabsFromSheets(NOW);
t('회귀: 기록 탭 5개, 기존 키 그대로', rt.map(function (x) { return x.id; }).join(',') === 'selfDev,gradeComp,faceSales,costSave,addSales');
t('회귀: 원래 탭 이름(A1 범위용) 그대로', rt[1].title === '역량-직급별업무역량-직급역량개선노력');
const SETTINGS0 = [['키', '값', '설명'], ['전년도입력마감일', '15', ''], ['연도전환시작일', '1', '']];
let D = c.describeTabs(rt, H, SETTINGS0, CRIT);
t('회귀: 기준표 연결 5개 모두 딱 1개', D.every(function (x) { return x.criteriaItem; }) && D.map(function (x) { return x.criteriaItem; }).join('|') === '자기 개발|직급 역량 개선 노력|대면 영업(고객 지향성)|원가 개선 제안|추가 매출계획 이행');
t('회귀: 평가 항목 표시 = 기준표 이름', D[2].item === '영업 수행 역량 › 대면 영업(고객 지향성)' && D[0].item === '직무별 전문성 › 자기 개발');
t('회귀: 회신 대기 칸은 추가매출 탭만', D.map(function (x) { return x.hasReply; }).join(',') === 'false,false,false,false,true');
t('회귀: 카드 제목 칸 = 4-2 표', D.map(function (x) { return x.titleField; }).join('|') === '자기개발 항목|개선 직급 역량 항목|고객사|원가 개선 항목|고객사');
t('회귀: 이모지 줄 넣기 전 = 모두 📝', D.every(function (x) { return x.emoji === '📝'; }));
t('회귀: 머리글 점검(headerCount·extraStartIndex) 탭마다 정상', Object.keys(H).every(function (k) { const r = c.checkHeaderRow(H[k]); return r.ok && r.headerCount === H[k].length && r.extraStartIndex === H[k].length - 6; }));
t('회귀: 이름 칸 — 추가매출은 담당, 나머지는 이름', c.parseTab('addSales', [H.addSales, ['양산', '박태영']])[0].name === '박태영' && c.parseTab('faceSales', [H.faceSales, ['1', '손희진']])[0].name === '손희진');

// ---- 이름 줄이기 + 이모지 줄 넣은 뒤
rt = c.recordTabsFromSheets(RENAMED);
const SETTINGS1 = SETTINGS0.concat([['탭이모지_자기개발', '📚', '앱 탭 이모지'], ['탭이모지_직급역량', '🎯', ''], ['탭이모지_대면영업', '🤝', ''], ['탭이모지_원가개선', '💡', ''], ['탭이모지_추가매출', '🚀', '']]);
D = c.describeTabs(rt, H, SETTINGS1, CRIT);
t('줄인 뒤: 키는 gid로 그대로', rt.map(function (x) { return x.id; }).join(',') === 'selfDev,gradeComp,faceSales,costSave,addSales');
t('줄인 뒤: 화면 이름 4자', D.map(function (x) { return x.label; }).join(',') === '자기개발,직급역량,대면영업,원가개선,추가매출');
t('줄인 뒤: 기준표 연결 그대로 1개씩', D.map(function (x) { return x.criteriaItem; }).join('|') === '자기 개발|직급 역량 개선 노력|대면 영업(고객 지향성)|원가 개선 제안|추가 매출계획 이행');
t('줄인 뒤: 이모지 설정대로', D.map(function (x) { return x.emoji; }).join('') === '📚🎯🤝💡🚀');

// ---- 새 탭·숨김·순서
const PLUS = RENAMED.concat([P(555, '역량-팀워크기여도-팀워크', 2), P(556, '역량-영업수행역량-품질관리', 9), P(557, '역량-직무별전문성-자', 10), P(558, '역량-문제해결및위기관리능력-위기관리', 11, true)]);
// 탭 순서: 시트 index 순(같은 index는 시트 정보 순서) — 팀워크(2)는 자기개발·직급역량 뒤, 대면영업(2) 앞뒤는 정렬 안정성에 맡김
rt = c.recordTabsFromSheets(PLUS.map(function (s) { const p = Object.assign({}, s.properties); if (p.sheetId === 555) p.index = 1.5; return { properties: p }; }));
t('새 탭 인식 + 키 g<gid>', rt.some(function (x) { return x.id === 'g555' && x.label === '팀워크'; }));
t('숨긴 탭 제외', rt.every(function (x) { return x.id !== 'g558'; }));
t('순서 = 시트 탭 순서(index)', rt.map(function (x) { return x.label; }).join(',') === '자기개발,직급역량,팀워크,대면영업,원가개선,추가매출,품질관리,자');
t('기준·설정·숨김 탭은 기록 탭 아님', rt.length === 8);
D = c.describeTabs(rt, { g555: ['순번', '이름', '사무소', '기여 내용', '팀장 의견'].concat(EX) }, SETTINGS1, CRIT);
const by = function (id) { return D.filter(function (x) { return x.id === id; })[0]; };
t('prefix 1개: 팀워크 → 팀워크 기여', by('g555').criteriaItem === '팀워크 기여' && by('g555').item === '팀워크 기여도 › 팀워크 기여');
t('prefix 0개: 품질관리 → 연결 없음, 평가 항목은 탭 이름으로', by('g556').criteriaItem === null && by('g556').item === '영업수행역량 › 품질관리');
t('prefix 2개: 자 → 연결 없음', by('g557').criteriaItem === null && c.linkCriteria({ group: '직무별전문성', label: '자' }, c.criteriaGroups(CRIT)).count === 2);
t('역량 이름이 기준표에 없으면 0', c.linkCriteria({ group: '품질관리역량', label: '품질관리' }, c.criteriaGroups(CRIT)).count === 0);
t('같은 역량 안에서만: 원가 → 원가 개선 제안(문제해결 묶음의 원가 방어 판단은 섞이지 않음)', c.linkCriteria({ group: '개선기획역량', label: '원가' }, c.criteriaGroups(CRIT)).criteriaItem === '원가 개선 제안');
t('새 탭 이모지 없으면 📝', by('g555').emoji === '📝');
t('새 탭 카드 제목 칸 = 사람·관리 칸 다음 첫 칸', by('g555').titleField === '기여 내용');
t('머리글 없는 새 탭도 안전', by('g556').titleField === '' && by('g556').hasReply === false);
t('기준 탭 읽기 규칙: 역량 7개·세부 21개', c.criteriaGroups(CRIT).length === 7 && c.criteriaGroups(CRIT).reduce(function (a, g) { return a + g.items.length; }, 0) === 21);
t('이모지 설정: 빈 값·키만 있는 줄 무시', JSON.stringify(c.tabEmojis([['탭이모지_', 'x'], ['탭이모지_a', ''], [' 탭이모지_b ', ' 🅱 '], null])) === JSON.stringify({ b: '🅱' }));
t('탭 이름 나누기', JSON.stringify(c.splitRecordTabTitle('역량-문제해결및위기관리능력-위기관리')) === JSON.stringify({ group: '문제해결및위기관리능력', label: '위기관리' }) && c.splitRecordTabTitle('CRM-역량평가-기준') === null);

// ---- 새 탭도 기존 집계 함수가 그대로 동작(키 g<gid>)
const U = [{ email: 'a@x.com', name: '박태영', role: '담당', team: '동부', status: '활성', office: '' }];
const R = { g555: c.parseTab('g555', [['순번', '이름', '기여 내용', '팀장 의견'], ['1', '박태영', '신규 입사자 교육', '']]) };
const m = c.buildMine(U[0], U, R);
t('새 탭 기록도 내 기록·팀 건수에 들어감', m.records.g555.length === 1 && m.teamCounts[0].byTab.g555 === 1 && m.records.g555[0].reviewState === 'pendingReview');

// ---- 메모리 저장 5분
let now = 1000;
const cache = c.makeTtlCache(c.TAB_META_TTL_MS, function () { return now; });
cache.set('F', ['x']);
now += c.TAB_META_TTL_MS; t('저장 5분 안 = 있음', cache.get('F') !== null);
now += 1; t('저장 5분 지나면 = 없음', cache.get('F') === null);
cache.set('F', ['y']); cache.del('F'); t('저장 지우기', cache.get('F') === null);

// ---- 읽기 순서 + 이름 변경 직후 재시도 (가짜 입출력)
function fakeDeps(state) {
  return {
    meta: async function (useCache) { state.metaCalls.push(useCache); if (state.metaThrows) throw new Error('meta fail'); if (useCache && state.cached) return { sheets: state.cached, cached: true }; return { sheets: state.sheets, cached: false }; },
    batchGet: async function (ranges) {
      state.batchCalls.push(ranges);
      const titles = state.sheets.map(function (s) { return "'" + s.properties.title.replace(/'/g, "''") + "'"; });
      if (state.batchThrows || ranges.some(function (r) { return titles.indexOf(r.slice(0, r.lastIndexOf('!'))) < 0; })) { const e = new Error('Unable to parse range'); e.response = { status: 400 }; throw e; }
      return ranges.map(function () { return { values: [['h']] }; });
    },
    invalidate: function () { state.invalidated++; state.cached = null; },
    log: function () {}
  };
}
(async function () {
  // 저장된 옛 이름으로 1번 실패 → 지우고 새로 읽어 성공
  let st = { sheets: RENAMED, cached: NOW, metaCalls: [], batchCalls: [], invalidated: 0 };
  let tm = {};
  let r = await c.loadCompetencyFile(fakeDeps(st), { view: 'mine', team: '동부', timings: tm });
  t('재시도: 옛 이름 실패 → 저장 지움 → 새 이름으로 성공', st.batchCalls.length === 2 && st.invalidated === 1 && st.metaCalls.join(',') === 'true,false' && tm.tabListRetried === true && r.recTabs[1].title === '역량-직급별업무역량-직급역량');
  t('재시도: 두 번째 범위에 새 이름', st.batchCalls[1].some(function (x) { return x === "'역량-개선기획역량-추가매출'!A1:Z"; }));
  // 새로 읽은 시트 정보로 실패하면 재시도 없이 던짐
  st = { sheets: RENAMED, cached: null, metaCalls: [], batchCalls: [], invalidated: 0, batchThrows: true };
  let threw = false; try { await c.loadCompetencyFile(fakeDeps(st), { view: 'mine', team: '동부', timings: {} }); } catch (e) { threw = true; }
  t('새 시트 정보로 실패 = 재시도 없이 오류(SHEET_ACCESS_FAILED로)', threw && st.batchCalls.length === 1 && st.invalidated === 0);
  // 저장으로 실패하고 새로 읽어도 실패 = 2번째에 오류
  st = { sheets: RENAMED, cached: NOW, metaCalls: [], batchCalls: [], invalidated: 0, batchThrows: true };
  threw = false; try { await c.loadCompetencyFile(fakeDeps(st), { view: 'mine', team: '동부', timings: {} }); } catch (e) { threw = true; }
  t('재시도도 실패 = 2번째에 오류, 3번째 없음', threw && st.batchCalls.length === 2);
  // 정상(저장 있음): 값 읽기 1번
  st = { sheets: NOW, cached: NOW, metaCalls: [], batchCalls: [], invalidated: 0 };
  tm = {}; r = await c.loadCompetencyFile(fakeDeps(st), { view: 'mine', team: '동부', timings: tm });
  t('정상: 시트 정보 저장 사용 + 값 읽기 1번', st.batchCalls.length === 1 && st.metaCalls.join(',') === 'true' && tm.tabListCached === true && !tm.tabListRetried);
  t('정상: 읽는 범위 = 설정·기준·기록 탭 5개(인코딩 전 날 문자열)', st.batchCalls[0].length === 7 && st.batchCalls[0][0] === "'인사평가설정'!A1:C" && st.batchCalls[0][1] === "'CRM-역량평가-기준'!A1:H60" && st.batchCalls[0][2] === "'역량-직무별전문성-자기개발'!A1:Z");
  t('정상: get으로 값 꺼냄', JSON.stringify(r.get('tab:addSales')) === '[["h"]]' && r.get('없음') === null);
  // 설정·기준 탭이 파일에 없으면 요청에서 뺌(없는 탭 때문에 전체 실패하지 않게)
  st = { sheets: NOW.filter(function (s) { return s.properties.title.indexOf('역량-') === 0; }), cached: null, metaCalls: [], batchCalls: [], invalidated: 0 };
  await c.loadCompetencyFile(fakeDeps(st), { view: 'team', team: '동부', timings: {} });
  t('설정·기준 탭이 없으면 그 범위는 요청 안 함', st.batchCalls[0].length === 5);
  // 기준 보기: 기준 탭만 읽음(예전과 같음), 시트 정보 실패해도 기본 기준 탭으로
  st = { sheets: NOW, cached: null, metaCalls: [], batchCalls: [], invalidated: 0, metaThrows: true };
  r = await c.loadCompetencyFile(fakeDeps(st), { view: 'criteria', team: '동부', timings: {} });
  t('기준 보기: 시트 정보 실패 → 기본 기준 탭, metaOk=false', r.metaOk === false && st.batchCalls[0].join() === "'CRM-역량평가-기준'!A1:H60");
  st = { sheets: NOW, cached: null, metaCalls: [], batchCalls: [], invalidated: 0, metaThrows: true };
  threw = false; try { await c.loadCompetencyFile(fakeDeps(st), { view: 'mine', team: '동부', timings: {} }); } catch (e) { threw = true; }
  t('내 기록: 시트 정보 실패 = 오류', threw);
  // 기준 보기 "기록 있음" 항목 = 연결된 기준표 이름(이름 줄이기 전·후 같음)
  const ri = function (sheets) { return c.describeTabs(c.recordTabsFromSheets(sheets), {}, [], c.criteriaRows(CRIT)).map(function (x) { return x.criteriaItem; }).filter(Boolean).join('|'); };
  t('기준 보기 recordItems: 줄이기 전·후 같음', ri(NOW) === ri(RENAMED) && ri(NOW) === '자기 개발|직급 역량 개선 노력|대면 영업(고객 지향성)|원가 개선 제안|추가 매출계획 이행');

  console.log('pass ' + pass + ' / fail ' + fail);
  process.exit(fail ? 1 : 0);
})();
