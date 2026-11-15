import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageHeader } from '@macuxi/ui/web';

/** Telas previstas para depois do MVP (Fase M: docs/07-web-bko.md). */
export function LaterPage({ title, icon, summary, items }: { title: string; icon: ReactNode; summary: string; items: string[] }) {
  return (
    <>
      <PageHeader title={title} subtitle="Depois do MVP" />
      <section className="flex max-w-[720px] flex-col gap-4 rounded-2xl border border-line bg-surface p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent-ink">{icon}</span>
          <div className="flex flex-col">
            <span className="text-[12px] font-semibold tracking-[0.06em] text-accent-ink uppercase">Em breve</span>
            <span className="font-display text-[18px] font-bold">{summary}</span>
          </div>
        </div>
        <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-[14px] text-ink-3">
          {items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
        <span className="text-[13px] text-ink-2">
          Esta tela entra depois da aprovação do MVP. Enquanto isso, acompanhe pelo{' '}
          <Link href="/pedidos" className="font-semibold text-accent-ink no-underline hover:underline">
            farol de pedidos
          </Link>
          .
        </span>
      </section>
    </>
  );
}
