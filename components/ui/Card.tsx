type Props = { children: React.ReactNode; className?: string };

export function Card({ children, className = '' }: Props) {
  return (
    <div
      className={[
        'rounded-xl border border-slate-700/60 bg-slate-800/60 p-5',
        className,
      ].join(' ')}
    >
      {children}
    </div>
  );
}
