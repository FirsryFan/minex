import type { PluginContext } from "@minex/kernel";

/** 命令的运行时形状（handler 在 activate 里补上） */
interface DemoCommand {
  id: string;
  label: string;
  handler?: (name?: string) => string;
}

/** Demo 插件：验证三条通道（UI 贡献 / 命令 / 工具）+ 设置读取 */
export default {
  async activate(ctx: PluginContext) {
    // ① 命令：把 manifest 静态贡献升级成带 handler 的可调用命令
    //   （register 同插件同 id = 更新，UI 在激活前已能看到 label）
    ctx.register<DemoCommand>("command", "demo.sayHello", {
      id: "demo.sayHello",
      label: "Say Hello",
      handler: (name?: string) => `Hello, ${name ?? "world"}!`,
    });

    // ② 工具：agent 插件未来可发现的工具（priority 10 演示优先级）
    ctx.register("tool", "demo.greet", (name: string) => `Greetings, ${name}.`, {
      priority: 10,
    });

    // ③ 设置：从自己的存储读配置（值由 UI/CLI 写入）
    const config = ctx.storage.get<{ greeting?: string }>("config");
    ctx.log.info(`demo activated; greeting = ${config?.greeting ?? "(unset)"}`);

    return () => ctx.log.info("demo deactivated");
  },
};
