import { DashboardShell } from '@/components/dashboard-shell';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
export const dynamic = 'force-dynamic';
export default async function DashboardLayout({children}:{children:React.ReactNode}) {
  if (!(await getSession())) redirect('/login');
  return <DashboardShell>{children}</DashboardShell>;
}
