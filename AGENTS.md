# 商务标报价系统 - AGENTS.md

## 项目概述

商务标报价辅助系统，支持8步报价流程：分析招标文件 → 清单组价 → 限价对比 → 不平衡报价策略 → 清单调价配平 → 材料调价配平 → 调价导出 → 投标复盘。

核心能力：自研公式引擎（2787个Excel公式零错误计算）、Excel多Sheet导入导出、AI辅助提取与策略判断、三级配平算法。

### 版本技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4
- **表格**: AG Grid Community（计划中，当前用原生table）
- **Excel处理**: SheetJS (xlsx) + ExcelJS
- **公式引擎**: 自研（src/lib/formula-engine/）
- **AI**: coze-coding-dev-sdk LLMClient
- **数据存储**: better-sqlite3（计划中）

## 目录结构

```
├── public/
│   └── test-data/          # 测试用Excel文件
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── formula-verify/   # 公式引擎验证API
│   │   │   ├── formula-debug/    # 公式引擎调试API
│   │   │   └── step1/
│   │   │       ├── extract/      # 步骤1 AI提取（非流式）
│   │   │       └── extract-stream/ # 步骤1 AI提取（SSE流式）
│   │   ├── layout.tsx
│   │   ├── page.tsx              # 主页面（8步骤导航+工作区）
│   │   └── globals.css
│   ├── components/
│   │   ├── step-navigator.tsx    # 左侧8步骤导航条
│   │   ├── formula-verify-panel.tsx # 公式引擎验证面板
│   │   ├── steps/
│   │   │   └── step1-panel.tsx   # 步骤1工作面板
│   │   └── ui/                   # shadcn/ui 组件库
│   └── lib/
│       ├── formula-engine/       # ⭐ 核心公式引擎
│       │   ├── types.ts          # 类型定义（CellValue, ASTNode等）
│       │   ├── cell-utils.ts     # 单元格工具（列号转换、范围规范化）
│       │   ├── parser.ts         # 公式解析器（支持12种函数+跨Sheet引用+&连接符）
│       │   ├── evaluator.ts      # 公式求值器（递归依赖计算+整列引用）
│       │   ├── excel-reader.ts   # Excel文件读取（ExcelJS，含共享公式处理）
│       │   ├── engine.ts         # FormulaEngine主类（拓扑排序+批量计算+比对）
│       │   └── index.ts          # 统一导出
│       └── utils.ts
├── DESIGN.md                     # 设计规范
├── next.config.ts
├── package.json
└── tsconfig.json
```

## 关键模块说明

### 公式引擎 (src/lib/formula-engine/)

- **解析器**: 支持 SUM, ROUND, IF, IFERROR, INDEX, MATCH, SUMIF, SUMPRODUCT, OR, FIND, LEFT, TRIM + 字符串连接符`&` + 双否定`--` + 整列引用`$A:$A` + 跨Sheet引用`'Sheet名'!`
- **求值器**: 递归依赖计算（未计算的公式单元格会自动触发计算），循环检测
- **引擎主类**: ExcelJS读取 → 解析所有公式 → 批量计算 → 与Excel缓存值比对
- **验证结果**: 2787个公式，0错误，合计加总差额 < 1e-8

### 步骤1 (step1)

- AI提取招标文件商务条款（8大分类57行）
- 支持非流式(/api/step1/extract)和SSE流式(/api/step1/extract-stream)
- 表格式编辑界面
- 导出Excel（待实现）

## 包管理规范

**仅允许使用 pnpm**，严禁使用 npm 或 yarn。

## 开发规范

### 编码规范

- TypeScript strict 模式
- 禁止隐式 any 和 as any
- 函数参数、返回值必须有类型标注
- 清理未使用的变量和导入

### next.config 配置规范

- 配置路径使用 `path.resolve(__dirname, ...)` 动态拼接，禁止硬编码绝对路径

### Hydration 问题防范

- 严禁 JSX 渲染逻辑中使用 typeof window、Date.now()、Math.random()
- 必须用 'use client' + useEffect + useState 确保动态内容仅客户端渲染
- 禁止非法 HTML 嵌套（如 `<p>` 嵌套 `<div>`）

### 公式引擎开发规范

- 新增函数支持：在 parser.ts 的 `isKnownFunction` 中注册 → 在 evaluator.ts 的 `evaluateFunction` 中实现
- 跨Sheet引用：Sheet名含特殊字符时需用单引号包裹，如 `'综合单价分析表【道路工程】'!A1`
- 整列引用（如 `$A:$A`）：row=0 表示整列，`normalizeRange` 会自动替换为实际数据范围
- 共享公式：ExcelJS 的 `cell.value` 可能是 `{formula: string}` 对象而非 Formula 类型，需用 `extractFormula()` 兼容处理

## 测试验证

```bash
# 公式引擎验证
curl -s http://localhost:5000/api/formula-verify

# 公式引擎调试（查看指定Sheet数据）
curl -s 'http://localhost:5000/api/formula-debug?sheet=汇总表&maxRow=20'

# 步骤1 AI提取（需要AI配额）
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"content":"招标文件文本内容"}' \
  http://localhost:5000/api/step1/extract
```
