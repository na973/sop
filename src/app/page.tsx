'use client';

import { useState } from 'react';
import StepNavigator from '@/components/step-navigator';
import Step1Panel from '@/components/steps/step1-panel';
import Step2Panel from '@/components/steps/step2-panel';
import Step5Panel from '@/components/steps/step5-panel';
import Step6Panel from '@/components/steps/step6-panel';
import FormulaVerifyPanel from '@/components/formula-verify-panel';

const STEPS = [
  { id: 1, label: '分析招标文件', icon: '01' },
  { id: 2, label: '清单组价', icon: '02' },
  { id: 3, label: '最高投标限价对比', icon: '03' },
  { id: 4, label: '不平衡报价策略', icon: '04' },
  { id: 5, label: '清单调价配平', icon: '05' },
  { id: 6, label: '材料调价配平', icon: '06' },
  { id: 7, label: '调价与导出', icon: '07' },
  { id: 8, label: '投标后复盘', icon: '08' },
];

export default function Home() {
  const [currentStep, setCurrentStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [showVerify, setShowVerify] = useState(false);

  const handleStepClick = (stepId: number) => {
    setCurrentStep(stepId);
  };

  const handleStepComplete = (stepId: number) => {
    setCompletedSteps((prev) => new Set(prev).add(stepId));
  };

  const renderStepPanel = () => {
    switch (currentStep) {
      case 1:
        return <Step1Panel onComplete={() => handleStepComplete(1)} />;
      case 2:
        return <Step2Panel />;
      case 3:
      case 4:
        return (
          <div className="flex items-center justify-center h-full text-slate-400">
            <div className="text-center">
              <div className="text-6xl font-bold mb-4 text-slate-200">{currentStep}</div>
              <p className="text-lg">{STEPS[currentStep - 1].label}</p>
              <p className="text-sm mt-2">此步骤尚未开发</p>
            </div>
          </div>
        );
      case 5:
        return <Step5Panel />;
      case 6:
        return <Step6Panel />;
      case 7:
      case 8:
        return (
          <div className="flex items-center justify-center h-full text-slate-400">
            <div className="text-center">
              <div className="text-6xl font-bold mb-4 text-slate-200">{currentStep}</div>
              <p className="text-lg">{STEPS[currentStep - 1].label}</p>
              <p className="text-sm mt-2">此步骤尚未开发</p>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* 左侧步骤导航 */}
      <aside className="w-60 bg-slate-900 text-slate-300 flex flex-col shrink-0">
        <div className="px-4 py-5 border-b border-slate-700">
          <h1 className="text-base font-semibold text-white">商务标报价系统</h1>
          <p className="text-xs text-slate-500 mt-1">Bid Pricing System</p>
        </div>

        <StepNavigator
          steps={STEPS}
          currentStep={currentStep}
          completedSteps={completedSteps}
          onStepClick={handleStepClick}
        />

        <div className="mt-auto px-4 py-3 border-t border-slate-700">
          <button
            onClick={() => setShowVerify(!showVerify)}
            className="w-full text-xs text-slate-500 hover:text-amber-400 transition-colors"
          >
            {showVerify ? '隐藏' : '公式引擎验证'}
          </button>
        </div>
      </aside>

      {/* 右侧主工作区 */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部信息栏 */}
        <header className="h-12 bg-white border-b border-slate-200 flex items-center px-6 shrink-0">
          <span className="text-sm text-slate-500">
            步骤 {currentStep} / {STEPS.length}
          </span>
          <span className="mx-3 text-slate-300">|</span>
          <span className="text-sm font-medium text-slate-700">
            {STEPS[currentStep - 1].label}
          </span>
          {completedSteps.has(currentStep) && (
            <span className="ml-3 text-xs px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded">
              已完成
            </span>
          )}
        </header>

        {/* 工作区内容 */}
        <div className="flex-1 overflow-auto p-6">
          {showVerify ? <FormulaVerifyPanel /> : renderStepPanel()}
        </div>
      </main>
    </div>
  );
}
