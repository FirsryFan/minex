/** 深/浅色切换按钮（主题状态由 App 持有，本组件只负责 UI） */
export function ThemeToggle({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  return (
    <button
      className="icon-btn theme-toggle"
      title={dark ? "切换浅色" : "切换深色"}
      onClick={onToggle}
    >
      {dark ? "☀️" : "🌙"}
    </button>
  );
}
