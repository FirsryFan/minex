import { describe, expect, it } from "vitest";
import { fillTemplate, QUICK_PHRASES, type QuickPhrase } from "../src/quick-phrase.js";

function tpl(text: string, slots: Array<{ key: string; label: string }> = []): QuickPhrase {
  return { id: "t", title: "T", slots, text };
}

describe("fillTemplate", () => {
  it("全填：所有 {key} 替换为 values", () => {
    const q = QUICK_PHRASES.find((x) => x.id === "qp.deep-research")!;
    expect(fillTemplate(q, { selection: "会话树", focus: "环检测", requirement: "分点" })).toBe(
      "请针对「会话树」做深入研究，重点方向：环检测。要求：分点",
    );
  });

  it("缺槽保留占位：values 缺该 key → {key} 原样保留", () => {
    const q = QUICK_PHRASES.find((x) => x.id === "qp.deep-research")!;
    expect(fillTemplate(q, { selection: "会话树" })).toBe(
      "请针对「会话树」做深入研究，重点方向：{focus}。要求：{requirement}",
    );
  });

  it("多余值忽略：模板无该占位 → 不影响输出；多次出现全部替换", () => {
    expect(fillTemplate(tpl("a={x} b={x} c={y}"), { x: "1", y: "2", z: "3" })).toBe("a=1 b=1 c=2");
  });

  it("空 values → 原样返回（全占位保留）", () => {
    expect(fillTemplate(tpl("你好 {name}"), {})).toBe("你好 {name}");
  });
});
