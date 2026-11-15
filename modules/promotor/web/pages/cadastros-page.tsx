'use client';

/**
 * Cadastros de trade no BKO (T-0069, RF-PRO-11; revisão do BKO T-0173, §P1 a §P9): cada aba tem um só cadastro (checklists
 * de visita, categorias, metas de share, mix de ruptura por loja ou segmento, produtos do concorrente). Analista e admin
 * criam, editam e desativam (formulário na gaveta, ações no "⋯"); supervisor e gerente só leem, sem as ações. Desativar é
 * lógico. Os parâmetros do tenant (validade e peso do parcial) abrem em "Mais ações", só leitura. Aba e filtro na URL;
 * exporta CSV. RN-PRO-01: nada de pedido aqui.
 */
import { usePode } from '@macuxi/platform-sdk/react';
import { downloadBlob, errorMessage, useSession } from '@macuxi/platform-sdk/web';
import {
  Button,
  CampoFormulario,
  CLASSE_CAMPO,
  cx,
  DEFAULT_TZ,
  Dialog,
  Drawer,
  ErrorBlock,
  EstadoVazio,
  formatDateTime,
  LoadingBlock,
  MenuAcoes,
  Notice,
  PageHeader,
  Panel,
  rotuloComContagem,
  SeloSituacao,
  TabelaDados,
  useToast,
  type AcaoDoMenu,
  type ColunaDaTabela,
} from '@macuxi/ui/web';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ACAO_CADASTRO, type CadastroGravavel } from '../../contracts';
import {
  ABAS_CADASTRO,
  ACAO_MARCAS,
  avisoMarcas,
  cadastroCsv,
  CADASTROS_DA_ABA,
  corpoDoForm,
  errosDoForm,
  formDaLinha,
  formVazio,
  lerAbaCadastro,
  lerIncluirDesativados,
  paraBuscaAba,
  pctBr,
  ROTULO_ABA,
  rotuloAlvo,
  rotuloVigencia,
  textosDoCadastro,
  TIPOS_ETAPA,
  type AbaCadastro,
  type CampoDoForm,
  type EtapaForm,
  type FormCadastro,
} from '../lib/cadastros';
import { useDesativarCadastro, useGravarCadastro, useListaCadastro, useParametrosTrade, type LinhaDoCadastro } from '../lib/queries-cadastros';

const novoId = () => crypto.randomUUID();
const hojeIso = () => new Date().toISOString().slice(0, 10);
const SEM_ERROS: ReturnType<typeof errosDoForm> = { campos: {}, gerais: [] };

function useAbaNaUrl(): [AbaCadastro, boolean, (aba: AbaCadastro, desativados: boolean) => void] {
  const [estado, setEstado] = useState<[AbaCadastro, boolean]>(() => {
    const s = typeof window === 'undefined' ? '' : window.location.search;
    return [lerAbaCadastro(s), lerIncluirDesativados(s)];
  });
  useEffect(() => {
    const voltar = () => setEstado([lerAbaCadastro(window.location.search), lerIncluirDesativados(window.location.search)]);
    window.addEventListener('popstate', voltar);
    return () => window.removeEventListener('popstate', voltar);
  }, []);
  const mudar = useCallback((aba: AbaCadastro, desativados: boolean) => {
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${paraBuscaAba(aba, desativados)}`);
    setEstado([aba, desativados]);
  }, []);
  return [estado[0], estado[1], mudar];
}

export function CadastrosTradePage() {
  const [aba, desativados, mudar] = useAbaNaUrl();
  const cadastro = CADASTROS_DA_ABA[aba][0]!;
  const fuso = useSession<{ fuso?: string }>().user?.fuso ?? DEFAULT_TZ;
  const pode = usePode(ACAO_CADASTRO[cadastro]);
  const textos = textosDoCadastro(cadastro);
  const toast = useToast();
  // contagem de cada aba (§P6): as listas são as mesmas que a aba mostraria
  const contagem: Record<AbaCadastro, number> = {
    checklists: useListaCadastro('checklist_loja', desativados).data?.length ?? 0,
    categorias: useListaCadastro('categoria_gondola', desativados).data?.length ?? 0,
    metas: useListaCadastro('meta_share', desativados).data?.length ?? 0,
    mix: useListaCadastro('mix_obrigatorio', desativados).data?.length ?? 0,
    concorrentes: useListaCadastro('produto_concorrente', desativados).data?.length ?? 0,
  };
  const lista = useListaCadastro(cadastro, desativados);
  // seletores de categoria e de concorrente (nomes também para o CSV e as tabelas)
  const categorias = useListaCadastro('categoria_gondola', false);
  const concorrentes = useListaCadastro('concorrente', true); // com inativas: o nome aparece no histórico e no CSV (ADR 0034)
  const nomeCategorias = useMemo(() => new Map((categorias.data ?? []).map((l) => [l.id, String(l.nome)] as const)), [categorias.data]);
  const nomeConcorrentes = useMemo(() => new Map((concorrentes.data ?? []).map((l) => [l.id, String(l.nome)] as const)), [concorrentes.data]);
  const [editando, setEditando] = useState<{ id: string; nova: boolean; form: FormCadastro } | null>(null);
  const [confirmar, setConfirmar] = useState<LinhaDoCadastro | null>(null);
  const [verParametros, setVerParametros] = useState(false);
  const desativar = useDesativarCadastro(cadastro);

  useEffect(() => {
    setEditando(null);
    setConfirmar(null);
  }, [cadastro]);

  const itens = lista.data ?? [];
  const abrirNovo = () => setEditando({ id: novoId(), nova: true, form: formVazio(hojeIso(), novoId) });
  const abrirEdicao = (l: LinhaDoCadastro) => setEditando({ id: l.id, nova: false, form: formDaLinha(l) });
  const nomesParaCsv = cadastro === 'produto_concorrente' ? nomeConcorrentes : nomeCategorias;
  const botaoNovo = (testId: string) => (
    <Button variant="primary" data-testid={testId} onClick={abrirNovo}>
      {textos.novo}
    </Button>
  );

  const maisAcoes: AcaoDoMenu[] = [
    ...(itens.length > 0
      ? [{ id: 'csv', rotulo: 'Exportar CSV', testId: `cadastros-trade.${cadastro}.csv`, aoEscolher: () => downloadBlob(new Blob([cadastroCsv(cadastro, itens, nomesParaCsv)], { type: 'text/csv;charset=utf-8' }), `${cadastro}.csv`) }]
      : []),
    { id: 'atualizar', rotulo: 'Atualizar', aoEscolher: () => void lista.refetch() },
    { id: 'parametros', rotulo: 'Parâmetros de trade', testId: 'cadastros-trade.parametros-abrir', aoEscolher: () => setVerParametros(true) },
  ];

  const colunas = colunasDoCadastro(cadastro, { fuso, categorias: nomeCategorias, concorrentes: nomeConcorrentes, comSituacao: desativados });
  const acoesDaLinha = (l: LinhaDoCadastro): AcaoDoMenu[] =>
    l.deleted_at
      ? []
      : [
          { id: 'editar', rotulo: 'Editar', testId: `cadastros-trade.${cadastro}.editar`, aoEscolher: () => abrirEdicao(l) },
          { id: 'desativar', rotulo: 'Desativar', perigo: true, testId: `cadastros-trade.${cadastro}.desativar`, aoEscolher: () => setConfirmar(l) },
        ];

  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="cadastros-trade.tela">
      <PageHeader
        title="Cadastros de trade"
        actions={
          <div className="flex items-center gap-2">
            {pode && botaoNovo(`cadastros-trade.${cadastro}.novo`)}
            <MenuAcoes rotulo="Mais ações" acoes={maisAcoes} testId="cadastros-trade.mais-acoes" />
          </div>
        }
      />
      <div role="tablist" aria-label="Cadastros de trade" className="flex flex-wrap gap-1 border-b border-line">
        {ABAS_CADASTRO.map((a) => (
          <button
            key={a}
            type="button"
            role="tab"
            aria-selected={aba === a}
            data-testid={`cadastros-trade.aba-${a}`}
            onClick={() => mudar(a, desativados)}
            className={cx('-mb-px min-h-[44px] border-b-2 px-4 text-[15px] font-semibold', aba === a ? 'border-accent text-ink' : 'border-transparent text-ink-2 hover:text-ink')}>
            {rotuloComContagem(ROTULO_ABA[a], contagem[a])}
          </button>
        ))}
      </div>
      <label className="flex min-h-[44px] items-center gap-2 text-[13px] text-ink-2">
        <input type="checkbox" data-testid="cadastros-trade.desativados" checked={desativados} onChange={(e) => mudar(aba, e.target.checked)} />
        Mostrar desativados
      </label>
      {aba === 'concorrentes' && <AvisoMarcas />}
      <Panel label={ROTULO_ABA[aba]}>
        {desativar.isError && <Notice tone="danger">{errorMessage(desativar.error)}</Notice>}
        {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
        {lista.isPending && <LoadingBlock />}
        {lista.data && (
          <TabelaDados
            rotulo={ROTULO_ABA[aba]}
            testId={`cadastros-trade.${cadastro}.tabela`}
            colunas={colunas}
            linhas={itens}
            chave={(l) => l.id}
            acoes={pode ? acoesDaLinha : undefined}
            aoAbrir={pode ? (l) => !l.deleted_at && abrirEdicao(l) : undefined}
            esmaecida={(l) => !!l.deleted_at}
            vazio={<EstadoVazio testId={`cadastros-trade.${cadastro}.vazio`} titulo={textos.vazio} acao={pode ? botaoNovo(`cadastros-trade.${cadastro}.novo-vazio`) : undefined} />}
          />
        )}
      </Panel>
      {editando && (
        <FormularioGaveta
          cadastro={cadastro}
          estado={editando}
          categorias={categorias.data ?? []}
          concorrentes={concorrentes.data ?? []}
          aoFechar={() => setEditando(null)}
          aoGravar={() => {
            toast('success', textos.salvo);
            setEditando(null);
          }}
        />
      )}
      <Dialog
        open={confirmar !== null}
        title={textos.desativar}
        onClose={() => setConfirmar(null)}
        footer={
          <>
            <Button onClick={() => setConfirmar(null)}>Cancelar</Button>
            <Button
              variant="primary"
              data-testid={`cadastros-trade.${cadastro}.confirmar-desativar`}
              disabled={desativar.isPending}
              onClick={() => {
                if (!confirmar) return;
                desativar.mutate(confirmar.id, {
                  onSuccess: () => {
                    toast('success', textos.desativado);
                    setConfirmar(null);
                  },
                  onError: () => setConfirmar(null),
                });
              }}>
              Desativar
            </Button>
          </>
        }>
        O cadastro deixa de valer para a promotora.
      </Dialog>
      {verParametros && <ParametrosDrawer aoFechar={() => setVerParametros(false)} />}
    </div>
  );
}

/** Faixas de validade (RN-PRO-08) e peso do parcial (RN-PRO-11): parâmetros do tenant, somente leitura. */
function ParametrosDrawer({ aoFechar }: { aoFechar: () => void }) {
  const q = useParametrosTrade();
  return (
    <Drawer open title="Parâmetros de trade" onClose={aoFechar}>
      {q.isError && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}
      {q.isPending && <LoadingBlock label="Carregando os parâmetros…" />}
      {q.data && (
        <dl className="m-0 flex flex-col gap-4 text-[13px]" data-testid="cadastros-trade.parametros">
          <Parametro rotulo="Validade crítica (até)" valor={`${q.data.validade_critica_dias} dias`} testid="critica" />
          <Parametro rotulo="Validade em atenção (até)" valor={`${q.data.validade_proxima_dias} dias`} testid="atencao" />
          <Parametro rotulo="Peso do parcial na conformidade" valor={String(q.data.peso_parcial_conformidade).replace('.', ',')} testid="peso-parcial" />
        </dl>
      )}
    </Drawer>
  );
}
function Parametro({ rotulo, valor, testid }: { rotulo: string; valor: string; testid: string }) {
  return (
    <div>
      <dt className="text-[12px] font-semibold text-ink-2">{rotulo}</dt>
      <dd className="m-0 text-[17px] font-semibold" data-testid={`cadastros-trade.parametro-${testid}`}>
        {valor}
      </dd>
    </div>
  );
}

/** T-0113 (ADR 0034): as marcas concorrentes são do Catálogo; aqui só o aviso, sem cadastro (a aba de produtos usa a lista). */
function AvisoMarcas() {
  const { link } = avisoMarcas(usePode(ACAO_MARCAS));
  return (
    <Notice tone="info">
      <span data-testid="cadastros-trade.aviso-marcas">
        {link ? (
          <>
            Cadastre a marca em{' '}
            <a className="font-semibold underline" href="/catalogo/marcas" data-testid="cadastros-trade.link-marcas">
              Catálogo → Marcas concorrentes
            </a>
            .
          </>
        ) : (
          'A marca é cadastrada em Catálogo → Marcas concorrentes.'
        )}
      </span>
    </Notice>
  );
}

/** Situação da linha: um selo só, Desativado > Inativo > Ativo (§P5). */
function SituacaoDaLinha({ l }: { l: LinhaDoCadastro }) {
  return (
    <SeloSituacao
      selos={[
        l.deleted_at ? { tom: 'neutral', texto: 'Desativado' } : null,
        l.ativo === false ? { tom: 'warning', texto: 'Inativo' } : null,
        { tom: 'success', texto: 'Ativo' },
      ]}
    />
  );
}

type Coluna = ColunaDaTabela<LinhaDoCadastro>;

/** Colunas de cada cadastro (§P2: no máximo 6 de prioridade 1 e 2; "Atualizado em" é 3). */
function colunasDoCadastro(
  cadastro: CadastroGravavel,
  { fuso, categorias, concorrentes, comSituacao }: { fuso: string; categorias: ReadonlyMap<string, string>; concorrentes: ReadonlyMap<string, string>; comSituacao: boolean },
): Coluna[] {
  const cat = (id: unknown) => (typeof id === 'string' ? (categorias.get(id) ?? '—') : '—');
  const itensDe = (l: LinhaDoCadastro) => (l.itens as { obrigatoria: boolean }[] | undefined) ?? [];
  const alvoCompleto = (l: LinhaDoCadastro) => (typeof l.cliente_id === 'string' ? `Loja ${l.cliente_id}` : rotuloAlvo(l));
  const idTexto = (v: unknown) => (typeof v === 'string' && v ? v : '—');
  const concorrente = (l: LinhaDoCadastro) => (typeof l.concorrente_id === 'string' ? (concorrentes.get(l.concorrente_id) ?? '—') : '—');
  const nome = (id: string, titulo: string): Coluna => ({ id, titulo, celula: (l) => String(l.nome), texto: (l) => String(l.nome) });
  const situacao: Coluna = { id: 'situacao', titulo: 'Situação', celula: (l) => <SituacaoDaLinha l={l} />, largura: '120px' };
  const atualizado: Coluna = { id: 'atualizado', titulo: 'Atualizado em', prioridade: 3, celula: (l) => formatDateTime(l.updated_at, fuso), texto: (l) => formatDateTime(l.updated_at, fuso), largura: '150px' };
  const alvo: Coluna = { id: 'alvo', titulo: 'Vale para', celula: (l) => rotuloAlvo(l), texto: alvoCompleto };
  const vigencia: Coluna = { id: 'vigencia', titulo: 'Vigência', prioridade: 2, celula: (l) => rotuloVigencia(l), texto: (l) => rotuloVigencia(l) };
  const opcional = comSituacao ? [situacao] : [];
  switch (cadastro) {
    case 'checklist_loja':
      return [
        nome('nome', 'Checklist'),
        { id: 'etapas', titulo: 'Etapas', numero: true, celula: (l) => itensDe(l).length, largura: '90px' },
        { id: 'obrigatorias', titulo: 'Obrigatórias', numero: true, prioridade: 2, celula: (l) => itensDe(l).filter((i) => i.obrigatoria).length, largura: '120px' },
        alvo,
        vigencia,
        ...opcional,
        atualizado,
      ];
    case 'categoria_gondola':
      return [nome('nome', 'Categoria'), { id: 'ordem', titulo: 'Ordem', numero: true, celula: (l) => String(l.ordem), largura: '90px' }, situacao, atualizado];
    case 'meta_share':
      return [
        { id: 'categoria', titulo: 'Categoria', celula: (l) => cat(l.categoria_gondola_id), texto: (l) => cat(l.categoria_gondola_id) },
        { id: 'meta', titulo: 'Meta', numero: true, celula: (l) => pctBr(l.meta_pct), largura: '90px' },
        alvo,
        vigencia,
        ...opcional,
        atualizado,
      ];
    case 'mix_obrigatorio':
      return [
        { id: 'produto', titulo: 'Produto (id)', celula: (l) => <span className="font-mono text-[12px]">{String(l.produto_id)}</span>, texto: (l) => String(l.produto_id) },
        { id: 'categoria', titulo: 'Categoria', celula: (l) => cat(l.categoria_gondola_id), texto: (l) => cat(l.categoria_gondola_id) },
        { ...alvo, prioridade: 2 },
        vigencia,
        ...opcional,
        atualizado,
      ];
    case 'produto_concorrente':
      return [
        { id: 'concorrente', titulo: 'Concorrente', celula: concorrente, texto: concorrente },
        nome('nome', 'Produto do concorrente'),
        { id: 'produto_nosso', titulo: 'Produto nosso (id)', prioridade: 2, celula: (l) => <span className="font-mono text-[12px]">{idTexto(l.produto_id)}</span>, texto: (l) => idTexto(l.produto_id) },
        situacao,
        atualizado,
      ];
  }
}

function FormularioGaveta({ cadastro, estado, categorias, concorrentes, aoFechar, aoGravar }: {
  cadastro: CadastroGravavel;
  estado: { id: string; nova: boolean; form: FormCadastro };
  categorias: readonly LinhaDoCadastro[];
  concorrentes: readonly LinhaDoCadastro[];
  aoFechar: () => void;
  aoGravar: () => void;
}) {
  const textos = textosDoCadastro(cadastro);
  const [f, setF] = useState<FormCadastro>(estado.form);
  const [tentou, setTentou] = useState(false);
  const gravar = useGravarCadastro(cadastro);
  const muda = (patch: Partial<FormCadastro>) => setF((x) => ({ ...x, ...patch }));
  const comAlvo = cadastro === 'checklist_loja' || cadastro === 'meta_share' || cadastro === 'mix_obrigatorio';
  const comAtivo = cadastro === 'categoria_gondola' || cadastro === 'produto_concorrente';
  const comNome = cadastro !== 'meta_share' && cadastro !== 'mix_obrigatorio';
  const categoriasVivas = categorias.filter((c) => !c.deleted_at);
  const concorrentesVivos = concorrentes.filter((c) => !c.deleted_at && c.ativo !== false); // seletor: só marcas ativas
  // o erro só aparece depois da 1ª tentativa de salvar (§P8.3) e acompanha a correção
  const erros = tentou ? errosDoForm(cadastro, f, estado.id) : SEM_ERROS;
  const erro = (c: CampoDoForm) => erros.campos[c];
  const invalido = (c: CampoDoForm) => (erro(c) ? true : undefined);

  const salvar = () => {
    setTentou(true);
    const e = errosDoForm(cadastro, f, estado.id);
    if (Object.keys(e.campos).length > 0 || e.gerais.length > 0) return;
    gravar.mutate({ corpo: corpoDoForm(cadastro, f, estado.id) as { id: string } & Record<string, unknown>, nova: estado.nova }, { onSuccess: aoGravar });
  };
  const mudaEtapa = (i: number, patch: Partial<EtapaForm>) => muda({ etapas: f.etapas.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const moverEtapa = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= f.etapas.length) return;
    const e = [...f.etapas];
    [e[i], e[j]] = [e[j]!, e[i]!];
    muda({ etapas: e });
  };

  return (
    <Drawer
      open
      title={estado.nova ? textos.novo : textos.editar}
      onClose={aoFechar}
      rodape={
        <>
          <Button onClick={aoFechar}>Cancelar</Button>
          <Button variant="primary" data-testid="cadastros-trade.salvar" disabled={gravar.isPending} onClick={salvar}>
            {gravar.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }>
      <form className="flex flex-col gap-4" noValidate onSubmit={(e) => { e.preventDefault(); salvar(); }}>
        {(erros.gerais.length > 0 || gravar.isError) && (
          <Notice tone="danger">
            <ul className="m-0 list-none p-0" data-testid="cadastros-trade.problemas">
              {erros.gerais.map((p) => <li key={p}>{p}</li>)}
              {gravar.isError && <li>{errorMessage(gravar.error)}</li>}
            </ul>
          </Notice>
        )}
        {comNome && (
          <CampoFormulario rotulo="Nome" erro={erro('nome')}>
            <input className={CLASSE_CAMPO} aria-invalid={invalido('nome')} data-testid="cadastros-trade.campo-nome" value={f.nome} maxLength={cadastro === 'produto_concorrente' ? 200 : 120} onChange={(e) => muda({ nome: e.target.value })} />
          </CampoFormulario>
        )}
        {cadastro === 'categoria_gondola' && (
          <CampoFormulario rotulo="Ordem na lista" erro={erro('ordem')}>
            <input className={CLASSE_CAMPO} aria-invalid={invalido('ordem')} type="number" min={0} step={1} value={f.ordem} onChange={(e) => muda({ ordem: e.target.value })} />
          </CampoFormulario>
        )}
        {cadastro === 'produto_concorrente' && (
          <>
            <CampoFormulario rotulo="Concorrente" erro={erro('concorrente_id')}>
              <select className={CLASSE_CAMPO} aria-invalid={invalido('concorrente_id')} value={f.concorrente_id} data-testid="cadastros-trade.campo-concorrente" onChange={(e) => muda({ concorrente_id: e.target.value })}>
                <option value="">Escolha…</option>
                {concorrentesVivos.map((c) => <option key={c.id} value={c.id}>{String(c.nome)}</option>)}
              </select>
            </CampoFormulario>
            <CampoFormulario rotulo="Produto nosso comparado (identificador)" opcional erro={erro('produto_id')}>
              <input className={CLASSE_CAMPO} aria-invalid={invalido('produto_id')} value={f.produto_id} onChange={(e) => muda({ produto_id: e.target.value })} />
            </CampoFormulario>
          </>
        )}
        {cadastro === 'mix_obrigatorio' && (
          <CampoFormulario rotulo="Produto (identificador do cadastro de produtos)" erro={erro('produto_id')}>
            <input className={CLASSE_CAMPO} aria-invalid={invalido('produto_id')} data-testid="cadastros-trade.campo-produto" value={f.produto_id} onChange={(e) => muda({ produto_id: e.target.value })} />
          </CampoFormulario>
        )}
        {(cadastro === 'meta_share' || cadastro === 'mix_obrigatorio' || cadastro === 'produto_concorrente') && (
          <CampoFormulario rotulo="Categoria" opcional={cadastro !== 'meta_share'} erro={erro('categoria_gondola_id')}>
            <select className={CLASSE_CAMPO} aria-invalid={invalido('categoria_gondola_id')} value={f.categoria_gondola_id} data-testid="cadastros-trade.campo-categoria" onChange={(e) => muda({ categoria_gondola_id: e.target.value })}>
              <option value="">{cadastro === 'meta_share' ? 'Escolha…' : 'Nenhuma'}</option>
              {categoriasVivas.map((c) => <option key={c.id} value={c.id}>{String(c.nome)}</option>)}
            </select>
          </CampoFormulario>
        )}
        {cadastro === 'meta_share' && (
          <CampoFormulario rotulo="Meta de share (%), de 0 a 100" erro={erro('meta_pct')}>
            <input className={CLASSE_CAMPO} aria-invalid={invalido('meta_pct')} inputMode="decimal" data-testid="cadastros-trade.campo-meta" value={f.meta_pct} onChange={(e) => muda({ meta_pct: e.target.value })} />
          </CampoFormulario>
        )}
        {comAlvo && (
          <>
            <CampoFormulario rotulo="Vale para">
              <select className={CLASSE_CAMPO} value={f.alvo_tipo} data-testid="cadastros-trade.campo-alvo" onChange={(e) => muda({ alvo_tipo: e.target.value as FormCadastro['alvo_tipo'], alvo_valor: '' })}>
                <option value="todas">Todas as lojas</option>
                <option value="segmento">Um segmento (canal)</option>
                <option value="loja">Uma loja</option>
              </select>
            </CampoFormulario>
            {f.alvo_tipo !== 'todas' && (
              <CampoFormulario rotulo={f.alvo_tipo === 'loja' ? 'Loja (identificador do cadastro de clientes)' : 'Segmento'} erro={erro('alvo_valor')}>
                <input className={CLASSE_CAMPO} aria-invalid={invalido('alvo_valor')} value={f.alvo_valor} onChange={(e) => muda({ alvo_valor: e.target.value })} />
              </CampoFormulario>
            )}
            <div className="grid grid-cols-2 gap-3">
              <CampoFormulario rotulo="Vigência: início" erro={erro('vigencia_inicio')}>
                <input className={CLASSE_CAMPO} aria-invalid={invalido('vigencia_inicio')} type="date" value={f.vigencia_inicio} onChange={(e) => muda({ vigencia_inicio: e.target.value })} />
              </CampoFormulario>
              <CampoFormulario rotulo="Vigência: fim" opcional erro={erro('vigencia_fim')}>
                <input className={CLASSE_CAMPO} aria-invalid={invalido('vigencia_fim')} type="date" value={f.vigencia_fim} onChange={(e) => muda({ vigencia_fim: e.target.value })} />
              </CampoFormulario>
            </div>
          </>
        )}
        {cadastro === 'checklist_loja' && (
          <fieldset className="flex flex-col gap-2 border-0 p-0">
            <legend className="mb-1 text-[13px] font-semibold text-ink">Etapas</legend>
            {f.etapas.map((e, i) => (
              <div key={e.id} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3" data-testid="cadastros-trade.etapa">
                <CampoFormulario rotulo={`Etapa ${i + 1}`}>
                  <input className={CLASSE_CAMPO} aria-invalid={erro('etapas') && !e.rotulo.trim() ? true : undefined} value={e.rotulo} maxLength={200} onChange={(x) => mudaEtapa(i, { rotulo: x.target.value })} />
                </CampoFormulario>
                <div className="flex flex-wrap items-end gap-2">
                  <CampoFormulario rotulo="Tipo" className="min-w-[180px] flex-1">
                    <select className={CLASSE_CAMPO} value={e.tipo} onChange={(x) => mudaEtapa(i, { tipo: x.target.value })}>
                      {Object.entries(TIPOS_ETAPA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </CampoFormulario>
                  <label className="flex min-h-[42px] items-center gap-1.5 text-[13px] font-semibold">
                    <input type="checkbox" checked={e.obrigatoria} onChange={(x) => mudaEtapa(i, { obrigatoria: x.target.checked })} /> Obrigatória
                  </label>
                  <Button size="sm" type="button" aria-label="Subir etapa" onClick={() => moverEtapa(i, -1)}>↑</Button>
                  <Button size="sm" type="button" aria-label="Descer etapa" onClick={() => moverEtapa(i, 1)}>↓</Button>
                  <Button size="sm" type="button" onClick={() => muda({ etapas: f.etapas.filter((_, j) => j !== i) })}>Remover</Button>
                </div>
              </div>
            ))}
            {erro('etapas') && <span className="text-[12px] text-danger">{erro('etapas')}</span>}
            <Button size="sm" type="button" data-testid="cadastros-trade.nova-etapa" onClick={() => muda({ etapas: [...f.etapas, { id: novoId(), rotulo: '', tipo: 'marcar', obrigatoria: false }] })}>
              Adicionar etapa
            </Button>
          </fieldset>
        )}
        {comAtivo && (
          <label className="flex min-h-[44px] items-center gap-2 text-[13px] font-semibold">
            <input type="checkbox" checked={f.ativo} onChange={(e) => muda({ ativo: e.target.checked })} /> Ativo
          </label>
        )}
      </form>
    </Drawer>
  );
}
