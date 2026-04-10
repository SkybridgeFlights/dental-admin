import { redirect } from 'next/navigation';

// Root → redirect based on session (middleware handles the actual auth check)
export default function RootPage() {
  redirect('/dashboard');
}
