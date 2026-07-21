import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import type { Telemetry, AGVData } from './useSimulation';

interface Props {
  telemetry: Telemetry | null;
  selectedAgvId: string | null;
  selectedObstacleId: string | null;
  autoTaskSourceId: string | null;
  showSearch: boolean;
  mapW?: number; // 世界寬度 (mm)
  mapH?: number; // 世界高度 (mm)
  bgImageSrc?: string | null;
  bgSettings?: {
    visible: boolean;
    locked: boolean;
    opacity: number;
    width: number;
    height: number;
    x: number;
    y: number;
    rotation: number;
  } | null;
  onCanvasClick: (x: number, y: number) => void;
  onCanvasDoubleClick: (x: number, y: number) => void;
  onCanvasRightClick: (x: number, y: number) => void;
  onAgvSelect: (id: string) => void;
}

const GRID_SIZE = 200;

// 工業站點圖示路徑
const STATION_PATH = "M -50,-50 L 50,-50 L 50,-20 L 40,-20 L 40,20 L 50,20 L 50,50 L -50,50 L -50,20 L -40,20 L -40,-20 L -50,-20 Z";
const stationPath2D = new Path2D(STATION_PATH);

const SimulatorCanvas: React.FC<Props> = ({
  telemetry, selectedAgvId, selectedObstacleId, autoTaskSourceId, showSearch,
  mapW: propMapW, mapH: propMapH,
  bgImageSrc, bgSettings,
  onCanvasClick, onCanvasDoubleClick, onCanvasRightClick, onAgvSelect
}) => {
  // 世界邊界尺寸 (mm)；未提供時退回 50000 預設
  const mapW = (typeof propMapW === 'number' && !isNaN(propMapW) && propMapW > 0) ? propMapW : 50000;
  const mapH = (typeof propMapH === 'number' && !isNaN(propMapH) && propMapH > 0) ? propMapH : 50000;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const staticNeedsUpdate = useRef(true);

  const [boxSize, setBoxSize] = useState(750);
  // viewState 以 ref 保存：畫布為 rAF 命令式繪製，平移不需觸發 React 重繪，
  // 也避免 render callback 因依賴 viewState 而每幀重建、反覆重掛 rAF。
  const viewStateRef = useRef({ offsetX: 0, offsetY: 0 });
  const hasDragged = useRef(false);
  
  const [loadedBgImage, setLoadedBgImage] = useState<HTMLImageElement | null>(null);

  // 監聽圖片更動進行非同步載入
  useEffect(() => {
    if (bgImageSrc) {
      const img = new Image();
      img.onload = () => {
        setLoadedBgImage(img);
        staticNeedsUpdate.current = true;
      };
      img.onerror = () => {
        console.error("Failed to load simulator background image.");
        setLoadedBgImage(null);
        staticNeedsUpdate.current = true;
      };
      img.src = bgImageSrc;
    } else {
      setLoadedBgImage(null);
      staticNeedsUpdate.current = true;
    }
  }, [bgImageSrc]);

  // 監聽背景定位參數更動
  useEffect(() => {
    staticNeedsUpdate.current = true;
  }, [bgSettings]);

  const isDragging = useRef(false);
  const lastMousePos = useRef({ x: 0, y: 0 });

  const telemetryRef = useRef<Telemetry | null>(null);
  const selectedAgvIdRef = useRef<string | null>(null);
  const selectedObstacleIdRef = useRef<string | null>(null);
  const lastObstacleFp = useRef<string>('');

  const revealedIndices = useRef<Record<string, number>>({});
  const lastSearchFingerprints = useRef<Record<string, string>>({});
  const displayStates = useRef<Record<string, {x: number, y: number, theta: number, lastUpdate: number}>>({});
  const animationFrameId = useRef<number>();

  // 同步 Refs：靜態層只在障礙物內容變動時失效（AGV 移動不觸發整層重繪）。
  // 平移/縮放/選取/背景變動的重繪觸發由其各自的 effect 或事件另行設定。
  useEffect(() => {
    telemetryRef.current = telemetry;
    const fp = telemetry ? JSON.stringify(telemetry.obstacles) : '';
    if (fp !== lastObstacleFp.current) {
      lastObstacleFp.current = fp;
      staticNeedsUpdate.current = true;
    }
  }, [telemetry]);
  useEffect(() => { selectedAgvIdRef.current = selectedAgvId; }, [selectedAgvId]);
  useEffect(() => { 
      selectedObstacleIdRef.current = selectedObstacleId; 
      staticNeedsUpdate.current = true;
  }, [selectedObstacleId]);

  // 處理畫布大小 (可用正方形空間)
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        setBoxSize(Math.min(clientWidth, clientHeight) - 40);
        staticNeedsUpdate.current = true;
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 依世界長寬比決定畫布尺寸，確保像素為正方 (不變形)
  const dimensions = useMemo(() => {
    const b = Math.max(50, boxSize);
    const aspect = mapW / mapH;
    if (aspect >= 1) return { width: b, height: Math.round(b / aspect) };
    return { width: Math.round(b * aspect), height: b };
  }, [boxSize, mapW, mapH]);

  // 地圖尺寸變動時重繪靜態層
  useEffect(() => { staticNeedsUpdate.current = true; }, [dimensions.width, dimensions.height]);

  const worldToCanvas = useCallback((x: number, y: number, w: number, h: number, vs: any) => {
    const scale = (w / mapW);
    return { cx: (x * scale) + vs.offsetX, cy: h - (y * scale) + vs.offsetY };
  }, [mapW]);

  const canvasToWorld = useCallback((cx: number, cy: number, w: number, h: number, vs: any) => {
    const scale = (w / mapW);
    return { x: (cx - vs.offsetX) / scale, y: (h + vs.offsetY - cy) / scale };
  }, [mapW]);

  // --- 事件處理函式 ---
  const handleMouseDown = (e: React.MouseEvent) => {
    // 支援中鍵 (1)、Alt+左鍵 (0 + alt)、右鍵 (2) 進行平移
    if (e.button === 1 || (e.button === 0 && e.altKey) || e.button === 2) {
        isDragging.current = true;
        hasDragged.current = false;
        lastMousePos.current = { x: e.clientX, y: e.clientY };
        e.preventDefault();
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging.current) {
        const dx = e.clientX - lastMousePos.current.x;
        const dy = e.clientY - lastMousePos.current.y;
        
        // 如果移動超過 3 像素，則判定為「拖曳平移」，以防止右鍵拖曳觸發點擊行為
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
            hasDragged.current = true;
        }
        
        viewStateRef.current = { offsetX: viewStateRef.current.offsetX + dx, offsetY: viewStateRef.current.offsetY + dy };
        lastMousePos.current = { x: e.clientX, y: e.clientY };
        staticNeedsUpdate.current = true;
    }
  };

  const handleMouseUp = () => {
    isDragging.current = false;
  };

  const handleInteraction = (e: React.MouseEvent<HTMLCanvasElement>, callback: (x: number, y: number) => void) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const { x, y } = canvasToWorld(e.clientX - rect.left, e.clientY - rect.top, dimensions.width, dimensions.height, viewStateRef.current);
    callback(x, y);
  };

  // --- 靜態層繪製 (緩存) ---
  const updateStaticLayer = (w: number, h: number, vs: any, telemetry: Telemetry | null) => {
    if (!staticCanvasRef.current) staticCanvasRef.current = document.createElement('canvas');
    const canvas = staticCanvasRef.current;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scale = (w / mapW);
    ctx.fillStyle = '#0d0e12'; ctx.fillRect(0, 0, w, h);

    // 繪製背景地圖 (在網格與障礙物最底層)
    if (loadedBgImage && bgSettings && bgSettings.visible) {
      const opacity = typeof bgSettings.opacity === 'number' && !isNaN(bgSettings.opacity) ? bgSettings.opacity : 40;
      const x = typeof bgSettings.x === 'number' && !isNaN(bgSettings.x) ? bgSettings.x : mapW / 2;
      const y = typeof bgSettings.y === 'number' && !isNaN(bgSettings.y) ? bgSettings.y : mapH / 2;
      const rotation = typeof bgSettings.rotation === 'number' && !isNaN(bgSettings.rotation) ? bgSettings.rotation : 0;
      const width = typeof bgSettings.width === 'number' && !isNaN(bgSettings.width) ? bgSettings.width : 50;
      const height = typeof bgSettings.height === 'number' && !isNaN(bgSettings.height) ? bgSettings.height : 50;

      ctx.save();
      ctx.globalAlpha = opacity / 100;
      
      // 計算背景圖中心點之畫布座標
      const { cx, cy } = worldToCanvas(x, y, w, h, vs);
      
      // 進行平移與逆時針旋轉對齊 (角度取負值與 AGV 坐標系一致)
      ctx.translate(cx, cy);
      ctx.rotate(-rotation * Math.PI / 180);
      
      const imgW = width * 1000 * scale;   // 寬度 m -> mm -> px
      const imgH = height * 1000 * scale;  // 高度 m -> mm -> px
      
      // 以中心點居中繪製地圖
      ctx.drawImage(loadedBgImage, -imgW / 2, -imgH / 2, imgW, imgH);
      ctx.restore();
    }

    const pTopLeft = worldToCanvas(0, mapH, w, h, vs);
    const pBottomRight = worldToCanvas(mapW, 0, w, h, vs);
    ctx.strokeStyle = '#2d333b'; ctx.lineWidth = 2;
    ctx.strokeRect(pTopLeft.cx, pTopLeft.cy, pBottomRight.cx - pTopLeft.cx, pBottomRight.cy - pTopLeft.cy);

    ctx.fillStyle = '#3a3f4b';
    for (let x = 0; x <= mapW; x += 5000) {
      for (let y = 0; y <= mapH; y += 5000) {
        const { cx, cy } = worldToCanvas(x, y, w, h, vs);
        if (cx >= 0 && cx <= w && cy >= 0 && cy <= h) {
            ctx.beginPath(); ctx.arc(cx, cy, 1.5, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    if (telemetry) {
        telemetry.obstacles.filter(ob => ob.type !== 'equipment').forEach(ob => {
            const { cx, cy } = worldToCanvas(ob.x, ob.y, w, h, vs);
            const isSelected = selectedObstacleIdRef.current === ob.id;
            ctx.save(); ctx.translate(cx, cy);
            if (ob.type === 'circle') {
                const r = (ob.radius || 500) * scale;
                ctx.fillStyle = isSelected ? '#ff6600' : '#d4af37'; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = isSelected ? '#fff' : '#ffd700'; ctx.lineWidth = 1.5; ctx.stroke();
            } else {
                ctx.rotate(-ob.angle);
                const ow = ob.width * scale, oh = ob.height * scale;
                ctx.fillStyle = isSelected ? '#ff6600' : '#d4af37'; ctx.fillRect(-ow/2, -oh/2, ow, oh);
                ctx.strokeStyle = isSelected ? '#fff' : '#ffd700'; ctx.lineWidth = 1.5; ctx.strokeRect(-ow/2, -oh/2, ow, oh);
            }
            ctx.restore();
        });
    }
    staticNeedsUpdate.current = false;
  };


  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const currentTelemetry = telemetryRef.current;
    const { width: w, height: h } = dimensions;
    const vs = viewStateRef.current;

    if (!canvas || !currentTelemetry) {
        animationFrameId.current = requestAnimationFrame(render);
        return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const now = performance.now();
    const scale = (w / mapW);

    if (staticNeedsUpdate.current) updateStaticLayer(w, h, vs, currentTelemetry);
    if (staticCanvasRef.current) ctx.drawImage(staticCanvasRef.current, 0, 0);

    // 更新 AGV 動畫狀態
    currentTelemetry.agvs.forEach(a => {
      if (!displayStates.current[a.id]) {
        displayStates.current[a.id] = { x: a.x, y: a.y, theta: a.theta, lastUpdate: now };
      } else {
        const ds = displayStates.current[a.id];
        const dt = (now - ds.lastUpdate) / 1000.0;
        if (a.is_running) {
          ds.x += a.v * Math.cos(ds.theta) * dt; ds.y += a.v * Math.sin(ds.theta) * dt; ds.theta += a.omega * dt;
          ds.x += (a.x - ds.x) * 0.3; ds.y += (a.y - ds.y) * 0.3;
          let dTheta = a.theta - ds.theta;
          while (dTheta > Math.PI) dTheta -= Math.PI * 2;
          while (dTheta < -Math.PI) dTheta += Math.PI * 2;
          ds.theta += dTheta * 0.3;
        } else { ds.x = a.x; ds.y = a.y; ds.theta = a.theta; }
        ds.lastUpdate = now;
      }
    });

    if (showSearch) {
        const selectedAgv = currentTelemetry.agvs.find(a => a.id === selectedAgvIdRef.current);
        if (selectedAgv?.visited) {
            const fingerprint = `${selectedAgv.visited.length}-${selectedAgv.visited[0] ? selectedAgv.visited[0][0] : 0}`;
            if (fingerprint !== lastSearchFingerprints.current[selectedAgv.id]) {
                revealedIndices.current[selectedAgv.id] = 0;
                lastSearchFingerprints.current[selectedAgv.id] = fingerprint;
            }
            if (revealedIndices.current[selectedAgv.id] < selectedAgv.visited.length) revealedIndices.current[selectedAgv.id] += 100;
            ctx.fillStyle = 'rgba(0, 255, 255, 0.08)';
            const blockSize = GRID_SIZE * scale;
            const count = revealedIndices.current[selectedAgv.id] || 0;
            for (let i = 0; i < Math.min(count, selectedAgv.visited.length); i++) {
                const node = selectedAgv.visited[i];
                const { cx, cy } = worldToCanvas(node[0] * GRID_SIZE, node[1] * GRID_SIZE, w, h, vs);
                ctx.fillRect(cx - blockSize/2, cy - blockSize/2, blockSize, blockSize);
            }
        }
    }

    currentTelemetry.agvs.forEach(a => {
      const isSelected = a.id === selectedAgvIdRef.current;
      const { cx, cy } = worldToCanvas(a.target.x, a.target.y, w, h, vs);
      ctx.save(); ctx.translate(cx, cy);
      const pulse = Math.max(0.1, (1 + Math.sin(now / 200) * 0.15));
      ctx.strokeStyle = isSelected ? '#39ff14' : '#1b5e20'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 12 * pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-15, 0); ctx.lineTo(15, 0); ctx.moveTo(0, -15); ctx.lineTo(0, 15); ctx.stroke();
      ctx.restore();

      if (isSelected && a.path) {
        ctx.save(); ctx.setLineDash([5, 5]); ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = 2;
        ctx.shadowBlur = 10; ctx.shadowColor = '#ff4d4d'; ctx.beginPath();
        a.path.forEach((p, i) => {
          const cp = worldToCanvas(p[0], p[1], w, h, vs);
          if (i === 0) ctx.moveTo(cp.cx, cp.cy); else ctx.lineTo(cp.cx, cp.cy);
        });
        ctx.stroke(); ctx.restore();
      }

      if (isSelected && (!a.path || a.path.length === 0 || a.status === 'PLANNING')) {
        const distToTarget = Math.sqrt((a.x - a.target.x) ** 2 + (a.y - a.target.y) ** 2);
        if (distToTarget > 100) {
            const p1 = worldToCanvas(a.x, a.y, w, h, vs);
            const p2 = worldToCanvas(a.target.x, a.target.y, w, h, vs);
            ctx.save(); 
            ctx.setLineDash([4, 4]); 
            ctx.strokeStyle = '#00f2ff'; 
            ctx.lineWidth = 1.5;
            ctx.beginPath(); 
            ctx.moveTo(p1.cx, p1.cy); 
            ctx.lineTo(p2.cx, p2.cy); 
            ctx.stroke(); 
            ctx.restore();
        }
      }
    });

    if (currentTelemetry.path_occupancy) {
        ctx.save(); ctx.strokeStyle = 'rgba(255, 77, 77, 0.15)';
        ctx.lineWidth = 1600 * scale; // 兩倍半徑，作為線寬
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        Object.values(currentTelemetry.path_occupancy).forEach(points => {
            if (points.length < 2) return;
            ctx.beginPath();
            const first = worldToCanvas(points[0][0], points[0][1], w, h, vs);
            ctx.moveTo(first.cx, first.cy);
            // 抽樣繪製以進一步提升性能 (每 3 個點取 1 個)
            for (let i = 1; i < points.length; i += 3) {
                const cp = worldToCanvas(points[i][0], points[i][1], w, h, vs);
                ctx.lineTo(cp.cx, cp.cy);
            }
            ctx.stroke();
        });
        ctx.restore();
    }

    if (currentTelemetry.social_links) {
        currentTelemetry.social_links.forEach(link => {
            const fromAgv = currentTelemetry.agvs.find(a => a.id === link.from);
            const toAgv = currentTelemetry.agvs.find(a => a.id === link.to);
            if (fromAgv && toAgv) {
                const p1 = worldToCanvas(fromAgv.x, fromAgv.y, w, h, vs), p2 = worldToCanvas(toAgv.x, toAgv.y, w, h, vs);
                ctx.save(); ctx.setLineDash([5, 5]); ctx.strokeStyle = link.type === 'WAITING' ? 'rgba(255, 152, 0, 0.6)' : 'rgba(187, 134, 252, 0.6)';
                ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p1.cx, p1.cy); ctx.lineTo(p2.cx, p2.cy); ctx.stroke();
                const angle = Math.atan2(p2.cy - p1.cy, p2.cx - p1.cx);
                ctx.translate(p2.cx - Math.cos(angle) * 30, p2.cy - Math.sin(angle) * 30);
                ctx.rotate(angle); ctx.fillStyle = ctx.strokeStyle;
                ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-10, -5); ctx.lineTo(-10, 5); ctx.fill();
                ctx.restore();
            }
        });
    }

    if (currentTelemetry.task_queue) {
        currentTelemetry.task_queue.forEach((task: any) => {
            const source = currentTelemetry.obstacles.find(ob => ob.id === task.source_id);
            const target = currentTelemetry.obstacles.find(ob => ob.id === task.target_id);
            if (source && target) {
                const p1 = worldToCanvas(source.x, source.y, w, h, vs), p2 = worldToCanvas(target.x, target.y, w, h, vs);
                ctx.save(); ctx.setLineDash([8, 4]); ctx.strokeStyle = task.status === 'ASSIGNED' ? 'rgba(57, 255, 20, 0.4)' : 'rgba(88, 166, 255, 0.4)';
                ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p1.cx, p1.cy); ctx.lineTo(p2.cx, p2.cy); ctx.stroke();
                const midX = (p1.cx + p2.cx) / 2, midY = (p1.cy + p2.cy) / 2;
                ctx.fillStyle = task.status === 'ASSIGNED' ? '#39ff14' : '#58a6ff';
                ctx.font = `bold 11px monospace`; ctx.textAlign = 'center';
                ctx.fillText(task.status, midX, midY - 5); ctx.restore();
            }
        });
    }

    currentTelemetry.agvs.forEach(a => {
      const ds = displayStates.current[a.id]; if (!ds) return;
      const { cx, cy } = worldToCanvas(ds.x, ds.y, w, h, vs);
      const isSelected = a.id === selectedAgvIdRef.current;
      const sz = 1000 * scale;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-ds.theta);
      let strokeColor = isSelected ? '#00f2ff' : '#555';
      ctx.fillStyle = '#1a1a1a'; ctx.strokeStyle = strokeColor; ctx.lineWidth = 2;
      const r = Math.max(0.1, 10 * scale);
      ctx.beginPath(); ctx.moveTo(-sz/2 + r, -sz/2); ctx.lineTo(sz/2 - r, -sz/2);
      ctx.quadraticCurveTo(sz/2, -sz/2, sz/2, -sz/2 + r); ctx.lineTo(sz/2, sz/2 - r);
      ctx.quadraticCurveTo(sz/2, sz/2, sz/2 - r, sz/2); ctx.lineTo(-sz/2 + r, sz/2);
      ctx.quadraticCurveTo(-sz/2, sz/2, -sz/2, sz/2 - r); ctx.lineTo(-sz/2, -sz/2 + r);
      ctx.quadraticCurveTo(-sz/2, -sz/2, -sz/2 + r, -sz/2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, Math.max(0.1, sz/4), 0, Math.PI * 2); ctx.fillStyle = '#333'; ctx.fill();
      ctx.fillStyle = isSelected ? '#00f2ff' : '#aaa';
      ctx.beginPath(); ctx.moveTo(sz/2 - 5, 0); ctx.lineTo(sz/2 - 15, -10); ctx.lineTo(sz/2 - 15, 10); ctx.fill();
      const ledColor = a.status === 'ERROR' ? '#ff0000' : (a.is_running ? '#00ff00' : (a.is_planning || a.status === 'BLOCKED' ? '#ffc107' : '#ff3333'));
      ctx.beginPath(); ctx.arc(-sz/2 + 15, -sz/2 + 15, 4, 0, Math.PI * 2);
      ctx.fillStyle = ledColor; ctx.shadowBlur = 8; ctx.shadowColor = ledColor; ctx.fill();
      ctx.shadowBlur = 0;
      if (a.has_goods) {
          ctx.fillStyle = '#ff9800'; ctx.strokeStyle = '#e65100'; ctx.lineWidth = 1;
          const cargoSize = sz * 0.4; ctx.fillRect(-cargoSize/2, -cargoSize/2, cargoSize, cargoSize);
          ctx.strokeRect(-cargoSize/2, -cargoSize/2, cargoSize, cargoSize);
      }
      ctx.restore();
      ctx.fillStyle = '#fff'; ctx.font = `bold 11px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(a.id, cx, cy - sz * 0.75);
      
      // 繪製狀態文字與 Emoji
      const statusEmojis: Record<string, string> = {
        'IDLE': '💤', 'PLANNING': '🔄', 'EXECUTING': '🚚', 'EVADING': '🛡️', 
        'STUCK': '⚠️', 'LOADING': '📥', 'UNLOADING': '📤',
        'WAITING': '⏸️', 'THINKING': '🧠', 'YIELDING': '🛡️',
        'BLOCKED': '🚧', 'ERROR': '❌'
      };
      const emoji = statusEmojis[a.status] || '❓';
      ctx.fillStyle = (a.status === 'STUCK' || a.status === 'ERROR') ? '#ff3333' : '#aaa';
      ctx.font = `9px monospace`;
      ctx.fillText(`${emoji} ${a.status}`, cx, cy + sz * 0.75);
    });

    currentTelemetry.obstacles.filter(ob => ob.type === 'equipment').forEach(ob => {
      const { cx, cy } = worldToCanvas(ob.x, ob.y, w, h, vs);
      const isSelected = selectedObstacleIdRef.current === ob.id;
      const isAutoSource = autoTaskSourceId === ob.id;
      const size = (ob.radius || 1000) * scale;
      const colors: Record<string, string> = { 'normal': '#ffd700', 'running': '#39ff14', 'error': '#ff4d4d' };
      const baseColor = colors[ob.status || 'running'] || '#39ff14';
      const dockingAngle = ob.docking_angle !== undefined ? ob.docking_angle : 0;
      const angleRad = (dockingAngle * Math.PI) / 180;
      ctx.save(); ctx.translate(cx, cy);
      ctx.rotate(-angleRad + Math.PI);
      const iconScale = size / 50; ctx.scale(iconScale, iconScale);
      ctx.globalAlpha = 0.7; ctx.fillStyle = (isSelected || isAutoSource) ? '#ff6600' : baseColor;
      ctx.fill(stationPath2D); ctx.globalAlpha = 1.0; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 / iconScale;
      ctx.stroke(stationPath2D); ctx.beginPath(); ctx.arc(0, 0, 5 / iconScale, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
      if (ob.has_goods) {
          ctx.fillStyle = '#ff9800'; ctx.strokeStyle = '#e65100'; ctx.lineWidth = 1 / iconScale;
          const cargoSize = 40; ctx.fillRect(-cargoSize/2, -cargoSize/2, cargoSize, cargoSize); ctx.strokeRect(-cargoSize/2, -cargoSize/2, cargoSize, cargoSize);
      }
      ctx.restore();
      if (ob.docking_angle !== undefined) {
          ctx.save(); ctx.translate(cx, cy); const angleRad = (ob.docking_angle * Math.PI) / 180; ctx.rotate(-angleRad + Math.PI);
          ctx.strokeStyle = '#00f2ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(size * 0.8, 0);
          ctx.lineTo(size * 0.6, -size * 0.1); ctx.moveTo(size * 0.8, 0); ctx.lineTo(size * 0.6, size * 0.1); ctx.stroke(); ctx.restore();
      }
      ctx.save(); ctx.translate(cx, cy); ctx.fillStyle = '#fff'; ctx.font = `bold 12px monospace`; ctx.textAlign = 'center'; ctx.fillText(ob.id, 0, -size - 10); ctx.restore();
    });

    animationFrameId.current = requestAnimationFrame(render);
    // loadedBgImage / bgSettings 必須列入依賴：render 閉包捕捉 updateStaticLayer，
    // 後者又閉包捕捉這兩者。缺了它們，換背景圖時 rAF 迴圈仍用舊閉包，新圖畫不出來。
  }, [worldToCanvas, dimensions, showSearch, autoTaskSourceId, mapW, mapH, loadedBgImage, bgSettings]);

  useEffect(() => {
    animationFrameId.current = requestAnimationFrame(render);
    return () => { if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current); };
  }, [render]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <canvas ref={canvasRef} width={dimensions.width} height={dimensions.height} 
        style={{ border: '2px solid #333', background: '#0d0e12', cursor: isDragging.current ? 'grabbing' : 'crosshair' }} 
        onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
        onClick={(e) => {
            if (e.altKey) return;
            const rect = canvasRef.current!.getBoundingClientRect();
            const { x, y } = canvasToWorld(e.clientX - rect.left, e.clientY - rect.top, dimensions.width, dimensions.height, viewStateRef.current);
            const currentTelemetry = telemetryRef.current;
            const clickedEq = currentTelemetry?.obstacles.find(ob => ob.type === 'equipment' && Math.sqrt((ob.x-x)**2+(ob.y-y)**2) < 1500);
            if (clickedEq) onCanvasClick(x, y);
            else {
                const clickedAgv = currentTelemetry?.agvs.find(a => Math.sqrt((a.x-x)**2+(a.y-y)**2) < 1500);
                if (clickedAgv) { onAgvSelect(clickedAgv.id); onCanvasClick(x, y); }
                else onCanvasClick(x, y);
            }
        }} 
        onDoubleClick={(e) => handleInteraction(e, onCanvasDoubleClick)}
        onContextMenu={(e) => { 
          e.preventDefault(); 
          // 僅在沒有發生拖曳平移的情況下，才判定為右鍵點擊，防止干擾右鍵平移操作
          if (!hasDragged.current) {
            handleInteraction(e, onCanvasRightClick); 
          }
        }} 
      />
      <button style={{ position: 'absolute', bottom: '20px', right: '20px', opacity: 0.6 }} onClick={() => { viewStateRef.current = { offsetX: 0, offsetY: 0 }; staticNeedsUpdate.current = true; }}>
        RESET VIEW
      </button>
    </div>
  );
};

export default SimulatorCanvas;
