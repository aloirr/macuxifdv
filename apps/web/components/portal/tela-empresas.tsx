'use client';

/**
 * Empresas do portal (T-0087): lista (`GET /v1/plataforma/empresas`) e "Nova empresa" (passo Empresa). testIDs: empresas.*.
 */
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ListaEmpresasSchema } from '@macuxi/platform-sdk';
import { Badge, ErrorBlock, LoadingBlock, PageHeader, Panel, TableScroll, td, th } from '@macuxi/ui/web';

import { chamarPortal, mensagemDoErro } from '@/lib/portal-api';
import { ROTAS_PORTAL } from '@/lib/portal-rotas';
import { LinkBotao, MolduraPortal } from './base';
import { mascararCnpj, PassoEmpresa, ROTULO_MODULO } from './passo-empresa';

export const CHAVE_EMPRESAS = ['portal', 'empresas'] as const;

export function useEmpresas() {
  return useQuery({ queryKey: CHAVE_EMPRESAS, queryFn: () => chamarPortal(ROTAS_PORTAL.empresas, { schema: ListaEmpresasSchema }).then((r) => r.itens) });
}

const data = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

export function TelaEmpresas() {
  return (
    <MolduraPortal titulo={<PageHeader title="Empresas" subtitle="Cada empresa cliente é um tenant. Crie a empresa e carregue as bases dela, na ordem dos cartões." actions={<LinkBotao href="/empresas/nova" testId="empresas.nova" primario>Nova empresa</LinkBotao>} />}>
      <ListaEmpresas />
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
                  <Link href={`/empresas/${e.id}`} data-testid={`empresas.abrir-${e.codigo}`} className="font-semibold text-ink no-underline hover:text-accent">
                    {e.razao_social}
                  </Link>
                </td>
                <td className={`${td} font-mono`}>{e.codigo}</td>
                <td className={`${td} tabular-nums`}>{e.cnpj ? mascararCnpj(e.cnpj) : '—'}</td>
                <td className={td}>{e.modulos.map((m) => ROTULO_MODULO[m.modulo].nome).join(', ')}</td>
                <td className={td}>
                  <Badge tone={e.status === 'ativo' ? 'success' : 'neutral'}>{e.status === 'ativo' ? 'Ativa' : e.status}</Badge>
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
  return (
    <MolduraPortal voltar={{ href: '/empresas', rotulo: 'Empresas' }} titulo={<PageHeader eyebrow="Passo 1" title="Nova empresa" subtitle="Confira antes de gravar: o código da empresa não muda depois. As bases vêm nos próximos passos." />}>
      {/* A lista em cache ainda não tem a empresa nova: invalida antes de ir à página dela (sem o aviso "não encontrada"). */}
      <PassoEmpresa aoGravar={() => void qc.invalidateQueries({ queryKey: CHAVE_EMPRESAS })} />
    </MolduraPortal>
  );
}
