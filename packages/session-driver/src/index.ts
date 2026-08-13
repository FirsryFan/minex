import type { DriverContext } from "@minex/kernel";
import { createSessionStore, type SessionFsOps, type SessionStore } from "./store.js";

/**
 * Mist 会话驱动（id: mist.session）。
 * S1：纯数据层——注册 `session` 能力（store：.ses 读写 + 索引 + 总览查询）。
 * 依赖 minex.filesystem（FileSystemAbility.ensureDir 建会话文件夹）。
 * UI（总览面板 / 会话视图 / 画布）后续阶段接入。
 */
export default {
  async activate(ctx: DriverContext) {
    const fs = ctx.get<SessionFsOps>("filesystem", "default");
    if (!fs) {
      throw new Error("mist.session 依赖 minex.filesystem 能力，但未找到");
    }
    const store: SessionStore = createSessionStore(fs);
    ctx.register("session", "default", store);
    return () => {};
  },
};
