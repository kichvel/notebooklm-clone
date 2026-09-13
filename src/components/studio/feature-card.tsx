'use client';

import type { LucideIcon } from 'lucide-react';

export function FeatureCard({
  icon: Icon,
  label,
  tint,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  tint: 'blue' | 'green' | 'purple';
  disabled?: boolean;
  onClick: () => void;
}) {
  const tintClasses = {
    blue: 'bg-primary/10 text-primary',
    green: 'bg-emerald-500/10 text-emerald-500',
    purple: 'bg-purple-500/10 text-purple-400',
  }[tint];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-start gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:border-primary/40 disabled:pointer-events-none disabled:opacity-50"
    >
      <span className={`inline-flex size-8 items-center justify-center rounded-md ${tintClasses}`}>
        <Icon className="size-4" />
      </span>
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}
