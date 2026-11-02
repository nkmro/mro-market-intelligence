// node tests/issue_mail_group_tests.js — 이슈 댓글 메일: 같은 시황 게시물 댓글을 카드 하나로(2026-11-02) 순수 함수 시험
const m = require(require('path').join(__dirname, '..', 'lib', 'issueMail.js'));
const fs = require('fs');
let pass=0, fail=0; const t=(n,ok,info)=>{ok?pass++:fail++; console.log((ok?'PASS ':'FAIL ')+n+(ok?'':'  → '+JSON.stringify(info).slice(0,400)));};
const NOW = Date.UTC(2026,10,2,8,0); // 11/2 17:00 KST
const P1 = { postId:'P101', materialName:'텅스텐', postCreatedMs: Date.UTC(2026,10,1,16,27), postSummary:'중국의 수출 규제 본격화 이후 국제 텅스텐 시장 가격이 2024년 초 대비 9배 폭등한 것으로 나타났다. 이는 텅스텐 가격 상승과 수급 긴축을 직접 보여주는 시황 수치다.', postTitle:'"中 텅스텐 무기화 돌파"… 스미토모전기, 텅스텐 80% 줄인 차세대 초경...', link:'https://example.com/news/1' };
const P2 = { postId:'P102', materialName:'구리', postCreatedMs: Date.UTC(2026,10,1,23,10), postSummary:'LME 구리 가격이 공급 차질 우려로 한 주 만에 4% 올랐다.', postTitle:'구리값 4% 급등… 칠레 광산 파업 장기화', link:'https://example.com/news/2' };
const E = (p, cid, item, cust, who, txt, hh, mm) => Object.assign({}, p, { commentId:cid, itemId:'I'+cid, customer:cust, itemName:item, authorName:who, authorRole:'담당', content:txt, pinnedByName:'주재홍', pinnedByRole:'팀장', pinnedAtMs: Date.UTC(2026,10,2,hh-9,mm) });
const entries = [
  E(P1,'C1','터닝 인서트 / RCMX 320900','(주)세아특수강','박창석','대구텍에서 기존 11월에도 인상을 하려고 하였는데 대리점 반발이 많아서 27년1월로 연기 되었다고 합니다.',11,55),
  E(P2,'C3','동 부스바 / 10*100','대한전기(주)','이도윤','거래처 재고가 2주치라 이번 달 안에 추가 발주 예정이라고 합니다.',11,58),
  E(P1,'C2','텅스텐봉 / 2.4*150(토륨)','대한시스텍 주식회사','박창석','업체 통화하면서 절삭공구 관련 이야기를 들었는데 쓰미토모 제품은 12월 인상 예정이고 와이지원 및 타브랜드들도 1월 인상 예정이라고 합니다.',11,56)
].sort((a,b)=>a.pinnedAtMs-b.pinnedAtMs);
const g = m.groupByPost(entries);
t('G1 댓글 3건 → 게시물 2묶음(텅스텐 2·구리 1), 먼저 선정된 게시물 순', g.length===2 && g[0].post.postId==='P101' && g[0].entries.map(e=>e.commentId).join()==='C1,C2' && g[1].entries[0].commentId==='C3', g.map(x=>[x.post.postId,x.entries.map(e=>e.commentId)]));
const r = { name:'주재홍', sendHour:17, entries };
const html = m.buildHtml(r, { nowMs: NOW, botIconSrc:'bot-icon.png' });
const cnt = (s, re) => (s.match(re)||[]).length;
t('H1 기사 요약(게시물 머리)은 게시물마다 1번 — 텅스텐 요약 1번', cnt(html, /9배 폭등한/g)===1, cnt(html,/9배 폭등한/g));
t('H2 "앱에서 이 댓글 보기" 버튼은 댓글마다 3개, 주소는 각 댓글로', cnt(html,/앱에서 이 댓글 보기/g)===4 /* 안내 문구 1 + 버튼 3 */ && ['C1','C2','C3'].every(c=>html.includes('comment='+c)), cnt(html,/앱에서 이 댓글 보기/g));
t('H3 품목 줄도 댓글마다(세아특수강·대한시스텍 둘 다 텅스텐 카드 안)', html.indexOf('세아특수강') < html.indexOf('대한시스텍') && html.indexOf('대한시스텍') < html.indexOf('구리값'), null);
t('H4 안내 문구 "이슈 댓글 3건(시황 2건)"', /이슈 댓글<\/b> 3건\(시황 2건\)/.test(html));
t('H5 카드(흰 바탕 테두리 표) 2개', cnt(html,/border-radius:10px;"><tr><td style="padding:16px 18px;">/g)===2, cnt(html,/border-radius:10px;"><tr><td style="padding:16px 18px;">/g));
// 서로 다른 게시물만 있으면 예전과 같은 내용(카드 수 = 댓글 수, 안내 문구에 "(시황" 없음)
const solo = entries.filter(e=>e.commentId!=='C2');
const h2 = m.buildHtml({ name:'주재홍', sendHour:17, entries: solo }, { nowMs: NOW, botIconSrc:'x' });
const txt = m.buildText(r);
t('T1 글자판(text)도 게시물별 묶음: 1. 텅스텐(댓글 2) 2. 구리', /^주재홍님, 오늘 선정된 이슈 댓글 3건입니다\. \(시황 2건\)/.test(txt) && /1\. \[텅스텐\][\s\S]*comment=C1[\s\S]*comment=C2[\s\S]*2\. \[구리\][\s\S]*comment=C3/.test(txt) && cnt(txt,/9배 폭등한/g)===1, txt.slice(0,300));
t('S1 제목은 그대로 댓글 수 기준 "이슈 댓글 3건"', /오늘의 이슈 댓글 3건$/.test(m.buildSubject(NOW, entries.length)));
console.log('pass '+pass+' / fail '+fail);
