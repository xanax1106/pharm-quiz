// 投影畫面：需在已登入教師帳號的同一瀏覽器開啟（由控制台按鈕開啟）。
// 作答牆依教師設定顯示學號末 3 碼、只顯示顏色或不顯示；不顯示完整學號。可用鍵盤或簡報器翻頁鍵（→、PageDown、空白鍵）執行「下一步」。
import { initFirebase, showFatal } from './firebase-init.js';
import { renderScreen } from './views.js';
import { nextStep, runStep } from './flow.js';

const app = document.getElementById('app');
const sid = new URLSearchParams(location.search).get('sid');
const st = { status: 'lobby', joined: 0, answered: 0, counts: {} };
let fb, session = null, questions = [], keyPoints = [], answers = [], busy = false;
let people = new Map(); // uid -> studentId

function compute() {
  const i = session?.current ? session.current.index : -1;
  const cur = answers.filter((a) => a.qIndex === i);
  st.counts = { A: 0, B: 0, C: 0, D: 0 };
  cur.forEach((a) => { if (a.choice in st.counts) st.counts[a.choice]++; });
  st.answered = cur.length;
  // 作答牆：依座號／學號排序；last3 顯示末 3 碼（座號即為 3 碼），color 只顯示顏色
  const mine = new Map(cur.map((a) => [a.uid, a.choice]));
  st.tiles = [...people.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])))
    .map(([uid, id], k) => ({ label: st.wallMode === 'last3' ? String(id).slice(-3) : '', choice: mine.get(uid) || null }));
  if (session?.status === 'batch') {
    const total = session.total || 0;
    st.batchCounts = Array.from({ length: total }, (_, k) => answers.filter((a) => a.qIndex === k).length);
    const per = {};
    answers.forEach((a) => { per[a.uid] = (per[a.uid] || 0) + 1; });
    st.completed = Object.values(per).filter((n) => n >= total).length;
  }
}

function draw() {
  compute();
  app.innerHTML = renderScreen(st);
  const box = document.getElementById('qr');
  if (box && window.qrcode && st.joinUrl) {
    const qr = window.qrcode(0, 'M');
    qr.addData(st.joinUrl); qr.make();
    box.innerHTML = qr.createSvgTag({ cellSize: 8, margin: 0, scalable: true });
  }
}

async function advance() {
  if (busy || !session) return;
  const step = nextStep(session, questions.length, keyPoints.length);
  if (!step) return;
  if (step.act === 'end' && !confirm('確定結束本輪？')) return;
  busy = true;
  try { await runStep(step, { ...fb, sid, session, questions, keyPoints, answers }); }
  catch (e) { console.error(e); alert(`操作失敗：${e.code || e.message}`); }
  finally { busy = false; }
}

document.addEventListener('keydown', (e) => {
  if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); advance(); }
});

(async () => {
  if (!sid) return showFatal('網址缺少課堂參數，請從教師控制台的「開啟投影畫面」按鈕進入。');
  try { fb = await initFirebase(); } catch (e) { return showFatal(e.message); }
  const { A, F, auth, db } = fb;
  A.onAuthStateChanged(auth, async (user) => {
    if (!user || user.isAnonymous) return showFatal('請先在同一個瀏覽器登入教師控制台，再開啟投影畫面。');
    try {
      const priv = (await F.getDoc(F.doc(db, 'sessions', sid, 'private', 'key'))).data() || {};
      questions = priv.questions || []; keyPoints = priv.keyPoints || [];
    } catch (e) { return showFatal('無法讀取題目，請確認是以建立此課堂的教師帳號登入。'); }
    F.onSnapshot(F.collection(db, 'sessions', sid, 'participants'), (snap) => { st.joined = snap.size; people = new Map(snap.docs.map((d) => [d.id, d.data().studentId])); draw(); });
    F.onSnapshot(F.collection(db, 'sessions', sid, 'answers'), (snap) => { answers = snap.docs.map((d) => d.data()); draw(); });
    F.onSnapshot(F.doc(db, 'sessions', sid), (snap) => {
      if (!snap.exists()) return showFatal('找不到這堂課。');
      session = snap.data();
      Object.assign(st, {
        title: session.title, code: session.code, status: session.status, reveal: session.reveal || null, wallMode: session.wall || 'last3',
        joinUrl: new URL(`student.html?code=${session.code}${session.testMode ? '&t=1' : ''}`, location.href).href,
        batch: session.batch || [], summary: session.summary || [], keyPoints: session.keyPoints || [],
        question: session.current ? { ...session.current, total: session.total } : null,
      });
      draw();
    }, (err) => showFatal(`讀取失敗：${err.code || err.message}`));
  });
})();
