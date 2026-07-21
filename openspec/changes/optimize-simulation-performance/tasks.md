## 1. 前端：靜態層快取與 render 穩定化（高影響、低風險）

- [x] 1.1 將 telemetry 的無條件 `staticNeedsUpdate=true` 改為「障礙物指紋改變時」才觸發。
- [x] 1.2 以 `JSON.stringify(telemetry.obstacles)` 作指紋（不可能漏欄位），`lastObstacleFp` ref 比對。
- [x] 1.3 `viewState` 改以 `viewStateRef` 儲存並在 `render` 內讀取，從 `render` 的 `useCallback` 依賴陣列移除 `viewState`。
- [x] 1.4 驗證：型別檢查零新增錯誤；平移/選取/背景/縮放的既有重繪觸發保留。

## 2. 後端：遙測 payload 精簡（高影響、低風險、保守版）

> 決策：採**保守版**——不動前後端協定、不依賴「後端得知選取車」。僅對 `visited` / `path`
> 進行抽樣，維持等價行為（搜尋除錯圖為 debug 視覺，格子密度變疏不影響功能）。

- [x] 2.1 `AGV.to_dict` 對 `visited` 抽樣 `[::3]`。
- [x] 2.2 `path` 抽樣 `[::2]` 並保留終點（`len>2` 時）；runtime check 驗證終點保留、長度確實減半。
- [x] 2.3 驗證：runtime drive 確認 snapshot 正常序列化（full=51→sampled=27）；前端繪製欄位不變。

## 3. 後端：碰撞檢查空間索引化（中高影響）

- [x] 3.1 `world.update_obstacle_geoms` 一併建立 `STRtree` 與平行 `static_tree_ids`（index→id 反查）。
- [x] 3.2 `is_pose_safe` 以最大檢查框 `social_check_poly` 對 tree `query()` 取候選；靜態障礙不在候選即 `continue`，動態 AGV 不受過濾。既有迴圈本體零改動。
- [x] 3.3 margin / 設備放行 / ignore_id 語意完全保留（僅在既有邏輯前加一道保守過濾）。
- [x] 3.4 驗證：**4000 隨機場景**索引版 vs 線性版 `(safe, culprit)` 完全一致，零不符。

## 4. 後端：鎖外非同步存檔（中影響）

- [x] 4.1 `world` 新增 `_agvs_dirty` / `_obstacles_dirty` 旗標 + `mark_*_dirty()`；障礙物 CRUD 與指令 handler 改為只設旗標。
- [x] 4.2 新增 `disk_saver_thread`：鎖內快速 `json.dumps`、鎖外寫檔；AGV 沿用每 5s 落盤，障礙物僅 dirty 時寫。
- [x] 4.3 `agv.py` 裝卸貨轉態的 `world.save_obstacles()` 改為 `world.mark_obstacles_dirty()`（移除鎖內磁碟 I/O）。
- [x] 4.4 驗證：runtime drive 400+ ticks 無阻塞例外；boot test 確認 saver 執行緒啟動、序列化路徑正常。

## 5. 後端：規劃回呼執行緒安全化（DEFERRED — 需額外確認）

> 決策：**本次不做**。此項會使新路徑套用延後最多 1 幀（≤17ms），固定場景嚴格逐格比對
> 軌跡時將非 bit-identical；雖修掉一個既有的 callback 未持鎖 race，但方向牽涉時序，
> 保留待「不影響現有程式」以外的獨立評估後再執行。

- [ ] 5.1 (deferred) 將 `_on_planning_done` 結果改走 `world.planning_results` queue。
- [ ] 5.2 (deferred) 於 `physics_engine_thread` 鎖內消化並套用規劃結果。
- [ ] 5.3 (deferred) 驗證既有規劃 / 避讓 / BLOCKED 重試流程行為不變。

## 6. 後端：重複計算清理（低影響）

- [x] 6.1 `update()` 移動段開頭計算一次 `all_obs` 動態快照，該幀 replan/control/movement 三處共用（移除重複串接）。
- [x] 6.2 移除 `planner.py` 對子行程無效的 `time.sleep(0)`，並移除隨之閒置的 `import time`。
- [x] 6.3 `main.py` 改用 `@asynccontextmanager lifespan`，移除 deprecated `@app.on_event("startup")`。

## 7. 整體回歸與效能驗收

- [~] 7.1 既有 `test_dwa.py`（匯入不存在的 `dwa`）/ `test_priority.py`、`test_three_agvs.py`（需 `requests` 且打實時 server）**均為壞/過期測試**，無可用 baseline。改以下列替代驗證，非本次退化。
- [x] 7.2 行為等價：STRtree 4000 場景等價 self-check + guarded runtime drive（PLANNING→EXECUTING→移動 全流程無異常，BLOCKED 重試正確）。
- [ ] 7.3 效能量測（N=1/5/10 前後對照）：**未做**，留待實機部署時量測；本次以「零行為改變」為主要驗收標準。
