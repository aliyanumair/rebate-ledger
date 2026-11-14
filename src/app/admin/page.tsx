import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
export const dynamic = 'force-dynamic';
export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin') redirect('/dashboard');
  redirect('/dashboard');
}
