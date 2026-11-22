// 純畫面函式：只依 state 產生 HTML，不接觸 Firebase，方便單獨測試。
export const LETTERS = ['A', 'B', 'C', 'D'];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);

// 插圖：只允許英數代號，對應 img/{代號}.png
export const imgTag = (code, cls = 'qimg') => (/^[A-Za-z0-9_-]{1,40}$/.test(code || '') ? `<img class="${cls}" src="img/${code}.png" alt="">` : '');

// 全班作答牆：tiles=[{label, choice}]；mode: question（只顯示已答）、closed（顯示選項）、reveal（對錯）
function wallHtml(tiles, mode, answer) {
  if (!tiles || !tiles.length) return '';
  const cells = tiles.map((t) => {
    let cls = 'tile', sub = '';
    if (t.choice && mode === 'question') cls += ' done';
    if (t.choice && mode === 'closed') { cls += ' done'; sub = t.choice; }
    if (mode === 'reveal') { if (!t.choice) sub = '未答'; else { cls += t.choice === answer ? ' ok' : ' bad'; sub = t.choice; } }
    return `<div class="${cls}">${esc(t.label)}<span>${sub || '&nbsp;'}</span></div>`;
  }).join('');
  const legend = mode === 'reveal'
    ? '<span><i class="lg ok"></i>答對</span><span><i class="lg bad"></i>答錯</span><span><i class="lg"></i>未答</span>'
    : '<span><i class="lg done"></i>已作答</span><span><i class="lg"></i>尚未作答</span>';
  return `<div class="wall${tiles.length > 40 ? ' dense' : ''}">${cells}</div><div class="wall-legend">${legend}</div>`;
}

function barsHtml(counts, answer, total) {
  const max = Math.max(1, ...LETTERS.map((l) => counts[l] || 0));
  return `<div class="bars">${LETTERS.map((l) => {
    const n = counts[l] || 0;
    const dim = answer && l !== answer ? ' dim' : '';
    return `<div class="bar${dim}">
      <span class="badge ${l}">${l}</span>
      <div class="track"><div class="fill ${l}" style="width:${(n / max) * 100}%"></div></div>
      <span class="count num">${n}<small>${pct(n, total)}%</small></span>
    </div>`;
  }).join('')}</div>`;
}

function revealHtml(r) {
  if (!r) return '';
  return `${r.explanation ? `<div class="explain"><b>詳細解析</b><br>${esc(r.explanation)}</div>` : ''}
    ${r.keyPoint ? `<div class="keypoint"><b>重點</b>${esc(r.keyPoint)}</div>` : ''}`;
}

// 本輪總結的一列：題號、各選項人數、答對率
function summaryRow(r, opts = {}) {
  const chips = LETTERS.map((l) => `<span class="chip ${l}${l === r.answer ? ' is-ans' : ''}"><span>${l}</span><b class="num">${r.counts?.[l] ?? 0}</b></span>`).join('');
  const mine = opts.mine ? `<span class="mine ${opts.mine === r.answer ? 'ok' : 'bad'}">你選 ${esc(opts.mine)}</span>` : (opts.showMine ? '<span class="mine bad">未作答</span>' : '');
  return `<li class="srow${r.rate < 60 ? ' weak' : ''}">
    <div class="stext"><b>第 ${r.index + 1} 題</b>　${esc(r.text)}</div>
    <div class="chips">${chips}</div>
    <div class="srate num">${r.rate}%<small>答對率</small></div>${mine}</li>`;
}

/* ---------- 投影畫面 ---------- */
// state: { title, status, mode, code, joinUrl, joined, answered, question, counts, reveal,
//          batch:[{index,text}], batchCounts:[n...], completed, summary:[...], keyPoints:[...] }
export function renderScreen(s) {
  const top = `<div class="topbar"><span><strong>${esc(s.title || '課堂測驗')}</strong></span>
    <span>課堂代碼 <strong class="num">${esc(s.code || '')}</strong>　已加入 <strong class="num">${s.joined || 0}</strong> 人</span></div>`;

  if (s.status === 'lobby') {
    return `${top}
    <section class="lobby">
      <div class="qrbox" id="qr" aria-label="加入課堂的 QR code"></div>
      <div>
        <h1>用手機掃描<br>加入今天的測驗</h1>
        <p class="url">${esc(s.joinUrl || '')}</p>
        <div>輸入課堂代碼</div>
        <div class="codetiles num">${String(s.code || '').split('').map((d) => `<span>${esc(d)}</span>`).join('')}</div>
        <p class="joined">已加入 <b class="num">${s.joined || 0}</b> 人</p>
      </div>
    </section><div></div>`;
  }

  if (s.status === 'batch') {
    const list = (s.batch || []).map((q, k) => `<li><span class="qno">第 ${k + 1} 題</span><span>${esc(q.text)}</span>
      <b class="num">${(s.batchCounts || [])[k] || 0} 人已答</b></li>`).join('');
    return `${top}<section>
      <h2 class="screen-h">請在手機上完成全部 ${s.batch?.length || 0} 題</h2>
      <ol class="batchlist">${list}</ol></section>
      <div class="progress"><span>全部完成 <b class="num">${s.completed || 0}</b> / ${s.joined || 0}</span>
      <div class="track"><div class="fill" style="width:${pct(s.completed || 0, s.joined || 0)}%"></div></div></div>`;
  }

  if (s.status === 'summary') {
    const rows = [...(s.summary || [])].sort((a, b) => a.rate - b.rate);
    const avg = rows.length ? Math.round(rows.reduce((t, r) => t + r.rate, 0) / rows.length) : 0;
    return `${top}<section>
      <h2 class="screen-h">本輪總結　全班平均答對率 <span class="num">${avg}%</span></h2>
      <p class="note">依答對率由低到高排列；外框標示的是正確答案，紅色標記為答對率低於 60% 的題目</p>
      <ol class="summary">${rows.map((r) => summaryRow(r)).join('')}</ol></section><div></div>`;
  }

  if (s.status === 'keypoints') {
    return `${top}<section class="kpscreen">
      <h2 class="screen-h">重點整理</h2>
      <ol class="kplist">${(s.keyPoints || []).map((k) => `<li>${esc(k)}</li>`).join('')}</ol></section><div></div>`;
  }

  if (s.status === 'ended') {
    return `${top}<section class="endscreen"><h1>本輪測驗結束</h1><p>謝謝大家！</p></section><div></div>`;
  }

  const q = s.question || { options: [] };
  const answer = s.status === 'reveal' ? s.reveal?.answer : null;
  const why = s.reveal?.why || {};
  const counts = s.counts || {};
  const hasWhy = answer && LETTERS.some((l) => why[l]);
  const opts = hasWhy
    ? `<ol class="optlist rev">${LETTERS.map((l, i) => {
        if (!q.options?.[i]) return '';
        const n = counts[l] || 0, cls = l === answer ? 'good' : (n ? 'badopt' : 'unpick');
        return `<li class="${cls}"><span class="badge ${l}">${l}</span><span>${esc(q.options[i])}${l !== answer && n ? `（${n} 人）` : ''}</span>
          ${why[l] ? `<span class="why">${l === answer ? '✔ ' : '✘ '}${esc(why[l])}</span>` : ''}</li>`;
      }).join('')}</ol>`
    : `<ol class="optlist">${LETTERS.map((l, i) => q.options?.[i] ? `<li class="${answer && l !== answer ? 'dim' : ''}"><span class="badge ${l}">${l}</span><span>${esc(q.options[i])}</span></li>` : '').join('')}</ol>`;
  const useWall = s.wallMode && s.wallMode !== 'off' && (s.tiles || []).length;
  const showBars = s.status === 'closed' || (s.status === 'reveal' && !hasWhy);

  let right = '';
  if (s.status === 'question' && useWall) right = `<div><p class="wall-h">全班作答牆</p>${wallHtml(s.tiles, 'question')}</div>`;
  if (s.status === 'closed') right = `<div>${barsHtml(counts, null, s.answered || 0)}${useWall ? wallHtml(s.tiles, 'closed') : ''}<p class="note">作答已截止，想想看：為什麼會選這個答案？</p></div>`;
  if (s.status === 'reveal') {
    right = `<div>${showBars ? barsHtml(counts, answer, s.answered || 0) : ''}
      <div class="correct-tag">正確答案：${esc(answer)}　答對率 ${pct(counts[answer] || 0, s.answered || 0)}%</div>
      ${useWall ? wallHtml(s.tiles, 'reveal', answer) : ''}
      ${revealHtml(s.reveal)}
    </div>`;
  }

  const foot = s.status === 'question'
    ? `<div class="progress"><span>已作答 <b class="num">${s.answered || 0}</b> / ${s.joined || 0}</span>
       <div class="track"><div class="fill" style="width:${pct(s.answered || 0, s.joined || 0)}%"></div></div></div>`
    : '<div></div>';

  return `${top}
  <section class="qscreen${right ? '' : ' single'}">
    <div>
      <div class="qhead"><div><div class="qmeta">第 ${q.index + 1} / ${q.total} 題${q.chapter ? `　${esc(q.chapter)}` : ''}</div>
      <h2>${esc(q.text)}</h2></div>${imgTag(q.img)}</div>
      ${opts}
    </div>
    ${right}
  </section>${foot}`;
}

/* ---------- 學生端 ---------- */
// state: { view, studentId, title, question, myChoice, reveal, batch, mine:{qIndex:choice}, summary, keyPoints, error }
function choiceButtons(q, my, { locked, answer, qAttr = '' } = {}) {
  return LETTERS.map((l, i) => {
    if (!q.options?.[i]) return '';
    let cls = '';
    if (answer) cls = l === answer ? ' correct' : (l === my ? ' wrong' : '');
    return `<button class="choice${cls}" data-choice="${l}"${qAttr} aria-pressed="${my === l}" ${locked ? 'disabled' : ''}>
      <span class="badge ${l}">${l}</span><span>${esc(q.options[i])}</span></button>`;
  }).join('');
}

export function renderStudent(s) {
  const idLabel = s.testMode ? '暱稱' : '座號';
  const head = `<header><h1>${esc(s.title || '課堂測驗')}</h1>${s.studentId ? `<span class="who">${idLabel} ${esc(s.studentId)}</span>` : ''}</header>`;

  switch (s.view) {
    case 'login':
      return `${head}<form class="panel" id="login-form" novalidate>
        ${s.testMode ? '<p class="note" style="margin-top:0">測試模式：輸入任一暱稱即可加入</p>' : ''}
        <div class="field"><label for="sid">${idLabel}${s.testMode ? '' : '<span class="note">（1–3 位數字，也可輸入學號）</span>'}</label>
          <input id="sid" name="sid" inputmode="text" autocomplete="off" ${s.testMode ? '' : 'autocapitalize="characters"'} maxlength="20" required value="${esc(s.prefillId || '')}"></div>
        <div class="field${s.testMode && s.prefillCode ? ' hidden' : ''}"><label for="code">課堂代碼（投影幕上的 6 位數字）</label>
          <input id="code" name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" required value="${esc(s.prefillCode || '')}"></div>
        <p class="error-msg" role="alert">${esc(s.error || '')}</p>
        <button class="btn go" type="submit" style="width:100%">加入課堂</button>
      </form>`;
    case 'loading':
      return `${head}<div class="panel waiting"><p class="big"><span class="pulse"></span>連線中</p></div>`;
    case 'lobby':
      return `${head}<div class="panel waiting"><p class="big"><span class="pulse"></span>已加入，等待老師出題</p><p class="note">請保持此頁面開啟</p></div>`;
    case 'ended':
      return `${head}<div class="panel waiting"><p class="big">本輪測驗結束</p><p class="note">謝謝參與</p></div>`;
    case 'batch': {
      const qs = s.batch || [];
      const done = qs.filter((q) => s.mine?.[q.index]).length;
      return `${head}<p class="note">共 ${qs.length} 題，點選即送出，老師截止前都可以更改。</p>
        ${qs.map((q) => `<div class="panel bq"><div class="qmeta">第 ${q.index + 1} / ${qs.length} 題</div>
          <p class="qtext">${esc(q.text)}</p>${choiceButtons(q, s.mine?.[q.index], { qAttr: ` data-q="${q.index}"` })}</div>`).join('')}
        <p class="status-line sticky-status" role="status">已作答 ${done} / ${qs.length} 題${done === qs.length && qs.length ? '，全部完成，等老師截止' : ''}</p>`;
    }
    case 'summary': {
      const rows = s.summary || [];
      const correct = rows.filter((r) => s.mine?.[r.index] === r.answer).length;
      return `${head}<div class="panel"><p class="result-mark ${correct === rows.length ? 'ok' : ''}">你答對 ${correct} / ${rows.length} 題</p>
        <ol class="summary compact">${rows.map((r) => summaryRow(r, { mine: s.mine?.[r.index], showMine: true })).join('')}</ol></div>`;
    }
    case 'keypoints':
      return `${head}<div class="panel"><h2 style="margin-top:0">重點整理</h2>
        <ol class="kplist">${(s.keyPoints || []).map((k) => `<li>${esc(k)}</li>`).join('')}</ol>
        <p class="note">可以截圖留存複習</p></div>`;
  }

  // question / closed / reveal
  const q = s.question || { options: [] };
  const locked = s.view !== 'question';
  const answer = s.view === 'reveal' ? s.reveal?.answer : null;

  let status = '';
  if (s.view === 'question') status = s.myChoice ? `已送出 ${esc(s.myChoice)}，截止前可以更改` : '點選一個答案即送出';
  if (s.view === 'closed') status = s.myChoice ? `作答已截止，你選了 ${esc(s.myChoice)}` : '作答已截止，你這題沒有作答';

  let result = '';
  if (answer) {
    const ok = s.myChoice === answer;
    const myWhy = !ok && s.myChoice ? s.reveal?.why?.[s.myChoice] : '';
    result = `<p class="result-mark ${ok ? 'ok' : 'bad'}">${s.myChoice ? (ok ? '答對了' : `答錯了，正確答案是 ${esc(answer)}`) : `未作答，正確答案是 ${esc(answer)}`}</p>
      ${myWhy ? `<div class="whybox"><b>你選 ${esc(s.myChoice)}：錯在哪裡？</b><br>${esc(myWhy)}</div>` : ''}
      ${revealHtml(s.reveal)}`;
  }

  return `${head}<div class="panel">
    <div class="qhead"><div><div class="qmeta">第 ${q.index + 1} / ${q.total} 題</div>
    <p class="qtext">${esc(q.text)}</p></div>${imgTag(q.img, 'qimg sm')}</div>
    ${result}
    <div style="margin-top:${answer ? '1rem' : '0'}">${choiceButtons(q, s.myChoice, { locked, answer })}</div>
    <p class="status-line" role="status">${status}</p>
  </div>`;
}
