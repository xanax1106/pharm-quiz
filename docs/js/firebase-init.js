// Firebase 初始化：連線設定放在 firebase-config.js（不進版控），此處不寫任何金鑰。
const V = '10.12.2';
const base = `https://www.gstatic.com/firebasejs/${V}`;

export async function initFirebase() {
  let cfg;
  try {
    cfg = (await import('../firebase-config.js')).firebaseConfig;
  } catch (e) {
    throw new Error('找不到 firebase-config.js，請確認檔案已上傳到 docs 資料夾。');
  }
  if (!cfg || !cfg.apiKey || String(cfg.apiKey).startsWith('請填入')) {
    throw new Error('firebase-config.js 尚未填入專案設定，請依 README 第 3 步完成。');
  }
  const [appMod, authMod, fsMod] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`),
  ]);
  const app = appMod.initializeApp(cfg);
  return { auth: authMod.getAuth(app), db: fsMod.getFirestore(app), A: authMod, F: fsMod };
}

export function showFatal(msg) {
  document.body.innerHTML = `<main style="max-width:36rem;margin:3rem auto;padding:1rem;font-family:sans-serif">
    <h1 style="font-size:1.3rem">系統尚未就緒</h1><p></p></main>`;
  document.querySelector('p').textContent = msg;
}
