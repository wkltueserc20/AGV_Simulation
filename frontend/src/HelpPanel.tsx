// 新手說明面板：三步流程 + 模式速查 + 畫布操作。首次進入自動顯示一次。
interface Props {
  onClose: () => void;
}

const MODE_HELP: { icon: string; name: string; desc: string }[] = [
  { icon: '🔍', name: 'SELECT 選擇', desc: '純瀏覽。點物件看參數，不會誤改。' },
  { icon: '🖱️', name: 'SINGLE 單動', desc: '點選 AGV 後，右鍵畫布設定導航目標點。' },
  { icon: '🤖', name: 'AUTO 自動', desc: '兩步指派任務：先點起點（有貨設備/車）再點終點。' },
  { icon: '⭐', name: 'EQUIPMENT 設備', desc: '點空白處新增設備；側邊欄可部署/移除 AGV。' },
  { icon: '🧱', name: 'SQUARE 方塊', desc: '點空白處新增方形障礙物，雙擊可刪除。' },
  { icon: '⭕', name: 'CIRCLE 圓形', desc: '點空白處新增圓形障礙物，雙擊可刪除。' },
];

function HelpPanel({ onClose }: Props) {
  return (
    <div className="help-backdrop" onClick={onClose}>
      <div className="help-modal" role="dialog" aria-modal="true" aria-label="使用說明" onClick={(e) => e.stopPropagation()}>
        <div className="help-head">
          <h2 style={{ margin: 0 }}>👋 快速上手</h2>
          <button className="help-close" aria-label="關閉說明" onClick={onClose}>✕</button>
        </div>

        <section className="help-section">
          <h3>三步驟開始</h3>
          <ol className="help-steps">
            <li><b>部署 AGV</b>：切到 <b>⭐ 設備</b>模式，按側邊欄「+ 部署新 AGV」再點畫布空白處。</li>
            <li><b>佈置場地</b>：用 <b>⭐ 設備 / 🧱 方塊 / ⭕ 圓形</b>模式點畫布，放置設備與障礙物。</li>
            <li><b>指派任務</b>：切到 <b>🤖 AUTO</b>，先點「有貨的設備」當起點，再點目標設備完成搬運指派。</li>
          </ol>
        </section>

        <section className="help-section">
          <h3>六種模式</h3>
          <div className="help-modes">
            {MODE_HELP.map(m => (
              <div key={m.name} className="help-mode-row">
                <span className="help-mode-name">{m.icon} {m.name}</span>
                <span className="help-mode-desc">{m.desc}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="help-section">
          <h3>畫布操作</h3>
          <ul className="help-list">
            <li><b>縮放</b>：滑鼠滾輪（以游標為中心）</li>
            <li><b>平移</b>：按住滑鼠右鍵、滾輪中鍵，或 Alt + 左鍵拖曳</li>
            <li><b>重設視角</b>：畫布右下角「RESET VIEW」</li>
          </ul>
        </section>

        <div className="help-foot">
          <button className="primary" onClick={onClose}>開始使用</button>
        </div>
      </div>
    </div>
  );
}

export default HelpPanel;
