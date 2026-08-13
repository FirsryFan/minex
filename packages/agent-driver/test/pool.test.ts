import { describe, expect, it } from "vitest";
import { createEventBus } from "@minex/kernel";
import { onEnvelope, sendEnvelope } from "../src/envelope.js";
import { createPool, type PoolStore } from "../src/pool.js";

function makeStore(): PoolStore {
  const map = new Map<string, unknown>();
  return {
    get: (key) => map.get(key),
    set: (key, value) => {
      map.set(key, value);
    },
  };
}

describe("pool", () => {
  it("写后读一致 + onChanged 收到失效通知", () => {
    const bus = createEventBus();
    const pool = createPool(makeStore(), bus);
    const changed: string[] = [];
    const off = pool.onChanged((key) => changed.push(key));
    pool.write("goal", "完成任务");
    expect(pool.read("goal")).toBe("完成任务");
    expect(changed).toEqual(["goal"]);
    off();
  });

  it("expert 申请→批准→写闭环（mock manager）", () => {
    const bus = createEventBus();
    const pool = createPool(makeStore(), bus);
    const trace: string[] = [];

    // manager 监听 pool-request → 回 pool-grant
    onEnvelope(bus, "manager", (env) => {
      if (env.type === "pool-request") {
        trace.push("request");
        sendEnvelope(bus, { from: "manager", to: "expert", type: "pool-grant", payload: { key: "goal" } });
      }
    });
    // expert 监听 pool-grant → write
    onEnvelope(bus, "expert", (env) => {
      if (env.type === "pool-grant") {
        trace.push("grant");
        pool.write("goal", "专家产出");
      }
    });

    sendEnvelope(bus, { from: "expert", to: "manager", type: "pool-request", payload: { key: "goal" } });
    expect(trace).toEqual(["request", "grant"]);
    expect(pool.read("goal")).toBe("专家产出");
  });

  it("不同 key 独立存储", () => {
    const bus = createEventBus();
    const pool = createPool(makeStore(), bus);
    pool.write("a", 1);
    pool.write("b", 2);
    expect(pool.read("a")).toBe(1);
    expect(pool.read("b")).toBe(2);
    expect(pool.read("c")).toBeUndefined();
  });
});
