import React from 'react';
import type { Obstacle } from './useSimulation';
import { snapToCenter } from './utils';

export interface ObFields { id: string; x: number; y: number; angle: number; }

interface Props {
  selectedObstacle: Obstacle;
  localObFields: ObFields;
  setLocalObFields: React.Dispatch<React.SetStateAction<ObFields>>;
  setIsEditing: (v: boolean) => void;
  handleCommit: (field?: string, value?: any) => void;
  canEdit: boolean;
  canDelete: boolean;
  sendCommand: (type: string, payload?: any) => void;
  setPendingDeletions: React.Dispatch<React.SetStateAction<Set<string>>>;
  setSelectedObId: (id: string | null) => void;
}

function SettingsPanel({
  selectedObstacle, localObFields, setLocalObFields, setIsEditing, handleCommit,
  canEdit, canDelete, sendCommand, setPendingDeletions, setSelectedObId,
}: Props) {
  return (
    <div className="section" style={{ borderTop: '2px solid #000', paddingTop: '15px' }}>
      <h3>設定 · {selectedObstacle.type === 'equipment' ? '設備 Equipment' : '物件 Object'}</h3>
      <div className="item-card active">
        <div className="telemetry-grid">
          <div className="tele-item"><label>ID</label>
            <input type="text" readOnly={!canEdit} value={localObFields.id} onFocus={() => setIsEditing(true)} onChange={(e) => setLocalObFields(prev => ({ ...prev, id: e.target.value }))} onBlur={() => { handleCommit(); setIsEditing(false); }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          </div>
          {selectedObstacle.type === 'equipment' && (
            <>
              <div className="tele-item"><label>STATUS</label>
                <select disabled={!canEdit} value={selectedObstacle.status || 'running'} onChange={(e) => sendCommand('update_obstacle', { data: { ...selectedObstacle, x: snapToCenter(localObFields.x), y: snapToCenter(localObFields.y), angle: localObFields.angle, docking_angle: localObFields.angle, status: e.target.value } })}>
                  <option value="normal">NORMAL</option>
                  <option value="running">RUNNING</option>
                  <option value="error">ERROR</option>
                </select>
              </div>
              <div className="tele-item"><label>CARGO</label>
                <button disabled={!canEdit} className={selectedObstacle.has_goods ? 'warning' : 'primary'} style={{ height: '24px', fontSize: '10px', padding: '0 8px' }} onClick={() => sendCommand('update_obstacle', { data: { ...selectedObstacle, x: snapToCenter(localObFields.x), y: snapToCenter(localObFields.y), angle: localObFields.angle, docking_angle: localObFields.angle, has_goods: !selectedObstacle.has_goods } })}>
                  {selectedObstacle.has_goods ? '■ LOADED' : '□ EMPTY'}
                </button>
              </div>
              <div className="tele-item"><label>ANGLE</label>
                <input
                  type="number"
                  readOnly={!canEdit}
                  min="0" max="359"
                  value={localObFields.angle}
                  onFocus={() => setIsEditing(true)}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 0;
                    setLocalObFields(prev => ({ ...prev, angle: val }));
                  }}
                  onBlur={() => { handleCommit(); setIsEditing(false); }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
              </div>
            </>
          )}
          <div className="tele-item"><label>X</label>
            <input
              type="number"
              readOnly={!canEdit}
              step="1000"
              value={localObFields.x}
              onFocus={() => setIsEditing(true)}
              onChange={(e) => {
                const val = parseInt(e.target.value) || 0;
                setLocalObFields(prev => ({ ...prev, x: val }));
              }}
              onBlur={() => { handleCommit(); setIsEditing(false); }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </div>
          <div className="tele-item"><label>Y</label>
            <input
              type="number"
              readOnly={!canEdit}
              step="1000"
              value={localObFields.y}
              onFocus={() => setIsEditing(true)}
              onChange={(e) => {
                const val = parseInt(e.target.value) || 0;
                setLocalObFields(prev => ({ ...prev, y: val }));
              }}
              onBlur={() => { handleCommit(); setIsEditing(false); }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </div>
        </div>
        <button className="danger"
          disabled={!canDelete}
          style={{ width: '100%', marginTop: '10px', opacity: canDelete ? 1 : 0.5 }}
          onClick={() => {
            setPendingDeletions(prev => {
              const next = new Set(prev);
              next.add(selectedObstacle.id);
              return next;
            });
            sendCommand('remove_obstacle', { id: selectedObstacle.id });
            setSelectedObId(null);
          }}>🗑️ 刪除 DELETE</button>
      </div>
    </div>
  );
}

export default SettingsPanel;
