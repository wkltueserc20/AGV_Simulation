import { useState } from 'react';
import { STATUS_META, LEGEND_KEYS } from './status';

// 狀態圖例：讓使用者看得懂畫布上 AGV 的狀態。預設收合，點標題展開。
function StatusLegend() {
  const [open, setOpen] = useState(false);
  return (
    <div className="section">
      <div
        className="collapsible-header"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setOpen(!open)}
      >
        <h3 style={{ margin: 0, border: 'none', padding: 0 }}>🏷️ 狀態圖例</h3>
        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div className="legend-grid">
          {LEGEND_KEYS.map(key => {
            const m = STATUS_META[key];
            return (
              <div key={key} className="legend-item">
                <span className="legend-dot" style={{ background: m.color }} />
                <span>{m.emoji} {m.zh}</span>
                <span className="legend-code">{key}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default StatusLegend;
