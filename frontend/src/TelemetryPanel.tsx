import type { Telemetry, AGVData, Task } from './useSimulation';
import { radToDeg, formatSimTime } from './utils';

interface Props {
  telemetry: Telemetry | null;
  selectedAgv: AGVData | undefined;
  sendCommand: (type: string, payload?: any) => void;
}

function TelemetryPanel({ telemetry, selectedAgv, sendCommand }: Props) {
  return (
    <div className="sidebar right-wing">
      <h2>遙測 Telemetry</h2>
      {selectedAgv ? (
        <div className="section">
          <h3>狀態 · {selectedAgv.id}</h3>
          <div className="telemetry-grid">
            <div className="tele-item"><label>POS X</label><span>{Math.round(selectedAgv.x)}mm</span></div>
            <div className="tele-item"><label>POS Y</label><span>{Math.round(selectedAgv.y)}mm</span></div>
            <div className="tele-item"><label>HEAD</label><span>{radToDeg(selectedAgv.theta)}°</span></div>
            <div className="tele-item"><label>VEL</label><span>{Math.round(selectedAgv.v)}mm/s</span></div>
            <div className="tele-item"><label>L_RPM</label><span style={{ color: 'var(--accent-blue)' }}>{Math.round(selectedAgv.l_rpm)}</span></div>
            <div className="tele-item"><label>R_RPM</label><span style={{ color: 'var(--accent-green)' }}>{Math.round(selectedAgv.r_rpm)}</span></div>
          </div>
          <div className="item-card" style={{ marginTop: '20px' }}>
            <div style={{ fontSize: '11px', color: '#4a4a4a', marginBottom: '8px', fontWeight: 700 }}>目前目標 Active Target</div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#159947' }}>X: {selectedAgv.target.x} Y: {selectedAgv.target.y}</div>
          </div>
        </div>
      ) : <div className="empty-hint">點選一台 AGV 以檢視即時遙測數據</div>}

      <div className="section" style={{ borderTop: '2px solid #000', paddingTop: '15px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h3 style={{ margin: 0 }}>任務隊列 ({telemetry?.task_queue?.length || 0})</h3>
          {(telemetry?.task_queue?.length ?? 0) > 0 && <button style={{ fontSize: '9px', padding: '2px 6px', opacity: 0.6 }} onClick={() => sendCommand('clear_tasks', {})}>CLEAR</button>}
        </div>
        <div className="fleet-list">
          {telemetry?.task_queue?.length ? telemetry.task_queue.map((t: Task) => (
            <div key={t.id} className="item-card" style={{ padding: '10px', borderLeft: t.status === 'ASSIGNED' ? '3px solid #159947' : '3px solid #4a4a4a' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ fontSize: '11px', color: '#c9d1d9', fontWeight: 'bold' }}>{t.source_id || 'AGV'} ➔ {t.target_id || 'AGV'}</span>
                <button aria-label="移除任務" title="移除任務" style={{ background: 'transparent', border: 'none', boxShadow: 'none', color: '#D62828', cursor: 'pointer', padding: '0 4px', fontSize: '12px' }} onClick={(e) => { e.stopPropagation(); sendCommand('remove_task', { task_id: t.id }); }}>✕</button>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '9px', padding: '2px 6px', border: '2px solid #000', fontWeight: 700, background: t.status === 'ASSIGNED' ? '#A8E6CF' : '#FFFFFF', color: '#000' }}>{t.status}</span>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  {t.agv_id && <div style={{ fontSize: '9px', color: '#2E7DD1' }}>車輛: {t.agv_id}</div>}
                  {t.execution_time !== undefined && t.execution_time > 0 && (
                    <div style={{ fontSize: '9px', color: '#159947' }}>⏱️ {formatSimTime(t.execution_time)}</div>
                  )}
                </div>
              </div>
            </div>
          )) : <div style={{ textAlign: 'center', padding: '10px', color: '#4a4a4a', fontSize: '11px' }}>目前無等待中任務</div>}
        </div>
      </div>

      <div className="section" style={{ borderTop: '2px solid #000', paddingTop: '15px', marginTop: '10px' }}>
        <h3>任務歷史 ({telemetry?.task_history?.length || 0})</h3>
        <div className="fleet-list" style={{ maxHeight: '200px', overflowY: 'auto' }}>
          {telemetry?.task_history?.length ? telemetry.task_history.map((t: Task) => (
            <div key={t.id} className="item-card" style={{ padding: '8px', opacity: 0.8, marginBottom: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '10px', color: '#4a4a4a' }}>{t.source_id || 'AGV'} ➔ {t.target_id || 'AGV'}</span>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <span style={{ fontSize: '9px', color: '#159947', fontWeight: 'bold' }}>✓ DONE</span>
                  {t.execution_time !== undefined && (
                    <div style={{ fontSize: '8px', color: '#4a4a4a' }}>耗時: {formatSimTime(t.execution_time)}</div>
                  )}
                </div>
              </div>
              {t.agv_id && <div style={{ fontSize: '8px', color: '#2E7DD1', marginTop: '2px' }}>執行車輛: {t.agv_id}</div>}
            </div>
          )) : <div style={{ textAlign: 'center', padding: '10px', color: '#4a4a4a', fontSize: '11px' }}>暫無歷史紀錄</div>}
        </div>
      </div>
    </div>
  );
}

export default TelemetryPanel;
