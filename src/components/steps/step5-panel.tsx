'use client';

import { useState, useCallback } from 'react';
import { useAppState, type BalancedItem } from '@/lib/app-state';
import { downloadBase64File, fmt } from '@/lib/export-utils';
import { exportToExcel } from '@/lib/export-utils';

export function Step5Panel() {
  const { state, updateState } = useAppState();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [localMaxPrice, setLocalMaxPrice] = useState(state.maxPriceTotal || 0);
  const [localDiscountRate, setLocalDiscountRate] = useState(state.targetDiscountRate <= 1 ? state.targetDiscountRate * 100 : state.targetDiscountRate || 5);
  const [predictedAverageDiscountRate, setPredictedAverageDiscountRate] = useState(
    state.predictedAverageDiscountRate <= 1
      ? state.predictedAverageDiscountRate * 100
      : state.predictedAverageDiscountRate || localDiscountRate,
  );

  const step5Data = state.step5Data;
  const canBalance = !!state.step3Data?.length && !!state.step4Data?.length;
  const getStep3ScreeningFlag = (row: number, category: string, code: string, name: string) => {
    const normalizedCode = String(code).trim();
    const normalizedName = String(name).trim();
    const matched = state.step3Data?.find((item) => (
      item.row === row
      && item.category === category
      && String(item.code).trim() === normalizedCode
    )) || state.step3Data?.find((item) => (
      String(item.code).trim() === normalizedCode
      && String(item.name).trim() === normalizedName
    ));
    return Boolean(matched?.isScreeningItem);
  };
  const getActualDiscountRate = (item: BalancedItem) => 1 - item.priceRatio;
  const formatTargetDiscountRange = (item: BalancedItem) => {
    const [ratioMin, ratioMax] = item.targetPriceRatioRange ?? [item.targetPriceRatio ?? item.priceRatio, item.targetPriceRatio ?? item.priceRatio];
    const discountMin = 1 - ratioMax;
    const discountMax = 1 - ratioMin;
    return `${(discountMin * 100).toFixed(2)}% ~ ${(discountMax * 100).toFixed(2)}%`;
  };

  const handleBalance = useCallback(async () => {
    if (!state.step3Data?.length) {
      setError('请先完成步骤3限价对比');
      return;
    }
    if (!state.step4Data?.length) {
      setError('请先完成步骤4不平衡报价策略');
      return;
    }
    if (!localMaxPrice || localMaxPrice <= 0) {
      setError('请确认最高投标限价合计');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/step5', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          compareItems: state.step3Data,
          maxPriceTotal: localMaxPrice,
          targetDiscountRate: localDiscountRate / 100,
          predictedAverageDiscountRate: predictedAverageDiscountRate / 100,
          limitSummary: state.step3LimitSummary,
          safetyCivilizedRatePercent: state.step2Data?.safetyCivilizedRatePercent,
          professionalEstimateTaxIncluded: null,
          professionalEstimateTaxRate: 0.09,
          strategyRules: state.step4Data.map((item) => ({
            row: item.row,
            category: item.category,
            strategy: item.strategyLevel,
            coefficientRange: item.coefficientRange,
            isScreeningItem: Boolean(item.isScreeningItem || getStep3ScreeningFlag(item.row, item.category, item.code, item.name)),
          })),
        }),
      });
      const data = await res.json();
      if (data.success) {
        updateState({
          step5Data: data,
          maxPriceTotal: localMaxPrice,
          targetDiscountRate: localDiscountRate / 100,
          predictedAverageDiscountRate: predictedAverageDiscountRate / 100,
        });
      } else {
        setError(data.error || '配平失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败');
    } finally {
      setLoading(false);
    }
  }, [localMaxPrice, localDiscountRate, predictedAverageDiscountRate, state.step3Data, state.step3LimitSummary, state.step4Data, updateState]);

  const handleExport = useCallback(async () => {
    if (!step5Data?.level2?.items) return;
    const rows = step5Data.level2.items.map((it: BalancedItem) => [
      it.category,
      it.code,
      it.name,
      it.quantity,
      it.maxUnitPrice,
      it.strategy,
      it.targetPriceRatio ?? it.priceRatio,
      formatTargetDiscountRange(it),
      getActualDiscountRate(it),
      it.targetUnitPrice,
      it.targetTotalPrice,
    ]);
    const result = await exportToExcel(
      [{ name: '清单配平', headers: ['分部', '编码', '名称', '工程量', '限价单价', '策略', '目标系数', '目标下浮率范围', '实际下浮率', '下浮后单价', '下浮后合价'], rows }],
      '清单调价配平结果.xlsx',
    );
    downloadBase64File(result.base64, result.fileName);
  }, [step5Data]);

  const level1 = step5Data?.level1;
  const level2 = step5Data?.level2;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">步骤5：清单调价配平</h2>
        {step5Data && (
          <button onClick={handleExport} className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90">
            导出Excel
          </button>
        )}
      </div>

      <div className="text-xs text-muted-foreground p-3 bg-muted/30 rounded">
        本步骤使用步骤3的最高投标限价清单、步骤4的不平衡报价策略、人工设置的本项目总下浮率进行配平；评标单价约束单独使用“预测投标单位平均下浮率”计算，不再写死0.455~0.845。
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className="text-sm font-medium text-muted-foreground">最高投标限价合计（元）</label>
          <input
            type="number"
            className="w-full mt-1 p-2 border border-border rounded text-sm bg-background text-foreground font-mono"
            value={localMaxPrice || ''}
            onChange={(e) => setLocalMaxPrice(Number(e.target.value))}
          />
        </div>
        <div>
          <label className="text-sm font-medium text-muted-foreground">总下浮率（%）</label>
          <input
            type="number"
            step="0.1"
            className="w-full mt-1 p-2 border border-border rounded text-sm bg-background text-foreground font-mono"
            value={localDiscountRate || ''}
            onChange={(e) => setLocalDiscountRate(Number(e.target.value))}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">用于计算本项目目标投标总价。</p>
        </div>
        <div>
          <label className="text-sm font-medium text-muted-foreground">预测投标单位平均下浮率（%）</label>
          <input
            type="number"
            step="0.1"
            className="w-full mt-1 p-2 border border-border rounded text-sm bg-background text-foreground font-mono"
            value={predictedAverageDiscountRate || ''}
            onChange={(e) => setPredictedAverageDiscountRate(Number(e.target.value))}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">只用于评标单价约束，不参考步骤4策略。</p>
        </div>
      </div>

      <button
        onClick={handleBalance}
        disabled={loading || !canBalance}
        className="w-full py-2 bg-primary text-primary-foreground rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
      >
        {loading ? '配平计算中...' : '执行清单调价配平'}
      </button>

      {!canBalance && <div className="text-xs text-amber-700 p-2 bg-amber-50 rounded">请先完成步骤3和步骤4。</div>}
      {error && <div className="text-xs text-destructive p-2 bg-destructive/10 rounded">{error}</div>}

      {level1 && (
        <div className="border border-border rounded p-3">
          <h3 className="text-sm font-medium mb-2">第一级：总价目标</h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>限价合计：<span className="font-mono">{fmt(level1.maxPriceTotal)}</span></div>
            <div>目标总价：<span className="font-mono">{fmt(level1.targetTotal)}</span></div>
            <div>下浮额：<span className="font-mono">{fmt(level1.totalDiscount)}</span></div>
            <div>总下浮率：<span className="font-mono">{(level1.discountRate * 100).toFixed(1)}%</span></div>
          </div>
        </div>
      )}

      {level2 && (
        <div>
          <h3 className="text-sm font-medium mb-2">第二级：清单配平（{level2.totalItems}项）</h3>
          <div className="text-xs mb-2 text-muted-foreground">
            清单目标合计：<span className="font-mono">{fmt(level2.targetTotal)}</span> |
            清单实际合计：<span className="font-mono">{fmt(level2.actualTotal)}</span>
          </div>
          <div className="overflow-x-auto border border-border rounded">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-2 py-1.5 text-left">分部</th>
                  <th className="px-2 py-1.5 text-left">编码</th>
                  <th className="px-2 py-1.5 text-left">名称</th>
                  <th className="px-2 py-1.5 text-right">工程量</th>
                  <th className="px-2 py-1.5 text-right">限价单价</th>
                  <th className="px-2 py-1.5 text-center">策略</th>
                  <th className="px-2 py-1.5 text-right">目标下浮率范围</th>
                  <th className="px-2 py-1.5 text-right">实际下浮率</th>
                  <th className="px-2 py-1.5 text-right">下浮后单价</th>
                  <th className="px-2 py-1.5 text-right">下浮后合价</th>
                </tr>
              </thead>
              <tbody>
                {level2.items.map((it: BalancedItem, i: number) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-2 py-1">{it.category}</td>
                    <td className="px-2 py-1 font-mono">{it.code}</td>
                    <td className="px-2 py-1">{it.name}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(it.quantity)}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(it.maxUnitPrice)}</td>
                    <td className="px-2 py-1 text-center">{it.strategy}</td>
                    <td className="px-2 py-1 text-right font-mono">{formatTargetDiscountRange(it)}</td>
                    <td className="px-2 py-1 text-right font-mono">{(getActualDiscountRate(it) * 100).toFixed(2)}%</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(it.targetUnitPrice)}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(it.targetTotalPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {step5Data?.validation && (
        <div className="border border-border rounded p-3">
          <h3 className="text-sm font-medium mb-2">评标单价约束</h3>
          <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
            <div>预测平均总下浮率：<span className="font-mono">{(step5Data.validation.predictedAverageDiscountRate * 100).toFixed(2)}%</span></div>
            <div>预测平均清单等效下浮率：<span className="font-mono">{(step5Data.validation.predictedEquivalentListDiscountRate * 100).toFixed(2)}%</span></div>
            <div>
              允许清单系数：
              <span className="font-mono">
                {' '}{step5Data.validation.coefficientRange.min.toFixed(4)} ~ {step5Data.validation.coefficientRange.max.toFixed(4)}
              </span>
            </div>
            <div>
              校验结果：
              <span className={step5Data.validation.coefficientPass ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>
                {' '}{step5Data.validation.coefficientPass ? '通过' : `${step5Data.validation.coefficientViolationCount}项超限`}
              </span>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            规则：预测平均清单等效下浮率上下浮动30%，再换算为清单系数范围；所有清单统一使用这个范围校验。
          </p>
        </div>
      )}
    </div>
  );
}
