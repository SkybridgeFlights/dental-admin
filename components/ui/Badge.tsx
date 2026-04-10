type Variant = 'green' | 'yellow' | 'red' | 'slate' | 'blue';

const variants: Record<Variant, string> = {
  green:  'bg-emerald-900/60 text-emerald-300 ring-emerald-700/40',
  yellow: 'bg-yellow-900/60 text-yellow-300 ring-yellow-700/40',
  red:    'bg-red-900/60 text-red-300 ring-red-700/40',
  slate:  'bg-slate-700/60 text-slate-300 ring-slate-600/40',
  blue:   'bg-blue-900/60 text-blue-300 ring-blue-700/40',
};

type Props = { variant?: Variant; children: React.ReactNode; className?: string };

export function Badge({ variant = 'slate', children, className = '' }: Props) {
  return (
    <span
      className={[
        'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        variants[variant],
        className,
      ].join(' ')}
    >
      {children}
    </span>
  );
}
