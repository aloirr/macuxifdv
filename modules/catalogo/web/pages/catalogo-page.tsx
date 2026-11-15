'use client';

/**
 * Catálogo no BKO (RF-CAT-07, T-0052): produtos (busca, categoria, destaque e conteúdo da ficha), sinônimos do tenant e
 * termos buscados sem resultado. Filtros na URL, CSV da tabela e permissões refletidas na tela (RN-CAT-04: conteúdo,
 * sinônimos, destaques e termos só analista e admin) — a proteção real é na API. Revisão do BKO: tabelas sem rolagem
 * lateral, ações no menu "⋯", editores e formulários na gaveta, contagem na aba.
 */
import { useParametros, usePode } from '@macuxi/platform-sdk/react';
import { api, downloadBlob, errorMessage, useSession } from '@macuxi/platform-sdk/web';
import { Button, CampoBusca, CampoFormulario, CLASSE_CAMPO, CLASSE_CAMPO_BASE, DEFAULT_TZ, Dialog, Drawer, ErrorBlock, EstadoVazio, FilterBar, formatDateTime, LoadingBlock, MenuAcoes, nomeLegivel, Notice, PageHeader, rotuloComContagem, SelectField, SeloSituacao, TabelaDados, useToast, type AcaoDoMenu, type ColunaDaTabela } from '@macuxi/ui/web';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { FichaProduto, ListaMarcasConcorrentes, RespostaHierarquia, ListaSinonimos, ListaTermosSemResultado, PaginaVitrine, type ItemVitrine, type Sinonimo } from '../../contracts';
import { useAcoesExportacao, useDadosExportacao } from '../exportacao/exportacao-catalogo';
import { linhasEstoquePorFilial } from '../lib/estoque-filial';
import { caminhoDoProduto, escopoDoNivel } from '../exportacao/layout';
import { chaveDeTermo } from '../../domain/texto';
import { LIMITES_CADASTRO_CATALOGO } from '../../domain/cadastro-catalogo';
import { useBuscaComEspera } from '../lib/busca-com-espera';
import { abrirEditores, acaoTecladoOfereceJunto, adicionarOfereceJunto, anuncioOfereceJunto, listaOfereceJunto, moverOfereceJunto, removerOfereceJunto, sugestoesOfereceJunto, abrirParaLeitura, buscaDosFiltros, cadastroCatalogoDoForm, conteudoDoForm, contadorAplicacao, EDITORES_FECHADOS, formCadastroDaFicha, formDaFicha, formDoSinonimo, lerFiltrosBko, limiteAplicacao, mapaIdsPorCodigo, nomesDoOfereceJunto, produtosParaCsv, sinonimoDoForm, type AbaBko, type EditoresAbertos, type FiltrosBko, type FormCadastroCatalogo, type FormConteudo, type FormSinonimo } from '../lib/formularios';

const POR_PAGINA = 100;
const BASE = '/catalogo';
const CAMPO_TEXTO = `${CLASSE_CAMPO_BASE} w-full p-2.5 aria-[invalid=true]:border-danger`;

function useFiltros(): [FiltrosBko, (p: Partial<FiltrosBko>) => void] {
  const [f, setF] = useState<FiltrosBko>(() => lerFiltrosBko(typeof window === 'undefined' ? '' : window.location.search));
  useEffect(() => {
    const voltar = () => setF(lerFiltrosBko(window.location.search));
    window.addEventListener('popstate', voltar);
    return () => window.removeEventListener('popstate', voltar);
  }, []);
  const mudar = useCallback((p: Partial<FiltrosBko>) => {
    setF((atual) => {
      const novo = { ...atual, ...p };
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${buscaDosFiltros(novo)}`);
      return novo;
    });
  }, []);
  return [f, mudar];
}

type Mudar = (p: Partial<FiltrosBko>) => void;

/** Título da página e as abas (rótulo da aba aberta leva a contagem, §P6), na mesma linha das ações da aba (§P1). */
function Cabecalho({ aba, abas, mudar, total, haMais, actions }: { aba: AbaBko; abas: { id: AbaBko; rotulo: string }[]; mudar: Mudar; total?: number; haMais?: boolean; actions?: ReactNode }) {
  return (
    <>
      <PageHeader title="Catálogo" actions={actions} />
      <nav className="flex gap-2" aria-label="Seções do catálogo">
        {abas.map((a) => (
          <Button key={a.id} size="sm" variant={a.id === aba ? 'primary' : 'secondary'} aria-current={a.id === aba ? 'page' : undefined} data-testid={`catalogo.aba.${a.id}`} onClick={() => mudar({ aba: a.id })}>
            {a.id === aba && total !== undefined ? rotuloComContagem(a.rotulo, total, haMais) : a.rotulo}
          </Button>
        ))}
      </nav>
    </>
  );
}

export function CatalogoPage() {
  const [filtros, mudar] = useFiltros();
  const podeConteudo = usePode('produto.enriquecer');
  const podeSinonimos = usePode('sinonimo.gerenciar');
  const podeTermos = usePode('busca.ver_sem_resultado');
  const todas: { id: AbaBko; rotulo: string; visivel: boolean }[] = [
    { id: 'produtos', rotulo: 'Produtos', visivel: true },
    { id: 'sinonimos', rotulo: 'Sinônimos', visivel: podeSinonimos },
    { id: 'sem-resultado', rotulo: 'Buscas sem resultado', visivel: podeTermos },
  ];
  const abas = todas.filter((a) => a.visivel);
  const aba = abas.find((a) => a.id === filtros.aba)?.id ?? 'produtos';

  return (
    <div className="flex w-full max-w-[1062px] flex-col gap-5" data-testid="catalogo.tela">
      {aba === 'produtos' && <Produtos filtros={filtros} mudar={mudar} podeConteudo={podeConteudo} abas={abas} />}
      {aba === 'sinonimos' && <Sinonimos mudar={mudar} abas={abas} />}
      {aba === 'sem-resultado' && <SemResultado mudar={mudar} abas={abas} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
/** Trilha da hierarquia: "Catálogo › Sistema › Grupo"; o lugar atual e o nível pulado (item único) não são clicáveis. */
function TrilhaHierarquia({ h, abrir }: { h: RespostaHierarquia; abrir: (no: string) => void }) {
  if (h.trilha.length === 0) return null;
  return (
    <nav aria-label="Caminho no catálogo" className="flex flex-wrap items-center gap-1 text-[13px]" data-testid="catalogo.trilha">
      {h.raiz_tocavel ? (
        <Button size="sm" variant="link" onClick={() => abrir('')} data-testid="catalogo.trilha.inicio">
          Catálogo
        </Button>
      ) : (
        <span className="text-ink-2">Catálogo</span>
      )}
      {h.trilha.map((n, i) => {
        const atual = i === h.trilha.length - 1;
        return (
          <span key={n.id} className="inline-flex items-center gap-1">
            <span aria-hidden="true">›</span>
            {n.tocavel ? (
              <Button size="sm" variant="link" onClick={() => abrir(n.id)} data-testid={`catalogo.trilha.${n.codigo}`}>
                {n.nome}
              </Button>
            ) : (
              <span aria-current={atual ? 'page' : undefined} className={atual ? 'font-semibold text-ink' : 'text-ink-2'}>
                {n.nome}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/** Página inicial do Catálogo no BKO (RF-CAT-09): o nível atual com a contagem de produtos ativos; clicar desce um nível. */
function HierarquiaNiveis({ hierarquia, abrir }: { hierarquia: RespostaHierarquia; abrir: (no: string) => void }) {
  if (hierarquia.tipo !== 'niveis') return null;
  const colunas: ColunaDaTabela<(typeof hierarquia.niveis)[number]>[] = [
    { id: 'nome', titulo: hierarquia.rotulo_plural, celula: (n) => n.nome, texto: (n) => n.nome },
    { id: 'total', titulo: 'Produtos ativos', numero: true, largura: '150px', celula: (n) => n.total.toLocaleString('pt-BR') },
  ];
  return (
    <div className="flex flex-col gap-2" data-testid="catalogo.hierarquia">
      <TrilhaHierarquia h={hierarquia} abrir={abrir} />
      <TabelaDados
        rotulo={hierarquia.rotulo_plural}
        testId="catalogo.hierarquia.tabela"
        linhas={hierarquia.niveis}
        chave={(n) => n.id}
        colunas={colunas}
        aoAbrir={(n) => abrir(n.id)}
        linhaTestId={(n) => `catalogo.nivel.${n.codigo}`}
        vazio={<EstadoVazio testId="catalogo.hierarquia.vazio" titulo="Nenhum produto no catálogo." />}
      />
    </div>
  );
}

function Produtos({ filtros, mudar, podeConteudo, abas }: { filtros: FiltrosBko; mudar: Mudar; podeConteudo: boolean; abas: { id: AbaBko; rotulo: string }[] }) {
  const autenticado = useSession().status === 'authenticated';
  const podeDestaque = usePode('destaque.gerenciar');
  const qc = useQueryClient();
  const toast = useToast();
  const [editores, setEditores] = useState<EditoresAbertos<ItemVitrine>>(EDITORES_FECHADOS);
  const busca = useBuscaComEspera(filtros.q, (q) => mudar({ q }));
  // RF-CAT-09: a página abre pela hierarquia (mesma regra do app); a tabela de produtos aparece ao chegar neles, sem hierarquia ou na busca
  const hier = useQuery({
    queryKey: ['catalogo', 'hierarquia', filtros.no],
    queryFn: async ({ signal }) => RespostaHierarquia.parse(await api<unknown>(`${BASE}/hierarquia`, { query: filtros.no ? { no: filtros.no } : {}, signal })),
    enabled: autenticado,
  });
  const h = hier.data;
  const mostrarTabela = filtros.q !== '' || (h !== undefined && h.tipo === 'produtos');
  const noDaLista = h?.tipo === 'produtos' ? h.no : null;
  const lista = useInfiniteQuery({
    queryKey: ['catalogo', 'produtos', noDaLista],
    queryFn: async ({ pageParam, signal }) => PaginaVitrine.parse(await api<unknown>(`${BASE}/produtos`, { query: { limit: POR_PAGINA, offset: pageParam, ...(noDaLista ? { no: noDaLista } : {}) }, signal })),
    initialPageParam: 0,
    getNextPageParam: (u) => u.next_offset ?? undefined,
    enabled: autenticado && mostrarTabela,
  });
  const destaque = useMutation({
    mutationFn: (v: { id: string; is_campaign: boolean }) => api(`${BASE}/produtos/${v.id}/destaque`, { method: 'PUT', body: { is_campaign: v.is_campaign } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['catalogo', 'produtos'] }),
    onError: (e) => toast('danger', errorMessage(e)),
  });
  // a exportação segue o nível aberto (nos produtos e nos níveis); a busca ganha a coluna "Caminho" (só para quem pode exportar, que já lê o cadastro)
  const { dados: cadastro } = useDadosExportacao();
  const escopo = useMemo(() => escopoDoNivel(h), [h]);
  const exportacao = useAcoesExportacao(filtros.q === '' ? escopo : {});
  const caminhos = useMemo(() => new Map((cadastro.data?.produtos ?? []).map((p) => [p.id, caminhoDoProduto(p.hierarquia)])), [cadastro.data]);
  const mostrarCaminho = filtros.q !== '' && caminhos.size > 0;
  const todos = useMemo(() => lista.data?.pages.flatMap((p) => p.items) ?? [], [lista.data]);
  const visiveis = useMemo(() => {
    const k = chaveDeTermo(filtros.q);
    if (!k) return todos;
    return todos.filter((i) => chaveDeTermo(`${i.erp_code} ${i.description} ${i.brand} ${i.line} ${i.ean ?? ''}`).includes(k));
  }, [todos, filtros.q]);

  const total = mostrarTabela ? (lista.data ? visiveis.length : undefined) : h?.tipo === 'niveis' ? h.total_produtos : undefined;
  const haMais = mostrarTabela && !!lista.hasNextPage;
  const colunas: ColunaDaTabela<ItemVitrine>[] = [
    { id: 'produto', titulo: 'Produto', celula: (i) => nomeLegivel(i.description), texto: (i) => i.description },
    { id: 'codigo', titulo: 'Código', prioridade: 2, largura: '120px', celula: (i) => <span className="font-mono">{i.erp_code}</span>, texto: (i) => i.erp_code },
    { id: 'marca', titulo: 'Marca', prioridade: 2, celula: (i) => i.brand || '—', texto: (i) => i.brand },
    { id: 'categoria', titulo: 'Categoria', prioridade: 3, celula: (i) => i.line || '—', texto: (i) => i.line },
    ...(mostrarCaminho ? [{ id: 'caminho', titulo: 'Caminho', prioridade: 3 as const, celula: (i: ItemVitrine) => <span data-testid={`catalogo.caminho.${i.erp_code}`}>{caminhos.get(i.id) ?? '—'}</span>, texto: (i: ItemVitrine) => caminhos.get(i.id) ?? '' }] : []),
    { id: 'destaque', titulo: 'Destaque', largura: '110px', celula: (i) => (i.is_campaign ? <SeloSituacao selos={[{ tom: 'pending', texto: 'Destaque' }]} /> : '—') },
  ];
  const acoesDaLinha = (i: ItemVitrine): AcaoDoMenu[] =>
    podeDestaque
      ? [{ id: 'destaque', rotulo: i.is_campaign ? 'Tirar do destaque' : 'Marcar como destaque', desligada: destaque.isPending, aoEscolher: () => destaque.mutate({ id: i.id, is_campaign: !i.is_campaign }), testId: `catalogo.destaque.${i.erp_code}` }]
      : [];
  const abrirProduto = (i: ItemVitrine) => setEditores(podeConteudo ? abrirEditores(i) : abrirParaLeitura(i));
  const acoesPagina: AcaoDoMenu[] = [
    ...(mostrarTabela ? [{ id: 'csv', rotulo: 'Exportar CSV', desligada: visiveis.length === 0, aoEscolher: () => downloadBlob(new Blob([produtosParaCsv(visiveis)], { type: 'text/csv;charset=utf-8' }), 'catalogo-produtos.csv'), testId: 'catalogo.csv' }] : []),
    ...exportacao.acoes,
    { id: 'atualizar', rotulo: hier.isFetching || lista.isFetching ? 'Atualizando…' : 'Atualizar', desligada: hier.isFetching || lista.isFetching, aoEscolher: () => void qc.invalidateQueries({ queryKey: ['catalogo'] }) },
  ];
  const item = editores.catalogo ?? editores.conteudo;

  return (
    <>
      <Cabecalho aba="produtos" abas={abas} mudar={mudar} total={total} haMais={haMais} actions={<MenuAcoes rotulo="Mais ações" acoes={acoesPagina} />} />
      <FilterBar>
        <CampoBusca rotulo="Buscar produto, código ou EAN" {...busca} data-testid="catalogo.busca" />
        {filtros.q !== '' && (
          <Button size="sm" onClick={() => mudar({ q: '' })} data-testid="catalogo.limpar">
            Limpar filtros
          </Button>
        )}
      </FilterBar>
      {hier.isError && filtros.q === '' && <ErrorBlock message={errorMessage(hier.error)} onRetry={() => void hier.refetch()} />}
      {!mostrarTabela && (
        <>
          {hier.isPending && <LoadingBlock label="Carregando o catálogo…" />}
          {h && <HierarquiaNiveis hierarquia={h} abrir={(no) => mudar({ no })} />}
        </>
      )}
      {mostrarTabela && h && h.tipo === 'produtos' && filtros.q === '' && <TrilhaHierarquia h={h} abrir={(no) => mudar({ no })} />}
      {mostrarTabela && lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {mostrarTabela && lista.isPending && <LoadingBlock label="Carregando os produtos…" />}
      {mostrarTabela && lista.data && (
        <TabelaDados
          rotulo="Produtos"
          testId="catalogo.tabela"
          linhas={visiveis}
          chave={(i) => i.id}
          colunas={colunas}
          aoAbrir={abrirProduto}
          acoes={podeDestaque ? acoesDaLinha : undefined}
          linhaTestId={(i) => `catalogo.linha.${i.erp_code}`}
          vazio={<EstadoVazio testId="catalogo.vazio" titulo={filtros.q !== '' ? 'Nenhum produto com esses filtros.' : 'Nenhum produto neste nível.'} />}
        />
      )}
      {mostrarTabela && lista.hasNextPage && (
        <div className="flex justify-center">
          <Button size="sm" onClick={() => void lista.fetchNextPage()} disabled={lista.isFetchingNextPage}>
            {lista.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
          </Button>
        </div>
      )}
      {item && <EditorProduto key={item.id} item={item} editores={editores} todos={todos} podeConteudo={podeConteudo} fechar={() => setEditores(EDITORES_FECHADOS)} />}
    </>
  );
}

/** Gaveta "Editar produto": conteúdo da ficha e cadastro do catálogo, um rodapé só (Cancelar e Salvar gravam os dois). */
function EditorProduto({ item, editores, todos, podeConteudo, fechar }: { item: ItemVitrine; editores: EditoresAbertos<ItemVitrine>; todos: readonly ItemVitrine[]; podeConteudo: boolean; fechar: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const conteudo = useRef<SecaoEditor>(null);
  const cadastro = useRef<SecaoEditor>(null);
  const [salvando, setSalvando] = useState(false);
  const salvarTudo = async () => {
    const secoes = [conteudo.current, cadastro.current].filter((s): s is SecaoEditor => s !== null);
    const validas = secoes.map((s) => s.validar());
    if (validas.some((v) => !v)) return;
    setSalvando(true);
    const resultados = await Promise.all(secoes.map((s) => s.enviar()));
    setSalvando(false);
    if (resultados.every(Boolean)) {
      void qc.invalidateQueries({ queryKey: ['catalogo'] });
      toast('success', 'Produto salvo.');
      fechar();
    }
  };
  return (
    <Drawer
      open
      title={podeConteudo ? 'Editar produto' : nomeLegivel(item.description)}
      onClose={fechar}
      rodape={
        podeConteudo ? (
          <>
            <Button onClick={fechar}>Cancelar</Button>
            <Button variant="primary" disabled={salvando} onClick={() => void salvarTudo()} data-testid="catalogo.salvar">
              {salvando ? 'Salvando…' : 'Salvar'}
            </Button>
          </>
        ) : (
          <Button onClick={fechar}>Fechar</Button>
        )
      }>
      <div className="flex flex-col gap-6">
        {podeConteudo && (
          <p className="m-0 text-[14px] font-semibold">
            <span className="font-mono">{item.erp_code}</span> · {nomeLegivel(item.description)}
          </p>
        )}
        {editores.conteudo && <EditorConteudo ref={conteudo} key={`c${editores.conteudo.id}`} item={editores.conteudo} />}
        {editores.catalogo && <EditorCadastroCatalogo ref={cadastro} key={`k${editores.catalogo.id}`} item={editores.catalogo} produtos={todos} somenteLeitura={!podeConteudo} />}
      </div>
    </Drawer>
  );
}

/** Cada seção da gaveta valida e grava só o que é dela; a gaveta fecha quando as duas gravam. */
interface SecaoEditor {
  validar: () => boolean;
  enviar: () => Promise<boolean>;
}

/** RN-CORE-39: o estoque do produto por filial (uma linha por filial que o usuário vê); sem direito a estoque, nada aparece. */
function EstoquePorFilial({ estoque }: { estoque: ItemVitrine['availability'] }) {
  const linhas = linhasEstoquePorFilial(estoque);
  if (!estoque) return null;
  return (
    <div className="flex flex-col gap-1 text-[13px]" data-testid="catalogo.estoque-filiais">
      <span className="text-[13px] font-semibold">Estoque por filial</span>
      {linhas.length === 0 ? <span className="text-ink-2">Sem saldo nas filiais que você vê.</span> : linhas.map((l) => <span key={l.id}>{l.texto}</span>)}
    </div>
  );
}

function EditorConteudo({ item, ref }: { item: ItemVitrine; ref: Ref<SecaoEditor> }) {
  const ficha = useQuery({ queryKey: ['catalogo', 'ficha', item.id], queryFn: async () => FichaProduto.parse(await api<unknown>(`${BASE}/produtos/${item.id}`)) });
  const [form, setForm] = useState<FormConteudo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (ficha.data && form === null) setForm(formDaFicha(ficha.data));
  }, [ficha.data, form]);
  const salvar = useMutation({ mutationFn: (corpo: unknown) => api(`${BASE}/produtos/${item.id}/conteudo`, { method: 'PUT', body: corpo }) });
  useImperativeHandle(ref, () => ({
    validar: () => {
      if (!form) return false;
      const r = conteudoDoForm(form);
      setErro(r.ok ? null : r.erro);
      return r.ok;
    },
    enviar: async () => {
      if (!form) return false;
      const r = conteudoDoForm(form);
      if (!r.ok) return false;
      try {
        await salvar.mutateAsync(r.valor);
        return true;
      } catch {
        return false;
      }
    },
  }));
  const campo = (k: keyof FormConteudo, rotulo: string, linhas: number, placeholder?: string) => (
    <CampoFormulario rotulo={rotulo} opcional>
      <textarea rows={linhas} className={CAMPO_TEXTO} placeholder={placeholder} value={form?.[k] ?? ''} onChange={(e) => form && setForm({ ...form, [k]: e.target.value })} data-testid={`catalogo.conteudo.${k}`} />
    </CampoFormulario>
  );
  return (
    <section className="flex flex-col gap-4" aria-label={`Conteúdo de ${item.description}`} data-testid="catalogo.editor">
      <h3 className="m-0 text-[15px] font-semibold">Conteúdo da ficha</h3>
      {ficha.isError && <ErrorBlock message={errorMessage(ficha.error)} onRetry={() => void ficha.refetch()} />}
      {!form && !ficha.isError && <LoadingBlock label="Carregando a ficha…" />}
      {form && (
        <>
          {(erro || salvar.isError) && <Notice tone="danger">{erro ?? errorMessage(salvar.error)}</Notice>}
          <EstoquePorFilial estoque={ficha.data?.product.availability ?? null} />
          {campo('descricao', 'Descrição', 3)}
          {campo('argumentos', 'Argumentos de venda (um por linha, até 10)', 3)}
          {campo('atributos', 'Ficha técnica (Nome: valor, um por linha)', 4, 'Volume: 2 L')}
          {campo('faq', 'Perguntas frequentes', 4, 'P: pergunta\nR: resposta')}
        </>
      )}
    </section>
  );
}

/**
 * Seção Catálogo do cadastro do produto (T-0085 K9): aplicação (RN-CAT-11), oferece junto e referência cruzada (RN-CAT-09).
 * Só quem tem `produto.enriquecer` (analista e admin) edita; os demais veem a seção só leitura (B6 de UX); a proteção real é na API,
 * que audita cada alteração.
 */
function EditorCadastroCatalogo({ item, produtos, somenteLeitura = false, ref }: { item: ItemVitrine; produtos: readonly ItemVitrine[]; somenteLeitura?: boolean; ref: Ref<SecaoEditor> }) {
  const ficha = useQuery({ queryKey: ['catalogo', 'ficha', item.id], queryFn: async () => FichaProduto.parse(await api<unknown>(`${BASE}/produtos/${item.id}`)) });
  const marcas = useQuery({ queryKey: ['catalogo', 'marcas-concorrentes'], queryFn: async () => ListaMarcasConcorrentes.parse(await api<unknown>(`${BASE}/marcas-concorrentes`)).items });
  const [form, setForm] = useState<FormCadastroCatalogo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [buscaOferece, setBuscaOferece] = useState('');
  const [erroOferece, setErroOferece] = useState<string | null>(null);
  const [anuncio, setAnuncio] = useState('');
  const sugestoes = useMemo(() => sugestoesOfereceJunto(produtos, buscaOferece, listaOfereceJunto(form?.ofereceJunto ?? ''), item.erp_code), [produtos, buscaOferece, form?.ofereceJunto, item.erp_code]);
  useEffect(() => {
    if (ficha.data && form === null) setForm(formCadastroDaFicha(ficha.data));
  }, [ficha.data, form]);
  const idsPorCodigo = useMemo(() => mapaIdsPorCodigo(produtos, ficha.data?.catalogo?.oferece_junto), [produtos, ficha.data]);
  const salvar = useMutation({ mutationFn: (corpo: unknown) => api(`${BASE}/produtos/${item.id}/cadastro-catalogo`, { method: 'PUT', body: corpo }) });
  const parametros = useParametros('catalogo');
  const limite = limiteAplicacao(parametros);
  const contador = contadorAplicacao(form?.aplicacao.length ?? 0, limite);
  const converter = (f: FormCadastroCatalogo) => cadastroCatalogoDoForm(item.id, f, { idsPorCodigo, aplicacaoMax: limite, semReferencias: !marcas.data || marcas.data.length === 0 });
  useImperativeHandle(ref, () => ({
    validar: () => {
      if (somenteLeitura) return true;
      if (!form) return false;
      const r = converter(form);
      setErro(r.ok ? null : r.erro);
      return r.ok;
    },
    enviar: async () => {
      if (somenteLeitura) return true;
      if (!form) return false;
      const r = converter(form);
      if (!r.ok) return false;
      try {
        await salvar.mutateAsync(r.valor);
        return true;
      } catch {
        return false;
      }
    },
  }));
  return (
    <section className="flex flex-col gap-4" aria-label={`Catálogo de ${item.description}`} data-testid="catalogo.cadastro">
      <h3 className="m-0 text-[15px] font-semibold">Catálogo</h3>
      {ficha.isError && <ErrorBlock message={errorMessage(ficha.error)} onRetry={() => void ficha.refetch()} />}
      {!form && !ficha.isError && <LoadingBlock label="Carregando o cadastro…" />}
      {form && (
        <>
          {!somenteLeitura && (erro || salvar.isError) && <Notice tone="danger">{erro ?? errorMessage(salvar.error)}</Notice>}
          <CampoFormulario rotulo="Aplicação" opcional={!somenteLeitura}>
            <textarea rows={4} readOnly={somenteLeitura} className={CAMPO_TEXTO} placeholder="Fiat Uno 1.0/1.4 2010–2014" value={form.aplicacao} onChange={(e) => setForm({ ...form, aplicacao: e.target.value })} data-testid="catalogo.cadastro.aplicacao" />
            <span className={`self-end font-normal ${contador.excede ? 'text-danger' : 'text-ink-2'}`} data-testid="catalogo.cadastro.contador">
              {contador.texto}
            </span>
          </CampoFormulario>
          <fieldset className="flex flex-col gap-2" data-testid="catalogo.cadastro.oferece-junto">
            <legend className="text-[13px] font-semibold text-ink">Oferece junto (até {LIMITES_CADASTRO_CATALOGO.ofereceJunto})</legend>
            <ol className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Produtos que o vendedor oferece junto" data-testid="catalogo.cadastro.oferece-junto-nomes">
              {nomesDoOfereceJunto(form.ofereceJunto, produtos, ficha.data?.catalogo?.oferece_junto).map((n, i, todos) => {
                const rotulo = n.rotulo ?? `${n.codigo} · produto não achado`;
                const mover = (delta: number) => {
                  setForm({ ...form, ofereceJunto: moverOfereceJunto(form.ofereceJunto, i, delta) });
                  setAnuncio(anuncioOfereceJunto('moveu', rotulo, i + delta + 1, todos.length));
                };
                const remover = () => {
                  setForm({ ...form, ofereceJunto: removerOfereceJunto(form.ofereceJunto, i) });
                  setAnuncio(anuncioOfereceJunto('removeu', rotulo, 0, todos.length - 1));
                };
                const botao = 'h-[38px] min-w-[38px] rounded-[10px] border border-field bg-surface px-2 text-[13px] text-ink disabled:opacity-40';
                return (
                  <li
                    key={`${i}:${n.codigo}`}
                    className={`flex items-center gap-2 rounded-[10px] border border-line px-2 py-1 ${n.rotulo ? 'text-ink' : 'text-danger'}`}
                    tabIndex={somenteLeitura ? undefined : 0}
                    aria-label={`${i + 1} de ${todos.length}: ${rotulo}.${somenteLeitura ? '' : ' Alt com seta para cima ou para baixo muda a ordem; Delete remove.'}`}
                    data-testid={`catalogo.cadastro.oferece-junto.item.${i}`}
                    onKeyDown={(e) => {
                      if (somenteLeitura) return;
                      const acao = acaoTecladoOfereceJunto(e, i, todos.length);
                      if (!acao) return;
                      e.preventDefault();
                      if (acao.tipo === 'remover') remover();
                      else mover(acao.para - i);
                    }}
                  >
                    <span className="w-5 text-ink-2">{i + 1}.</span>
                    <span className="flex-1">{rotulo}</span>
                    {!somenteLeitura && (
                      <>
                        <button type="button" className={botao} disabled={i === 0} onClick={() => mover(-1)} aria-label={`Subir ${n.codigo}`} data-testid={`catalogo.cadastro.oferece-junto.subir.${i}`}>
                          ↑
                        </button>
                        <button type="button" className={botao} disabled={i === todos.length - 1} onClick={() => mover(1)} aria-label={`Descer ${n.codigo}`} data-testid={`catalogo.cadastro.oferece-junto.descer.${i}`}>
                          ↓
                        </button>
                        <button type="button" className={botao} onClick={remover} aria-label={`Tirar ${n.codigo}`} data-testid={`catalogo.cadastro.oferece-junto.tirar.${i}`}>
                          Tirar
                        </button>
                      </>
                    )}
                  </li>
                );
              })}
            </ol>
            {listaOfereceJunto(form.ofereceJunto).length === 0 && <span className="font-normal text-ink-2">Nenhum produto na lista.</span>}
            <p className="sr-only" role="status" aria-live="polite" data-testid="catalogo.cadastro.oferece-junto.anuncio">
              {anuncio}
            </p>
            {!somenteLeitura && (
              <div className="flex flex-col gap-1">
                <CampoFormulario rotulo="Adicionar produto (código ou nome)">
                  <input
                    className={CLASSE_CAMPO}
                    value={buscaOferece}
                    onChange={(e) => {
                      setBuscaOferece(e.target.value);
                      setErroOferece(null);
                    }}
                    data-testid="catalogo.cadastro.oferece-junto.busca"
                  />
                </CampoFormulario>
                {sugestoes.length > 0 && (
                  <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Produtos encontrados">
                    {sugestoes.map((p) => (
                      <li key={p.erp_code}>
                        <button
                          type="button"
                          className="h-[38px] w-full rounded-[10px] border border-line bg-surface px-3 text-left text-[13px] text-ink"
                          onClick={() => {
                            const r = adicionarOfereceJunto(form.ofereceJunto, p.erp_code, LIMITES_CADASTRO_CATALOGO.ofereceJunto);
                            setErroOferece(r.erro);
                            if (!r.erro) {
                              setForm({ ...form, ofereceJunto: r.texto });
                              setBuscaOferece('');
                              setAnuncio(`${p.erp_code} adicionado. ${listaOfereceJunto(r.texto).length} produtos na lista.`);
                            }
                          }}
                          data-testid={`catalogo.cadastro.oferece-junto.adicionar.${p.erp_code}`}
                        >
                          {p.erp_code} · {p.description}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {buscaOferece.trim() !== '' && sugestoes.length === 0 && <span className="font-normal text-ink-2">Nenhum produto achado.</span>}
                {erroOferece && (
                  <span className="font-normal text-danger" role="alert">
                    {erroOferece}
                  </span>
                )}
              </div>
            )}
          </fieldset>
          <fieldset className="flex flex-col gap-3" data-testid="catalogo.cadastro.referencias">
            <legend className="text-[13px] font-semibold text-ink">Referência cruzada (até {LIMITES_CADASTRO_CATALOGO.referencias})</legend>
            {marcas.isError && <Notice tone="warning">A lista de marcas concorrentes não carregou. Atualize a página e tente de novo.</Notice>}
            {!somenteLeitura && marcas.data && marcas.data.length === 0 && (
              <span className="text-[13px] text-ink-2">
                Nenhuma marca cadastrada.{' '}
                <a className="font-semibold text-accent-ink underline" href="/catalogo/marcas" data-testid="catalogo.cadastrar-marca">
                  Cadastrar marcas concorrentes
                </a>
              </span>
            )}
            {form.referencias.map((r, i) => (
              <div key={i} className="grid grid-cols-2 gap-4">
                <CampoFormulario rotulo={`Marca ${i + 1}`}>
                  <select className={CLASSE_CAMPO} disabled={somenteLeitura} value={r.marca_id} onChange={(e) => setForm({ ...form, referencias: form.referencias.map((x, k) => (k === i ? { ...x, marca_id: e.target.value } : x)) })} data-testid={`catalogo.cadastro.marca.${i}`}>
                    <option value="">Sem marca</option>
                    {marcas.data?.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nome}
                      </option>
                    ))}
                  </select>
                </CampoFormulario>
                <CampoFormulario rotulo={`Código ${i + 1}`}>
                  <input className={CLASSE_CAMPO} readOnly={somenteLeitura} maxLength={LIMITES_CADASTRO_CATALOGO.codigo} value={r.codigo} onChange={(e) => setForm({ ...form, referencias: form.referencias.map((x, k) => (k === i ? { ...x, codigo: e.target.value } : x)) })} data-testid={`catalogo.cadastro.codigo.${i}`} />
                </CampoFormulario>
              </div>
            ))}
          </fieldset>
          <CampoFormulario rotulo={`Etiquetas (até ${LIMITES_CADASTRO_CATALOGO.etiquetas}, separadas por vírgula)`} opcional={!somenteLeitura}>
            <input className={CLASSE_CAMPO} readOnly={somenteLeitura} placeholder="Dianteira, Novo" value={form.etiquetas} onChange={(e) => setForm({ ...form, etiquetas: e.target.value })} data-testid="catalogo.cadastro.etiquetas" />
          </CampoFormulario>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
const FORM_VAZIO: FormSinonimo = { termo: '', sinonimos: '', ativo: true };

function Sinonimos({ mudar, abas }: { mudar: Mudar; abas: { id: AbaBko; rotulo: string }[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const lista = useQuery({ queryKey: ['catalogo', 'sinonimos'], queryFn: async () => ListaSinonimos.parse(await api<unknown>(`${BASE}/sinonimos`)).items });
  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState<FormSinonimo>(FORM_VAZIO);
  const [id, setId] = useState<string>(() => crypto.randomUUID());
  const [erro, setErro] = useState<string | null>(null);
  const [aRemover, setARemover] = useState<Sinonimo | null>(null);
  const invalidar = () => void qc.invalidateQueries({ queryKey: ['catalogo'] });
  const salvar = useMutation({
    mutationFn: (corpo: unknown) => api(`${BASE}/sinonimos/${id}`, { method: 'PUT', body: corpo }),
    onSuccess: () => {
      invalidar();
      setAberto(false);
      toast('success', 'Grupo salvo.');
    },
  });
  const remover = useMutation({
    mutationFn: (s: Sinonimo) => api(`${BASE}/sinonimos/${s.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidar();
      setARemover(null);
      toast('success', 'Grupo removido.');
    },
    onError: (e) => {
      setARemover(null);
      toast('danger', errorMessage(e));
    },
  });
  const abrir = (s: Sinonimo | null) => {
    salvar.reset();
    setErro(null);
    setForm(s ? formDoSinonimo(s) : FORM_VAZIO);
    setId(s ? s.id : crypto.randomUUID());
    setEditando(s !== null);
    setAberto(true);
  };
  const itens = lista.data ?? [];
  const colunas: ColunaDaTabela<Sinonimo>[] = [
    { id: 'termo', titulo: 'Termo', celula: (s) => s.term, texto: (s) => s.term },
    { id: 'sinonimos', titulo: 'Sinônimos', celula: (s) => s.synonyms.join(', '), texto: (s) => s.synonyms.join(', ') },
    { id: 'situacao', titulo: 'Situação', largura: '120px', celula: (s) => <SeloSituacao selos={[s.active ? { tom: 'success', texto: 'Ativo' } : { tom: 'neutral', texto: 'Inativo' }]} /> },
  ];
  const erroTopo = erro ?? (salvar.isError ? errorMessage(salvar.error) : null);

  return (
    <>
      <Cabecalho
        aba="sinonimos"
        abas={abas}
        mudar={mudar}
        total={lista.data ? itens.length : undefined}
        actions={
          <Button variant="primary" onClick={() => abrir(null)} data-testid="sinonimos.novo">
            Novo grupo
          </Button>
        }
      />
      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && <LoadingBlock label="Carregando os sinônimos…" />}
      {lista.data && (
        <TabelaDados
          rotulo="Sinônimos da busca"
          testId="sinonimos.tabela"
          linhas={itens}
          chave={(s) => s.id}
          colunas={colunas}
          aoAbrir={(s) => abrir(s)}
          esmaecida={(s) => !s.active}
          acoes={(s) => [
            { id: 'editar', rotulo: 'Editar', aoEscolher: () => abrir(s) },
            { id: 'remover', rotulo: 'Remover', perigo: true, aoEscolher: () => setARemover(s) },
          ]}
          vazio={
            <EstadoVazio
              testId="sinonimos.vazio"
              titulo="Nenhum sinônimo cadastrado."
              acao={
                <Button variant="primary" onClick={() => abrir(null)}>
                  Novo grupo
                </Button>
              }
            />
          }
        />
      )}

      <Drawer
        open={aberto}
        title={editando ? 'Editar grupo' : 'Novo grupo'}
        onClose={() => setAberto(false)}
        rodape={
          <>
            <Button onClick={() => setAberto(false)}>Cancelar</Button>
            <Button
              variant="primary"
              disabled={salvar.isPending}
              data-testid="sinonimos.salvar"
              onClick={() => {
                const r = sinonimoDoForm(form);
                setErro(r.ok ? null : r.erro);
                if (r.ok) salvar.mutate(r.valor);
              }}>
              {salvar.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </>
        }>
        <div className="flex flex-col gap-4" data-testid="sinonimos.form">
          {erroTopo && <Notice tone="danger">{erroTopo}</Notice>}
          <CampoFormulario rotulo="Termo">
            <input className={CLASSE_CAMPO} placeholder="refrigerante" value={form.termo} onChange={(e) => setForm({ ...form, termo: e.target.value })} data-testid="sinonimos.termo" />
          </CampoFormulario>
          <CampoFormulario rotulo="Sinônimos (separados por vírgula)">
            <input className={CLASSE_CAMPO} placeholder="refri, soda" value={form.sinonimos} onChange={(e) => setForm({ ...form, sinonimos: e.target.value })} data-testid="sinonimos.lista" />
          </CampoFormulario>
          <label className="inline-flex min-h-[42px] items-center gap-2 text-[14px] font-semibold">
            <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} /> Ativo
          </label>
        </div>
      </Drawer>

      <Dialog
        open={aRemover !== null}
        title={aRemover ? `Remover o grupo "${aRemover.term}"?` : ''}
        onClose={() => setARemover(null)}
        footer={
          <>
            <Button onClick={() => setARemover(null)}>Cancelar</Button>
            <Button variant="danger" disabled={remover.isPending} onClick={() => aRemover && remover.mutate(aRemover)} data-testid="sinonimos.remover.confirmar">
              {remover.isPending ? 'Removendo…' : 'Remover'}
            </Button>
          </>
        }>
        {null}
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
function SemResultado({ mudar, abas }: { mudar: Mudar; abas: { id: AbaBko; rotulo: string }[] }) {
  const fuso = useSession<{ fuso?: string }>().user?.fuso ?? DEFAULT_TZ;
  const [dias, setDias] = useState(30);
  const lista = useQuery({ queryKey: ['catalogo', 'termos', dias], queryFn: async () => ListaTermosSemResultado.parse(await api<unknown>(`${BASE}/termos-sem-resultado`, { query: { days: dias, limit: 100 } })).items });
  const itens = lista.data ?? [];
  type Termo = (typeof itens)[number];
  const colunas: ColunaDaTabela<Termo>[] = [
    { id: 'termo', titulo: 'Termo', celula: (t) => t.term, texto: (t) => t.term },
    { id: 'buscas', titulo: 'Buscas', numero: true, largura: '110px', celula: (t) => t.count },
    { id: 'ultima', titulo: 'Última vez', numero: true, largura: '170px', celula: (t) => formatDateTime(t.last_searched_at, fuso) },
  ];
  return (
    <>
      <Cabecalho aba="sem-resultado" abas={abas} mudar={mudar} total={lista.data ? itens.length : undefined} />
      <FilterBar>
        <SelectField label="Período" value={String(dias)} onChange={(e) => setDias(Number(e.target.value))} data-testid="termos.periodo">
          <option value="7">Últimos 7 dias</option>
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
        </SelectField>
      </FilterBar>
      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && <LoadingBlock label="Carregando os termos…" />}
      {lista.data && <TabelaDados rotulo="Buscas sem resultado" testId="termos.tabela" linhas={itens} chave={(t) => t.term} colunas={colunas} vazio={<EstadoVazio testId="termos.vazio" titulo="Nenhuma busca sem resultado no período." />} />}
    </>
  );
}
