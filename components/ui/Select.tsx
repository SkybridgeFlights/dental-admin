import { type SelectHTMLAttributes } from 'react';

type Props = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  error?: string;
};

export function Select({ label, error, id, className = '', children, ...rest }: Props) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-slate-300">
          {label}
        </label>
      )}
      <select
        id={id}
        className={[
          'rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100',
          'focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500',
          error ? 'border-red-500' : '',
          className,
        ].join(' ')}
        {...rest}
      >
        {children}
      </select>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
