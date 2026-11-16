import Link from "next/link";
import { LoginPanel } from "@/components/login-panel";

export default function LoginPage() {
  return <main className="auth-shell"><Link className="brand auth-brand" href="/"><span className="brand-mark">M</span> MarginsRecovery</Link><div className="auth-layout"><div className="auth-aside"><div className="eyebrow">THE REBATE CONTROL ROOM</div><h1>Make every<br/>credit <em>count.</em></h1><p>Bring supplier terms and transaction data into one reviewable, auditable workspace.</p><div className="auth-quote"><span>“</span><p>Know what you earned, what you received, and exactly where the difference came from.</p><small>MARGINSRECOVERY WORKSPACE</small></div></div><LoginPanel/></div><div className="auth-bottom"><Link href="/">← Back to overview</Link><span>Secure workspace · Demo mode</span></div></main>;
}
