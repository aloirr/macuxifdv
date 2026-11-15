'use client';

/**
 * Fotos em lote no BKO (T-0174, RN-CAT-14, RF-CAT-07; spec `docs/design/telas/fotos-em-lote.md`): envio do ZIP em partes de
 * 8 MiB pela API da plataforma, andamento, relatório com cartões-filtro e CSV. Só `produto.enriquecer` (analista e admin);
 * a API confere de novo. O shell só monta páginas de caminho fixo: o lote aberto vem na URL (`?lote=<id>`), com o cartão
 * marcado (`&filtro=`), e o Voltar do navegador volta para a lista.
 */
import { usePode } from '@macuxi/platform-sdk/react';
import { api, apiFetch, ApiRequestError, baseDaChamada, buildUrl, downloadBlob, errorMessage, getToken, renovarAcesso, useSession } from '@macuxi/platform-sdk/web';
import { Button, DEFAULT_TZ, Dialog, ErrorBlock, EstadoVazio, IconDownload, KpiCard, KpiGrid, LoadingBlock, Notice, PageHeader, Panel, Progresso, SeloSituacao, TabelaDados, type ColunaDaTabela } from '@macuxi/ui/web';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LIMITES_ZIP_TETO, partesDoEnvio } from '@macuxi/platform-sdk';
import { FotoLoteItensSaida, FotoLoteLimitesSchema, FotoLoteListaSchema, FotoLoteSchema, ROTULO_MOTIVO_LOTE, type FotoLote, type FotoLoteItem } from '../../contracts';
import { mensagemMotivoLote, textoLimitesLote, textoMotivoItem } from '../../domain';
import {
  acoesDoCabecalho,
  avisoLoteRepetido,
  buscaDaTelaFotosLote,
  cartoesVisiveis,
  consultaViva,
  corDoCartao,
  dataHoraCurta,
  enviarPartes,
  faseDoLote,
  INTERVALO_CONSULTA_MS,
  lerTelaFotosLote,
  limiteDeLotesAtivo,
  limitesDaTela,
  mensagemErroDoEnvio,
  mostraRelatorio,
  progressoDoEnvio,
  progressoDoProcessamento,
  ROTULO_CARTAO,
  seloDoItem,
  seloDoLote,
  situacoesDoCartao,
  TEXTO_ENVIO_PAROU,
  TEXTO_LOTES_ATIVOS,
  validarArquivoZip,
  valorDoCartao,
  type CartaoFoto,
  type FaseLote,
  type FatiaDoEnvio,
} from '../lib/fotos-lote';

const BASE = '/catalogo/fotos-lote';
const novoId = () => globalThis.crypto.randomUUID();
const POR_PAGINA = 100;

/** O arquivo escolhido fica na memória desta aba: fechar a aba para o envio e não há como retomá-lo (spec §4). */
interface EnvioDaAba {
  loteId: string;
  arquivoId: string;
  arquivo: File;
}
let envioDaAba: EnvioDaAba | null = null;

function useTela(): [ReturnType<typeof lerTelaFotosLote>, (t: Partial<ReturnType<typeof lerTelaFotosLote>>, modo?: 'push' | 'replace') => void] {
  const busca = useSearchParams();
  const rota = useRouter();
  const caminho = usePathname();
  const tela = lerTelaFotosLote(busca.toString());
  const ir = useCallback(
    (t: Partial<typeof tela>, modo: 'push' | 'replace' = 'push') => {
      const proxima = buscaDaTelaFotosLote({ ...lerTelaFotosLote(window.location.search), ...t });
      if (modo === 'replace') rota.replace(`${caminho}${proxima}`);
      else rota.push(`${caminho}${proxima}`);
    },
    [rota, caminho],
  );
  return [tela, ir];
}

function useFuso(): string {
  return useSession<{ fuso?: string }>().user?.fuso ?? DEFAULT_TZ;
}

async function baixarRelatorio(id: string): Promise<void> {
  const res = await apiFetch(`${BASE}/${id}/relatorio.csv`);
  const nome = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `fotos-lote-${id.slice(0, 8)}.csv`;
  downloadBlob(await res.blob(), decodeURIComponent(nome));
}

/** Limites efetivos do tenant (RN-CAT-14): vêm da API; até chegarem, vale o teto da plataforma na conferência. */
function useLimites() {
  const q = useQuery({
    queryKey: ['catalogo', 'fotos-lote', 'limites'],
    queryFn: async () => limitesDaTela(FotoLoteLimitesSchema.parse(await api<unknown>(`${BASE}/limites`))),
    staleTime: 5 * 60_000,
  });
  return { limites: q.data ?? null, conferencia: q.data ?? LIMITES_ZIP_TETO };
}

/** Uma página de itens do lote, já sem as fotos ainda na fila (`pendente`), com o filtro do cartão marcado. */
async function buscarItens(loteId: string, cartao: CartaoFoto | null, apos?: number): Promise<FotoLoteItensSaida> {
  const p = new URLSearchParams({ limite: String(POR_PAGINA) });
  if (cartao) p.set('situacao', situacoesDoCartao(cartao));
  if (apos !== undefined) p.set('apos', String(apos));
  const r = FotoLoteItensSaida.parse(await api<unknown>(`${BASE}/${loteId}/itens?${p.toString()}`));
  return { ...r, itens: r.itens.filter((i) => i.situacao !== 'pendente') };
}

function BotaoBaixarCsv({ id }: { id: string }) {
  const baixar = useMutation({ mutationFn: () => baixarRelatorio(id) });
  return (
    <>
      <Button onClick={() => baixar.mutate()} disabled={baixar.isPending} data-testid="fotos-lote.baixar-csv">
        <IconDownload /> {baixar.isPending ? 'Baixando…' : 'Baixar CSV'}
      </Button>
      {baixar.isError && <span className="sr-only" role="alert">{errorMessage(baixar.error)}</span>}
    </>
  );
}

export function FotosLotePage() {
  const [tela] = useTela();
  const pode = usePode('produto.enriquecer');
  if (!pode) return <ErrorBlock message="Você não tem acesso a Fotos em lote. Peça ao administrador da sua empresa." />;
  return tela.lote ? <PaginaDoLote id={tela.lote} /> : <PaginaDeEnvio />;
}

// ---------- /catalogo/fotos-lote ----------
function PaginaDeEnvio() {
  const [, ir] = useTela();
  const fuso = useFuso();
  const seletor = useRef<HTMLInputElement>(null);
  const [arrastando, setArrastando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const lista = useQuery({
    queryKey: ['catalogo', 'fotos-lote'],
    queryFn: async () => FotoLoteListaSchema.parse(await api<unknown>(BASE)).lotes,
    // timer-permitido: progresso do lote no BKO (RN-CAT-14), a cada 2 s só enquanto o lote anda; não sincroniza
    refetchInterval: (q) => (q.state.data?.some((l) => consultaViva(faseDoLote(l, false))) ? INTERVALO_CONSULTA_MS : false),
  });
  const { limites, conferencia } = useLimites();
  const qc = useQueryClient();
  const lotes = lista.data ?? [];
  const cheio = limiteDeLotesAtivo(lotes);

  const criar = useMutation({
    mutationFn: async (arquivo: File) => {
      const id = novoId();
      const arquivoId = novoId();
      await api(BASE, { method: 'POST', body: { id, arquivo_id: arquivoId, nome_arquivo: arquivo.name, tamanho_bytes: arquivo.size } });
      return { id, arquivoId, arquivo };
    },
    onSuccess: (e) => {
      envioDaAba = { loteId: e.id, arquivoId: e.arquivoId, arquivo: e.arquivo };
      ir({ lote: e.id, cartao: null, repetido: false });
    },
    onError: (e) => {
      const aviso = e instanceof ApiRequestError ? mensagemErroDoEnvio(e) : errorMessage(e);
      // 409 LOTE_EM_ANDAMENTO: sem aviso; a lista atualizada desliga o botão e a área de envio diz o motivo (RD-0617)
      if (aviso === null) void qc.invalidateQueries({ queryKey: ['catalogo', 'fotos-lote'] });
      else setAviso(aviso);
    },
  });

  const escolher = (arquivo: File | undefined) => {
    if (!arquivo || cheio) return;
    const v = validarArquivoZip(arquivo.name, arquivo.size, conferencia);
    if (!v.ok) {
      setAviso(v.mensagem);
      return;
    }
    setAviso(null);
    criar.mutate(arquivo);
  };
  const soltar = (e: React.DragEvent) => {
    e.preventDefault();
    setArrastando(false);
    escolher(Array.from(e.dataTransfer.files).find((f) => /\.zip$/i.test(f.name)) ?? e.dataTransfer.files[0]);
  };

  const colunas: ColunaDaTabela<FotoLote>[] = [
    { id: 'arquivo', titulo: 'Arquivo', largura: '36%', celula: (l) => l.nome_arquivo, texto: (l) => l.nome_arquivo },
    { id: 'enviado', titulo: 'Enviado em', prioridade: 2, numero: true, largura: '140px', celula: (l) => dataHoraCurta(l.criado_em, fuso) },
    { id: 'fotos', titulo: 'Fotos', prioridade: 2, numero: true, largura: '88px', celula: (l) => (l.total === null ? '—' : l.total.toLocaleString('pt-BR')) },
    { id: 'ligadas', titulo: 'Ligadas', numero: true, largura: '88px', celula: (l) => l.totais.ligado.toLocaleString('pt-BR') },
    { id: 'situacao', titulo: 'Situação', largura: '150px', celula: (l) => <SeloSituacao selos={[seloDoLote(faseDoLote(l, false))]} /> },
  ];

  return (
    <div className="flex w-full max-w-[1062px] flex-col gap-5" data-testid="fotos-lote.tela">
      <PageHeader title="Fotos em lote" />
      {aviso && <Notice tone="danger">{aviso}</Notice>}
      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}

      <div
        data-testid="fotos-lote.area-envio"
        onDragOver={(e) => {
          e.preventDefault();
          if (!cheio) setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={soltar}
        className={`flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-2xl px-6 py-8 text-center ${arrastando ? 'border-2 border-accent bg-accent-soft' : 'border border-dashed border-field bg-surface'}`}>
        <span className="text-[15px] font-semibold text-ink-2">{cheio ? TEXTO_LOTES_ATIVOS : arrastando ? 'Solte o ZIP aqui' : 'Arraste o ZIP aqui ou'}</span>
        <input ref={seletor} type="file" accept=".zip,application/zip" className="hidden" tabIndex={-1} data-testid="fotos-lote.arquivo" onChange={(e) => { escolher(e.target.files?.[0]); e.target.value = ''; }} />
        <Button variant="primary" disabled={cheio || criar.isPending} aria-describedby={limites ? 'fotos-lote.como fotos-lote.limites' : 'fotos-lote.como'} onClick={() => seletor.current?.click()} data-testid="fotos-lote.escolher">
          {criar.isPending ? 'Enviando…' : 'Escolher ZIP'}
        </Button>
        <span id="fotos-lote.como" className="text-[13px] text-ink-2">Nome da foto = código ou EAN do produto. A1.jpg é a 1ª foto; A1_2.jpg, a 2ª.</span>
        {limites && (
          <span id="fotos-lote.limites" className="text-[12px] text-ink-2 tabular-nums" data-testid="fotos-lote.limites">
            {textoLimitesLote(limites)}
          </span>
        )}
      </div>

      {lista.isPending && <LoadingBlock label="Carregando os lotes…" />}
      {lotes.length > 0 && (
        <Panel title="Lotes recentes">
          <TabelaDados
            rotulo="Lotes recentes"
            testId="fotos-lote.recentes"
            linhas={lotes}
            chave={(l) => l.id}
            colunas={colunas}
            aoAbrir={(l) => ir({ lote: l.id, cartao: null, repetido: false })}
            acoes={(l) => [{ id: 'csv', rotulo: 'Baixar CSV', desligada: l.situacao !== 'concluido', aoEscolher: () => void baixarRelatorio(l.id), testId: `fotos-lote.csv.${l.id}` }]}
          />
        </Panel>
      )}
    </div>
  );
}

// ---------- /catalogo/fotos-lote?lote=<id> ----------
type EstadoEnvio = { tipo: 'parado' } | { tipo: 'enviando'; bytes: number } | { tipo: 'erro'; recomecarEm: number | null; partes: number[] | null };

async function enviarParteHttp(arquivoId: string, arquivo: File, f: FatiaDoEnvio, sinal: AbortSignal): Promise<void> {
  const url = buildUrl(`/arquivos/${arquivoId}/partes/${f.n}`, undefined, baseDaChamada('PUT'));
  const mandar = (token: string | null) =>
    fetch(url, { method: 'PUT', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/octet-stream' }, body: arquivo.slice(f.inicio, f.fim), signal: sinal, cache: 'no-store' });
  let res = await mandar(getToken());
  if (res.status === 401) {
    const novo = await renovarAcesso();
    if (novo) res = await mandar(novo);
  }
  if (!res.ok) throw new Error(`parte ${f.n}: ${res.status}`);
}

function PaginaDoLote({ id }: { id: string }) {
  const [tela, ir] = useTela();
  const fuso = useFuso();
  const qc = useQueryClient();
  const [envio, setEnvio] = useState<EstadoEnvio>({ tipo: 'parado' });
  const [confirmaCancelar, setConfirmaCancelar] = useState(false);
  const controle = useRef<AbortController | null>(null);
  const iniciou = useRef(false);
  const daAba = envioDaAba?.loteId === id ? envioDaAba : null;
  const enviando = envio.tipo === 'enviando';

  const { limites } = useLimites();
  const consulta = useQuery({
    queryKey: ['catalogo', 'fotos-lote', id],
    queryFn: async () => FotoLoteSchema.parse(await api<unknown>(`${BASE}/${id}`)),
    // timer-permitido: progresso do lote no BKO (RN-CAT-14), a cada 2 s só enquanto o lote anda; não sincroniza
    refetchInterval: (q) => (q.state.data && consultaViva(faseDoLote(q.state.data, false)) ? INTERVALO_CONSULTA_MS : false),
  });
  const lote = consulta.data;
  const fase: FaseLote | null = lote ? faseDoLote(lote, enviando || (!!daAba && envio.tipo === 'erro')) : null;

  const rodarEnvio = useCallback(
    async (partes: number[] | null) => {
      if (!daAba) return;
      controle.current = new AbortController();
      const total = daAba.arquivo.size;
      setEnvio({ tipo: 'enviando', bytes: 0 });
      const r = await enviarPartes({
        tamanho: total,
        ...(partes ? { partes } : {}),
        sinal: controle.current.signal,
        enviarParte: (f) => enviarParteHttp(daAba.arquivoId, daAba.arquivo, f, controle.current!.signal),
        aoProgredir: (bytes) => setEnvio({ tipo: 'enviando', bytes }),
      });
      if (!r.ok) {
        if ('cancelado' in r) return;
        setEnvio({ tipo: 'erro', recomecarEm: r.recomecarEm, partes: null });
        return;
      }
      try {
        await api(`/arquivos/${daAba.arquivoId}/concluir`, { method: 'POST', body: { partes: partesDoEnvio(total), tamanho_bytes: total } });
        await api(`${BASE}/${id}/enfileirar`, { method: 'POST' });
        envioDaAba = null;
        setEnvio({ tipo: 'parado' });
        void qc.invalidateQueries({ queryKey: ['catalogo', 'fotos-lote'] });
      } catch (e) {
        const faltando = e instanceof ApiRequestError && Array.isArray(e.details?.partes_faltando) ? (e.details.partes_faltando as number[]) : null;
        setEnvio({ tipo: 'erro', recomecarEm: faltando ? null : 1, partes: faltando });
      }
    },
    [daAba, id, qc],
  );

  // começa o envio assim que a página do lote abre com o arquivo desta aba
  useEffect(() => {
    if (iniciou.current || !daAba || !lote || lote.situacao !== 'aguardando_envio') return;
    iniciou.current = true;
    void rodarEnvio(null);
  }, [daAba, lote, rodarEnvio]);

  // fechar ou recarregar a aba durante o envio pede confirmação do navegador
  useEffect(() => {
    if (!enviando) return;
    const antes = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', antes);
    return () => window.removeEventListener('beforeunload', antes);
  }, [enviando]);

  // ZIP já enviado antes: troca para o lote existente (spec §3.6)
  useEffect(() => {
    if (lote?.situacao === 'duplicado' && lote.duplicado_de) ir({ lote: lote.duplicado_de, cartao: null, repetido: true }, 'replace');
  }, [lote, ir]);

  const tentarDeNovo = () => {
    if (envio.tipo !== 'erro') return;
    void rodarEnvio(envio.partes ?? (envio.recomecarEm ? Array.from({ length: partesDoEnvio(daAba?.arquivo.size ?? 0) - envio.recomecarEm + 1 }, (_v, i) => envio.recomecarEm! + i) : null));
  };
  const cancelar = () => {
    controle.current?.abort();
    envioDaAba = null;
    setConfirmaCancelar(false);
    setEnvio({ tipo: 'parado' });
    ir({ lote: null, cartao: null, repetido: false });
  };

  if (consulta.isPending) return <LoadingBlock label="Carregando o lote…" />;
  if (consulta.isError || !lote || !fase) return <ErrorBlock message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />;
  if (lote.situacao === 'duplicado') return <LoadingBlock label="Abrindo o lote enviado antes…" />;

  const acoes = acoesDoCabecalho(fase);
  const aviso =
    envio.tipo === 'erro' ? (
      <ErrorBlock message={TEXTO_ENVIO_PAROU} onRetry={tentarDeNovo} />
    ) : fase === 'recusado' ? (
      <Notice tone="danger">{lote.motivo ? mensagemMotivoLote(lote.motivo, limites ?? {}) : ROTULO_MOTIVO_LOTE.zip_invalido}</Notice>
    ) : tela.repetido ? (
      <Notice tone="info">{avisoLoteRepetido(lote.criado_em, fuso)}</Notice>
    ) : null;

  return (
    <div className="flex w-full max-w-[1062px] flex-col gap-5" data-testid="fotos-lote.lote">
      <PageHeader
        eyebrow={
          <button type="button" className="rounded-sm font-semibold text-accent-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onClick={() => ir({ lote: null, cartao: null, repetido: false })} data-testid="fotos-lote.voltar">
            ‹ Fotos em lote
          </button>
        }
        title={lote.nome_arquivo}
        badge={<SeloSituacao selos={[seloDoLote(fase)]} />}
        actions={
          <>
            {acoes.cancelarEnvio && (
              <Button onClick={() => setConfirmaCancelar(true)} data-testid="fotos-lote.cancelar">
                Cancelar envio
              </Button>
            )}
            {acoes.baixarCsv && <BotaoBaixarCsv id={lote.id} />}
            {acoes.enviarOutro && (
              <Button variant="primary" onClick={() => ir({ lote: null, cartao: null, repetido: false })} data-testid="fotos-lote.enviar-outro">
                Enviar outro ZIP
              </Button>
            )}
          </>
        }
      />
      {aviso}
      <Andamento lote={lote} fase={fase} envio={envio} tamanho={daAba?.arquivo.size ?? lote.tamanho_bytes} />
      {mostraRelatorio(fase, lote.total) && <Relatorio lote={lote} />}
      {fase === 'concluido' && (lote.total ?? 0) === 0 && <EstadoVazio testId="fotos-lote.sem-fotos" titulo="Nenhuma foto no ZIP." />}

      <Dialog
        open={confirmaCancelar}
        title="Cancelar o envio?"
        onClose={() => setConfirmaCancelar(false)}
        footer={
          <>
            <Button onClick={() => setConfirmaCancelar(false)}>Continuar enviando</Button>
            <Button variant="danger" onClick={cancelar} data-testid="fotos-lote.cancelar.confirmar">
              Cancelar envio
            </Button>
          </>
        }>
        {null}
      </Dialog>
    </div>
  );
}

function Andamento({ lote, fase, envio, tamanho }: { lote: FotoLote; fase: FaseLote; envio: EstadoEnvio; tamanho: number }) {
  if (envio.tipo === 'enviando') {
    const p = progressoDoEnvio(envio.bytes, tamanho);
    return (
      <Panel>
        <Progresso rotulo="Enviando" valor={p.valor} maximo={p.maximo} textoValor={p.texto} mostrarRotulo="valor" testid="fotos-lote.progresso-envio" />
        <span className="text-[13px] text-ink-2">Mantenha esta aba aberta até o envio terminar.</span>
      </Panel>
    );
  }
  if (fase === 'processando') {
    const p = progressoDoProcessamento(lote);
    return (
      <Panel>
        <Progresso rotulo="Processando" valor={p.valor} maximo={p.maximo} textoValor={p.texto} mostrarRotulo="valor" testid="fotos-lote.progresso" />
      </Panel>
    );
  }
  return null;
}

function Relatorio({ lote }: { lote: FotoLote }) {
  const { limites } = useLimites();
  const [tela, ir] = useTela();
  const cartao = tela.cartao;
  const [paginas, setPaginas] = useState<FotoLoteItem[]>([]);
  const [proximo, setProximo] = useState<number | null>(null);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const processando = lote.situacao === 'processando';
  const ordem = `${lote.totais.ligado}.${lote.totais.sem_produto}.${lote.totais.ambiguo}.${lote.totais.recusado}.${lote.totais.repetido}`;

  const itens = useQuery({
    queryKey: ['catalogo', 'fotos-lote', lote.id, 'itens', cartao, processando ? ordem : lote.situacao],
    queryFn: () => buscarItens(lote.id, cartao),
  });
  useEffect(() => {
    if (itens.data) {
      setPaginas(itens.data.itens);
      setProximo(itens.data.proximo);
    }
  }, [itens.data]);

  const maisItens = async () => {
    if (proximo === null) return;
    setCarregandoMais(true);
    try {
      const r = await buscarItens(lote.id, cartao, proximo);
      setPaginas((atual) => [...atual, ...r.itens]);
      setProximo(r.proximo);
    } finally {
      setCarregandoMais(false);
    }
  };

  const colunas: ColunaDaTabela<FotoLoteItem>[] = [
    { id: 'arquivo', titulo: 'Arquivo', largura: '30%', celula: (i) => i.arquivo, texto: (i) => i.arquivo },
    { id: 'situacao', titulo: 'Situação', largura: '130px', celula: (i) => <SeloSituacao selos={[seloDoItem(i.situacao)]} /> },
    { id: 'produto', titulo: 'Produto', prioridade: 2, largura: '22%', celula: (i) => (i.situacao === 'ligado' || i.situacao === 'repetido' ? (i.produto_codigo ?? '—') : '—'), texto: (i) => i.produto_codigo ?? '' },
    { id: 'ordem', titulo: 'Ordem', prioridade: 2, numero: true, largura: '72px', celula: (i) => (i.situacao === 'ligado' || i.situacao === 'repetido' ? (i.ordem ?? '—') : '—') },
    { id: 'motivo', titulo: 'Motivo', celula: (i) => textoMotivoItem(i, limites ?? {}), texto: (i) => textoMotivoItem(i, limites ?? {}) },
  ];
  const marcar = (c: CartaoFoto | null) => ir({ cartao: c }, 'replace');

  return (
    <>
      <KpiGrid min={200}>
        {cartoesVisiveis(lote.totais).map((c) => {
          const valor = valorDoCartao(c, lote.totais);
          const marcado = cartao === c;
          return (
            <KpiCard
              key={c}
              label={ROTULO_CARTAO[c]}
              value={valor.toLocaleString('pt-BR')}
              valueClass={corDoCartao(c, valor)}
              selecionado={marcado}
              onClick={() => marcar(marcado ? null : c)}
              testid={`fotos-lote.cartao.${c}`}
            />
          );
        })}
      </KpiGrid>
      {cartao && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => marcar(null)} data-testid="fotos-lote.limpar-filtro">
            Limpar filtro
          </Button>
        </div>
      )}
      {itens.isError && <ErrorBlock message={errorMessage(itens.error)} onRetry={() => void itens.refetch()} />}
      {itens.isPending && <LoadingBlock label="Carregando as fotos…" />}
      {itens.data && (
        <>
          <TabelaDados
            rotulo="Fotos do lote"
            testId="fotos-lote.itens"
            linhas={paginas}
            chave={(i) => String(i.indice)}
            colunas={colunas}
            vazio={<EstadoVazio testId="fotos-lote.vazio" titulo="Nenhuma foto com esse filtro." />}
          />
          {proximo !== null && (
            <div className="flex justify-center">
              <Button disabled={carregandoMais} onClick={() => void maisItens()} data-testid="fotos-lote.mais">
                {carregandoMais ? 'Carregando…' : 'Mostrar mais'}
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}

