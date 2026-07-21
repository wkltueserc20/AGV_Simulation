## 緣由 (Why)

隨著同場 AGV 數量與障礙物數量增加，模擬器的前後端出現可觀測的效能瓶頸。經整體 review 後，發現問題集中在**「重複計算」與「單一全域鎖序列化」**兩個主軸：

- **前端**：`SimulatorCanvas` 的靜態快取層在每次收到遙測（約 30Hz）時都被標記失效，導致背景圖、網格點與所有障礙物**每秒被重畫 30 次**，快取形同虛設。
- **後端**：物理執行緒全程持有 `world_lock`，鎖內同時進行 shapely 碰撞檢查（無空間索引、對每個障礙物線性掃描）與**同步磁碟寫檔**；遙測快照每幀又把完整的 `path` 與 A* `visited`（可能上千節點）序列化廣播給每個連線。

本變更旨在消除上述重複計算與鎖內阻塞，在**不改變模擬行為**的前提下，顯著降低前端重繪成本、後端 CPU 佔用與 WebSocket 頻寬。

## 變更內容 (What Changes)

- **前端靜態層快取修正**：靜態層僅在障礙物 / 地圖尺寸 / 背景圖真正變動時失效，AGV 位置更新不再觸發整層重畫。
- **前端 render 穩定化**：`viewState` 改以 ref 讀取，避免每次平移重建 `render` callback 與重掛 `requestAnimationFrame`。
- **遙測負載精簡**：A* `visited` 僅在被選取的 AGV 傳送；`path` 進行抽樣，降低 JSON 序列化與前端解析成本。
- **後端碰撞查詢空間索引化**：以 `shapely.STRtree` 建立障礙物空間索引（於 costmap 更新時重建），`is_pose_safe` 只查詢鄰近障礙物，取代全障礙物線性掃描。
- **鎖外非同步存檔**：`save_obstacles` / `save_agvs` 改為「標記 dirty，於鎖外由背景執行緒 debounce 寫入」，移除物理迴圈內的同步磁碟 I/O。
- **規劃結果回收執行緒安全化**：`_on_planning_done` 對 AGV 狀態的變動改為在 `world_lock` 保護下進行（或經由 queue 交由物理執行緒消化），消除跨執行緒 race。
- **清理**：移除 `planner.py` 中對子行程無效的 `time.sleep(0)`；將 deprecated 的 `@app.on_event("startup")` 換為 `lifespan`。

## 能力模組 (Capabilities)

### 新增能力 (New Capabilities)
- `render-static-cache`: 前端靜態圖層快取的失效條件與重繪規則。
- `spatial-collision-index`: 後端以空間索引加速位姿安全檢查。
- `async-state-persistence`: 世界狀態的鎖外非同步持久化。

### 修改能力 (Modified Capabilities)
- `selective-replanning`: 規劃回呼 (`_on_planning_done`) 的狀態變動納入鎖保護，與既有選擇性重規劃邏輯相容。

## 影響範圍 (Impact)

- `frontend/src/SimulatorCanvas.tsx`: 靜態層失效條件、`viewState` ref 化、`visited`/`path` 繪製與資料量調整。
- `backend/main.py`: 遙測快照精簡、`lifespan` 生命週期、存檔改由背景執行緒觸發。
- `backend/world.py`: STRtree 建立與維護、dirty 標記式存檔、動態障礙快照。
- `backend/controller.py`: `is_pose_safe` 改用空間索引查詢。
- `backend/agv.py`: 規劃回呼鎖保護、每幀動態障礙重用、移除重複 list 串接。
- `backend/planner.py`: 移除無效的 `time.sleep(0)`。

## 非目標 (Non-Goals)

- 不改變 A* 演算法、避讓 / 讓路策略或運動學控制的**行為結果**。
- 不引入新的第三方相依（STRtree 由既有 shapely 提供）。
- 不重寫成 async physics engine 或改變執行緒模型的整體架構。
