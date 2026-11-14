import { AuditExplorer } from "@/components/audit-explorer";

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <AuditExplorer auditId={id}/>; }
