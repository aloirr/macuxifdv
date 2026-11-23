'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { formatarCep, formatarDocumento } from '@macuxi/comum';
import { UFS_BRASIL } from '@macuxi/comum/endereco';
import {
  Badge,
  Button,
  CampoBusca,
  CampoFormulario,
  CLASSE_CAMPO,
  type ColunaDaTabela,
  Dialog,
  Drawer,
  ErrorBlock,
  EstadoVazio,
  FilterBar,
  formatDateTimeFull,
  IconAlert,
  LoadingBlock,
  Notice,
  SelectField,
  TabelaDados,
  useToast,
} from '@macuxi/ui/web';
import type { HistoricoPreCadastro, PreCadastroAtual, RecusadoItem } from '../../../contracts';
import { ROTULOS_CAMPOS_PRE_CADASTRO } from '../../../contracts';
import { errosDaRecusaPorColuna, primeiraColunaMarcada, valoresDosDados, type ColunaFormulario, type ValoresPreCadastro } from '../../../app/lib/pre-cadastro-formulario';
import { obrigatoriosDoPreCadastro, validarPreCadastro } from '../../../domain';
import {
  buscaParaApi,
  corpoDaCorrecao,
  erroDoReenvio,
  filtrarPorVendedor,
  LIMPAR_FILTROS_RECUSADOS,
  rotuloDoCampo,
  seloDaSituacao,
  SITUACOES_RECUSADO,
  temFiltroRecusados,
  tentativasEmOrdem,
  textoDeQuemCorrigiuAntes,
  textoDeQuemEnviou,
  textoDoResultado,
  vendedoresDosItens,
  type FiltrosRecusados,
} from '../../lib/pre-cadastro';
import { useMe } from '../../lib/queries';
import { CHAVE_CAMPOS_OBRIGATORIOS, CHAVE_RECUSADOS, criarApiCamposObrigatorios, criarApiRecusados, type ApiRecusados } from './api';

const P = 'core.pre_cadastros';

/** Rótulo e largura (de 6 colunas) de cada campo do formulário, na ordem da spec §4. */
const GRADE: readonly { coluna: ColunaFormulario; rotulo: string; largura: string }[] = [
  { coluna: 'documento', rotulo: ROTULOS_CAMPOS_PRE_CADASTRO.documento, largura: 'col-span-3' },
  { coluna: 'inscricao_estadual', rotulo: ROTULOS_CAMPOS_PRE_CADASTRO.inscricao_estadual, largura: 'col-span-3' },
  { coluna: 'razao_social', rotulo: ROTULOS_CAMPOS_PRE_CADASTRO.razao_social, largura: 'col-span-6' },
  { coluna: 'nome_fantasia', rotulo: ROTULOS_CAMPOS_PRE_CADASTRO.nome_fantasia, largura: 'col-span-6' },
  { coluna: 'telefone', rotulo: ROTULOS_CAMPOS_PRE_CADASTRO.telefone, largura: 'col-span-3' },
  { coluna: 'email', rotulo: ROTULOS_CAMPOS_PRE_CADASTRO.email, largura: 'col-span-3' },
  { coluna: 'cep', rotulo: rotuloDoCampo('cep'), largura: 'col-span-3' },
  { coluna: 'bairro', rotulo: rotuloDoCampo('bairro'), largura: 'col-span-3' },
  { coluna: 'logradouro', rotulo: rotuloDoCampo('logradouro'), largura: 'col-span-4' },
  { coluna: 'numero', rotulo: rotuloDoCampo('numero'), largura: 'col-span-2' },
  { coluna: 'cidade', rotulo: rotuloDoCampo('cidade'), largura: 'col-span-4' },
  { coluna: 'uf', rotulo: rotuloDoCampo('uf'), largura: 'col-span-2' },
];
const ANTES_DO_ENDERECO: ColunaFormulario = 'cep';

/** Exibição com a máscara do Campo para o que tem máscara de formato fixo (o envio vai só com dígitos, `dadosDoFormulario`). */
const exibir = (c: ColunaFormulario, v: string): string => (c === 'documento' ? formatarDocumento(v) : c === 'cep' ? formatarCep(v) : v);

export interface PropsPreCadastrosRecusados {
  filtros: FiltrosRecusados;
  /** Muda a URL (`null` apaga a chave). */
  mudar: (patch: Record<string, string | null>) => void;
  api?: ApiRecusados;
}

/**
 * Clientes › Pré-cadastros recusados (v1.0.29; RN-CORE-78 e RN-CORE-79; ADR 0069 §7; spec `bko-pre-cadastros-recusados.md`): lista com
 * filtros na URL, gaveta com o histórico das tentativas e "Editar e reenviar" (revisão nova do mesmo cliente). Ver exige
 * `cliente.pre_cadastro_recusados` (a página monta a aba só com ela); reenviar, `cliente.pre_cadastro_corrigir`. A API revalida.
 */
export function PreCadastrosRecusados({ filtros, mudar, api: apiInjetada }: PropsPreCadastrosRecusados) {
  const apiR = useMemo(() => apiInjetada ?? criarApiRecusados(), [apiInjetada]);
  const fuso = useMe().data.tenant.timezone;
  const [busca, setBusca] = useState(filtros.q);
  const [aberto, setAberto] = useState<RecusadoItem | null>(null);

  // busca ao digitar, com espera de 300 ms (§P4)
  useEffect(() => {
    if (busca.trim() === filtros.q) return;
    const t = setTimeout(() => mudar({ q: busca.trim() || null }), 300);
    return () => clearTimeout(t);
  }, [busca]);

  const lista = useInfiniteQuery({
    queryKey: [...CHAVE_RECUSADOS, 'lista', { situacao: filtros.situacao, q: filtros.q }],
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) => apiR.listar({ situacao: filtros.situacao, busca: buscaParaApi(filtros.q), cursor: pageParam || undefined }, signal),
    getNextPageParam: (p) => p.proximo_cursor ?? undefined,
  });
  const todos = useMemo(() => (lista.data?.pages ?? []).flatMap((p) => p.itens), [lista.data]);
  const linhas = useMemo(() => filtrarPorVendedor(todos, filtros.vendedor), [todos, filtros.vendedor]);
  const vendedores = useMemo(() => vendedoresDosItens(todos), [todos]);
  const comFiltro = temFiltroRecusados(filtros);

  const colunas: ColunaDaTabela<RecusadoItem>[] = [
    { id: 'documento', titulo: 'CPF/CNPJ', celula: (l) => <span className="tabular-nums">{l.documento_mascarado ?? '—'}</span>, texto: (l) => l.documento_mascarado ?? '', largura: '190px' },
    { id: 'razao', titulo: 'Razão social', celula: (l) => <span className="block truncate font-semibold" title={l.razao_social}>{l.razao_social}</span>, texto: (l) => l.razao_social },
    { id: 'vendedor', titulo: 'Vendedor', celula: (l) => l.vendedor?.nome ?? '—', texto: (l) => l.vendedor?.nome ?? '', largura: '128px', prioridade: 2 },
    { id: 'data', titulo: 'Data', celula: (l) => <span className="tabular-nums">{formatDateTimeFull(l.recusado_em, fuso)}</span>, texto: (l) => formatDateTimeFull(l.recusado_em, fuso), largura: '168px' },
    { id: 'motivo', titulo: 'Motivo da recusa', celula: (l) => <span className="block truncate" title={l.motivo ?? undefined}>{l.motivo ?? '—'}</span>, texto: (l) => l.motivo ?? '', largura: '220px', prioridade: 2 },
    { id: 'situacao', titulo: 'Situação', celula: (l) => <Badge tone={seloDaSituacao(l.situacao).tom}>{seloDaSituacao(l.situacao).texto}</Badge>, texto: (l) => seloDaSituacao(l.situacao).texto, largura: '118px' },
  ];

  const vazio = comFiltro ? (
    <EstadoVazio
      testId={`${P}.vazio`}
      titulo="Nenhum pré-cadastro com estes filtros."
      acao={
        <Button
          onClick={() => {
            setBusca('');
            mudar(LIMPAR_FILTROS_RECUSADOS);
          }}
        >
          Limpar filtros
        </Button>
      }
    />
  ) : (
    <EstadoVazio testId={`${P}.vazio`} titulo="Nenhum pré-cadastro recusado." />
  );

  return (
    <div className="flex flex-col gap-4">
      <FilterBar>
        <CampoBusca rotulo="Razão social ou CPF/CNPJ" className="sm:w-[340px]" value={busca} maxLength={60} onChange={(e) => setBusca(e.target.value)} data-testid={`${P}.filtro.busca`} />
        <SelectField label="Situação" value={filtros.situacao} onChange={(e) => mudar({ situacao: e.target.value === 'recusado' ? null : e.target.value })} data-testid={`${P}.filtro.situacao`}>
          {SITUACOES_RECUSADO.map((s) => (
            <option key={s.id} value={s.id}>
              {s.texto}
            </option>
          ))}
        </SelectField>
        <SelectField label="Vendedor" value={filtros.vendedor} onChange={(e) => mudar({ vendedor: e.target.value || null })} data-testid={`${P}.filtro.vendedor`}>
          <option value="">Todos</option>
          {vendedores.map((v) => (
            <option key={v.id} value={v.id}>
              {v.nome}
            </option>
          ))}
        </SelectField>
      </FilterBar>

      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && <LoadingBlock label="Carregando os pré-cadastros…" />}
      {lista.data && (
        <div className={linhas.length === 0 ? '' : 'rounded-2xl border border-line bg-surface p-4'}>
          <TabelaDados rotulo="Pré-cadastros recusados" colunas={colunas} linhas={linhas} chave={(l) => l.cliente_id} linhaTestId={(l) => `${P}.linha.${l.cliente_id}`} vazio={vazio} aoAbrir={setAberto} />
          {lista.hasNextPage && (
            <div className="mt-3">
              <Button onClick={() => void lista.fetchNextPage()} disabled={lista.isFetchingNextPage}>
                {lista.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
              </Button>
            </div>
          )}
        </div>
      )}

      {aberto && <GavetaDoPreCadastro item={aberto} api={apiR} fuso={fuso} aoFechar={() => setAberto(null)} />}
    </div>
  );
}

/** Gaveta: o histórico (§3) e, no mesmo lugar, o "Editar e reenviar" (§4). */
function GavetaDoPreCadastro({ item, api, fuso, aoFechar }: { item: RecusadoItem; api: ApiRecusados; fuso: string; aoFechar: () => void }) {
  const podeReenviar = usePode('cliente.pre_cadastro_corrigir');
  const [editando, setEditando] = useState(false);
  const [sujo, setSujo] = useState(false);
  // o que o "Descartar" faz: voltar ao histórico (Cancelar) ou fechar a gaveta (×, Esc, clique fora)
  const [perguntar, setPerguntar] = useState<'cancelar' | 'fechar' | null>(null);
  const [enviando, setEnviando] = useState(false);
  const qc = useQueryClient();
  const historico = useQuery({ queryKey: [...CHAVE_RECUSADOS, 'historico', item.cliente_id], queryFn: () => api.historico(item.cliente_id) });
  const selo = seloDaSituacao(item.situacao);
  // a última tentativa vale sobre a linha da lista (alguém pode ter corrigido depois que a lista carregou)
  const ultima = historico.data ? tentativasEmOrdem(historico.data)[0] : undefined;
  const recusado = ultima ? ultima.resultado === 'recusado' : item.situacao === 'recusado';

  const sairDaEdicao = () => {
    setEditando(false);
    setSujo(false);
    setPerguntar(null);
  };
  const fechar = () => {
    if (enviando) return;
    if (editando && sujo) return setPerguntar('fechar');
    aoFechar();
  };
  const cancelar = () => (sujo ? setPerguntar('cancelar') : sairDaEdicao());

  return (
    <>
      <Drawer
        open
        onClose={fechar}
        title={editando ? 'Editar e reenviar' : item.razao_social}
        subtitle={
          editando ? undefined : (
            <span className="flex flex-wrap items-center gap-2">
              {[item.documento_mascarado, item.vendedor?.nome].filter(Boolean).join(' · ')}
              <Badge tone={selo.tom}>{selo.texto}</Badge>
            </span>
          )
        }
        rodape={
          editando ? (
            <>
              <Button onClick={cancelar} disabled={enviando} data-testid={`${P}.cancelar`}>
                Cancelar
              </Button>
              <Button variant="primary" form="pre-cadastro-correcao" type="submit" disabled={enviando} data-testid={`${P}.reenviar`}>
                {enviando ? 'Reenviando…' : 'Reenviar'}
              </Button>
            </>
          ) : recusado && podeReenviar ? (
            <Button variant="primary" onClick={() => setEditando(true)} data-testid={`${P}.editar`}>
              Editar e reenviar
            </Button>
          ) : undefined
        }
      >
        {editando ? (
          <FormularioDeCorrecao
            clienteId={item.cliente_id}
            api={api}
            fuso={fuso}
            aoMudar={() => setSujo(true)}
            aoEnviar={setEnviando}
            aoReenviar={aoFechar}
            aoVerHistorico={() => {
              sairDaEdicao();
              void qc.invalidateQueries({ queryKey: CHAVE_RECUSADOS });
            }}
          />
        ) : (
          <Historico consulta={historico} fuso={fuso} />
        )}
      </Drawer>
      <Dialog
        open={perguntar !== null}
        title="Descartar as alterações?"
        onClose={() => setPerguntar(null)}
        footer={
          <>
            <Button onClick={() => setPerguntar(null)}>Continuar</Button>
            <Button variant="danger" onClick={perguntar === 'fechar' ? aoFechar : sairDaEdicao}>
              Descartar
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
    </>
  );
}

function Historico({ consulta, fuso }: { consulta: UseQueryResult<HistoricoPreCadastro>; fuso: string }) {
  if (consulta.isError) return <ErrorBlock message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />;
  if (!consulta.data) return <LoadingBlock label="Carregando o histórico…" />;
  return (
    <section className="flex flex-col gap-3" data-testid={`${P}.historico`} aria-label="Tentativas">
      <span className="text-[12px] font-semibold text-ink-2">Tentativas</span>
      {tentativasEmOrdem(consulta.data).map((t) => (
        <article key={t.revisao} className="flex flex-col gap-1 rounded-xl border border-line bg-surface p-3 text-[13px] text-ink" data-testid={`${P}.tentativa.${t.revisao}`}>
          <strong className="font-semibold">Revisão {t.revisao}</strong>
          <span className="text-ink-2">{textoDeQuemEnviou(t, fuso)}</span>
          <span>{textoDoResultado(t, fuso)}</span>
          {t.resultado === 'recusado' && t.motivo && (
            <span className="flex items-start gap-1 text-danger">
              <IconAlert size={13} className="mt-[2px] shrink-0" />
              {t.motivo}
            </span>
          )}
          {t.resultado === 'recusado' &&
            t.erros.map((e, i) => (
              <span key={`${e.campo}.${i}`}>
                <strong className="font-semibold">{rotuloDoCampo(e.campo)}:</strong> {e.mensagem}
              </span>
            ))}
        </article>
      ))}
    </section>
  );
}

interface PropsFormulario {
  api: ApiRecusados;
  fuso: string;
  aoMudar: () => void;
  aoEnviar: (enviando: boolean) => void;
  aoReenviar: () => void;
  aoVerHistorico: () => void;
}

function FormularioDeCorrecao({ clienteId, ...props }: PropsFormulario & { clienteId: string }) {
  const { api } = props;
  const atual = useQuery({ queryKey: [...CHAVE_RECUSADOS, 'atual', clienteId], queryFn: () => api.atual(clienteId), gcTime: 0 });
  const apiCampos = useMemo(() => criarApiCamposObrigatorios(), []);
  const campos = useQuery({ queryKey: CHAVE_CAMPOS_OBRIGATORIOS, queryFn: apiCampos.ler, retry: false });
  if (atual.isError) return <ErrorBlock message={errorMessage(atual.error)} onRetry={() => void atual.refetch()} />;
  if (!atual.data || campos.isPending) return <LoadingBlock label="Carregando o cadastro…" />;
  return (
    <Formulario {...props} atual={atual.data} exigidos={campos.data ? obrigatoriosDoPreCadastro(campos.data.obrigatorios) : null} />
  );
}

function Formulario({ atual, exigidos, api, fuso, aoMudar, aoEnviar, aoReenviar, aoVerHistorico }: PropsFormulario & { atual: PreCadastroAtual; exigidos: ReturnType<typeof obrigatoriosDoPreCadastro> | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [valores, setValores] = useState<ValoresPreCadastro>(() => valoresDosDados(atual));
  // erros por campo da última recusa: abrem marcados; a marca sai quando o valor do campo muda (spec §4)
  const [marcas, setMarcas] = useState(() => errosDaRecusaPorColuna(atual.erros));
  const [tentou, setTentou] = useState(false);
  const [saiu, setSaiu] = useState<ReadonlySet<ColunaFormulario>>(new Set());
  const [aviso, setAviso] = useState<ReactNode>(atual.motivo);
  const raiz = useRef<HTMLFormElement>(null);

  const rolarAte = (c: ColunaFormulario | null) => {
    if (c) raiz.current?.querySelector(`[data-testid="${P}.form.campo.${c}"]`)?.scrollIntoView({ block: 'center' });
  };
  useEffect(() => rolarAte(primeiraColunaMarcada(marcas)), []);

  // sem a lista do parâmetro (sem permissão de ler), só os sempre obrigatórios; a API revalida
  const lista = exigidos ?? obrigatoriosDoPreCadastro([]);
  const validacao = validarPreCadastro(valores, lista).erros as Partial<Record<ColunaFormulario, string>>;
  const cpf = (valores.documento ?? '').replace(/\D/g, '').length <= 11;
  const opcional = (c: ColunaFormulario) => !lista.includes(c) || (c === 'inscricao_estadual' && cpf);
  const erroDe = (c: ColunaFormulario): string | undefined => {
    const v = validacao[c];
    const visivel = v && (v === 'Obrigatório' ? tentou : tentou || saiu.has(c));
    return (visivel ? v : undefined) ?? marcas[c];
  };

  const reenviar = useMutation({
    mutationFn: () => api.reenviar(atual.id, corpoDaCorrecao(atual, valores)),
    onMutate: () => aoEnviar(true),
    onSettled: () => aoEnviar(false),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: CHAVE_RECUSADOS });
      toast('success', 'Pré-cadastro reenviado.');
      aoReenviar();
    },
    onError: async (e) => {
      const r = erroDoReenvio(e);
      if (r.revisaoDesatualizada) {
        const h = await api.historico(atual.id).catch(() => undefined);
        setAviso(
          <span className="flex flex-col items-start gap-2">
            {textoDeQuemCorrigiuAntes(h, fuso)}
            <Button size="sm" onClick={aoVerHistorico}>
              Ver histórico
            </Button>
          </span>,
        );
        return;
      }
      setAviso(errorMessage(e));
      if (Object.keys(r.erros).length > 0) {
        setMarcas(r.erros);
        rolarAte(primeiraColunaMarcada(r.erros));
      }
    },
  });

  const mudar = (c: ColunaFormulario, texto: string) => {
    aoMudar();
    setMarcas((m) => (m[c] ? { ...m, [c]: undefined } : m));
    setValores((v) => ({ ...v, [c]: texto }));
  };

  return (
    <form
      ref={raiz}
      id="pre-cadastro-correcao"
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setTentou(true);
        const primeira = primeiraColunaMarcada(validacao);
        if (primeira) return rolarAte(primeira);
        reenviar.mutate();
      }}
    >
      {aviso && (
        <Notice tone="danger">
          <span data-testid={`${P}.form.aviso`}>{aviso}</span>
        </Notice>
      )}
      <div className="grid grid-cols-6 gap-3">
        {GRADE.map(({ coluna, rotulo, largura }) => (
          <div key={coluna} className={largura}>
            {coluna === ANTES_DO_ENDERECO && <span className="mb-2 block text-[12px] font-semibold tracking-wide text-ink-2 uppercase">Endereço</span>}
            <CampoFormulario rotulo={coluna === 'razao_social' && cpf ? 'Nome' : rotulo} opcional={opcional(coluna)} erro={erroDe(coluna)}>
              {coluna === 'uf' ? (
                <select
                  className={CLASSE_CAMPO}
                  value={valores.uf ?? ''}
                  aria-invalid={Boolean(erroDe(coluna))}
                  onChange={(e) => mudar(coluna, e.target.value)}
                  onBlur={() => setSaiu((s) => new Set(s).add(coluna))}
                  data-testid={`${P}.form.campo.${coluna}`}
                >
                  <option value="">Escolher</option>
                  {UFS_BRASIL.map((uf) => (
                    <option key={uf} value={uf}>
                      {uf}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className={CLASSE_CAMPO}
                  value={exibir(coluna, valores[coluna] ?? '')}
                  maxLength={200}
                  inputMode={coluna === 'documento' || coluna === 'cep' ? 'numeric' : coluna === 'telefone' ? 'tel' : coluna === 'email' ? 'email' : undefined}
                  aria-invalid={Boolean(erroDe(coluna))}
                  onChange={(e) => mudar(coluna, e.target.value)}
                  onBlur={() => setSaiu((s) => new Set(s).add(coluna))}
                  data-testid={`${P}.form.campo.${coluna}`}
                />
              )}
            </CampoFormulario>
          </div>
        ))}
      </div>
    </form>
  );
}

