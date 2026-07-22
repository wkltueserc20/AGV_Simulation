// AGV 狀態的顯示中繼資料：圖例 (StatusLegend) 與車隊卡 (FleetPanel) 共用，避免重複定義。
// emoji 對應 SimulatorCanvas 的 statusEmojis；color 供狀態文字/圓點著色。
export interface StatusMeta { emoji: string; zh: string; color: string; }

// 顏色為「亮底可讀」版本：既當狀態文字（需對比）也當圖例方塊填色（帶黑邊）。
export const STATUS_META: Record<string, StatusMeta> = {
  IDLE:      { emoji: '💤', zh: '待命',   color: '#4a4a4a' },
  PLANNING:  { emoji: '🔄', zh: '規劃中', color: '#C77800' },
  EXECUTING: { emoji: '🚚', zh: '執行中', color: '#159947' },
  EVADING:   { emoji: '🛡️', zh: '避讓中', color: '#7A3FC9' },
  BLOCKED:   { emoji: '🚧', zh: '受阻',   color: '#C77800' },
  STUCK:     { emoji: '⚠️', zh: '卡住',   color: '#D62828' },
  ERROR:     { emoji: '❌', zh: '錯誤',   color: '#D62828' },
  LOADING:   { emoji: '📥', zh: '取貨中', color: '#2E7DD1' },
  UNLOADING: { emoji: '📤', zh: '卸貨中', color: '#2E7DD1' },
};

export const statusColor = (status: string) => STATUS_META[status]?.color ?? '#4a4a4a';

// 圖例顯示的核心狀態（新手最常見到的幾種）
export const LEGEND_KEYS = ['IDLE', 'PLANNING', 'EXECUTING', 'EVADING', 'BLOCKED', 'ERROR'] as const;
