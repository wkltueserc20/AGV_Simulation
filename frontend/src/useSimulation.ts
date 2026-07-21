import { useState, useEffect, useCallback, useRef } from 'react';

export interface AGVData {
  id: string; x: number; y: number; theta: number;
  v: number; omega: number;
  l_rpm: number; r_rpm: number;
  max_rpm: number; is_running: boolean;
  is_planning: boolean;
  status: string;
  has_goods?: boolean;
  target: { x: number; y: number };
  path: [number, number][];
  visited?: [number, number][];
  culprit_id?: string;
  evasion_target?: { x: number; y: number };
  current_travel_time?: number;
  last_travel_time?: number;
}

// 障礙物/設備：三種 type 共用一個介面，幾何欄位依 type 選填
export interface Obstacle {
  id: string;
  type: 'rectangle' | 'circle' | 'equipment';
  x: number;
  y: number;
  width?: number;   // rectangle
  height?: number;  // rectangle
  angle?: number;   // rectangle
  radius?: number;  // circle / equipment
  status?: 'normal' | 'running' | 'error'; // equipment
  docking_angle?: number;                  // equipment
  has_goods?: boolean;                      // equipment
}

export interface Task {
  id: string;
  source_id?: string | null;
  target_id?: string | null;
  agv_id?: string | null;
  status?: string;
  execution_time?: number;
}

export interface SocialLink {
  from: string;
  to: string;
  type: string;
}

export interface Telemetry {
  agvs: AGVData[];
  obstacles: Obstacle[];
  multiplier: number;
  social_links?: SocialLink[];
  path_occupancy?: Record<string, [number, number][]>;
  reserved_havens?: Record<string, [number, number]>;
  task_queue?: Task[];
  task_history?: Task[];
}

export const useSimulation = (url: string) => {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<number | null>(null);

  const connect = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) return;

    const socket = new WebSocket(url);
    ws.current = socket;

    socket.onopen = () => setIsConnected(true);
    socket.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'telemetry') setTelemetry(msg.data);
      } catch (err) { console.error(err); }
    };
    socket.onclose = () => {
      setIsConnected(false);
      // 延遲重連
      reconnectRef.current = window.setTimeout(connect, 3000);
    };
    socket.onerror = () => socket.close();
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (ws.current) {
        ws.current.onclose = null;
        ws.current.close();
      }
    };
  }, [connect]);

  const sendCommand = useCallback((type: string, payload?: any) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type, ...payload }));
    }
  }, []);

  return { telemetry, isConnected, sendCommand };
};
