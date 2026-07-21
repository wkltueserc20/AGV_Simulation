import type { AGVData } from './useSimulation';

export type ToolMode = 'SELECT' | 'SINGLE_ACTION' | 'BUILD_SQ' | 'BUILD_CIR' | 'BUILD_STAR' | 'AUTO';

interface Props {
  activeTool: ToolMode;
  setActiveTool: (t: ToolMode) => void;
  selectedAgv: AGVData | undefined;
  selectedAgvId: string | null;
  isConnected: boolean;
  sendCommand: (type: string, payload?: any) => void;
  onShowHelp: () => void;
}

const MODES: { key: ToolMode; icon: string; en: string; zh: string; hint: string }[] = [
  { key: 'SELECT',        icon: '🔍', en: 'SELECT',    zh: '選擇', hint: '純瀏覽：點物件看參數，不會誤改' },
  { key: 'SINGLE_ACTION', icon: '🖱️', en: 'SINGLE',    zh: '單動', hint: '點 AGV 後右鍵畫布設定導航目標點' },
  { key: 'AUTO',          icon: '🤖', en: 'AUTO',      zh: '自動', hint: '兩步指派任務：先點起點再點終點' },
  { key: 'BUILD_STAR',    icon: '⭐', en: 'EQUIPMENT', zh: '設備', hint: '新增設備；側邊欄可部署/移除 AGV' },
  { key: 'BUILD_SQ',      icon: '🧱', en: 'SQUARE',    zh: '方塊', hint: '點畫布新增方形障礙物，雙擊刪除' },
  { key: 'BUILD_CIR',     icon: '⭕', en: 'CIRCLE',    zh: '圓形', hint: '點畫布新增圓形障礙物，雙擊刪除' },
];

function Toolbar({ activeTool, setActiveTool, selectedAgv, selectedAgvId, isConnected, sendCommand, onShowHelp }: Props) {
  return (
    <div className="toolbar-container">
      <div className="toolbar-left">
        {MODES.map(m => (
          <button
            key={m.key}
            className={`mode-btn ${activeTool === m.key ? 'active' : ''}`}
            aria-pressed={activeTool === m.key}
            title={m.hint}
            onClick={() => setActiveTool(m.key)}
          >
            <span className="mode-btn-main">{m.icon} {m.en}</span>
            <span className="mode-btn-zh">{m.zh}</span>
          </button>
        ))}
      </div>
      <div className="toolbar-center">
        {selectedAgv && (
          <div className="agv-quick-controls">
            {!selectedAgv.is_running
              ? <button className="primary" title="啟動 START" onClick={() => sendCommand('start', { agv_id: selectedAgvId })}>▶ 啟動</button>
              : <button className="warning" title="暫停 PAUSE" onClick={() => sendCommand('pause', { agv_id: selectedAgvId })}>⏸ 暫停</button>}
            <button className="danger" title="重設 RESET" onClick={() => sendCommand('reset', { agv_id: selectedAgvId })}>🔄 重設</button>
          </div>
        )}
      </div>
      <div className="toolbar-right">
        <button className="help-btn" title="使用說明" onClick={onShowHelp}>❓ 說明</button>
        <div className={`status-badge ${isConnected ? 'online' : 'offline'}`} style={{ border: 'none', background: 'transparent' }}>{isConnected ? 'SIGNAL OK' : 'NO SIGNAL'}</div>
      </div>
    </div>
  );
}

export default Toolbar;
