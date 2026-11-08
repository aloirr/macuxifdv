'use client';

/**
 * Empresas do portal (T-0087): lista (`GET /v1/plataforma/empresas`) e "Nova empresa" (passo Empresa). testIDs: empresas.*.
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
import { ROTAS_PORTAL } from '@/lib/portal-rotas';
import { destinoDaSessao, ehTimeMacuxi } from '@/lib/portal-sessao';
import { LinkBotao, MolduraPortal, useSessaoPortal } from './base';
import { mascararCnpj, PassoEmpresa, ROTULO_MODULO } from './passo-empresa';

export const CHAVE_EMPRESAS = ['portal', 'empresas'] as const;

export function useEmpresas() {
  return useQuery({ queryKey: CHAVE_EMPRESAS, queryFn: () => chamarPortal(ROTAS_PORTAL.empresas, { schema: ListaEmpresasSchema }).then((r) => r.itens) });
}

const data = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

/** Situação do tenant (`ativo` | `suspenso` | `encerrado`, check da 0001) em rótulo; outro valor aparece com a 1ª letra maiúscula. */
export function rotuloDoStatus(status: string): string {
  const r: Record<string, string> = { ativo: 'Ativa', suspenso: 'Suspensa', encerrado: 'Encerrada' };
  return r[status] ?? (status ? status.charAt(0).toUpperCase() + status.slice(1) : '—');
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
          <PageHeader title="Empresas" subtitle="Cada empresa cliente é um tenant. Crie a empresa e carregue as bases dela, na ordem dos cartões." actions={<LinkBotao href="/empresas/nova" testId="empresas.nova" primario>Nova empresa</LinkBotao>} />
        ) : undefined
      }
    >
      {pode ? <ListaEmpresas /> : <AbrindoAEmpresa />}
    </MolduraPortal>
  );
}

function ListaEmpresas() {
  const q = useEmpresas();
  if (q.isPending) return <LoadingBlock label="Buscando as empresas…" />;
  if (q.isError) return <ErrorBlock message={mensagemDoErro(q.error)} onRetry={() => void q.refetch()} />;
  if (q.data.length === 0) {
    return (
      <Panel>
        <div data-testid="empresas.vazio" className="flex flex-col items-start gap-3 py-4">
          <span className="text-[15px] font-semibold">Nenhuma empresa ainda.</span>
          <span className="text-[13px] text-ink-2">Comece pela empresa cliente: razão social, CNPJ, fuso, módulos e os parâmetros iniciais.</span>
          <LinkBotao href="/empresas/nova" primario>
            Cadastrar a primeira empresa
          </LinkBotao>
        </div>
      </Panel>
    );
  }
  return (
    <Panel>
      <TableScroll minWidth={760}>
        <table data-testid="empresas.lista" className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={th}>Empresa</th>
              <th className={th}>Código</th>
              <th className={th}>CNPJ</th>
              <th className={th}>Módulos</th>
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
                <td className={`${td} font-mono`}>{e.codigo}</td>
                <td className={`${td} tabular-nums`}>{e.cnpj ? mascararCnpj(e.cnpj) : '—'}</td>
                <td className={td}>{e.modulos.map((m) => ROTULO_MODULO[m.modulo].nome).join(', ')}</td>
                <td className={td}>
                  <Badge tone={e.status === 'ativo' ? 'success' : e.status === 'suspenso' ? 'warning' : 'neutral'}>{rotuloDoStatus(e.status)}</Badge>
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
    <MolduraPortal
      voltar={{ href: '/empresas', rotulo: 'Empresas' }}
      titulo={pode ? <PageHeader eyebrow="Passo 1" title="Nova empresa" subtitle="Confira antes de gravar: o código da empresa não muda depois. As bases vêm nos próximos passos." /> : undefined}
    >
      {/* A lista em cache ainda não tem a empresa nova: invalida antes de ir à página dela (sem o aviso "não encontrada"). */}
      {pode ? <PassoEmpresa aoGravar={() => void qc.invalidateQueries({ queryKey: CHAVE_EMPRESAS })} /> : <AbrindoAEmpresa />}
    </MolduraPortal>
  );
}
