import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import type { Telemetry } from './useSimulation';

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
  allowAgvDrag?: boolean;                              // 選取模式下允許拖曳 AGV 重新定位
  onAgvMove?: (id: string, x: number, y: number) => void;
}

const GRID_SIZE = 200;

// 工業站點圖示路徑
const STATION_PATH = "M -50,-50 L 50,-50 L 50,-20 L 40,-20 L 40,20 L 50,20 L 50,50 L -50,50 L -50,20 L -40,20 L -40,-20 L -50,-20 Z";
const stationPath2D = new Path2D(STATION_PATH);

// Neubrutalism 配色：米白底、純黑邊、平塗鮮豔（畫布繪製用字面 hex）
const C = {
  bg: '#FFF8E7',
  gridMinor: '#EFE6CA',
  gridMajor: '#D6C9A3',
  ruler: '#000000',
  border: '#000000',
  obstacle: '#AEB7C4', obstacleStroke: '#000000', obstacleSel: '#FFE66D',
  agvBody: '#FF8C42', agvStroke: '#000000', agvSel: '#2E7DD1',
  agvHub: '#000000', agvArrow: '#000000',
  target: '#159947', targetIdle: '#8FBBA1',
  pathSel: '#2E7DD1', occupancy: 'rgba(46,125,209,0.12)',
  label: '#000000', labelBg: '#FFFFFF',
  cargo: '#FFFFFF', cargoStroke: '#000000', docking: '#2E7DD1',
};

// 設備狀態色（平塗鮮豔）
const EQUIP_COLORS: Record<string, string> = { normal: '#FFE66D', running: '#4ECDC4', error: '#FF6B6B' };

// AGV 狀態語意色（亮底可讀）
const STATUS_COLORS: Record<string, string> = {
  IDLE: '#4a4a4a', PLANNING: '#C77800', EXECUTING: '#159947',
  EVADING: '#7A3FC9', YIELDING: '#7A3FC9', THINKING: '#2E7DD1',
  WAITING: '#C77800', LOADING: '#2E7DD1', UNLOADING: '#2E7DD1',
  STUCK: '#D62828', BLOCKED: '#C77800', ERROR: '#D62828',
};

// 圓角矩形（ctx.roundRect 在舊環境不一定有，自帶一份保底）
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 狀態膠囊：色點 + 縮寫，取代 emoji（跨平台一致、辨識度高）
function drawStatusPill(ctx: CanvasRenderingContext2D, cx: number, cy: number, status: string) {
  const color = STATUS_COLORS[status] || '#8b949e';
  ctx.save();
  ctx.font = 'bold 9px monospace';
  const tw = ctx.measureText(status).width;
  const padX = 6, dot = 4, gap = 4, ph = 15;
  const pw = padX * 2 + dot + gap + tw;
  const x = cx - pw / 2;
  rr(ctx, x, cy - ph / 2, pw, ph, 0);
  ctx.fillStyle = '#FFFFFF'; ctx.fill();
  ctx.strokeStyle = '#000000'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x + padX + dot / 2, cy, dot / 2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#000000'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(status, x + padX + dot + gap, cy + 0.5);
  ctx.restore();
}

const SimulatorCanvas: React.FC<Props> = ({
  telemetry, selectedAgvId, selectedObstacleId, autoTaskSourceId, showSearch,
  mapW: propMapW, mapH: propMapH,
  bgImageSrc, bgSettings,
  onCanvasClick, onCanvasDoubleClick, onCanvasRightClick, onAgvSelect,
  allowAgvDrag, onAgvMove
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
  const viewStateRef = useRef({ offsetX: 0, offsetY: 0, zoom: 1 });
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

  // AGV 拖曳重新定位狀態
  const hoveredAgvId = useRef<string | null>(null);   // 滑鼠懸停的 AGV（顯示標籤用）
  const draggingAgvId = useRef<string | null>(null); // 拖曳中或等待後端確認的 AGV
  const agvDragHolding = useRef(false);              // 滑鼠是否仍按住
  const dragWorld = useRef({ x: 0, y: 0 });          // 目前拖曳到的世界座標
  const justDraggedAgv = useRef(false);              // 抑制放開後緊接的 onClick

  const telemetryRef = useRef<Telemetry | null>(null);
  const selectedAgvIdRef = useRef<string | null>(null);
  const selectedObstacleIdRef = useRef<string | null>(null);
  const lastObstacleFp = useRef<string>('');

  const revealedIndices = useRef<Record<string, number>>({});
  const lastSearchFingerprints = useRef<Record<string, string>>({});
  const displayStates = useRef<Record<string, {x: number, y: number, theta: number, lastUpdate: number}>>({});
  const animationFrameId = useRef<number | undefined>(undefined);

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
    const scale = (w / mapW) * (vs?.zoom || 1);
    return { cx: (x * scale) + vs.offsetX, cy: h - (y * scale) + vs.offsetY };
  }, [mapW]);

  const canvasToWorld = useCallback((cx: number, cy: number, w: number, h: number, vs: any) => {
    const scale = (w / mapW) * (vs?.zoom || 1);
    return { x: (cx - vs.offsetX) / scale, y: (h + vs.offsetY - cy) / scale };
  }, [mapW]);

  // 滾輪縮放：以游標為錨點，維持該世界點在畫面上不動
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const { width: w, height: h } = dimensions;
      const vs = viewStateRef.current;
      const world = canvasToWorld(mx, my, w, h, vs);
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const zoom = Math.min(8, Math.max(0.4, (vs.zoom || 1) * factor));
      const scale = (w / mapW) * zoom;
      viewStateRef.current = { zoom, offsetX: mx - world.x * scale, offsetY: my - (h - world.y * scale) };
      staticNeedsUpdate.current = true;
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [canvasToWorld, mapW, dimensions]);

  // --- 事件處理函式 ---
  // 將滑鼠事件轉為世界座標
  const eventToWorld = (e: React.MouseEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return canvasToWorld(e.clientX - rect.left, e.clientY - rect.top, dimensions.width, dimensions.height, viewStateRef.current);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // 左鍵（非 Alt）且允許拖曳時：若點在某台 AGV 上，開始「拖曳重新定位」
    if (e.button === 0 && !e.altKey && allowAgvDrag) {
      const { x, y } = eventToWorld(e);
      const hit = telemetryRef.current?.agvs.find(a => Math.sqrt((a.x - x) ** 2 + (a.y - y) ** 2) <= 1500);
      if (hit) {
        draggingAgvId.current = hit.id;
        agvDragHolding.current = true;
        dragWorld.current = { x: hit.x, y: hit.y };
        hasDragged.current = false;
        lastMousePos.current = { x: e.clientX, y: e.clientY };
        e.preventDefault();
        return;
      }
    }
    // 支援中鍵 (1)、Alt+左鍵 (0 + alt)、右鍵 (2) 進行平移
    if (e.button === 1 || (e.button === 0 && e.altKey) || e.button === 2) {
        isDragging.current = true;
        hasDragged.current = false;
        lastMousePos.current = { x: e.clientX, y: e.clientY };
        e.preventDefault();
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    // AGV 拖曳中：更新拖曳世界座標（render 迴圈會把該 AGV 畫在此處）
    if (agvDragHolding.current) {
        const dx = e.clientX - lastMousePos.current.x;
        const dy = e.clientY - lastMousePos.current.y;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasDragged.current = true;
        dragWorld.current = eventToWorld(e);
        return;
    }
    if (isDragging.current) {
        const dx = e.clientX - lastMousePos.current.x;
        const dy = e.clientY - lastMousePos.current.y;

        // 如果移動超過 3 像素，則判定為「拖曳平移」，以防止右鍵拖曳觸發點擊行為
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
            hasDragged.current = true;
        }

        viewStateRef.current = { ...viewStateRef.current, offsetX: viewStateRef.current.offsetX + dx, offsetY: viewStateRef.current.offsetY + dy };
        lastMousePos.current = { x: e.clientX, y: e.clientY };
        staticNeedsUpdate.current = true;
        return;
    }
    // 閒置：偵測懸停的 AGV（僅 ref，不觸發 React 重繪；render 迴圈每幀讀取）
    const { x, y } = eventToWorld(e);
    const hit = telemetryRef.current?.agvs.find(a => Math.hypot(a.x - x, a.y - y) <= 1200);
    hoveredAgvId.current = hit ? hit.id : null;
  };

  const handleMouseUp = () => {
    hoveredAgvId.current = null;
    // AGV 拖曳放開：有實際移動才送出 move_agv；否則視為單純點擊（交給 onClick 選取）
    if (agvDragHolding.current) {
        agvDragHolding.current = false;
        const id = draggingAgvId.current;
        if (id && hasDragged.current) {
            onAgvMove?.(id, dragWorld.current.x, dragWorld.current.y);
            justDraggedAgv.current = true;         // 抑制緊接的 onClick
            // draggingAgvId 保留，render 續畫在 dragWorld，直到後端回報到位（見 render 迴圈）
        } else {
            draggingAgvId.current = null;          // 只是點擊，未移動
        }
    }
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

    const scale = (w / mapW) * (vs?.zoom || 1);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);

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
    const rectX = pTopLeft.cx, rectY = pTopLeft.cy;
    const rectW = pBottomRight.cx - pTopLeft.cx, rectH = pBottomRight.cy - pTopLeft.cy;

    // 分層格線：細格(1m，縮太小時省略) + 粗格(5m)，裁切在世界邊界內
    ctx.save();
    ctx.beginPath(); ctx.rect(rectX, rectY, rectW, rectH); ctx.clip();
    const drawLines = (step: number, color: string) => {
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = 0; x <= mapW; x += step) {
        const { cx } = worldToCanvas(x, 0, w, h, vs);
        if (cx < rectX - 1 || cx > rectX + rectW + 1) continue;
        ctx.moveTo(cx, rectY); ctx.lineTo(cx, rectY + rectH);
      }
      for (let y = 0; y <= mapH; y += step) {
        const { cy } = worldToCanvas(0, y, w, h, vs);
        if (cy < rectY - 1 || cy > rectY + rectH + 1) continue;
        ctx.moveTo(rectX, cy); ctx.lineTo(rectX + rectW, cy);
      }
      ctx.stroke();
    };
    if (1000 * scale > 6) drawLines(1000, C.gridMinor); // 縮太小時 1m 線太密，省略
    drawLines(5000, C.gridMajor);
    ctx.restore();

    // 世界邊界
    ctx.strokeStyle = C.border; ctx.lineWidth = 3;
    ctx.strokeRect(rectX, rectY, rectW, rectH);

    // 座標尺規：沿畫面上緣/左緣標示 5m 刻度（螢幕固定，平移縮放皆可見）
    ctx.fillStyle = C.ruler; ctx.font = 'bold 10px monospace';
    for (let x = 0; x <= mapW; x += 5000) {
      const { cx } = worldToCanvas(x, 0, w, h, vs);
      if (cx >= 12 && cx <= w - 2) { ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(`${x / 1000}m`, cx, 3); }
    }
    for (let y = 0; y <= mapH; y += 5000) {
      const { cy } = worldToCanvas(0, y, w, h, vs);
      if (cy >= 8 && cy <= h - 2) { ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(`${y / 1000}m`, 3, cy); }
    }

    if (telemetry) {
        telemetry.obstacles.filter(ob => ob.type !== 'equipment').forEach(ob => {
            const { cx, cy } = worldToCanvas(ob.x, ob.y, w, h, vs);
            const isSelected = selectedObstacleIdRef.current === ob.id;
            ctx.save(); ctx.translate(cx, cy);
            if (ob.type === 'circle') {
                const r = (ob.radius || 500) * scale;
                ctx.fillStyle = isSelected ? C.obstacleSel : C.obstacle; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = C.obstacleStroke; ctx.lineWidth = isSelected ? 3 : 2; ctx.stroke();
            } else {
                ctx.rotate(-(ob.angle || 0));
                const ow = (ob.width || 0) * scale, oh = (ob.height || 0) * scale;
                ctx.fillStyle = isSelected ? C.obstacleSel : C.obstacle; ctx.fillRect(-ow/2, -oh/2, ow, oh);
                ctx.strokeStyle = C.obstacleStroke; ctx.lineWidth = isSelected ? 3 : 2; ctx.strokeRect(-ow/2, -oh/2, ow, oh);
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
    const scale = (w / mapW) * (vs?.zoom || 1);

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
      // 拖曳重新定位：把該 AGV 畫在拖曳點；放開後續畫在該點直到後端回報到位
      if (draggingAgvId.current === a.id) {
        const dsx = displayStates.current[a.id];
        dsx.x = dragWorld.current.x; dsx.y = dragWorld.current.y;
        if (!agvDragHolding.current && Math.hypot(a.x - dragWorld.current.x, a.y - dragWorld.current.y) < 300) {
          draggingAgvId.current = null; // 後端已到位，解除覆寫
        }
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
            ctx.fillStyle = 'rgba(46, 125, 209, 0.12)';
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
      ctx.strokeStyle = isSelected ? C.target : C.targetIdle; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, 12 * pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-15, 0); ctx.lineTo(15, 0); ctx.moveTo(0, -15); ctx.lineTo(0, 15); ctx.stroke();
      ctx.restore();

      if (isSelected && a.path) {
        // 流動虛線：粗實藍線 + 流動偏移
        ctx.save(); ctx.setLineDash([7, 5]); ctx.lineDashOffset = -(now / 40) % 12;
        ctx.strokeStyle = C.pathSel; ctx.lineWidth = 3; ctx.beginPath();
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
            ctx.strokeStyle = C.pathSel;
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
        ctx.save(); ctx.strokeStyle = C.occupancy;
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
                ctx.save(); ctx.setLineDash([5, 5]); ctx.strokeStyle = link.type === 'WAITING' ? 'rgba(199, 120, 0, 0.9)' : 'rgba(122, 63, 201, 0.9)';
                ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(p1.cx, p1.cy); ctx.lineTo(p2.cx, p2.cy); ctx.stroke();
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
                ctx.save(); ctx.setLineDash([8, 4]); ctx.strokeStyle = task.status === 'ASSIGNED' ? 'rgba(21, 153, 71, 0.75)' : 'rgba(46, 125, 209, 0.7)';
                ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(p1.cx, p1.cy); ctx.lineTo(p2.cx, p2.cy); ctx.stroke();
                const midX = (p1.cx + p2.cx) / 2, midY = (p1.cy + p2.cy) / 2;
                ctx.setLineDash([]); ctx.lineWidth = 3; ctx.strokeStyle = '#FFF8E7';
                ctx.font = `bold 11px monospace`; ctx.textAlign = 'center';
                ctx.strokeText(task.status, midX, midY - 5);
                ctx.fillStyle = task.status === 'ASSIGNED' ? C.target : '#2E7DD1';
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
      const r = Math.max(0.1, 8 * scale);
      // Neubrutalism：平塗車體 + 純黑粗邊 + 硬式偏移投影（選中改藍色投影）
      ctx.shadowColor = isSelected ? C.agvSel : '#000000';
      ctx.shadowBlur = 0; ctx.shadowOffsetX = isSelected ? 4 : 3; ctx.shadowOffsetY = isSelected ? 4 : 3;
      ctx.fillStyle = C.agvBody;
      ctx.beginPath(); ctx.moveTo(-sz/2 + r, -sz/2); ctx.lineTo(sz/2 - r, -sz/2);
      ctx.quadraticCurveTo(sz/2, -sz/2, sz/2, -sz/2 + r); ctx.lineTo(sz/2, sz/2 - r);
      ctx.quadraticCurveTo(sz/2, sz/2, sz/2 - r, sz/2); ctx.lineTo(-sz/2 + r, sz/2);
      ctx.quadraticCurveTo(-sz/2, sz/2, -sz/2, sz/2 - r); ctx.lineTo(-sz/2, -sz/2 + r);
      ctx.quadraticCurveTo(-sz/2, -sz/2, -sz/2 + r, -sz/2); ctx.fill();
      // 投影只作用於填色；描邊要清晰，先關閉陰影（沿用同一路徑）
      ctx.shadowColor = 'transparent'; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
      ctx.strokeStyle = isSelected ? C.agvSel : C.agvStroke; ctx.lineWidth = isSelected ? 4 : 3; ctx.stroke();
      // 中央輪轂
      ctx.beginPath(); ctx.arc(0, 0, Math.max(0.1, sz/5), 0, Math.PI * 2); ctx.fillStyle = C.agvHub; ctx.fill();
      // 車頭方向箭頭
      ctx.fillStyle = C.agvArrow;
      ctx.beginPath(); ctx.moveTo(sz/2 - 4, 0); ctx.lineTo(sz/2 - 16, -11); ctx.lineTo(sz/2 - 16, 11); ctx.fill();
      // 狀態 LED（平塗語意色 + 黑框，取代發光）
      const ledColor = STATUS_COLORS[a.status] || (a.is_running ? C.target : '#6e7681');
      ctx.beginPath(); ctx.arc(-sz/2 + 15, -sz/2 + 15, 5, 0, Math.PI * 2);
      ctx.fillStyle = ledColor; ctx.fill();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();
      if (a.has_goods) {
          ctx.fillStyle = C.cargo; ctx.strokeStyle = C.cargoStroke; ctx.lineWidth = 2;
          const cargoSize = sz * 0.4; ctx.fillRect(-cargoSize/2, -cargoSize/2, cargoSize, cargoSize);
          ctx.strokeRect(-cargoSize/2, -cargoSize/2, cargoSize, cargoSize);
      }
      ctx.restore();

      // 標籤只在「懸停」或「選中」時顯示，並置於車體外側，避免蓋住 AGV 本體。
      if (isSelected || hoveredAgvId.current === a.id) {
        const idY = cy - Math.max(sz / 2 + 12, 16);
        ctx.font = `bold 11px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const idw = ctx.measureText(a.id).width;
        rr(ctx, cx - idw / 2 - 5, idY - 8, idw + 10, 16, 0);
        ctx.fillStyle = C.labelBg; ctx.fill();
        ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = C.label; ctx.fillText(a.id, cx, idY);
        drawStatusPill(ctx, cx, cy + Math.max(sz / 2 + 12, 16), a.status);
      }
    });

    currentTelemetry.obstacles.filter(ob => ob.type === 'equipment').forEach(ob => {
      const { cx, cy } = worldToCanvas(ob.x, ob.y, w, h, vs);
      const isSelected = selectedObstacleIdRef.current === ob.id;
      const isAutoSource = autoTaskSourceId === ob.id;
      const size = (ob.radius || 1000) * scale;
      const baseColor = EQUIP_COLORS[ob.status || 'running'] || EQUIP_COLORS.running;
      const dockingAngle = ob.docking_angle !== undefined ? ob.docking_angle : 0;
      const angleRad = (dockingAngle * Math.PI) / 180;
      ctx.save(); ctx.translate(cx, cy);
      ctx.rotate(-angleRad + Math.PI);
      const iconScale = size / 50; ctx.scale(iconScale, iconScale);
      ctx.fillStyle = (isSelected || isAutoSource) ? C.obstacleSel : baseColor;
      ctx.fill(stationPath2D); ctx.strokeStyle = '#000'; ctx.lineWidth = 3 / iconScale;
      ctx.stroke(stationPath2D); ctx.beginPath(); ctx.arc(0, 0, 5 / iconScale, 0, Math.PI * 2); ctx.fillStyle = '#000'; ctx.fill();
      if (ob.has_goods) {
          ctx.fillStyle = C.cargo; ctx.strokeStyle = C.cargoStroke; ctx.lineWidth = 2 / iconScale;
          const cargoSize = 40; ctx.fillRect(-cargoSize/2, -cargoSize/2, cargoSize, cargoSize); ctx.strokeRect(-cargoSize/2, -cargoSize/2, cargoSize, cargoSize);
      }
      ctx.restore();
      if (ob.docking_angle !== undefined) {
          ctx.save(); ctx.translate(cx, cy); const angleRad = (ob.docking_angle * Math.PI) / 180; ctx.rotate(-angleRad + Math.PI);
          ctx.strokeStyle = C.docking; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(size * 0.8, 0);
          ctx.lineTo(size * 0.6, -size * 0.1); ctx.moveTo(size * 0.8, 0); ctx.lineTo(size * 0.6, size * 0.1); ctx.stroke(); ctx.restore();
      }
      ctx.save(); ctx.translate(cx, cy); ctx.font = `bold 12px monospace`; ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = '#FFF8E7'; ctx.strokeText(ob.id, 0, -size - 10);
      ctx.fillStyle = '#000'; ctx.fillText(ob.id, 0, -size - 10); ctx.restore();
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
        style={{ border: '3px solid #000', borderRadius: 0, background: '#FFF8E7', boxShadow: '6px 6px 0 #000', cursor: agvDragHolding.current ? 'grabbing' : (allowAgvDrag ? 'grab' : (isDragging.current ? 'grabbing' : 'crosshair')) }}
        onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
        onClick={(e) => {
            if (e.altKey) return;
            if (justDraggedAgv.current) { justDraggedAgv.current = false; return; } // 剛拖曳完 AGV，不觸發選取
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
      <button style={{ position: 'absolute', bottom: '20px', right: '20px', opacity: 0.6 }} onClick={() => { viewStateRef.current = { offsetX: 0, offsetY: 0, zoom: 1 }; staticNeedsUpdate.current = true; }}>
        RESET VIEW
      </button>
    </div>
  );
};

export default SimulatorCanvas;
