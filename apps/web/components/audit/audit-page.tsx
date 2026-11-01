'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { actionLabel, ENTITY_LABEL, entityLabel, summarizeChange } from '@/lib/audit';
import { DEFAULT_TZ, ErrorBlock, FilterBar, formatDateTime, LoadingBlock, PageHeader, Panel, SelectField, TableScroll, td, th } from '@macuxi/ui/web';
import { useAuditoria, useMe } from '@/lib/queries';
import { useSessao } from '@/lib/session';

/** Entidades no filtro: as que os módulos gravam com `tx.auditar` (RN-AUD-01). */
const ENTITY_OPTIONS = ['pedido', 'alcada', 'rota', 'meta', 'carteira', 'cliente', 'motivo', 'dispositivo', 'notificacao', 'licenca', 'parametro'];

export function AuditPage() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const entity = params.get('entity') ?? '';
  const me = useMe();
  const sessao = useSessao();
  // fuso do tenant: o do login (API real) ou o do `GET /me` (demonstração)
  const tz = sessao.user?.fuso ?? me.data?.tenant.timezone ?? DEFAULT_TZ;
  const q = useAuditoria(entity);
  const rows = q.data ?? [];

  const setEntity = (v: string) => router.replace(v ? `${pathname}?entity=${encodeURIComponent(v)}` : pathname);

  return (
    <>
      <PageHeader title="Auditoria" subtitle="Quem alterou o quê e quando · toda gravação do sistema entra aqui" />
      <FilterBar>
        <SelectField label="Entidade" value={entity} onChange={(e) => setEntity(e.target.value)}>
          <option value="">Todas</option>
          {ENTITY_OPTIONS.map((e) => (
            <option key={e} value={e}>
              {ENTITY_LABEL[e] ?? e}
            </option>
          ))}
        </SelectField>
        {q.data && <span className="pb-2.5 text-[12px] text-ink-2">{rows.length} registros mais recentes</span>}
      </FilterBar>
      {q.isError && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}
      {q.isPending && <LoadingBlock />}
      {q.data && (
        <Panel label="Trilha de auditoria">
          <TableScroll minWidth={820}>
            <thead>
              <tr>
                <th scope="col" className={th}>Quando</th>
                <th scope="col" className={th}>Quem</th>
                <th scope="col" className={th}>Entidade</th>
                <th scope="col" className={th}>Ação</th>
                <th scope="col" className={th}>Antes → depois</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className={`${td} whitespace-nowrap text-ink-2`}>{formatDateTime(a.ocorrido_em, tz)}</td>
                  <td className={`${td} font-semibold whitespace-nowrap`}>{a.usuario_nome ?? (a.usuario_id ? 'Usuário removido' : 'Sistema')}</td>
                  <td className={`${td} whitespace-nowrap`}>{entityLabel(a.entidade)}</td>
                  <td className={`${td} whitespace-nowrap`}>{actionLabel(a.acao)}</td>
                  <td className={`${td} text-ink-3`}>{summarizeChange(a.antes, a.depois)}</td>
                </tr>
              ))}
            </tbody>
          </TableScroll>
          {rows.length === 0 && <span className="text-[13px] text-ink-2">Nada registrado para esta entidade.</span>}
        </Panel>
      )}
    </>
  );
}
