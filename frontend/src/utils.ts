// 共用純函式（從 App.tsx 抽出）

export const snapToCenter = (val: number) => Math.floor(val / 1000) * 1000 + 500;
export const snapToIntersection = (val: number) => Math.round(val / 1000) * 1000;

export const radToDeg = (rad: number) => {
  let deg = (rad * 180) / Math.PI;
  while (deg < 0) deg += 360;
  return Math.round(deg % 360);
};

export const formatSimTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}分${secs.toString().padStart(2, '0')}秒`;
};

// demo: 自我檢查，跑 `node --experimental-strip-types utils.ts` 或匯入後呼叫
export function _demo() {
  console.assert(snapToCenter(1200) === 1500, 'snapToCenter');
  console.assert(snapToIntersection(1400) === 1000, 'snapToIntersection');
  console.assert(radToDeg(Math.PI) === 180, 'radToDeg 180');
  console.assert(radToDeg(-Math.PI / 2) === 270, 'radToDeg neg');
  console.assert(formatSimTime(65) === '1分05秒', 'formatSimTime');
}
