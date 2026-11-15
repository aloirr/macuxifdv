'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import {
  Badge,
  Button,
  CampoBusca,
  Drawer,
  ErrorBlock,
  EstadoVazio,
  FilterBar,
  intervaloSyncAutoMs,
  LoadingBlock,
  MenuAcoes,
  Notice,
  nomeLegivel,
  PageHeader,
  SelectField,
  SYNC_AUTO_PADRAO_MIN,
  TabelaDados,
  TextField,
  rotuloComContagem,
  cx,
  type AcaoDoMenu,
  type ColunaDaTabela,
} from '@macuxi/ui/web';
import { EquipeListaRespostaSchema, FarolSchema, type CorFarol, type Farol, type FarolCliente } from '../../../contracts';
import {
  aoEscolherEquipe,
  aoEscolherVendedor,
  consultaDoFarol,
  csvDoFarol,
  diasEmNumero,
  filtrosDaUrl,
  legendaEmLinhas,
  mesMaximo,
  avisoDoMesPassado,
  rotuloDaCor,
  rotuloDoExportar,
  textoDaUltimaCompra,
  textoDePositivacao,
  tomDaCor,
} from '../../lib/farol';
import { useHojeDoTenant, useSellersDeCampo } from '../../lib/queries';
import { CurvasAbcParametrosPanel } from './curvas-abc-parametros-panel';
import { FarolParametrosPanel } from './farol-parametros-panel';

type VendedorDoFarol = Farol['vendedores'][number];
type AbaDoFarol = 'clientes' | 'vendedores';

/** Os quatro números que filtram a lista (RD-0361), na ordem da simulação: Verdes, Amarelos, Vermelhos, Sem compra. */
const KPIS_DE_COR: ReadonlyArray<{ cor: CorFarol; rotulo: string; barra: string }> = [
  { cor: 'verde', rotulo: 'Verdes', barra: 'bg-success' },
  { cor: 'amarelo', rotulo: 'Amarelos', barra: 'bg-warning' },
  { cor: 'vermelho', rotulo: 'Vermelhos', barra: 'bg-danger' },
  { cor: 'sem_compra', rotulo: 'Sem compra', barra: 'bg-disabled' },
];

const TEXTO_DA_FAIXA = { success: 'text-success', warning: 'text-warning', danger: 'text-danger', neutral: 'text-ink' } as const;

function Cor({ cor }: { cor: CorFarol | null }) {
  return <Badge tone={tomDaCor(cor)}>{rotuloDaCor(cor)}</Badge>;
}

/** Abas Clientes e Vendedores (o `Abas` do kit ainda não sai do índice de `@macuxi/ui/web`; mesmo desenho e mesmas classes de cor). */
function AbasDoFarol({ valor, abas, aoMudar }: { valor: AbaDoFarol; abas: ReadonlyArray<{ id: AbaDoFarol; rotulo: string }>; aoMudar: (a: AbaDoFarol) => void }) {
  return (
    <div role="tablist" aria-label="Clientes ou vendedores" className="flex gap-1 border-b border-line">
      {abas.map((a) => (
        <button
          key={a.id}
          type="button"
          role="tab"
          id={`farol-aba-${a.id}`}
          aria-controls={`farol-painel-${a.id}`}
          aria-selected={a.id === valor}
          data-testid={`farol.aba.${a.id}`}
          onClick={() => a.id !== valor && aoMudar(a.id)}
          className={cx(
            'relative -mb-px inline-flex min-h-[44px] items-center border-b-2 bg-transparent px-4 text-[14px] font-semibold whitespace-nowrap focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
            a.id === valor ? 'border-accent text-accent-ink' : 'border-transparent text-ink-2 hover:border-field hover:text-ink',
          )}
        >
          {a.rotulo}
        </button>
      ))}
    </div>
  );
}

/** Número do farol que filtra a lista (RD-0361): um clique liga, outro desliga; marcado, traço de 2 px Azul noite. */
function KpiFiltro({ rotulo, valor, barra, marcado, aoClicar, testId }: { rotulo: string; valor: number; barra: string; marcado: boolean; aoClicar: () => void; testId: string }) {
  return (
    <button
      type="button"
      aria-pressed={marcado}
      onClick={aoClicar}
      data-testid={testId}
      className={cx(
        'flex h-[58px] min-w-0 flex-1 items-center gap-2.5 rounded-[14px] px-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        marcado ? 'border-2 border-accent bg-accent-soft' : 'border border-line bg-surface hover:bg-ground',
      )}
    >
      <i aria-hidden className={cx('h-[22px] w-1 shrink-0 rounded-sm', barra)} />
      <span className="text-[13.5px] font-semibold text-ink">{rotulo}</span>
      <span className="ml-auto font-display text-[24px] font-extrabold tabular-nums text-ink">{valor.toLocaleString('pt-BR')}</span>
    </button>
  );
}

/**
 * Farol de clientes (RN-CORE-28; T-0081; revisão do BKO T-0173 §P1-§P9): a carteira do escopo com dias sem compra, positivação do mês e a
 * cor de cada cliente e vendedor. Resumo e vendedores são do recorte inteiro; os números Verdes, Amarelos, Vermelhos e Sem compra filtram
 * a lista (sem select "Farol"); abas Clientes e Vendedores; busca ao digitar (300 ms). Filtros na URL (`mes`, `equipe`, `vendedor`, `cor`,
 * `q`, `aba`). Os limites do tenant e a legenda das faixas ficam na gaveta "Parâmetros do farol" (`parametro.farol`).
 * testIDs: `farol.tela` · `farol.filtro-*` · `farol.kpi.<cor>` · `farol.vendedor.<id>` · `farol.cliente.<id>` · `farol.exportar-csv` · `farol.mais`.
 */
function FarolConteudo() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const hoje = useHojeDoTenant();
  const podeParametros = usePode('parametro.farol');
  const filtros = filtrosDaUrl(params);
  const mes = filtros.mes || hoje().slice(0, 7);
  const aba: AbaDoFarol = params.get('aba') === 'vendedores' ? 'vendedores' : 'clientes';
  const [buscaDigitada, setBuscaDigitada] = useState<string | null>(null);
  const [parametrosAbertos, setParametrosAbertos] = useState(false);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // busca ao digitar, com espera de 300 ms (§P4)
  useEffect(() => {
    if (buscaDigitada === null || buscaDigitada.trim() === filtros.busca) return;
    const t = setTimeout(() => set({ q: buscaDigitada.trim() || null }), 300);
    return () => clearTimeout(t);
  }, [buscaDigitada]);

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

  const limpar = () => {
    setBuscaDigitada(null);
    set({ cor: null, q: null, vendedor: null, equipe: null });
  };

  const acoesDaPagina: AcaoDoMenu[] = [
    {
      id: 'exportar',
      rotulo: rotuloDoExportar(clientes.length, Boolean(lista.hasNextPage)),
      desligada: clientes.length === 0,
      testId: 'farol.exportar-csv',
      aoEscolher: () =>
        downloadBlob(new Blob([csvDoFarol(clientes, nomeDe)], { type: 'text/csv;charset=utf-8' }), `farol_${mes}.csv`),
    },
    {
      id: 'atualizar',
      rotulo: lista.isFetching ? 'Atualizando…' : 'Atualizar',
      desligada: lista.isFetching,
      testId: 'farol.atualizar',
      aoEscolher: () => void lista.refetch(),
    },
    ...(podeParametros
      ? [{ id: 'parametros', rotulo: 'Parâmetros do farol', testId: 'farol.ir-parametros', aoEscolher: () => setParametrosAbertos(true) }]
      : []),
  ];

  const acoesDoCliente = (c: FarolCliente): AcaoDoMenu[] =>
    filtros.vendedor === c.usuario_id
      ? []
      : [{ id: 'vendedor', rotulo: 'Ver só deste vendedor', aoEscolher: () => set({ ...aoEscolherVendedor(c.usuario_id), aba: null }) }];

  const colunasDeClientes: ColunaDaTabela<FarolCliente>[] = [
    { id: 'cliente', titulo: 'Cliente', largura: '40%', celula: (c) => nomeLegivel(c.nome), texto: (c) => nomeLegivel(c.nome) },
    { id: 'vendedor', titulo: 'Vendedor', prioridade: 2, celula: (c) => nomeDe(c.usuario_id), texto: (c) => nomeDe(c.usuario_id) },
    { id: 'dias', titulo: 'Dias sem compra', numero: true, largura: '150px', celula: (c) => diasEmNumero(c.dias_sem_compra), texto: (c) => textoDaUltimaCompra(c.ultima_compra_em) },
    { id: 'farol', titulo: 'Farol', largura: '150px', celula: (c) => <Cor cor={c.cor} /> },
  ];

  const colunasDeVendedores: ColunaDaTabela<VendedorDoFarol>[] = [
    { id: 'vendedor', titulo: 'Vendedor', celula: (v) => v.nome, texto: (v) => v.nome },
    { id: 'carteira', titulo: 'Carteira', numero: true, prioridade: 2, largura: '96px', celula: (v) => v.carteira },
    { id: 'positivados', titulo: 'Positivados', numero: true, prioridade: 3, largura: '104px', celula: (v) => v.positivados },
    { id: 'positivacao', titulo: 'Positivação', numero: true, largura: '112px', celula: (v) => textoDePositivacao(v.positivacao_pct) },
    { id: 'farol', titulo: 'Farol', largura: '130px', celula: (v) => <Cor cor={v.cor} /> },
    { id: 'verdes', titulo: 'Verdes', numero: true, prioridade: 3, largura: '80px', celula: (v) => v.por_cor.verde },
    { id: 'amarelos', titulo: 'Amarelos', numero: true, prioridade: 3, largura: '90px', celula: (v) => v.por_cor.amarelo },
    { id: 'vermelhos', titulo: 'Vermelhos', numero: true, prioridade: 3, largura: '96px', celula: (v) => v.por_cor.vermelho },
    { id: 'sem_compra', titulo: 'Sem compra', numero: true, prioridade: 3, largura: '104px', celula: (v) => v.por_cor.sem_compra },
  ];

  // Com um KPI marcado a aba Clientes fica sem contagem (o KPI marcado é a contagem); sem cor nem busca, o total é o da carteira inteira
  const contagemDeClientes = (): string => {
    if (!primeira || filtros.cor) return 'Clientes';
    if (!filtros.busca && !filtros.vendedor && !filtros.equipe) return rotuloComContagem('Clientes', primeira.resumo.carteira);
    return rotuloComContagem('Clientes', clientes.length, Boolean(lista.hasNextPage));
  };

  return (
    <div className="flex w-full max-w-[1280px] flex-col gap-5" data-testid="farol.tela">
      <PageHeader title="Farol de clientes" actions={<MenuAcoes acoes={acoesDaPagina} rotulo="Mais ações" testId="farol.mais-acoes" />} />

      <FilterBar>
        <CampoBusca
          rotulo="Buscar cliente ou CNPJ"
          maxLength={60}
          value={busca}
          onChange={(e) => setBuscaDigitada(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && set({ q: busca.trim() || null })}
          data-testid="farol.filtro-busca"
        />
        <TextField
          label="Mês"
          type="month"
          value={mes}
          max={mesMaximo(hoje())}
          onChange={(e) => e.target.value && set({ mes: e.target.value })}
          data-testid="farol.filtro-mes"
        />
        {(equipes.data ?? []).length > 0 && (
          <SelectField label="Equipe" value={filtros.equipe} onChange={(e) => set(aoEscolherEquipe(e.target.value))} data-testid="farol.filtro-equipe">
            <option value="">Todas</option>
            {(equipes.data ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </SelectField>
        )}
        <SelectField label="Vendedor" value={filtros.vendedor} onChange={(e) => set(aoEscolherVendedor(e.target.value))} data-testid="farol.filtro-vendedor">
          <option value="">Todos</option>
          {(vendedores.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
        {temFiltro && (
          <Button size="sm" onClick={limpar} data-testid="farol.limpar-filtros">
            Limpar filtros
          </Button>
        )}
      </FilterBar>

      {avisoDoMesPassado(mes, hoje()) && (
        <Notice tone="info" data-testid="farol.aviso-mes-passado">
          {avisoDoMesPassado(mes, hoje())}
        </Notice>
      )}

      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && <LoadingBlock label="Carregando o farol…" />}

      {primeira && (
        <>
          <div className="flex flex-wrap gap-3" data-testid="farol.resumo">
            <div className="flex h-[58px] min-w-0 flex-1 items-center gap-2.5 rounded-[14px] border border-line bg-surface px-4">
              <span className="text-[13.5px] font-semibold text-ink">Positivação</span>
              <span
                className={cx('ml-auto font-display text-[24px] font-extrabold tabular-nums', TEXTO_DA_FAIXA[tomDaCor(primeira.resumo.cor)])}
                data-testid="farol.positivacao"
              >
                {textoDePositivacao(primeira.resumo.positivacao_pct)}
              </span>
            </div>
            {KPIS_DE_COR.map((k) => (
              <KpiFiltro
                key={k.cor}
                rotulo={k.rotulo}
                valor={primeira.resumo.por_cor[k.cor]}
                barra={k.barra}
                marcado={filtros.cor === k.cor}
                aoClicar={() => set({ cor: filtros.cor === k.cor ? null : k.cor })}
                testId={`farol.kpi.${k.cor}`}
              />
            ))}
          </div>

          <section className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
            <AbasDoFarol
              valor={aba}
              aoMudar={(a) => set({ aba: a === 'clientes' ? null : a })}
              abas={[
                { id: 'clientes', rotulo: contagemDeClientes() },
                { id: 'vendedores', rotulo: rotuloComContagem('Vendedores', primeira.vendedores.length) },
              ]}
            />
            <div role="tabpanel" id="farol-painel-clientes" aria-labelledby="farol-aba-clientes" hidden={aba !== 'clientes'}>
              <TabelaDados
                rotulo="Clientes do farol"
                colunas={colunasDeClientes}
                linhas={clientes}
                chave={(c) => `${c.cliente_id}.${c.usuario_id}`}
                linhaTestId={(c) => `farol.cliente.${c.cliente_id}.${c.usuario_id}`}
                aoAbrir={(c) => router.push(`/cliente?id=${c.cliente_id}`)}
                acoes={acoesDoCliente}
                vazio={<EstadoVazio titulo={temFiltro ? 'Nenhum cliente com esses filtros.' : 'Nenhum cliente na carteira.'} />}
              />
              {lista.hasNextPage && (
                <div className="mt-3">
                  <Button onClick={() => void lista.fetchNextPage()} disabled={lista.isFetchingNextPage} data-testid="farol.mais">
                    {lista.isFetchingNextPage ? 'Carregando…' : 'Carregar mais clientes'}
                  </Button>
                </div>
              )}
            </div>
            <div role="tabpanel" id="farol-painel-vendedores" aria-labelledby="farol-aba-vendedores" hidden={aba !== 'vendedores'}>
              <TabelaDados
                rotulo="Vendedores do farol"
                colunas={colunasDeVendedores}
                linhas={primeira.vendedores}
                chave={(v) => v.usuario_id}
                linhaTestId={(v) => `farol.vendedor.${v.usuario_id}`}
                aoAbrir={(v) => set({ ...aoEscolherVendedor(v.usuario_id), aba: null })}
                vazio={<EstadoVazio titulo={temFiltro ? 'Nenhum vendedor com esses filtros.' : 'Nenhum vendedor com carteira.'} />}
              />
            </div>
          </section>
        </>
      )}

      <Drawer open={parametrosAbertos} title="Parâmetros do farol" onClose={() => setParametrosAbertos(false)}>
        <div className="flex flex-col gap-5">
          {primeira && (
            <div className="flex flex-col gap-1.5 text-[13px] text-ink-2" data-testid="farol.legenda">
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
            </div>
          )}
          <FarolParametrosPanel />
          <CurvasAbcParametrosPanel />
        </div>
      </Drawer>
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
