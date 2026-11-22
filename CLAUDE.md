# CLAUDE.md：課堂即時測驗系統（GitHub Pages 版）

## 專案目的
護理系藥理學課程（16 週、每週 3 節）使用的課堂即時測驗。學生掃 QR code、以「學號＋課堂代碼」加入；每輪約 5 題，支援「逐題公布」與「連續作答」兩種模式；每題統計 A–D 人數並公布答案、解析、重點；最後顯示本輪總結（依答對率排序）與重點整理；課後匯出成績。

## 技術架構
- 前端：純 HTML／CSS／JavaScript（ES modules），無建置步驟。
- 後端：Firebase Authentication（教師：電子郵件密碼；學生：匿名登入）＋ Cloud Firestore。
- 部署：GitHub Pages（儲存庫 `main` 分支的 `/docs` 為網站根目錄）；安全規則手動貼到 Firebase 主控台。
- 第三方程式庫固定版本並放在 `docs/js/vendor/`：qrcode-generator 1.4.4（MIT）、SheetJS xlsx 0.18.5。
- Firebase Web SDK 10.12.2 由 gstatic 載入（`js/firebase-init.js` 內的版本常數）。

## 目錄
```
firestore.rules      資料庫存取規則（安全性的核心，需手動貼到 Firebase 主控台發布）
docs/                GitHub Pages 網站根目錄
  index.html         入口
  student.html       學生端（手機，課堂測驗）
  assignment.html    課後練習（學生自行作答）
  teacher.html       教師控制台
  screen.html        投影畫面（需同瀏覽器已登入教師；支援簡報器翻頁鍵）
  firebase-config.js 連線設定（會公開，非密碼；靠規則與 API 金鑰網域限制保護）
  css/app.css
  js/views.js        純畫面函式（無 Firebase，可單獨測試）
  js/hwviews.js      課後練習畫面、題目亂序、計分（純函式）
  js/assignment.js   課後練習學生端
  js/flow.js         課堂流程狀態機（教師控制台與投影畫面共用）
  js/firebase-init.js / student.js / teacher.js / screen.js
  js/vendor/         固定版本第三方程式庫
tools/demo.html      以假資料預覽課堂測驗畫面（不在網站內）
tools/hwdemo.html    以假資料預覽課後練習畫面
```
題庫範本.xlsx 另行提供，不放入儲存庫。
`docs/img/` 為插圖庫（教師自繪 PNG，題庫「插圖」欄填檔名代號，僅允許英數、底線、連字號）。

## 題庫欄位
題號、章節、類別（本週／複習）、題目、選項A–D、答案、解析、重點、來源、錯誤說明A–D、插圖。後兩組為選填。

## 資料模型（Firestore）
| 路徑 | 內容 | 誰可讀寫 |
|---|---|---|
| `teachers/{uid}` | 教師名單（主控台手動建立） | 本人讀；程式不可寫 |
| `codes/{6碼}` | `{sid}` 課堂代碼對照 | 登入者讀；教師寫 |
| `sessions/{sid}` | `mode`、`status`、`wall`、`current`（目前題目，不含答案；含 `img` 插圖代號）、`batch`（連續作答時全部題目，不含答案）、`reveal`、`summary`、`keyPoints`、`answeringDone` | 登入者讀；建立者教師寫 |
| `sessions/{sid}/private/key` | `questions`（含答案、解析、重點、`why{A..D}` 各選項錯誤說明、`img`）、`keyPoints` | 僅建立者教師 |

公布答案時 `reveal = {answer, explanation, keyPoint, why}`；`why` 在公布前不會出現在學生可讀文件。
| `sessions/{sid}/participants/{uid}` | `{studentId, joinedAt}` | 學生寫自己；教師讀全部 |
| `sessions/{sid}/answers/{qIndex}_{uid}` | `{uid, studentId, qIndex, choice, answeredAt}` | 學生：逐題模式只能寫目前題目；連續作答模式可寫本輪任一題；教師讀全部 |

測試模式：`sessions/{sid}.testMode=true` 時，學生以暱稱（1–20 字）加入；加入連結帶 `&t=1`，代碼由連結自動帶入。正式上課前需確認是否保留此功能。

課後練習：
| 路徑 | 內容 | 誰可讀寫 |
|---|---|---|
| `assignments/{aid}` | 題目（不含答案）、`status`（open/closed）、`total`、`testMode` | 登入者讀；建立者教師寫 |
| `assignments/{aid}/reveal/key` | `items[{answer, explanation, keyPoint, source, why}]`、`keyPoints` | 教師；學生交卷後才可讀 |
| `assignments/{aid}/submissions/{uid}` | `{uid, studentId, answers{qIndex:原始字母}, submittedAt}` | 學生只能建立一次、不可修改；教師讀全部 |

題目與選項順序以學生 uid 為種子亂序（`hwviews.buildLayout`），答案一律以原始字母儲存。已交卷學生可把答案告訴他人，因屬練習不計分，可接受。

課堂狀態（見 `js/flow.js`）：
- 逐題公布：`lobby → question → closed → reveal → question … → summary → keypoints → ended`
- 連續作答：`lobby → batch → closed → reveal → closed … → summary → keypoints → ended`（`answeringDone=true`）
- `keypoints` 在題庫沒有「本輪重點」時略過。

## 必守規則
1. 不得在程式碼寫死任何金鑰、密碼或連線字串；Firebase 設定只放 `docs/firebase-config.js`。
2. 題庫 Excel、成績檔不得放入儲存庫（`.gitignore` 已排除 xlsx/xls/csv）。
3. 正確答案在公布前不得出現在學生可讀的文件中（只放 `private/key`）。
4. 學生以「座號」（1–3 位數字，系統補成 3 碼，例如 7 → 007）或學號登入；投影畫面的「全班作答牆」依課堂設定 `sessions.wall`：`last3`（學號末 3 碼與對錯，預設，使用者決定）、`color`（只顯示顏色）、`off`；完整學號只出現在教師控制台。
5. 不收集學生姓名；只存學號與作答。題目不得含病人可識別資料。
6. 修改資料結構時，必須同步修改 `firestore.rules` 並重新發布。
7. 介面文字使用繁體中文（臺灣）。
8. 儲存庫異動（上傳、commit、push）由使用者自行操作。

## 測試
- 畫面：在專案根目錄執行 `python3 -m http.server`，開 `/tools/demo.html?mode=screen&s=lobby|question|reveal|batch|summary|keypoints` 或 `?mode=student&s=login|question|reveal|batch|summary|keypoints`。
- 完整流程：建立測試用 Firebase 專案，教師一台電腦＋兩支手機實測。
- 規則：可用 Firebase 主控台「規則遊樂場」或 Emulator 測試。

## 已知限制
- SheetJS 0.18.5（npm 最後版本）有已公告的弱點，僅用於讀取教師自己上傳的題庫與匯出成績，風險有限；若需升級請改用 SheetJS 官方 CDN 的新版。
- 正式成績以教師匯出的 Excel 為準。
- 只支援單選題（A–D），不計時，由教師手動截止。

## 版本紀錄
- 2026-11：新增全班作答牆（末 3 碼／顏色／關閉）、各選項錯誤說明、插圖、講解建議、課後練習「下週開場建議」；完成第 1 週題庫。

## 後續可擴充
- 每題倒數計時、自動截止
- 學期累計成績（跨課堂彙整）
- 題庫依章節管理、重複使用
