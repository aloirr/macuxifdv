'use client';

/**
 * T-0158 (ADR 0043): Portal › Diagnósticos, igual à imagem aprovada `docs/design/telas/T-0158-diagnosticos-portal.png`
 * (R-20261110-192152). Só o time da Macuxi (super-admin): o admin do cliente não vê o item no cabeçalho e, no endereço direto,
 * recebe "Esta área é só do time Macuxi." com o link para a empresa dele (a API também responde 403).
 * - Lista (`GET /v1/plataforma/diagnosticos`): 50 por vez, do mais novo ao mais antigo; filtros no endereço (versão, aparelho,
 *   empresa, motivo, origem e período; padrão últimos 7 dias); a linha inteira abre o detalhe.
 * - Detalhe (`GET /v1/plataforma/diagnosticos/:id`): à esquerda o relato, as 5 últimas saídas do Android e o último erro do app;
 *   à direita a origem, o print (`/print`, como Blob, sem URL pré-assinada) e o recado automático.
 * Regras e textos em `lib/portal-diagnosticos.ts`. testIDs: diagnosticos.*.
 */
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { DiagnosticoDetalheSchema, DiagnosticoListaSchema, ORIGENS_DIAGNOSTICO, type DiagnosticoDetalhe } from '@macuxi/platform-sdk';
import { Badge, Button, CLASSE_CAMPO_BASE, cx, ErrorBlock, LoadingBlock, PageHeader, Panel, rotuloDoPerfil, SelectField, TableScroll, td, th } from '@macuxi/ui/web';

import { blobDoPortal, chamarPortal, mensagemDoErro } from '@/lib/portal-api';
import {
  appEVersao,
  caminhoDoDiagnostico,
  CAMINHO_DIAGNOSTICOS,
  dataDaLista,
  dataDoDetalhe,
  dataTecnica,
  enderecoDosFiltros,
  FILTROS_VAZIOS,
  filtroDaApi,
  filtrosComPeriodo,
  filtrosDoEndereco,
  idCurto,
  linhaDoCabecalho,
  linhasDaSaida,
  linkDoRecado,
  MOTIVOS_DO_FILTRO,
  mostrarOcorrido,
  numeroDoDiagnostico,
  periodoDosFiltros,
  PERIODOS,
  pilhaCurta,
  queryDoFiltro,
  ROTULO_ORIGEM,
  rotuloDoMotivo,
  saidasDoDetalhe,
  situacaoDoRecado,
  temFiltro,
  textoDaFila,
  textoDasSaidas,
  textoDoErro,
  TEXTOS_PORTAL_DIAGNOSTICOS as T,
  type FiltrosDaTela,
} from '@/lib/portal-diagnosticos';
import { ROTAS_PORTAL } from '@/lib/portal-rotas';
import { destinoDaSessao, ehTimeMacuxi } from '@/lib/portal-sessao';
import { LinkBotao, MolduraPortal, useSessaoPortal } from './base';
import { useEmpresas } from './tela-empresas';

/** Só o time Macuxi: `null` = ainda lendo a sessão; `false` = admin do cliente (mostra o "sem acesso"). */
function useTimeMacuxi(): boolean | null {
  const sessao = useSessaoPortal();
  if (sessao === undefined || sessao === null) return null;
  return ehTimeMacuxi(sessao);
}

function SemAcesso() {
  const sessao = useSessaoPortal();
  return (
    <Panel>
      <div data-testid="diagnosticos.sem-acesso" className="flex flex-col items-start gap-3 py-4">
        <span className="text-[15px] font-semibold">{T.semAcesso}</span>
        {sessao && (
          <LinkBotao href={destinoDaSessao(sessao)} primario>
            Ir para a sua empresa
          </LinkBotao>
        )}
      </div>
    </Panel>
  );
}

function OrigemBadge({ origem }: { origem: keyof typeof ROTULO_ORIGEM }) {
  const o = ROTULO_ORIGEM[origem];
  return <Badge tone={o.tom}>{o.rotulo}</Badge>;
}

// ---------------------------------------------------------------------------------------------------------------- lista

export function TelaDiagnosticos() {
  const pode = useTimeMacuxi();
  return (
    <MolduraPortal titulo={pode ? <PageHeader title={T.titulo} subtitle={T.subtitulo} /> : undefined}>
      {pode === null ? <LoadingBlock label={T.carregando} /> : pode ? <ListaDiagnosticos /> : <SemAcesso />}
    </MolduraPortal>
  );
}

function ListaDiagnosticos() {
  const router = useRouter();
  const busca = useSearchParams();
  const filtros = useMemo(() => filtrosDoEndereco(busca), [busca]);
  // o "agora" da tela: o período "últimos 7 dias" não muda enquanto a página está aberta
  const [agora] = useState(() => new Date());
  const filtro = useMemo(() => filtroDaApi(filtros, agora), [filtros, agora]);
  const q = useInfiniteQuery({
    queryKey: ['portal', 'diagnosticos', filtro],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      chamarPortal(ROTAS_PORTAL.diagnosticos, { query: queryDoFiltro(filtroDaApi(filtros, agora, pageParam)), schema: DiagnosticoListaSchema }),
    getNextPageParam: (ultima) => ultima.cursor,
  });
  const itens = useMemo(() => q.data?.pages.flatMap((p) => p.itens) ?? [], [q.data]);

  // versões vistas nesta página (não há rota de versões): o seletor oferece as que já apareceram, mais a do endereço
  const [versoes, setVersoes] = useState<string[]>([]);
  useEffect(() => {
    const novas = itens.map((i) => i.versao_app).filter((v) => !versoes.includes(v));
    if (novas.length) setVersoes((vs) => [...new Set([...vs, ...novas])].sort((a, b) => b.localeCompare(a, 'pt-BR', { numeric: true })));
  }, [itens, versoes]);

  const ir = (f: FiltrosDaTela) => router.replace(`${CAMINHO_DIAGNOSTICOS}${enderecoDosFiltros(f)}`, { scroll: false });

  return (
    <div className="flex flex-col gap-3">
      <Filtros filtros={filtros} versoes={versoes} agora={agora} ir={ir} />
      {q.isPending ? (
        <LoadingBlock label={T.carregando} />
      ) : q.isError ? (
        <ErrorBlock message={mensagemDoErro(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <span data-testid="diagnosticos.contagem" className="text-[13px] text-ink-2">
            {itens.length}
            {q.hasNextPage ? '+' : ''} {itens.length === 1 ? 'diagnóstico' : 'diagnósticos'}
          </span>
          {itens.length === 0 ? (
            <Panel>
              <div data-testid="diagnosticos.vazio" className="flex flex-col items-start gap-3 py-4">
                <span className="text-[15px] font-semibold">{temFiltro(filtros) ? T.vazioFiltro : T.vazio}</span>
                {temFiltro(filtros) && (
                  <Button size="sm" onClick={() => ir(FILTROS_VAZIOS)}>
                    {T.limpar}
                  </Button>
                )}
              </div>
            </Panel>
          ) : (
            <Panel>
              <TableScroll minWidth={980}>
                <table data-testid="diagnosticos.lista" className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr>
                      <th className={th}>Nº</th>
                      <th className={th}>Recebido</th>
                      <th className={th}>Empresa</th>
                      <th className={th}>App</th>
                      <th className={th}>Aparelho</th>
                      <th className={th}>Android</th>
                      <th className={th}>Origem</th>
                      <th className={th}>Motivo</th>
                      <th className={th}>Print</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itens.map((d) => {
                      const abrir = () => router.push(caminhoDoDiagnostico(d.id));
                      return (
                        <tr key={d.id} data-testid={`diagnosticos.linha-${d.protocolo}`} onClick={abrir} className="cursor-pointer hover:bg-accent-soft/40">
                          <td className={cx(td, 'font-bold tabular-nums')}>
                            <Link
                              href={caminhoDoDiagnostico(d.id)}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`Diagnóstico ${numeroDoDiagnostico(d.protocolo)}`}
                              className="text-ink no-underline hover:underline"
                            >
                              {numeroDoDiagnostico(d.protocolo).replace('nº ', '')}
                            </Link>
                          </td>
                          <td className={cx(td, 'tabular-nums whitespace-nowrap')}>{dataDaLista(d.recebido_em)}</td>
                          <td className={td}>{d.tenant_nome ?? idCurto(d.tenant_id)}</td>
                          <td className={cx(td, 'whitespace-nowrap')}>{appEVersao(d.app, d.versao_app)}</td>
                          <td className={td}>{d.aparelho_modelo ?? '—'}</td>
                          <td className={cx(td, 'tabular-nums')}>{d.android ?? '—'}</td>
                          <td className={td}>
                            <OrigemBadge origem={d.origem} />
                          </td>
                          <td className={td}>{d.origem === 'botao' ? '—' : rotuloDoMotivo(d.motivo)}</td>
                          <td className={td}>{d.tem_print ? 'Sim' : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableScroll>
              {q.hasNextPage && (
                <div className="flex justify-center pt-1">
                  <Button data-testid="diagnosticos.mais" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
                    {q.isFetchingNextPage ? 'Buscando…' : T.mais}
                  </Button>
                </div>
              )}
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

function Filtros({ filtros, versoes, agora, ir }: { filtros: FiltrosDaTela; versoes: string[]; agora: Date; ir: (f: FiltrosDaTela) => void }) {
  const empresas = useEmpresas();
  const [modelo, setModelo] = useState(filtros.modelo);
  useEffect(() => setModelo(filtros.modelo), [filtros.modelo]);
  const periodo = periodoDosFiltros(filtros, agora);
  const mudar = (k: keyof FiltrosDaTela) => (e: { target: { value: string } }) => ir({ ...filtros, [k]: e.target.value });
  const aplicarModelo = () => {
    if (modelo.trim() !== filtros.modelo) ir({ ...filtros, modelo: modelo.trim() });
  };
  const opcoesVersao = filtros.versao && !versoes.includes(filtros.versao) ? [filtros.versao, ...versoes] : versoes;

  return (
    <div data-testid="diagnosticos.filtros" className="flex flex-wrap items-end gap-2.5 rounded-2xl border border-line bg-surface p-3">
      <SelectField label="Versão" data-testid="diagnosticos.filtro-versao" value={filtros.versao} onChange={mudar('versao')}>
        <option value="">Todas</option>
        {opcoesVersao.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </SelectField>
      <label className="flex flex-col gap-[3px] text-[12px] font-semibold text-ink-2">
        Aparelho
        <input
          data-testid="diagnosticos.filtro-modelo"
          type="search"
          placeholder="Modelo"
          value={modelo}
          maxLength={80}
          onChange={(e) => setModelo(e.target.value)}
          onBlur={aplicarModelo}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') aplicarModelo();
          }}
          className={cx(CLASSE_CAMPO_BASE, 'h-[38px] w-[170px] px-2.5')}
        />
      </label>
      <SelectField label="Empresa" data-testid="diagnosticos.filtro-empresa" value={filtros.empresa} onChange={mudar('empresa')} className="min-w-[200px]">
        <option value="">Todas</option>
        {(empresas.data ?? []).map((e) => (
          <option key={e.id} value={e.id}>
            {e.razao_social}
          </option>
        ))}
      </SelectField>
      <SelectField label="Motivo" data-testid="diagnosticos.filtro-motivo" value={filtros.motivo} onChange={mudar('motivo')}>
        <option value="">Todos</option>
        {[...new Set([...MOTIVOS_DO_FILTRO, ...(filtros.motivo ? [filtros.motivo] : [])])].map((m) => (
          <option key={m} value={m}>
            {rotuloDoMotivo(m)}
          </option>
        ))}
      </SelectField>
      <SelectField label="Origem" data-testid="diagnosticos.filtro-origem" value={filtros.origem} onChange={mudar('origem')}>
        <option value="">Todas</option>
        {ORIGENS_DIAGNOSTICO.map((o) => (
          <option key={o} value={o}>
            {ROTULO_ORIGEM[o].rotulo}
          </option>
        ))}
      </SelectField>
      <SelectField label="Período" data-testid="diagnosticos.filtro-periodo" value={periodo} onChange={(e) => ir(filtrosComPeriodo(filtros, e.target.value, agora))}>
        {PERIODOS.map((p) => (
          <option key={p.valor} value={p.valor}>
            {p.rotulo}
          </option>
        ))}
        {periodo === 'personalizado' && (
          <option value="personalizado" disabled>
            {`${filtros.de || '…'} a ${filtros.ate || 'hoje'}`}
          </option>
        )}
      </SelectField>
      {temFiltro(filtros) && (
        <button
          type="button"
          data-testid="diagnosticos.limpar"
          onClick={() => ir(FILTROS_VAZIOS)}
          className="h-[38px] px-2 text-[13px] font-semibold text-accent-ink hover:underline focus-visible:outline-2 focus-visible:outline-accent"
        >
          {T.limpar}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------- detalhe

export function TelaDiagnostico({ id }: { id: string }) {
  const pode = useTimeMacuxi();
  return (
    <MolduraPortal>
      {pode === null ? <LoadingBlock label="Abrindo o diagnóstico…" /> : pode ? <DetalheDiagnostico id={id} /> : <SemAcesso />}
    </MolduraPortal>
  );
}

function DetalheDiagnostico({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ['portal', 'diagnostico', id],
    queryFn: () => chamarPortal(ROTAS_PORTAL.diagnostico(id), { schema: DiagnosticoDetalheSchema }),
  });
  return (
    <div className="flex flex-col gap-4">
      <Link href={CAMINHO_DIAGNOSTICOS} data-testid="diagnosticos.voltar" className="text-[13px] font-semibold text-accent-ink no-underline hover:underline">
        ‹ {T.titulo}
      </Link>
      {q.isPending ? (
        <LoadingBlock label="Abrindo o diagnóstico…" />
      ) : q.isError ? (
        <ErrorBlock message={mensagemDoErro(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <Detalhe d={q.data} />
      )}
    </div>
  );
}

function Detalhe({ d }: { d: DiagnosticoDetalhe }) {
  const saidas = saidasDoDetalhe(d);
  return (
    <>
      <PageHeader title={`Diagnóstico ${numeroDoDiagnostico(d.protocolo)}`} badge={<OrigemBadge origem={d.origem} />} subtitle={linhaDoCabecalho(d)} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Bloco titulo="O que aconteceu?" testId="diagnosticos.relato">
            <p className="m-0 text-[14px] whitespace-pre-wrap">{d.descricao || T.semRelato}</p>
          </Bloco>
          <Bloco titulo="Saída do Android" testId="diagnosticos.saidas" copiar={saidas.length ? textoDasSaidas(saidas) : undefined}>
            {saidas.length === 0 ? (
              <p className="m-0 text-[14px] text-ink-2">{T.semSaida}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {saidas.map((s, i) => (
                  <Tecnico key={`${s.quando}-${i}`} testId={`diagnosticos.saida-${i}`}>
                    {linhasDaSaida(s).map(([r, v]) => (
                      <LinhaTecnica key={r} rotulo={r} valor={v} />
                    ))}
                    {s.pilha ? <PilhaTecnica rotulo="Pilha" pilha={s.pilha} /> : null}
                  </Tecnico>
                ))}
              </div>
            )}
          </Bloco>
          <Bloco titulo="Último erro do app" testId="diagnosticos.erro" copiar={d.erro ? textoDoErro(d.erro, d.origem === 'erro_tela' ? d.ocorrido_em : null) : undefined}>
            {d.erro ? (
              <Tecnico>
                <div>
                  {d.origem === 'erro_tela' ? `${dataTecnica(d.ocorrido_em)} · ` : ''}origem: {d.erro.origem}
                </div>
                <div className="whitespace-pre-wrap">{d.erro.mensagem}</div>
                {d.erro.pilha ? <PilhaTecnica pilha={d.erro.pilha} /> : null}
              </Tecnico>
            ) : (
              <p className="m-0 text-[14px] text-ink-2">{T.semErro}</p>
            )}
          </Bloco>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Bloco titulo="Origem" testId="diagnosticos.origem">
            <dl className="m-0 flex flex-col text-[14px]">
              <Par rotulo="Empresa">
                {d.tenant_nome ?? '—'}
                <Id valor={d.tenant_id} prefixo="tenant" />
              </Par>
              <Par rotulo="Usuário">
                {rotuloDoPerfil(d.perfil)}
                <Id valor={d.usuario_id} prefixo="usuário" />
              </Par>
              {mostrarOcorrido(d) && <Par rotulo="Ocorrido">{dataDoDetalhe(d.ocorrido_em)}</Par>}
              <Par rotulo="Build">{d.build ?? '—'}</Par>
              <Par rotulo="Tela">
                <span className="font-mono text-[13px]">{d.tela ?? '—'}</span>
              </Par>
              <Par rotulo="Fila">{textoDaFila(d.sync)}</Par>
            </dl>
          </Bloco>
          <Bloco titulo="Print" testId="diagnosticos.print">
            {d.tem_print ? <Print id={d.id} /> : <p className="m-0 text-[14px] text-ink-2">{T.semPrint}</p>}
          </Bloco>
          <Bloco titulo="Recado automático" testId="diagnosticos.recado">
            <Recado alerta={d.alerta} />
          </Bloco>
        </div>
      </div>
    </>
  );
}

function Bloco({ titulo, testId, copiar, children }: { titulo: string; testId: string; copiar?: string; children: ReactNode }) {
  return (
    <section data-testid={testId} aria-label={titulo} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[12px] font-semibold tracking-[0.08em] text-ink-2 uppercase">{titulo}</h2>
        {copiar !== undefined && <Copiar texto={copiar} rotulo={`${T.copiar} ${titulo.toLowerCase()}`} />}
      </div>
      {children}
    </section>
  );
}

function Copiar({ texto, rotulo }: { texto: string; rotulo: string }) {
  const [copiado, setCopiado] = useState(false);
  useEffect(() => {
    if (!copiado) return;
    // timer-permitido: só volta o rótulo "Copiado" para "Copiar"; sem rede
    const t = window.setTimeout(() => setCopiado(false), 2000);
    return () => window.clearTimeout(t);
  }, [copiado]);
  return (
    <button
      type="button"
      aria-label={rotulo}
      onClick={() => void navigator.clipboard?.writeText(texto).then(() => setCopiado(true), () => undefined)}
      className="min-h-8 px-1 text-[13px] font-semibold text-accent-ink hover:underline focus-visible:outline-2 focus-visible:outline-accent"
    >
      <span aria-live="polite">{copiado ? T.copiado : T.copiar}</span>
    </button>
  );
}

function Tecnico({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} className="overflow-x-auto rounded-xl border border-line-2 bg-ground p-3 font-mono text-[12px] leading-[1.6] text-ink">
      {children}
    </div>
  );
}

function LinhaTecnica({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
      <span className="text-ink-2">{rotulo}</span>
      <span className="break-words whitespace-pre-wrap">{valor}</span>
    </div>
  );
}

/** Pilha com as 3 primeiras linhas e o "… mais N linhas", que abre o bloco no lugar. */
function PilhaTecnica({ pilha, rotulo }: { pilha: string; rotulo?: string }) {
  const [aberta, setAberta] = useState(false);
  const p = pilhaCurta(pilha);
  const linhas = aberta ? [...p.inicio, ...p.resto] : p.inicio;
  const corpo = (
    <div className="flex flex-col">
      {linhas.map((l, i) => (
        <span key={i} className="whitespace-pre">
          {l}
        </span>
      ))}
      {p.resto.length > 0 && !aberta && (
        <button type="button" onClick={() => setAberta(true)} className="self-start text-left font-mono text-[12px] text-accent-ink hover:underline">
          … mais {p.resto.length} {p.resto.length === 1 ? 'linha' : 'linhas'}
        </button>
      )}
    </div>
  );
  if (!rotulo) return <div className="pl-3">{corpo}</div>;
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
      <span className="text-ink-2">{rotulo}</span>
      {corpo}
    </div>
  );
}

function Par({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2 border-b border-line-2 py-2.5 last:border-b-0">
      <dt className="text-ink-2">{rotulo}</dt>
      <dd className="m-0 flex min-w-0 flex-col">{children}</dd>
    </div>
  );
}

function Id({ valor, prefixo }: { valor: string; prefixo: string }) {
  return (
    <span title={valor} className="font-mono text-[12px] text-ink-2">
      {prefixo} {idCurto(valor)}
    </span>
  );
}

function Print({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['portal', 'diagnostico', id, 'print'], queryFn: () => blobDoPortal(ROTAS_PORTAL.printDoDiagnostico(id)), staleTime: Infinity });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!q.data) return;
    const u = URL.createObjectURL(q.data);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [q.data]);
  if (q.isPending) return <LoadingBlock label="Abrindo o print…" />;
  if (q.isError) return <ErrorBlock message={mensagemDoErro(q.error)} onRetry={() => void q.refetch()} />;
  if (!url) return null;
  return (
    <div className="flex items-center gap-3">
      {/* blob local autenticado: <img> simples, sem a otimização do Next */}
      <img src={url} alt="Print anexado pelo vendedor" width={72} height={128} className="h-[128px] w-[72px] rounded-lg border border-line object-cover" />
      <a href={url} target="_blank" rel="noreferrer" data-testid="diagnosticos.abrir-print" className="text-[13px] font-semibold text-accent-ink hover:underline">
        {T.abrirPrint}
      </a>
    </div>
  );
}

function Recado({ alerta }: { alerta: DiagnosticoDetalhe['alerta'] }) {
  const s = situacaoDoRecado(alerta);
  return (
    <div className="flex flex-col items-start gap-2 text-[14px]">
      <Badge tone={s.tom}>{s.rotulo}</Badge>
      {s.nota && <span className="text-ink-2">{s.nota}</span>}
      {alerta.recado_id && (
        <a href={linkDoRecado(alerta.recado_id)} target="_blank" rel="noreferrer" className="font-mono text-[12px] text-accent-ink hover:underline">
          {alerta.recado_id} ↗
        </a>
      )}
    </div>
  );
}
