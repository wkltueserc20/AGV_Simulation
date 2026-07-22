import React from 'react';
import { toast } from './toast';

export interface BackgroundSettings {
  visible: boolean;
  locked: boolean;
  opacity: number;
  width: number;       // 公尺 (m)
  height: number;      // 公尺 (m)
  aspectRatio: number; // 圖片原始比例 w/h
  x: number;           // mm
  y: number;           // mm
  rotation: number;    // 度
  aspectRatioLocked: boolean;
}

interface Props {
  bgImageSrc: string | null;
  setBgImageSrc: (src: string | null) => void;
  bgSettings: BackgroundSettings;
  setBgSettings: React.Dispatch<React.SetStateAction<BackgroundSettings>>;
  bgPanelOpen: boolean;
  setBgPanelOpen: (open: boolean) => void;
  mapW: number;
  mapH: number;
}

function BackgroundMapPanel({
  bgImageSrc, setBgImageSrc, bgSettings, setBgSettings, bgPanelOpen, setBgPanelOpen, mapW, mapH,
}: Props) {
  // 背景圖上傳處理
  const handleBgImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2.5 * 1024 * 1024) {
      toast("⚠️ 圖檔較大，可能會使網頁讀取變慢。建議使用小於 2MB 的圖片。", 'info');
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const ratio = img.naturalWidth / img.naturalHeight;
        setBgImageSrc(base64);
        setBgSettings(prev => {
          const newWidth = prev.width;
          const newHeight = prev.aspectRatioLocked ? Math.round((newWidth / ratio) * 100) / 100 : prev.height;
          return {
            ...prev,
            aspectRatio: ratio,
            height: newHeight,
            // 上傳新圖時，自動將地圖中心點座標初始化為置中
            x: (newWidth * 1000) / 2,
            y: (newHeight * 1000) / 2,
            rotation: 0,
            visible: true
          };
        });

        try {
          localStorage.setItem('agv_bg_image', base64);
        } catch {
          toast("❌ 儲存失敗：圖檔大小超出瀏覽器儲存上限 (約5MB)。請使用經壓縮後的圖片。", 'error');
        }
      };
      img.src = base64;
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="section" style={{ borderTop: '2px solid #000', paddingTop: '15px' }}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setBgPanelOpen(!bgPanelOpen)}
      >
        <h3 style={{ margin: 0, border: 'none', padding: 0 }}>🗺️ 背景地圖配置</h3>
        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{bgPanelOpen ? '▲' : '▼'}</span>
      </div>

      {bgPanelOpen && (
        <div className="bg-map-panel">
          {/* 匯入/更換地圖按鈕 */}
          <div style={{ marginBottom: '12px' }}>
            <input
              type="file"
              id="bg-map-file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleBgImageUpload}
            />
            <label htmlFor="bg-map-file" className="bg-upload-label">
              📂 {bgImageSrc ? '更換地圖背景' : '匯入地圖圖檔'}
            </label>
          </div>

          {/* 操作小提示 */}
          <div style={{ fontSize: '10px', color: '#000', background: 'var(--accent-yellow)', padding: '8px 10px', borderRadius: 0, marginBottom: '10px', lineHeight: '1.5', fontWeight: 600, border: '2px solid #000' }}>
            💡 <b>操作小提示</b>：<br/>
            • <b>畫布縮放</b>：滾動 [滑鼠滾輪] (以游標為中心)<br/>
            • <b>地圖平移</b>：按住 [滑鼠右鍵] 或 [滾輪中鍵] 拖曳<br/>
            • <b>重設視角</b>：點擊畫布右下角 [RESET VIEW]
          </div>

          {bgImageSrc && (
            <>
              {/* 顯示與參數鎖定開關 */}
              <div className="bg-switch-row">
                <div className="bg-switch-label">👁️ 顯示地圖背景</div>
                <button
                  className={`bg-switch-btn ${bgSettings.visible ? 'active' : ''}`}
                  onClick={() => setBgSettings(prev => ({ ...prev, visible: !prev.visible }))}
                >
                  {bgSettings.visible ? 'ON' : 'OFF'}
                </button>
              </div>

              <div className="bg-switch-row">
                <div className="bg-switch-label">🔒 鎖定對齊參數</div>
                <button
                  className={`bg-switch-btn ${bgSettings.locked ? 'active' : ''}`}
                  onClick={() => setBgSettings(prev => ({ ...prev, locked: !prev.locked }))}
                >
                  {bgSettings.locked ? 'LOCKED' : 'UNLOCKED'}
                </button>
              </div>

              {/* 📏 真實物理尺寸區 */}
              <div className="bg-panel-sub">
                <div className="bg-panel-sub-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span>📏 真實尺寸</span>
                  <button
                    className={`bg-aspect-ratio-toggle ${bgSettings.aspectRatioLocked ? 'locked' : ''}`}
                    style={{ fontSize: '9px', padding: '0 4px', border: 'none', background: 'transparent' }}
                    onClick={() => !bgSettings.locked && setBgSettings(prev => ({ ...prev, aspectRatioLocked: !prev.aspectRatioLocked }))}
                    title="鎖定寬高比例"
                  >
                    {bgSettings.aspectRatioLocked ? '🔒 比例鎖定' : '🔓 自由拉伸'}
                  </button>
                </div>

                <div className="bg-input-grid">
                  <div className="bg-input-item">
                    <label>寬度 (Width)</label>
                    <div className="bg-input-wrapper">
                      <input
                        type="number"
                        disabled={bgSettings.locked}
                        min="1" max="1000" step="0.5"
                        value={bgSettings.width}
                        onChange={(e) => {
                          const val = Math.max(1, parseFloat(e.target.value) || 0);
                          setBgSettings(prev => ({
                            ...prev,
                            width: val,
                            height: prev.aspectRatioLocked ? Math.round((val / prev.aspectRatio) * 100) / 100 : prev.height
                          }));
                        }}
                      />
                      <span className="bg-input-unit">m</span>
                    </div>
                  </div>
                  <div className="bg-input-item">
                    <label>高度 (Height)</label>
                    <div className="bg-input-wrapper">
                      <input
                        type="number"
                        disabled={bgSettings.locked || bgSettings.aspectRatioLocked}
                        min="1" max="1000" step="0.5"
                        value={bgSettings.height}
                        onChange={(e) => {
                          const val = Math.max(1, parseFloat(e.target.value) || 0);
                          setBgSettings(prev => ({ ...prev, height: val }));
                        }}
                      />
                      <span className="bg-input-unit">m</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 📍 偏移與旋轉微調 */}
              <div className="bg-panel-sub">
                <div className="bg-panel-sub-title">📍 偏移與旋轉</div>

                {/* 偏移 X */}
                <div className="bg-slider-item">
                  <div className="bg-slider-header">
                    <span>偏移 X (m)</span>
                    <span className="bg-slider-val">{(bgSettings.x / 1000 - mapW / 2000).toFixed(1)}m</span>
                  </div>
                  <input
                    type="range"
                    disabled={bgSettings.locked}
                    min="0" max={mapW} step="100"
                    value={bgSettings.x}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setBgSettings(prev => ({ ...prev, x: val }));
                    }}
                    className="bg-slider"
                  />
                </div>

                {/* 偏移 Y */}
                <div className="bg-slider-item">
                  <div className="bg-slider-header">
                    <span>偏移 Y (m)</span>
                    <span className="bg-slider-val">{(bgSettings.y / 1000 - mapH / 2000).toFixed(1)}m</span>
                  </div>
                  <input
                    type="range"
                    disabled={bgSettings.locked}
                    min="0" max={mapH} step="100"
                    value={bgSettings.y}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setBgSettings(prev => ({ ...prev, y: val }));
                    }}
                    className="bg-slider"
                  />
                </div>

                {/* 旋轉 */}
                <div className="bg-slider-item">
                  <div className="bg-slider-header">
                    <span>旋轉角度</span>
                    <span className="bg-slider-val">{bgSettings.rotation}°</span>
                  </div>
                  <input
                    type="range"
                    disabled={bgSettings.locked}
                    min="0" max="359" step="1"
                    value={bgSettings.rotation}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setBgSettings(prev => ({ ...prev, rotation: val }));
                    }}
                    className="bg-slider"
                  />
                </div>
              </div>

              {/* 🔆 透明度 */}
              <div className="bg-slider-item" style={{ padding: '0 4px', marginBottom: '12px' }}>
                <div className="bg-slider-header">
                  <span>🔆 透明度</span>
                  <span className="bg-slider-val">{bgSettings.opacity}%</span>
                </div>
                <input
                  type="range"
                  min="0" max="100" step="5"
                  value={bgSettings.opacity}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    setBgSettings(prev => ({ ...prev, opacity: val }));
                  }}
                  className="bg-slider"
                />
              </div>

              {/* ⚡ 快速定位按鈕組 */}
              <div className="bg-panel-sub" style={{ padding: '8px' }}>
                <div className="bg-panel-sub-title" style={{ marginBottom: '6px' }}>⚡ 快速定位</div>
                <div className="bg-btn-grid">
                  <button
                    disabled={bgSettings.locked}
                    className="bg-btn-quick"
                    onClick={() => setBgSettings(prev => ({ ...prev, x: prev.width * 500, y: prev.height * 500 }))}
                    title="將背景地圖左下角精準貼齊畫布原點 (0,0)"
                  >
                    原點 (0,0)
                  </button>
                  <button
                    disabled={bgSettings.locked}
                    className="bg-btn-quick"
                    onClick={() => setBgSettings(prev => ({ ...prev, x: mapW / 2, y: mapH / 2 }))}
                    title="將地圖中心居中對齊模擬器中心"
                  >
                    畫布置中
                  </button>
                  <button
                    disabled={bgSettings.locked}
                    className="bg-btn-quick"
                    style={{ color: 'var(--accent-red)' }}
                    onClick={() => {
                      if (window.confirm("確定要重設為預設對齊參數嗎？")) {
                        setBgSettings(prev => {
                          const newHeight = Math.round((50 / prev.aspectRatio) * 100) / 100;
                          return {
                            ...prev,
                            width: 50,
                            height: newHeight,
                            x: 50 * 1000 / 2,
                            y: newHeight * 1000 / 2,
                            rotation: 0,
                            opacity: 40,
                            aspectRatioLocked: true,
                          };
                        });
                      }
                    }}
                  >
                    重設對齊
                  </button>
                </div>
              </div>

              {/* 🗑️ 移除背景地圖 */}
              <button
                className="danger"
                style={{ width: '100%', marginTop: '10px', fontSize: '11px', padding: '6px' }}
                onClick={() => {
                  if (window.confirm("確定要完全移除地圖背景圖嗎？")) {
                    setBgImageSrc(null);
                    localStorage.removeItem('agv_bg_image');
                  }
                }}
              >
                🗑️ 移除背景地圖
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default BackgroundMapPanel;
