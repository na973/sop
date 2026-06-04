import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  readExcelToWorkbook,
  calculateWorkbook,
} from '@/lib/formula-engine';

export const dynamic = 'force-dynamic';

/**
 * GET /api/formula-verify
 * 用表7数据验证公式引擎
 */
export async function GET() {
  try {
    const filePath = join(process.cwd(), 'public', 'test-data', 'table7.xlsx');
    const buffer = readFileSync(filePath);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

    // 1. 读取公式版本（用于引擎计算）
    const workbook = await readExcelToWorkbook(arrayBuffer);

    // 2. 用引擎计算所有公式
    const startTime = Date.now();
    const { workbook: result, stats } = calculateWorkbook(workbook);
    const calcTime = Date.now() - startTime;

    // 3. 收集关键汇总值（汇总表C列）
    const summarySheet = result.get('汇总表');
    const summaryValues: Record<string, number | string | null> = {};
    if (summarySheet) {
      for (const [key, cell] of summarySheet) {
        const [, col] = key.split(',').map(Number);
        if (col === 3 && typeof cell.value === 'number') {
          summaryValues[`R${key.split(',')[0]}C${col}`] = cell.value;
        }
      }
    }

    // 4. 内部一致性验证：C19 = C2 + C8 + C12 + C18
    const c2 = summaryValues['R2C3'] ?? 0;   // 分部分项工程项目费
    const c8 = summaryValues['R8C3'] ?? 0;   // 措施项目费
    const c12 = summaryValues['R12C3'] ?? 0; // 其他项目费
    const c18 = summaryValues['R18C3'] ?? 0; // 增值税
    const c19 = summaryValues['R19C3'] ?? 0; // 合计

    const expectedTotal = Number(c2) + Number(c8) + Number(c12) + Number(c18);
    const totalDiff = Math.abs(Number(c19) - expectedTotal);
    const totalConsistent = totalDiff < 0.01;

    // 5. 抽样验证：取道路工程第一条清单，手动验算 G2 = ROUND(E2*F2, 2)
    const roadSheet = result.get('综合单价分析表【道路工程】');
    let sampleCheck = null;
    if (roadSheet) {
      const e2 = roadSheet.get('2,5')?.value;  // 工程量
      const f2 = roadSheet.get('2,6')?.value;  // 综合单价
      const g2 = roadSheet.get('2,7')?.value;  // 合价
      if (typeof e2 === 'number' && typeof f2 === 'number' && typeof g2 === 'number') {
        const expected = Math.round(e2 * f2 * 100) / 100;
        sampleCheck = {
          item: '铣刨路面 (R2)',
          工程量: e2,
          综合单价: f2,
          引擎合价: g2,
          手算合价: expected,
          差额: Math.abs(g2 - expected),
          通过: Math.abs(g2 - expected) < 0.01,
        };
      }
    }

    return NextResponse.json({
      success: true,
      calculationTime: `${calcTime}ms`,
      stats: {
        totalFormulas: stats.totalFormulas,
        calculated: stats.calculated,
        errorCount: stats.errors.length,
        firstErrors: stats.errors.slice(0, 10),
      },
      summaryValues,
      validation: {
        合计: {
          分部分项工程项目费: c2,
          措施项目费: c8,
          其他项目费: c12,
          增值税: c18,
          引擎合计: c19,
          加总验证: expectedTotal,
          差额: totalDiff,
          通过: totalConsistent,
        },
        抽样验证: sampleCheck,
      },
    });
  } catch (error) {
    console.error('Formula verify error:', error);
    return NextResponse.json(
      {
        success: false,
        error: String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
