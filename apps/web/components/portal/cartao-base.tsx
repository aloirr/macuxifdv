'use client';

/**
 * Cartão de uma base no portal (T-0087 §3; desenho §5.2): "Baixar modelo (.csv)" e "Dicionário de campos" logo abaixo do
 * título, arquivo + modo (delta ou completo), "Conferir sem gravar" (erros por linha antes de gravar), "Importar" (acima de
 * 5.000 linhas em partes da mesma sessão, com barra de progresso), status do lote, erros por linha e "Baixar erros (.csv)".
 * O texto do arquivo fica só na memória desta tela e sai dela depois do envio (LGPD, T-0087 §7). testIDs: base-<entidade>.*.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ErrosLoteResposta, type ConferenciaArquivo, type Entidade, type ItemOrdemCarga, type LinhaErro, type ModoCarga } from '@macuxi/integracao/contracts';
import { Badge, Bar, Button, Dialog, ErrorBlock, IconDownload, Notice, useToast } from '@macuxi/ui/web';

import { baixarDoPortal, chamarPortal, ehRotaAusente, mensagemDoErro } from '@/lib/portal-api';
import { baixarTexto, CARTAO_DA_ENTIDADE, conferirArquivo, errosDaConferenciaCsv, formatarLinhas, importarArquivo, novaChaveDeCarga, planejarEnvio, ROTULO_MODO, ROTULO_STATUS_LOTE, type PlanoDeEnvio, type ProgressoCarga, type ResultadoCarga } from '@/lib/portal-carga';
import { criarPortaCarga } from '@/lib/portal-carga-rede';
import { ROTAS_PORTAL } from '@/lib/portal-rotas';

type Plano = Extract<PlanoDeEnvio, { ok: true }>;

/**
 * Linhas com erro no modo completo (RN-INT-06; confirmado pelo modulo-integracao em R-20261106-030101): a linha com erro conta
 * como vista e o registro dela nunca é inativado; linha com erro sem código (`external_id`) bloqueia toda a inativação da carga.
 */
export const TEXTO_COMPLETO_COM_ERROS =
  'O registro de uma linha com erro continua como está, sem ser inativado. Se alguma linha com erro vier sem código, nada é inativado nesta carga.';

/** "produtos.csv, 20.000 linhas em 4 partes" (diálogo do modo completo; R-20261106-023316 🟡 7). */
export function resumoDoArquivo(nome: string | null, totalLinhas: number, partes: number): string {
  const linhas = `${formatarLinhas(totalLinhas)}${partes > 1 ? ` em ${partes} partes` : ''}`;
  return nome ? `${nome}, ${linhas}` : linhas;
}

/** "Baixar modelo" e "Dicionário": rota da N1 (nuvem); 404 = ainda não chegou ao servidor. */
function LinksDoModelo({ entidade, tenant }: { entidade: Entidade; tenant: string }) {
  const toast = useToast();
  const [emBreve, setEmBreve] = useState(false);
  const baixar = async (caminho: string, nome: string) => {
    try {
      await baixarDoPortal(caminho, { tenant, nomePadrao: nome });
    } catch (x) {
      if (ehRotaAusente(x)) setEmBreve(true);
      else toast('danger', mensagemDoErro(x));
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
      <Button variant="link" data-testid={`base-${entidade}.modelo`} onClick={() => void baixar(ROTAS_PORTAL.modeloCsv(entidade), `modelo-${entidade}.csv`)}>
        <IconDownload size={14} /> Baixar modelo (.csv)
      </Button>
      <Button variant="link" data-testid={`base-${entidade}.dicionario`} onClick={() => void baixar(ROTAS_PORTAL.dicionario(entidade), `dicionario-${entidade}.json`)}>
        Dicionário de campos
      </Button>
      {emBreve && <span className="text-[12px] text-ink-2">Modelos e dicionário chegam em breve neste servidor.</span>}
    </div>
  );
}

function ListaErros({ erros, omitidos, testId }: { erros: readonly LinhaErro[]; omitidos?: number; testId: string }) {
  if (erros.length === 0) return null;
  return (
    <div data-testid={testId} className="flex flex-col gap-1">
      <ul className="m-0 max-h-[240px] list-none overflow-auto rounded-lg border border-line-2 bg-ground p-0 text-[13px]">
        {erros.map((e, i) => (
          <li key={`${e.indice}-${e.codigo}-${i}`} className="border-b border-line-2 px-3 py-1.5 last:border-b-0">
            {e.mensagem}
            {e.external_id && <span className="ml-1 font-mono text-[12px] text-ink-2">({e.external_id})</span>}
          </li>
        ))}
      </ul>
      {!!omitidos && omitidos > 0 && <span className="text-[12px] text-ink-2">E mais {omitidos.toLocaleString('pt-BR')} erros. Corrija estes e confira de novo.</span>}
    </div>
  );
}

function ErrosDoLote({ tenant, loteId, entidade }: { tenant: string; loteId: string; entidade: Entidade }) {
  const toast = useToast();
  const q = useQuery({ queryKey: ['portal', tenant, 'lote-erros', loteId], queryFn: () => chamarPortal(ROTAS_PORTAL.errosLote(loteId), { tenant, query: { por_pagina: 100 }, schema: ErrosLoteResposta }) });
  const baixar = async () => {
    try {
      await baixarDoPortal(ROTAS_PORTAL.errosLoteCsv(loteId), { tenant, nomePadrao: `erros-${loteId}.csv` });
    } catch (x) {
      toast('danger', ehRotaAusente(x) ? '"Baixar erros" chega em breve neste servidor.' : mensagemDoErro(x));
    }
  };
  if (q.isPending) return null;
  // erro ao buscar a lista: o cartão diz "Concluído com erros", então a falha aparece com "Tentar de novo" (🟡 11)
  if (q.isError) return <ErrorBlock message={ehRotaAusente(q.error) ? 'A lista de erros deste lote ainda não está disponível neste servidor.' : mensagemDoErro(q.error)} onRetry={() => void q.refetch()} />;
  if (q.data.total === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-semibold">{q.data.total.toLocaleString('pt-BR')} linhas com erro</span>
        <Button size="sm" data-testid={`base-${entidade}.baixar-erros`} onClick={() => void baixar()}>
          <IconDownload size={14} /> Baixar erros (.csv)
        </Button>
      </div>
      <ListaErros erros={q.data.itens} omitidos={Math.max(0, q.data.total - q.data.itens.length)} testId={`base-${entidade}.erros-lote`} />
    </div>
  );
}

export function CartaoBase({ item, tenant, rotuloDepende }: { item: ItemOrdemCarga; tenant: string; rotuloDepende: string | null }) {
  const { entidade } = item;
  const cartao = CARTAO_DA_ENTIDADE[entidade];
  const porta = useMemo(() => criarPortaCarga(tenant), [tenant]);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null);
  const [plano, setPlano] = useState<Plano | null>(null);
  const [modo, setModo] = useState<ModoCarga>('delta');
  const [erro, setErro] = useState<string | null>(null);
  const [conferencia, setConferencia] = useState<ConferenciaArquivo | null>(null);
  const [progresso, setProgresso] = useState<ProgressoCarga | null>(null);
  const [resultado, setResultado] = useState<ResultadoCarga | null>(null);
  const [ocupado, setOcupado] = useState<'lendo' | 'conferindo' | 'importando' | null>(null);
  const [confirmarCompleto, setConfirmarCompleto] = useState(false);

  // Fechar ou recarregar a aba no meio do envio das partes interrompe a carga: o navegador pede confirmação.
  useEffect(() => {
    if (ocupado !== 'importando') return;
    const segurar = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', segurar);
    return () => window.removeEventListener('beforeunload', segurar);
  }, [ocupado]);
  // RN-INT-12: a mesma chave (e sessão) enquanto o arquivo e o modo não mudam: repetir "Importar" depois de uma falha continua a
  // mesma carga (as partes já aceitas voltam como repetidas) em vez de abrir outra
  const envioRef = useRef<{ chave: string; sessaoId: string } | null>(null);
  const novoEnvio = () => {
    envioRef.current = { chave: novaChaveDeCarga(), sessaoId: crypto.randomUUID() };
  };

  const escolher = async (f: File | undefined) => {
    setErro(null);
    setConferencia(null);
    setResultado(null);
    setProgresso(null);
    setPlano(null);
    setNomeArquivo(f?.name ?? null);
    if (!f) return;
    setOcupado('lendo');
    try {
      const p = planejarEnvio(await f.text());
      if (p.ok) {
        setPlano(p);
        novoEnvio();
      } else setErro(p.mensagem);
    } catch {
      setErro('Não deu para ler o arquivo. Salve como CSV (UTF-8) e escolha de novo.');
    } finally {
      setOcupado(null);
    }
  };

  const limparArquivo = () => {
    setPlano(null);
    setNomeArquivo(null);
    if (arquivoRef.current) arquivoRef.current.value = '';
  };

  const conferir = async () => {
    if (!plano || ocupado) return;
    setOcupado('conferindo');
    setErro(null);
    setResultado(null);
    try {
      setConferencia(await conferirArquivo(porta, { entidade, modo, plano }));
    } catch (x) {
      setErro(ehRotaAusente(x) ? '"Conferir sem gravar" chega em breve neste servidor.' : mensagemDoErro(x));
    } finally {
      setOcupado(null);
    }
  };

  const importar = async () => {
    if (!plano || ocupado) return;
    setConfirmarCompleto(false);
    setOcupado('importando');
    setErro(null);
    setResultado(null);
    if (!envioRef.current) novoEnvio();
    const envio = envioRef.current as { chave: string; sessaoId: string };
    try {
      const r = await importarArquivo(porta, { entidade, modo, plano, chave: envio.chave, sessaoId: envio.sessaoId, aoProgredir: setProgresso });
      envioRef.current = null;
      setResultado(r);
      setConferencia(null);
      limparArquivo();
    } catch (x) {
      setErro(mensagemDoErro(x));
    } finally {
      setOcupado(null);
    }
  };

  const statusFinal = resultado?.progressoSessao
    ? resultado.progressoSessao.partes_com_falha > 0
      ? 'falhou'
      : resultado.progressoSessao.erros_total > 0
        ? 'concluido_com_erros'
        : resultado.progressoSessao.situacao === 'completa' || resultado.progressoSessao.partes_aplicadas === resultado.progressoSessao.total_partes
          ? 'concluido'
          : 'processando'
    : (resultado?.status ?? null);

  return (
    <section data-testid={`base-${entidade}`} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-[12px] font-bold text-white tabular-nums">{item.posicao}</span>
            <h3 className="m-0 text-[17px] font-bold">{cartao.titulo}</h3>
            {item.opcional && <Badge tone="neutral">opcional</Badge>}
            {statusFinal && <Badge tone={statusFinal === 'concluido' ? 'success' : statusFinal === 'falhou' ? 'danger' : statusFinal === 'concluido_com_erros' ? 'warning' : 'pending'}>{ROTULO_STATUS_LOTE[statusFinal]}</Badge>}
          </div>
          <span className="text-[13px] text-ink-2">{cartao.descricao}</span>
          {rotuloDepende && <span className="text-[12px] text-ink-2">Carregue depois de: {rotuloDepende}.</span>}
        </div>
      </div>
      <LinksDoModelo entidade={entidade} tenant={tenant} />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[240px] flex-1 flex-col gap-1">
          <span className="text-[13px] font-semibold">Arquivo CSV</span>
          <input
            ref={arquivoRef}
            type="file"
            accept=".csv,text/csv"
            data-testid={`base-${entidade}.arquivo`}
            disabled={ocupado === 'importando'}
            onChange={(e) => void escolher(e.target.files?.[0])}
            className="text-[13px] file:mr-3 file:h-9 file:rounded-[10px] file:border file:border-field file:bg-surface file:px-3 file:font-semibold file:text-ink"
          />
        </label>
        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
          <legend className="mb-1 text-[13px] font-semibold">Modo</legend>
          <div className="flex gap-3">
            {(['delta', 'completo'] as const).map((m) => (
              <label key={m} className="flex items-center gap-1.5 text-[15px]" title={ROTULO_MODO[m].ajuda}>
                <input type="radio" name={`modo-${entidade}`} data-testid={`base-${entidade}.modo-${m}`} className="accent-accent" checked={modo === m} disabled={ocupado === 'importando'} onChange={() => {
                    setModo(m);
                    setConferencia(null);
                    novoEnvio();
                  }} />
                {ROTULO_MODO[m].titulo}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <span className="text-[12px] text-ink-2">{ROTULO_MODO[modo].ajuda}</span>

      {ocupado === 'lendo' && <span className="text-[13px] text-ink-2">Lendo o arquivo…</span>}
      {plano && nomeArquivo && (
        <span data-testid={`base-${entidade}.resumo-arquivo`} className="text-[13px] text-ink-2">
          {nomeArquivo}: {formatarLinhas(plano.totalLinhas)}
          {plano.partes.length > 1 && ` em ${plano.partes.length} partes (até 5.000 linhas cada, na mesma sessão)`}.
        </span>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" data-testid={`base-${entidade}.conferir`} disabled={!plano || ocupado !== null} onClick={() => void conferir()}>
          {ocupado === 'conferindo' ? 'Conferindo…' : 'Conferir sem gravar'}
        </Button>
        <Button size="sm" variant="primary" data-testid={`base-${entidade}.importar`} disabled={!plano || ocupado !== null} onClick={() => (modo === 'completo' ? setConfirmarCompleto(true) : void importar())}>
          {ocupado === 'importando' ? 'Importando…' : 'Importar CSV'}
        </Button>
      </div>

      {erro && (
        <div data-testid={`base-${entidade}.erro`}>
          <Notice tone="danger">{erro}</Notice>
        </div>
      )}

      {conferencia && (
        <div data-testid={`base-${entidade}.conferencia`} className="flex flex-col gap-2">
          <Notice tone={conferencia.pode_gravar ? 'success' : 'warning'}>
            {conferencia.pode_gravar
              ? `Conferido, nada gravado: ${formatarLinhas(conferencia.linhas_lidas)} sem erro de formato. As referências entre bases são conferidas ao gravar.`
              : `Conferido, nada gravado: ${formatarLinhas(conferencia.linhas_com_erro)} com erro de ${formatarLinhas(conferencia.linhas_lidas)}. Corrija o arquivo e confira de novo, ou importe assim: as linhas com erro ficam de fora.${modo === 'completo' ? ` ${TEXTO_COMPLETO_COM_ERROS}` : ''}`}
          </Notice>
          {conferencia.erros.length > 0 && (
            <div>
              <Button size="sm" data-testid={`base-${entidade}.baixar-erros-conferencia`} onClick={() => baixarTexto(errosDaConferenciaCsv(conferencia.erros), `erros-conferencia-${entidade}.csv`, 'text/csv;charset=utf-8')}>
                <IconDownload size={14} /> Baixar erros (.csv)
              </Button>
            </div>
          )}
          <ListaErros erros={conferencia.erros} omitidos={conferencia.erros_omitidos} testId={`base-${entidade}.erros-conferencia`} />
        </div>
      )}

      {progresso && (ocupado === 'importando' || (resultado && !resultado.terminou)) && (
        <div data-testid={`base-${entidade}.progresso`} className="flex flex-col gap-1" aria-live="polite">
          <div className="flex items-center gap-3">
            <Bar pct={progresso.percentual} colorClass="bg-accent" />
            <span className="w-10 text-right text-[13px] font-semibold tabular-nums">{progresso.percentual}%</span>
          </div>
          <span className="text-[12px] text-ink-2">
            {progresso.fase === 'enviando'
              ? progresso.totalPartes > 1
                ? `Enviando a parte ${Math.min(progresso.enviadas + 1, progresso.totalPartes)} de ${progresso.totalPartes}…`
                : 'Enviando o arquivo…'
              : progresso.totalPartes > 1
                ? `Gravando: ${progresso.aplicadas} de ${progresso.totalPartes} partes aplicadas.`
                : 'Gravando no Hub…'}
          </span>
        </div>
      )}

      {resultado && (
        <div data-testid={`base-${entidade}.resultado`} className="flex flex-col gap-2">
          {!resultado.terminou && <Notice tone="info">O Hub continua gravando este arquivo. Volte a esta página daqui a pouco para ver o resultado.</Notice>}
          {resultado.repetido && <Notice tone="info">Este arquivo já tinha sido enviado com a mesma chave: nada foi gravado de novo.</Notice>}
          {resultado.progressoSessao?.inativacao?.situacao === 'aguardando_confirmacao' && (
            <Notice tone="warning">A carga completa inativaria muitos registros e ficou aguardando confirmação no monitor da Integração (BKO).</Notice>
          )}
          {resultado.progressoSessao?.aviso && <Notice tone="warning">{resultado.progressoSessao.aviso.mensagem}</Notice>}
          {resultado.progressoSessao && (
            <span className="text-[13px] text-ink-2">
              {resultado.progressoSessao.contagens.novas.toLocaleString('pt-BR')} novas · {resultado.progressoSessao.contagens.atualizadas.toLocaleString('pt-BR')} atualizadas ·{' '}
              {resultado.progressoSessao.contagens.inalteradas.toLocaleString('pt-BR')} sem mudança · {resultado.progressoSessao.contagens.com_erro.toLocaleString('pt-BR')} com erro
            </span>
          )}
          {resultado.terminou && resultado.lotes.map((id) => <ErrosDoLote key={id} tenant={tenant} loteId={id} entidade={entidade} />)}
        </div>
      )}

      <Dialog
        open={confirmarCompleto}
        title="Importar como carga completa?"
        onClose={() => setConfirmarCompleto(false)}
        footer={
          <>
            <Button onClick={() => setConfirmarCompleto(false)}>Cancelar</Button>
            <Button variant="danger" data-testid={`base-${entidade}.confirmar-completo`} onClick={() => void importar()}>
              Importar completo
            </Button>
          </>
        }
      >
        {plano && <strong className="mb-1 block">{resumoDoArquivo(nomeArquivo, plano.totalLinhas, plano.partes.length)}.</strong>}
        O arquivo vira a lista inteira de {cartao.titulo.toLowerCase()}: o que já existe e não vier nele será inativado no fim da última parte.
        {conferencia && conferencia.linhas_com_erro > 0 && ` A conferência achou ${formatarLinhas(conferencia.linhas_com_erro)} com erro. ${TEXTO_COMPLETO_COM_ERROS}`}
      </Dialog>
    </section>
  );
}
