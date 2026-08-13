/**
 * 协议信封（S5e）：agent 间通信的最小约定。
 * 必填三字段（from/to/type）= 寻址 + 生命周期；可选字段有默认值；payload 承载一切自由内容。
 * 独立于 session 图（session = 用户知识体系，信封 = agent 通信）。
 */

export interface Envelope {
  from: string;
  to: string | "*";
  type: string;
  priority?: number;
  deadline?: number;
  deps?: string[];
  payload: unknown;
}

type Handler = (payload: unknown, topic: string) => void;

/** 事件总线最小接口（ctx.emit/on 与 createEventBus 均兼容） */
export interface EnvelopeBus {
  emit(topic: string, payload?: unknown): void;
  on(topic: string, handler: Handler): () => void;
}

export const ENVELOPE_PREFIX = "agent:envelope";

/**
 * 解析并校验信封：必填 from/to/type 缺失抛错；可选字段取默认（priority=0/deadline=0/deps=[]）；payload 原样透传。
 * 纯函数可测。
 */
export function parseEnvelope(raw: unknown): Envelope {
  if (typeof raw !== "object" || raw === null) throw new Error("Envelope: 必须是对象");
  const r = raw as Record<string, unknown>;
  if (typeof r.from !== "string" || !r.from) throw new Error("Envelope: from 必填");
  if (typeof r.to !== "string" || !r.to) throw new Error("Envelope: to 必填");
  if (typeof r.type !== "string" || !r.type) throw new Error("Envelope: type 必填");
  return {
    from: r.from,
    to: r.to,
    type: r.type,
    priority: typeof r.priority === "number" ? r.priority : 0,
    deadline: typeof r.deadline === "number" ? r.deadline : 0,
    deps: Array.isArray(r.deps) ? r.deps.filter((d): d is string => typeof d === "string") : [],
    payload: r.payload,
  };
}

/** 序列化信封：固定字段序 JSON（from→to→type→priority→deadline→deps→payload）。纯函数可测。 */
export function serializeEnvelope(env: Envelope): string {
  return JSON.stringify({
    from: env.from,
    to: env.to,
    type: env.type,
    priority: env.priority ?? 0,
    deadline: env.deadline ?? 0,
    deps: env.deps ?? [],
    payload: env.payload,
  });
}

/** 发送信封：to==="*" 广播到 `agent:envelope:*`；否则定向到 `agent:envelope:<to>`。 */
export function sendEnvelope(bus: EnvelopeBus, env: Envelope): void {
  const topic = env.to === "*" ? `${ENVELOPE_PREFIX}:*` : `${ENVELOPE_PREFIX}:${env.to}`;
  bus.emit(topic, env);
}

/** 订阅自身信封：定向（`agent:envelope:<to>`）+ 广播（`agent:envelope:*`），返回退订函数。 */
export function onEnvelope(bus: EnvelopeBus, to: string, cb: (env: Envelope) => void): () => void {
  const off1 = bus.on(`${ENVELOPE_PREFIX}:${to}`, (payload) => cb(payload as Envelope));
  const off2 = bus.on(`${ENVELOPE_PREFIX}:*`, (payload) => cb(payload as Envelope));
  return () => {
    off1();
    off2();
  };
}
