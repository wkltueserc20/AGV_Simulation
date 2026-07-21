import { useState, useEffect, useRef } from 'react';
import { useSimulation } from './useSimulation';
import type { Obstacle, Task, AGVData } from './useSimulation';
import SimulatorCanvas from './SimulatorCanvas';
import BackgroundMapPanel from './BackgroundMapPanel';
import type { BackgroundSettings } from './BackgroundMapPanel';
import TelemetryPanel from './TelemetryPanel';
import Toolbar from './Toolbar';
import type { ToolMode } from './Toolbar';
import FleetPanel from './FleetPanel';
import SettingsPanel from './SettingsPanel';
import StatusLegend from './StatusLegend';
import HelpPanel from './HelpPanel';
import { toast, Toaster } from './toast';
import { snapToCenter, snapToIntersection } from './utils';
import './App.css';

function App() {
  const { telemetry, isConnected, sendCommand } = useSimulation('ws://localhost:8000/ws');
  
  // 權限矩陣定義
  const MODE_PERMISSIONS: Record<ToolMode, { canAdd: 'NONE' | 'OBSTACLE' | 'EQUIPMENT', canDelete: boolean, canEdit: boolean, rightClick: 'NONE' | 'SET_TARGET' | 'CANCEL_TASK' | 'CANCEL_SELECT' }> = {
    SELECT: { canAdd: 'NONE', canDelete: true, canEdit: true, rightClick: 'CANCEL_SELECT' },
    SINGLE_ACTION: { canAdd: 'NONE', canDelete: false, canEdit: false, rightClick: 'SET_TARGET' },
    BUILD_SQ: { canAdd: 'OBSTACLE', canDelete: true, canEdit: true, rightClick: 'CANCEL_SELECT' },
    BUILD_CIR: { canAdd: 'OBSTACLE', canDelete: true, canEdit: true, rightClick: 'CANCEL_SELECT' },
    BUILD_STAR: { canAdd: 'EQUIPMENT', canDelete: true, canEdit: true, rightClick: 'CANCEL_SELECT' },
    AUTO: { canAdd: 'NONE', canDelete: false, canEdit: false, rightClick: 'CANCEL_TASK' }
  };
  const [selectedAgvId, setSelectedAgvId] = useState<string | null>(null);
  const [selectedObId, setSelectedObId] = useState<string | null>(null);
  const [addAgvMode, setAddAgvMode] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolMode>('SELECT');
  const [showSearch, setShowSearch] = useState(true);
  const [globalRpm, setGlobalRpm] = useState(3000);

  // 說明面板：首次進入自動顯示一次
  const [showHelp, setShowHelp] = useState(() => !localStorage.getItem('agv_help_seen'));
  useEffect(() => { if (showHelp) localStorage.setItem('agv_help_seen', '1'); }, [showHelp]);

  // 背景地圖相關狀態
  const [bgImageSrc, setBgImageSrc] = useState<string | null>(() => {
    return localStorage.getItem('agv_bg_image') || null;
  });

  const [bgSettings, setBgSettings] = useState<BackgroundSettings>(() => {
    const saved = localStorage.getItem('agv_bg_settings');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* ignore */ }
    }
    return {
      visible: true,
      locked: false,
      opacity: 40,
      width: 50,
      height: 50,
      aspectRatio: 1,
      x: 25000,
      y: 25000,
      rotation: 0,
      aspectRatioLocked: true,
    };
  });

  const [bgPanelOpen, setBgPanelOpen] = useState(false);

  // 背景參數自動寫入 LocalStorage
  useEffect(() => {
    localStorage.setItem('agv_bg_settings', JSON.stringify(bgSettings));
  }, [bgSettings]);

  // 世界邊界尺寸 (mm)：以匯入地圖的真實物理尺寸為準，未設定時退回 50000
  const mapW = (typeof bgSettings.width === 'number' && bgSettings.width > 0) ? bgSettings.width * 1000 : 50000;
  const mapH = (typeof bgSettings.height === 'number' && bgSettings.height > 0) ? bgSettings.height * 1000 : 50000;

  // 地圖尺寸變動或連線建立時，同步世界邊界給後端
  useEffect(() => {
    if (isConnected) sendCommand('set_map_size', { width: mapW, height: mapH });
  }, [isConnected, mapW, mapH, sendCommand]);

  // 匯出全部設定（地圖尺寸 + 障礙物 + AGV + 背景地圖）成單一 JSON 檔下載
  const handleExportConfig = () => {
    const config = {
      version: 1,
      exportedAt: new Date().toISOString(),
      mapSize: { width: mapW, height: mapH },
      obstacles: telemetry?.obstacles ?? [],
      agvs: telemetry?.agvs ?? [],
      bgImage: bgImageSrc,
      bgSettings,
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agv-config-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 匯入設定檔：還原背景地圖 (localStorage) + 重建後端狀態 (import_state 指令)
  const handleImportConfig = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const config = JSON.parse(ev.target?.result as string);
        // 還原背景地圖
        if (config.bgImage) {
          setBgImageSrc(config.bgImage);
          try { localStorage.setItem('agv_bg_image', config.bgImage); } catch { /* 圖檔過大 */ }
        } else {
          setBgImageSrc(null);
          localStorage.removeItem('agv_bg_image');
        }
        if (config.bgSettings) setBgSettings(config.bgSettings); // effect 會同步 localStorage 與地圖尺寸
        // 還原後端：地圖尺寸 + 障礙物 + AGV（一次性）
        sendCommand('import_state', {
          data: {
            map_size: config.mapSize,
            obstacles: config.obstacles ?? [],
            agvs: config.agvs ?? [],
          },
        });
        toast('✅ 設定已匯入並套用。', 'success');
      } catch {
        toast('❌ 匯入失敗：檔案格式不正確。', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // 允許重複匯入同一檔案
  };

  // 本地緩衝狀態
  const [localObFields, setLocalObFields] = useState({ id: "", x: 0, y: 0, angle: 0 });
  const [isEditing, setIsEditing] = useState(false);
  const lastCommitTime = useRef<number>(0);

  // 樂觀更新狀態
  const [pendingObstacles, setPendingObstacles] = useState<Obstacle[]>([]);
  const [pendingDeletions, setPendingDeletions] = useState<Set<string>>(new Set());
  const [optimisticAgvTargets, setOptimisticAgvTargets] = useState<Record<string, { x: number, y: number, status: string, is_running: boolean }>>({});

  // AUTO 模式狀態管理
  const [autoTaskSource, setAutoTaskSource] = useState<string | null>(null);
  const [lastMissionStatus, setLastMissionStatus] = useState<string | null>(null);

  // 切換模式時重置狀態
  useEffect(() => {
    setAutoTaskSource(null);
    setLastMissionStatus(null);
  }, [activeTool]);

  // 定時清除成功訊息
  useEffect(() => {
    if (lastMissionStatus) {
        const timer = setTimeout(() => setLastMissionStatus(null), 3000);
        return () => clearTimeout(timer);
    }
  }, [lastMissionStatus]);

  const selectedAgv = telemetry?.agvs.find(a => a.id === selectedAgvId);
  const selectedObstacle = telemetry?.obstacles.find(o => o.id === selectedObId);

  // 當選中對象改變時，初始化本地緩衝
  useEffect(() => {
    if (selectedObstacle) {
      setLocalObFields({
        id: selectedObstacle.id,
        x: Math.round(selectedObstacle.x),
        y: Math.round(selectedObstacle.y),
        angle: selectedObstacle.docking_angle || 0
      });
    } else {
      setLocalObFields({ id: "", x: 0, y: 0, angle: 0 });
    }
  }, [selectedObId]);

  // 同步遙測數值
  useEffect(() => {
    if (Date.now() - lastCommitTime.current < 1500) return;

    if (selectedObstacle && !isEditing) {
      setLocalObFields(prev => {
          if (prev.id !== selectedObstacle.id || 
              Math.abs(prev.x - selectedObstacle.x) > 10 || 
              Math.abs(prev.y - selectedObstacle.y) > 10 ||
              prev.angle !== selectedObstacle.docking_angle) {
              return {
                id: selectedObstacle.id,
                x: Math.round(selectedObstacle.x),
                y: Math.round(selectedObstacle.y),
                angle: selectedObstacle.docking_angle || 0
              };
          }
          return prev;
      });
    }
  }, [telemetry, isEditing]);

  // 清理樂觀更新狀態
  useEffect(() => {
    if (!telemetry) return;

    // 清理 pendingObstacles
    if (pendingObstacles.length > 0) {
      setPendingObstacles(prev => prev.filter(p => 
        !telemetry.obstacles.some(ob => 
            ob.type === p.type && Math.abs(ob.x - p.x) < 100 && Math.abs(ob.y - p.y) < 100
        )
      ));
    }

    // 清理 pendingDeletions
    if (pendingDeletions.size > 0) {
      setPendingDeletions(prev => {
        const next = new Set(prev);
        let changed = false;
        prev.forEach(id => {
          if (!telemetry.obstacles.some(ob => ob.id === id)) {
            next.delete(id);
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }

    // 清理 optimisticAgvTargets
    if (Object.keys(optimisticAgvTargets).length > 0) {
      setOptimisticAgvTargets(prev => {
        let changed = false;
        const next = { ...prev };
        telemetry.agvs.forEach(agv => {
          const opt = next[agv.id];
          if (opt && (agv.status !== 'PLANNING' || (agv.path && agv.path.length > 0))) {
            delete next[agv.id];
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }
  }, [telemetry, optimisticAgvTargets]);

  useEffect(() => {
    if (telemetry?.agvs.length && !selectedAgvId) {
      setSelectedAgvId(telemetry.agvs[0].id);
    }
  }, [telemetry, selectedAgvId]);

  // 輔助：檢查站點是否被鎖定
  const isStationLocked = (id: string) => {
      return telemetry?.task_queue?.some((t: Task) => t.source_id === id || t.target_id === id);
  };

  const handleAutoModeSelection = (target: any) => {
      const isEquipment = target.type === 'equipment';
      const id = target.id;

      if (!autoTaskSource) {
          if (isEquipment) {
              if (isStationLocked(id)) { toast(`[卡控] 站點 ${id} 已有任務進行中。`, 'error'); return; }
              setAutoTaskSource(id);
          } else {
              setAutoTaskSource(id);
          }
      } else {
          const sourceIsAgv = telemetry?.agvs.some(a => a.id === autoTaskSource);
          if (isEquipment) {
              if (id === autoTaskSource) { setAutoTaskSource(null); return; }
              if (isStationLocked(id)) { toast(`[卡控] 站點 ${id} 已被佔用。`, 'error'); return; }
              if (sourceIsAgv) {
                  const agv = telemetry?.agvs.find(a => a.id === autoTaskSource);
                  if (!agv) { setAutoTaskSource(null); return; }
                  if (agv.has_goods) {
                      if (target.has_goods) { toast("[卡控] 站點已有貨，無法卸貨。", 'error'); return; }
                      sendCommand('dispatch_task', { source_id: null, target_id: id, agv_id: agv.id });
                      setLastMissionStatus(`🚚 指派 ${agv.id} ➔ ${id} (卸貨)`);
                  } else {
                      if (!target.has_goods) { toast("[卡控] 站點沒貨，無法取貨。", 'error'); return; }
                      sendCommand('dispatch_task', { source_id: id, target_id: null, agv_id: agv.id });
                      setLastMissionStatus(`📦 指派 ${agv.id} ➔ ${id} (取貨)`);
                  }
              } else {
                  const sEq = telemetry?.obstacles.find(o => o.id === autoTaskSource);
                  if (sEq?.has_goods && !target.has_goods) {
                      sendCommand('dispatch_task', { source_id: autoTaskSource, target_id: id });
                      setLastMissionStatus(`✅ 已建立搬運任務：${autoTaskSource} ➔ ${id}`);
                  } else {
                      toast("[卡控] 搬運任務必須從「有貨站點」到「無貨站點」。", 'error');
                  }
              }
              setAutoTaskSource(null);
          } else {
              if (id === autoTaskSource) { setAutoTaskSource(null); return; }
              if (!sourceIsAgv) {
                  const sEq = telemetry?.obstacles.find(o => o.id === autoTaskSource);
                  if (sEq?.has_goods) {
                      if (target.has_goods) { toast("[卡控] 車身已有貨，無法取貨。", 'error'); return; }
                      sendCommand('dispatch_task', { source_id: autoTaskSource, target_id: null, agv_id: id });
                      setLastMissionStatus(`📦 指派 ${id} 取貨：${autoTaskSource}`);
                  } else {
                      if (!target.has_goods) { toast("[卡控] 車身沒貨，無法卸貨。", 'error'); return; }
                      sendCommand('dispatch_task', { source_id: null, target_id: autoTaskSource, agv_id: id });
                      setLastMissionStatus(`🚚 指派 ${id} 卸貨：${autoTaskSource}`);
                  }
              }
              setAutoTaskSource(null);
          }
      }
  };

  const handleCanvasClick = (x: number, y: number) => {
    if (!telemetry) return;

    if (isEditing && selectedObstacle) {
      handleCommit();
      setIsEditing(false);
    }

    if (addAgvMode) {
      if (MODE_PERMISSIONS[activeTool].canAdd === 'EQUIPMENT') {
          sendCommand('add_agv', { x: snapToIntersection(x), y: snapToIntersection(y) });
          setAddAgvMode(false);
      } else {
          toast("請在設備模式下部署 AGV", 'info'); setAddAgvMode(false);
      }
      return;
    }

    const allObs = [
        ...telemetry.obstacles.filter(ob => !pendingDeletions.has(ob.id)),
        ...pendingObstacles
    ];

    const clickedOb = allObs.find(ob => {
      if (ob.type === 'rectangle') return Math.abs(x - ob.x) <= 500 && Math.abs(y - ob.y) <= 500;
      if (ob.type === 'equipment') return Math.sqrt((ob.x - x) ** 2 + (ob.y - y) ** 2) <= (ob.radius || 1000);
      return Math.sqrt((ob.x - x) ** 2 + (ob.y - y) ** 2) <= (ob.radius || 500);
    });

    if (clickedOb) {
        setSelectedObId(clickedOb.id);
        setSelectedAgvId(null);
        if (activeTool === 'AUTO' && clickedOb.type === 'equipment') handleAutoModeSelection(clickedOb);
        return;
    }

    const clickedAgv = telemetry.agvs.find(a => Math.sqrt((a.x - x) ** 2 + (a.y - y) ** 2) <= 1500);
    if (clickedAgv) {
        setSelectedAgvId(clickedAgv.id);
        setSelectedObId(null);
        if (activeTool === 'AUTO') handleAutoModeSelection(clickedAgv);
        return;
    }

    if (MODE_PERMISSIONS[activeTool].canAdd !== 'NONE') {
      const sx = snapToCenter(x), sy = snapToCenter(y);
      if (!allObs.some(ob => Math.abs(ob.x - sx) < 100 && Math.abs(ob.y - sy) < 100)) {
        if (activeTool === 'BUILD_STAR') {
            const newId = `EQP-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
            const newOb: Obstacle = { id: newId, type: 'equipment', x: sx, y: sy, radius: 1000, status: 'running', docking_angle: 0, has_goods: false };
            setPendingObstacles(prev => [...prev, newOb]);
            sendCommand('add_obstacle', { data: newOb });
        } else if (activeTool === 'BUILD_SQ' || activeTool === 'BUILD_CIR') {
            const newId = `ob-${Date.now()}-${Math.random().toString(36).substr(2,5)}`;
            const newOb: Obstacle = activeTool === 'BUILD_SQ'
              ? { id: newId, type: 'rectangle', x: sx, y: sy, width: 1000, height: 1000, angle: 0 }
              : { id: newId, type: 'circle', x: sx, y: sy, radius: 500 };
            setPendingObstacles(prev => [...prev, newOb]);
            sendCommand('add_obstacle', { data: newOb });
        }
      }
    }
  };

  const handleCanvasDoubleClick = (x: number, y: number) => {
    if (!telemetry || !MODE_PERMISSIONS[activeTool].canDelete) return;
    
    // 合併目前所有可見物件進行尋找
    const allObs = [
        ...telemetry.obstacles.filter(ob => !pendingDeletions.has(ob.id)),
        ...pendingObstacles
    ];

    const clickedOb = allObs.find(ob => {
      // 根據模式過濾可刪除的物件類型
      if (MODE_PERMISSIONS[activeTool].canAdd === 'EQUIPMENT' && ob.type !== 'equipment') return false;
      if (MODE_PERMISSIONS[activeTool].canAdd === 'OBSTACLE' && ob.type === 'equipment') return false;

      // 判定範圍放寬：矩形判定中心 1000mm 內，圓形判定中心 1000mm 內，設備 1500mm 內
      if (ob.type === 'rectangle') return Math.abs(x - ob.x) <= 800 && Math.abs(y - ob.y) <= 800;
      if (ob.type === 'equipment') return Math.sqrt((ob.x - x) ** 2 + (ob.y - y) ** 2) <= 1500;
      return Math.sqrt((ob.x - x) ** 2 + (ob.y - y) ** 2) <= 1000;
    });

    if (clickedOb) {
      setPendingDeletions(prev => {
          const next = new Set(prev);
          next.add(clickedOb.id);
          return next;
      });
      // 清除選取狀態，防止干擾
      if (selectedObId === clickedOb.id) setSelectedObId(null);
      
      sendCommand('remove_obstacle', { id: clickedOb.id });
    }
  };

  const handleCommit = (field?: string, value?: any) => {
    if (!selectedObstacle) return;
    lastCommitTime.current = Date.now();
    const dataToSync = { ...localObFields };
    if (field && value !== undefined) (dataToSync as any)[field] = value;
    if (dataToSync.id !== selectedObstacle.id) {
        if (telemetry?.obstacles.some(o => o.id === dataToSync.id && o.id !== selectedObstacle.id)) {
            toast("ID 已存在！", 'error'); setLocalObFields(prev => ({ ...prev, id: selectedObstacle.id })); return;
        }
        sendCommand('update_obstacle', { data: { old_id: selectedObstacle.id, new_id: dataToSync.id } });
        setSelectedObId(dataToSync.id);
    } else {
        const sx = snapToCenter(dataToSync.x);
        const sy = snapToCenter(dataToSync.y);
        const sa = Math.max(0, Math.min(359, dataToSync.angle));
        setLocalObFields(prev => ({ ...prev, x: sx, y: sy, angle: sa }));
        sendCommand('update_obstacle', { data: { ...selectedObstacle, x: sx, y: sy, angle: sa, docking_angle: sa } });
    }
  };

  const getAutoHint = () => {
      if (!autoTaskSource) return "【步驟 1/2】請點選一個「設備」或「AGV」作為任務起點";
      const source: Obstacle | AGVData | undefined = telemetry?.obstacles.find(o => o.id === autoTaskSource) || telemetry?.agvs.find(a => a.id === autoTaskSource);
      const isAgv = telemetry?.agvs.some(a => a.id === autoTaskSource);

      if (isAgv) {
          return `【步驟 2/2】已選車輛：${autoTaskSource} (${source?.has_goods ? '載貨中' : '空車'})。請點選一個站點執行${source?.has_goods ? '卸貨' : '取貨'}`;
      } else {
          return `【步驟 2/2】已選站點：${autoTaskSource} (${source?.has_goods ? '有貨' : '沒貨'})。請點選「另一個站點」或「一台 AGV」完成指派`;
      }
  };

  // 樂觀遙測數據封裝
  const optimisticTelemetry = telemetry ? {
    ...telemetry,
    agvs: telemetry.agvs.map(agv => {
        const opt = optimisticAgvTargets[agv.id];
        if (opt) {
            return {
                ...agv,
                target: { x: opt.x, y: opt.y },
                status: opt.status,
                is_running: opt.is_running,
                path: []
            };
        }
        return agv;
    }),
    obstacles: [
        ...telemetry.obstacles.filter(ob => !pendingDeletions.has(ob.id)).map(ob => {
            if (ob.id === selectedObId && localObFields.id === selectedObId) {
                return {
                    ...ob,
                    x: localObFields.x,
                    y: localObFields.y,
                    docking_angle: localObFields.angle
                };
            }
            return ob;
        }),
        ...pendingObstacles
    ]
  } : null;

  return (
    <div className="app-container">
      <Toaster />
      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
      <div className="sidebar left-wing">
        <h2>Multi-AGV Pro</h2>
        <div className="section">
          <h3>系統控制 System</h3>
          <div className={`status-badge ${isConnected ? 'online' : 'offline'}`}>{isConnected ? '● CONNECTED' : '○ DISCONNECTED'}</div>
          <div className="btn-group-grid">
            {[1, 10, 20, 30].map(m => (
              <button key={m} className={telemetry?.multiplier === m ? 'primary' : ''} onClick={() => sendCommand('set_multiplier', { data: m })}>{m}x</button>
            ))}
          </div>
          <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input type="checkbox" id="show-search" checked={showSearch} onChange={(e) => setShowSearch(e.target.checked)} />
            <label htmlFor="show-search" style={{ fontSize: '11px', color: '#8b949e', cursor: 'pointer' }}>搜尋除錯層 Search Debug</label>
          </div>
          <div style={{ marginTop: '15px', borderTop: '1px solid #30363d', paddingTop: '12px' }}>
            <label style={{ fontSize: '10px', color: '#8b949e', display: 'block', marginBottom: '5px' }}>全域速度上限 · {globalRpm} RPM</label>
            <input 
              type="range" 
              min="0" max="3000" step="100" 
              value={globalRpm} 
              onChange={(e) => {
                const val = parseInt(e.target.value);
                setGlobalRpm(val);
                sendCommand('set_all_speeds', { data: val });
              }} 
              style={{ width: '100%', accentColor: '#ff9800' }} 
            />
          </div>
        </div>

        <StatusLegend />

        <FleetPanel
          agvs={telemetry?.agvs ?? []}
          selectedAgvId={selectedAgvId}
          onSelectAgv={(id) => { setSelectedAgvId(id); setSelectedObId(null); }}
          sendCommand={sendCommand}
          canDeployAgv={MODE_PERMISSIONS[activeTool].canAdd === 'EQUIPMENT'}
          addAgvMode={addAgvMode}
          setAddAgvMode={setAddAgvMode}
        />

        {selectedObstacle && (
          <SettingsPanel
            selectedObstacle={selectedObstacle}
            localObFields={localObFields}
            setLocalObFields={setLocalObFields}
            setIsEditing={setIsEditing}
            handleCommit={handleCommit}
            canEdit={MODE_PERMISSIONS[activeTool].canEdit}
            canDelete={MODE_PERMISSIONS[activeTool].canDelete}
            sendCommand={sendCommand}
            setPendingDeletions={setPendingDeletions}
            setSelectedObId={setSelectedObId}
          />
        )}

        {selectedAgv && (
          <div className="section" style={{ borderTop: '1px solid #30363d', paddingTop: '15px' }}>
            <h3>AGV 操作 · {selectedAgv.id}</h3>
            {MODE_PERMISSIONS[activeTool].canAdd === 'EQUIPMENT' && <button className="danger" style={{ width: '100%', marginTop: '5px', opacity: 0.6 }} onClick={() => sendCommand('remove_agv', { agv_id: selectedAgvId })}>移除 AGV</button>}
          </div>
        )}

        <div className="section">
          <h3>全域清除 Cleanup</h3>
          <button className="danger" disabled={!MODE_PERMISSIONS[activeTool].canDelete} style={{ width: '100%' }} onClick={() => sendCommand('clear_obstacles')}>🗑️ 清除所有障礙物</button>
        </div>

        <div className="section">
          <h3>💾 設定存檔</h3>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button style={{ flex: 1 }} onClick={handleExportConfig}>⬇️ 匯出設定</button>
            <input type="file" id="import-config-file" accept="application/json,.json" style={{ display: 'none' }} onChange={handleImportConfig} />
            <label htmlFor="import-config-file" className="btn-like" style={{ flex: 1, textAlign: 'center', cursor: 'pointer', padding: '6px 8px', background: '#30363d', color: '#c9d1d9', border: '1px solid #444', borderRadius: '6px', fontSize: '12px' }}>⬆️ 匯入設定</label>
          </div>
          <div style={{ fontSize: '10px', color: '#8b949e', marginTop: '6px', lineHeight: 1.4 }}>
            匯出障礙物、AGV、地圖尺寸與背景地圖為單一 JSON，下次可匯入還原。
          </div>
        </div>

        <BackgroundMapPanel
          bgImageSrc={bgImageSrc}
          setBgImageSrc={setBgImageSrc}
          bgSettings={bgSettings}
          setBgSettings={setBgSettings}
          bgPanelOpen={bgPanelOpen}
          setBgPanelOpen={setBgPanelOpen}
          mapW={mapW}
          mapH={mapH}
        />
      </div>

      <div className="main-viewport">
        <Toolbar
          activeTool={activeTool}
          setActiveTool={setActiveTool}
          selectedAgv={selectedAgv}
          selectedAgvId={selectedAgvId}
          isConnected={isConnected}
          sendCommand={sendCommand}
          onShowHelp={() => setShowHelp(true)}
        />

        <div className="mode-status-bar">
            {lastMissionStatus ? <span style={{ color: '#39ff14', fontWeight: 'bold' }}>{lastMissionStatus}</span> : 
             activeTool === 'AUTO' ? <span className="animate-pulse">{getAutoHint()}</span> : 
             activeTool === 'SELECT' ? <span>模式：純選擇 | 點選物件查看參數，此模式下禁止修改。</span> : 
             activeTool === 'SINGLE_ACTION' ? <span>模式：單動控制 | 點選 AGV 後，「右鍵」畫布可直接設定導航目標位。</span> : 
             activeTool === 'BUILD_STAR' ? <span>模式：設備建築 | 點擊空白處新增設備，側邊欄可部署/移除 AGV。</span> :
             <span>模式：建築模式 | 點擊空白處新增障礙物，雙擊物件可即時刪除。</span>}
        </div>

        <div className="canvas-container">
          <SimulatorCanvas 
            telemetry={optimisticTelemetry} 
            selectedAgvId={selectedAgvId} 
            selectedObstacleId={selectedObId} 
            autoTaskSourceId={autoTaskSource}
            showSearch={showSearch}
            mapW={mapW}
            mapH={mapH}
            bgImageSrc={bgImageSrc}
            bgSettings={bgSettings}
            onCanvasClick={handleCanvasClick} 
            onCanvasDoubleClick={handleCanvasDoubleClick} 
            onAgvSelect={(id) => { setSelectedAgvId(id); setSelectedObId(null); }} 
            onCanvasRightClick={(x, y) => {
              const perm = MODE_PERMISSIONS[activeTool].rightClick;
              if (perm === 'SET_TARGET') {
                  const targetId = selectedAgvId || (telemetry?.agvs.length ? telemetry.agvs[0].id : null);
                  if (!targetId || !telemetry) return;
                  const clickedEq = telemetry.obstacles.find(ob => ob.type === 'equipment' && Math.sqrt((ob.x - x) ** 2 + (ob.y - y) ** 2) < (ob.radius || 1000));
                  const targetX = clickedEq ? clickedEq.x : snapToIntersection(x);
                  const targetY = clickedEq ? clickedEq.y : snapToIntersection(y);
                   setOptimisticAgvTargets(prev => ({
                     ...prev,
                     [targetId]: { x: targetX, y: targetY, status: 'PLANNING', is_running: true }
                   }));
                   sendCommand('set_target', { agv_id: targetId, data: { x: targetX, y: targetY } });
              } else if (perm === 'CANCEL_TASK') {
                  setAutoTaskSource(null);
                  setSelectedAgvId(null);
                  setSelectedObId(null);
              } else if (perm === 'CANCEL_SELECT') {
                  setSelectedAgvId(null);
                  setSelectedObId(null);
              }
            }} 
          />
        </div>
      </div>

      <TelemetryPanel telemetry={telemetry} selectedAgv={selectedAgv} sendCommand={sendCommand} />
    </div>
  );
}

export default App;
