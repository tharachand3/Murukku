import { Card } from '../ui/Card.jsx';

const TONES = {
  danger: 'border-red-300 bg-red-50',
  warning: 'border-amber-300 bg-amber-50',
  info: 'border-blue-200 bg-blue-50'
};

export function AlertCard({ tone = 'info', title, children, action }) {
  return (
    <Card
      className={TONES[tone] ?? TONES.info}
      role={tone === 'danger' ? 'alert' : undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="font-semibold text-slate-900">{title}</h3>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children && <div className="mt-2 text-sm text-slate-700">{children}</div>}
    </Card>
  );
}
