import type { DriverContext } from "@minex/kernel";
import { addLink, addNode, createSession, rebuildFromMarkdown, toMarkdown, validateSession, type Session } from "./session.js";
import { addOutlineEntry, buildContext, deriveBranches } from "./session-tree.js";
import { createSessionStore, type SessionFsOps, type SessionStore } from "./store.js";

/**
 * Mist 会话驱动（id: mist.session）。
 * S1：注册 `session` 能力（store：.ses 读写 + 索引 + 总览查询）。
 * S2：注册 `session.md` 能力（会话主链的 markdown 视图：渲染 / 校验 / 保存）——
 *      供 markdown 驱动打开 .ses 时消费（结构类型接，跨包零源码 import）。
 * 2-2：注册 `session.tree` 能力（会话树纯函数：buildContext/deriveBranches/addNode/addLink）——
 *      供 agent 聊天等驱动跨包消费（同「跨包零源码 import」约定，纯函数经能力桥接）。
 * 2-3：session.tree 增 createSession（浮窗子对话建会话用）。
 * 2-4：session.tree 增 addOutlineEntry（大纲记忆追加，agent 加工 hook 消费）。
 * 依赖 minex.filesystem（FileSystemAbility.ensureDir 建会话文件夹）。
 */
export default {
  async activate(ctx: DriverContext) {
    const fs = ctx.get<SessionFsOps>("filesystem", "default");
    if (!fs) {
      throw new Error("mist.session 依赖 minex.filesystem 能力，但未找到");
    }
    const rawStore = createSessionStore(fs);
    // G-A 反馈 2：会话数据变更（保存/删除）统一 emit minex:dataChanged——图谱/总览/文件树订阅即刷新；
    // 包装 store 供 session 能力与 session.md 保存共用（所有会话变更路径都 emit）
    const emitChanged = (): void => ctx.emit("minex:dataChanged", { driverId: "mist.session" });
    const store: SessionStore = {
      ...rawStore,
      async saveSession(s: Session): Promise<void> {
        await rawStore.saveSession(s);
        emitChanged();
      },
      async deleteSession(id: string): Promise<void> {
        await rawStore.deleteSession(id);
        emitChanged();
      },
    };
    ctx.register("session", "default", store);

    // 会话树纯函数（2-1/2-3/2-4）：buildContext / deriveBranches / addNode / addLink / createSession / addOutlineEntry
    ctx.register("session.tree", "default", { buildContext, deriveBranches, addNode, addLink, createSession, addOutlineEntry });

    // 面板：会话总览（左栏；搜索 / 标签筛选 / 列表 / 新建，点击打开 .ses 对话模式）——P2：总览归左栏
    ctx.register("panel", "mist.session.overview", {
      driverId: "mist.session",
      id: "mist.session.overview",
      title: "会话",
      defaultDock: "left",
      load: () => import("./overview-view.js"),
    });

    // 面板：会话系（左栏；图谱树形画布 + 大纲 tab，P2/P3）——icon 映射 Network 由外壳 panel-icons 维护
    ctx.register("panel", "mist.session.graph", {
      driverId: "mist.session",
      id: "mist.session.graph",
      title: "会话系",
      defaultDock: "left",
      load: () => import("./graph-view.js"),
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
