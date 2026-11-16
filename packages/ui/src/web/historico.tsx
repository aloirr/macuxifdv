'use client';

/**
 * T-0133 (RN-VEN-30, RF-VEN-05): histórico do pedido/orçamento em tags no BKO, igual ao do app (Campo e Gestão usam os
 * componentes de mesmo nome do kit mobile). Spec: docs/design/pedido-v2.md §5.
 * Rótulos, tons, data curta e leitura vêm de `tagsDoHistorico` (../comum/historico.ts): "Salvo · 08/11 10:35";
 * Rejeitado e Cancelado com o motivo numa linha só, abaixo da tag. Nenhum texto fixo. Cor sempre com texto.
 */
import { leituraDoHistorico, type TagDoHistorico, type TomTag } from '../comum/historico';
import { cx, type BadgeTone } from './ui';

export { quandoCurto, rotulosDoHistorico, tagDoHistorico, tagsDoHistorico } from '../comum/historico';
export type { EventoDoHistorico, TagDoHistorico, TipoDoRegistro, TomTag } from '../comum/historico';

/** Tom da tag → tom do `Badge` do BKO (destaque = `pending`: accent-ink no accent-soft). */
export const TOM_TAG_WEB: Record<TomTag, BadgeTone> = { sucesso: 'success', aviso: 'warning', erro: 'danger', neutro: 'neutral', destaque: 'pending' };

const CLASSE_TOM: Record<BadgeTone, string> = {
  pending: 'text-accent-ink bg-accent-soft',
  success: 'text-success bg-success-soft',
  danger: 'text-danger bg-danger-soft',
  neutral: 'text-ink-3 bg-neutral-soft',
  warning: 'text-warning bg-warning-soft',
};

export function TagHistorico({ tag, testId }: { tag: TagDoHistorico; testId?: string }) {
  const id = testId ?? `historico.${tag.id}`;
  return (
    <li data-testid={id} className={cx('flex min-w-0 flex-col gap-0.5', tag.motivo ? 'basis-full' : 'max-w-full')}>
      <span className="sr-only">{tag.leitura}</span>
      <span aria-hidden className={cx('inline-block max-w-full self-start truncate rounded-lg px-2 py-[3px] text-[12px] font-medium whitespace-nowrap', CLASSE_TOM[TOM_TAG_WEB[tag.tom]])}>
        {tag.texto}
      </span>
      {tag.motivo ? (
        <span aria-hidden data-testid={`${id}.motivo`} title={tag.motivo} className="truncate pl-0.5 text-[13px] text-ink-2">
          {tag.motivo}
        </span>
      ) : null}
    </li>
  );
}

export function HistoricoEmTags({ tags, titulo, testId = 'historico' }: { tags: ReadonlyArray<TagDoHistorico>; titulo: string; testId?: string }) {
  if (tags.length === 0) return null;
  return (
    <ul data-testid={testId} aria-label={leituraDoHistorico(titulo, tags.length)} className="m-0 flex list-none flex-wrap items-start gap-1.5 p-0">
      {tags.map((t) => (
        <TagHistorico key={t.id} tag={t} testId={`${testId}.${t.id}`} />
      ))}
    </ul>
  );
}
