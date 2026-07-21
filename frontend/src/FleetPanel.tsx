import type { AGVData } from './useSimulation';
import { formatSimTime } from './utils';

interface Props {
  agvs: AGVData[];
  selectedAgvId: string | null;
  onSelectAgv: (id: string) => void;
  sendCommand: (type: string, payload?: any) => void;
  canDeployAgv: boolean;
  addAgvMode: boolean;
  setAddAgvMode: (v: boolean) => void;
}

const statusColor = (status: string) =>
  status === 'EXECUTING' ? '#39ff14'
  : status === 'PLANNING' ? '#ffc107'
  : status === 'EVADING' ? '#bb86fc'
  : status === 'STUCK' ? '#ff4d4d'
  : '#8b949e';

function FleetPanel({ agvs, selectedAgvId, onSelectAgv, sendCommand, canDeployAgv, addAgvMode, setAddAgvMode }: Props) {
  return (
    <div className="section">
      <h3>Fleet Status ({agvs.length})</h3>
      <div className="fleet-list">
        {agvs.map(a => (
          <div key={a.id} className={`item-card ${selectedAgvId === a.id ? 'active' : ''}`} onClick={() => onSelectAgv(a.id)}>
            <div className="item-header">
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: 'bold' }}>{a.id} {a.has_goods ? '📦' : ''}</span>
                {a.is_running && a.current_travel_time !== undefined && (
                  <span style={{ fontSize: '10px', color: '#39ff14' }}>⏱️ {formatSimTime(a.current_travel_time)}</span>
                )}
              </div>
              <span style={{ fontSize: '10px', fontWeight: 'bold', color: statusColor(a.status) }}>
                {a.status}
              </span>
            </div>
            <div style={{ marginTop: '8px', display: 'flex', gap: '5px' }}>
              <button style={{ flex: 1, fontSize: '9px', padding: '4px 2px', background: '#30363d', color: '#c9d1d9', border: '1px solid #444' }} onClick={(e) => { e.stopPropagation(); sendCommand('force_idle', { target_id: a.id }); }}>FORCE IDLE</button>
              <button style={{ flex: 1, fontSize: '9px', padding: '4px 2px', background: '#30363d', color: '#c9d1d9', border: '1px solid #444' }} onClick={(e) => { e.stopPropagation(); sendCommand(a.is_running ? 'pause' : 'start', { target_id: a.id }); }}>{a.is_running ? 'PAUSE' : 'START'}</button>
            </div>
            {a.last_travel_time !== undefined && a.last_travel_time > 0 && (
              <div style={{ marginTop: '6px', fontSize: '9px', color: '#8b949e', borderTop: '1px solid #30363d', paddingTop: '4px' }}>
                上一次行走: {formatSimTime(a.last_travel_time)}
              </div>
            )}
          </div>
        ))}
      </div>
      {canDeployAgv && (
        <button className={`primary ${addAgvMode ? 'warning' : ''}`} style={{ width: '100%', marginTop: '10px' }} onClick={() => setAddAgvMode(!addAgvMode)}>
          {addAgvMode ? 'CANCEL' : '+ DEPLOY NEW AGV'}
        </button>
      )}
    </div>
  );
}

export default FleetPanel;
