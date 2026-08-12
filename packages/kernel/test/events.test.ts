import { describe, expect, it } from "vitest";
import { createEventBus } from "../src/index.js";

describe("event bus", () => {
  it("delivers events to subscribers with payload and topic", () => {
    const bus = createEventBus();
    const received: unknown[] = [];
    bus.on("t", (p, topic) => received.push([p, topic]));
    bus.emit("t", 42);
    expect(received).toEqual([[42, "t"]]);
  });

  it("unsubscribe stops delivery", () => {
    const bus = createEventBus();
    let count = 0;
    const off = bus.on("t", () => count++);
    bus.emit("t");
    off();
    bus.emit("t");
    expect(count).toBe(1);
  });

  it("unsubscribing during emit is safe (snapshot iteration)", () => {
    const bus = createEventBus();
    let count = 0;
    const off = bus.on("t", () => {
      off();
      count++;
    });
    bus.on("t", () => count++);
    bus.emit("t");
    expect(count).toBe(2);
  });

  it("topics are isolated", () => {
    const bus = createEventBus();
    let a = 0;
    let b = 0;
    bus.on("a", () => a++);
    bus.on("b", () => b++);
    bus.emit("a");
    expect(a).toBe(1);
    expect(b).toBe(0);
  });

  it("explicit off stops delivery", () => {
    const bus = createEventBus();
    let count = 0;
    const handler = () => count++;
    bus.on("t", handler);
    bus.emit("t");
    bus.off("t", handler);
    bus.emit("t");
    expect(count).toBe(1);
  });

  it("a throwing handler does not block others", () => {
    const bus = createEventBus();
    const received: number[] = [];
    bus.on("t", () => {
      throw new Error("boom");
    });
    bus.on("t", (p) => received.push(p as number));
    expect(() => bus.emit("t", 1)).not.toThrow();
    expect(received).toEqual([1]);
  });
});
