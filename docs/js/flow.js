// 課堂流程：依目前狀態決定「下一步」，教師控制台與投影畫面（簡報器）共用。
// 狀態：lobby → [逐題] question → closed → reveal → … | [連續] batch → closed → reveal → closed → …
//       → summary（本輪總結）→ keypoints（重點整理，可省略）→ ended
import { LETTERS } from './views.js';

const pub = (q, i) => ({ index: i, text: q.text, options: q.options, chapter: q.chapter || '', img: q.img || '' });

export function nextStep(s, total, kpCount) {
  if (!s) return null;
  const i = s.current ? s.current.index : -1;
  const last = i >= total - 1;
  switch (s.status) {
    case 'lobby':
      return s.mode === 'batch'
        ? { act: 'startBatch', label: `開始作答（全部 ${total} 題）` }
        : { act: 'startQ', i: 0, label: '開始第 1 題' };
    case 'question': return { act: 'close', label: '截止作答' };
    case 'batch': return { act: 'closeBatch', label: '截止作答，開始逐題檢討' };
    case 'closed': return { act: 'reveal', label: '公布答案與解析' };
    case 'reveal':
      if (!last) {
        return s.answeringDone
          ? { act: 'reviewQ', i: i + 1, label: `檢討第 ${i + 2} 題` }
          : { act: 'startQ', i: i + 1, label: `下一題（第 ${i + 2} 題）` };
      }
      return { act: 'summary', label: '顯示本輪總結' };
    case 'summary': return kpCount ? { act: 'keypoints', label: '顯示重點整理' } : { act: 'end', label: '結束本輪' };
    case 'keypoints': return { act: 'end', label: '結束本輪' };
    default: return null;
  }
}

export function buildSummary(questions, answers) {
  return questions.map((q, i) => {
    const list = answers.filter((a) => a.qIndex === i);
    const counts = Object.fromEntries(LETTERS.map((l) => [l, list.filter((a) => a.choice === l).length]));
    const n = list.length;
    return { index: i, text: q.text, answer: q.answer, counts, n, rate: n ? Math.round((counts[q.answer] / n) * 100) : 0 };
  });
}

// ctx: { F, db, sid, session, questions, keyPoints, answers }
export async function runStep(step, ctx) {
  const { F, db, sid, questions } = ctx;
  const ref = F.doc(db, 'sessions', sid);
  const upd = (patch) => F.updateDoc(ref, patch);
  switch (step.act) {
    case 'startQ': return upd({ status: 'question', reveal: null, current: pub(questions[step.i], step.i) });
    case 'startBatch': return upd({ status: 'batch', reveal: null, current: null, batch: questions.map(pub) });
    case 'close': return upd({ status: 'closed' });
    case 'closeBatch': return upd({ status: 'closed', answeringDone: true, batch: null, reveal: null, current: pub(questions[0], 0) });
    case 'reviewQ': return upd({ status: 'closed', reveal: null, current: pub(questions[step.i], step.i) });
    case 'reveal': {
      const q = questions[ctx.session.current.index];
      return upd({ status: 'reveal', reveal: { answer: q.answer, explanation: q.explanation || '', keyPoint: q.keyPoint || '', why: q.why || {} } });
    }
    case 'summary': return upd({ status: 'summary', summary: buildSummary(questions, ctx.answers) });
    case 'keypoints': return upd({ status: 'keypoints', keyPoints: ctx.keyPoints || [] });
    case 'end':
      await upd({ status: 'ended' });
      try { await F.deleteDoc(F.doc(db, 'codes', ctx.session.code)); } catch (e) { console.error(e); }
      return;
  }
}
