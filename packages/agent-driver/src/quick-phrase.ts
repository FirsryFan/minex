/**
 * quick phrase 模板（task 2-R1，P4 拍板）：
 * 固定模板 + 待填入槽位（{key} 占位），框选内容自动注入 {selection} 槽。
 */

/** 待填入槽位 */
export interface QuickPhraseSlot {
  key: string;
  label: string;
  placeholder?: string;
}

/** quick phrase 模板：text 含 {key} 占位符 */
export interface QuickPhrase {
  id: string;
  title: string;
  slots: QuickPhraseSlot[];
  text: string;
}

/**
 * 填充模板：把 values[key] 替换进 {key} 占位。
 * 缺槽（values 无该 key）→ 保留原占位符；多余值（模板无该 key）→ 忽略。
 */
export function fillTemplate(template: QuickPhrase, values: Record<string, string>): string {
  let out = template.text;
  for (const [k, v] of Object.entries(values)) {
    out = out.split(`{${k}}`).join(v);
  }
  return out;
}

/** 内置模板（P4：3 个；selection 槽由框选内容自动填入） */
export const QUICK_PHRASES: QuickPhrase[] = [
  {
    id: "qp.deep-research",
    title: "深层研究",
    slots: [
      { key: "selection", label: "内容" },
      { key: "focus", label: "重点方向", placeholder: "如：架构、性能" },
      { key: "requirement", label: "要求", placeholder: "如：分点、注明来源" },
    ],
    text: "请针对「{selection}」做深入研究，重点方向：{focus}。要求：{requirement}",
  },
  {
    id: "qp.summarize",
    title: "总结提炼",
    slots: [
      { key: "selection", label: "内容" },
      { key: "format", label: "输出格式", placeholder: "如：要点列表" },
    ],
    text: "请总结「{selection}」的核心要点，输出格式：{format}",
  },
  {
    id: "qp.rewrite",
    title: "修改重写",
    slots: [
      { key: "selection", label: "内容" },
      { key: "requirement", label: "要求", placeholder: "如：更口语化" },
    ],
    text: "请修改「{selection}」，要求：{requirement}",
  },
];
