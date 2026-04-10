import { Badge } from '@/components/ui/Badge';

const clinicStatusMap = {
  active:    { label: 'Active',    variant: 'green'  },
  inactive:  { label: 'Inactive',  variant: 'slate'  },
  suspended: { label: 'Suspended', variant: 'red'    },
} as const;

const deviceStatusMap = {
  active:  { label: 'Active',  variant: 'green' },
  revoked: { label: 'Revoked', variant: 'red'   },
  blocked: { label: 'Blocked', variant: 'yellow' },
} as const;

const planMap = {
  standard:   { label: 'Standard',   variant: 'slate' },
  pro:        { label: 'Pro',        variant: 'blue'  },
  enterprise: { label: 'Enterprise', variant: 'yellow' },
} as const;

export function ClinicStatusBadge({ status }: { status: keyof typeof clinicStatusMap }) {
  const { label, variant } = clinicStatusMap[status] ?? { label: status, variant: 'slate' };
  return <Badge variant={variant}>{label}</Badge>;
}

export function DeviceStatusBadge({ status }: { status: keyof typeof deviceStatusMap }) {
  const { label, variant } = deviceStatusMap[status] ?? { label: status, variant: 'slate' };
  return <Badge variant={variant}>{label}</Badge>;
}

export function PlanBadge({ plan }: { plan: keyof typeof planMap }) {
  const { label, variant } = planMap[plan] ?? { label: plan, variant: 'slate' };
  return <Badge variant={variant}>{label}</Badge>;
}
