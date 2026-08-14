import type { DriverContext } from "@minex/kernel";
import { addLink, addNode, createSession, rebuildFromMarkdown, toMarkdown, validateSession, type Session } from "./session.js";
import { buildContext, deriveBranches } from "./session-tree.js";
import { createSessionStore, type SessionFsOps, type SessionStore } from "./store.js";

/**
 * Mist 会话驱动（id: mist.session）。
 * S1：注册 `session` 能力（store：.ses 读写 + 索引 + 总览查询）。
 * S2：注册 `session.md` 能力（会话主链的 markdown 视图：渲染 / 校验 / 保存）——
 *      供 markdown 驱动打开 .ses 时消费（结构类型接，跨包零源码 import）。
 * 2-2：注册 `session.tree` 能力（会话树纯函数：buildContext/deriveBranches/addNode/addLink）——
 *      供 agent 聊天等驱动跨包消费（同「跨包零源码 import」约定，纯函数经能力桥接）。
 * 2-3：session.tree 增 createSession（浮窗子对话建会话用）。
 * 依赖 minex.filesystem（FileSystemAbility.ensureDir 建会话文件夹）。
 */
export default {
  async activate(ctx: DriverContext) {
    const fs = ctx.get<SessionFsOps>("filesystem", "default");
    if (!fs) {
      throw new Error("mist.session 依赖 minex.filesystem 能力，但未找到");
    }
    const store: SessionStore = createSessionStore(fs);
    ctx.register("session", "default", store);

    // 会话树纯函数（2-1/2-3）：buildContext / deriveBranches / addNode / addLink / createSession（agent 聊天消费）
    ctx.register("session.tree", "default", { buildContext, deriveBranches, addNode, addLink, createSession });

    // 面板：会话总览（右栏；搜索 / 标签筛选 / 列表 / 新建，点击打开 .ses）
    ctx.register("panel", "mist.session.overview", {
      driverId: "mist.session",
      id: "mist.session.overview",
      title: "会话",
      defaultDock: "right",
      load: () => import("./overview-view.js"),
    });

    // 会话 markdown 视图（.ses 主链渲染 + 保存；保存走 store 保证索引一致）
    ctx.register("session.md", "default", {
      toMarkdown,
      isSession: validateSession,
      async saveMarkdown(session: unknown, doc: string): Promise<unknown> {
        const updated = rebuildFromMarkdown(session as Session, doc);
        await store.saveSession(updated);
        return updated;
      },
    });
    return () => {};
  },
};
