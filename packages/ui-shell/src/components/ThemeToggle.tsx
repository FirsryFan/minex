import { useEffect, useState } from "react";

const STORAGE_KEY = "minex.theme";

/** 深/浅色一键切换：改 documentElement.dataset.theme + localStorage 持久化 */
export function ThemeToggle() {
  const [dark, setDark] = useState<boolean>(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    return saved ? saved === "dark" : false; // 默认浅色（与 theme.css 基座一致）
  });

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try {
      localStorage.setItem(STORAGE_KEY, dark ? "dark" : "light");
    } catch {
      // localStorage 不可用（隐私模式等）——仅本次会话生效
    }
  }, [dark]);

  return (
    <button
      className="icon-btn theme-toggle"
      title={dark ? "切换浅色" : "切换深色"}
      onClick={() => setDark((d) => !d)}
    >
      {dark ? "☀️" : "🌙"}
    </button>
  );
}
