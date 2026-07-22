import type { AGVData } from './useSimulation';
import { formatSimTime } from './utils';
import { statusColor } from './status';

interface Props {
  agvs: AGVData[];
  selectedAgvId: string | null;
  onSelectAgv: (id: string) => void;
  sendCommand: (type: string, payload?: any) => void;
  canDeployAgv: boolean;
  addAgvMode: boolean;
  setAddAgvMode: (v: boolean) => void;
}

function FleetPanel({ agvs, selectedAgvId, onSelectAgv, sendCommand, canDeployAgv, addAgvMode, setAddAgvMode }: Props) {
  return (
    <div className="section">
      <h3>車隊狀態 Fleet ({agvs.length})</h3>
      <div className="fleet-list">
        {agvs.length === 0 ? (
          <div className="empty-hint">
            尚無 AGV。<br />切到 <b>⭐ 設備</b>模式，按下方「部署」再點畫布空白處放置第一台。
          </div>
        ) : agvs.map(a => (
          <div key={a.id} className={`item-card ${selectedAgvId === a.id ? 'active' : ''}`} onClick={() => onSelectAgv(a.id)}>
            <div className="item-header">
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: 'bold' }}>{a.id} {a.has_goods ? '📦' : ''}</span>
                {a.is_running && a.current_travel_time !== undefined && (
                  <span style={{ fontSize: '10px', fontWeight: 700, color: '#159947' }}>⏱️ {formatSimTime(a.current_travel_time)}</span>
                )}
              </div>
              <span style={{ fontSize: '10px', fontWeight: 'bold', color: statusColor(a.status) }}>
                {a.status}
              </span>
            </div>
            <div style={{ marginTop: '8px', display: 'flex', gap: '5px' }}>
              <button title="強制回到待命狀態" className="warning" style={{ flex: 1, fontSize: '9px', padding: '4px 2px' }} onClick={(e) => { e.stopPropagation(); sendCommand('force_idle', { target_id: a.id }); }}>強制待命</button>
              <button className="primary" style={{ flex: 1, fontSize: '9px', padding: '4px 2px' }} onClick={(e) => { e.stopPropagation(); sendCommand(a.is_running ? 'pause' : 'start', { target_id: a.id }); }}>{a.is_running ? '暫停' : '啟動'}</button>
            </div>
            {a.last_travel_time !== undefined && a.last_travel_time > 0 && (
              <div style={{ marginTop: '6px', fontSize: '9px', color: '#4a4a4a', borderTop: '2px solid #000', paddingTop: '4px' }}>
                上一次行走: {formatSimTime(a.last_travel_time)}
              </div>
            )}
          </div>
        ))}
      </div>
      {canDeployAgv && (
        <button className={`primary ${addAgvMode ? 'warning' : ''}`} style={{ width: '100%', marginTop: '10px' }} onClick={() => setAddAgvMode(!addAgvMode)}>
          {addAgvMode ? '取消部署 CANCEL' : '+ 部署新 AGV'}
        </button>
      )}
    </div>
  );
}

export default FleetPanel;
