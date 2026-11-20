'use client';

/**
 * Tabelas de preço no BKO (T-0089): aba "Preço da UN" (só o preço da unidade base; não existe preço de caixa, RN-VEN-15) e aba
 * "Escalonada" (faixas por quantidade, RN-VEN-23). Filtros na URL, CSV, tabela sem rolagem lateral e formulário da faixa na gaveta (revisão do BKO). Só analista e admin
 * (`tabela_preco.gerenciar`); a proteção real é na API. Faixa que veio do ERP é só leitura.
 */
import { api, downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { formatBRL } from '@macuxi/comum';
import { Button, CampoBusca, CampoFormulario, CLASSE_CAMPO, Dialog, Drawer, ErrorBlock, EstadoVazio, FilterBar, LoadingBlock, MenuAcoes, nomeLegivel, Notice, PageHeader, rotuloComContagem, SelectField, SeloSituacao, TabelaDados, useToast, type ColunaDaTabela } from '@macuxi/ui/web';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ListaTabelasPreco, PaginaEscalonada, PaginaPrecosTabela, RespostaBusca, type FaixaCadastrada, type PrecoUnidadeLinha } from '../../contracts';
import { textoRemoverFaixa } from '../lib/formularios';
import { LimparFiltros, useBuscaComEspera } from '../lib/lista';
import { buscaDosFiltrosTabelas, faixaDoForm, faixasParaCsv, filtrosTabelasLigados, FORM_FAIXA_VAZIO, formDaFaixa, lerFiltrosTabelas, precosParaCsv, seloDaFaixa, textoVigencia, type FiltrosTabelas, type FormFaixa } from '../lib/tabelas-preco';

const BASE = '/catalogo';
const POR_PAGINA = 200;

function useFiltros(): [FiltrosTabelas, (p: Partial<FiltrosTabelas>) => void] {
  const [f, setF] = useState<FiltrosTabelas>(() => lerFiltrosTabelas(typeof window === 'undefined' ? '' : window.location.search));
  useEffect(() => {
    const voltar = () => setF(lerFiltrosTabelas(window.location.search));
    window.addEventListener('popstate', voltar);
    return () => window.removeEventListener('popstate', voltar);
  }, []);
  const mudar = useCallback((p: Partial<FiltrosTabelas>) => {
    setF((atual) => {
      const novo = { ...atual, ...p };
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${buscaDosFiltrosTabelas(novo)}`);
      return novo;
    });
  }, []);
  return [f, mudar];
}

type Tabelas = ListaTabelasPreco['items'];
type Mudar = (p: Partial<FiltrosTabelas>) => void;

const ABAS = [
  ['precos', 'Preço da UN'],
  ['escalonada', 'Escalonada'],
] as const;

/** Título da página e as abas, na mesma linha de ações da aba aberta (revisão do BKO §P1); a contagem vai no rótulo da aba ativa (§P6). */
function Cabecalho({ filtros, mudar, total, actions }: { filtros: FiltrosTabelas; mudar: Mudar; total?: number; actions?: ReactNode }) {
  return (
    <>
      <PageHeader title="Tabelas de preço" actions={actions} />
      <nav className="flex gap-2" aria-label="Seções das tabelas de preço">
        {ABAS.map(([id, rotulo]) => (
          <Button key={id} size="sm" variant={id === filtros.aba ? 'primary' : 'secondary'} aria-current={id === filtros.aba ? 'page' : undefined} data-testid={`tabelas-preco.aba.${id}`} onClick={() => mudar({ aba: id })}>
            {id === filtros.aba && total !== undefined ? rotuloComContagem(rotulo, total) : rotulo}
          </Button>
        ))}
      </nav>
    </>
  );
}

export function TabelasPrecoPage() {
  const [filtros, mudar] = useFiltros();
  const tabelas = useQuery({
    queryKey: ['catalogo', 'tabelas-preco', filtros.filial],
    queryFn: async () => ListaTabelasPreco.parse(await api<unknown>(`${BASE}/tabelas-preco${filtros.filial ? `?filial=${encodeURIComponent(filtros.filial)}` : ''}`)),
  });
  const tabelaId = filtros.tabela || tabelas.data?.items[0]?.id || '';
  return (
    <div className="flex w-full max-w-[1062px] flex-col gap-5" data-testid="tabelas-preco.tela">
      {!tabelas.data && <Cabecalho filtros={filtros} mudar={mudar} />}
      {tabelas.isError && <ErrorBlock message={errorMessage(tabelas.error)} onRetry={() => void tabelas.refetch()} />}
      {tabelas.isPending && <LoadingBlock label="Carregando as tabelas de preço…" />}
      {tabelas.data && filtros.aba === 'precos' && <PrecosUnidade filtros={filtros} mudar={mudar} tabelas={tabelas.data.items} filiais={tabelas.data.filiais} filialId={tabelas.data.filial_id} tabelaId={tabelaId} />}
      {tabelas.data && filtros.aba === 'escalonada' && <Escalonada filtros={filtros} mudar={mudar} tabelas={tabelas.data.items} />}
    </div>
  );
}

function BotaoCarregarMais({ tem, carregando, aoClicar }: { tem: boolean; carregando: boolean; aoClicar: () => void }) {
  if (!tem) return null;
  return (
    <div className="flex justify-center">
      <Button size="sm" onClick={aoClicar} disabled={carregando} data-testid="tabelas-preco.carregar-mais">
        {carregando ? 'Carregando…' : 'Carregar mais'}
      </Button>
    </div>
  );
}

function PrecosUnidade({ filtros, mudar, tabelas, filiais, filialId, tabelaId }: { filtros: FiltrosTabelas; mudar: Mudar; tabelas: Tabelas; filiais: ListaTabelasPreco['filiais']; filialId: string; tabelaId: string }) {
  const busca = useBuscaComEspera(filtros.q, (q) => mudar({ q }));
  const lista = useInfiniteQuery({
    queryKey: ['catalogo', 'precos-tabela', tabelaId, filialId, filtros.q],
    enabled: tabelaId !== '',
    queryFn: async ({ pageParam }) => PaginaPrecosTabela.parse(await api<unknown>(`${BASE}/tabelas-preco/${tabelaId}/precos?limit=${POR_PAGINA}&offset=${pageParam}&filial=${encodeURIComponent(filialId)}${filtros.q ? `&q=${encodeURIComponent(filtros.q)}` : ''}`)),
    initialPageParam: 0,
    getNextPageParam: (u) => u.next_offset ?? undefined,
  });
  const itens = useMemo(() => lista.data?.pages.flatMap((p) => p.items) ?? [], [lista.data]);
  const total = lista.data?.pages[0]?.total ?? 0;
  const ligados = filtrosTabelasLigados(filtros);
  const colunas: ColunaDaTabela<PrecoUnidadeLinha>[] = [
    { id: 'produto', titulo: 'Produto', celula: (p) => nomeLegivel(p.nome), texto: (p) => p.nome },
    { id: 'codigo', titulo: 'Código', prioridade: 2, largura: '120px', celula: (p) => p.sku, texto: (p) => p.sku },
    { id: 'preco', titulo: 'Preço da unidade', numero: true, largura: '140px', celula: (p) => formatBRL(p.preco_cents) },
    { id: 'vigencia', titulo: 'Vigência', prioridade: 3, largura: '200px', celula: (p) => textoVigencia(p.vigencia_inicio?.slice(0, 10) ?? null, p.vigencia_fim?.slice(0, 10) ?? null) },
  ];
  return (
    <>
      <Cabecalho
        filtros={filtros}
        mudar={mudar}
        total={tabelas.length === 0 ? undefined : total}
        actions={
          <MenuAcoes
            acoes={[
              { id: 'csv', rotulo: 'Exportar CSV', desligada: itens.length === 0, aoEscolher: () => downloadBlob(new Blob([precosParaCsv(itens)], { type: 'text/csv;charset=utf-8' }), 'precos-da-unidade.csv'), testId: 'tabelas-preco.csv' },
              { id: 'atualizar', rotulo: 'Atualizar', desligada: lista.isFetching || tabelaId === '', aoEscolher: () => void lista.refetch() },
            ]}
          />
        }
      />
      {tabelas.length === 0 ? (
        <EstadoVazio testId="tabelas-preco.vazio" titulo="Nenhuma tabela de preço cadastrada." />
      ) : (
        <>
          <FilterBar>
            <CampoBusca rotulo="Buscar produto ou código" {...busca} data-testid="tabelas-preco.q" />
            <SelectField label="Tabela" value={tabelaId} onChange={(e) => mudar({ tabela: e.target.value })} data-testid="tabelas-preco.tabela">
              {tabelas.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </SelectField>
            <SelectField label="Filial" value={filialId} onChange={(e) => mudar({ filial: e.target.value })} data-testid="tabelas-preco.filial">
              {filiais.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                  {f.padrao ? ' (padrão)' : ''}
                </option>
              ))}
            </SelectField>
            <LimparFiltros ligado={ligados} onLimpar={() => mudar({ q: '' })} testId="tabelas-preco.limpar" />
          </FilterBar>
          {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
          {lista.isPending && tabelaId !== '' && <LoadingBlock label="Carregando os preços…" />}
          {lista.data && (
            <TabelaDados
              rotulo="Preço da unidade por tabela"
              testId="tabelas-preco.precos"
              linhas={itens}
              chave={(p) => p.produto_id}
              colunas={colunas}
              vazio={<EstadoVazio testId="tabelas-preco.precos.vazio" titulo={ligados ? 'Nenhum preço com esses filtros.' : 'Nenhum preço nesta tabela.'} />}
            />
          )}
          <BotaoCarregarMais tem={!!lista.hasNextPage} carregando={lista.isFetchingNextPage} aoClicar={() => void lista.fetchNextPage()} />
        </>
      )}
    </>
  );
}

function Escalonada({ filtros, mudar, tabelas }: { filtros: FiltrosTabelas; mudar: Mudar; tabelas: Tabelas }) {
  const qc = useQueryClient();
  const toast = useToast();
  const busca = useBuscaComEspera(filtros.q, (q) => mudar({ q }));
  const lista = useInfiniteQuery({
    queryKey: ['catalogo', 'escalonada', filtros.tabela, filtros.q, filtros.vigente],
    queryFn: async ({ pageParam }) => {
      const p = new URLSearchParams({ limit: String(POR_PAGINA), offset: String(pageParam) });
      if (filtros.tabela) p.set('tabela_preco_id', filtros.tabela);
      if (filtros.q) p.set('q', filtros.q);
      if (filtros.vigente) p.set('vigente', 'true');
      return PaginaEscalonada.parse(await api<unknown>(`${BASE}/escalonada?${p.toString()}`));
    },
    initialPageParam: 0,
    getNextPageParam: (u) => u.next_offset ?? undefined,
  });
  const itens = useMemo(() => lista.data?.pages.flatMap((p) => p.items) ?? [], [lista.data]);
  const total = lista.data?.pages[0]?.total ?? 0;
  const ligados = filtrosTabelasLigados(filtros);

  const [aberta, setAberta] = useState(false);
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState<FormFaixa>(FORM_FAIXA_VAZIO);
  const [produtoRotulo, setProdutoRotulo] = useState('');
  const [id, setId] = useState<string>(() => crypto.randomUUID());
  const [erro, setErro] = useState<string | null>(null);
  const [buscaProduto, setBuscaProduto] = useState('');
  const achados = useQuery({
    queryKey: ['catalogo', 'escalonada-produto', buscaProduto],
    enabled: aberta && buscaProduto.trim().length >= 2,
    queryFn: async () => RespostaBusca.parse(await api<unknown>(`${BASE}/busca?q=${encodeURIComponent(buscaProduto.trim())}&mode=basica&limit=8`)).items,
  });
  const abrir = (f: FaixaCadastrada | null) => {
    salvar.reset();
    setForm(f ? formDaFaixa(f) : FORM_FAIXA_VAZIO);
    setProdutoRotulo(f ? `${f.sku} · ${f.nome}` : '');
    setBuscaProduto('');
    setId(f ? f.id : crypto.randomUUID());
    setErro(null);
    setEditando(f !== null);
    setAberta(true);
  };
  const invalidar = () => void qc.invalidateQueries({ queryKey: ['catalogo', 'escalonada'] });
  const salvar = useMutation({
    mutationFn: (corpo: unknown) => api(`${BASE}/escalonada/${id}`, { method: 'PUT', body: corpo }),
    onSuccess: () => {
      invalidar();
      setAberta(false);
      toast('success', 'Faixa salva.');
    },
  });
  const [aRemover, setARemover] = useState<FaixaCadastrada | null>(null);
  const remover = useMutation({
    mutationFn: (f: FaixaCadastrada) => api(`${BASE}/escalonada/${f.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidar();
      setARemover(null);
      toast('success', 'Faixa removida.');
    },
    onError: (e) => {
      setARemover(null);
      toast('danger', errorMessage(e));
    },
  });

  const colunas: ColunaDaTabela<FaixaCadastrada>[] = [
    { id: 'produto', titulo: 'Produto', celula: (f) => nomeLegivel(f.nome), texto: (f) => f.nome },
    { id: 'codigo', titulo: 'Código', prioridade: 2, largura: '100px', celula: (f) => f.sku, texto: (f) => f.sku },
    { id: 'qtd', titulo: 'Qtd. mínima', numero: true, largura: '100px', celula: (f) => `${f.quantidade_minima} ${f.medida ?? 'UN'}` },
    { id: 'preco', titulo: 'Preço da unidade', numero: true, largura: '120px', celula: (f) => formatBRL(f.preco_unidade_cents) },
    { id: 'tabela', titulo: 'Tabela', prioridade: 3, largura: '120px', celula: (f) => f.tabela_preco_nome ?? 'Todas', texto: (f) => f.tabela_preco_nome ?? 'Todas' },
    { id: 'vigencia', titulo: 'Vigência', prioridade: 3, largura: '160px', celula: (f) => textoVigencia(f.vigencia_inicio, f.vigencia_fim) },
    { id: 'situacao', titulo: 'Situação', largura: '150px', celula: (f) => <SeloSituacao selos={[seloDaFaixa(f)]} /> },
  ];
  const produtoDaFaixa = form.produto_id !== '';
  const salvarFaixa = () => {
    const r = faixaDoForm(form);
    setErro(r.ok ? null : r.erro);
    if (r.ok) salvar.mutate(r.valor);
  };
  const erroTopo = erro ?? (salvar.isError ? errorMessage(salvar.error) : null);

  return (
    <>
      <Cabecalho
        filtros={filtros}
        mudar={mudar}
        total={total}
        actions={
          <>
            <Button variant="primary" onClick={() => abrir(null)} data-testid="escalonada.nova">
              Nova faixa
            </Button>
            <MenuAcoes
                acoes={[
                { id: 'csv', rotulo: 'Exportar CSV', desligada: itens.length === 0, aoEscolher: () => downloadBlob(new Blob([faixasParaCsv(itens)], { type: 'text/csv;charset=utf-8' }), 'tabela-escalonada.csv'), testId: 'escalonada.csv' },
                { id: 'atualizar', rotulo: 'Atualizar', desligada: lista.isFetching, aoEscolher: () => void lista.refetch() },
              ]}
            />
          </>
        }
      />
      <FilterBar>
        <CampoBusca rotulo="Buscar produto ou código" {...busca} data-testid="escalonada.filtro-q" />
        <SelectField label="Tabela" value={filtros.tabela} onChange={(e) => mudar({ tabela: e.target.value })} data-testid="escalonada.filtro-tabela">
          <option value="">Todas</option>
          {tabelas.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nome}
            </option>
          ))}
        </SelectField>
        <SelectField label="Vigência" value={filtros.vigente ? 'hoje' : ''} onChange={(e) => mudar({ vigente: e.target.value === 'hoje' })} data-testid="escalonada.filtro-vigente">
          <option value="">Todas</option>
          <option value="hoje">Vigentes hoje</option>
        </SelectField>
        <LimparFiltros ligado={ligados} onLimpar={() => mudar({ q: '', tabela: '', vigente: false })} testId="escalonada.limpar" />
      </FilterBar>
      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && <LoadingBlock label="Carregando as faixas…" />}
      {lista.data && (
        <TabelaDados
          rotulo="Faixas de preço por quantidade"
          testId="escalonada.tabela-faixas"
          linhas={itens}
          chave={(f) => f.id}
          colunas={colunas}
          esmaecida={(f) => !f.ativo}
          acoes={(f) =>
            f.origem === 'manual'
              ? [
                  { id: 'editar', rotulo: 'Editar', aoEscolher: () => abrir(f), testId: `escalonada.editar.${f.id}` },
                  { id: 'remover', rotulo: 'Remover', perigo: true, aoEscolher: () => setARemover(f), testId: `escalonada.remover.${f.id}` },
                ]
              : []
          }
          vazio={
            <EstadoVazio
              testId="escalonada.vazio"
              titulo={ligados ? 'Nenhuma faixa com esses filtros.' : 'Nenhuma faixa cadastrada.'}
              acao={
                !ligados ? (
                  <Button variant="primary" onClick={() => abrir(null)}>
                    Nova faixa
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}
      <BotaoCarregarMais tem={!!lista.hasNextPage} carregando={lista.isFetchingNextPage} aoClicar={() => void lista.fetchNextPage()} />

      <Drawer
        open={aberta}
        title={editando ? 'Editar faixa' : 'Nova faixa'}
        onClose={() => setAberta(false)}
        rodape={
          <>
            <Button onClick={() => setAberta(false)}>Cancelar</Button>
            <Button variant="primary" disabled={salvar.isPending} onClick={salvarFaixa} data-testid="escalonada.salvar">
              {salvar.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </>
        }>
        <div className="flex flex-col gap-4" data-testid="escalonada.form">
          {erroTopo && <Notice tone="danger">{erroTopo}</Notice>}
          <CampoFormulario rotulo="Produto">
            {produtoDaFaixa ? (
              <span className="flex min-h-[42px] items-center gap-2 text-[15px] font-normal text-ink" data-testid="escalonada.produto">
                {produtoRotulo}
                <Button size="sm" variant="link" onClick={() => setForm({ ...form, produto_id: '' })}>
                  Trocar
                </Button>
              </span>
            ) : (
              <>
                <input className={CLASSE_CAMPO} placeholder="Nome ou código (2+ letras)" value={buscaProduto} onChange={(e) => setBuscaProduto(e.target.value)} data-testid="escalonada.busca" />
                {achados.data && achados.data.length > 0 && (
                  <ul className="m-0 flex list-none flex-col rounded-[10px] border border-field bg-surface p-0 text-[13px] font-normal text-ink">
                    {achados.data.map((p) => (
                      <li key={p.id}>
                        <Button
                          size="sm"
                          variant="link"
                          onClick={() => {
                            setForm({ ...form, produto_id: p.id });
                            setProdutoRotulo(`${p.erp_code} · ${p.description}`);
                          }}>
                          {p.erp_code} · {p.description}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                {achados.data && achados.data.length === 0 && <span className="text-[12px] font-normal text-ink-2">Nenhum produto achado.</span>}
              </>
            )}
          </CampoFormulario>
          <div className="grid grid-cols-2 gap-4">
            <CampoFormulario rotulo="Quantidade mínima">
              <input className={CLASSE_CAMPO} inputMode="numeric" value={form.quantidade_minima} onChange={(e) => setForm({ ...form, quantidade_minima: e.target.value })} data-testid="escalonada.quantidade" />
            </CampoFormulario>
            <CampoFormulario rotulo="Medida" opcional>
              <input className={CLASSE_CAMPO} placeholder="UN" value={form.medida} maxLength={4} onChange={(e) => setForm({ ...form, medida: e.target.value })} data-testid="escalonada.medida" />
            </CampoFormulario>
          </div>
          <CampoFormulario rotulo="Preço da unidade (R$)">
            <input className={CLASSE_CAMPO} inputMode="decimal" value={form.preco} onChange={(e) => setForm({ ...form, preco: e.target.value })} data-testid="escalonada.preco" />
          </CampoFormulario>
          <div className="grid grid-cols-2 gap-4">
            <CampoFormulario rotulo="Início">
              <input className={CLASSE_CAMPO} type="date" value={form.vigencia_inicio} onChange={(e) => setForm({ ...form, vigencia_inicio: e.target.value })} data-testid="escalonada.inicio" />
            </CampoFormulario>
            <CampoFormulario rotulo="Fim" opcional>
              <input className={CLASSE_CAMPO} type="date" value={form.vigencia_fim} onChange={(e) => setForm({ ...form, vigencia_fim: e.target.value })} data-testid="escalonada.fim" />
            </CampoFormulario>
          </div>
          <CampoFormulario rotulo="Tabela">
            <select className={CLASSE_CAMPO} value={form.tabela_preco_id} onChange={(e) => setForm({ ...form, tabela_preco_id: e.target.value })} data-testid="escalonada.tabela">
              <option value="">Todas as tabelas</option>
              {tabelas.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </select>
          </CampoFormulario>
          <label className="inline-flex min-h-[42px] items-center gap-2 text-[15px] font-semibold">
            <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} /> Ativa
          </label>
        </div>
      </Drawer>

      <Dialog
        open={aRemover !== null}
        title={aRemover ? textoRemoverFaixa(aRemover.quantidade_minima, aRemover.nome).titulo : ''}
        onClose={() => setARemover(null)}
        footer={
          <>
            <Button onClick={() => setARemover(null)} data-testid="escalonada.remover.cancelar">
              Cancelar
            </Button>
            <Button variant="danger" disabled={remover.isPending} onClick={() => aRemover && remover.mutate(aRemover)} data-testid="escalonada.remover.confirmar">
              {remover.isPending ? 'Removendo…' : 'Remover'}
            </Button>
          </>
        }>
        {aRemover ? <p className="m-0">{textoRemoverFaixa(aRemover.quantidade_minima, aRemover.nome).corpo}</p> : null}
      </Dialog>
    </>
  );
}
