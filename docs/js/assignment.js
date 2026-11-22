// 課後練習（學生端）：座號（或學號）登入 → 作答（進度自動保存）→ 交卷一次 → 立即看分數與解析
import { initFirebase, showFatal } from './firebase-init.js';
import { renderHomework, buildLayout, grade } from './hwviews.js';

const app = document.getElementById('app');
const aid = new URLSearchParams(location.search).get('a');
const st = { view: 'loading', answers: {} };
let fb, uid, assignment;
const draftKey = () => `hw-${aid}-${uid}`;
const saveDraft = () => { try { localStorage.setItem(draftKey(), JSON.stringify({ studentId: st.studentId, answers: st.answers })); } catch { /* 無法保存時略過 */ } };
const loadDraft = () => { try { return JSON.parse(localStorage.getItem(draftKey()) || 'null'); } catch { return null; } };

function draw() {
  const y = window.scrollY;
  app.innerHTML = renderHomework(st);
  if (st.view === 'answer') window.scrollTo(0, y);
  const form = document.getElementById('login-form');
  if (form) form.addEventListener('submit', onLogin);
  app.querySelectorAll('.choice[data-q]').forEach((b) => b.addEventListener('click', () => {
    st.answers[b.dataset.q] = b.dataset.choice; saveDraft(); draw();
  }));
  const sub = document.getElementById('btn-submit');
  if (sub) sub.addEventListener('click', onSubmit);
}

function startAnswering() {
  st.layout = buildLayout(st.questions, uid);
  st.view = 'answer'; draw(); window.scrollTo(0, 0);
}

function onLogin(e) {
  e.preventDefault();
  const raw = e.target.sid.value.trim();
  const id = st.testMode ? raw : (/^\d{1,3}$/.test(raw) ? raw.padStart(3, '0') : raw.toUpperCase()); // 座號補成 3 碼
  st.prefillId = id;
  if (st.testMode ? (id.length < 1 || id.length > 20) : !/^[A-Z0-9]{3,20}$/.test(id)) {
    st.error = st.testMode ? '暱稱請輸入 1–20 個字' : '請輸入座號（1–3 位數字）或學號'; return draw();
  }
  st.error = ''; st.studentId = id; saveDraft(); startAnswering();
}

async function onSubmit() {
  const total = st.questions.length;
  const done = Object.keys(st.answers).length;
  const msg = done < total ? `還有 ${total - done} 題未作答，確定要交卷嗎？交卷後不能修改。` : '確定交卷？交卷後不能修改。';
  if (!confirm(msg)) return;
  const { F, db } = fb;
  try {
    await F.setDoc(F.doc(db, 'assignments', aid, 'submissions', uid), {
      uid, studentId: st.studentId, answers: st.answers, submittedAt: F.serverTimestamp(),
    });
    await showResult(st.answers);
  } catch (err) {
    console.error(err);
    alert('交卷失敗：練習可能已關閉，或網路中斷。作答進度已保存，請稍後再試。');
  }
}

async function showResult(answers) {
  const { F, db } = fb;
  const key = (await F.getDoc(F.doc(db, 'assignments', aid, 'reveal', 'key'))).data() || { items: [] };
  st.result = grade(st.questions, answers, key);
  st.keyPoints = key.keyPoints || [];
  if (!st.layout) st.layout = buildLayout(st.questions, uid);
  st.view = 'result'; draw(); window.scrollTo(0, 0);
  try { localStorage.removeItem(draftKey()); } catch { /* 略過 */ }
}

(async () => {
  if (!aid) return showFatal('網址缺少練習參數，請使用老師提供的連結或 QR code。');
  try { fb = await initFirebase(); } catch (e) { return showFatal(e.message); }
  const { A, F, auth, db } = fb;
  draw();
  try {
    if (!auth.currentUser) await A.signInAnonymously(auth);
    uid = auth.currentUser.uid;
    const snap = await F.getDoc(F.doc(db, 'assignments', aid));
    if (!snap.exists()) return showFatal('找不到這份練習，請確認連結是否正確。');
    assignment = snap.data();
    Object.assign(st, { title: assignment.title, total: assignment.total, testMode: !!assignment.testMode, questions: assignment.questions || [] });
    const sub = await F.getDoc(F.doc(db, 'assignments', aid, 'submissions', uid));
    if (sub.exists()) { st.studentId = sub.data().studentId; return showResult(sub.data().answers || {}); }
    if (assignment.status !== 'open') { st.view = 'closed'; return draw(); }
    const draft = loadDraft();
    if (draft?.studentId) { st.studentId = draft.studentId; st.answers = draft.answers || {}; return startAnswering(); }
    st.view = 'login'; draw();
  } catch (err) {
    console.error(err); showFatal('連線失敗，請確認網路後重新整理。');
  }
})();
