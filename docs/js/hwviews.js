// 課後練習：純畫面函式（不接觸 Firebase）
import { esc, LETTERS, imgTag } from './views.js';

// 以學生 uid 為種子的亂數，重新整理後順序不變
export function seeded(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function shuffled(arr, rnd) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// 依種子產生題目順序與每題選項順序（選項以原始字母記錄答案）
export function buildLayout(questions, seed) {
  const rnd = seeded(seed);
  const order = shuffled(questions.map((_, i) => i), rnd);
  const optOrder = {};
  questions.forEach((q, i) => { optOrder[i] = shuffled(LETTERS.filter((_, k) => q.options[k]), rnd); });
  return { order, optOrder };
}

function header(s) {
  const label = s.testMode ? '暱稱' : '座號';
  return `<header><h1>${esc(s.title || '課後練習')}</h1>${s.studentId ? `<span class="who">${label} ${esc(s.studentId)}</span>` : ''}</header>`;
}

// state: { view, title, studentId, testMode, questions, layout, answers, error, result:{score,total,items}, keyPoints, closed }
export function renderHomework(s) {
  const head = header(s);
  if (s.view === 'loading') return `${head}<div class="panel waiting"><p class="big"><span class="pulse"></span>載入中</p></div>`;
  if (s.view === 'closed') return `${head}<div class="panel waiting"><p class="big">這份練習已關閉</p><p class="note">請洽授課老師</p></div>`;
  if (s.view === 'login') {
    const label = s.testMode ? '暱稱' : '座號';
    return `${head}<form class="panel" id="login-form" novalidate>
      <p class="note" style="margin-top:0">共 ${s.total || 0} 題，作答進度會自動保存；交卷後只能提交一次，並立即看到分數與解析。這份練習不計分。</p>
      <div class="field"><label for="sid">${label}${s.testMode ? '' : '<span class="note">（1–3 位數字，也可輸入學號）</span>'}</label>
        <input id="sid" name="sid" autocomplete="off" ${s.testMode ? '' : 'autocapitalize="characters"'} maxlength="20" required value="${esc(s.prefillId || '')}"></div>
      <p class="error-msg" role="alert">${esc(s.error || '')}</p>
      <button class="btn go" type="submit" style="width:100%">開始作答</button></form>`;
  }

  const qs = s.questions || [];
  if (s.view === 'answer') {
    const done = qs.filter((_, i) => s.answers?.[i]).length;
    const items = s.layout.order.map((qi, pos) => {
      const q = qs[qi];
      const btns = s.layout.optOrder[qi].map((orig, k) => {
        const shown = LETTERS[k];
        return `<button class="choice" data-q="${qi}" data-choice="${orig}" aria-pressed="${s.answers?.[qi] === orig}">
          <span class="badge ${shown}">${shown}</span><span>${esc(q.options[LETTERS.indexOf(orig)])}</span></button>`;
      }).join('');
      return `<div class="panel bq" id="q${pos + 1}"><div class="qmeta">第 ${pos + 1} / ${qs.length} 題${q.category === '複習' ? '　複習題' : ''}</div>
        <div class="qhead"><p class="qtext">${esc(q.text)}</p>${imgTag(q.img, 'qimg sm')}</div>${btns}</div>`;
    }).join('');
    return `${head}${items}
      <div class="sticky-status hw-bar"><span>已作答 <b class="num">${done}</b> / ${qs.length}</span>
      <button class="btn go" id="btn-submit">交卷</button></div>`;
  }

  if (s.view === 'result') {
    const r = s.result;
    const rows = s.layout.order.map((qi, pos) => ({ qi, pos, it: r.items[qi], q: qs[qi] }));
    const wrong = rows.filter((x) => !x.it.ok);
    const showLetter = (qi, orig) => (orig ? LETTERS[s.layout.optOrder[qi].indexOf(orig)] || orig : '');
    const card = ({ qi, pos, it, q }) => {
      const opts = s.layout.optOrder[qi].map((orig, k) => {
        const cls = orig === it.answer ? ' correct' : (orig === it.mine ? ' wrong' : '');
        return `<div class="choice${cls}"><span class="badge ${LETTERS[k]}">${LETTERS[k]}</span><span>${esc(q.options[LETTERS.indexOf(orig)])}</span></div>`;
      }).join('');
      return `<div class="panel bq"><div class="qmeta">第 ${pos + 1} 題${q.category === '複習' ? '　複習題' : ''}</div>
        <div class="qhead"><p class="qtext">${esc(q.text)}</p>${imgTag(q.img, 'qimg sm')}</div>
        <p class="result-mark ${it.ok ? 'ok' : 'bad'}" style="font-size:1.1rem">${it.ok ? '答對' : (it.mine ? `答錯，你選 ${showLetter(qi, it.mine)}，正確答案 ${showLetter(qi, it.answer)}` : `未作答，正確答案 ${showLetter(qi, it.answer)}`)}</p>
        ${opts}
        ${!it.ok && it.mine && it.why?.[it.mine] ? `<div class="whybox"><b>你選 ${showLetter(qi, it.mine)}：錯在哪裡？</b><br>${esc(it.why[it.mine])}</div>` : ''}
        ${it.explanation ? `<div class="explain" style="margin-top:.6rem"><b>詳細解析</b><br>${esc(it.explanation)}</div>` : ''}
        ${it.keyPoint ? `<div class="keypoint"><b>重點</b>${esc(it.keyPoint)}</div>` : ''}</div>`;
    };
    return `${head}<div class="panel" style="margin-bottom:1rem">
        <p class="result-mark ${r.score / r.total >= 0.6 ? 'ok' : 'bad'}">${r.score} / ${r.total} 題答對（${Math.round((r.score / r.total) * 100)}%）</p>
        <p class="note" style="margin:0">先看答錯的 ${wrong.length} 題；答對的題目在下方。</p></div>
      ${(s.keyPoints || []).length ? `<div class="panel" style="margin-bottom:1rem"><h2 style="margin:0 0 .5rem;font-size:1.1rem">本週重點</h2><ol class="kplist">${s.keyPoints.map((k) => `<li>${esc(k)}</li>`).join('')}</ol></div>` : ''}
      ${wrong.map(card).join('')}
      ${rows.filter((x) => x.it.ok).length ? `<h2 style="font-size:1.1rem">答對的題目</h2>${rows.filter((x) => x.it.ok).map(card).join('')}` : ''}`;
  }
  return head;
}

// 計分：answersMap {qIndex: 原始字母}，key.items[qIndex] = {answer, explanation, keyPoint}
export function grade(questions, answersMap, key) {
  const items = questions.map((_, i) => {
    const k = key.items[i] || {};
    const mine = answersMap?.[i] || null;
    return { mine, answer: k.answer, ok: !!mine && mine === k.answer, explanation: k.explanation || '', keyPoint: k.keyPoint || '', why: k.why || {} };
  });
  return { items, score: items.filter((x) => x.ok).length, total: questions.length };
}
