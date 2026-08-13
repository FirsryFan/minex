# 阅读子 agent 交接文档（带学员读《Agentic Design Patterns》）

> 这份文档让接手者**不读历史对话**也能理解学员背景、书的定位、已完成进度、教学偏好、下一步。
> 学员正在同步做一个 TypeScript AI Agent 平台（Minex），阅读是为那个项目服务的。

---

## 一、学员画像

- **OIer 高中生**（算法/数据结构扎实），**零工程经验**。
- 正在用 **TypeScript** 从零搭建 AI Agent 平台（Minex，微内核 + 驱动架构）。
- 已有工程概念储备：模块依赖、async/await、生产者消费者（EventStream）、钩子（hook）、组合 vs 继承、接口/可选字段、React 陷阱（hooks 规则、lazy useMemo、state 不可变、updater 禁副作用）、内核双视图 API（宿主视图 `Contribution[].map(c=>c.value)` vs 受限视图 `T[]`）。

## 二、书的信息

- 书名：《Agentic Design Patterns: A Hands-On Guide to Building Intelligent Systems》
- 作者：**Antonio Gullí**（Google CTO 办公室工程师），Springer 2025
- 本地文件：`E:\FirsryOS\Agentic-Design-Patterns-CN.pdf`（384 页，**中英对照**——网友用 GPT 生成原文重排版，每段英文后面跟中文）
- 结构：Intro（Level 0-3 复杂度分级）+ Part One 基础模式（Ch1-7）+ Part Two 高级系统（Ch8-11）+ Part Three 生产问题（Ch12-14）+ Part Four 多 agent 架构（Ch15-21）+ 附录（A 提示工程 / C 框架对比 / E CLI / F 推理引擎）
- 每章结构统一：Pattern Overview → Practical Applications → Hands-On Code → At a Glance → Key Takeaways → Conclusion

## 三、三轨协同（书的定位）

学员的学习是三条轨道同步推进，**书只是其中一条**：

| 轨道 | 内容 | 状态 |
|---|---|---|
| 读书 | 《Agentic Design Patterns》 | 当前**建设模式**（降为建时查阅，见第五节） |
| 看仓库 | Pi(已完成) → OpenHands → Hermes → Letta → Cherry Studio | 暂停 |
| 做项目 | Minex（微内核 + 驱动） | **主线** |

**核心原则**：书 = 概念坐标 / 仓库 = 参考答案 / 项目 = 考题。三轨永远同一主题——读完一个概念，去仓库看实现，在项目里落地。

## 四、已完成的学习进度

1. **Intro「What makes an AI system an Agent?」**：5-step loop（mission/scan/think/act/learn）+ **Level 0-3 复杂度分级**（L0 裸 LLM / L1 有工具 / L2 有上下文工程 / L3 多 agent）+ context engineering（select/package/manage 关键信息防过载）+ 5 大预测。
2. **附录 C 框架对比**：LangChain（DAG 无环）/ LangGraph（有环有状态）/ CrewAI·ADK（团队编排）。判定框架是否 agentic 看「有没有环 + 有没有状态」。
3. **Ch5 Tool Use（函数调用）**：六步流程（工具定义→LLM决策→调用生成→工具执行→观察/结果→LLM再处理）+ 三架构决策（LLM决定/框架执行的分工、工具定义=接口契约、工具可递归=另一个agent）。

**已建立的对应关系**（学员用这些概念对照项目）：
- agent = 时序逻辑（组合 vs 时序，数电类比）；LCEL = 组合逻辑
- registry = 黑板架构；全展开图 = unfolding；轨迹 = trajectory；缩点 = SCC condensation
- 宏动作 = options；计划 = HTN；ReAct 是控制流通式

## 五、当前模式：建设模式（重要）

学员时间有限，**已切换到「建设模式」**：项目轨是主线（占 80%），读书轨从「P0 精读」降为「**建时按需查阅**」——学员做项目遇到概念缺口时，才回来查对应章节，不系统通读。

所以子 agent 的职责是：
1. **学员主动来问某个概念时**，带他精读对应章节；
2. 不主动推进「下一章」，除非学员要求。

**但**：学员要求「把已有功能打磨好、用尽内核接口后，全面转向 agent 驱动」。届时 agent 驱动会用到书的 **Ch5 工具调用、Ch4 反思、Ch6 规划、Ch14 RAG** 等——这些是届时最可能查阅的章节。

## 六、教学偏好（精读模式，学员明确要求过）

**每章五步法**：
1. 先读章末 At a Glance / Key Takeaways（英文，带答案往回读）
2. 拆骨架：Pattern Overview「句子当代码解析」（主谓宾=调用骨架，从句=嵌套结构，介词短语=参数）
3. 精读长难句：挑 2-3 句拆解，**顺序铁律：英文在前，中文只做校验**
4. 扫代码数据流（Hands-On 示例只看数据流，不抠 API）
5. 落地验证：去仓库 hunt 同款 + 项目最小实现

**配套机制**：
- 生词入**术语库**（term/中文/定义/例句）
- 每章 1 句英文 summary（只查结构不苛求地道）
- 不依赖词典，先猜（上下文+词根）再对照中文

**教学风格总则**（学员的核心要求，必须遵守）：
- **直接讲、不用比喻类比**（除非是 OI 类比）
- **术语必须给定义**，黑话翻译成 OI/生活类比
- 结构：标题 + 列表 + file:line，禁止大段散文
- 一次只聚焦一个目标、一个概念讲透再进下一个
- 讲解顺序：概念 → 代码 → 「改一行会怎样」 → 动手验证
- 消极修辞、术语标准、简练直接

**OI 类比优先**：agent 循环≈判题循环、harness≈运行时、工具≈库函数、上下文窗口≈内存、context 压缩≈换页、prompt 注入≈程序输入。

## 七、下一步（等学员指令）

- 若学员来问「agent 驱动怎么做」相关概念 → 带读 **Ch5（已读过，可回顾）+ Ch4 Reflection + Ch6 Planning**。
- 若学员明确要求「继续读书」→ 从 Ch1 Prompt Chaining 或 Ch4 Reflection 开始（Ch5 已读，Ch1/Ch4 是阶段 1 的 P0 精读）。

## 八、相关文档

- 阅读计划：`E:\FirsryOS\Agentic-Design-Patterns-阅读计划.md`
- 架构视图模型：`E:\FirsryOS\Agentic-架构视图模型.md`（学员自己提炼的概念对照，含术语替换表）
- 术语库：随学习累积（每章新增 5-8 词）
