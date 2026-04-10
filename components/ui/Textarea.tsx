import { type TextareaHTMLAttributes } from 'react';

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string };

export function Textarea({ label, id, className = '', ...rest }: Props) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-slate-300">
          {label}
        </label>
      )}
      <textarea
        id={id}
        rows={3}
        className={[
          'rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100',
          'placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none',
          className,
        ].join(' ')}
        {...rest}
      />
    </div>
  );
}
