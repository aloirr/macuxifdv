'use client';

/**
 * Empresas do portal (T-0087; spec docs/design/telas/portal-config-enxuto.md §3, §4 e §11.5): lista (`GET /v1/plataforma/empresas`,
 * Empresa · Código · CNPJ · Plano · Situação · Criada em; o código da licença em maiúsculas) e "Nova empresa". testIDs: empresas.*.
 * ADR 0052 (spec portal-config-enxuto §15): com o bloco `acoes` na resposta, a lista ganha a coluna Backup e o menu "⋯" com
 * Backup, Inativar/Reativar e Excluir (`empresas-acoes.tsx`). Sem o bloco (servidor sem `MACUXI_EMPRESA_ACOES`), fica como era.
 * T-0093 (RN-CORE-33): as duas páginas são só do time da Macuxi; o admin do cliente vai para a página da empresa dele (ou para a
 * escolha, com 2+ sem escolher).
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ListaEmpresasSchema } from '@macuxi/platform-sdk';
import { Badge, ErrorBlock, LoadingBlock, PageHeader, Panel, TableScroll, td, th } from '@macuxi/ui/web';

import { chamarPortal, mensagemDoErro } from '@/lib/portal-api';
import { ACOMPANHAR_ACAO_MS, rotuloDoStatus, TEXTOS_EMPRESA_ACOES, tomDoStatus, type EmpresaResumo } from '@/lib/portal-empresa-acoes';
import { codigoDaLicenca, mascararCnpj } from '@/lib/portal-formato';
import { TEXTOS_NOVA_EMPRESA } from '@/lib/portal-nova-empresa';
import { TEXTOS_PLANO } from '@/lib/portal-planos';
import { ROTAS_PORTAL } from '@/lib/portal-rotas';
import { destinoDaSessao, ehTimeMacuxi } from '@/lib/portal-sessao';
import { LinkBotao, MolduraPortal, useSessaoPortal } from './base';
import { CelulaBackup, MenuDaEmpresa, useAcoesDasEmpresas } from './empresas-acoes';
import { NovaEmpresa } from './passo-empresa';

export const CHAVE_EMPRESAS = ['portal', 'empresas'] as const;

/** Backup ou exclusão rodando no worker: a lista se atualiza em ACOMPANHAR_ACAO_MS até terminar (ADR 0052). */
const rodando = (e: EmpresaResumo) => e.status === 'encerrado' || e.acoes?.ultimo_backup?.situacao === 'em_andamento' || e.acoes?.exclusao?.situacao === 'em_andamento';

export function useEmpresas() {
  return useQuery({
    queryKey: CHAVE_EMPRESAS,
    queryFn: () => chamarPortal(ROTAS_PORTAL.empresas, { schema: ListaEmpresasSchema }).then((r) => r.itens),
    // timer-permitido: ver ACOMPANHAR_ACAO_MS
    refetchInterval: (q) => (q.state.data?.some(rodando) ? ACOMPANHAR_ACAO_MS : false),
  });
}

const data = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

/** Coluna Plano (§11.5): nome do plano ou "—" sem plano (`null` ou banco sem a 0071); `teste` = mostrar o selo "teste". */
export function celulaDoPlano(e: Pick<EmpresaResumo, 'plano' | 'em_teste'>): { nome: string; teste: boolean } {
  const nome = e.plano?.trim();
  return nome ? { nome, teste: e.em_teste === true } : { nome: '—', teste: false };
}

function CelulaPlano({ empresa }: { empresa: EmpresaResumo }) {
  const { nome, teste } = celulaDoPlano(empresa);
  return (
    <span className="inline-flex items-center gap-1.5">
      {nome}
      {teste && <Badge tone="neutral">{TEXTOS_PLANO.teste}</Badge>}
    </span>
  );
}

/** Página só do time da Macuxi: o admin do cliente é levado à página inicial dele. `true` = pode mostrar. */
function useSoTimeMacuxi(): boolean {
  const sessao = useSessaoPortal();
  const router = useRouter();
  const cliente = sessao?.tipo === 'admin_cliente';
  useEffect(() => {
    if (sessao && cliente) router.replace(destinoDaSessao(sessao));
  }, [sessao, cliente, router]);
  return ehTimeMacuxi(sessao);
}

function AbrindoAEmpresa() {
  return <LoadingBlock label="Abrindo a sua empresa…" />;
}

export function TelaEmpresas() {
  const pode = useSoTimeMacuxi();
  return (
    <MolduraPortal
      titulo={
        pode ? (
          <PageHeader
            title="Empresas"
            actions={
              <LinkBotao href="/empresas/nova" testId="empresas.nova" primario>
                {TEXTOS_NOVA_EMPRESA.titulo}
              </LinkBotao>
            }
          />
        ) : undefined
      }
    >
      {pode ? <ListaEmpresas /> : <AbrindoAEmpresa />}
    </MolduraPortal>
  );
}

export function ListaEmpresas() {
  const q = useEmpresas();
  const acoes = useAcoesDasEmpresas(CHAVE_EMPRESAS);
  if (q.isPending) return <LoadingBlock label="Buscando as empresas…" />;
  if (q.isError) return <ErrorBlock message={mensagemDoErro(q.error)} onRetry={() => void q.refetch()} />;
  if (q.data.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        {acoes.topo}
        <Panel>
          <span data-testid="empresas.vazio" className="py-4 text-[15px] text-ink-2">
            Nenhuma empresa ainda.
          </span>
        </Panel>
      </div>
    );
  }
  const comAcoes = q.data.some((e) => e.acoes);
  return (
    <div className="flex flex-col gap-3">
      {acoes.topo}
      <Panel>
        <TableScroll minWidth={comAcoes ? 1040 : 760}>
          <table data-testid="empresas.lista" className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={th}>Empresa</th>
                <th className={th}>Código</th>
                <th className={th}>CNPJ</th>
                <th className={th}>Plano</th>
                <th className={th}>Situação</th>
                <th className={th}>Criada em</th>
                {comAcoes && <th className={th}>{TEXTOS_EMPRESA_ACOES.colunaBackup}</th>}
                {comAcoes && <th className={th} aria-label={TEXTOS_EMPRESA_ACOES.colunaAcoes} />}
              </tr>
            </thead>
            <tbody>
              {q.data.map((e) => (
                <tr key={e.id} data-testid={`empresas.linha-${e.codigo}`} className="hover:bg-ground">
                  <td className={`${td} whitespace-nowrap`}>
                    <Link href={`/empresas/${e.id}`} data-testid={`empresas.abrir-${e.codigo}`} className="font-semibold text-ink no-underline hover:text-accent-ink hover:underline">
                      {e.razao_social}
                    </Link>
                  </td>
                  <td className={`${td} font-mono whitespace-nowrap`}>{codigoDaLicenca(e.codigo)}</td>
                  <td className={`${td} whitespace-nowrap tabular-nums`}>{e.cnpj ? mascararCnpj(e.cnpj) : '—'}</td>
                  <td className={td}>
                    <CelulaPlano empresa={e} />
                  </td>
                  <td className={td} data-testid={`empresas.situacao-${e.codigo}`}>
                    <Badge tone={tomDoStatus(e.status)}>{rotuloDoStatus(e.status)}</Badge>
                  </td>
                  <td className={`${td} tabular-nums`}>{data(e.criada_em)}</td>
                  {comAcoes && <td className={td}>{e.acoes ? <CelulaBackup empresa={{ ...e, acoes: e.acoes }} pedindo={acoes.pedindoBackup.has(e.id)} /> : '—'}</td>}
                  {comAcoes && (
                    <td className={`${td} w-12 text-right`}>
                      {e.acoes && <MenuDaEmpresa empresa={{ ...e, acoes: e.acoes }} acoes={acoes.menu({ ...e, acoes: e.acoes })} />}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Panel>
      {acoes.fundo}
    </div>
  );
}

export function TelaNovaEmpresa() {
  const qc = useQueryClient();
  const pode = useSoTimeMacuxi();
  return (
    <MolduraPortal
      voltar={{ href: '/empresas', rotulo: 'Empresas' }}
      titulo={pode ? <PageHeader title={TEXTOS_NOVA_EMPRESA.titulo} /> : undefined}
    >
      {/* A lista em cache ainda não tem a empresa nova: invalida antes de ir à página dela (sem o aviso "não encontrada"). */}
      {pode ? <NovaEmpresa aoGravar={() => void qc.invalidateQueries({ queryKey: CHAVE_EMPRESAS })} /> : <AbrindoAEmpresa />}
    </MolduraPortal>
  );
}
