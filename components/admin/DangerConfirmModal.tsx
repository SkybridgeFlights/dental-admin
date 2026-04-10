'use client';

type DangerConfirmModalProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  confirmTone?: 'danger' | 'warning';
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DangerConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  confirmTone = 'danger',
  busy = false,
  onCancel,
  onConfirm,
}: DangerConfirmModalProps) {
  if (!open) {
    return null;
  }

  const confirmClassName = confirmTone === 'warning'
    ? 'border-amber-700/60 bg-amber-950 text-amber-300 hover:bg-amber-900'
    : 'border-red-700/60 bg-red-950 text-red-300 hover:bg-red-900';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-slate-700/60 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-100">{title}</h2>
        </div>

        <div className="px-5 py-4">
          <p className="text-sm leading-6 text-slate-300">{message}</p>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-700/60 px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${confirmClassName}`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
