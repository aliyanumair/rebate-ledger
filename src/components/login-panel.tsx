"use client";
import {FormEvent,useState} from 'react';
import {useRouter} from 'next/navigation';
export function LoginPanel() {
  const router=useRouter(); const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
  async function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();if(busy)return;setBusy(true);setMessage('');const data=new FormData(e.currentTarget);
    try {
      const email=String(data.get('email')).trim().toLowerCase();
      const response=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:String(data.get('password'))})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not sign in.');
      localStorage.setItem('rebateledger:session',JSON.stringify({email:result.email,name:result.role==='admin'?'MarginsRecovery Admin':'Demo Controller',role:result.role==='admin'?'Admin':'Controller',company:'MarginsRecovery'}));
      router.push('/dashboard');router.refresh();
    }catch(error){setMessage(error instanceof Error?error.message:'Could not sign in.');}finally{setBusy(false);}
  }
  return <section className="login-card"><div className="eyebrow">CONTROLLER WORKSPACE</div><h2>Sign in to your workspace</h2><p>Use the credentials supplied with your audit invitation. Demo credentials are shared privately.</p><form onSubmit={submit}><label>Email address<input required name="email" type="email" autoComplete="username"/></label><label>Password<input required name="password" type="password" autoComplete="current-password"/></label>{message&&<p role="alert" className="form-error">{message}</p>}<button disabled={busy} className="button button-primary submit-wide" type="submit">{busy?'Signing in…':'Sign in →'}</button></form><p className="form-note">The demo controller workspace uses synthetic data. The admin queue contains private submissions and is restricted to authorized reviewers.</p></section>;
}
