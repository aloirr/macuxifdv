'use client';

/**
 * Cadastros de trade no BKO (T-0069, RF-PRO-11): checklists de visita (etapas e obrigatórias), categorias, metas de share,
 * mix de ruptura (por loja ou segmento) e concorrentes com seus produtos. Analista e admin editam; supervisor e gerente só
 * leem (as ações somem; a API devolve 403 na escrita). A promotora recebe a mudança no próximo pull. Desativar é lógico
 * (nada é apagado). Faixas de validade e peso do parcial aparecem como parâmetros do tenant, só leitura. Aba e filtro na
 * URL; exporta CSV. RN-PRO-01: nada de pedido aqui.
 */
import { usePode } from '@macuxi/platform-sdk/react';
import { downloadBlob, errorMessage, useSession } from '@macuxi/platform-sdk/web';
import { Badge, Button, cx, DEFAULT_TZ, Dialog, ErrorBlock, formatDateTime, LoadingBlock, Notice, PageHeader, Panel, SelectField, TableScroll, td, tdNum, th, thNum } from '@macuxi/ui/web';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ACAO_CADASTRO, type CadastroBko } from '../../contracts';
import {
  ABAS_CADASTRO,
  cadastroCsv,
  CADASTROS_DA_ABA,
  corpoDoForm,
  formDaLinha,
  formVazio,
  lerAbaCadastro,
  lerIncluirDesativados,
  paraBuscaAba,
  pctBr,
  problemasDoForm,
  ROTULO_ABA,
  rotuloAlvo,
  rotuloVigencia,
  ACAO_MARCAS,
  avisoMarcas,
  TIPOS_ETAPA,
  type AbaCadastro,
  type EtapaForm,
  type FormCadastro,
} from '../lib/cadastros';
import { useDesativarCadastro, useGravarCadastro, useListaCadastro, useParametrosTrade, type LinhaDoCadastro } from '../lib/queries-cadastros';

const novoId = () => crypto.randomUUID();
const hojeIso = () => new Date().toISOString().slice(0, 10);
const NOME_CADASTRO: Record<CadastroBko, string> = {
  categoria_gondola: 'categoria',
  checklist_loja: 'checklist',
  meta_share: 'meta de share',
  mix_obrigatorio: 'item do mix',
  concorrente: 'concorrente',
  produto_concorrente: 'produto do concorrente',
};
const campo = 'h-[38px] rounded-[10px] border border-field bg-surface px-2.5 text-[14px] text-ink';
const rotuloCampo = 'flex flex-col gap-[3px] text-[12px] font-semibold text-ink-2';

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
  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="cadastros-trade.tela">
      <PageHeader title="Cadastros de trade" subtitle="Checklists, categorias, metas de share, mix de ruptura e concorrentes. A promotora recebe a mudança na próxima sincronização." />
      <ParametrosDoTenant />
      <div role="tablist" aria-label="Cadastros de trade" className="flex flex-wrap gap-1 border-b border-line">
        {ABAS_CADASTRO.map((a) => (
          <button
            key={a}
            type="button"
            role="tab"
            aria-selected={aba === a}
            data-testid={`cadastros-trade.aba-${a}`}
            onClick={() => mudar(a, desativados)}
            className={cx('-mb-px min-h-[44px] border-b-2 px-4 text-[14px] font-semibold', aba === a ? 'border-accent text-ink' : 'border-transparent text-ink-2 hover:text-ink')}>
            {ROTULO_ABA[a]}
          </button>
        ))}
      </div>
      <label className="flex min-h-[44px] items-center gap-2 text-[13px] text-ink-2">
        <input type="checkbox" data-testid="cadastros-trade.desativados" checked={desativados} onChange={(e) => mudar(aba, e.target.checked)} />
        Mostrar desativados
      </label>
      {CADASTROS_DA_ABA[aba].map((c) => (c === 'concorrente' ? <AvisoMarcas key={c} /> : <SecaoCadastro key={c} cadastro={c} incluirDesativados={desativados} />))}
    </div>
  );
}

/** Faixas de validade (RN-PRO-08) e peso do parcial (RN-PRO-11): parâmetros do tenant, somente leitura nesta versão. */
function ParametrosDoTenant() {
  const q = useParametrosTrade();
  return (
    <Panel label="Parâmetros do tenant" title="Parâmetros do tenant (somente leitura)">
      {q.isError && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}
      {q.isPending && <LoadingBlock label="Carregando os parâmetros…" />}
      {q.data && (
        <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3 text-[13px]" data-testid="cadastros-trade.parametros">
          <Parametro rotulo="Validade crítica (até)" valor={`${q.data.validade_critica_dias} dias`} testid="critica" />
          <Parametro rotulo="Validade em atenção (até)" valor={`${q.data.validade_proxima_dias} dias`} testid="atencao" />
          <Parametro rotulo="Peso do parcial na conformidade" valor={String(q.data.peso_parcial_conformidade).replace('.', ',')} testid="peso-parcial" />
        </dl>
      )}
      <span className="text-[12px] text-ink-2">Para mudar estes valores, fale com o suporte; a edição pelo BKO entra numa próxima versão.</span>
    </Panel>
  );
}
function Parametro({ rotulo, valor, testid }: { rotulo: string; valor: string; testid: string }) {
  return (
    <div>
      <dt className="text-[12px] font-semibold text-ink-2">{rotulo}</dt>
      <dd className="m-0 text-[16px] font-bold" data-testid={`cadastros-trade.parametro-${testid}`}>
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
        As marcas concorrentes agora ficam em{' '}
        {link ? <a className="font-semibold underline" href="/catalogo/marcas" data-testid="cadastros-trade.link-marcas">Catálogo → Marcas concorrentes</a> : 'Catálogo → Marcas concorrentes'}.
        {link ? ' Cadastre ou inative a marca lá; aqui você cadastra os produtos de cada concorrente.' : ' Peça a quem gerencia o Catálogo para cadastrar ou inativar a marca; aqui você cadastra os produtos de cada concorrente.'}
      </span>
    </Notice>
  );
}

function SecaoCadastro({ cadastro, incluirDesativados }: { cadastro: CadastroBko; incluirDesativados: boolean }) {
  const fuso = useSession<{ fuso?: string }>().user?.fuso ?? DEFAULT_TZ;
  const pode = usePode(ACAO_CADASTRO[cadastro]);
  const lista = useListaCadastro(cadastro, incluirDesativados);
  // seletores de categoria e de concorrente (nomes também para o CSV e as tabelas)
  const categorias = useListaCadastro('categoria_gondola', false);
  const concorrentes = useListaCadastro('concorrente', true); // com inativas: o nome aparece no histórico e no CSV (ADR 0034)
  const nomeCategorias = useMemo(() => new Map((categorias.data ?? []).map((l) => [l.id, String(l.nome)] as const)), [categorias.data]);
  const nomeConcorrentes = useMemo(() => new Map((concorrentes.data ?? []).map((l) => [l.id, String(l.nome)] as const)), [concorrentes.data]);
  const [editando, setEditando] = useState<{ id: string; nova: boolean; form: FormCadastro } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const desativar = useDesativarCadastro(cadastro);
  const [confirmar, setConfirmar] = useState<LinhaDoCadastro | null>(null);

  const itens = lista.data ?? [];
  const abrirNovo = () => setEditando({ id: novoId(), nova: true, form: formVazio(hojeIso(), novoId) });
  const abrirEdicao = (l: LinhaDoCadastro) => setEditando({ id: l.id, nova: false, form: formDaLinha(l) });
  const nomes = cadastro === 'produto_concorrente' ? nomeConcorrentes : nomeCategorias;

  return (
    <Panel
      label={NOME_CADASTRO[cadastro]}
      title={TITULO_SECAO[cadastro]}
      aside={
        <div className="flex gap-2">
          {itens.length > 0 && (
            <Button size="sm" data-testid={`cadastros-trade.${cadastro}.csv`} onClick={() => downloadBlob(new Blob([cadastroCsv(cadastro, itens, nomes)], { type: 'text/csv;charset=utf-8' }), `${cadastro}.csv`)}>
              Exportar CSV
            </Button>
          )}
          {pode && (
            <Button size="sm" variant="primary" data-testid={`cadastros-trade.${cadastro}.novo`} onClick={abrirNovo}>
              Novo {NOME_CADASTRO[cadastro]}
            </Button>
          )}
        </div>
      }>
      {!pode && <span className="text-[12px] text-ink-2">Seu perfil só consulta estes cadastros.</span>}
      {aviso && <Notice tone="success" onClose={() => setAviso(null)}>{aviso}</Notice>}
      {desativar.isError && <Notice tone="danger">{errorMessage(desativar.error)}</Notice>}
      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && <LoadingBlock />}
      {lista.data && itens.length === 0 && <span className="text-[13px] text-ink-2">Nada cadastrado ainda{pode ? `. Use "Novo ${NOME_CADASTRO[cadastro]}" para começar` : ''}.</span>}
      {itens.length > 0 && (
        <TableScroll minWidth={760}>
          <table className="w-full border-collapse text-[13px]" data-testid={`cadastros-trade.${cadastro}.tabela`}>
            <thead>
              <tr>
                <Cabecalho cadastro={cadastro} />
                <th scope="col" className={th}>Atualizado em</th>
                {pode && <th scope="col" className={th}>Ações</th>}
              </tr>
            </thead>
            <tbody>
              {itens.map((l) => (
                <tr key={l.id} className={l.deleted_at ? 'opacity-60' : undefined}>
                  <Celulas cadastro={cadastro} l={l} categorias={nomeCategorias} concorrentes={nomeConcorrentes} />
                  <td className={`${td} whitespace-nowrap text-ink-2`}>{formatDateTime(l.updated_at, fuso)}</td>
                  {pode && (
                    <td className={td}>
                      {l.deleted_at ? (
                        <Badge tone="neutral">Desativado</Badge>
                      ) : (
                        <div className="flex gap-2">
                          <Button size="sm" data-testid={`cadastros-trade.${cadastro}.editar`} onClick={() => abrirEdicao(l)}>Editar</Button>
                          <Button size="sm" data-testid={`cadastros-trade.${cadastro}.desativar`} onClick={() => setConfirmar(l)}>Desativar</Button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      {editando && (
        <FormularioDialog
          cadastro={cadastro}
          estado={editando}
          categorias={categorias.data ?? []}
          concorrentes={concorrentes.data ?? []}
          aoFechar={() => setEditando(null)}
          aoGravar={() => {
            setAviso(editando.nova ? `${cap(NOME_CADASTRO[cadastro])} criado. A promotora recebe na próxima sincronização.` : `${cap(NOME_CADASTRO[cadastro])} atualizado. A promotora recebe na próxima sincronização.`);
            setEditando(null);
          }}
        />
      )}
      <Dialog
        open={confirmar !== null}
        title={`Desativar ${NOME_CADASTRO[cadastro]}?`}
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
                    setAviso(`${cap(NOME_CADASTRO[cadastro])} desativado. Sai do app na próxima sincronização; o histórico fica guardado.`);
                    setConfirmar(null);
                  },
                  onError: () => setConfirmar(null),
                });
              }}>
              Desativar
            </Button>
          </>
        }>
        O cadastro deixa de valer para a promotora. Nada é apagado: as coletas já feitas continuam consultáveis.
      </Dialog>
    </Panel>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const TITULO_SECAO: Record<CadastroBko, string> = {
  checklist_loja: 'Checklists de visita',
  categoria_gondola: 'Categorias de gôndola',
  meta_share: 'Metas de share por categoria',
  mix_obrigatorio: 'Mix obrigatório (ruptura)',
  concorrente: 'Concorrentes',
  produto_concorrente: 'Produtos do concorrente',
};

function Cabecalho({ cadastro }: { cadastro: CadastroBko }) {
  const cols: Record<CadastroBko, string[]> = {
    checklist_loja: ['Checklist', 'Etapas', 'Obrigatórias', 'Vale para', 'Vigência'],
    categoria_gondola: ['Categoria', 'Ordem', 'Situação'],
    meta_share: ['Categoria', 'Meta', 'Vale para', 'Vigência'],
    mix_obrigatorio: ['Produto (id)', 'Categoria', 'Vale para', 'Vigência'],
    concorrente: ['Concorrente', 'Situação'],
    produto_concorrente: ['Concorrente', 'Produto do concorrente', 'Produto nosso (id)', 'Situação'],
  };
  return (
    <>
      {cols[cadastro].map((c) => (
        <th key={c} scope="col" className={c === 'Meta' || c === 'Ordem' || c === 'Etapas' || c === 'Obrigatórias' ? thNum : th}>
          {c}
        </th>
      ))}
    </>
  );
}

function Celulas({ cadastro, l, categorias, concorrentes }: { cadastro: CadastroBko; l: LinhaDoCadastro; categorias: ReadonlyMap<string, string>; concorrentes: ReadonlyMap<string, string> }) {
  const cat = (id: unknown) => (typeof id === 'string' ? (categorias.get(id) ?? '—') : '—');
  const situacao = (
    <td className={td}>
      <Badge tone={l.ativo === false ? 'warning' : 'success'}>{l.ativo === false ? 'Inativo' : 'Ativo'}</Badge>
    </td>
  );
  const itens = (l.itens as { obrigatoria: boolean }[] | undefined) ?? [];
  switch (cadastro) {
    case 'checklist_loja':
      return (
        <>
          <td className={`${td} font-semibold`}>{String(l.nome)}</td>
          <td className={tdNum}>{itens.length}</td>
          <td className={tdNum}>{itens.filter((i) => i.obrigatoria).length}</td>
          <td className={td}>{rotuloAlvo(l)}</td>
          <td className={td}>{rotuloVigencia(l)}</td>
        </>
      );
    case 'categoria_gondola':
      return (
        <>
          <td className={`${td} font-semibold`}>{String(l.nome)}</td>
          <td className={tdNum}>{String(l.ordem)}</td>
          {situacao}
        </>
      );
    case 'meta_share':
      return (
        <>
          <td className={`${td} font-semibold`}>{cat(l.categoria_gondola_id)}</td>
          <td className={tdNum}>{pctBr(l.meta_pct)}</td>
          <td className={td}>{rotuloAlvo(l)}</td>
          <td className={td}>{rotuloVigencia(l)}</td>
        </>
      );
    case 'mix_obrigatorio':
      return (
        <>
          <td className={`${td} font-mono text-[12px]`}>{String(l.produto_id)}</td>
          <td className={td}>{cat(l.categoria_gondola_id)}</td>
          <td className={td}>{rotuloAlvo(l)}</td>
          <td className={td}>{rotuloVigencia(l)}</td>
        </>
      );
    case 'concorrente':
      return (
        <>
          <td className={`${td} font-semibold`}>{String(l.nome)}</td>
          {situacao}
        </>
      );
    case 'produto_concorrente':
      return (
        <>
          <td className={td}>{typeof l.concorrente_id === 'string' ? (concorrentes.get(l.concorrente_id) ?? '—') : '—'}</td>
          <td className={`${td} font-semibold`}>{String(l.nome)}</td>
          <td className={`${td} font-mono text-[12px]`}>{typeof l.produto_id === 'string' ? l.produto_id : '—'}</td>
          {situacao}
        </>
      );
  }
}

function FormularioDialog({ cadastro, estado, categorias, concorrentes, aoFechar, aoGravar }: {
  cadastro: CadastroBko;
  estado: { id: string; nova: boolean; form: FormCadastro };
  categorias: readonly LinhaDoCadastro[];
  concorrentes: readonly LinhaDoCadastro[];
  aoFechar: () => void;
  aoGravar: () => void;
}) {
  const [f, setF] = useState<FormCadastro>(estado.form);
  const [problemas, setProblemas] = useState<string[]>([]);
  const gravar = useGravarCadastro(cadastro);
  const muda = (patch: Partial<FormCadastro>) => setF((x) => ({ ...x, ...patch }));
  const comAlvo = cadastro === 'checklist_loja' || cadastro === 'meta_share' || cadastro === 'mix_obrigatorio';
  const comAtivo = cadastro === 'categoria_gondola' || cadastro === 'concorrente' || cadastro === 'produto_concorrente';
  const comNome = cadastro !== 'meta_share' && cadastro !== 'mix_obrigatorio';
  const categoriasVivas = categorias.filter((c) => !c.deleted_at);
  const concorrentesVivos = concorrentes.filter((c) => !c.deleted_at && c.ativo !== false); // seletor: só marcas ativas

  const salvar = () => {
    const p = problemasDoForm(cadastro, f, estado.id);
    setProblemas(p);
    if (p.length > 0) return;
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
    <Dialog
      open
      title={`${estado.nova ? 'Novo' : 'Editar'} ${NOME_CADASTRO[cadastro]}`}
      onClose={aoFechar}
      footer={
        <>
          <Button onClick={aoFechar}>Cancelar</Button>
          <Button variant="primary" data-testid="cadastros-trade.salvar" disabled={gravar.isPending} onClick={salvar}>
            {gravar.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }>
      <form className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto" onSubmit={(e) => { e.preventDefault(); salvar(); }}>
        {comNome && (
          <label className={rotuloCampo}>
            Nome
            <input className={campo} data-testid="cadastros-trade.campo-nome" value={f.nome} maxLength={cadastro === 'produto_concorrente' ? 200 : 120} onChange={(e) => muda({ nome: e.target.value })} />
          </label>
        )}
        {cadastro === 'categoria_gondola' && (
          <label className={rotuloCampo}>
            Ordem na lista
            <input className={campo} type="number" min={0} step={1} value={f.ordem} onChange={(e) => muda({ ordem: e.target.value })} />
          </label>
        )}
        {cadastro === 'produto_concorrente' && (
          <>
            <SelectField label="Concorrente" value={f.concorrente_id} data-testid="cadastros-trade.campo-concorrente" onChange={(e) => muda({ concorrente_id: e.target.value })}>
              <option value="">Escolha…</option>
              {concorrentesVivos.map((c) => <option key={c.id} value={c.id}>{String(c.nome)}</option>)}
            </SelectField>
            <label className={rotuloCampo}>
              Produto nosso comparado (identificador, opcional)
              <input className={campo} value={f.produto_id} onChange={(e) => muda({ produto_id: e.target.value })} />
            </label>
          </>
        )}
        {cadastro === 'mix_obrigatorio' && (
          <label className={rotuloCampo}>
            Produto (identificador do cadastro de produtos)
            <input className={campo} data-testid="cadastros-trade.campo-produto" value={f.produto_id} onChange={(e) => muda({ produto_id: e.target.value })} />
          </label>
        )}
        {(cadastro === 'meta_share' || cadastro === 'mix_obrigatorio' || cadastro === 'produto_concorrente') && (
          <SelectField label={cadastro === 'meta_share' ? 'Categoria' : 'Categoria (opcional)'} value={f.categoria_gondola_id} data-testid="cadastros-trade.campo-categoria" onChange={(e) => muda({ categoria_gondola_id: e.target.value })}>
            <option value="">{cadastro === 'meta_share' ? 'Escolha…' : 'Nenhuma'}</option>
            {categoriasVivas.map((c) => <option key={c.id} value={c.id}>{String(c.nome)}</option>)}
          </SelectField>
        )}
        {cadastro === 'meta_share' && (
          <label className={rotuloCampo}>
            Meta de share (%), de 0 a 100
            <input className={campo} inputMode="decimal" data-testid="cadastros-trade.campo-meta" value={f.meta_pct} onChange={(e) => muda({ meta_pct: e.target.value })} />
          </label>
        )}
        {comAlvo && (
          <>
            <SelectField label="Vale para" value={f.alvo_tipo} data-testid="cadastros-trade.campo-alvo" onChange={(e) => muda({ alvo_tipo: e.target.value as FormCadastro['alvo_tipo'], alvo_valor: '' })}>
              <option value="todas">Todas as lojas</option>
              <option value="segmento">Um segmento (canal)</option>
              <option value="loja">Uma loja</option>
            </SelectField>
            {f.alvo_tipo !== 'todas' && (
              <label className={rotuloCampo}>
                {f.alvo_tipo === 'loja' ? 'Loja (identificador do cadastro de clientes)' : 'Segmento'}
                <input className={campo} value={f.alvo_valor} onChange={(e) => muda({ alvo_valor: e.target.value })} />
              </label>
            )}
            <div className="flex gap-3">
              <label className={rotuloCampo}>
                Vigência: início
                <input className={campo} type="date" value={f.vigencia_inicio} onChange={(e) => muda({ vigencia_inicio: e.target.value })} />
              </label>
              <label className={rotuloCampo}>
                Fim (opcional)
                <input className={campo} type="date" value={f.vigencia_fim} onChange={(e) => muda({ vigencia_fim: e.target.value })} />
              </label>
            </div>
          </>
        )}
        {cadastro === 'checklist_loja' && (
          <fieldset className="flex flex-col gap-2 border-0 p-0">
            <legend className="text-[12px] font-semibold text-ink-2">Etapas (a primeira é a primeira que a promotora vê)</legend>
            {f.etapas.map((e, i) => (
              <div key={e.id} className="flex flex-wrap items-end gap-2 rounded-xl border border-line p-2" data-testid="cadastros-trade.etapa">
                <label className={cx(rotuloCampo, 'min-w-[180px] flex-1')}>
                  Etapa {i + 1}
                  <input className={campo} value={e.rotulo} maxLength={200} onChange={(x) => mudaEtapa(i, { rotulo: x.target.value })} />
                </label>
                <SelectField label="Tipo" value={e.tipo} onChange={(x) => mudaEtapa(i, { tipo: x.target.value })}>
                  {Object.entries(TIPOS_ETAPA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </SelectField>
                <label className="flex min-h-[44px] items-center gap-1 text-[12px] font-semibold text-ink-2">
                  <input type="checkbox" checked={e.obrigatoria} onChange={(x) => mudaEtapa(i, { obrigatoria: x.target.checked })} /> Obrigatória
                </label>
                <Button size="sm" type="button" aria-label="Subir etapa" onClick={() => moverEtapa(i, -1)}>↑</Button>
                <Button size="sm" type="button" aria-label="Descer etapa" onClick={() => moverEtapa(i, 1)}>↓</Button>
                <Button size="sm" type="button" onClick={() => muda({ etapas: f.etapas.filter((_, j) => j !== i) })}>Remover</Button>
              </div>
            ))}
            <Button size="sm" type="button" data-testid="cadastros-trade.nova-etapa" onClick={() => muda({ etapas: [...f.etapas, { id: novoId(), rotulo: '', tipo: 'marcar', obrigatoria: false }] })}>
              Adicionar etapa
            </Button>
          </fieldset>
        )}
        {comAtivo && (
          <label className="flex min-h-[44px] items-center gap-2 text-[13px]">
            <input type="checkbox" checked={f.ativo} onChange={(e) => muda({ ativo: e.target.checked })} /> Ativo
          </label>
        )}
        {problemas.length > 0 && (
          <Notice tone="danger">
            <ul className="m-0 pl-4" data-testid="cadastros-trade.problemas">
              {problemas.map((p) => <li key={p}>{p}</li>)}
            </ul>
          </Notice>
        )}
        {gravar.isError && <Notice tone="danger">{errorMessage(gravar.error)}</Notice>}
      </form>
    </Dialog>
  );
}
