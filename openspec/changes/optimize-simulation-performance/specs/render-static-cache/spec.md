## ADDED Requirements

### Requirement: 靜態圖層內容導向失效
前端 `SimulatorCanvas` 的靜態快取層 SHALL 僅在障礙物集合、地圖尺寸或背景地圖參數變動時標記為需重繪，AGV 位置或速度的更新 SHALL NOT 觸發靜態層重繪。

#### Scenario: AGV 移動不重畫靜態層
- **WHEN** 收到一筆遙測且其中僅 AGV 座標 / 速度改變、障礙物不變
- **THEN** `staticNeedsUpdate` SHALL 維持 `false`
- **AND** `updateStaticLayer` SHALL NOT 於該幀被呼叫

#### Scenario: 障礙物變動觸發重畫
- **WHEN** 遙測中障礙物的數量或任一障礙物的 id / 座標 / 型別 / 尺寸改變
- **THEN** `staticNeedsUpdate` SHALL 被設為 `true`
- **AND** 下一幀 `updateStaticLayer` SHALL 被呼叫一次

### Requirement: 平移不重建 render 迴圈
畫布平移 (`viewState` 變動) SHALL 透過 ref 讀取，`render` 的 `useCallback` SHALL NOT 依賴 `viewState`，以避免每次平移重建 render 並重掛 `requestAnimationFrame`。

#### Scenario: 拖曳平移期間 render 保持穩定
- **WHEN** 使用者持續拖曳平移畫布
- **THEN** `render` callback 的參考 SHALL 不因 `viewState` 改變而重建
- **AND** `requestAnimationFrame` 訂閱 SHALL 不被反覆取消與重掛
