'use client';

import { useAppState } from '@/lib/app-state';

const STEP_LABELS = [
  '分析招标文件',
  '清单组价',
  '限价对比',
  '不平衡报价策略',
  '清单调价配平',
  '材料调价配平',
  '调价与导出',
  '投标复盘',
];

const STEP_ICONS = ['1', '2', '3', '4', '5', '6', '7', '8'];

interface Props {
  activeStep: number;
  onStepChange: (step: number) => void;
}

export default function StepNavigator({ activeStep, onStepChange }: Props) {
  const { state } = useAppState();

  const isStepCompleted = (step: number): boolean => {
    switch (step) {
      case 1: return state.step1Completed;
      case 2: return !!state.step2Data;
      case 3: return !!state.step3Data;
      case 4: return !!state.step4Data;
      case 5: return !!state.step5Data;
      case 6: return !!state.step6Data;
      case 7: return state.step7Completed;
      case 8: return state.step7Completed; // step8 is always accessible if step7 done
      default: return false;
    }
  };

  return (
    <nav className="w-[220px] h-full bg-[#1e293b] flex flex-col shrink-0">
      {/* 标题 */}
      <div className="px-4 py-4 border-b border-slate-600">
        <h2 className="text-sm font-semibold text-white">报价流程</h2>
        <p className="text-xs text-slate-400 mt-1">8步报价辅助</p>
      </div>

      {/* 步骤列表 */}
      <div className="flex-1 overflow-auto py-2">
        {STEP_LABELS.map((label, i) => {
          const step = i + 1;
          const isActive = step === activeStep;
          const isCompleted = isStepCompleted(step);
          const needsPrerequisite = step > 2 && !isStepCompleted(step - 1) && !isCompleted;

          return (
            <button
              key={step}
              onClick={() => onStepChange(step)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors
                ${isActive ? 'bg-amber-500/20 text-amber-300' : ''}
                ${isCompleted && !isActive ? 'text-slate-300 hover:bg-slate-700' : ''}
                ${!isCompleted && !isActive && !needsPrerequisite ? 'text-slate-400 hover:bg-slate-700/50' : ''}
                ${!isCompleted && !isActive && needsPrerequisite ? 'text-slate-500 hover:bg-slate-700/30' : ''}
              `}
            >
              {/* 步骤编号/完成标记 */}
              <span
                className={`w-6 h-6 rounded flex items-center justify-center text-xs font-medium shrink-0
                  ${isActive ? 'bg-amber-500 text-white' : ''}
                  ${isCompleted && !isActive ? 'bg-emerald-600 text-white' : ''}
                  ${!isCompleted && !isActive ? 'bg-slate-600 text-slate-300' : ''}
                `}
              >
                {isCompleted && !isActive ? '\u2713' : STEP_ICONS[i]}
              </span>

              {/* 标签 */}
              <span className="text-xs leading-tight">{label}</span>
            </button>
          );
        })}
      </div>

      {/* 底部状态 */}
      <div className="px-4 py-3 border-t border-slate-600">
        <div className="text-xs text-slate-500">
          进度：{STEP_LABELS.filter((_, i) => isStepCompleted(i + 1)).length}/{STEP_LABELS.length}
        </div>
        {state.fileName && (
          <div className="text-xs text-slate-400 mt-1 truncate" title={state.fileName}>
            {state.fileName}
          </div>
        )}
      </div>
    </nav>
  );
}
