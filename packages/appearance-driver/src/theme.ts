/** 主题模型（index.ts 与 settings-view.tsx 共享，避免循环依赖） */
export interface Theme {
  id: string;
  name: string;
  version: string;
  author: string;
  mode: "light" | "dark";
  preview?: string;
  readOnly?: boolean;
  settings?: Record<string, unknown>;
}

/** 初始主题：默认浅色 + 默认深色（activate 时持久化到 storage，保证 apply 能读到） */
export const DEFAULT_THEMES: Theme[] = [
  {
    id: "default-light", name: "默认浅色", version: "1.0.0", author: "Minex", mode: "light",
    settings: { primaryColor: "#2563eb", backgroundColor: "#f3f6fb", warningColor: "#f59e0b", dangerColor: "#ef4444", zhFont: "Microsoft YaHei", enFont: "Arial", iconTheme: "默认" },
  },
  {
    id: "default-dark", name: "默认深色", version: "1.0.0", author: "Minex", mode: "dark",
    settings: { primaryColor: "#3b82f6", backgroundColor: "#0f172a", warningColor: "#f59e0b", dangerColor: "#ef4444", zhFont: "Microsoft YaHei", enFont: "Arial", iconTheme: "默认" },
  },
];

export const THEMES_KEY = "themes";
