'use client';

import { useAppState } from '@/lib/app-state';
import { fmt, exportToExcel, downloadBase64File } from '@/lib/export-utils';
import { useCallback } from 'react';

export function Step8Panel() {
  const { state } = useAppState();

  const step5Data = state.step5Data;
  const step6Data = state.step6Data;
  const step3Data = state.step3Data;
  const step4Data = state.step4Data;

  const hasAnyData = step3Data || step4Data || step5Data || step6Data;

  const handleExport = useCallback(async () => {
    const sheets = [];
    if (step3Data) {
      sheets.push({
        name: '限价对比',
        headers: ['分部', '编码', '名称', '我方单价', '限价单价', '偏差率', '偏差等级', '甄别项'],
        rows: step3Data.map((it) => [it.category, it.code, it.name, it.ourUnitPrice, it.maxUnitPrice, it.deviationRate, it.deviationLevel, it.isScreeningItem ? '是' : '否']),
      });
    }
    if (step4Data) {
      sheets.push({
        name: '报价策略',
        headers: ['编码', '名称', '偏差等级', '评分', '策略', '系数范围'],
        rows: step4Data.map((it) => [it.code, it.name, it.deviationLevel, it.totalScore, it.strategyLevel, `${it.coefficientRange[0]}~${it.coefficientRange[1]}`]),
      });
    }
    if (step5Data?.level2?.items) {
      sheets.push({
        name: '清单配平',
        headers: ['编码', '名称', '原单价', '策略', '目标单价', '目标合价'],
        rows: step5Data.level2.items.map((it) => [it.code, it.name, it.unitPrice, it.strategy, it.targetUnitPrice, it.targetTotalPrice]),
      });
    }
    if (step6Data?.level3?.priceChanges) {
      sheets.push({
        name: '材料调价',
        headers: ['编码', '名称', '原价', '调后价', '比例'],
        rows: step6Data.level3.priceChanges.map((c) => [c.code, c.name, c.originalPrice, c.adjustedPrice, `${((c.diffPercent ?? 0) * 100).toFixed(1)}%`]),
      });
    }
    if (sheets.length === 0) return;
    const result = await exportToExcel(sheets, '投标复盘汇总.xlsx');
    downloadBase64File(result.base64, result.fileName);
  }, [step3Data, step4Data, step5Data, step6Data]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">步骤8：投标复盘</h2>
        {hasAnyData && (
          <button onClick={handleExport} className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90">
            导出全部Excel
          </button>
        )}
      </div>

      {!hasAnyData && (
        <div className="text-xs text-muted-foreground p-3 bg-muted/30 rounded">
          完成前面的步骤后，此处将汇总展示关键指标
        </div>
      )}

      {/* 限价/原价/配平后对比 */}
      {(step5Data || step6Data) && (
        <div className="border border-border rounded p-3">
          <h3 className="text-sm font-medium mb-2">价格对比</h3>
          <div className="space-y-1 text-xs">
            {state.maxPriceTotal > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">最高限价合计</span>
                <span className="font-mono">{fmt(state.maxPriceTotal)}</span>
              </div>
            )}
            {step5Data?.level1?.targetTotal && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">目标总价（下浮后）</span>
                <span className="font-mono">{fmt(step5Data.level1.targetTotal)}</span>
              </div>
            )}
            {step5Data?.level2?.actualTotal && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">清单配平后总价</span>
                <span className="font-mono">{fmt(step5Data.level2.actualTotal)}</span>
              </div>
            )}
            {step6Data?.validation?.actualTotal && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">材料调价后总价</span>
                <span className="font-mono">{fmt(step6Data.validation.actualTotal)}</span>
              </div>
            )}
            {step6Data?.validation?.diff !== undefined && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">与目标差值</span>
                <span className={`font-mono ${Math.abs(step6Data.validation.diff) < 100 ? 'text-green-600' : 'text-orange-600'}`}>
                  {fmt(step6Data.validation.diff)} 元
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 分部工程调整明细 */}
      {step3Data && (
        <div className="border border-border rounded p-3">
          <h3 className="text-sm font-medium mb-2">偏差分布</h3>
          <div className="space-y-1 text-xs">
            {Object.entries(
              step3Data.reduce<Record<string, number>>((acc, it) => {
                acc[it.deviationLevel] = (acc[it.deviationLevel] || 0) + 1;
                return acc;
              }, {}),
            ).map(([level, count]) => (
              <div key={level} className="flex justify-between">
                <span>{level}</span>
                <span className="font-mono">{count}项</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 策略分布 */}
      {step4Data && (
        <div className="border border-border rounded p-3">
          <h3 className="text-sm font-medium mb-2">策略分布</h3>
          <div className="space-y-1 text-xs">
            {Object.entries(
              step4Data.reduce<Record<string, number>>((acc, it) => {
                acc[it.strategyLevel] = (acc[it.strategyLevel] || 0) + 1;
                return acc;
              }, {}),
            ).map(([level, count]) => (
              <div key={level} className="flex justify-between">
                <span>{level}</span>
                <span className="font-mono">{count}项</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 评标规则校验 */}
      {step5Data?.level2?.items && (
        <div className="border border-border rounded p-3">
          <h3 className="text-sm font-medium mb-2">评标规则校验</h3>
          <div className="space-y-1 text-xs">
            {(() => {
              const items = step5Data.level2.items;
              const violations = items.filter((it) => {
                const ratio = it.targetUnitPrice && it.maxUnitPrice ? it.targetUnitPrice / it.maxUnitPrice : 0;
                return ratio < 0.455 || ratio > 0.845;
              });
              return (
                <>
                  <div className="flex justify-between">
                    <span>0.455≤清单系数≤0.845</span>
                    <span className={violations.length === 0 ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>
                      {violations.length === 0 ? '通过' : `${violations.length}项超限`}
                    </span>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
