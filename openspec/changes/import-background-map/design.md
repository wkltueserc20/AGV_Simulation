## 脈絡 (Context)

在現有代碼中，模擬器畫布大小被定義為虛擬的 `MAP_SIZE = 50000` (即 50,000 mm，相當於 50m)。編輯障礙物 (Obstacles) 時，Canvas 僅顯示邊框與網格。為了解決工業場景中地圖大小不一、難以對齊的問題，我們需要讓使用者能匯入圖檔，並手動定義真實世界的尺寸以進行等比例對齊與編輯。

## 目標與非目標 (Goals / Non-Goals)

**目標：**
- 支援匯入外部 PNG / JPG 廠房平面圖檔，並轉為 Base64。
- 使用者可自由輸入地圖真實物理尺寸（公尺，如 80.00m），支援「等比例鎖定」開關，寬高可自動轉換為虛擬世界毫米（mm）座標。
- 支援圖片的 X/Y 偏移（以公尺為顯示單位，內部換算為 mm）以及 0~360° 的旋轉。
- 提供透明度滑桿（0~100%），方便在編輯時隱約透出背景，而不干擾前景網格和障礙物的點擊。
- 支援 `localStorage` 持久化，重新整理網頁時地圖不遺失。
- 保持極佳的渲染效能，背景圖的重繪應局限在 `staticCanvasRef`（靜態快取層），不影響 AGV 動畫的動態幀率。

**非目標：**
- 將圖片上傳並儲存在後端（本階段完全在前端 `localStorage` 處理，避免後端架構複雜化，若圖片超出 `localStorage` 大小上限，可提醒使用者壓縮圖檔）。
- 更改後端的避障演算法與路徑規劃演算法。
- 更改現有 AGV 模擬器的物理模型。

## 設計決策 (Decisions)

### 1. 「公尺 (m) $\rightarrow$ 毫米 (mm)」的智慧尺寸轉換與比例鎖定
*   **決策**: UI 上一律呈現「公尺 (m)」作為尺寸、偏移量的填寫與調整單位，而前端底層則將其乘以 1000 轉換為「毫米 (mm)」以匹配畫布坐標。
*   **比例鎖定 (Aspect Ratio Lock)**: 
    *   預設開啟等比例鎖定。當使用者更動「真實寬度 $W$」時，系統讀取圖片的原始像素寬高（`naturalWidth` / `naturalHeight`），並公式化計算出對應高度：
        $$H_{\text{auto}} = W / ( \text{naturalWidth} / \text{naturalHeight} )$$
    *   使用者也可以選擇解鎖比例，進行拉伸調整。

### 2. 旋轉與平移的基準點 (Anchor/Pivot Point)
*   **決策**: 選擇以**「圖片中心點」**作為旋轉、平移與縮放的基準錨點（Anchor Point）。
*   **理據**: 相較於「左上角」，以「圖片中心點」為中心進行旋轉與縮放更符合人類的直覺。

### 3. 高效畫布渲染與轉換套用
*   **決策**: 在 `SimulatorCanvas.tsx` 中監聽 `bgImageSrc` 並非同步載入為 `HTMLImageElement`。在靜態緩存繪製函數 `updateStaticLayer` 中，使用 Canvas 的狀態堆疊（`save` 與 `restore`）套用矩陣變換：
    ```typescript
    const scale = (w / MAP_SIZE);
    const { cx, cy } = worldToCanvas(bgSettings.x, bgSettings.y, w, h, vs); // 換算中心點座標
    
    ctx.save();
    ctx.globalAlpha = bgSettings.opacity / 100;
    ctx.translate(cx, cy);
    ctx.rotate(-bgSettings.rotation * Math.PI / 180);
    
    const imgW = bgSettings.width * scale;
    const imgH = bgSettings.height * scale;
    
    // 將圖片中心點對齊 (cx, cy) 繪製
    ctx.drawImage(loadedImage, -imgW / 2, -imgH / 2, imgW, imgH);
    ctx.restore();
    ```

### 4. 前端參數持久化與極限卡控
*   **決策**: 儲存背景圖 Base64 及配置參數至 `localStorage`。為防 `localStorage` 超出 5MB 的瀏覽器限額，在圖片匯入時檢查檔案大小。如果大於 2MB，將跳出提示建議使用者進行壓縮或縮小尺寸，確保操作穩定性。

## 風險與權衡 (Risks / Trade-offs)

- **[風險] 瀏覽器 LocalStorage 空間限額**
  *   *權衡*: PNG 圖檔可能高達數 MB。若直接儲存 Base64，容易導致 `localStorage` 爆滿。我們在圖片匯入時進行容量警告（如大於 2MB 予以提示）。若未來使用者有更大圖檔需求，可升級為後端靜態檔案儲存方案。
- **[風險] 地圖旋轉時網格遮擋**
  *   *權衡*: 我們將背景地圖繪製在「網格」與「實體障礙物」的**最底層**。如此一來，白色的輔助網格線依然會精準覆蓋在廠房平面圖之上，大大方便使用者對齊。
