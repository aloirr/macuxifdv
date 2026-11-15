/**
 * BKO Fotos em lote (T-0174, RN-CAT-14, RF-CAT-07): funções puras da tela, na spec `docs/design/telas/fotos-em-lote.md`.
 * Cartões-filtro, fases do lote, selos, textos, conferência do arquivo e o envio do ZIP em partes de 8 MiB (com `fetch`
 * injetado pela página). A regra do tamanho e dos textos de motivo é do domain; a API revalida.
 */
import { PARTE_ENVIO_BYTES } from '@macuxi/platform-sdk';
import { DEFAULT_TZ, formatDateTime, formatInt, type Selo } from '@macuxi/ui/web';
import { FOTO_LOTE_ATIVOS_MAX, ROTULO_SITUACAO_ITEM, SITUACOES_LOTE_EM_ANDAMENTO, type FotoLote, type SituacaoItem, type TotaisLote } from '../../contracts';
import { conferirTamanhoZip } from '../../domain';

const MIB = 1024 * 1024;

// ---------- cartões do relatório ----------
export type CartaoFoto = 'ligadas' | 'pendencias' | 'recusadas' | 'repetidas';
export const ROTULO_CARTAO: Readonly<Record<CartaoFoto, string>> = {
  ligadas: 'Ligadas',
  pendencias: 'Sem produto ou ambíguas',
  recusadas: 'Recusadas',
  repetidas: 'Repetidas',
};
const SITUACOES_DO_CARTAO: Readonly<Record<CartaoFoto, readonly SituacaoItem[]>> = {
  ligadas: ['ligado'],
  pendencias: ['sem_produto', 'ambiguo'],
  recusadas: ['recusado'],
  repetidas: ['repetido'],
};
const CARTOES: readonly CartaoFoto[] = ['ligadas', 'pendencias', 'recusadas', 'repetidas'];

export function valorDoCartao(c: CartaoFoto, t: Pick<TotaisLote, SituacaoItem>): number {
  return SITUACOES_DO_CARTAO[c].reduce((soma, s) => soma + t[s], 0);
}
/** Valor de `FotoLoteItensQuery.situacao` do cartão (`sem_produto,ambiguo`). */
export function situacoesDoCartao(c: CartaoFoto): string {
  return SITUACOES_DO_CARTAO[c].join(',');
}
/** "Repetidas" só com uma ou mais: repetida não é foto nova nem problema a corrigir (spec §3.4). */
export function cartoesVisiveis(t: TotaisLote): CartaoFoto[] {
  return CARTOES.filter((c) => c !== 'repetidas' || t.repetido > 0);
}
/** Cor do número: zero não pinta (spec §3.4). */
export function corDoCartao(c: CartaoFoto, valor: number): string {
  if (c === 'repetidas') return 'text-ink-2';
  if (c === 'ligadas') return 'text-success';
  if (valor === 0) return 'text-ink';
  return c === 'recusadas' ? 'text-danger' : 'text-warning';
}

// ---------- URL: lote aberto e cartão marcado ----------
export interface TelaFotosLote {
  lote: string | null;
  cartao: CartaoFoto | null;
  /** Veio de um ZIP já enviado (spec §3.6): mostra o aviso informativo. */
  repetido: boolean;
}
export function lerTelaFotosLote(busca: string): TelaFotosLote {
  const p = new URLSearchParams(busca);
  const f = p.get('filtro') as CartaoFoto | null;
  return { lote: p.get('lote') || null, cartao: f && CARTOES.includes(f) ? f : null, repetido: p.get('repetido') === '1' };
}
export function buscaDaTelaFotosLote(t: TelaFotosLote): string {
  const p = new URLSearchParams();
  if (t.lote) {
    p.set('lote', t.lote);
    if (t.cartao) p.set('filtro', t.cartao);
    if (t.repetido) p.set('repetido', '1');
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ---------- fase do lote ----------
export type FaseLote = 'enviando' | 'interrompido' | 'fila' | 'conferindo' | 'processando' | 'concluido' | 'recusado' | 'falhou' | 'duplicado';
export function faseDoLote(l: Pick<FotoLote, 'situacao'>, enviandoNestaAba: boolean): FaseLote {
  switch (l.situacao) {
    case 'aguardando_envio':
      return enviandoNestaAba ? 'enviando' : 'interrompido';
    case 'enfileirado':
      return 'fila';
    default:
      return l.situacao;
  }
}
const SELO_LOTE: Readonly<Record<FaseLote, Selo>> = {
  enviando: { tom: 'pending', texto: 'Enviando' },
  interrompido: { tom: 'warning', texto: 'Envio interrompido' },
  fila: { tom: 'neutral', texto: 'Na fila' },
  conferindo: { tom: 'pending', texto: 'Conferindo' },
  processando: { tom: 'pending', texto: 'Processando' },
  concluido: { tom: 'success', texto: 'Concluído' },
  recusado: { tom: 'danger', texto: 'Recusado' },
  falhou: { tom: 'danger', texto: 'Falhou' },
  duplicado: { tom: 'neutral', texto: 'Já enviado' },
};
export const seloDoLote = (f: FaseLote): Selo => SELO_LOTE[f];
const TOM_ITEM: Readonly<Record<SituacaoItem, Selo['tom']>> = { pendente: 'neutral', ligado: 'success', sem_produto: 'warning', ambiguo: 'warning', recusado: 'danger', repetido: 'neutral' };
export const seloDoItem = (s: SituacaoItem): Selo => ({ tom: TOM_ITEM[s], texto: ROTULO_SITUACAO_ITEM[s] });

/** A página consulta o lote a cada 2 s só enquanto ele anda. */
export const INTERVALO_CONSULTA_MS = 2000;
export const consultaViva = (f: FaseLote): boolean => f === 'fila' || f === 'conferindo' || f === 'processando';
/** Cartões e tabela: do processamento em diante, e só se houve alguma foto considerada. */
export function mostraRelatorio(f: FaseLote, total: number | null): boolean {
  return (f === 'processando' || f === 'concluido' || f === 'falhou') && (total ?? 0) > 0;
}
export function acoesDoCabecalho(f: FaseLote): { cancelarEnvio: boolean; baixarCsv: boolean; enviarOutro: boolean } {
  return { cancelarEnvio: f === 'enviando', baixarCsv: f === 'concluido', enviarOutro: f === 'concluido' || f === 'recusado' || f === 'falhou' || f === 'interrompido' };
}
export function limiteDeLotesAtivo(lotes: readonly Pick<FotoLote, 'situacao'>[]): boolean {
  return lotes.filter((l) => (SITUACOES_LOTE_EM_ANDAMENTO as readonly string[]).includes(l.situacao)).length >= FOTO_LOTE_ATIVOS_MAX;
}

// ---------- textos ----------
export function progressoDoEnvio(enviados: number, total: number): { valor: number; maximo: number; texto: string } {
  return { valor: enviados, maximo: total, texto: `${formatInt(Math.floor(enviados / MIB))} de ${formatInt(Math.floor(total / MIB))} MB` };
}
export function progressoDoProcessamento(l: Pick<FotoLote, 'total' | 'totais'>): { valor: number; maximo: number; texto: string } {
  const maximo = l.total ?? 0;
  const valor = Math.max(0, maximo - l.totais.pendente);
  return { valor, maximo, texto: `${formatInt(valor)} de ${formatInt(maximo)} fotos` };
}
/** `15/11 09:12` (Lotes recentes). */
export function dataHoraCurta(iso: string, tz: string = DEFAULT_TZ): string {
  return formatDateTime(iso, tz).replace(' às ', ' ');
}
export function avisoLoteRepetido(criadoEm: string, tz: string = DEFAULT_TZ): string {
  return `Este ZIP já foi enviado em ${formatDateTime(criadoEm, tz)}. O resultado está abaixo.`;
}
export const TEXTO_LOTE_FALHOU = 'Não foi possível processar o ZIP. Envie de novo.';
export const TEXTO_ENVIO_PAROU = 'O envio parou. Confira a internet e tente de novo.';
export const TEXTO_LOTES_ATIVOS = 'Espere um dos lotes em processamento terminar para enviar outro.';

// ---------- conferência do arquivo ----------
export function validarArquivoZip(nome: string, tamanhoBytes: number, limites: { bytesZipMax: number }): { ok: true } | { ok: false; mensagem: string } {
  if (!/\.zip$/i.test(nome) || tamanhoBytes <= 0) return { ok: false, mensagem: 'Escolha um arquivo .zip.' };
  const t = conferirTamanhoZip(tamanhoBytes, limites);
  return t.ok ? { ok: true } : { ok: false, mensagem: t.mensagem };
}
export function mensagemErroDoEnvio(e: { status: number; code: string; message: string }): string {
  if (e.status === 409 && e.code === 'LOTE_EM_ANDAMENTO') return TEXTO_LOTES_ATIVOS;
  if (e.status === 409 && e.code === 'ENVIO_INCOMPLETO') return TEXTO_ENVIO_PAROU;
  if (e.status === 0 || e.code === 'network') return TEXTO_ENVIO_PAROU;
  return e.message;
}

// ---------- envio em partes ----------
export interface FatiaDoEnvio {
  n: number;
  inicio: number;
  fim: number;
}
export function fatiasDoEnvio(tamanho: number): FatiaDoEnvio[] {
  const total = Math.max(1, Math.ceil(tamanho / PARTE_ENVIO_BYTES));
  return Array.from({ length: total }, (_v, i) => ({ n: i + 1, inicio: i * PARTE_ENVIO_BYTES, fim: Math.min(tamanho, (i + 1) * PARTE_ENVIO_BYTES) }));
}
export const TENTATIVAS_POR_PARTE = 3;

export type ResultadoEnvio = { ok: true } | { ok: false; recomecarEm: number } | { ok: false; cancelado: true };

/**
 * Manda as partes em ordem (ou só as de `partes`, no "tentar de novo" depois de `ENVIO_INCOMPLETO`). Cada parte tem até
 * 3 tentativas; falhando todas, devolve de qual parte recomeçar. `aoProgredir` recebe os bytes já enviados.
 */
export async function enviarPartes(p: {
  tamanho: number;
  partes?: readonly number[];
  sinal?: AbortSignal;
  enviarParte: (f: FatiaDoEnvio) => Promise<void>;
  aoProgredir: (bytesEnviados: number) => void;
}): Promise<ResultadoEnvio> {
  const todas = fatiasDoEnvio(p.tamanho);
  const fila = p.partes ? todas.filter((f) => p.partes!.includes(f.n)) : todas;
  let feitos = p.partes ? todas.filter((f) => !p.partes!.includes(f.n)).reduce((s, f) => s + (f.fim - f.inicio), 0) : 0;
  p.aoProgredir(feitos);
  for (const f of fila) {
    let ok = false;
    for (let t = 0; t < TENTATIVAS_POR_PARTE && !ok; t++) {
      if (p.sinal?.aborted) return { ok: false, cancelado: true };
      try {
        await p.enviarParte(f);
        ok = true;
      } catch {
        if (p.sinal?.aborted) return { ok: false, cancelado: true };
      }
    }
    if (!ok) return { ok: false, recomecarEm: f.n };
    feitos += f.fim - f.inicio;
    p.aoProgredir(feitos);
    if (p.sinal?.aborted && f !== fila[fila.length - 1]) return { ok: false, cancelado: true };
  }
  return { ok: true };
}
