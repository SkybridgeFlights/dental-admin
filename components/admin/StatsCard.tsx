import { Card } from '@/components/ui/Card';

type Props = {
  label: string;
  value: number;
  sub?: string;
  accent?: 'green' | 'red' | 'yellow' | 'blue' | 'slate';
};

const accentClasses = {
  green:  'text-emerald-400',
  red:    'text-red-400',
  yellow: 'text-yellow-400',
  blue:   'text-blue-400',
  slate:  'text-slate-300',
};

export function StatsCard({ label, value, sub, accent = 'slate' }: Props) {
  return (
    <Card className="flex flex-col gap-1">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`text-4xl font-bold tabular-nums ${accentClasses[accent]}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </Card>
  );
}
