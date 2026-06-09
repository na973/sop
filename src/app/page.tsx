'use client';

import { useState, useCallback } from 'react';
import { AppProvider, useAppState } from '@/lib/app-state';
import StepNavigator from '@/components/step-navigator';
import { Step1Panel } from '@/components/steps/step1-panel';
import { Step2Panel } from '@/components/steps/step2-panel';
import { Step3Panel } from '@/components/steps/step3-panel';
import { Step4Panel } from '@/components/steps/step4-panel';
import { Step5Panel } from '@/components/steps/step5-panel';
import { Step6Panel } from '@/components/steps/step6-panel';
import { Step7Panel } from '@/components/steps/step7-panel';
import { Step8Panel } from '@/components/steps/step8-panel';

function AppContent() {
  const [activeStep, setActiveStep] = useState(1);
  const { state } = useAppState();

  const handleStepChange = useCallback((step: number) => {
    setActiveStep(step);
  }, []);

  const renderPanel = () => {
    switch (activeStep) {
      case 1: return <Step1Panel />;
      case 2: return <Step2Panel />;
      case 3: return <Step3Panel />;
      case 4: return <Step4Panel />;
      case 5: return <Step5Panel />;
      case 6: return <Step6Panel />;
      case 7: return <Step7Panel />;
      case 8: return <Step8Panel />;
      default: return <Step1Panel />;
    }
  };

  const fileCount = state.fileLibrary.length;

  return (
    <div className="h-screen flex bg-[#f8fafc]">
      {/* 左侧导航 */}
      <StepNavigator activeStep={activeStep} onStepChange={handleStepChange} />

      {/* 主工作区 */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部信息栏 */}
        <header className="h-12 flex items-center px-6 bg-white border-b border-slate-200 shrink-0">
          <h1 className="text-sm font-semibold text-slate-800">商务标报价辅助系统</h1>
          <span className="mx-3 text-slate-300">|</span>
          <span className="text-xs text-slate-500">步骤 {activeStep}/8</span>
          <div className="flex-1" />
          {fileCount > 0 && (
            <span className="text-xs text-slate-500 mr-4">
              文件库：{fileCount} 个文件
            </span>
          )}
          <span className="text-xs text-slate-400">v2.0</span>
        </header>

        {/* 工作面板 */}
        <div className="flex-1 overflow-auto">
          <div className="max-w-4xl mx-auto p-6">
            {renderPanel()}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
