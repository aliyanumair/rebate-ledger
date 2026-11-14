"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const USERS = [
  { email: "controller@acme-hvac.com", password: "Demo1234!", name: "Jordan Lee", role: "Controller", company: "Acme HVAC Supply" },
  { email: "admin@rebateledger.com", password: "Admin1234!", name: "RebateLedger Admin", role: "Admin", company: "RebateLedger" },
];

export function LoginPanel() {
  const router = useRouter(); const [message, setMessage] = useState("");
  async function authenticate(email:string,password:string) { const response = await fetch("/api/auth/login", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({email,password}) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "Could not sign in."); const account=USERS.find(item=>item.email===email)!; localStorage.setItem("rebateledger:session", JSON.stringify(account)); router.push("/dashboard"); }
  async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const data = new FormData(e.currentTarget); try { setMessage(""); await authenticate(String(data.get("email")),String(data.get("password"))); } catch(error) { setMessage(error instanceof Error?error.message:"Could not sign in."); } }
  async function quick(user: typeof USERS[number]) { try { await authenticate(user.email,user.password); } catch(error) { setMessage(error instanceof Error?error.message:"Could not sign in."); } }
  return <section className="login-card"><div className="eyebrow">WELCOME BACK</div><h2>Sign in to your workspace</h2><p>Use one of the seeded demo accounts to explore RebateLedger.</p><form onSubmit={submit}><label>Email address<input required name="email" type="email" defaultValue="controller@acme-hvac.com"/></label><label>Password<input required name="password" type="password" defaultValue="Demo1234!"/></label>{message && <p className="form-error">{message}</p>}<button className="button button-primary submit-wide" type="submit">Sign in <span>→</span></button></form><div className="or-line"><span>QUICK DEMO ACCESS</span></div><button className="demo-account" onClick={() => quick(USERS[0])}><span className="demo-avatar">JL</span><span><b>Client controller</b><small>Acme HVAC Supply · demo data</small></span><strong>→</strong></button><button className="demo-account" onClick={() => quick(USERS[1])}><span className="demo-avatar admin-avatar">RL</span><span><b>Founder admin</b><small>Audit intake queue</small></span><strong>→</strong></button><div className="demo-credentials"><b>Demo credentials</b><span>controller@acme-hvac.com / Demo1234!</span><span>admin@rebateledger.com / Admin1234!</span></div></section>;
}
