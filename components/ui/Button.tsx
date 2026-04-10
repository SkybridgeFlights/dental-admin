import { type ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size    = 'sm' | 'md';

const variantClasses: Record<Variant, string> = {
  primary:   'bg-blue-600 text-white hover:bg-blue-500 disabled:bg-blue-800',
  secondary: 'bg-slate-700 text-slate-200 hover:bg-slate-600 disabled:bg-slate-800',
  danger:    'bg-red-700 text-white hover:bg-red-600 disabled:bg-red-900',
  ghost:     'text-slate-300 hover:bg-slate-700 disabled:text-slate-600',
};

const sizeClasses: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  disabled,
  children,
  ...rest
}: Props) {
  return (
    <button
      disabled={disabled}
      className={[
        'inline-flex items-center gap-2 rounded-md font-medium transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500',
        'disabled:cursor-not-allowed',
        variantClasses[variant],
        sizeClasses[size],
        className,
      ].join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
}
