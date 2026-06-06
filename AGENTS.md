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
│   │   │   ├── step1/
│   │   │   │   ├── extract/      # 步骤1 AI提取（非流式）
│   │   │   │   └── extract-stream/ # 步骤1 AI提取（SSE流式）
│   │   │   ├── step2/            # 步骤2 清单组价
│   │   │   ├── step5/            # 步骤5 清单调价配平
│   │   │   └── step6/            # 步骤6 材料调价配平
│   │   ├── layout.tsx
│   │   ├── page.tsx              # 主页面（8步骤导航+工作区）
│   │   └── globals.css
│   ├── components/
│   │   ├── step-navigator.tsx    # 左侧8步骤导航条
│   │   ├── formula-verify-panel.tsx # 公式引擎验证面板
│   │   ├── steps/
│   │   │   ├── step1-panel.tsx   # 步骤1工作面板
│   │   │   ├── step2-panel.tsx   # 步骤2工作面板
│   │   │   ├── step5-panel.tsx   # 步骤5工作面板
│   │   │   └── step6-panel.tsx   # 步骤6工作面板
│   │   └── ui/                   # shadcn/ui 组件库
│   └── lib/
│       ├── formula-engine/       # ⭐ 核心公式引擎
│       │   ├── types.ts          # 类型定义（CellValue, CellData, ASTNode等）
│       │   ├── cell-utils.ts     # 单元格工具（列号转换、范围规范化）
│       │   ├── parser.ts         # 公式解析器（支持12种函数+跨Sheet引用+&连接符）
│       │   ├── evaluator.ts      # 公式求值器（递归依赖计算+通配符匹配+整列引用）
│       │   ├── excel-reader.ts   # Excel文件读取（ExcelJS，含共享公式处理）
│       │   ├── engine.ts         # FormulaEngine主类（拓扑排序+批量计算+重算清除）
│       │   └── index.ts          # 统一导出
│       ├── bidding/
│       │   └── types.ts          # 业务类型定义（BiddingItem, BalancedItem等）
│       └── utils.ts
├── DESIGN.md                     # 设计规范
├── next.config.ts
├── package.json
└── tsconfig.json
```

## 关键模块说明

### 公式引擎 (src/lib/formula-engine/)

- **解析器**: 支持 SUM, ROUND, IF, IFERROR, INDEX, MATCH, SUMIF, SUMPRODUCT, OR, FIND, LEFT, TRIM + 字符串连接符`&` + 双否定`--` + 整列引用`$A:$A` + 跨Sheet引用`'Sheet名'!`
- **求值器**: 递归依赖计算（未计算的公式单元格通过cache判断自动触发计算），循环检测，Excel通配符匹配（`*`和`?`），跨Sheet范围解析
- **引擎主类**: ExcelJS读取 → 解析所有公式 → 批量计算 → 与Excel缓存值比对；重算时清除公式缓存确保依赖更新
- **验证结果**: 2787个公式，0错误，合计加总差额 < 1e-8

### 步骤1 (step1)

- AI提取招标文件商务条款（8大分类57行）
- 支持非流式(/api/step1/extract)和SSE流式(/api/step1/extract-stream)
- 表格式编辑界面
- 导出Excel（待实现）

### 步骤2 (step2) - 清单组价

- 读取Excel文件，通过公式引擎计算所有Sheet
- 提取清单项（道路工程/桥梁工程/排水工程）
- 返回汇总数据和分部分项清单
- API: POST /api/step2 `{filePath}`

### 步骤5 (step5) - 清单调价配平

- 两级配平：第一级总价配平（限价×(1-下浮率)），第二级清单配平
- 5档策略系数：强报高(0.78~0.80)/中报高(0.74~0.76)/正常(0.62~0.66)/中报低(0.50~0.54)/强报低(0.46~0.50)
- 校验0.455≤清单系数≤0.845约束（评标规则）
- API: POST /api/step5 `{filePath, maxPriceTotal, targetDiscountRate}`

### 步骤6 (step6) - 材料调价配平

- 三级配平：修改工料机价格 → 公式回算 → 校验约束
- 公式依赖链：工料机汇总表F列(含税市场价) → H列(单价=ROUND(F/(1+G/100),2)) → INDEX(MATCH()) → 综合单价 → 合价 → 汇总表
- 使用二分法迭代寻找统一缩放因子k，使调整后总价逼近目标值
- 收敛精度：差值<100元
- API: POST /api/step6 `{filePath, balancedItems}`

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
- 通配符匹配：MATCH/SUMIF等函数支持Excel通配符 `*`（匹配任意字符）和 `?`（匹配单个字符），由 `excelWildcardMatch()` 函数实现
- 重算机制：`calculateWorkbook` 在每次调用时将所有公式单元格value设为null（标记为未计算），确保递归计算时读到最新数据；`resolveCellRef` 通过cache判断是否需要重新计算（无缓存则递归计算）
- CellData.value类型：`CellValue | undefined`，undefined表示从未被计算过，null表示被calculateWorkbook清除等待重算

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

# 步骤2 清单组价
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"filePath":"public/test-data/table7.xlsx"}' \
  http://localhost:5000/api/step2

# 步骤5 清单调价配平
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"filePath":"public/test-data/table7.xlsx","maxPriceTotal":38000000,"targetDiscountRate":0.05}' \
  http://localhost:5000/api/step5

# 步骤6 材料调价配平（需要先获取step5的balancedItems）
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"filePath":"public/test-data/table7.xlsx","balancedItems":[...]}' \
  http://localhost:5000/api/step6
```
