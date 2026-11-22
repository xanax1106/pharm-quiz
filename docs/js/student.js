// 學生端：座號（或學號）＋課堂代碼加入（測試模式：暱稱加入，代碼由 QR code 自動帶入） → 逐題或連續作答 → 看解析、本輪總結與重點整理
import { initFirebase, showFatal } from './firebase-init.js';
import { renderStudent } from './views.js';

const app = document.getElementById('app');
const params = new URLSearchParams(location.search);
const STORE = 'quiz-student';
const st = { view: 'loading', mine: {}, testMode: params.get('t') === '1', prefillCode: (params.get('code') || '').replace(/\D/g, '').slice(0, 6) };
let fb, uid, sid, unsubSession, total = 0;

const draw = () => {
  const y = window.scrollY;
  app.innerHTML = renderStudent(st);
  if (st.view === 'batch') window.scrollTo(0, y); // 連續作答時保持捲動位置
  bind();
};

function bind() {
  const form = document.getElementById('login-form');
  if (form) form.addEventListener('submit', onLogin);
  app.querySelectorAll('.choice:not([disabled])').forEach((b) => b.addEventListener('click', () => {
    const idx = b.dataset.q !== undefined ? Number(b.dataset.q) : st.question?.index;
    onChoose(idx, b.dataset.choice);
  }));
}

async function onLogin(e) {
  e.preventDefault();
  const raw = e.target.sid.value.trim();
  const studentId = st.testMode ? raw.replace(/\s+/g, ' ') : (/^\d{1,3}$/.test(raw) ? raw.padStart(3, '0') : raw.toUpperCase()); // 座號 1–3 位數字補成 3 碼
  const code = e.target.code.value.trim();
  st.prefillId = studentId; st.prefillCode = code;
  if (st.testMode) {
    if (studentId.length < 1 || studentId.length > 20) { st.error = '暱稱請輸入 1–20 個字'; return draw(); }
  } else if (!/^[A-Z0-9]{3,20}$/.test(studentId)) { st.error = '請輸入座號（1–3 位數字）或學號'; return draw(); }
  if (!/^\d{6}$/.test(code)) { st.error = '課堂代碼是 6 位數字'; return draw(); }
  st.error = ''; st.view = 'loading'; draw();
  try {
    const { A, F, auth, db } = fb;
    if (!auth.currentUser) await A.signInAnonymously(auth);
    uid = auth.currentUser.uid;
    const codeSnap = await F.getDoc(F.doc(db, 'codes', code));
    if (!codeSnap.exists()) { st.view = 'login'; st.error = '找不到這個課堂代碼，請確認投影幕上的數字'; return draw(); }
    sid = codeSnap.data().sid;
    await F.setDoc(F.doc(db, 'sessions', sid, 'participants', uid), { studentId, joinedAt: F.serverTimestamp() });
    st.studentId = studentId;
    sessionStorage.setItem(STORE, JSON.stringify({ sid, studentId, testMode: st.testMode }));
    listen();
  } catch (err) {
    console.error(err);
    st.view = 'login'; st.error = '連線失敗，請確認網路後再試一次';
    draw();
  }
}

async function onChoose(idx, choice) {
  if (idx === undefined || idx === null) return;
  if (!(st.view === 'question' || st.view === 'batch')) return;
  const prev = st.mine[idx];
  st.mine[idx] = choice;
  if (st.view === 'question') st.myChoice = choice;
  draw();
  try {
    const { F, db } = fb;
    await F.setDoc(F.doc(db, 'sessions', sid, 'answers', `${idx}_${uid}`), {
      uid, studentId: st.studentId, qIndex: idx, choice, answeredAt: F.serverTimestamp(),
    });
  } catch (err) {
    console.error(err);
    st.mine[idx] = prev;
    if (st.view === 'question') st.myChoice = prev;
    draw();
    alert('送出失敗：可能已經截止作答，或網路中斷。');
  }
}

async function loadMine(indexes) {
  const { F, db } = fb;
  await Promise.all(indexes.filter((i) => !(i in st.mine)).map(async (i) => {
    try {
      const snap = await F.getDoc(F.doc(db, 'sessions', sid, 'answers', `${i}_${uid}`));
      if (snap.exists()) st.mine[i] = snap.data().choice;
    } catch { /* 尚未作答 */ }
  }));
}

function listen() {
  const { F, db } = fb;
  if (unsubSession) unsubSession();
  unsubSession = F.onSnapshot(F.doc(db, 'sessions', sid), async (snap) => {
    if (!snap.exists()) { st.view = 'ended'; return draw(); }
    const s = snap.data();
    st.title = s.title; total = s.total || 0;
    const all = Array.from({ length: total }, (_, i) => i);
    switch (s.status) {
      case 'lobby': st.view = 'lobby'; break;
      case 'batch':
        st.batch = s.batch || [];
        await loadMine(all);
        st.view = 'batch'; break;
      case 'summary':
        await loadMine(all);
        st.summary = s.summary || []; st.view = 'summary'; break;
      case 'keypoints':
        st.keyPoints = s.keyPoints || []; st.view = 'keypoints'; break;
      case 'ended':
        st.view = 'ended'; sessionStorage.removeItem(STORE); break;
      default:
        if (s.current) {
          st.question = { ...s.current, total };
          await loadMine([s.current.index]);
          st.myChoice = st.mine[s.current.index] || null;
          st.view = s.status; // question | closed | reveal
          st.reveal = s.status === 'reveal' ? s.reveal : null;
        }
    }
    draw();
  }, (err) => { console.error(err); st.view = 'login'; st.error = '連線中斷，請重新加入'; draw(); });
}

(async () => {
  try { fb = await initFirebase(); } catch (e) { return showFatal(e.message); }
  const saved = JSON.parse(sessionStorage.getItem(STORE) || 'null');
  fb.A.onAuthStateChanged(fb.auth, (user) => {
    if (user && saved && !sid) { uid = user.uid; sid = saved.sid; st.studentId = saved.studentId; st.testMode = !!saved.testMode; st.view = 'loading'; draw(); listen(); }
    else if (!sid) { st.view = 'login'; draw(); }
  });
})();
