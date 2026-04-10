import { type InputHTMLAttributes } from 'react';

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  error?: string;
};

export function Input({ label, error, id, className = '', ...rest }: Props) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-slate-300">
          {label}
        </label>
      )}
      <input
        id={id}
        className={[
          'rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100',
          'placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500',
          error ? 'border-red-500' : '',
          className,
        ].join(' ')}
        {...rest}
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
