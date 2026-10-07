// [DELIVERY] cloud-run/mro-functions/lib/issueMail.js 신규 파일 — GitHub 커밋본이 곧 gcloud 배포 소스(단일본). (2026-10-07 이슈 댓글 메일: 대상 선정 + 메일 본문 생성 — 3차: Outlook 도형(VML) 제거하고 서식만, 맑은 고딕 우선 / 4차: 버튼·카드 간격을 빈 줄로)
// cloud-run/mro-functions/lib/issueMail.js
//
// 이슈 댓글 메일(설계서 ISSUE_COMMENT_MAIL_DESIGN.md v4)의 "계산" 부분만 모은 모듈. 시트/Firestore/메일
// 서버에 직접 접근하지 않는 순수 함수만 둔다(입출력은 index.js의 issueMailBatchTest가 담당) — 그래서
// 가짜 데이터로 그대로 시험할 수 있다.
//
// 1) planIssueMail(): 오늘 고정된 이슈 댓글 → 받는 사람별 메일 내용 목록
//    - 팀장이 고정 → 그 팀의 담당·일반(활성)  / 임원이 고정 → 활성 사용자 전원(재홍님 확정 2026-10-07)
//    - 받는 사람은 "누가 고정했느냐"로만 정한다(앱 열람 권한은 다시 적용하지 않음, 확정)
// 2) buildSubject/buildHtml/buildText(): 메일 제목·본문(앱 화면 디자인 차용, 시안 v3 + 2026-10-07 Outlook 대응·댓글 바로가기)

const { sheetSerialToMs } = require('./feedEngine');

const APP_URL = 'https://nkmro.github.io/mro-market-intelligence/feed.html';
const C = { accent:'#3a2f6e', headerEnd:'#7c5aa8', blue:'#2f5fd0', blueSoft:'#e8eefc', blueBorder:'#c9d9f7',
  purple:'#7c4fd0', bg:'#f6f5f2', border:'#e2e0da', text:'#1f2320', muted:'#6b6f6a', danger:'#b3413a', dangerSoft:'#f6e2de' };
const ROLE_COLOR = { '담당':C.accent, '팀장':C.blue, '임원':C.purple };
const DOW = ['일','월','화','수','목','금','토'];
// Outlook이 글꼴 목록 앞부분(-apple-system 등)을 해석하지 못하면 다른 글꼴로 바뀌어 글자가 깨져 보여 맑은 고딕을 맨 앞에 둔다(2026-10-07)
const FONT = "'Malgun Gothic','맑은 고딕',Apple SD Gothic Neo,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif";
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
// 기사 링크는 http/https만 허용(그 외 형식은 링크를 넣지 않음)
function safeUrl(u){u=String(u||'').trim();return /^https?:\/\//i.test(u)?u:'';}
function kst(ms){const d=new Date(ms+9*3600e3);return{m:d.getUTCMonth()+1,d:d.getUTCDate(),dow:DOW[d.getUTCDay()],hh:String(d.getUTCHours()).padStart(2,'0'),mi:String(d.getUTCMinutes()).padStart(2,'0'),day:d.toISOString().slice(0,10)};}
// 앱 fmtTime과 같은 표기: 같은 날이면 "오늘 HH:MM", 아니면 "M.D HH:MM"
function fmtTime(ms,nowMs){if(ms==null)return'';const a=kst(ms),n=kst(nowMs);return (a.day===n.day?'오늘 ':a.m+'.'+a.d+' ')+a.hh+':'+a.mi;}
function initials(name){return name?String(name).trim().slice(-2):'?';} // 앱 initials()와 동일
function buildSubject(nowMs,count){const p=kst(nowMs);return '[MRO 시황] '+p.m+'/'+p.d+'('+p.dow+') 오늘의 이슈 댓글 '+count+'건';}

// ── 메일 프로그램 호환 도우미 (2026-10-07 재홍님 Outlook 수신 화면 피드백 반영) ──
// Outlook 전용 도형(VML)으로 둥근 모양을 그리면 Outlook에서 글자가 잘려 보여(3차 확인) 도형은 쓰지 않고
// 서식(CSS)만 넣는다(재홍님 결정). Outlook에서는 모서리가 각지게 보일 수 있지만 글자는 온전히 보인다.
function pill(text, opt){
  // opt: { fg, bg, border, fontSize, padY, padX }
  const t=esc(text);
  return '<span style="display:inline-block;font-size:'+opt.fontSize+'px;font-weight:700;color:'+opt.fg+';background:'+opt.bg+';border:1px solid '+(opt.border||opt.bg)+';padding:'+opt.padY+'px '+opt.padX+'px;border-radius:20px;line-height:1.2;">'+t+'</span>';
}
// 버튼: 배경색을 표 칸(bgcolor)에 넣고 글자는 흰색을 링크 안쪽에 한 번 더 지정 — Outlook이 링크 글자색을
// 덮어써서 어두운 배경에 어두운 글자가 되던 문제(1차 피드백) 방지
function button(text, href){
  return '<table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr><td bgcolor="'+C.accent+'" style="background:'+C.accent+';border-radius:20px;padding:10px 22px;">'+
    '<a href="'+esc(href)+'" style="color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;font-family:'+FONT+';"><span style="color:#ffffff;">'+esc(text)+'</span></a></td></tr></table>';
}
function avatar(name, color){
  const t=esc(initials(name));
  return '<table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="26" height="26" align="center" valign="middle" bgcolor="'+color+'" style="width:26px;height:26px;border-radius:13px;background:'+color+';color:#ffffff;font-size:11px;font-weight:700;text-align:center;">'+t+'</td></tr></table>';
}
// 메일의 "앱에서 이 댓글 보기" → 앱이 이 주소를 받으면 해당 게시물로 이동해 댓글을 펼치고 강조한다
function commentLink(e){
  return APP_URL+'?post='+encodeURIComponent(e.postId||'')+'&item='+encodeURIComponent(e.itemId||'')+'&comment='+encodeURIComponent(e.commentId||'');
}

function card(e,o){
  const link=safeUrl(e.link);
  const item=e.itemName?'<div style="font-size:12px;color:'+C.muted+';margin:0 0 10px;">📊 품목 · '+esc(e.customer?e.customer+' / ':'')+esc(e.itemName)+'</div>':'';
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:0 0 14px;background:#ffffff;border:1px solid '+C.border+';border-radius:10px;"><tr><td style="padding:16px 18px;">'+
   // post-head: 봇 아이콘 + 원자재 배지(둥근 알약) + AI 시황봇 + 게시 시각
   '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;"><tr>'+
     '<td width="34" style="width:34px;vertical-align:middle;"><img src="'+o.botIconSrc+'" width="34" height="34" alt="" style="display:block;width:34px;height:34px;border-radius:50%;background:'+C.bg+';"></td>'+
     '<td width="8" style="width:8px;">&nbsp;</td>'+
     (e.materialName?'<td width="1%" style="vertical-align:middle;white-space:nowrap;">'+pill(e.materialName,{fg:C.blue,bg:C.blueSoft,border:C.blueBorder,fontSize:16,padY:3,padX:12})+'</td><td width="8" style="width:8px;">&nbsp;</td>':'')+
     '<td width="1%" style="vertical-align:middle;white-space:nowrap;font-size:11px;font-weight:500;color:'+C.muted+';">AI&nbsp;시황봇</td>'+
     '<td width="99%" align="right" style="vertical-align:middle;font-size:12px;color:'+C.muted+';white-space:nowrap;">'+esc(fmtTime(e.postCreatedMs,o.nowMs))+'</td>'+
   '</tr></table>'+
   // post-title(굵게 = 요약) / post-summary(회색 = 제목) — 앱과 같은 배치
   '<div style="font-size:16px;font-weight:700;color:'+C.text+';line-height:1.4;margin:2px 0 6px;">'+esc(e.postSummary||e.postTitle)+'</div>'+
   (e.postSummary&&e.postTitle?'<div style="font-size:14px;color:'+C.muted+';line-height:1.6;margin-bottom:8px;">'+esc(e.postTitle)+'</div>':'')+
   (link?'<div style="margin-bottom:12px;"><a href="'+esc(link)+'" style="font-size:13px;color:'+C.blue+';text-decoration:none;"><span style="color:'+C.blue+';">🔗 기사 원문 보기</span></a></div>':'')+
   item+
   // 이슈 댓글(앱 .comment-item.pinned-highlight 배경 + 아바타)
   '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:'+C.dangerSoft+';border-radius:8px;" bgcolor="'+C.dangerSoft+'"><tr><td style="padding:10px 12px 12px;">'+
     '<div style="font-size:12px;font-weight:700;color:'+C.danger+';margin-bottom:8px;">📌 이슈 댓글 · '+esc(e.pinnedByName)+'&nbsp;'+esc(e.pinnedByRole||'')+' 선정 '+esc(fmtTime(e.pinnedAtMs,o.nowMs))+'</div>'+
     '<table role="presentation" cellpadding="0" cellspacing="0"><tr>'+
       '<td width="26" style="width:26px;vertical-align:top;">'+avatar(e.authorName,ROLE_COLOR[e.authorRole]||C.accent)+'</td>'+
       '<td width="8" style="width:8px;">&nbsp;</td>'+
       '<td style="vertical-align:top;">'+
         '<div style="font-size:12px;margin-bottom:2px;"><b style="color:'+C.text+';">'+esc(e.authorName)+'</b>&nbsp;<span style="color:'+C.muted+';">'+esc(e.authorRole||'')+'</span></div>'+
         '<div style="font-size:13px;line-height:1.5;color:'+C.text+';white-space:pre-wrap;">'+esc(e.content)+'</div>'+
       '</td></tr></table>'+
   '</td></tr></table>'+
   // 이 댓글로 바로 가기 — Outlook은 표의 margin을 무시해 버튼이 댓글에 붙어 보였다 → 빈 줄(높이 14px)로 간격 확보(4차)
   '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td height="14" style="height:14px;line-height:14px;font-size:1px;">&nbsp;</td></tr><tr><td align="center">'+
     button('앱에서 이 댓글 보기 ›', commentLink(e))+
   '</td></tr></table>'+
  '</td></tr></table>';
}
function buildHtml(r,opts){
  const o=Object.assign({botIconSrc:'cid:botIcon',nowMs:Date.now()},opts||{});
  return '<!DOCTYPE html><html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]--></head>'+
  '<body style="margin:0;padding:0;background:#ffffff;">'+
  // Outlook은 max-width를 무시해 화면 전체로 늘어났다 → 가운데 600px 표로 폭 고정
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">'+
  '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;font-family:'+FONT+';background:'+C.bg+';" bgcolor="'+C.bg+'"><tr><td>'+
  // 앱 brand-header와 같은 보라 그라데이션(그라데이션 미지원 메일 프로그램은 bgcolor 단색으로 표시)
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td bgcolor="'+C.accent+'" style="background:'+C.accent+';background-image:linear-gradient(90deg,'+C.accent+','+C.headerEnd+');padding:14px 22px;border-radius:10px 10px 0 0;">'+
    '<span style="color:#ffffff;font-weight:800;font-size:16px;letter-spacing:.2px;">MRO 자재 시황 관리 시스템</span>&nbsp;&nbsp;<span style="color:#cfc8e6;font-size:12px;letter-spacing:.3px;">MARKET INTELLIGENCE</span></td></tr></table>'+
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid '+C.border+';border-top:none;"><tr><td style="padding:18px 16px 20px;">'+
  (r.testMode?'<div style="font-size:12px;color:'+C.danger+';background:'+C.dangerSoft+';padding:8px 10px;margin:0 0 12px;">[시험 발송] 설정 \'이슈댓글메일테스트수신자\'로 이 주소에만 보냈습니다. 정식 운영이었다면 '+r.realRecipientCount+'명에게 각자 해당되는 내용이 발송됩니다.</div>':'')+
  '<div style="font-size:14px;color:'+C.text+';margin:0 0 4px;line-height:1.6;">'+esc(r.name)+'님, 안녕하세요.</div>'+
  '<div style="font-size:13px;color:'+C.muted+';line-height:1.6;margin:0 0 16px;">오늘 선정된 <b style="color:'+C.danger+';">📌 이슈 댓글</b> '+r.entries.length+'건을 공유드립니다. 각 댓글의 <b>앱에서 이 댓글 보기</b>를 누르면 해당 시황게시물로 바로 이동합니다.</div>'+
  // 카드 사이 간격도 Outlook에서 margin이 무시되므로 빈 줄로 띄운다(4차)
  r.entries.map(function(e){return card(e,o);}).join('<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td height="14" style="height:14px;line-height:14px;font-size:1px;">&nbsp;</td></tr></table>')+
  '<div style="border-top:1px solid '+C.border+';margin:18px 0 0;padding-top:12px;font-size:11px;color:#9a9891;line-height:1.6;">이 메일은 MRO 자재 시황 관리 시스템에서 매일 '+r.sendHour+'시에 자동 발송했어요.<br>이 메일에 회신하면 관리자(jhjoo@nkmro.com)에게 전달돼요. 업무 의견은 앱 댓글로 남겨주세요.</div>'+
  '</td></tr></table>'+
  '</td></tr></table>'+
  '</td></tr></table></body></html>';
}
function buildText(r){
  return r.name+'님, 오늘 선정된 이슈 댓글 '+r.entries.length+'건입니다.\n\n'+r.entries.map(function(e,i){
    const link=safeUrl(e.link);
    return (i+1)+'. ['+(e.materialName||'')+'] '+(e.postSummary||e.postTitle)+'\n'+
      (e.itemName?'   품목: '+(e.customer?e.customer+' / ':'')+e.itemName+'\n':'')+
      '   '+e.authorName+' '+(e.authorRole||'')+': '+String(e.content).replace(/\n/g,'\n   ')+
      (link?'\n   기사 원문: '+link:'')+'\n   (📌 '+e.pinnedByName+' '+(e.pinnedByRole||'')+' 선정)'+
      '\n   앱에서 이 댓글 보기: '+commentLink(e);
  }).join('\n\n')+'\n\n(자동 발송 메일입니다. 회신은 관리자에게 전달되며, 업무 의견은 앱 댓글로 남겨주세요.)';
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 서울 기준 "오늘 00:00"의 실제 UTC ms
function kstDayStartMs(nowMs) {
  const d = new Date(nowMs + KST_OFFSET_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - KST_OFFSET_MS;
}
function kstDateStr(nowMs) { return new Date(nowMs + KST_OFFSET_MS).toISOString().slice(0, 10); }
function lower(s) { return String(s || '').trim().toLowerCase(); }

// 발송 시각 설정 해석: 0~23 정수가 아니면 기본 17시(재홍님 변경 2026-10-07: 18→17)
function parseSendHour(v) {
  const s = String(v == null ? '' : v).trim();
  if (!/^\d{1,2}$/.test(s)) return 17;
  const n = Number(s);
  return n >= 0 && n <= 23 ? n : 17;
}

// pins: [{ commentId, postId, itemId, contentSnapshot, pinnedByEmail, pinnedByName, pinnedAtMs }]
// 반환: { todayPinCount, recipients: [{ email, name, entries:[...] }], excluded: [{ commentId, reason }] }
function planIssueMail(input) {
  const nowMs = input.nowMs;
  const dayStart = kstDayStartMs(nowMs);
  const allUsers = input.allUsers || [];
  const active = allUsers.filter(function (u) { return u && u.status === '활성' && lower(u.email); });
  const userByEmail = {};
  allUsers.forEach(function (u) { if (u && lower(u.email)) userByEmail[lower(u.email)] = u; });
  const postById = {};
  (input.allPosts || []).forEach(function (p) { postById[String(p.id)] = p; });
  const itemById = {};
  (input.allItems || []).forEach(function (it) { itemById[String(it.itemId).trim()] = it; });
  const commentById = {};
  (input.allComments || []).forEach(function (c) { commentById[String(c.commentId)] = c; });

  const excluded = [];
  const byRecipient = {};
  const todayPins = (input.pins || [])
    .filter(function (p) { return typeof p.pinnedAtMs === 'number' && p.pinnedAtMs >= dayStart && p.pinnedAtMs <= nowMs; })
    .sort(function (a, b) { return a.pinnedAtMs - b.pinnedAtMs; });

  todayPins.forEach(function (pin) {
    const original = commentById[String(pin.commentId)];
    if (!original) { excluded.push({ commentId: pin.commentId, reason: 'COMMENT_DELETED' }); return; }
    const pinner = userByEmail[lower(pin.pinnedByEmail)];
    if (!pinner || pinner.status !== '활성') { excluded.push({ commentId: pin.commentId, reason: 'PINNER_NOT_ACTIVE' }); return; }
    let targets;
    if (pinner.role === '팀장') {
      const team = String(pinner.team || '').trim();
      targets = active.filter(function (u) { return String(u.team || '').trim() === team && (u.role === '담당' || u.role === '일반'); });
    } else if (pinner.role === '임원') {
      targets = active;
    } else {
      excluded.push({ commentId: pin.commentId, reason: 'PINNER_ROLE_' + (pinner.role || 'NONE') }); return;
    }
    const post = postById[String(pin.postId)] || {};
    const item = pin.itemId ? itemById[String(pin.itemId).trim()] : null;
    const entry = {
      commentId: pin.commentId,
      postId: pin.postId,
      itemId: pin.itemId || '',
      materialName: post.materialName || '',
      postCreatedMs: sheetSerialToMs(post.createdAtRaw),
      postSummary: post.summary || '',
      postTitle: post.title || '',
      link: post.link || '',
      customer: item ? (item.customer || '') : '',
      itemName: item ? (item.itemName || '') : '',
      authorName: original.authorName || '',
      authorRole: original.authorRole || '',
      content: pin.contentSnapshot != null ? pin.contentSnapshot : (original.content || ''),
      pinnedByName: pin.pinnedByName || pinner.name || '',
      pinnedByRole: pinner.role,
      pinnedAtMs: pin.pinnedAtMs
    };
    if (targets.length === 0) { excluded.push({ commentId: pin.commentId, reason: 'NO_RECIPIENTS' }); return; }
    targets.forEach(function (u) {
      const key = lower(u.email);
      if (!byRecipient[key]) byRecipient[key] = { email: key, name: u.name || '', entries: [] };
      byRecipient[key].entries.push(entry);
    });
  });

  // 시험 모드: 테스트수신자 한 곳에만, 오늘 대상이 된 이슈 댓글 전부를 담아 1통
  const testRecipient = lower(input.testRecipient);
  let recipients = Object.keys(byRecipient).sort().map(function (k) { return byRecipient[k]; });
  if (testRecipient) {
    const seen = {}; const all = [];
    recipients.forEach(function (r) { r.entries.forEach(function (e) { if (!seen[e.commentId]) { seen[e.commentId] = 1; all.push(e); } }); });
    all.sort(function (a, b) { return a.pinnedAtMs - b.pinnedAtMs; });
    const tu = userByEmail[testRecipient];
    recipients = all.length ? [{ email: testRecipient, name: (tu && tu.name) || '관리자', entries: all, testMode: true, realRecipientCount: Object.keys(byRecipient).length }] : [];
  }
  return { todayPinCount: todayPins.length, recipients: recipients, excluded: excluded };
}

module.exports = { planIssueMail, parseSendHour, kstDateStr, kstDayStartMs, buildSubject, buildHtml, buildText, safeUrl };
