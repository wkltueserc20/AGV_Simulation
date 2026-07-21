# 多機差速 AGV 高精模擬器 (V9.0 Pro)

這是一個工業級的高精度多機 AGV (Automated Guided Vehicle) 模擬系統。採用 **Python FastAPI** 作為運算後端，配合 **React (TypeScript)** 作為可視化前端，實作了結合 **物理勢場 A*** 與 **Proactive One-Shot Evasion (主動式單次避讓)** 的先進導航架構。

![AGV Simulation](https://img.shields.io/badge/Version-9.0--Pro-green)
![Architecture](https://img.shields.io/badge/Architecture-Proactive--Evasion-orange)
![Performance](https://img.shields.io/badge/Performance-Zero--Latency-blue)

---

## 🚀 核心特色

### 1. 互動模式系統 (Multi-Mode Interaction)
- **職責隔離**：系統劃分為「選擇」、「單動」、「自動」、「建築」等模式，確保操作安全與專業性。
- **單動控制**：專屬的單動模式，透過滑鼠右鍵精確設定 AGV 導航目標點。
- **自動調度**：視覺化兩步式任務指派（起點 ➔ 終點），支援站點對站點、車對站點等複合物流邏輯。

### 2. 零延遲樂觀渲染 (Optimistic UI)
- **即時反應**：新增或刪除障礙物與設備時，UI 會立即更新而無需等待伺服器往返，消除網路卡頓感。
- **狀態同步**：具備後端自動校驗機制，確保本地暫存狀態與伺服器真實數據最終一致。

### 3. V9.5 狀態機強韌性 (Resilience)
- **自動重試機制 (Auto-Retry)**：當 AGV 遭遇暫時性阻塞（如被動態障礙物堵住路徑）而導致規劃失敗時，系統會自動進入 `BLOCKED` 狀態並進行最多 3 次、每次 2 秒的重試，大幅降低手動重設需求。
- **錯誤視覺化 (Status Feedback)**：新增 `BLOCKED` (🚧) 與 `ERROR` (❌) 狀態標記，操作員能直觀地區分「暫時阻塞」與「永久失敗」。

### 4. V8.5+ 主動意圖避讓架構
- **全路徑意圖廣播 (Intent Broadcast)**：每一台執行任務的車輛會將其「剩餘整條路徑」註冊到世界地圖中，讓其他車輛擁有「全知視角」。
- **單次觸發機制 (One-Shot Evasion)**：待命車一旦選定遠處安全點，便會鎖定狀態直到抵達，徹底消除震盪。

### 4. 高精度物理模擬 (Industrial Physics)
- **子步長積分 (Sub-stepping)**：確保即便在 30x 極速模擬下，也不會發生「穿牆」現象。
- **動態倍率同步**：支援 1x、10x、20x、30x 模擬加速。

---

## 🎮 操作說明 (Windows)

### 1. 互動模式切換 (Toolbar)
- **🔍 SELECT (選擇)**：純瀏覽模式。點擊物件查看參數，此模式下禁止任何修改與右鍵動作。
- **🖱️ SINGLE (單動)**：點選 AGV 後，「右鍵」點擊畫布設定導航目標位。其餘右鍵行為為「取消選取」。
- **🤖 AUTO (自動)**：執行物流任務指派。先點起點（有貨設備/車）再點終點。「右鍵」可重置選取狀態。
- **⭐ EQUIPMENT (設備)**：管理設備與 AGV。點擊空白處新增設備，側邊欄可部署新 AGV。
- **🧱 SQUARE / ⭕ CIRCLE (建築)**：管理障礙物。點擊空白處新增，雙擊物件可即時刪除。

### 2. 介面佈局
- **左側側邊欄**：系統全域控制（倍率、調測層）、車隊清單、選中物件設定（ID/座標/角度）、AGV 限制。
- **右側狀態列**：選中 AGV 的高頻遙測數據（RPM、速度、座標）、**任務隊列**（等待中任務）、**任務歷史**（已完成任務）。
- **提示訊息**：卡控與操作提示以右上角自動消失的 Toast 呈現（不阻塞畫面）；僅刪除背景圖等破壞性動作會保留確認彈窗。

### 3. 基本操作
- **啟動**：執行 `.\start.ps1` 一鍵啟動前後端。
- **平移地圖**：按住 `Alt + 左鍵` 或 `滑鼠中鍵` 拖拽畫布。
- **固定比例**：地圖採用固定比例顯示，確保工業看板級的視覺穩定性。

---

## 🧠 導航演算法：物理勢場 A*

1.  **物理平衡中心場**：利用 $1/dist^4$ 代價函數尋找幾何中線。
2.  **搜尋優化 (Tie-Breaking)**：消除座標大小偏見，使搜尋朝向目標「波束化」。
3.  **演算法視覺化**：具備「思考雲」重播功能，即時展示 A* 搜尋節點。

---

## 🧩 前端架構 (Frontend Architecture)

前端為 React 19 + TypeScript + Vite，透過單一 WebSocket (`ws://localhost:8000/ws`) 與後端通訊。畫面渲染使用 HTML5 Canvas 2D（雙層快取：靜態背景/障礙物層 + 每幀動態層），平移縮放以 ref 保存避免多餘重繪。

`frontend/src/` 元件拆分：

| 檔案 | 職責 |
|------|------|
| `App.tsx` | 根元件：全域狀態、指令派發、樂觀更新對帳、畫布事件處理 |
| `SimulatorCanvas.tsx` | Canvas 2D 渲染（AGV／路徑／障礙物／設備／社交連結） |
| `Toolbar.tsx` | 上方工具列：6 種互動模式、AGV 快速控制、連線狀態 |
| `FleetPanel.tsx` | 左側車隊清單（狀態色、行走計時、FORCE IDLE / START-PAUSE） |
| `SettingsPanel.tsx` | 選中障礙物／設備的參數編輯（ID／座標／角度／狀態／貨況） |
| `TelemetryPanel.tsx` | 右側遙測、任務隊列、任務歷史 |
| `BackgroundMapPanel.tsx` | 背景地圖匯入與對齊（尺寸／偏移／旋轉／透明度） |
| `toast.tsx` | 極簡非阻塞 Toast 通知 |
| `useSimulation.ts` | WebSocket hook 與資料型別（`AGVData` / `Obstacle` / `Task` / `Telemetry`） |
| `utils.ts` | 純函式（座標吸附、角度／時間格式化） |

### 開發指令

```bash
cd frontend
npm install
npm run dev      # 開發伺服器
npm run build    # tsc -b 型別檢查 + vite 打包
```
