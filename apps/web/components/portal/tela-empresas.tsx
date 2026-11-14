'use client';

/**
 * Empresas do portal (T-0087; spec docs/design/telas/portal-config-enxuto.md §3 e §11.5): lista (`GET /v1/plataforma/empresas`) e
 * "Nova empresa". Tabela Empresa · Código · CNPJ · Plano · Situação · Criada em; o código é o da licença (UF + 4 dígitos), em
 * maiúsculas. testIDs: empresas.*.
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
import { codigoDaLicenca, mascararCnpj, rotuloDoStatus, tomDaSituacao } from '@/lib/portal-formato';
import { emTeste, TEXTOS_PLANO } from '@/lib/portal-planos';
import { TEXTOS_NOVA_EMPRESA } from '@/lib/portal-nova-empresa';
import { ROTAS_PORTAL } from '@/lib/portal-rotas';
import { destinoDaSessao, ehTimeMacuxi } from '@/lib/portal-sessao';
import { LinkBotao, MolduraPortal, useSessaoPortal } from './base';
import { useFicha } from './cartao-plano';
import { NovaEmpresa } from './passo-empresa';

export const CHAVE_EMPRESAS = ['portal', 'empresas'] as const;

export function useEmpresas() {
  return useQuery({ queryKey: CHAVE_EMPRESAS, queryFn: () => chamarPortal(ROTAS_PORTAL.empresas, { schema: ListaEmpresasSchema }).then((r) => r.itens) });
}

const data = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

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
                Nova empresa
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

/** Coluna Plano: o nome (ex.: "PME") e, em teste, o selo "teste"; empresa sem plano (ou sem a rota) = "—". */
function PlanoDaEmpresa({ tenant }: { tenant: string }) {
  const q = useFicha(tenant);
  if (!q.data) return <span className="text-ink-2">—</span>;
  return (
    <span className="flex items-center gap-2">
      {q.data.plano.nome}
      {emTeste(q.data) && <Badge tone="neutral">{TEXTOS_PLANO.teste}</Badge>}
    </span>
  );
}

function ListaEmpresas() {
  const q = useEmpresas();
  if (q.isPending) return <LoadingBlock label="Buscando as empresas…" />;
  if (q.isError) return <ErrorBlock message={mensagemDoErro(q.error)} onRetry={() => void q.refetch()} />;
  if (q.data.length === 0) {
    return (
      <Panel>
        <span data-testid="empresas.vazio" className="py-4 text-center text-[15px] text-ink-2">
          Nenhuma empresa ainda.
        </span>
      </Panel>
    );
  }
  return (
    <Panel>
      <TableScroll minWidth={760}>
        <table data-testid="empresas.lista" className="w-full border-collapse text-[14px]">
          <thead>
            <tr>
              <th className={th}>Empresa</th>
              <th className={th}>Código</th>
              <th className={th}>CNPJ</th>
              <th className={th}>Plano</th>
              <th className={th}>Situação</th>
              <th className={th}>Criada em</th>
            </tr>
          </thead>
          <tbody>
            {q.data.map((e) => (
              <tr key={e.id} className="hover:bg-ground">
                <td className={td}>
                  <Link href={`/empresas/${e.id}`} data-testid={`empresas.abrir-${e.codigo}`} className="font-semibold text-ink no-underline hover:text-accent-ink hover:underline">
                    {e.razao_social}
                  </Link>
                </td>
                <td className={`${td} font-mono`}>{codigoDaLicenca(e.codigo)}</td>
                <td className={`${td} tabular-nums`}>{e.cnpj ? mascararCnpj(e.cnpj) : '—'}</td>
                <td className={td}>
                  <PlanoDaEmpresa tenant={e.id} />
                </td>
                <td className={td}>
                  <Badge tone={tomDaSituacao(e.status)}>{rotuloDoStatus(e.status)}</Badge>
                </td>
                <td className={`${td} tabular-nums`}>{data(e.criada_em)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </Panel>
  );
}

export function TelaNovaEmpresa() {
  const qc = useQueryClient();
  const pode = useSoTimeMacuxi();
  return (
    <MolduraPortal voltar={{ href: '/empresas', rotulo: 'Empresas' }} titulo={pode ? <PageHeader title={TEXTOS_NOVA_EMPRESA.titulo} /> : undefined}>
      {/* A lista em cache ainda não tem a empresa nova: invalida antes de ir à página dela (sem o aviso "não encontrada"). */}
      {pode ? <NovaEmpresa aoGravar={() => void qc.invalidateQueries({ queryKey: CHAVE_EMPRESAS })} /> : <AbrindoAEmpresa />}
    </MolduraPortal>
  );
}
