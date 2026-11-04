// 2026-11-04 OpenAI 공급자 추가 시험(OPENAI_PROVIDER_DESIGN_v1.md). 실제 AI 호출 없음 — 가짜 fetch / 가짜 UrlFetchApp.
//   C그룹: Cloud Run lib/materialSuggest.js callOpenAI·makeAiCaller
//   G그룹: apps-script/Code.gs callAI_·buildAIRequest_·parseAIResponse_·callOpenAI_ (함수를 그대로 잘라 가짜 환경에서 실행)
// 실행: (cloud-run/mro-functions 폴더에서) node tests/openai_provider_tests.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const ms = require(path.join(__dirname, '..', 'lib', 'materialSuggest.js'));
const repo = path.resolve(__dirname, '..', '..', '..');
const code = fs.readFileSync(path.join(repo, 'apps-script', 'Code.gs'), 'utf8');
let passes = 0, failures = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || extra === undefined ? '' : '  -> ' + JSON.stringify(extra).slice(0, 400)));
  if (cond) passes++; else failures++;
}
const OK_BODY = { choices: [{ message: { content: '{"materials":[{"isNew":false,"korean":"고무","keyword":"고무"}]}' } }],
  usage: { prompt_tokens: 1200, completion_tokens: 80, completion_tokens_details: { reasoning_tokens: 30 } } };
function fakeFetch(behavior) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (behavior.throw) throw Object.assign(new Error('x'), { name: behavior.throw });
    if (behavior.hang) return new Promise((res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    return { status: behavior.status || 200, json: async () => behavior.body || OK_BODY };
  };
  return { fn, calls };
}

(async () => {
  // ───── C: Cloud Run ─────
  {
    const f = fakeFetch({});
    const r = await ms.callOpenAI(f.fn, 'sk-KEY', 'gpt-6-luna', 'low', 'P', 5000);
    const c = f.calls[0];
    check('C1 주소 = https://api.openai.com/v1/chat/completions, POST', c.url === 'https://api.openai.com/v1/chat/completions' && c.init.method === 'POST');
    check('C2 인증 헤더 Bearer, 본문 {model, messages, reasoning_effort}', c.init.headers.Authorization === 'Bearer sk-KEY' && c.body.model === 'gpt-6-luna' && c.body.reasoning_effort === 'low' && c.body.messages[0].role === 'user' && c.body.messages[0].content === 'P', c.body);
    check('C3 응답 글 = choices[0].message.content, error null', r.text === OK_BODY.choices[0].message.content && r.error === null && r.httpStatus === 200);
    check('C4 usage: 모델·강도·입력/출력/추론 토큰', r.usage.model === 'gpt-6-luna' && r.usage.effort === 'low' && r.usage.inTok === 1200 && r.usage.outTok === 80 && r.usage.reasoningTok === 30, r.usage);
    check('C5 결과에 키가 들어가지 않음', !JSON.stringify(r).includes('sk-KEY'));
  }
  {
    const r = await ms.callOpenAI(fakeFetch({ status: 429 }).fn, 'k', 'm', 'low', 'P', 5000);
    check('C6 HTTP 429 → text null, error HTTP_429', r.text === null && r.error === 'HTTP_429' && r.httpStatus === 429);
  }
  {
    const r = await ms.callOpenAI(fakeFetch({ hang: true }).fn, 'k', 'm', 'low', 'P', 50);
    check('C7 대기 상한 초과 → TIMEOUT', r.text === null && r.error === 'TIMEOUT', r);
  }
  {
    const r = await ms.callOpenAI(fakeFetch({ throw: 'TypeError' }).fn, 'k', 'm', 'low', 'P', 5000);
    check('C8 연결 오류 → NETWORK', r.error === 'NETWORK');
  }
  {
    const r = await ms.callOpenAI(fakeFetch({ body: { choices: [{ message: { content: '' } }] } }).fn, 'k', 'm', 'low', 'P', 5000);
    check('C9 빈 응답 → EMPTY, usage 0', r.text === null && r.error === 'EMPTY' && r.usage.inTok === 0);
  }
  {
    const f = fakeFetch({});
    const r = await ms.callOpenAI(f.fn, '', 'm', 'low', 'P', 5000);
    check('C10 키 없음 → NO_API_KEY, 호출 안 함', r.error === 'NO_API_KEY' && f.calls.length === 0);
  }
  {
    const f = fakeFetch({});
    await ms.makeAiCaller('openai', f.fn, { OPENAI_API_KEY: 'k' })('P', 5000);
    check('C11 설정 없으면 기본값 gpt-6-luna / low (소문자 provider도 인식)', f.calls[0].body.model === 'gpt-6-luna' && f.calls[0].body.reasoning_effort === 'low' && ms.OPENAI_DEFAULT_MODEL === 'gpt-6-luna');
  }
  {
    const f = fakeFetch({});
    await ms.makeAiCaller('OPENAI', f.fn, { OPENAI_API_KEY: 'k', OPENAI_MODEL: ' gpt-5.4-mini ', OPENAI_REASONING_EFFORT: 'NONE' })('P', 5000);
    check('C12 OPENAI_MODEL·OPENAI_REASONING_EFFORT 설정이 우선(공백 제거·소문자)', f.calls[0].body.model === 'gpt-5.4-mini' && f.calls[0].body.reasoning_effort === 'none', f.calls[0].body);
  }
  {
    const r = await ms.makeAiCaller('CLAUDE', fakeFetch({}).fn, {})('P', 5000);
    check('C13 모르는 공급자는 기존처럼 PROVIDER_NOT_SUPPORTED', r.error === 'PROVIDER_NOT_SUPPORTED:CLAUDE');
  }
  {
    const f = fakeFetch({});
    await ms.makeAiCaller('DEEPSEEK', f.fn, { DEEPSEEK_API_KEY: 'd' })('P', 5000);
    check('C14 DEEPSEEK 경로는 그대로(주소·모델 변화 없음)', f.calls[0].url === 'https://api.deepseek.com/chat/completions' && f.calls[0].body.model === 'deepseek-v4-flash' && f.calls[0].body.reasoning_effort === 'low');
  }

  // ───── G: Apps Script Code.gs ─────
  function extractFn(name) {
    const start = code.indexOf('\nfunction ' + name + '(');
    if (start < 0) throw new Error('Code.gs에서 못 찾음: ' + name);
    const rest = code.slice(start + 1);
    const m = rest.slice(1).search(/\n(function [\w$]+\s*\(|\/\*\*)/);
    return rest.slice(0, m + 1);
  }
  const consts = (code.match(/^const OPENAI_[A-Z_]+_ = '[^']*';$/gm) || []).join('\n');
  check('G0 Code.gs 상수 3개(OPENAI_URL_/DEFAULT_MODEL_/DEFAULT_EFFORT_)', (consts.match(/const /g) || []).length === 3, consts);
  const SRC = consts + '\n' + ['callAI_', 'buildAIRequest_', 'parseAIResponse_', 'openAIPayload_', 'callOpenAI_', 'callDeepSeek_', 'callGemini_'].map(extractFn).join('\n');
  function env(props, resp) {
    const st = { fetches: [], errors: [] };
    const res = (r) => ({ getResponseCode: () => r.code || 200, getContentText: () => JSON.stringify(r.body || OK_BODY) });
    const ctx = {
      JSON, String, console: { error: s => st.errors.push(String(s)), log: () => {} },
      PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null) }) },
      UrlFetchApp: { fetch: (url, o) => { st.fetches.push({ url, o, body: JSON.parse(o.payload) }); return res(resp || {}); } }
    };
    vm.runInNewContext(SRC + '\nthis.__t = { callAI_, buildAIRequest_, parseAIResponse_ };', ctx);
    return { st, t: ctx.__t, res };
  }
  {
    const e = env({ AI_PROVIDER: 'OPENAI', OPENAI_API_KEY: 'sk-A' });
    const text = e.t.callAI_('P');
    const f = e.st.fetches[0];
    check('G1 AI_PROVIDER=OPENAI → callOpenAI_ (주소·Bearer·기본 모델 gpt-6-luna·low)', f && f.url === 'https://api.openai.com/v1/chat/completions' && f.o.headers.Authorization === 'Bearer sk-A' && f.body.model === 'gpt-6-luna' && f.body.reasoning_effort === 'low' && f.o.muteHttpExceptions === true, f && f.body);
    check('G2 응답 글 반환', text === OK_BODY.choices[0].message.content);
  }
  {
    const e = env({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'k', OPENAI_MODEL: 'gpt-5.4-mini', OPENAI_REASONING_EFFORT: 'None' });
    e.t.callAI_('P');
    check('G3 소문자 openai도 인식 + 속성의 모델·강도 사용', e.st.fetches[0].body.model === 'gpt-5.4-mini' && e.st.fetches[0].body.reasoning_effort === 'none');
  }
  {
    const e = env({ AI_PROVIDER: 'OPENAI', OPENAI_API_KEY: 'k' }, { code: 500, body: { error: 'x' } });
    const text = e.t.callAI_('P');
    check('G4 HTTP 500 → null + 오류 로그', text === null && e.st.errors.some(x => x.startsWith('callOpenAI_ HTTP 500')));
  }
  {
    const e = env({ OPENAI_API_KEY: 'sk-B', OPENAI_MODEL: 'gpt-6-luna' });
    const req = e.t.buildAIRequest_('P', 'OPENAI', { getProperty: k => ({ OPENAI_API_KEY: 'sk-B', OPENAI_MODEL: 'gpt-6-luna' })[k] || null });
    const body = JSON.parse(req.payload);
    check('G5 일괄 호출 요청(buildAIRequest_) OPENAI 갈래 — 주소·헤더·본문', req.url === 'https://api.openai.com/v1/chat/completions' && req.headers.Authorization === 'Bearer sk-B' && body.model === 'gpt-6-luna' && body.reasoning_effort === 'low' && req.muteHttpExceptions === true, req);
    check('G6 일괄 응답 파싱(parseAIResponse_) OPENAI = choices 경로', e.t.parseAIResponse_(e.res({}), 'OPENAI') === OK_BODY.choices[0].message.content);
  }
  {
    const e = env({});
    const p = { getProperty: k => ({ DEEPSEEK_API_KEY: 'd', GEMINI_API_KEY: 'g' })[k] || null };
    const d = e.t.buildAIRequest_('P', 'DEEPSEEK', p), g = e.t.buildAIRequest_('P', 'GEMINI', p);
    check('G7 DEEPSEEK·GEMINI 요청은 그대로', d.url === 'https://api.deepseek.com/chat/completions' && /generativelanguage/.test(g.url));
  }
  {
    const e = env({ AI_PROVIDER: 'DEEPSEEK', DEEPSEEK_API_KEY: 'd' });
    e.t.callAI_('P');
    check('G8 AI_PROVIDER=DEEPSEEK 동작 그대로', e.st.fetches[0].url === 'https://api.deepseek.com/chat/completions');
  }
  {
    const tm = code.match(/const OPENAI_DEFAULT_MODEL_ = '([^']*)'/)[1], te = code.match(/const OPENAI_DEFAULT_EFFORT_ = '([^']*)'/)[1];
    check('G9 Code.gs 기본값 = Cloud Run 기본값(모델·강도)', tm === ms.OPENAI_DEFAULT_MODEL && te === ms.OPENAI_DEFAULT_EFFORT, { tm, te });
  }

  console.log('\n결과: PASS ' + passes + ' / FAIL ' + failures);
  process.exit(failures ? 1 : 0);
})();
