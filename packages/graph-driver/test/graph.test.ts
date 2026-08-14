import { describe, expect, it } from "vitest";
import { encodeNodeRadius, MAX_RADIUS } from "../src/graph-encode.js";
import { layoutGraph, translateGraph, type GraphData } from "../src/index.js";

describe("encodeNodeRadius（3-5 大小编码）", () => {
  it("n=0 → 12（最小）", () => {
    expect(encodeNodeRadius(0)).toBe(12);
  });
  it("n=1 → 15（对数最小非零档）", () => {
    expect(encodeNodeRadius(1)).toBe(15);
  });
  it("n≥63 → 30 封顶（n=63 边界 / n=100 超出）", () => {
    expect(encodeNodeRadius(63)).toBe(MAX_RADIUS);
    expect(encodeNodeRadius(100)).toBe(MAX_RADIUS);
  });
  it("负值防御 clamp 0", () => {
    expect(encodeNodeRadius(-5)).toBe(12);
  });
});

describe("layoutGraph（3-5 树布局）", () => {
  it("单根：全部根层 y=0，同层按数组序", () => {
    const data: GraphData = {
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      edges: [],
    };
    const pos = layoutGraph(data);
    expect(pos.a.y).toBe(0);
    expect(pos.b.y).toBe(0);
    expect(pos.a.x).toBeLessThan(pos.b.x);
  });

  it("多分支：父子分层（from=父 to=子），深度正确", () => {
    const data: GraphData = {
      nodes: [
        { id: "root", label: "根" },
        { id: "c1", label: "子1" },
        { id: "c2", label: "子2" },
        { id: "g", label: "孙" },
      ],
      edges: [
        { from: "root", to: "c1" },
        { from: "root", to: "c2" },
        { from: "c1", to: "g" },
      ],
    };
    const pos = layoutGraph(data);
    expect(pos.root.y).toBe(0);
    expect(pos.c1.y).toBe(160);
    expect(pos.c2.y).toBe(160);
    expect(pos.g.y).toBe(320);
  });

  it("环/自指防御：沿父链 seen 守卫，不无限递归，落根层", () => {
    const data: GraphData = {
      nodes: [
        { id: "x", label: "X" },
        { id: "y", label: "Y" },
      ],
      edges: [
        { from: "x", to: "y" },
        { from: "y", to: "x" }, // 环
        { from: "z", to: "z" }, // 自指（z 不存在也不崩）
      ],
    };
    const pos = layoutGraph(data);
    expect(pos.x.y).toBe(0);
    expect(pos.y.y).toBe(0);
  });
});

describe("translateGraph（3-5 默认转译器）", () => {
  it("节点 + 边 → markdown 列表（group/label 带上）", () => {
    const data: GraphData = {
      nodes: [
        { id: "a", label: "读文件", group: "步骤" },
        { id: "b", label: "总结" },
      ],
      edges: [{ from: "a", to: "b", label: "依赖" }],
    };
    const out = translateGraph(data);
    expect(out).toContain("## 图谱");
    expect(out).toContain("- a: 读文件（步骤）");
    expect(out).toContain("- b: 总结");
    expect(out).toContain("- a → b：依赖");
  });

  it("空图 → 占位（无节点/无边）", () => {
    const out = translateGraph({ nodes: [], edges: [] });
    expect(out).toContain("（无节点）");
    expect(out).toContain("（无边）");
  });
});
