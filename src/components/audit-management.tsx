"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type AuditItem = { id: string; createdAt: string; supplierName: string; contractName: string | null; csvName: string; recoveryFound: string };

function currency(value: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value));
}

export function DeleteAuditButton({ auditId, onDeleted }: { auditId: string; onDeleted?: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function remove() {
    if (!window.confirm('Permanently delete this audit and its uploaded source files? This cannot be undone.')) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/audits/${encodeURIComponent(auditId)}`, { method: 'DELETE', cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not delete this audit.');
      if (onDeleted) onDeleted(); else router.push('/dashboard');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete this audit.');
    } finally { setBusy(false); }
  }
  return <div className="audit-delete-control"><button type="button" className="button button-danger" onClick={remove} disabled={busy}>{busy ? 'Deleting…' : 'Delete audit'}</button>{error && <p role="alert" className="form-error">{error}</p>}</div>;
}

export function UploadedAuditList() {
  const [audits, setAudits] = useState<AuditItem[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    fetch('/api/audits/mine', { cache: 'no-store' }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load uploaded audits.');
      setAudits(data.audits || []);
    }).catch(caught => setError(caught instanceof Error ? caught.message : 'Could not load uploaded audits.')).finally(() => setLoaded(true));
  }, []);
  return <section className="panel audit-panel uploaded-audits"><div className="panel-head"><div><h2>Uploaded audits</h2><p>Open or permanently remove an uploaded audit and its source files.</p></div><span className="tag tag-neutral">{audits.length} AUDITS</span></div>
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="table-wrap"><table><thead><tr><th>SUPPLIER</th><th>CREATED</th><th>RECOVERY FOUND</th><th>ACTIONS</th></tr></thead><tbody>
      {audits.map(audit => <tr key={audit.id}><td><Link href={`/dashboard/audits/${audit.id}`}><b>{audit.supplierName}</b></Link><small>{audit.contractName || audit.csvName}</small></td><td>{new Date(audit.createdAt).toLocaleString()}</td><td className="money-cell">{currency(audit.recoveryFound)}</td><td className="audit-row-actions"><Link className="button button-light" href={`/dashboard/audits/${audit.id}`}>Open</Link><DeleteAuditButton auditId={audit.id} onDeleted={() => setAudits(current => current.filter(item => item.id !== audit.id))}/></td></tr>)}
      {loaded && audits.length === 0 && <tr className="empty-row"><td colSpan={4}>No uploaded audits yet.</td></tr>}
      {!loaded && audits.length === 0 && <tr><td colSpan={4}>Loading audits…</td></tr>}
    </tbody></table></div>
  </section>;
}
