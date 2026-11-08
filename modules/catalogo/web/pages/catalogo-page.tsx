'use client';

/**
 * Catálogo no BKO (RF-CAT-07, T-0052): produtos (busca, categoria, destaque e conteúdo da ficha), sinônimos do tenant e
 * termos buscados sem resultado. Filtros na URL, CSV da tabela e permissões refletidas na tela (RN-CAT-04: conteúdo,
 * sinônimos, destaques e termos só analista e admin) — a proteção real é na API.
 */
import { useParametros, usePode } from '@macuxi/platform-sdk/react';
import { api, downloadBlob, errorMessage, useSession } from '@macuxi/platform-sdk/web';
import { Badge, Button, DEFAULT_TZ, ErrorBlock, FilterBar, formatDateTime, LoadingBlock, Notice, PageHeader, Panel, SelectField, TableScroll, td, th } from '@macuxi/ui/web';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FichaProduto, FiltrosCatalogo, ListaMarcasConcorrentes, ListaSinonimos, ListaTermosSemResultado, PaginaVitrine, type ItemVitrine, type Sinonimo } from '../../contracts';
import { ExportacaoCatalogo } from '../exportacao/exportacao-catalogo';
import { chaveDeTermo } from '../../domain/texto';
import { LIMITES_CADASTRO_CATALOGO } from '../../domain/cadastro-catalogo';
import { abrirEditores, buscaDosFiltros, cadastroCatalogoDoForm, conteudoDoForm, contadorAplicacao, EDITORES_FECHADOS, fecharEditor, formCadastroDaFicha, formDaFicha, formDoSinonimo, lerFiltrosBko, limiteAplicacao, mapaIdsPorCodigo, nomesDoOfereceJunto, produtosParaCsv, sinonimoDoForm, type AbaBko, type EditoresAbertos, type FiltrosBko, type FormCadastroCatalogo, type FormConteudo, type FormSinonimo } from '../lib/formularios';

const POR_PAGINA = 100;
const BASE = '/catalogo';

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

export function CatalogoPage() {
  const [filtros, mudar] = useFiltros();
  const podeConteudo = usePode('produto.enriquecer');
  const podeSinonimos = usePode('sinonimo.gerenciar');
  const podeTermos = usePode('busca.ver_sem_resultado');
  const abas: { id: AbaBko; rotulo: string; visivel: boolean }[] = [
    { id: 'produtos', rotulo: 'Produtos', visivel: true },
    { id: 'sinonimos', rotulo: 'Sinônimos', visivel: podeSinonimos },
    { id: 'sem-resultado', rotulo: 'Buscas sem resultado', visivel: podeTermos },
  ];
  const aba = abas.find((a) => a.id === filtros.aba && a.visivel)?.id ?? 'produtos';

  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="catalogo.tela">
      <PageHeader title="Catálogo" subtitle="Produtos, conteúdo da ficha, sinônimos da busca e o que os vendedores procuram sem achar." />
      <nav className="flex gap-2" aria-label="Seções do catálogo">
        {abas
          .filter((a) => a.visivel)
          .map((a) => (
            <Button key={a.id} size="sm" variant={a.id === aba ? 'primary' : 'secondary'} aria-current={a.id === aba ? 'page' : undefined} data-testid={`catalogo.aba.${a.id}`} onClick={() => mudar({ aba: a.id })}>
              {a.rotulo}
            </Button>
          ))}
      </nav>
      {aba === 'produtos' && <ExportacaoCatalogo />}
      {aba === 'produtos' && <Produtos filtros={filtros} mudar={mudar} podeConteudo={podeConteudo} />}
      {aba === 'sinonimos' && <Sinonimos />}
      {aba === 'sem-resultado' && <SemResultado />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
function Produtos({ filtros, mudar, podeConteudo }: { filtros: FiltrosBko; mudar: (p: Partial<FiltrosBko>) => void; podeConteudo: boolean }) {
  const autenticado = useSession().status === 'authenticated';
  const podeDestaque = usePode('destaque.gerenciar');
  const qc = useQueryClient();
  const [editores, setEditores] = useState<EditoresAbertos<ItemVitrine>>(EDITORES_FECHADOS);
  const vocab = useQuery({ queryKey: ['catalogo', 'filtros'], queryFn: async () => FiltrosCatalogo.parse(await api<unknown>(`${BASE}/filtros`)), enabled: autenticado });
  const lista = useInfiniteQuery({
    queryKey: ['catalogo', 'produtos', filtros.linha],
    queryFn: async ({ pageParam, signal }) => PaginaVitrine.parse(await api<unknown>(`${BASE}/produtos`, { query: { limit: POR_PAGINA, offset: pageParam, ...(filtros.linha ? { line: filtros.linha } : {}) }, signal })),
    initialPageParam: 0,
    getNextPageParam: (u) => u.next_offset ?? undefined,
    enabled: autenticado,
  });
  const destaque = useMutation({
    mutationFn: (v: { id: string; is_campaign: boolean }) => api(`${BASE}/produtos/${v.id}/destaque`, { method: 'PUT', body: { is_campaign: v.is_campaign } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['catalogo', 'produtos'] }),
  });
  const todos = useMemo(() => lista.data?.pages.flatMap((p) => p.items) ?? [], [lista.data]);
  const visiveis = useMemo(() => {
    const k = chaveDeTermo(filtros.q);
    if (!k) return todos;
    return todos.filter((i) => chaveDeTermo(`${i.erp_code} ${i.description} ${i.brand} ${i.line} ${i.ean ?? ''}`).includes(k));
  }, [todos, filtros.q]);

  return (
    <Panel label="Produtos" title="Produtos do catálogo">
      <FilterBar>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
          Buscar
          <input className="h-[38px] rounded-[10px] border border-field bg-surface px-3 text-[14px] text-ink" placeholder="Código, nome, marca ou EAN" value={filtros.q} onChange={(e) => mudar({ q: e.target.value })} data-testid="catalogo.busca" />
        </label>
        <SelectField label="Categoria" value={filtros.linha} onChange={(e) => mudar({ linha: e.target.value })} data-testid="catalogo.filtro.linha">
          <option value="">Todas</option>
          {vocab.data?.lines.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </SelectField>
        <Button size="sm" onClick={() => downloadBlob(new Blob([produtosParaCsv(visiveis)], { type: 'text/csv;charset=utf-8' }), 'catalogo-produtos.csv')} disabled={visiveis.length === 0} data-testid="catalogo.csv">
          Exportar CSV
        </Button>
      </FilterBar>
      {destaque.isError && <Notice tone="danger">{errorMessage(destaque.error)}</Notice>}
      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && <LoadingBlock label="Carregando os produtos…" />}
      {lista.data && visiveis.length === 0 && <span className="text-[13px] text-ink-2">Nenhum produto com esses filtros.</span>}
      {visiveis.length > 0 && (
        <TableScroll minWidth={860}>
          <table className="w-full border-collapse text-[13px]" data-testid="catalogo.tabela">
            <thead>
              <tr>
                <th scope="col" className={th}>Código</th>
                <th scope="col" className={th}>Produto</th>
                <th scope="col" className={th}>Marca</th>
                <th scope="col" className={th}>Categoria</th>
                <th scope="col" className={th}>Destaque</th>
                <th scope="col" className={th}>
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((i) => (
                <tr key={i.id} data-testid={`catalogo.linha.${i.erp_code}`}>
                  <td className={`${td} font-mono`}>{i.erp_code}</td>
                  <td className={td}>{i.description}</td>
                  <td className={td}>{i.brand || '—'}</td>
                  <td className={td}>{i.line || '—'}</td>
                  <td className={td}>
                    {podeDestaque ? (
                      <label className="inline-flex items-center gap-2">
                        <input type="checkbox" checked={i.is_campaign} disabled={destaque.isPending} onChange={(e) => destaque.mutate({ id: i.id, is_campaign: e.target.checked })} aria-label={`Destaque: ${i.description}`} />
                        {i.is_campaign ? 'Sim' : 'Não'}
                      </label>
                    ) : i.is_campaign ? (
                      <Badge tone="success">Destaque</Badge>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={`${td} text-right`}>
                    {podeConteudo && (
                      <Button size="sm" variant="link" onClick={() => setEditores(abrirEditores(i))} data-testid={`catalogo.editar.${i.erp_code}`}>
                        Editar conteúdo
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      {lista.hasNextPage && (
        <Button size="sm" onClick={() => void lista.fetchNextPage()} disabled={lista.isFetchingNextPage}>
          Carregar mais
        </Button>
      )}
      {editores.conteudo && <EditorConteudo key={editores.conteudo.id} item={editores.conteudo} fechar={() => setEditores((e) => fecharEditor(e, 'conteudo'))} />}
      {editores.catalogo && <EditorCadastroCatalogo key={editores.catalogo.id} item={editores.catalogo} produtos={todos} fechar={() => setEditores((e) => fecharEditor(e, 'catalogo'))} />}
    </Panel>
  );
}

function EditorConteudo({ item, fechar }: { item: ItemVitrine; fechar: () => void }) {
  const qc = useQueryClient();
  const ficha = useQuery({ queryKey: ['catalogo', 'ficha', item.id], queryFn: async () => FichaProduto.parse(await api<unknown>(`${BASE}/produtos/${item.id}`)) });
  const [form, setForm] = useState<FormConteudo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (ficha.data && form === null) setForm(formDaFicha(ficha.data));
  }, [ficha.data, form]);
  const salvar = useMutation({
    mutationFn: (corpo: unknown) => api(`${BASE}/produtos/${item.id}/conteudo`, { method: 'PUT', body: corpo }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['catalogo'] });
      fechar();
    },
  });
  const campo = (k: keyof FormConteudo, rotulo: string, ajuda: string, linhas: number) => (
    <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
      {rotulo}
      <textarea rows={linhas} className="rounded-[10px] border border-field bg-surface p-2 text-[14px] font-normal text-ink" value={form?.[k] ?? ''} onChange={(e) => form && setForm({ ...form, [k]: e.target.value })} data-testid={`catalogo.conteudo.${k}`} />
      <span className="font-normal text-ink-2">{ajuda}</span>
    </label>
  );
  return (
    <section className="mt-4 flex flex-col gap-3 rounded-xl border border-line p-4" aria-label={`Conteúdo de ${item.description}`} data-testid="catalogo.editor">
      <h3 className="text-[15px] font-semibold">
        Conteúdo da ficha · {item.erp_code} {item.description}
      </h3>
      {ficha.isError && <ErrorBlock message={errorMessage(ficha.error)} onRetry={() => void ficha.refetch()} />}
      {!form && !ficha.isError && <LoadingBlock label="Carregando a ficha…" />}
      {form && (
        <>
          {campo('descricao', 'Descrição', 'Texto que o vendedor lê na ficha.', 3)}
          {campo('argumentos', 'Argumentos de venda', 'Um por linha (até 10).', 3)}
          {campo('atributos', 'Ficha técnica', 'Um por linha, no formato "Nome: valor" (ex.: "Volume: 2 L"). Os atributos também entram na busca.', 4)}
          {campo('faq', 'Perguntas frequentes', 'Linhas "P: pergunta" seguidas de "R: resposta".', 4)}
          {(erro || salvar.isError) && <Notice tone="danger">{erro ?? errorMessage(salvar.error)}</Notice>}
          <div className="flex gap-2">
            <Button
              disabled={salvar.isPending}
              data-testid="catalogo.conteudo.salvar"
              onClick={() => {
                const r = conteudoDoForm(form);
                setErro(r.ok ? null : r.erro);
                if (r.ok) salvar.mutate(r.valor);
              }}>
              Salvar conteúdo
            </Button>
            <Button onClick={fechar}>Cancelar</Button>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Seção Catálogo do cadastro do produto (T-0085 K9): aplicação (RN-CAT-11), oferece junto e referência cruzada (RN-CAT-09).
 * Só quem tem `produto.enriquecer` (analista e admin) edita; a proteção real é na API, que audita cada alteração.
 */
function EditorCadastroCatalogo({ item, produtos, fechar }: { item: ItemVitrine; produtos: readonly ItemVitrine[]; fechar: () => void }) {
  const qc = useQueryClient();
  const ficha = useQuery({ queryKey: ['catalogo', 'ficha', item.id], queryFn: async () => FichaProduto.parse(await api<unknown>(`${BASE}/produtos/${item.id}`)) });
  const marcas = useQuery({ queryKey: ['catalogo', 'marcas-concorrentes'], queryFn: async () => ListaMarcasConcorrentes.parse(await api<unknown>(`${BASE}/marcas-concorrentes`)).items });
  const [form, setForm] = useState<FormCadastroCatalogo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (ficha.data && form === null) setForm(formCadastroDaFicha(ficha.data));
  }, [ficha.data, form]);
  const idsPorCodigo = useMemo(() => mapaIdsPorCodigo(produtos, ficha.data?.catalogo?.oferece_junto), [produtos, ficha.data]);
  const salvar = useMutation({
    mutationFn: (corpo: unknown) => api(`${BASE}/produtos/${item.id}/cadastro-catalogo`, { method: 'PUT', body: corpo }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['catalogo'] });
      fechar();
    },
  });
  const parametros = useParametros('catalogo');
  const limite = limiteAplicacao(parametros);
  const contador = contadorAplicacao(form?.aplicacao.length ?? 0, limite);
  const campoTexto = 'h-[38px] rounded-[10px] border border-field bg-surface px-3 text-[14px] text-ink';
  return (
    <section className="mt-4 flex flex-col gap-3 rounded-xl border border-line p-4" aria-label={`Catálogo de ${item.description}`} data-testid="catalogo.cadastro">
      <h3 className="text-[15px] font-semibold">
        Catálogo · {item.erp_code} {item.description}
      </h3>
      {ficha.isError && <ErrorBlock message={errorMessage(ficha.error)} onRetry={() => void ficha.refetch()} />}
      {!form && !ficha.isError && <LoadingBlock label="Carregando o cadastro…" />}
      {form && (
        <>
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
            Aplicação
            <textarea rows={4} className="rounded-[10px] border border-field bg-surface p-2 text-[14px] font-normal text-ink" value={form.aplicacao} onChange={(e) => setForm({ ...form, aplicacao: e.target.value })} data-testid="catalogo.cadastro.aplicacao" />
            <span className={`self-end font-normal ${contador.excede ? 'text-danger' : 'text-ink-2'}`} data-testid="catalogo.cadastro.contador">
              {contador.texto}
            </span>
            <span className="font-normal text-ink-2">Ex.: "Fiat Uno 1.0/1.4 2010–2014". A busca acha o ano dentro da faixa.</span>
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
            Oferece junto (até {LIMITES_CADASTRO_CATALOGO.ofereceJunto})
            <textarea rows={3} className="rounded-[10px] border border-field bg-surface p-2 text-[14px] font-normal text-ink" value={form.ofereceJunto} onChange={(e) => setForm({ ...form, ofereceJunto: e.target.value })} data-testid="catalogo.cadastro.oferece-junto" />
            <span className="font-normal text-ink-2">Um código do produto por linha, na ordem em que o vendedor vê.</span>
            <ul className="m-0 list-none p-0 font-normal text-ink-2" data-testid="catalogo.cadastro.oferece-junto-nomes">
              {nomesDoOfereceJunto(form.ofereceJunto, produtos, ficha.data?.catalogo?.oferece_junto).map((n, i) => (
                <li key={`${i}:${n.codigo}`} className={n.rotulo ? undefined : 'text-danger'}>
                  {n.rotulo ?? `${n.codigo} · produto não achado`}
                </li>
              ))}
            </ul>
          </label>
          <fieldset className="flex flex-col gap-2" data-testid="catalogo.cadastro.referencias">
            <legend className="text-[12px] font-semibold text-ink-2">Referência cruzada (até {LIMITES_CADASTRO_CATALOGO.referencias}): marca concorrente e código</legend>
            {marcas.isError && <Notice tone="warning">A lista de marcas concorrentes não carregou. Atualize a página e tente de novo.</Notice>}
            {marcas.data && marcas.data.length === 0 && <Notice tone="info">Cadastre as marcas em Cadastros → <a className="font-semibold underline" href="/catalogo/marcas" data-testid="catalogo.cadastrar-marca">Marcas concorrentes</a> para usar a referência cruzada.</Notice>}
            {form.referencias.map((r, i) => (
              <div key={i} className="flex flex-wrap items-end gap-3">
                <SelectField label={`Marca ${i + 1}`} value={r.marca_id} onChange={(e) => setForm({ ...form, referencias: form.referencias.map((x, k) => (k === i ? { ...x, marca_id: e.target.value } : x)) })} data-testid={`catalogo.cadastro.marca.${i}`}>
                  <option value="">Sem marca</option>
                  {marcas.data?.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nome}
                    </option>
                  ))}
                </SelectField>
                <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
                  Código {i + 1}
                  <input className={campoTexto} maxLength={LIMITES_CADASTRO_CATALOGO.codigo} value={r.codigo} onChange={(e) => setForm({ ...form, referencias: form.referencias.map((x, k) => (k === i ? { ...x, codigo: e.target.value } : x)) })} data-testid={`catalogo.cadastro.codigo.${i}`} />
                </label>
              </div>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
            Etiquetas (até {LIMITES_CADASTRO_CATALOGO.etiquetas})
            <input className={campoTexto} value={form.etiquetas} onChange={(e) => setForm({ ...form, etiquetas: e.target.value })} data-testid="catalogo.cadastro.etiquetas" />
            <span className="font-normal text-ink-2">Separadas por vírgula, até {LIMITES_CADASTRO_CATALOGO.etiqueta} caracteres cada (ex.: Dianteira, Novo).</span>
          </label>
          {(erro || salvar.isError) && <Notice tone="danger">{erro ?? errorMessage(salvar.error)}</Notice>}
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={salvar.isPending}
              data-testid="catalogo.cadastro.salvar"
              onClick={() => {
                const r = cadastroCatalogoDoForm(item.id, form, { idsPorCodigo, aplicacaoMax: limite, semReferencias: !marcas.data || marcas.data.length === 0 });
                setErro(r.ok ? null : r.erro);
                if (r.ok) salvar.mutate(r.valor);
              }}>
              Salvar catálogo
            </Button>
            <Button onClick={fechar}>Cancelar</Button>
          </div>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
const FORM_VAZIO: FormSinonimo = { termo: '', sinonimos: '', ativo: true };

function Sinonimos() {
  const qc = useQueryClient();
  const lista = useQuery({ queryKey: ['catalogo', 'sinonimos'], queryFn: async () => ListaSinonimos.parse(await api<unknown>(`${BASE}/sinonimos`)).items });
  const [form, setForm] = useState<FormSinonimo>(FORM_VAZIO);
  const [id, setId] = useState<string>(() => crypto.randomUUID());
  const [erro, setErro] = useState<string | null>(null);
  const invalidar = () => void qc.invalidateQueries({ queryKey: ['catalogo'] });
  const salvar = useMutation({
    mutationFn: (corpo: unknown) => api(`${BASE}/sinonimos/${id}`, { method: 'PUT', body: corpo }),
    onSuccess: () => {
      invalidar();
      setForm(FORM_VAZIO);
      setId(crypto.randomUUID());
    },
  });
  const remover = useMutation({ mutationFn: (s: Sinonimo) => api(`${BASE}/sinonimos/${s.id}`, { method: 'DELETE' }), onSuccess: invalidar });

  return (
    <Panel label="Sinônimos" title="Sinônimos da busca">
      <Notice tone="info">Cada grupo vale nos dois sentidos, também na busca sem internet do aplicativo (depois da próxima sincronização). Ex.: termo "refrigerante" com sinônimo "refri".</Notice>
      <div className="flex flex-wrap items-end gap-3" data-testid="sinonimos.form">
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
          Termo
          <input className="h-[38px] rounded-[10px] border border-field bg-surface px-3 text-[14px] text-ink" value={form.termo} onChange={(e) => setForm({ ...form, termo: e.target.value })} data-testid="sinonimos.termo" />
        </label>
        <label className="flex min-w-[280px] flex-1 flex-col gap-1 text-[12px] font-semibold text-ink-2">
          Sinônimos (separados por vírgula)
          <input className="h-[38px] rounded-[10px] border border-field bg-surface px-3 text-[14px] text-ink" value={form.sinonimos} onChange={(e) => setForm({ ...form, sinonimos: e.target.value })} data-testid="sinonimos.lista" />
        </label>
        <label className="inline-flex h-[38px] items-center gap-2 text-[13px]">
          <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} /> Ativo
        </label>
        <Button
          variant="primary"
          size="sm"
          disabled={salvar.isPending}
          data-testid="sinonimos.salvar"
          onClick={() => {
            const r = sinonimoDoForm(form);
            setErro(r.ok ? null : r.erro);
            if (r.ok) salvar.mutate(r.valor);
          }}>
          Salvar grupo
        </Button>
        {form !== FORM_VAZIO && (
          <Button
            size="sm"
            onClick={() => {
              setForm(FORM_VAZIO);
              setId(crypto.randomUUID());
            }}>
            Novo grupo
          </Button>
        )}
      </div>
      {(erro || salvar.isError || remover.isError) && <Notice tone="danger">{erro ?? errorMessage(salvar.error ?? remover.error)}</Notice>}
      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && <LoadingBlock label="Carregando os sinônimos…" />}
      {lista.data && lista.data.length === 0 && <span className="text-[13px] text-ink-2">Nenhum sinônimo cadastrado ainda.</span>}
      {lista.data && lista.data.length > 0 && (
        <table className="w-full border-collapse text-[13px]" data-testid="sinonimos.tabela">
          <thead>
            <tr>
              <th scope="col" className={th}>Termo</th>
              <th scope="col" className={th}>Sinônimos</th>
              <th scope="col" className={th}>Situação</th>
              <th scope="col" className={th}>
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lista.data.map((s) => (
              <tr key={s.id}>
                <td className={td}>{s.term}</td>
                <td className={td}>{s.synonyms.join(', ')}</td>
                <td className={td}>{s.active ? <Badge tone="success">Ativo</Badge> : <Badge tone="neutral">Inativo</Badge>}</td>
                <td className={`${td} whitespace-nowrap text-right`}>
                  <Button
                    size="sm"
                    variant="link"
                    onClick={() => {
                      setForm(formDoSinonimo(s));
                      setId(s.id);
                    }}>
                    Editar
                  </Button>{' '}
                  <Button size="sm" variant="link" disabled={remover.isPending} onClick={() => window.confirm(`Remover o grupo "${s.term}"?`) && remover.mutate(s)}>
                    Remover
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------------------------
function SemResultado() {
  const fuso = useSession<{ fuso?: string }>().user?.fuso ?? DEFAULT_TZ;
  const [dias, setDias] = useState(30);
  const lista = useQuery({ queryKey: ['catalogo', 'termos', dias], queryFn: async () => ListaTermosSemResultado.parse(await api<unknown>(`${BASE}/termos-sem-resultado`, { query: { days: dias, limit: 100 } })).items });
  return (
    <Panel label="Buscas sem resultado" title="O que procuraram e não acharam">
      <Notice tone="info">Use esta lista para cadastrar sinônimos (ex.: "bolacha" → "biscoito") ou pedir o produto ao comercial.</Notice>
      <FilterBar>
        <SelectField label="Período" value={String(dias)} onChange={(e) => setDias(Number(e.target.value))} data-testid="termos.periodo">
          <option value="7">Últimos 7 dias</option>
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
        </SelectField>
      </FilterBar>
      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && <LoadingBlock label="Carregando os termos…" />}
      {lista.data && lista.data.length === 0 && <span className="text-[13px] text-ink-2">Nenhuma busca sem resultado no período.</span>}
      {lista.data && lista.data.length > 0 && (
        <table className="w-full max-w-[720px] border-collapse text-[13px]" data-testid="termos.tabela">
          <thead>
            <tr>
              <th scope="col" className={th}>Termo</th>
              <th scope="col" className={th}>Buscas</th>
              <th scope="col" className={th}>Última vez</th>
            </tr>
          </thead>
          <tbody>
            {lista.data.map((t) => (
              <tr key={t.term}>
                <td className={td}>{t.term}</td>
                <td className={`${td} tabular-nums`}>{t.count}</td>
                <td className={`${td} whitespace-nowrap text-ink-2`}>{formatDateTime(t.last_searched_at, fuso)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
