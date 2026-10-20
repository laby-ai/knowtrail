'use client';
import { useEffect, useState, useRef } from 'react';
import { clientApiFetch } from '@/lib/client-api';
import type { CommerceCatalog, CommerceMembership, ModelSource } from '@/lib/commerce/contracts';
import { CommerceHistory } from './CommerceHistory';
import { CommerceTeam } from './CommerceTeam';

export function MembershipPanel({ memberId }: { memberId: string }) {
  const [catalog, setCatalog] = useState<CommerceCatalog | null>(null);
  const [membership, setMembership] = useState<CommerceMembership | null>(null);
  const [accountId, setAccountId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [annual, setAnnual] = useState(false);
  const [provider, setProvider] = useState('alipay');
  const [payment, setPayment] = useState<{ payment_url?: string; qrImage?: string; bankInstructions?: string } | null>(null);
  const generation = useRef(0);
  const key = `lingbi-commerce-selection:${memberId}`;
  async function load(selected = accountId) {
    const requestGeneration = ++generation.current;
    if (!selected) {
      try { selected = (JSON.parse(window.localStorage.getItem(key) || '{}') as { accountId?: string }).accountId || ''; } catch { /* No saved selection. */ }
    }
    const [plans, status] = await Promise.all([clientApiFetch<CommerceCatalog>('/api/account/commerce/catalog'), clientApiFetch<CommerceMembership>(`/api/account/commerce/membership${selected ? `?accountId=${encodeURIComponent(selected)}` : ''}`)]);
    if (requestGeneration !== generation.current) return;
    setCatalog(plans); setMembership(status);
    window.localStorage.setItem(key, JSON.stringify({ accountId: status.accountId, source: status.modelSource }));
  }
  useEffect(() => { let alive = true; void load().catch(failure => { if (alive) setError(failure instanceof Error ? failure.message : '无法读取会员信息'); }); return () => { alive = false; }; }, [accountId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function action(path: string, body: Record<string, unknown>) {
    setBusy(true); setError('');
    try { const result = await clientApiFetch<Record<string, unknown>>(`/api/account/commerce/${path}`, { method: 'POST', body: JSON.stringify({ accountId: membership?.accountId, ...body }) }); await load(); return result; }
    catch (failure) { setError(failure instanceof Error ? failure.message : '请求失败'); return null; }
    finally { setBusy(false); }
  }
  async function purchase(productId: string) {
    const result = await action('orders', { productId, provider, idempotencyKey: crypto.randomUUID() });
    if (result) setPayment(result);
  }
  async function source(value: ModelSource) {
    const result = await action('preferences', { modelSource: value });
    if (result && membership) window.localStorage.setItem(key, JSON.stringify({ accountId: membership.accountId, source: value }));
  }
  if (!catalog || !membership) return <div className="space-y-3"><p role={error ? 'alert' : 'status'}>{error || '正在读取会员与用量…'}</p><button className="liquid-glass-btn" onClick={() => void load().catch(() => setError('会员服务暂时不可用'))}>重新加载</button>{error && <button className="liquid-glass-btn" onClick={() => { window.localStorage.removeItem(key); setAccountId(''); void load('').catch(() => setError('个人账户暂时不可用')); }}>切换个人账户</button>}</div>;
  const ready = membership.readiness.chargingReady;
  return <div className="min-w-0 space-y-6 text-sm leading-6" data-testid="membership-panel">
    <div className="rounded-xl border p-4"><p className="font-semibold">{membership.planName}{membership.endsAt ? ` · 服务至 ${membership.endsAt.slice(0, 10)}` : ''}</p><p className="mt-2">{membership.role === "admin" ? `赠送 ${membership.balance.gifted} 点 · 购买 ${membership.balance.purchased} 点 · 预占 ${membership.balance.reserved} 点` : `成员剩余月预算：${membership.budgetRemaining ?? "未单独限制"} 点 · 自己预占 ${membership.balance.reserved} 点`}</p><p className="text-[var(--text-secondary)]">赠送点数当月到期，购买点数无到期日。先使用即将到期的点数。</p></div>
    {!ready && <div role="status" className="rounded-xl border bg-[var(--bg-secondary)] p-4"><p className="font-medium">当前处于用量采集阶段，暂未开放购买和扣费。</p><ul className="mt-2 list-disc pl-5">{membership.readiness.blockers.map(item => <li key={item}>{item}</li>)}</ul></div>}
    {error && <p role="alert" className="break-words text-red-600">{error}</p>}
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="space-y-2">付款账户<select aria-label="科研付款账户" className="liquid-glass-input w-full" value={membership.accountId} onChange={event => setAccountId(event.target.value)}>{membership.accounts.map(item => <option key={item.id} value={item.id}>{item.name}（{item.kind === 'team' ? '课题组' : '个人'}）</option>)}</select></label>
      <label className="space-y-2">模型来源<select aria-label="模型费用来源" disabled={busy} className="liquid-glass-input w-full" value={membership.modelSource} onChange={event => void source(event.target.value as ModelSource)}><option value="platform">平台模型</option><option value="byok">自带服务密钥</option></select></label>
    </div>
    <p className="text-[var(--text-secondary)]">自带密钥的模型费用由百炼直接收取；灵笔只结算实际使用的平台服务。失败时不会自动切换平台模型扣费。</p>
    {!membership.verified && membership.kind === 'personal' && <section className="space-y-3 rounded-xl border p-4"><h3 className="font-semibold">验证邮箱，领取 100 点体验额度</h3><div className="flex flex-wrap gap-3"><button disabled={busy} className="liquid-glass-btn" onClick={() => void action('verify-email/request', {})}>发送验证码</button><input aria-label="邮箱验证验证码" className="liquid-glass-input min-w-0" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} /><button disabled={busy || code.length !== 6} className="liquid-glass-btn" onClick={() => void action('verify-email/confirm', { code })}>验证邮箱</button></div></section>}
    <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">会员套餐 · 试运营建议价</h3><label><input type="checkbox" checked={annual} onChange={event => setAnnual(event.target.checked)} /> 年付，每月发点</label></div>
      <div className="grid gap-3 sm:grid-cols-2">{Object.entries(catalog.plans).filter(([id]) => id !== 'free').map(([id, plan]) => <article key={id} className="space-y-2 rounded-xl border p-4"><h4 className="font-semibold">{plan.name}</h4><p className="text-lg font-semibold">¥{(annual ? plan.annual : plan.monthly) / 100} / {annual ? '年' : '月'}</p><p>每月 {plan.points} 点 · {plan.storage / 1073741824}GB · {plan.notebooks === null ? '文献本数量不限' : `${plan.notebooks} 个文献本`}{id === 'team' ? ` · ${plan.seats} 席位` : ''}</p><button disabled={busy || !ready || membership.role !== 'admin' || (id === 'team') !== (membership.kind === 'team')} className="liquid-glass-btn" onClick={() => void purchase(`${id}.${annual ? 'annual' : 'monthly'}`)}>购买{plan.name}</button></article>)}</div>
      <p className="text-[var(--text-secondary)]">到期后仍可查看、下载和导出已有资料；超出容量时暂停新增上传，不自动删除资料。未配置的视频、全文解析和期刊影响因子不作为付费权益。</p>
    </section>
    <section className="space-y-3"><h3 className="font-semibold">购买科研点数</h3><select aria-label="支付方式" className="liquid-glass-input" value={provider} onChange={event => setProvider(event.target.value)}><option value="alipay">支付宝</option><option value="wechat">微信支付</option>{membership.kind === 'team' && <option value="bank">对公转账</option>}</select><div className="flex flex-wrap gap-3">{catalog.pointPacks.map(pack => <button key={pack.id} disabled={busy || !ready || membership.role !== 'admin'} className="liquid-glass-btn" onClick={() => void purchase(pack.id)}>¥{pack.amountFen / 100} · {pack.points} 点</button>)}</div><p>¥1＝100 点。价格与点数由账号服务确定，首发手动续费。</p></section>
    {payment && <div className="space-y-3 rounded-xl border p-4">{payment.payment_url && /^https:\/\/openapi\.alipay\.com\//.test(payment.payment_url) && <a href={payment.payment_url} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-blue)]">打开支付宝付款</a>}{payment.qrImage && <img src={payment.qrImage} alt="微信支付二维码" width={220} height={220} />}{payment.bankInstructions && <p className="whitespace-pre-wrap">{payment.bankInstructions}</p>}<p>付款后点击刷新核验到账；打开支付页面不代表支付成功。</p><button className="liquid-glass-btn" onClick={() => void load().catch(() => setError('到账核验失败，请重试'))}>刷新会员与余额</button></div>}
    <CommerceTeam purchase={purchase} membership={membership} busy={busy} action={action} />
    <CommerceHistory membership={membership} busy={busy} action={action} /><p className="text-xs text-[var(--text-secondary)]">退款规则：{catalog.refundPolicy}</p>
  </div>;
}
