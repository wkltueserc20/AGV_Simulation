## ADDED Requirements

### Requirement: 障礙物空間索引
系統 SHALL 於障礙物幾何快取 (`obstacle_geoms`) 更新時，一併建立 `shapely.STRtree` 空間索引與 geometry→id 對應，供位姿安全檢查以近鄰查詢取代全障礙物線性掃描。

#### Scenario: 障礙物變動後重建索引
- **WHEN** 系統執行 `update_obstacle_geoms`（新增 / 更新 / 移除 / 清空障礙物後）
- **THEN** STRtree SHALL 依最新靜態障礙物幾何重建
- **AND** geometry→id 對應 SHALL 同步更新

### Requirement: 以索引加速位姿安全檢查
`is_pose_safe` 對靜態障礙物 SHALL 先以 AGV 膨脹框對 STRtree `query()` 取得候選，僅對候選幾何執行 `.intersects()`；其判定結果 (safe 與 culprit id) SHALL 與全掃描版本等價。

#### Scenario: 遠離所有障礙物時快速通過
- **WHEN** AGV 位姿的膨脹框不與任何障礙物包圍盒相交
- **THEN** STRtree `query()` SHALL 回傳空候選集
- **AND** `is_pose_safe` SHALL 回傳 `(True, None)` 而不執行任何 `.intersects()`

#### Scenario: 與線性掃描結果等價
- **WHEN** 對同一組障礙物與位姿分別以索引版與全掃描版執行檢查
- **THEN** 兩者回傳的 safe 布林值 SHALL 相同
- **AND** 回傳的 culprit id SHALL 指向同一障礙物
