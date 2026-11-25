/**
 * T-0195 (ADR 0070, RN-CORE-80): atualização obrigatória do APK, a parte pura do shell (roda em Node nos testes).
 *
 * - Identidade do app (ADR 0070 §D2): toda chamada à API leva `x-macuxi-app: <variante>/<X.Y.Z>` (`CABECALHO_APP` do SDK). O
 *   valor é definido uma vez na carga do bundle (`services/identidade-app.ts`) e o `ApiClient` o lê em cada requisição. Versão
 *   ilegível = sem cabeçalho (a API não bloqueia), nunca uma exceção na chamada.
 * - Última versão conhecida (critério 3): a resposta de `GET /v1/app/versao?contrato=2` ou os `detalhes` do 426 ficam guardados
 *   no aparelho (`CHAVE_VERSAO_PUBLICADA`) e a situação é recalculada com o relógio a cada entrada, inclusive sem sinal, pela
 *   MESMA `situacaoDaVersao` do SDK que a API usa para o 426.
 * - 426 `APP_DESATUALIZADO` (`ehAppDesatualizado`): no meio do uso só marca o estado; a troca para a tela de bloqueio acontece
 *   na entrada (abrir, voltar ao primeiro plano, login), sem arrancar formulário aberto (ADR 0070 §D8 a).
 * - Com o app bloqueado (`estaBloqueada`), a sincronização vira só envio: o pull é recusado pela API, e o shell não o tenta de
 *   novo em laço; o push e os arquivos da fila seguem liberados.
 */
import {
  AppVersaoPublicadaV2Schema,
  CABECALHO_APP,
  CODIGO_APP_DESATUALIZADO,
  ErroAppDesatualizadoSchema,
  haVersaoNova,
  STATUS_APP_DESATUALIZADO,
  situacaoDaVersao,
  valorCabecalhoApp,
  type SituacaoDaVersao,
  type VarianteApp,
} from '@macuxi/platform-sdk';

import { versaoValida } from './nome-build';

// ---------- cabeçalho em toda chamada ----------

/** `{ 'x-macuxi-app': 'campo/1.0.33' }`; versão fora de X.Y.Z = `{}` (sem cabeçalho a API não bloqueia nada). */
export function cabecalhoDoApp(variante: VarianteApp, versao: string | null | undefined): Readonly<Record<string, string>> {
  try {
    return { [CABECALHO_APP]: valorCabecalhoApp(variante, versao ?? '') };
  } catch {
    return {};
  }
}

let identidade: Readonly<Record<string, string>> = {};
let versaoInstalada: { variante: VarianteApp; versao: string } | null = null;

/** Uma vez na carga do bundle (`services/identidade-app.ts`), antes de qualquer chamada. */
export function definirIdentidadeDoApp(variante: VarianteApp, versao: string | null | undefined): void {
  identidade = cabecalhoDoApp(variante, versao);
  versaoInstalada = versaoValida(versao) ? { variante, versao } : null;
}

/** O cabeçalho do app para o `ApiClient` (e o teste do servidor): o mesmo objeto em toda chamada. */
export function cabecalhosDoApp(): Readonly<Record<string, string>> {
  return identidade;
}

/** Variante e versão do build em execução; `null` = versão ilegível (nunca bloqueia). */
export function appInstalado(): { variante: VarianteApp; versao: string } | null {
  return versaoInstalada;
}

/** `init` do `fetch` com o cabeçalho do app somado aos que já vieram (objeto simples, como o shell monta). */
export function comCabecalhoDoApp<T extends { headers?: Record<string, string> }>(init: T): T {
  const extra = cabecalhosDoApp();
  return Object.keys(extra).length === 0 ? init : { ...init, headers: { ...init.headers, ...extra } };
}

// ---------- última versão publicada conhecida (vale offline) ----------

/** Chave no armazenamento do aparelho (sem dado pessoal: variante, versão e hora da publicação). */
export const CHAVE_VERSAO_PUBLICADA = 'fv:app:versao-publicada';

export interface VersaoPublicadaGuardada {
  variante: VarianteApp;
  /** X.Y.Z da última publicada da variante. */
  versao: string;
  /** ISO da publicação; `null` = desconhecida (nunca bloqueia). */
  publicada_em: string | null;
  /** ISO UTC de quando o aparelho recebeu a informação. */
  recebida_em: string;
  /**
   * A API já recusou este app (426) para esta publicada: vale como bloqueada mesmo que o relógio do aparelho diga "aviso"
   * (relógio atrasado). Só cai quando `GET /v1/app/versao` mostrar publicada ≤ instalada (`guardadaDaResposta`).
   */
  bloqueada_pelo_servidor: boolean;
}

/**
 * Resposta de `GET /v1/app/versao?contrato=2` → o que se guarda. Fora do contrato ou de outra variante = `null`. A marca do 426
 * (`anterior.bloqueada_pelo_servidor`) continua enquanto a publicada for maior que a instalada; só cai com publicada ≤ instalada.
 */
export function guardadaDaResposta(
  corpo: unknown,
  variante: VarianteApp,
  agora: Date,
  marca: { anterior: VersaoPublicadaGuardada | null; instalada: string | null | undefined } = { anterior: null, instalada: null },
): VersaoPublicadaGuardada | null {
  const r = AppVersaoPublicadaV2Schema.safeParse(corpo);
  if (!r.success || r.data.variante !== variante) return null;
  const continua =
    marca.anterior?.bloqueada_pelo_servidor === true && versaoValida(marca.instalada) && haVersaoNova(marca.instalada, r.data.versao);
  return { variante, versao: r.data.versao, publicada_em: r.data.publicada_em, recebida_em: agora.toISOString(), bloqueada_pelo_servidor: continua };
}

/** Os `detalhes` do 426 `APP_DESATUALIZADO` → o que se guarda (a API já disse que está bloqueada). */
export function guardadaDoErro(
  e: { codigo: string; mensagem: string; detalhes?: Record<string, unknown> | undefined },
  variante: VarianteApp,
  agora: Date,
): VersaoPublicadaGuardada | null {
  const r = ErroAppDesatualizadoSchema.safeParse({ codigo: e.codigo, mensagem: e.mensagem, detalhes: e.detalhes });
  if (!r.success || r.data.detalhes.variante !== variante) return null;
  return {
    variante,
    versao: r.data.detalhes.versao_publicada,
    publicada_em: r.data.detalhes.publicada_em,
    recebida_em: agora.toISOString(),
    bloqueada_pelo_servidor: true,
  };
}

/** Valida o que veio do armazenamento (versão antiga do formato, outra variante ou lixo = `null`). */
export function lerGuardada(valor: unknown, variante: VarianteApp): VersaoPublicadaGuardada | null {
  const v = valor as Partial<VersaoPublicadaGuardada> | null;
  if (!v || typeof v !== 'object' || v.variante !== variante || !versaoValida(v.versao)) return null;
  if (v.publicada_em !== null && typeof v.publicada_em !== 'string') return null;
  if (typeof v.recebida_em !== 'string') return null;
  return { variante, versao: v.versao, publicada_em: v.publicada_em ?? null, recebida_em: v.recebida_em, bloqueada_pelo_servidor: v.bloqueada_pelo_servidor === true };
}

/**
 * RN-CORE-80 com a última informação guardada e o relógio do aparelho. Sem versão instalada legível ou sem guardada = `atual`.
 * Bloqueada = a conta com o relógio OU a marca do 426 (relógio atrasado não reabre o app que a API já recusou), enquanto a
 * publicada guardada for maior que a instalada (APK novo instalado = a marca não vale mais).
 */
export function situacaoGuardada(
  guardada: VersaoPublicadaGuardada | null,
  instalada: string | null | undefined,
  agora: Date,
): SituacaoDaVersao {
  if (!guardada || !versaoValida(instalada)) return { situacao: 'atual', prazoAte: null };
  const conta = situacaoDaVersao({ atual: instalada, publicada: guardada.versao, publicadaEm: guardada.publicada_em, agora });
  if (guardada.bloqueada_pelo_servidor && haVersaoNova(instalada, guardada.versao)) return { ...conta, situacao: 'bloqueada' };
  return conta;
}

/** A situação guardada (com a marca do 426) é `bloqueada`. */
export function estaBloqueada(guardada: VersaoPublicadaGuardada | null, instalada: string | null | undefined, agora: Date): boolean {
  return situacaoGuardada(guardada, instalada, agora).situacao === 'bloqueada';
}

/**
 * A guardada no disco (a tarefa sem tela pode ter gravado o 426 com a marca) junto da que o app tem em memória, a cada entrada.
 * Vale a do disco; com a mesma versão, a marca do 426 de qualquer uma das duas continua. Sem nada no disco, fica a da memória.
 */
export function juntarGuardada(
  memoria: VersaoPublicadaGuardada | null,
  disco: VersaoPublicadaGuardada | null,
): VersaoPublicadaGuardada | null {
  if (!disco) return memoria;
  if (memoria?.versao === disco.versao && memoria.bloqueada_pelo_servidor && !disco.bloqueada_pelo_servidor)
    return { ...disco, bloqueada_pelo_servidor: true };
  return disco;
}

// ---------- 426 ----------

/** Erro HTTP (do `ApiClient` ou do ambiente dos módulos) que é a recusa do app desatualizado. */
export function ehAppDesatualizado(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const x = e as { status?: unknown; code?: unknown; codigo?: unknown };
  return x.status === STATUS_APP_DESATUALIZADO && (x.code === CODIGO_APP_DESATUALIZADO || x.codigo === CODIGO_APP_DESATUALIZADO);
}

/** O 426 de qualquer chamada (app aberto ou tarefa sem tela) → a versão guardada com a marca do servidor; outro erro = `null`. */
export function guardadaDo426(
  e: { status?: unknown; code?: unknown; message?: unknown; details?: Record<string, unknown> | undefined },
  variante: VarianteApp,
  agora: Date,
): VersaoPublicadaGuardada | null {
  if (!ehAppDesatualizado(e)) return null;
  return guardadaDoErro({ codigo: String(e.code), mensagem: typeof e.message === 'string' ? e.message : '', detalhes: e.details }, variante, agora);
}

// ---------- sininho das primeiras 24 h ----------

/**
 * Pedir o aviso do sininho (`POST /v1/core/app/aviso-versao`) só quando ele pode existir: situação local `aviso`, ou nenhuma
 * versão guardada ainda (o servidor decide). Com `atual` ou `bloqueada` não há o que avisar (nem a cada volta ao primeiro plano).
 */
export function deveAvisarVersao(guardada: VersaoPublicadaGuardada | null, instalada: string | null | undefined, agora: Date): boolean {
  if (!guardada) return true;
  return situacaoGuardada(guardada, instalada, agora).situacao === 'aviso';
}

// ---------- quando a tela de bloqueio aparece ----------

/**
 * Entrada (abrir, voltar ao primeiro plano, login concluído): a tela de bloqueio aparece com a situação `bloqueada` (calculada
 * ou marcada por um 426) e some quando ela deixa de ser (APK novo instalado, publicação refeita). No meio do uso (`entrada`
 * falso) nada troca: a tela que estava continua (formulário aberto não é arrancado).
 */
export function telaDeBloqueioNaEntrada(c: { mostrando: boolean; bloqueada: boolean; entrada: boolean }): boolean {
  return c.entrada ? c.bloqueada : c.mostrando;
}
