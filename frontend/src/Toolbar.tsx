import type { AGVData } from './useSimulation';

export type ToolMode = 'SELECT' | 'SINGLE_ACTION' | 'BUILD_SQ' | 'BUILD_CIR' | 'BUILD_STAR' | 'AUTO';

interface Props {
  activeTool: ToolMode;
  setActiveTool: (t: ToolMode) => void;
  selectedAgv: AGVData | undefined;
  selectedAgvId: string | null;
  isConnected: boolean;
  sendCommand: (type: string, payload?: any) => void;
}

const MODES: { key: ToolMode; label: string }[] = [
  { key: 'SELECT', label: '🔍 SELECT' },
  { key: 'SINGLE_ACTION', label: '🖱️ SINGLE' },
  { key: 'AUTO', label: '🤖 AUTO' },
  { key: 'BUILD_STAR', label: '⭐ EQUIPMENT' },
  { key: 'BUILD_SQ', label: '🧱 SQUARE' },
  { key: 'BUILD_CIR', label: '⭕ CIRCLE' },
];

function Toolbar({ activeTool, setActiveTool, selectedAgv, selectedAgvId, isConnected, sendCommand }: Props) {
  return (
    <div className="toolbar-container">
      <div className="toolbar-left">
        {MODES.map(m => (
          <button
            key={m.key}
            className={activeTool === m.key ? 'active' : ''}
            aria-pressed={activeTool === m.key}
            onClick={() => setActiveTool(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="toolbar-center">
        {selectedAgv && (
          <div className="agv-quick-controls">
            {!selectedAgv.is_running
              ? <button className="primary" onClick={() => sendCommand('start', { agv_id: selectedAgvId })}>▶ START</button>
              : <button className="warning" onClick={() => sendCommand('pause', { agv_id: selectedAgvId })}>⏸ PAUSE</button>}
            <button className="danger" onClick={() => sendCommand('reset', { agv_id: selectedAgvId })}>🔄 RESET</button>
          </div>
        )}
      </div>
      <div className="toolbar-right">
        <div className={`status-badge ${isConnected ? 'online' : 'offline'}`} style={{ border: 'none', background: 'transparent' }}>{isConnected ? 'SIGNAL OK' : 'NO SIGNAL'}</div>
      </div>
    </div>
  );
}

export default Toolbar;
