import { NextRequest, NextResponse } from 'next/server';
import { readExcelToWorkbook } from '@/lib/formula-engine/excel-reader';
import { calculateWorkbook } from '@/lib/formula-engine/engine';
import type { CellValue } from '@/lib/formula-engine/types';

/** 安全取数 */
function toNum(v: CellValue | undefined): number {
  if (v === undefined || v === null) return 0;
  if (v instanceof Error) return 0;
  return typeof v === 'number' ? v : (typeof v === 'boolean' ? (v ? 1 : 0) : Number(v) || 0);
}

/** 偏差率分档规则 */
function getDeviationLevel(rate: number): string {
  if (rate >= 0.20) return '控制价明显偏高';
  if (rate >= 0.10) return '控制价偏高';
  if (rate >= -0.10) return '基本接近';
  if (rate >= -0.20) return '控制价偏低';
  return '控制价明显偏低/疑似已压价';
}

/** 步骤3：限价对比 — 将我方单价与最高投标限价对比，计算偏差率和偏差等级 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { table7FileBase64, maxPriceTotal, filePath } = body as {
      table7FileBase64?: string;
      maxPriceTotal?: number;
      filePath?: string;
    };

    if (maxPriceTotal === undefined) {
      return NextResponse.json({ success: false, error: '请提供：maxPriceTotal(最高投标限价合计)' }, { status: 400 });
    }

    // 1. 读取Excel
    let arrayBuffer: ArrayBuffer;
    if (filePath) {
      const fs = await import('fs');
      const buf = fs.readFileSync(filePath);
      arrayBuffer = new Uint8Array(buf).buffer;
    } else if (table7FileBase64) {
      const buffer = Buffer.from(table7FileBase64, 'base64');
      arrayBuffer = new Uint8Array(buffer).buffer;
    } else {
      return NextResponse.json({ success: false, error: '请提供表7文件（filePath或base64）' }, { status: 400 });
    }

    const workbook = await readExcelToWorkbook(arrayBuffer);
    const { workbook: calcWb } = calculateWorkbook(workbook);

    // 2. 从汇总表读取各分类限价
    const summarySheet = calcWb.get('汇总表');
    if (!summarySheet) {
      return NextResponse.json({ success: false, error: '汇总表不存在' }, { status: 400 });
    }

    // 3. 从三个综合单价分析表提取清单条目，计算限价对比
    const compareItems = extractCompareItems(calcWb, maxPriceTotal);

    // 4. 统计汇总
    const stats = {
      totalItems: compareItems.length,
      screeningItems: compareItems.filter((i) => i.isScreeningItem).length,
      highDeviation: compareItems.filter((i) => Math.abs(i.deviationRate) >= 0.20).length,
      mediumDeviation: compareItems.filter((i) => Math.abs(i.deviationRate) >= 0.10 && Math.abs(i.deviationRate) < 0.20).length,
      lowDeviation: compareItems.filter((i) => Math.abs(i.deviationRate) < 0.10).length,
      averageDeviation: compareItems.length > 0
        ? compareItems.reduce((sum, i) => sum + i.deviationRate, 0) / compareItems.length
        : 0,
    };

    return NextResponse.json({
      success: true,
      compareItems,
      stats,
      maxPriceTotal,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

/** 提取限价对比条目 */
function extractCompareItems(
  calcWb: Map<string, Map<string, { value: CellValue | undefined; isFormula: boolean; formula?: string }>>,
  maxPriceTotal: number,
) {
  const items: Array<{
    row: number;
    category: string;
    code: string;
    name: string;
    unit: string;
    quantity: number;
    ourUnitPrice: number;
    ourTotalPrice: number;
    maxUnitPrice: number;
    maxTotalPrice: number;
    deviationRate: number;
    deviationLevel: string;
    isScreeningItem: boolean;
  }> = [];

  // 限价按比例分配到各分类：用各分类占我方总价的比值来分摊
  const summarySheet = calcWb.get('汇总表');
  const ourTotal = toNum(summarySheet?.get('19,3')?.value); // C19=合计
  const roadTotal = toNum(summarySheet?.get('4,3')?.value);  // C4=道路
  const bridgeTotal = toNum(summarySheet?.get('5,3')?.value); // C5=桥梁
  const drainTotal = toNum(summarySheet?.get('6,3')?.value);  // C6=排水

  // 限价按比例分配
  const ratio = ourTotal > 0 ? maxPriceTotal / ourTotal : 1;

  const categories = [
    { sheet: '综合单价分析表【道路工程】', category: '道路工程', categoryTotal: roadTotal },
    { sheet: '综合单价分析表【桥梁工程】', category: '桥梁工程', categoryTotal: bridgeTotal },
    { sheet: '综合单价分析表【排水工程】', category: '排水工程', categoryTotal: drainTotal },
  ];

  for (const cat of categories) {
    const sheet = calcWb.get(cat.sheet);
    if (!sheet) continue;

    // 找出所有主条目行
    const mainRows: number[] = [];
    for (const [key, cell] of sheet) {
      const [r, c] = key.split(',').map(Number);
      if (c === 1 && typeof cell.value === 'number' && cell.value > 0) {
        mainRows.push(r);
      }
    }
    mainRows.sort((a, b) => a - b);

    for (const mainRow of mainRows) {
      const code = String(sheet.get(`${mainRow},2`)?.value ?? '');
      const name = String(sheet.get(`${mainRow},3`)?.value ?? '');
      const unit = String(sheet.get(`${mainRow},4`)?.value ?? '');
      const quantity = toNum(sheet.get(`${mainRow},5`)?.value);
      const ourUnitPrice = toNum(sheet.get(`${mainRow},6`)?.value);
      const ourTotalPrice = toNum(sheet.get(`${mainRow},7`)?.value);

      // 限价单价 = 我方单价 × 限价/我方 比例
      const maxUnitPrice = ourUnitPrice * ratio;
      const maxTotalPrice = maxUnitPrice * quantity;

      // 偏差率 = (限价单价 - 我方单价) / 我方单价
      const deviationRate = ourUnitPrice > 0 ? (maxUnitPrice - ourUnitPrice) / ourUnitPrice : 0;
      const deviationLevel = getDeviationLevel(deviationRate);

      // 单价甄别项目：偏差率绝对值 >= 15% 的项目
      const isScreeningItem = Math.abs(deviationRate) >= 0.15;

      items.push({
        row: mainRow,
        category: cat.category,
        code,
        name,
        unit,
        quantity,
        ourUnitPrice,
        ourTotalPrice,
        maxUnitPrice,
        maxTotalPrice,
        deviationRate,
        deviationLevel,
        isScreeningItem,
      });
    }
  }

  return items;
}
