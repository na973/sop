'use client';

interface StepItem {
  id: number;
  label: string;
  icon: string;
}

interface StepNavigatorProps {
  steps: StepItem[];
  currentStep: number;
  completedSteps: Set<number>;
  onStepClick: (stepId: number) => void;
}

export default function StepNavigator({
  steps,
  currentStep,
  completedSteps,
  onStepClick,
}: StepNavigatorProps) {
  return (
    <nav className="flex-1 py-3 px-2">
      {steps.map((step) => {
        const isActive = step.id === currentStep;
        const isCompleted = completedSteps.has(step.id);

        let stateClass = 'step-pending';
        if (isActive) stateClass = 'step-active';
        else if (isCompleted) stateClass = 'step-completed';

        return (
          <button
            key={step.id}
            onClick={() => onStepClick(step.id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded text-sm transition-all hover:bg-slate-800 ${stateClass}`}
          >
            <span
              className={`w-6 h-6 rounded-full text-xs flex items-center justify-center font-medium shrink-0 ${
                isActive
                  ? 'bg-amber-500 text-slate-900'
                  : isCompleted
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-slate-700 text-slate-400'
              }`}
            >
              {isCompleted ? '✓' : step.icon}
            </span>
            <span className="truncate">{step.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
