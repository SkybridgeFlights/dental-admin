import { redirect } from 'next/navigation';

// The bare clinic-creation form was consolidated into the onboarding wizard,
// which creates the clinic, owner account, device, and license in one flow.
// Redirect any direct/bookmarked visits so nothing 404s.
export default function NewClinicPage() {
  redirect('/dashboard/onboard');
}
