'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import {
  Badge,
  Button,
  ErrorBlock,
  FilterBar,
  intervaloSyncAutoMs,
  KpiCard,
  KpiGrid,
  LoadingBlock,
  Notice,
  PageHeader,
  Panel,
  SelectField,
  SYNC_AUTO_PADRAO_MIN,
  td,
  tdNum,
  th,
  thNum,
  TableScroll,
} from '@macuxi/ui/web';
import { EquipeListaRespostaSchema, FarolSchema, type CorFarol, type Farol } from '../../../contracts';
import {
  aoEscolherEquipe,
  aoEscolherVendedor,
  consultaDoFarol,
  csvDoFarol,
  filtrosDaUrl,
  legendaEmLinhas,
  mesMaximo,
  avisoDoMesPassado,
  ORDEM_DAS_CORES,
  ROTULO_COR_PLURAL,
  rotuloDaCor,
  rotuloDoExportar,
  textoDaFonte,
  textoDeData,
  textoDeDias,
  textoDePositivacao,
  textoDoResumo,
  tomDaCor,
} from '../../lib/farol';
import { useHojeDoTenant, useSellersDeCampo } from '../../lib/queries';

const CAMPO =
  'h-[38px] rounded-[10px] border border-field bg-surface px-2.5 text-[15px] font-medium text-ink';

function Cor({ cor }: { cor: CorFarol | null }) {
  return <Badge tone={tomDaCor(cor)}>{rotuloDaCor(cor)}</Badge>;
}

/**
 * Farol de clientes (RN-CORE-28; T-0081): a carteira do escopo com dias sem compra, positivação do mês e a cor de cada cliente e vendedor.
 * Resumo e vendedores são do recorte inteiro; a lista tem filtro por cor e busca e carrega mais por página. Filtros na URL
 * (`mes`, `equipe`, `vendedor`, `cor`, `q`). Os limites do tenant ficam no painel de parâmetros (`parametro.farol`).
 * testIDs: `farol.tela` · `farol.filtro-*` · `farol.resumo` · `farol.vendedor.<id>` · `farol.cliente.<id>` · `farol.exportar-csv` · `farol.mais`.
 */
function FarolConteudo() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const hoje = useHojeDoTenant();
  const podeParametros = usePode('parametro.farol');
  const filtros = filtrosDaUrl(params);
  const mes = filtros.mes || hoje().slice(0, 7);
  const [buscaDigitada, setBuscaDigitada] = useState<string | null>(null);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const lista = useInfiniteQuery({
    queryKey: ['core', 'farol', { ...filtros, mes }],
    initialPageParam: '',
    queryFn: async ({ signal, pageParam }) =>
      FarolSchema.parse(
        await api<unknown>('/core/farol', {
          query: consultaDoFarol({ ...filtros, mes }, pageParam || undefined),
          signal,
        }),
      ),
    getNextPageParam: (p) => p.proximo_cursor ?? undefined,
    refetchInterval: intervaloSyncAutoMs(SYNC_AUTO_PADRAO_MIN), // RN-CORE-23 item 6
  });
  // supervisor/gerente/admin leem as equipes; sem permissão (analista) o filtro some e o resto segue
  const equipes = useQuery({
    queryKey: ['core', 'equipes'],
    queryFn: async () => EquipeListaRespostaSchema.parse(await api('/core/equipes')).itens,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  });
  const vendedores = useSellersDeCampo();

  const primeira: Farol | undefined = lista.data?.pages[0];
  const clientes = (lista.data?.pages ?? []).flatMap((p) => p.clientes);
  const nomes = useMemo(() => {
    const m = new Map<string, string>((vendedores.data ?? []).map((s) => [s.id, s.name]));
    for (const v of primeira?.vendedores ?? []) m.set(v.usuario_id, v.nome);
    return m;
  }, [vendedores.data, primeira?.vendedores]);
  const nomeDe = (id: string) => nomes.get(id) ?? '—';
  const temFiltro = Boolean(filtros.cor || filtros.busca || filtros.vendedor || filtros.equipe);
  const busca = buscaDigitada ?? filtros.busca;

  return (
    <div className="flex w-full max-w-[1280px] flex-col gap-5" data-testid="farol.tela">
      <PageHeader
        title="Farol de clientes"
        subtitle="Quem está comprando e quem esfriou: dias sem compra de cada cliente (contados até hoje) e positivação do mês por vendedor."
        actions={
          <>
            {podeParametros && (
              <Button
                onClick={() =>
                  document.getElementById('farol-parametros')?.scrollIntoView({ behavior: 'smooth' })
                }
                data-testid="farol.ir-parametros"
              >
                Parâmetros do farol
              </Button>
            )}
            <Button
              onClick={() => void lista.refetch()}
              disabled={lista.isFetching}
              aria-label="Atualizar o farol"
              data-testid="farol.atualizar"
            >
              {lista.isFetching ? 'Atualizando…' : 'Atualizar'}
            </Button>
            <Button
              onClick={() =>
                downloadBlob(
                  new Blob([csvDoFarol(clientes, nomeDe)], { type: 'text/csv;charset=utf-8' }),
                  `farol_${mes}.csv`,
                )
              }
              disabled={clientes.length === 0}
              data-testid="farol.exportar-csv"
            >
              {rotuloDoExportar(clientes.length, Boolean(lista.hasNextPage))}
            </Button>
          </>
        }
      />

      <FilterBar>
        <label className="flex flex-col gap-[3px] text-[12px] font-semibold text-ink-2">
          Mês
          <input
            type="month"
            value={mes}
            max={mesMaximo(hoje())}
            onChange={(e) => e.target.value && set({ mes: e.target.value })}
            className={CAMPO}
            data-testid="farol.filtro-mes"
          />
        </label>
        {(equipes.data ?? []).length > 0 && (
          <SelectField
            label="Equipe"
            value={filtros.equipe}
            onChange={(e) => set(aoEscolherEquipe(e.target.value))}
            data-testid="farol.filtro-equipe"
          >
            <option value="">Todas as equipes</option>
            {(equipes.data ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </SelectField>
        )}
        <SelectField
          label="Vendedor"
          value={filtros.vendedor}
          onChange={(e) => set(aoEscolherVendedor(e.target.value))}
          data-testid="farol.filtro-vendedor"
        >
          <option value="">Todos os vendedores</option>
          {(vendedores.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Farol"
          value={filtros.cor}
          onChange={(e) => set({ cor: e.target.value })}
          data-testid="farol.filtro-cor"
        >
          <option value="">Todas as cores</option>
          {ORDEM_DAS_CORES.map((c) => (
            <option key={c} value={c}>
              {rotuloDaCor(c)}
            </option>
          ))}
        </SelectField>
        <label className="flex flex-col gap-[3px] text-[12px] font-semibold text-ink-2">
          Cliente ou CNPJ
          <input
            type="search"
            className={`${CAMPO} w-[220px]`}
            placeholder="Nome ou CNPJ e Enter"
            maxLength={60}
            value={busca}
            onChange={(e) => setBuscaDigitada(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && set({ q: busca.trim() || null })}
            onBlur={() => buscaDigitada !== null && set({ q: busca.trim() || null })}
            data-testid="farol.filtro-busca"
          />
        </label>
      </FilterBar>

      {avisoDoMesPassado(mes, hoje()) && (
        <Notice tone="info" data-testid="farol.aviso-mes-passado">
          {avisoDoMesPassado(mes, hoje())}
        </Notice>
      )}

      {lista.isError && (
        <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />
      )}
      {lista.isPending && <LoadingBlock label="Carregando o farol…" />}

      {primeira && (
        <>
          <KpiGrid>
            <KpiCard
              label="Clientes na carteira"
              value={primeira.resumo.carteira}
              sub={textoDoResumo(primeira.resumo)}
            />
            <KpiCard
              label="Positivação do mês"
              value={textoDePositivacao(primeira.resumo.positivacao_pct)}
              sub={<Cor cor={primeira.resumo.cor} />}
            />
            {ORDEM_DAS_CORES.map((c) => (
              <KpiCard
                key={c}
                label={ROTULO_COR_PLURAL[c]}
                value={primeira.resumo.por_cor[c]}
                sub={
                  <button
                    type="button"
                    className="inline-flex min-h-[32px] items-center gap-1.5 bg-transparent p-0 text-left"
                    onClick={() => set({ cor: c })}
                    aria-label={`Ver só ${ROTULO_COR_PLURAL[c].toLowerCase()}`}
                  >
                    <Cor cor={c} /> ver na lista
                  </button>
                }
              />
            ))}
          </KpiGrid>
          <div className="flex flex-col gap-1.5 text-[13px] text-ink-2" data-testid="farol.resumo">
            {legendaEmLinhas(primeira.parametros).map((l) => (
              <p key={l.rotulo} className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1">
                <strong>{l.rotulo}:</strong>
                {l.faixas.map((f) => (
                  <span key={f.cor} className="inline-flex items-center gap-1">
                    <Cor cor={f.cor} /> {f.texto}
                  </span>
                ))}
              </p>
            ))}
            <p className="m-0">{textoDaFonte(primeira.fonte_positivacao)}</p>
          </div>

          <Panel title={`Por vendedor (${primeira.vendedores.length})`}>
            {primeira.vendedores.length === 0 ? (
              <Notice tone="info">
                Nenhum vendedor com carteira neste recorte. Troque a equipe ou o vendedor nos filtros.
              </Notice>
            ) : (
              <TableScroll minWidth={760}>
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr>
                      <th className={th}>Vendedor</th>
                      <th className={thNum}>Carteira</th>
                      <th className={thNum}>Positivados</th>
                      <th className={thNum}>Positivação</th>
                      <th className={th}>Farol</th>
                      <th className={thNum}>Verdes</th>
                      <th className={thNum}>Amarelos</th>
                      <th className={thNum}>Vermelhos</th>
                      <th className={thNum}>Sem compra</th>
                    </tr>
                  </thead>
                  <tbody>
                    {primeira.vendedores.map((v) => (
                      <tr key={v.usuario_id} data-testid={`farol.vendedor.${v.usuario_id}`}>
                        <td className={td}>
                          <button
                            type="button"
                            className="min-h-[44px] bg-transparent p-0 text-left font-semibold text-accent-ink hover:underline"
                            onClick={() => set({ vendedor: v.usuario_id })}
                            aria-label={`Ver só os clientes de ${v.nome}`}
                          >
                            {v.nome}
                          </button>
                        </td>
                        <td className={tdNum}>{v.carteira}</td>
                        <td className={tdNum}>{v.positivados}</td>
                        <td className={tdNum}>{textoDePositivacao(v.positivacao_pct)}</td>
                        <td className={td}>
                          <Cor cor={v.cor} />
                        </td>
                        <td className={tdNum}>{v.por_cor.verde}</td>
                        <td className={tdNum}>{v.por_cor.amarelo}</td>
                        <td className={tdNum}>{v.por_cor.vermelho}</td>
                        <td className={tdNum}>{v.por_cor.sem_compra}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </Panel>

          <Panel title={`Clientes (${clientes.length}${lista.hasNextPage ? '+' : ''})`}>
            {clientes.length === 0 ? (
              <div className="flex flex-col items-start gap-2">
                <Notice tone="info">
                  {temFiltro
                    ? 'Nenhum cliente com esses filtros. Limpe os filtros para ver a carteira inteira.'
                    : 'Nenhum cliente na carteira deste recorte. Vincule clientes na Carteira.'}
                </Notice>
                {temFiltro && (
                  <Button
                    variant="link"
                    onClick={() => {
                      setBuscaDigitada(null);
                      set({ cor: null, q: null, vendedor: null, equipe: null });
                    }}
                    data-testid="farol.limpar-filtros"
                  >
                    Limpar filtros
                  </Button>
                )}
              </div>
            ) : (
              <TableScroll minWidth={860}>
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr>
                      <th className={th}>Cliente</th>
                      <th className={th}>Documento</th>
                      <th className={th}>Vendedor</th>
                      <th className={th}>Última compra</th>
                      <th className={thNum}>Dias sem compra</th>
                      <th className={th}>Positivado no mês</th>
                      <th className={th}>Farol</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clientes.map((c) => (
                      <tr
                        key={`${c.cliente_id}.${c.usuario_id}`}
                        data-testid={`farol.cliente.${c.cliente_id}.${c.usuario_id}`}
                      >
                        <td className={td}>
                          <Link
                            href={`/cliente?id=${c.cliente_id}`}
                            className="font-semibold text-accent-ink no-underline hover:underline"
                          >
                            {c.nome}
                          </Link>
                        </td>
                        <td className={td}>{c.documento_mascarado ?? '—'}</td>
                        <td className={td}>{nomeDe(c.usuario_id)}</td>
                        <td className={td}>{textoDeData(c.ultima_compra_em)}</td>
                        <td className={tdNum}>{textoDeDias(c.dias_sem_compra)}</td>
                        <td className={td}>{c.positivado_mes ? 'Sim' : 'Não'}</td>
                        <td className={td}>
                          <Cor cor={c.cor} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
            {lista.hasNextPage && (
              <div className="mt-3">
                <Button
                  onClick={() => void lista.fetchNextPage()}
                  disabled={lista.isFetchingNextPage}
                  data-testid="farol.mais"
                >
                  {lista.isFetchingNextPage ? 'Carregando…' : 'Carregar mais clientes'}
                </Button>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

export function FarolPage() {
  return (
    <Suspense fallback={<LoadingBlock label="Carregando o farol…" />}>
      <FarolConteudo />
    </Suspense>
  );
}
