// 教師控制台：登入、上傳題庫、建立課堂、逐題控制、即時明細、匯出成績
import { initFirebase, showFatal } from './firebase-init.js';
import { LETTERS, esc } from './views.js';
import { nextStep, runStep } from './flow.js';

const $ = (id) => document.getElementById(id);
let fb, user, sid = null, session = null, questions = [], keyPoints = [], pending = [], pendingKP = [], busy = false;
let participants = new Map();   // uid -> studentId
let answers = new Map();        // `${qIndex}_${uid}` -> {uid, qIndex, choice}
let unsubs = [];

const show = (view) => ['view-login', 'view-setup', 'view-live', 'view-hw'].forEach((v) => $(v).classList.toggle('hidden', v !== view));
const STATUS_TEXT = { lobby: '等待學生加入', question: '作答中', batch: '連續作答中', closed: '已截止', reveal: '已公布答案', summary: '本輪總結', keypoints: '重點整理', ended: '已結束' };

/* ---------- 題庫解析 ---------- */
const COLS = { index: '題號', chapter: '章節', text: '題目', A: '選項A', B: '選項B', C: '選項C', D: '選項D', answer: '答案', explanation: '解析', keyPoint: '重點', category: '類別', source: '來源',
  whyA: '錯誤說明A', whyB: '錯誤說明B', whyC: '錯誤說明C', whyD: '錯誤說明D', img: '插圖' };

function parseSheet(rows) {
  const out = [], errs = [];
  rows.forEach((r, i) => {
    const get = (k) => String(r[COLS[k]] ?? '').trim();
    const text = get('text');
    if (!text) return; // 空白列略過
    const options = LETTERS.map((l) => get(l));
    const answer = get('answer').toUpperCase();
    const line = i + 2;
    if (options.filter(Boolean).length < 2) errs.push(`第 ${line} 列：至少要有 2 個選項`);
    else if (!LETTERS.includes(answer)) errs.push(`第 ${line} 列：答案須為 A、B、C 或 D`);
    else if (!options[LETTERS.indexOf(answer)]) errs.push(`第 ${line} 列：答案 ${answer} 沒有對應的選項內容`);
    else out.push({ chapter: get('chapter'), category: get('category'), text, options, answer, explanation: get('explanation'), keyPoint: get('keyPoint'), source: get('source'),
      why: Object.fromEntries(LETTERS.map((l) => [l, get('why' + l)])), img: get('img').replace(/[^A-Za-z0-9_-]/g, '') });
  });
  return { out, errs };
}

async function onFile(e) {
  const f = e.target.files[0]; if (!f) return;
  $('setup-err').textContent = '';
  try {
    const wb = window.XLSX.read(await f.arrayBuffer(), { type: 'array' });
    const ws = wb.Sheets['題庫'] || wb.Sheets[wb.SheetNames[0]];
    const { out, errs } = parseSheet(window.XLSX.utils.sheet_to_json(ws, { defval: '' }));
    pending = out;
    const kpSheet = wb.Sheets['本輪重點'];
    pendingKP = kpSheet ? window.XLSX.utils.sheet_to_json(kpSheet, { header: 1, defval: '' })
      .map((r) => String(r[0] ?? '').trim()).filter((t) => t && t !== '重點') : [];
    $('preview').innerHTML = `<p><b>讀到 ${out.length} 題、${pendingKP.length} 點本輪重點</b>${errs.length ? `，<span class="dup">${errs.length} 列有問題未匯入</span>` : ''}</p>
      ${errs.length ? `<ul class="note">${errs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <ol class="preview">${out.map((q) => `<li>${esc(q.text)}（答案 ${q.answer}）</li>`).join('')}</ol>`;
    $('btn-create').disabled = out.length === 0;
  } catch (err) {
    console.error(err);
    $('setup-err').textContent = '無法讀取這個檔案，請確認是 Excel 格式並使用「題庫範本.xlsx」的欄位名稱。';
  }
}

/* ---------- 建立課堂 ---------- */
async function createSession() {
  const { F, db } = fb;
  $('btn-create').disabled = true;
  try {
    let code;
    for (let i = 0; i < 10; i++) {
      const c = String(Math.floor(100000 + Math.random() * 900000));
      if (!(await F.getDoc(F.doc(db, 'codes', c))).exists()) { code = c; break; }
    }
    if (!code) throw new Error('無法產生課堂代碼');
    const ref = F.doc(F.collection(db, 'sessions'));
    await F.setDoc(ref, {
      title: $('title').value.trim() || '課堂測驗', code, teacherUid: user.uid, status: 'lobby',
      mode: document.querySelector('input[name="mode"]:checked')?.value || 'step', answeringDone: false,
      testMode: $('testmode').checked, wall: $('wall')?.value || 'last3',
      total: pending.length, current: null, reveal: null, batch: null, summary: null, keyPoints: null,
      createdAt: F.serverTimestamp(),
    });
    await F.setDoc(F.doc(db, 'sessions', ref.id, 'private', 'key'), { questions: pending, keyPoints: pendingKP });
    await F.setDoc(F.doc(db, 'codes', code), { sid: ref.id, createdAt: F.serverTimestamp() });
    openSession(ref.id);
  } catch (err) {
    console.error(err);
    $('setup-err').textContent = `建立失敗：${err.code || err.message}`;
    $('btn-create').disabled = false;
  }
}

async function listOpenSessions() {
  const { F, db } = fb;
  const snap = await F.getDocs(F.query(F.collection(db, 'sessions'), F.where('teacherUid', '==', user.uid)));
  const list = [];
  snap.forEach((d) => { const s = d.data(); if (s.status !== 'ended') list.push({ id: d.id, ...s }); });
  list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  $('open-sessions').innerHTML = list.length
    ? list.map((s) => `<div class="row" style="margin-bottom:.5rem"><button class="btn secondary" data-sid="${s.id}">回到課堂</button>
        <span>${esc(s.title)}　代碼 <b class="num">${esc(s.code)}</b>　${STATUS_TEXT[s.status] || ''}</span></div>`).join('')
    : '目前沒有進行中的課堂。';
  $('open-sessions').querySelectorAll('[data-sid]').forEach((b) => b.addEventListener('click', () => openSession(b.dataset.sid)));
}

/* ---------- 講解建議（依答對率） ---------- */
function teachHint(q, cur) {
  const st = session?.status;
  if (!cur.length || (st !== 'closed' && st !== 'reveal')) return '';
  const counts = Object.fromEntries(LETTERS.map((l) => [l, cur.filter((a) => a.choice === l).length]));
  const rate = Math.round((counts[q.answer] / cur.length) * 100);
  const wrong = LETTERS.filter((l) => l !== q.answer && q.options[LETTERS.indexOf(l)]).sort((a, b) => counts[b] - counts[a])[0];
  const tip = rate >= 80 ? '<b>快速帶過</b>：大多數人都懂了。'
    : rate >= 40 ? `<b>請選 ${wrong} 的同學說說理由</b>，再講解為什麼不對。${q.why?.[wrong] ? `（${esc(q.why[wrong])}）` : ''}`
    : '<b>重新講一次觀念</b>：多數人還沒建立正確概念。';
  return `<span class="hint-box">本題答對率 ${rate}%　${tip}</span>`;
}

/* ---------- 上課中 ---------- */
async function openSession(id) {
  const { F, db } = fb;
  unsubs.forEach((u) => u()); unsubs = [];
  sid = id; participants = new Map(); answers = new Map();
  const priv = (await F.getDoc(F.doc(db, 'sessions', sid, 'private', 'key'))).data() || {};
  questions = priv.questions || []; keyPoints = priv.keyPoints || [];
  show('view-live');
  unsubs.push(F.onSnapshot(F.doc(db, 'sessions', sid), (snap) => { session = snap.data(); render(); }));
  unsubs.push(F.onSnapshot(F.collection(db, 'sessions', sid, 'participants'), (snap) => {
    participants = new Map(); snap.forEach((d) => participants.set(d.id, d.data().studentId)); render();
  }));
  unsubs.push(F.onSnapshot(F.collection(db, 'sessions', sid, 'answers'), (snap) => {
    answers = new Map(); snap.forEach((d) => answers.set(d.id, d.data())); render();
  }));
}

const curIndex = () => (session?.current ? session.current.index : -1);

async function doStep(step) {
  if (!step || busy) return;
  if (step.act === 'end' && !confirm('確定結束本輪？結束後學生無法再加入或作答。')) return;
  busy = true;
  try {
    await runStep(step, { ...fb, sid, session, questions, keyPoints, answers: [...answers.values()] });
  } catch (err) { console.error(err); alert(`操作失敗：${err.code || err.message}`); }
  finally { busy = false; }
}

async function setMode(mode) {
  const { F, db } = fb;
  try { await F.updateDoc(F.doc(db, 'sessions', sid), { mode }); } catch (err) { console.error(err); alert('切換失敗'); }
}

function render() {
  if (!session) return;
  const i = curIndex(), st = session.status, total = questions.length;
  $('live-title').textContent = session.title;
  $('live-code').textContent = session.code;
  $('live-state').textContent = STATUS_TEXT[st] || st;
  $('k-joined').textContent = participants.size;

  // 按鈕狀態：主按鈕依流程自動顯示下一步
  const step = nextStep(session, total, keyPoints.length);
  $('btn-next').textContent = step ? step.label : '本輪已結束';
  $('btn-next').disabled = !step;
  $('btn-end').disabled = st === 'ended';
  $('mode-switch').classList.toggle('hidden', st !== 'lobby');
  document.querySelectorAll('input[name="livemode"]').forEach((r) => { r.checked = r.value === (session.mode || 'step'); });

  // 本題統計
  const cur = [...answers.values()].filter((a) => a.qIndex === i);
  $('k-answered').textContent = cur.length;
  const q = questions[i];
  $('k-rate').textContent = q && st === 'reveal' && cur.length ? `${Math.round((cur.filter((a) => a.choice === q.answer).length / cur.length) * 100)}%` : '–';

  // 目前題目（教師可看答案）；連續作答時顯示各題作答人數
  const all = [...answers.values()];
  $('cur-card').classList.toggle('hidden', !q && st !== 'batch' && st !== 'summary');
  if (st === 'batch' || st === 'summary') {
    const per = {}; all.forEach((a) => { per[a.uid] = (per[a.uid] || 0) + 1; });
    const done = Object.values(per).filter((n) => n >= total).length;
    $('cur-head').textContent = st === 'batch' ? `連續作答中：全部完成 ${done} / ${participants.size} 人` : '本輪總結（答對率由低到高）';
    $('cur-text').textContent = '';
    const rows = questions.map((qq, k) => {
      const list = all.filter((a) => a.qIndex === k);
      const ok = list.filter((a) => a.choice === qq.answer).length;
      return { k, qq, list, rate: list.length ? Math.round((ok / list.length) * 100) : 0 };
    });
    if (st === 'summary') rows.sort((a, b) => a.rate - b.rate);
    $('cur-opts').innerHTML = `<div class="tbl-wrap" style="grid-column:1/-1"><table class="grid"><tr><th>題目</th><th>已答</th>${LETTERS.map((l) => `<th>${l}</th>`).join('')}${st === 'summary' ? '<th>答對率</th>' : ''}</tr>
      ${rows.map(({ k, qq, list, rate }) => `<tr><td>第 ${k + 1} 題（答 ${qq.answer}）${esc(qq.text.slice(0, 24))}</td><td class="num">${list.length}</td>
        ${LETTERS.map((l) => `<td class="num${st === 'summary' && l === qq.answer ? ' ok' : ''}">${list.filter((a) => a.choice === l).length}</td>`).join('')}
        ${st === 'summary' ? `<td class="num${rate < 60 ? ' bad' : ''}">${rate}%</td>` : ''}</tr>`).join('')}</table></div>`;
    $('cur-explain').textContent = '';
  } else if (q) {
    $('cur-head').textContent = `第 ${i + 1} / ${total} 題${q.chapter ? `　${q.chapter}` : ''}　正確答案 ${q.answer}`;
    $('cur-text').textContent = q.text;
    $('cur-opts').innerHTML = LETTERS.map((l, k) => {
      if (!q.options[k]) return '';
      const ids = cur.filter((a) => a.choice === l).map((a) => participants.get(a.uid) || a.studentId).sort();
      return `<div class="optcol${l === q.answer ? ' is-correct' : ''}">
        <div class="row"><span class="badge ${l}">${l}</span><b class="num">${ids.length} 人</b></div>
        <div style="margin:.3rem 0">${esc(q.options[k])}</div>
        <div class="ids num">${ids.map(esc).join('、') || '—'}</div></div>`;
    }).join('');
    $('cur-explain').innerHTML = teachHint(q, cur) + esc([q.explanation && `解析：${q.explanation}`, q.keyPoint && `重點：${q.keyPoint}`].filter(Boolean).join('　'));
  }

  // 全班明細
  const counts = {};
  participants.forEach((s) => { counts[s] = (counts[s] || 0) + 1; });
  const dups = Object.keys(counts).filter((k) => counts[k] > 1);
  const idLabel = session.testMode ? '暱稱' : '座號／學號';
  $('dup-note').textContent = dups.length ? `重複${idLabel}：${dups.join('、')}（可能同一人用兩支裝置）` : '';
  renderShare();
  const fullView = session.answeringDone || ['batch', 'summary', 'keypoints', 'ended'].includes(st);
  const shown = fullView ? total : Math.max(i + 1, 0);
  const allRevealed = ['summary', 'keypoints', 'ended'].includes(st);
  const rows = [...participants.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const head = `<tr><th>${idLabel}</th>${Array.from({ length: shown }, (_, k) => `<th>Q${k + 1}</th>`).join('')}<th>答對</th></tr>`;
  const body = rows.map(([uid, stuId]) => {
    let ok = 0;
    const cells = Array.from({ length: shown }, (_, k) => {
      const a = answers.get(`${k}_${uid}`);
      const revealed = allRevealed || k < i || (k === i && st === 'reveal');
      if (!a) return '<td class="pending">—</td>';
      if (!revealed) return `<td>${a.choice}</td>`;
      const good = a.choice === questions[k].answer; if (good) ok++;
      return `<td class="${good ? 'ok' : 'bad'}">${a.choice}</td>`;
    }).join('');
    return `<tr><td class="${dups.includes(stuId) ? 'dup' : ''}">${esc(stuId)}</td>${cells}<td class="num">${ok}</td></tr>`;
  }).join('');
  $('grid').innerHTML = head + (body || `<tr><td colspan="${shown + 2}" class="pending">尚無學生加入</td></tr>`);
}

/* ---------- 匯出 ---------- */
function exportExcel() {
  const X = window.XLSX;
  const rows = [...participants.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([uid, stuId]) => {
    const r = { [session?.testMode ? '暱稱' : '座號／學號']: stuId }; let ok = 0, done = 0;
    questions.forEach((q, k) => {
      const a = answers.get(`${k}_${uid}`);
      r[`Q${k + 1}`] = a ? a.choice : '';
      if (a) { done++; if (a.choice === q.answer) ok++; }
    });
    r['作答題數'] = done; r['答對題數'] = ok; r['答對率'] = questions.length ? Math.round((ok / questions.length) * 100) / 100 : 0;
    return r;
  });
  const analysis = questions.map((q, k) => {
    const list = [...answers.values()].filter((a) => a.qIndex === k);
    const r = { 題號: k + 1, 章節: q.chapter, 題目: q.text, 正確答案: q.answer, 作答人數: list.length };
    LETTERS.forEach((l) => { r[`選${l}人數`] = list.filter((a) => a.choice === l).length; });
    r['答對率'] = list.length ? Math.round((r[`選${q.answer}人數`] / list.length) * 100) / 100 : '';
    r['重點'] = q.keyPoint || '';
    r['來源'] = q.source || '';
    return r;
  });
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(rows), '學生成績');
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(analysis), '題目分析');
  const safe = (session?.title || '課堂測驗').replace(/[\\/:*?"<>|]/g, '_');
  X.writeFile(wb, `${safe}_成績.xlsx`);
}

/* ---------- 課後練習 ---------- */
let hwPending = [], hwPendingKP = [], hwId = null, hwDoc = null, hwKey = null, hwSubs = [], hwUnsubs = [];
const hwUrl = (id) => new URL(`assignment.html?a=${id}`, location.href).href;

async function readWorkbook(file) {
  const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const ws = wb.Sheets['題庫'] || wb.Sheets[wb.SheetNames[0]];
  const { out, errs } = parseSheet(window.XLSX.utils.sheet_to_json(ws, { defval: '' }));
  const kpSheet = wb.Sheets['本輪重點'];
  const kp = kpSheet ? window.XLSX.utils.sheet_to_json(kpSheet, { header: 1, defval: '' }).map((r) => String(r[0] ?? '').trim()).filter((t) => t && t !== '重點') : [];
  return { out, errs, kp };
}

async function onHwFile(e) {
  const f = e.target.files[0]; if (!f) return;
  $('hw-err').textContent = '';
  try {
    const { out, errs, kp } = await readWorkbook(f);
    hwPending = out; hwPendingKP = kp;
    const review = out.filter((q) => q.category === '複習').length;
    $('hw-preview').innerHTML = `<p><b>讀到 ${out.length} 題</b>（本週 ${out.length - review} 題、複習 ${review} 題）、${kp.length} 點重點${errs.length ? `，<span class="dup">${errs.length} 列有問題未匯入</span>` : ''}</p>
      ${errs.length ? `<ul class="note">${errs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
    $('btn-hw-create').disabled = out.length === 0;
  } catch (err) { console.error(err); $('hw-err').textContent = '無法讀取這個檔案，請確認是 Excel 格式。'; }
}

async function createHomework() {
  const { F, db } = fb;
  $('btn-hw-create').disabled = true;
  try {
    const ref = F.doc(F.collection(db, 'assignments'));
    await F.setDoc(ref, {
      title: $('hw-title').value.trim() || '課後練習', teacherUid: user.uid, status: 'open', total: hwPending.length,
      testMode: $('hw-testmode').checked, createdAt: F.serverTimestamp(),
      questions: hwPending.map((q) => ({ text: q.text, options: q.options, chapter: q.chapter || '', category: q.category || '', img: q.img || '' })),
    });
    await F.setDoc(F.doc(db, 'assignments', ref.id, 'reveal', 'key'), {
      items: hwPending.map((q) => ({ answer: q.answer, explanation: q.explanation || '', keyPoint: q.keyPoint || '', source: q.source || '', why: q.why || {} })),
      keyPoints: hwPendingKP,
    });
    $('hw-preview').innerHTML = ''; $('hw-file').value = ''; $('hw-title').value = '';
    openHomework(ref.id);
  } catch (err) { console.error(err); $('hw-err').textContent = `建立失敗：${err.code || err.message}`; $('btn-hw-create').disabled = false; }
}

async function listHomework() {
  const { F, db } = fb;
  const snap = await F.getDocs(F.query(F.collection(db, 'assignments'), F.where('teacherUid', '==', user.uid)));
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  $('hw-list').innerHTML = list.length
    ? list.map((a) => `<div class="row" style="margin-bottom:.5rem"><button class="btn secondary" data-hw="${a.id}">查看成績</button>
        <span>${esc(a.title)}　${a.total} 題　<span class="state-chip">${a.status === 'open' ? '開放中' : '已關閉'}</span></span></div>`).join('')
    : '尚未建立課後練習。';
  $('hw-list').querySelectorAll('[data-hw]').forEach((b) => b.addEventListener('click', () => openHomework(b.dataset.hw)));
}

async function openHomework(id) {
  const { F, db } = fb;
  hwUnsubs.forEach((u) => u()); hwUnsubs = [];
  hwId = id; hwSubs = [];
  hwKey = (await F.getDoc(F.doc(db, 'assignments', id, 'reveal', 'key'))).data() || { items: [] };
  show('view-hw');
  const url = hwUrl(id);
  $('hw-url').textContent = url;
  if (window.qrcode) { const qr = window.qrcode(0, 'M'); qr.addData(url); qr.make(); $('hw-qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true }); }
  hwUnsubs.push(F.onSnapshot(F.doc(db, 'assignments', id), (snap) => { hwDoc = snap.data(); renderHomework(); }));
  hwUnsubs.push(F.onSnapshot(F.collection(db, 'assignments', id, 'submissions'), (snap) => { hwSubs = snap.docs.map((d) => d.data()); renderHomework(); }));
}

function hwScore(sub) { return hwDoc.questions.reduce((t, _, i) => t + (sub.answers?.[i] && sub.answers[i] === hwKey.items[i]?.answer ? 1 : 0), 0); }

function renderHomework() {
  if (!hwDoc) return;
  const total = hwDoc.total, label = hwDoc.testMode ? '暱稱' : '座號／學號';
  $('hw-r-title').textContent = hwDoc.title;
  $('btn-hw-toggle').textContent = hwDoc.status === 'open' ? '關閉練習' : '重新開放';
  const scores = hwSubs.map(hwScore);
  $('hw-k-n').textContent = hwSubs.length;
  $('hw-k-avg').textContent = scores.length ? `${Math.round((scores.reduce((a, b) => a + b, 0) / scores.length / total) * 100)}%` : '–';
  $('hw-k-range').textContent = scores.length ? `${Math.min(...scores)}／${Math.max(...scores)}` : '–';
  const rows = hwDoc.questions.map((q, i) => {
    const ans = hwKey.items[i]?.answer;
    const n = hwSubs.filter((s) => s.answers?.[i]).length;
    const ok = hwSubs.filter((s) => s.answers?.[i] === ans).length;
    const counts = Object.fromEntries(LETTERS.map((l) => [l, hwSubs.filter((s) => s.answers?.[i] === l).length]));
    return { i, q, ans, n, counts, rate: hwSubs.length ? Math.round((ok / hwSubs.length) * 100) : 0 };
  }).sort((a, b) => a.rate - b.rate);
  const advice = (r) => {
    if (r.rate >= 60 || !hwSubs.length) return '—';
    const w = LETTERS.filter((l) => l !== r.ans).sort((a, b) => r.counts[b] - r.counts[a])[0];
    const why = hwKey.items[r.i]?.why?.[w];
    return `重講；最多人誤選 ${w}${why ? `：${esc(why)}` : ''}`;
  };
  $('hw-qtable').innerHTML = `<tr><th>題目</th><th>類別</th>${LETTERS.map((l) => `<th>${l}</th>`).join('')}<th>未答</th><th>答對率</th><th>下週開場建議</th></tr>` +
    rows.map((r) => `<tr><td>第 ${r.i + 1} 題（答 ${r.ans}）${esc(r.q.text.slice(0, 26))}</td><td>${esc(r.q.category || '')}</td>
      ${LETTERS.map((l) => `<td class="num${l === r.ans ? ' ok' : ''}">${r.counts[l]}</td>`).join('')}
      <td class="num">${hwSubs.length - r.n}</td><td class="num${r.rate < 60 ? ' bad' : ''}">${r.rate}%</td><td class="note" style="min-width:14rem">${advice(r)}</td></tr>`).join('');
  const counts = {}; hwSubs.forEach((s) => { counts[s.studentId] = (counts[s.studentId] || 0) + 1; });
  const dups = Object.keys(counts).filter((k) => counts[k] > 1);
  $('hw-dup').textContent = dups.length ? `重複${label}：${dups.join('、')}（可能換裝置重做）` : '';
  const subs = [...hwSubs].sort((a, b) => String(a.studentId).localeCompare(String(b.studentId)));
  $('hw-stable').innerHTML = `<tr><th>${label}</th><th>答對</th><th>答對率</th><th>交卷時間</th></tr>` +
    (subs.map((s) => { const sc = hwScore(s); const t = s.submittedAt?.toDate ? s.submittedAt.toDate().toLocaleString('zh-TW') : '';
      return `<tr><td class="${dups.includes(s.studentId) ? 'dup' : ''}">${esc(s.studentId)}</td><td class="num">${sc} / ${total}</td><td class="num">${Math.round((sc / total) * 100)}%</td><td>${t}</td></tr>`; }).join('')
    || '<tr><td colspan="4" class="pending">尚無人交卷</td></tr>');
}

function exportHomework() {
  const X = window.XLSX, label = hwDoc.testMode ? '暱稱' : '座號／學號';
  const stu = hwSubs.map((s) => {
    const r = { [label]: s.studentId }; const sc = hwScore(s);
    hwDoc.questions.forEach((_, i) => { r[`Q${i + 1}`] = s.answers?.[i] || ''; });
    r['答對題數'] = sc; r['答對率'] = Math.round((sc / hwDoc.total) * 100) / 100;
    r['交卷時間'] = s.submittedAt?.toDate ? s.submittedAt.toDate().toLocaleString('zh-TW') : '';
    return r;
  });
  const ana = hwDoc.questions.map((q, i) => {
    const ans = hwKey.items[i]?.answer;
    const r = { 題號: i + 1, 類別: q.category, 章節: q.chapter, 題目: q.text, 正確答案: ans };
    LETTERS.forEach((l) => { r[`選${l}`] = hwSubs.filter((s) => s.answers?.[i] === l).length; });
    r['未答'] = hwSubs.filter((s) => !s.answers?.[i]).length;
    r['答對率'] = hwSubs.length ? Math.round((r[`選${ans}`] / hwSubs.length) * 100) / 100 : '';
    r['來源'] = hwKey.items[i]?.source || '';
    return r;
  });
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(stu), '學生成績');
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(ana), '題目分析');
  X.writeFile(wb, `${hwDoc.title.replace(/[\\/:*?"<>|]/g, '_')}_成績.xlsx`);
}

/* ---------- 遠端測試用加入連結 ---------- */
let lastShare = '';
const sessionJoinUrl = () => new URL(`student.html?code=${session.code}${session.testMode ? '&t=1' : ''}`, location.href).href;
function renderShare() {
  const on = session && session.status !== 'ended';
  $('share-row').classList.toggle('hidden', !on);
  if (!on) return;
  const url = sessionJoinUrl();
  if (url === lastShare) return;
  lastShare = url;
  $('share-url').textContent = url;
  if (window.qrcode) { const qr = window.qrcode(0, 'M'); qr.addData(url); qr.make(); $('share-qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true }); }
}

/* ---------- 簡報用 QR code ---------- */
const joinUrl = () => new URL('student.html', location.href).href;

function renderJoinQr() {
  const url = joinUrl();
  $('join-url').textContent = url;
  if (!window.qrcode) return;
  const qr = window.qrcode(0, 'M'); qr.addData(url); qr.make();
  $('qr-preview').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
}

function downloadJoinQr() {
  const url = joinUrl();
  const qr = window.qrcode(0, 'M'); qr.addData(url); qr.make();
  const n = qr.getModuleCount(), cell = Math.floor(900 / n), size = n * cell, pad = 80;
  const W = size + pad * 2, H = size + pad * 2 + 170;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#000000';
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (qr.isDark(r, k)) g.fillRect(pad + k * cell, pad + r * cell, cell, cell);
  g.fillStyle = '#18303a'; g.textAlign = 'center';
  g.font = 'bold 52px "Noto Sans TC","Microsoft JhengHei",sans-serif';
  g.fillText('掃描加入課堂測驗', W / 2, size + pad + 80);
  g.font = '28px "Noto Sans TC","Microsoft JhengHei",sans-serif';
  g.fillText(url, W / 2, size + pad + 135, W - 40);
  c.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = '學生加入QRcode.png';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
}

/* ---------- 啟動 ---------- */
(async () => {
  try { fb = await initFirebase(); } catch (e) { return showFatal(e.message); }
  const { A, F, auth, db } = fb;

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault(); $('login-err').textContent = '';
    try { await A.signInWithEmailAndPassword(auth, $('email').value.trim(), $('pw').value); }
    catch { $('login-err').textContent = '登入失敗，請確認電子郵件與密碼。'; }
  });
  $('btn-logout').addEventListener('click', () => A.signOut(auth));
  $('file').addEventListener('change', onFile);
  $('btn-create').addEventListener('click', createSession);
  $('btn-screen').addEventListener('click', () => window.open(`screen.html?sid=${encodeURIComponent(sid)}`, 'quiz-screen'));
  $('btn-next').addEventListener('click', () => doStep(nextStep(session, questions.length, keyPoints.length)));
  $('btn-end').addEventListener('click', () => doStep({ act: 'end' }));
  document.querySelectorAll('input[name="livemode"]').forEach((r) => r.addEventListener('change', () => setMode(r.value)));
  $('btn-export').addEventListener('click', exportExcel);
  $('btn-qr').addEventListener('click', downloadJoinQr);
  $('hw-file').addEventListener('change', onHwFile);
  $('btn-hw-create').addEventListener('click', createHomework);
  $('btn-hw-back').addEventListener('click', () => { hwUnsubs.forEach((u) => u()); hwUnsubs = []; show('view-setup'); listHomework(); });
  $('btn-hw-export').addEventListener('click', exportHomework);
  $('btn-hw-toggle').addEventListener('click', async () => {
    const { F, db } = fb;
    try { await F.updateDoc(F.doc(db, 'assignments', hwId), { status: hwDoc.status === 'open' ? 'closed' : 'open' }); }
    catch (err) { alert(`操作失敗：${err.code || err.message}`); }
  });
  $('btn-hw-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(hwUrl(hwId)); $('btn-hw-copy').textContent = '已複製'; setTimeout(() => { $('btn-hw-copy').textContent = '複製作答連結'; }, 1500); }
    catch { prompt('請手動複製以下連結：', hwUrl(hwId)); }
  });
  $('btn-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(sessionJoinUrl()); $('btn-copy').textContent = '已複製'; setTimeout(() => { $('btn-copy').textContent = '複製加入連結'; }, 1500); }
    catch { prompt('請手動複製以下連結：', sessionJoinUrl()); }
  });

  A.onAuthStateChanged(auth, async (u) => {
    unsubs.forEach((x) => x()); unsubs = [];
    if (!u || u.isAnonymous) { user = null; $('btn-logout').classList.add('hidden'); return show('view-login'); }
    const isTeacher = (await F.getDoc(F.doc(db, 'teachers', u.uid)).catch(() => null))?.exists();
    if (!isTeacher) {
      $('login-err').textContent = `此帳號尚未設定教師權限（UID：${u.uid}），請依 README 第 4 步設定。`;
      await A.signOut(auth); return;
    }
    user = u; $('btn-logout').classList.remove('hidden');
    show('view-setup'); renderJoinQr(); listOpenSessions(); listHomework();
  });
})();
