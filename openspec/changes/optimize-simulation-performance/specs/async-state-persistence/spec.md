## ADDED Requirements

### Requirement: 鎖外非同步存檔
世界狀態 (`agvs.json` / `obstacles.json`) 的持久化 SHALL 以 dirty 旗標標記，實際磁碟寫入 SHALL 於 `world_lock` 之外由背景流程 debounce 執行；物理更新迴圈 SHALL NOT 於持鎖期間執行同步磁碟寫入。

#### Scenario: 裝卸貨轉態不阻塞物理迴圈
- **WHEN** AGV 於 `update()` 中完成 LOADING / UNLOADING 並更新設備 `has_goods`
- **THEN** 系統 SHALL 僅設定 `_obstacles_dirty = true`
- **AND** SHALL NOT 於該 `update()` 呼叫內直接執行磁碟寫入

#### Scenario: 背景流程實際落盤
- **WHEN** `_agvs_dirty` 或 `_obstacles_dirty` 為 `true`
- **AND** 背景存檔流程於鎖外執行
- **THEN** 對應檔案 SHALL 被寫入且該旗標 SHALL 被清除
