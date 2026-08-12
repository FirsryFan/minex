import type { EventHandler } from "./types.js";

/** 事件总线：插件间、插件与 UI 间的消息通道（主题精确匹配） */
export interface EventBus {
  emit(topic: string, payload?: unknown): void;
  /** 订阅事件，返回取消订阅函数 */
  on(topic: string, handler: EventHandler): () => void;
  off(topic: string, handler: EventHandler): void;
}

export function createEventBus(): EventBus {
  const handlers = new Map<string, Set<EventHandler>>();

  return {
    emit(topic, payload) {
      const set = handlers.get(topic);
      if (set) for (const h of [...set]) h(payload, topic); // 复制迭代：允许 handler 在回调中退订
    },
    on(topic, handler) {
      let set = handlers.get(topic);
      if (!set) {
        set = new Set();
        handlers.set(topic, set);
      }
      set.add(handler);
      return () => set!.delete(handler);
    },
    off(topic, handler) {
      handlers.get(topic)?.delete(handler);
    },
  };
}
