/**
 * T-0158 (ADR 0043; desenho docs/desenho/T-0158.md §6): Portal › Diagnósticos, só do time Macuxi (super-admin). Puro, para
 * teste: rótulos de origem e motivo, filtros ↔ endereço, datas em Manaus e o texto dos blocos técnicos do detalhe. Visual e
 * textos pela imagem aprovada `docs/design/telas/T-0158-diagnosticos-portal.png` (R-20261110-192152).
 */
import {
  DiagnosticoFiltroSchema,
  formatarProtocolo,
  ORIGENS_DIAGNOSTICO,
  type DiagnosticoDetalhe,
  type DiagnosticoFiltro,
  type OrigemDiagnostico,
} from '@macuxi/platform-sdk';
import type { BadgeTone } from '@macuxi/ui/web';

/** Página do portal (sem o prefixo `/config`: no host `config.` o navegador vê `/diagnosticos`). */
export const CAMINHO_DIAGNOSTICOS = '/diagnosticos';
export const caminhoDoDiagnostico = (id: string) => `${CAMINHO_DIAGNOSTICOS}/${encodeURIComponent(id)}`;

/** Fuso da lista entre empresas (não há fuso de tenant aqui; desenho §6). */
export const FUSO_PORTAL = 'America/Manaus';

export const TEXTOS_PORTAL_DIAGNOSTICOS = {
  titulo: 'Diagnósticos',
  subtitulo: 'Enviados pelos aparelhos. Ficam 90 dias.',
  carregando: 'Buscando os diagnósticos…',
  vazioFiltro: 'Nenhum diagnóstico com estes filtros.',
  vazio: 'Nenhum diagnóstico recebido.',
  limpar: 'Limpar filtros',
  mais: 'Mostrar mais 50',
  semAcesso: 'Esta área é só do time Macuxi.',
  semRelato: 'Sem relato.',
  semPrint: 'Não anexado.',
  abrirPrint: 'Abrir em tamanho real',
  copiar: 'Copiar',
  copiado: 'Copiado',
  semSaida: 'Nenhuma saída registrada pelo Android.',
  semErro: 'Nenhum erro registrado.',
} as const;

// ---------- origem e motivo ----------

export const ROTULO_ORIGEM: Readonly<Record<OrigemDiagnostico, { rotulo: string; tom: BadgeTone }>> = {
  botao: { rotulo: 'Botão', tom: 'neutral' },
  queda: { rotulo: 'Queda', tom: 'danger' },
  erro_tela: { rotulo: 'Erro de tela', tom: 'warning' },
};

/**
 * Motivo em português (código do app: `codigoDoMotivo` da queda, `REASON_*` do Android; a `OrigemDoErro` no erro de tela). O
 * código só aparece no detalhe, na Saída do Android. Código novo sem rótulo aparece como veio.
 */
export const ROTULO_MOTIVO: Readonly<Record<string, string>> = {
  crash_nativo: 'Falha nativa',
  crash_java: 'Erro Java',
  anr: 'App travou (ANR)',
  memoria: 'Sem memória',
  sinal: 'Encerrado pelo sistema',
  encerrado: 'Encerrado pelo sistema',
  outro: 'Encerrado pelo sistema',
  desconhecido: 'Motivo desconhecido',
  falha_inicio: 'Falha ao iniciar',
  recursos: 'Uso excessivo de recursos',
  dependencia: 'Serviço do sistema parou',
  // erro de tela: a OrigemDoErro do app
  tela: 'Erro de renderização',
  raiz: 'Erro de renderização',
  fatal: 'Erro fatal do app',
};

/** Motivos oferecidos no filtro (os da imagem primeiro). */
export const MOTIVOS_DO_FILTRO: readonly string[] = ['crash_nativo', 'crash_java', 'anr', 'memoria', 'sinal', 'falha_inicio', 'tela', 'fatal'];

export function rotuloDoMotivo(motivo: string | null | undefined): string {
  if (!motivo) return '—';
  return ROTULO_MOTIVO[motivo] ?? motivo;
}

/** `ApplicationExitInfo.REASON_*` (o número que vem na saída) → código curto (o mesmo do app). */
const CODIGO_DO_REASON: Readonly<Record<number, { codigo: string; nome: string }>> = {
  0: { codigo: 'desconhecido', nome: 'REASON_UNKNOWN' },
  1: { codigo: 'saida_propria', nome: 'REASON_EXIT_SELF' },
  2: { codigo: 'sinal', nome: 'REASON_SIGNALED' },
  3: { codigo: 'memoria', nome: 'REASON_LOW_MEMORY' },
  4: { codigo: 'crash_java', nome: 'REASON_CRASH' },
  5: { codigo: 'crash_nativo', nome: 'REASON_CRASH_NATIVE' },
  6: { codigo: 'anr', nome: 'REASON_ANR' },
  7: { codigo: 'falha_inicio', nome: 'REASON_INITIALIZATION_FAILURE' },
  8: { codigo: 'permissao', nome: 'REASON_PERMISSION_CHANGE' },
  9: { codigo: 'recursos', nome: 'REASON_EXCESSIVE_RESOURCE_USAGE' },
  10: { codigo: 'fechado_usuario', nome: 'REASON_USER_REQUESTED' },
  11: { codigo: 'parado_usuario', nome: 'REASON_USER_STOPPED' },
  12: { codigo: 'dependencia', nome: 'REASON_DEPENDENCY_DIED' },
  13: { codigo: 'outro', nome: 'REASON_OTHER' },
  14: { codigo: 'congelado', nome: 'REASON_FREEZER' },
  15: { codigo: 'pacote', nome: 'REASON_PACKAGE_STATE_CHANGE' },
  16: { codigo: 'atualizado', nome: 'REASON_PACKAGE_UPDATED' },
};

/** "crash_nativo  (REASON_CRASH_NATIVE = 5)". */
export function motivoDaSaida(motivo: number): string {
  const r = CODIGO_DO_REASON[motivo];
  return r ? `${r.codigo}  (${r.nome} = ${motivo})` : `motivo ${motivo}`;
}

const IMPORTANCIA: Readonly<Record<number, string>> = { 100: 'primeiro plano', 125: 'serviço em primeiro plano', 200: 'visível', 230: 'perceptível', 300: 'serviço', 400: 'em cache', 1000: 'sem processo' };

// ---------- datas (Manaus) ----------

function partes(iso: string, tz = FUSO_PORTAL) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return { dd: p.day!, mo: p.month!, aaaa: p.year!, hh: p.hour!, mm: p.minute!, ss: p.second! };
}

const valida = (iso: string | null | undefined): iso is string => !!iso && Number.isFinite(Date.parse(iso));

/** Lista: "11/11 15:30". */
export function dataDaLista(iso: string | null | undefined): string {
  if (!valida(iso)) return '—';
  const p = partes(iso);
  return `${p.dd}/${p.mo} ${p.hh}:${p.mm}`;
}

/** Detalhe: "11/11 às 14:02". */
export function dataDoDetalhe(iso: string | null | undefined): string {
  if (!valida(iso)) return '—';
  const p = partes(iso);
  return `${p.dd}/${p.mo} às ${p.hh}:${p.mm}`;
}

/** Bloco técnico: "11/11 14:01:37". */
export function dataTecnica(iso: string | null | undefined): string {
  if (!valida(iso)) return '—';
  const p = partes(iso);
  return `${p.dd}/${p.mo} ${p.hh}:${p.mm}:${p.ss}`;
}

/** Data civil em Manaus (AAAA-MM-DD) de um instante. */
export function diaEmManaus(agora: Date): string {
  const p = partes(agora.toISOString());
  return `${p.aaaa}-${p.mo}-${p.dd}`;
}

/** Início do dia (00:00 em Manaus, UTC−4 sem horário de verão) em ISO UTC. */
export const inicioDoDia = (dia: string): string => new Date(`${dia}T04:00:00.000Z`).toISOString();
/** Fim do dia (23:59:59.999 em Manaus) em ISO UTC. */
export const fimDoDia = (dia: string): string => new Date(Date.parse(`${dia}T04:00:00.000Z`) + 86_400_000 - 1).toISOString();

function diaMenos(dia: string, dias: number): string {
  return new Date(Date.parse(`${dia}T12:00:00.000Z`) - dias * 86_400_000).toISOString().slice(0, 10);
}

// ---------- filtros ↔ endereço ----------

/** Período: hoje e os últimos N dias contando hoje; "personalizado" quando o endereço traz outro `de`/`ate`. */
export const PERIODOS = [
  { valor: '1', rotulo: 'Hoje', dias: 1 },
  { valor: '7', rotulo: 'Últimos 7 dias', dias: 7 },
  { valor: '30', rotulo: 'Últimos 30 dias', dias: 30 },
  { valor: '90', rotulo: 'Últimos 90 dias', dias: 90 },
] as const;
export const PERIODO_PADRAO = '7';

/** O que a tela mostra nos filtros (tudo texto; vazio = todos). `de`/`ate` = AAAA-MM-DD em Manaus. */
export interface FiltrosDaTela {
  versao: string;
  modelo: string;
  empresa: string;
  motivo: string;
  origem: string;
  de: string;
  ate: string;
}

export const FILTROS_VAZIOS: FiltrosDaTela = { versao: '', modelo: '', empresa: '', motivo: '', origem: '', de: '', ate: '' };

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `?versao=1.0.4&modelo=&empresa=&motivo=&origem=&de=&ate=` → filtros (valor estranho vira vazio). */
export function filtrosDoEndereco(busca: URLSearchParams | { get(k: string): string | null }): FiltrosDaTela {
  const t = (k: string, max: number) => (busca.get(k) ?? '').trim().slice(0, max);
  const origem = t('origem', 20);
  const empresa = t('empresa', 36);
  const de = t('de', 10);
  const ate = t('ate', 10);
  return {
    versao: t('versao', 20),
    modelo: t('modelo', 80),
    empresa: UUID.test(empresa) ? empresa.toLowerCase() : '',
    motivo: t('motivo', 60),
    origem: (ORIGENS_DIAGNOSTICO as readonly string[]).includes(origem) ? origem : '',
    de: DIA.test(de) ? de : '',
    ate: DIA.test(ate) ? ate : '',
  };
}

/** Filtros → query do endereço (só os preenchidos, para colar o link no recado). */
export function enderecoDosFiltros(f: FiltrosDaTela): string {
  const q = new URLSearchParams();
  for (const k of ['versao', 'modelo', 'empresa', 'motivo', 'origem', 'de', 'ate'] as const) if (f[k]) q.set(k, f[k]);
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const temFiltro = (f: FiltrosDaTela) => Object.values(f).some(Boolean);

/** Valor do seletor de período: o padrão sem datas; "personalizado" com datas que não são um dos períodos. */
export function periodoDosFiltros(f: FiltrosDaTela, agora: Date): string {
  if (!f.de && !f.ate) return PERIODO_PADRAO;
  const hoje = diaEmManaus(agora);
  if (f.ate && f.ate !== hoje) return 'personalizado';
  return PERIODOS.find((p) => f.de === diaMenos(hoje, p.dias - 1))?.valor ?? 'personalizado';
}

/** Escolha do período → `de` (e sem `ate`: até agora). O padrão (7 dias) limpa as datas do endereço. */
export function filtrosComPeriodo(f: FiltrosDaTela, valor: string, agora: Date): FiltrosDaTela {
  const p = PERIODOS.find((x) => x.valor === valor);
  if (!p || p.valor === PERIODO_PADRAO) return { ...f, de: '', ate: '' };
  return { ...f, de: diaMenos(diaEmManaus(agora), p.dias - 1), ate: '' };
}

/** Filtros da tela → filtro do contrato (`DiagnosticoFiltroSchema`); período padrão = últimos 7 dias. */
export function filtroDaApi(f: FiltrosDaTela, agora: Date, cursor?: string | null): DiagnosticoFiltro {
  const de = f.de || diaMenos(diaEmManaus(agora), 6);
  const bruto: DiagnosticoFiltro = {
    ...(f.versao ? { versao: f.versao } : {}),
    ...(f.modelo ? { modelo: f.modelo } : {}),
    ...(f.empresa ? { tenant_id: f.empresa } : {}),
    ...(f.motivo ? { motivo: f.motivo } : {}),
    ...(f.origem ? { origem: f.origem as OrigemDiagnostico } : {}),
    de: inicioDoDia(de),
    ...(f.ate ? { ate: fimDoDia(f.ate) } : {}),
    ...(cursor ? { cursor } : {}),
  };
  return DiagnosticoFiltroSchema.parse(bruto);
}

/** Filtro → query da chamada (`GET /v1/plataforma/diagnosticos?...`). */
export function queryDoFiltro(f: DiagnosticoFiltro): Record<string, string> {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]));
}

// ---------- detalhe ----------

/** "nº 0041". */
export const numeroDoDiagnostico = (protocolo: number) => `nº ${formatarProtocolo(protocolo)}`;

/** "Campo 1.0.4". */
export const appEVersao = (app: 'campo' | 'gestao', versao: string) => `${app === 'gestao' ? 'Gestão' : 'Campo'} ${versao}`;

/** "Campo 1.0.4 · Motorola moto g54 · Android 14 (API 34) · recebido 11/11 às 14:02". */
export function linhaDoCabecalho(d: Pick<DiagnosticoDetalhe, 'app' | 'versao_app' | 'aparelho_fabricante' | 'aparelho_modelo' | 'android' | 'android_api' | 'recebido_em'>): string {
  const aparelho = [d.aparelho_fabricante, d.aparelho_modelo].filter(Boolean).join(' ');
  const android = d.android ? `Android ${d.android}${d.android_api ? ` (API ${d.android_api})` : ''}` : null;
  return [appEVersao(d.app, d.versao_app), aparelho || null, android, `recebido ${dataDoDetalhe(d.recebido_em)}`].filter(Boolean).join(' · ');
}

/** Id longo encurtado na tela ("3b9e…a71c"); o inteiro vai no `title` e no Copiar. */
export const idCurto = (id: string) => (id.length > 12 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id);

/** Linhas de pilha mostradas antes do "… mais N linhas". */
export const LINHAS_DE_PILHA = 3;

export interface Pilha {
  inicio: string[];
  resto: string[];
}

export function pilhaCurta(pilha: string | null | undefined, n = LINHAS_DE_PILHA): Pilha {
  const linhas = (pilha ?? '').split('\n').map((l) => l.trimEnd()).filter(Boolean);
  return { inicio: linhas.slice(0, n), resto: linhas.slice(n) };
}

type Saida = DiagnosticoDetalhe['ultimas_saidas'][number];
type SaidaSemHora = NonNullable<DiagnosticoDetalhe['saida_android']>;

/** Saídas do bloco "Saída do Android": as 5 últimas; diagnóstico antigo (sem a lista) mostra a única que tiver. */
export function saidasDoDetalhe(d: Pick<DiagnosticoDetalhe, 'ultimas_saidas' | 'saida_android' | 'ocorrido_em'>): Saida[] {
  if (d.ultimas_saidas.length > 0) return d.ultimas_saidas;
  return d.saida_android ? [{ ...d.saida_android, quando: d.ocorrido_em }] : [];
}

const kb = (n: number) => new Intl.NumberFormat('pt-BR').format(n);

/** Linhas rótulo/valor de uma saída (a pilha vem à parte, com o "mais N linhas"). */
export function linhasDaSaida(s: Saida | SaidaSemHora & { quando?: string }): [string, string][] {
  const imp = IMPORTANCIA[s.importancia];
  const linhas: [string, string][] = [
    ['Motivo', motivoDaSaida(s.motivo)],
    ['Status', `${s.status} · importância ${s.importancia}${imp ? ` (${imp})` : ''}`],
    ['Memória', `PSS ${kb(s.pss_kb)} KB · RSS ${kb(s.rss_kb)} KB`],
  ];
  if (s.quando) linhas.push(['Quando', dataTecnica(s.quando)]);
  if (s.descricao) linhas.push(['Descrição', s.descricao]);
  return linhas;
}

/** Texto inteiro de uma saída (o Copiar leva o bloco inteiro, com todas as linhas da pilha). */
export function textoDaSaida(s: Saida): string {
  const largura = 10;
  const corpo = linhasDaSaida(s).map(([r, v]) => `${r.padEnd(largura)} ${v}`);
  const pilha = (s.pilha ?? '').split('\n').filter(Boolean);
  if (pilha.length) corpo.push(...pilha.map((l, i) => `${(i === 0 ? 'Pilha' : '').padEnd(largura)} ${l}`));
  return corpo.join('\n');
}

export function textoDasSaidas(saidas: readonly Saida[]): string {
  return saidas.map(textoDaSaida).join('\n\n');
}

/** "11/11 14:01:35 · origem: tela" + mensagem + pilha (o Copiar do "Último erro do app"). */
export function textoDoErro(erro: NonNullable<DiagnosticoDetalhe['erro']>, ocorridoEm: string | null): string {
  const cabeca = [ocorridoEm ? dataTecnica(ocorridoEm) : null, `origem: ${erro.origem}`].filter(Boolean).join(' · ');
  return [cabeca, erro.mensagem, erro.pilha ?? ''].filter(Boolean).join('\n');
}

/** "3 itens · última sync 11/11 13:48". */
export function textoDaFila(sync: DiagnosticoDetalhe['sync']): string {
  if (!sync) return '—';
  const itens = `${sync.pendentes} ${sync.pendentes === 1 ? 'item' : 'itens'}`;
  return sync.ultimo_sync_em ? `${itens} · última sync ${dataDaLista(sync.ultimo_sync_em)}` : itens;
}

/** O envio pelo botão que ficou na fila: o "Ocorrido" difere do "recebido" (mais de 1 min). */
export function mostrarOcorrido(d: Pick<DiagnosticoDetalhe, 'origem' | 'ocorrido_em' | 'recebido_em'>): boolean {
  return d.origem === 'botao' && Math.abs(Date.parse(d.recebido_em) - Date.parse(d.ocorrido_em)) > 60_000;
}

/** Situação do recado automático: rótulo, tom e o complemento. */
export function situacaoDoRecado(a: DiagnosticoDetalhe['alerta']): { rotulo: string; tom: BadgeTone; nota: string | null } {
  switch (a.situacao) {
    case 'enviado':
      return { rotulo: 'Enviado', tom: 'success', nota: a.em ? `${dataDaLista(a.em)} · a alexandre e engenheiro-apps` : 'a alexandre e engenheiro-apps' };
    case 'pendente':
      return { rotulo: 'Pendente', tom: 'warning', nota: 'vai na próxima tentativa' };
    case 'agrupado':
      return { rotulo: 'Agrupado', tom: 'neutral', nota: a.em ? `no resumo de ${dataDaLista(a.em).slice(-5)}` : 'no resumo da hora' };
    case 'falhou':
      return { rotulo: 'Falhou', tom: 'danger', nota: '8 tentativas' };
    default:
      return { rotulo: 'Desligado', tom: 'neutral', nota: 'servidor sem o token de recados' };
  }
}

/** Link do recado no repositório de recados (busca pelo id, que é único). */
export function linkDoRecado(recadoId: string): string {
  return `https://github.com/search?type=code&q=${encodeURIComponent(`repo:aloirr/macuxifdv-recados ${recadoId}`)}`;
}
