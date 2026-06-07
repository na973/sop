'use client';

import { useAppState } from '@/lib/app-state';

export default function Step8Panel() {
  const { state } = useAppState();

  const steps = [
    { id: 1, label: '分析招标文件', completed: state.step1Completed, data: null },
    { id: 2, label: '清单组价', completed: !!state.step2Data, data: state.step2Data },
    { id: 3, label: '最高投标限价对比', completed: !!state.step3Data, data: state.step3Data },
    { id: 4, label: '不平衡报价策略', completed: !!state.step4Data, data: state.step4Data },
    { id: 5, label: '清单调价配平', completed: !!state.step5Data, data: state.step5Data },
    { id: 6, label: '材料调价配平', completed: !!state.step6Data, data: state.step6Data },
    { id: 7, label: '调价与导出', completed: state.step7Completed, data: null },
  ];

  const completedCount = steps.filter((s) => s.completed).length;

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="bg-white rounded-lg border border-slate-200 p-5">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">投标后复盘</h2>
          <p className="text-sm text-slate-500 mb-6">
            查看整个报价流程的完成情况和关键数据，评估报价策略的有效性。
          </p>

          {/* 完成进度 */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-slate-700">流程进度</span>
              <span className="text-sm font-mono text-amber-600">{completedCount}/{steps.length}</span>
            </div>
            <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500 rounded-full transition-all"
                style={{ width: `${(completedCount / steps.length) * 100}%` }}
              />
            </div>
          </div>

          {/* 各步骤状态 */}
          <div className="space-y-3">
            {steps.map((step) => (
              <div
                key={step.id}
                className={`flex items-center gap-4 p-3 rounded-lg border ${step.completed ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium ${step.completed ? 'bg-emerald-500 text-white' : 'bg-slate-300 text-slate-500'}`}>
                  {step.completed ? '\u2713' : step.id}
                </div>
                <div className="flex-1">
                  <div className={`text-sm font-medium ${step.completed ? 'text-emerald-800' : 'text-slate-500'}`}>
                    步骤{step.id}：{step.label}
                  </div>
                  {step.completed && step.data && (
                    <div className="text-xs text-slate-500 mt-1">
                      {getStepSummary(step.id, step.data)}
                    </div>
                  )}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded ${step.completed ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                  {step.completed ? '已完成' : '待完成'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 关键指标对比 */}
        {(state.step5Data || state.step6Data) && (
          <div className="bg-white rounded-lg border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-4">关键指标对比</h3>
            <div className="grid grid-cols-2 gap-4">
              {state.step5Data && (
                <>
                  <div className="p-3 bg-slate-50 rounded">
                    <div className="text-xs text-slate-500 mb-1">最高限价</div>
                    <div className="font-mono font-semibold">
                      {state.step5Data.level1.maxPriceTotal.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}元
                    </div>
                  </div>
                  <div className="p-3 bg-amber-50 rounded">
                    <div className="text-xs text-slate-500 mb-1">目标总价（下浮{(state.step5Data.level1.discountRate * 100).toFixed(1)}%）</div>
                    <div className="font-mono font-semibold text-amber-700">
                      {state.step5Data.level1.targetTotal.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}元
                    </div>
                  </div>
                </>
              )}
              {state.step6Data && (
                <>
                  <div className="p-3 bg-blue-50 rounded">
                    <div className="text-xs text-slate-500 mb-1">最终实际总价</div>
                    <div className="font-mono font-semibold text-blue-700">
                      {state.step6Data.validation.actualTotal.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}元
                    </div>
                  </div>
                  <div className="p-3 bg-emerald-50 rounded">
                    <div className="text-xs text-slate-500 mb-1">与目标差额</div>
                    <div className={`font-mono font-semibold ${Math.abs(state.step6Data.validation.diff) < 100 ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {state.step6Data.validation.diff >= 0 ? '+' : ''}{state.step6Data.validation.diff.toFixed(2)}元
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* 评标规则校验 */}
        {state.step5Data?.validation && (
          <div className="bg-white rounded-lg border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-4">评标规则校验</h3>
            <div className="space-y-2">
              <div className="flex items-center gap-3 p-2 bg-slate-50 rounded">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${state.step5Data.validation.totalPass ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'}`}>
                  {state.step5Data.validation.totalPass ? '\u2713' : '\u2717'}
                </span>
                <span className="text-sm">总价偏差校验（差额 {state.step5Data.validation.totalDiff.toFixed(2)} 元）</span>
              </div>
              <div className="flex items-center gap-3 p-2 bg-slate-50 rounded">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${state.step5Data.validation.coefficientPass ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'}`}>
                  {state.step5Data.validation.coefficientPass ? '\u2713' : '\u2717'}
                </span>
                <span className="text-sm">单价甄别系数校验（0.455~0.845，违规 {state.step5Data.validation.coefficientViolationCount} 条）</span>
              </div>
              <div className="flex items-center gap-3 p-2 bg-slate-50 rounded">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${state.step5Data.validation.overallPass ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'}`}>
                  {state.step5Data.validation.overallPass ? '\u2713' : '\u2717'}
                </span>
                <span className="text-sm font-medium">综合判定：{state.step5Data.validation.overallPass ? '通过' : '未通过'}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** 获取步骤简要摘要 */
function getStepSummary(stepId: number, data: unknown): string {
  switch (stepId) {
    case 2: {
      const d = data as { bidItems?: unknown[]; stats?: { totalFormulas?: number; errorCount?: number } };
      return `${d.bidItems?.length || 0}条清单项，${d.stats?.totalFormulas || 0}个公式，${d.stats?.errorCount || 0}个错误`;
    }
    case 3: {
      const d = data as unknown[];
      return `${d.length}条对比完成`;
    }
    case 4: {
      const d = data as unknown[];
      return `${d.length}条策略评分完成`;
    }
    case 5: {
      const d = data as { level2?: { totalItems?: number }; level1?: { discountRate?: number } };
      return `${d.level2?.totalItems || 0}条配平，下浮率${((d.level1?.discountRate || 0) * 100).toFixed(1)}%`;
    }
    case 6: {
      const d = data as { level3?: { priceChanges?: unknown[] }; validation?: { converged?: boolean; iterations?: number } };
      return `${d.level3?.priceChanges?.length || 0}种材料调整，${d.validation?.converged ? '已收敛' : '未收敛'}，${d.validation?.iterations || 0}次迭代`;
    }
    default:
      return '';
  }
}
