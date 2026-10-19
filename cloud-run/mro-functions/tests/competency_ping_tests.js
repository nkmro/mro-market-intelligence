// node tests/competency_ping_tests.js — lib/competency.js 순수 함수 시험 (시트 접근 없음)
const c = require('../lib/competency');
let pass = 0, fail = 0;
function t(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL: ' + name); } }

// seoulYear: 2026-12-31 15:00 UTC = 2027-01-01 00:00 서울
t('seoulYear 경계', c.seoulYear(Date.UTC(2026, 11, 31, 15, 0, 0)) === 2027);
t('seoulYear 직전', c.seoulYear(Date.UTC(2026, 11, 31, 14, 59, 59)) === 2026);

const S = [['무활동로그아웃분', '60', ''], ['인사평가파일_2026', ' 1z7f3w ', 'ID'], ['가격키워드', 'x', '']];
t('findFileId 있음(공백 제거)', c.findFileId(S, 2026) === '1z7f3w');
t('findFileId 없음', c.findFileId(S, 2027) === null);
t('findFileId 빈 값', c.findFileId([['인사평가파일_2026', '', '']], 2026) === null);

t('quoteTab', c.quoteTab("역량-자기개발") === "'역량-자기개발'");
t('quoteTab 따옴표', c.quoteTab("a'b") === "'a''b'");

const base = ['순번','이름','사무소','자기개발 항목','자기개발 사유','수행 기간','완료 여부','자기 성취 평가 요약','팀장 의견'];
const good = base.concat(c.EXTRA_HEADERS);
let r = c.checkHeaderRow(good);
t('머리글 정상', r.ok && r.headerCount === 15 && r.extraStartIndex === 9 && r.missing.length === 0);
r = c.checkHeaderRow(base);
t('6칸 없음', !r.ok && r.missing.length === 6);
r = c.checkHeaderRow(base.concat(['기록ID','작성자이메일','기록일시','수정일시','첨부','팀장한줄의견']));
t('순서 틀림', !r.ok && r.missing.length === 0);
r = c.checkHeaderRow(base.concat(c.EXTRA_HEADERS, ['메모']));
t('6칸 뒤에 다른 칸', !r.ok);
r = c.checkHeaderRow(base.concat([' 기록ID ','작성자이메일','기록일시','수정일시','팀장한줄의견','첨부']));
t('앞뒤 공백은 허용', r.ok);
t('탭 5개', c.RECORD_TABS.length === 5);

console.log('pass ' + pass + ' / fail ' + fail);
process.exit(fail ? 1 : 0);
