'use client';

/**
 * Auditoria da plataforma (RN-AUD-01). Revisão do BKO (docs/design/telas/bko-revisao.md §P1, §P2, §P4, §P6 e §P7):
 * título com a contagem ("Auditoria · 300+": a API devolve os 300 mais recentes, sem contagem exata), "Atualizar" no "⋯" da
 * página, filtro de entidade com "Limpar filtros" só com filtro ligado, `TabelaDados` sem rolagem lateral e o vazio uma vez,
 * sem quadro em volta.
 */
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { LinhaAuditoria } from '@macuxi/platform-sdk';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { actionLabel, ENTITY_LABEL, entityLabel, summarizeChange } from '@/lib/audit';
import {
  Button,
  DEFAULT_TZ,
  ErrorBlock,
  EstadoVazio,
  FilterBar,
  formatDateTime,
  LoadingBlock,
  MenuAcoes,
  PageHeader,
  Panel,
  rotuloComContagem,
  SelectField,
  TabelaDados,
  type ColunaDaTabela,
} from '@macuxi/ui/web';
import { LIMITE_AUDITORIA, useAuditoria, useMe } from '@/lib/queries';
import { useSessao } from '@/lib/session';

/** Entidades no filtro: as que os módulos gravam com `tx.auditar` (RN-AUD-01). */
const ENTITY_OPTIONS = ['pedido', 'alcada', 'rota', 'meta', 'carteira', 'cliente', 'motivo', 'dispositivo', 'notificacao', 'licenca', 'parametro'];

const quem = (a: LinhaAuditoria) => a.usuario_nome ?? (a.usuario_id ? 'Usuário removido' : 'Sistema');

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

  const colunas: ColunaDaTabela<LinhaAuditoria>[] = [
    { id: 'quando', titulo: 'Quando', celula: (a) => formatDateTime(a.ocorrido_em, tz), texto: (a) => formatDateTime(a.ocorrido_em, tz), numero: true, largura: '150px' },
    { id: 'quem', titulo: 'Quem', celula: (a) => <span className="font-semibold">{quem(a)}</span>, texto: quem, largura: '20%' },
    { id: 'entidade', titulo: 'Entidade', celula: (a) => entityLabel(a.entidade), texto: (a) => entityLabel(a.entidade), prioridade: 2, largura: '160px' },
    { id: 'acao', titulo: 'Ação', celula: (a) => actionLabel(a.acao), texto: (a) => actionLabel(a.acao), largura: '150px' },
    {
      id: 'mudanca',
      titulo: 'Antes → depois',
      celula: (a) => <span className="text-ink-3">{summarizeChange(a.antes, a.depois)}</span>,
      texto: (a) => summarizeChange(a.antes, a.depois),
    },
  ];

  return (
    <>
      <PageHeader
        title={rotuloComContagem('Auditoria', rows.length, rows.length >= LIMITE_AUDITORIA)}
        actions={
          // RN-CORE-23 item 6: sem consulta periódica curta; atualiza a cada sync_auto_min ou por este item
          <MenuAcoes
            testId="auditoria.mais-acoes"
            acoes={[{ id: 'atualizar', rotulo: q.isFetching ? 'Atualizando…' : 'Atualizar', desligada: q.isFetching, aoEscolher: () => void q.refetch(), testId: 'auditoria.atualizar' }]}
          />
        }
      />
      <FilterBar>
        <SelectField label="Entidade" value={entity} onChange={(e) => setEntity(e.target.value)}>
          <option value="">Todas</option>
          {ENTITY_OPTIONS.map((e) => (
            <option key={e} value={e}>
              {ENTITY_LABEL[e] ?? e}
            </option>
          ))}
        </SelectField>
        {entity && (
          <Button type="button" size="sm" onClick={() => setEntity('')} data-testid="auditoria.limpar-filtros">
            Limpar filtros
          </Button>
        )}
      </FilterBar>
      {q.isError && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}
      {q.isPending && <LoadingBlock />}
      {q.data &&
        (rows.length === 0 ? (
          <EstadoVazio testId="auditoria.vazio" titulo={entity ? 'Nenhum registro com esses filtros.' : 'Nenhum registro ainda.'} />
        ) : (
          <Panel>
            <TabelaDados testId="auditoria.tabela" rotulo="Trilha de auditoria" colunas={colunas} linhas={rows} chave={(a) => a.id} />
          </Panel>
        ))}
    </>
  );
}
