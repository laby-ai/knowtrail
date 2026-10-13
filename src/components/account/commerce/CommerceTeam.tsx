'use client';
import { useState } from 'react';
import type { CommerceMembership } from '@/lib/commerce/contracts';
type Props = { purchase: (productId: string) => Promise<void>; membership: CommerceMembership; busy: boolean; action: (path: string, body: Record<string, unknown>) => Promise<Record<string, unknown> | null> };
export function CommerceTeam({ membership, busy, action, purchase }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [budget, setBudget] = useState('1000');
  return <section className="space-y-4 rounded-xl border p-4"><h3 className="font-semibold">课题组账户</h3><div className="flex flex-wrap gap-3"><input aria-label="课题组名称" className="liquid-glass-input min-w-0" value={name} maxLength={80} onChange={event => setName(event.target.value)} placeholder="课题组名称" /><button className="liquid-glass-btn" disabled={busy || !name.trim()} onClick={() => void action('teams', { name })}>创建课题组账户</button></div>
    {membership.kind === 'team' && membership.role === 'admin' && <><div className="grid gap-3 sm:grid-cols-2"><input type="email" aria-label="课题组成员邮箱" className="liquid-glass-input min-w-0" value={email} onChange={event => setEmail(event.target.value)} placeholder="同一组织成员邮箱" /><input type="number" aria-label="成员月点数预算" className="liquid-glass-input" min="0" max="10000000" value={budget} onChange={event => setBudget(event.target.value)} /></div><div className="flex flex-wrap gap-3">{[['add', '添加成员'], ['budget', '设置月预算'], ['remove', '移除成员']].map(([operation, label]) => <button key={operation} className="liquid-glass-btn" disabled={busy || !email.includes('@')} onClick={() => void action('team-members', { email, action: operation, points: Number(budget) })}>{label}</button>)}</div><ul className="space-y-2">{Object.entries(membership.members || {}).map(([id, role]) => <li key={id} className="break-all">{id} · {role === 'admin' ? '管理员' : '成员'} · 月预算 {membership.budgets?.[id] ?? '未单独限制'} 点</li>)}</ul><p>5 个基础席位；额外席位 ¥39/月或 ¥390/年，不赠送点数。</p><div className="flex flex-wrap gap-3"><button className="liquid-glass-btn" disabled={busy || !membership.readiness.chargingReady || membership.plan !== "team"} onClick={() => void purchase("seat.monthly")}>购买月付席位</button><button className="liquid-glass-btn" disabled={busy || !membership.readiness.chargingReady || membership.plan !== "team"} onClick={() => void purchase("seat.annual")}>购买年付席位</button></div></>}
    {membership.kind === 'team' && membership.role !== 'admin' && <p>你的月预算：{membership.budget ?? '管理员未单独设置'} 点。团队余额不足不会自动扣个人账户。</p>}
  </section>;
}
