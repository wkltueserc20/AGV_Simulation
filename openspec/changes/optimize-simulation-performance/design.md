## 脈絡 (Context)

後端以單一 `physics_engine_thread` 在約 60Hz 迴圈驅動所有 AGV，迴圈全程持有 `world_lock`；`telemetry_broadcaster`（約 30Hz）與 `process_commands` 也搶同一把鎖。A* 規劃在 `ProcessPoolExecutor(4)` 的子行程執行，完成後由 future callback 直接回寫 AGV 狀態。前端以 `requestAnimationFrame` 迴圈繪製，並將靜態內容（背景圖、網格、障礙物）快取到離屏 canvas。

Review 發現的量測級瓶頸（依投報率排序）：

1. **靜態層快取每幀失效**（`SimulatorCanvas.tsx:93`）：`useEffect([telemetry])` 內設 `staticNeedsUpdate=true`，AGV 每次移動都連帶重畫整個靜態層。
2. **碰撞檢查無空間索引**（`controller.py:40-68`、`agv.py:335`）：`is_pose_safe` 對所有障礙物線性掃描 + shapely `.intersects()`，每台車每幀多次。
3. **遙測負載過重**（`agv.py:110-111`、`main.py:41`）：完整 `path` 與 A* `visited` 每 30Hz 廣播給每個連線。
4. **鎖內同步存檔**（`agv.py:259,276`、`main.py:216,237`）：`update()` 內 `save_obstacles()` 在 `world_lock` 下做磁碟 I/O。
5. **規劃回呼未持鎖**（`agv.py:119-163`）：跨執行緒改 AGV 狀態，潛在 race。
6. **render callback 不穩定 + 重複 list 串接**（`SimulatorCanvas.tsx:469`、`agv.py:283,306,333`）。

## 目標與非目標 (Goals / Non-Goals)

**目標：**
- 消除前端不必要的整層重繪與 callback 重建。
- 後端碰撞檢查由 O(障礙物數) 降為近鄰查詢。
- 降低 WebSocket 每幀 payload。
- 移除物理迴圈內的磁碟阻塞與跨執行緒 race。
- **行為完全等價**：優化前後模擬結果一致。

**非目標：**
- 不改動 A* / 避讓 / 控制律的邏輯。
- 不變更執行緒模型或改寫為 async。
- 不新增外部相依。

## 關鍵決策 (Key Decisions)

### 1. 前端靜態層失效改為內容導向
以障礙物 + 地圖尺寸 + 背景參數計算輕量指紋（例如 `obstacles.length` 加各 id/x/y/type 的雜湊字串），僅在指紋改變時 `staticNeedsUpdate=true`。AGV 位置更新不觸發。
- **取捨**：指紋計算 O(障礙物數) 但每幀僅一次且遠小於整層重繪；障礙物數量級遠小於重繪像素數。

### 2. 後端 STRtree 空間索引
於 `update_static_costmap` / 障礙物變動時，一併重建 `shapely.STRtree`（靜態障礙物幾何已快取在 `obstacle_geoms`）。`is_pose_safe` 先以 AGV 膨脹框 `query()` 取候選，再對候選做 `.intersects()`。動態障礙（其他 AGV）數量少，維持線性掃描即可。
- **取捨**：STRtree 為不可變結構，障礙物變動時整棵重建；但障礙物變動頻率低（使用者編輯時），可接受。

### 3. 遙測 payload 精簡
- `visited`：`get_snapshot` 只對 `selected_agv_id`（由前端經指令或連線參數告知，或後端全部改為不主動送、改由前端請求）輸出；其餘 AGV 送空陣列。最省事作法：`to_dict(include_visited=False)`，另在 snapshot 針對被選車補上。
- `path`：抽樣（如 `[::2]`）後輸出，前端本已對 `path_occupancy` 抽樣繪製。
- **取捨**：搜尋視覺化僅對單一被選車有意義，符合現有 UI；抽樣後路徑線視覺無感差異。

### 4. 鎖外 debounce 存檔
`world` 增設 `_agvs_dirty` / `_obstacles_dirty` 旗標與一個背景 saver 執行緒（或於 `telemetry_broadcaster` 尾端、鎖外檢查旗標後寫檔）。physics 迴圈只設旗標、不碰磁碟。
- **取捨**：崩潰瞬間最多遺失數百毫秒狀態，對模擬器可接受（原本每 5s 存檔已有同等級容忍）。

### 5. 規劃回呼鎖保護
`_on_planning_done` 內對 `self.global_path/status/target/...` 的寫入包在 `with world.world_lock:`（需將 lock 傳入或掛在 world 上供 AGV 取用）。或改為 callback 只把結果 `put` 進 `world.planning_results` queue，由 physics 迴圈在鎖內 `apply`。後者與現有執行緒模型更一致。
- **傾向**：採 queue 回收，避免 callback 執行緒直接觸鎖造成的鎖競爭尖峰。

### 6. render 穩定化
`viewState` 以 `viewStateRef` 儲存，`render` 從 ref 讀取，`useCallback` 依賴陣列移除 `viewState`，避免平移時每幀重建與 rAF 重掛。

## 風險與驗證 (Risks / Verification)

- **風險**：STRtree 候選查詢遺漏膨脹邊界 → 以「膨脹後的 AGV 框」作為 query 範圍，並保留原 margin 邏輯做最終 `.intersects()`，確保不放過碰撞。
- **風險**：queue 回收造成規劃結果延遲一幀套用 → 影響 < 17ms，肉眼不可辨。
- **驗證方式**：
  - 行為等價：固定亂數種子/固定場景，比對優化前後 AGV 軌跡與任務完成序列一致。
  - 效能：以 N=1/5/10 台 AGV + M 障礙物，量測物理迴圈單圈耗時、廣播 payload 大小、前端 FPS。
  - 回歸：既有 `test_dwa.py` / `test_priority.py` / `test_three_agvs.py` 全數通過。
