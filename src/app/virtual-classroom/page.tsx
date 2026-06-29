import Link from 'next/link';
import { redirect } from 'next/navigation';
import { publicClassroomOrigin } from '@/lib/virtual-classroom/runtime-config';

export const dynamic = 'force-dynamic';

export default function VirtualClassroomPage() {
  const classroomOrigin = publicClassroomOrigin();
  if (classroomOrigin) {
    redirect(classroomOrigin);
  }

  return (
    <main className="min-h-screen bg-[#f8fbff] px-6 py-10 text-slate-950">
      <section className="mx-auto max-w-5xl rounded-[28px] border border-blue-100 bg-white p-8 shadow-[0_24px_80px_rgba(37,99,235,0.08)]">
        <p className="text-sm font-semibold text-blue-600">虚拟教室</p>
        <h1 className="mt-3 text-3xl font-normal tracking-tight md:text-5xl">课堂服务未连接</h1>
        <p className="mt-5 max-w-2xl text-base leading-8 text-slate-600">
          当前环境还没有连接完整课堂运行时。请回到工作台继续资料问答，待课堂服务连接后再进入虚拟教室。
        </p>
        <Link href="/?view=workbench#workbench" className="mt-8 inline-flex rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
          回到工作台
        </Link>
      </section>
    </main>
  );
}
