/**
 * T-0144 (R-20261110-062231: o app fechava 3 vezes na 1ª abertura e a tela de erro nunca aparecia). Quando o processo cai
 * FORA do React (erro nativo, erro Java, falta de memória, app travado, o Android encerrando o app), o JS não vê nada. No
 * próximo início o shell pergunta ao Android por que o processo anterior terminou (módulo nativo local
 * `modules/macuxi-saida`, `ApplicationExitInfo` do Android 11+) e grava a causa no "Último erro do app" do Diagnóstico.
 * Puro (roda em Node): a leitura do módulo nativo fica em `services/saida-android.ts`.
 * Sem dado pessoal: só o motivo, o sinal, a memória e o começo da pilha, com a máscara única (`mascararDadoPessoal`).
 */
import { mascararDadoPessoal } from '@macuxi/comum/dado-pessoal';
import { MOTIVOS_SAIDA_ANDROID } from '@macuxi/platform-sdk';

import type { ErroRegistrado } from './erro-de-tela';

/** Uma saída do processo, como o módulo nativo devolve (`ApplicationExitInfo`). */
export interface SaidaAndroid {
  /** `ApplicationExitInfo.REASON_*`. */
  motivo: number;
  /** Sinal (erro nativo, encerrado por sinal) ou código de saída. */
  status: number;
  /** Importância do processo quando terminou (100 = primeiro plano). */
  importancia: number;
  /** Epoch em ms. */
  quando: number;
  pss_kb: number;
  rss_kb: number;
  descricao: string;
  processo: string;
  /** ANR: linhas da pilha da linha principal. */
  pilha?: string;
}

/** Último erro Java não tratado (gravado pelo tratador do módulo nativo antes de o Android encerrar o app). */
export interface ErroJava {
  quando: number;
  texto: string;
}

/** Até onde as saídas já foram registradas (epoch ms), no AsyncStorage do aparelho (fora do prefixo do usuário). */
export const CHAVE_SAIDA_VISTA = 'fv:diagnostico:saida_vista';
/** Saídas mais antigas que isto não viram "Último erro" na 1ª leitura (o Android guarda alguns dias de histórico). */
export const JANELA_PRIMEIRA_LEITURA_MS = 7 * 24 * 60 * 60_000;
/** Erro fatal do JS e saída do Android com até este intervalo são o mesmo fechamento (fica o registro do JS, com a pilha). */
export const MESMO_FECHAMENTO_MS = 20_000;
/** Linhas de saída mostradas no Diagnóstico. */
export const SAIDAS_NO_DIAGNOSTICO = 3;

/** Importância máxima (`IMPORTANCE_VISIBLE` = 200) para contar uma saída ambígua (sinal, outro) como queda vista pelo usuário. */
const IMPORTANCIA_VISIVEL = 200;

type Gravidade = 'queda' | 'queda-se-visivel' | 'normal';

/**
 * Gravidade de cada motivo do Android (`ApplicationExitInfo.REASON_*`), regra do app. O texto vem da tabela única do SDK
 * (`MOTIVOS_SAIDA_ANDROID`, RD-0124), a mesma que o portal mostra ao suporte.
 */
const GRAVIDADE: Readonly<Record<number, Gravidade>> = {
  0: 'queda-se-visivel',
  1: 'normal',
  2: 'queda-se-visivel',
  3: 'queda',
  4: 'queda',
  5: 'queda',
  6: 'queda',
  7: 'queda',
  8: 'normal',
  9: 'queda',
  10: 'normal',
  11: 'normal',
  12: 'queda',
  13: 'queda-se-visivel',
  14: 'normal',
  15: 'normal',
  16: 'normal',
};

const SINAIS: Readonly<Record<number, string>> = {
  4: 'SIGILL',
  6: 'SIGABRT',
  7: 'SIGBUS',
  8: 'SIGFPE',
  9: 'SIGKILL',
  11: 'SIGSEGV',
  15: 'SIGTERM',
};

const num = (v: unknown, padrao = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : padrao);
const texto = (v: unknown): string => (typeof v === 'string' ? v : '');

/** JSON do módulo nativo → saídas válidas, da mais nova para a mais antiga. Lixo ou vazio = nenhuma. */
export function lerSaidas(json: string | null | undefined): SaidaAndroid[] {
  if (!json) return [];
  let bruto: unknown;
  try {
    bruto = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(bruto)) return [];
  const saidas: SaidaAndroid[] = [];
  for (const x of bruto) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const quando = num(o.quando, NaN);
    if (!Number.isFinite(quando)) continue;
    const pilha = texto(o.pilha);
    saidas.push({
      motivo: num(o.motivo),
      status: num(o.status),
      importancia: num(o.importancia),
      quando,
      pss_kb: num(o.pss_kb),
      rss_kb: num(o.rss_kb),
      descricao: texto(o.descricao),
      processo: texto(o.processo),
      ...(pilha ? { pilha } : {}),
    });
  }
  return saidas.sort((a, b) => b.quando - a.quando);
}

/** JSON do último erro Java (ou `null`). */
export function lerErroJava(json: string | null | undefined): ErroJava | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    const quando = num(o.quando, NaN);
    const t = texto(o.texto);
    return Number.isFinite(quando) && t ? { quando, texto: t } : null;
  } catch {
    return null;
  }
}

/** A saída derrubou o app (erro, memória, travamento) ou foi um fim normal (usuário, atualização, o próprio app)? */
export function ehQueda(s: SaidaAndroid): boolean {
  const g = GRAVIDADE[s.motivo] ?? 'queda-se-visivel';
  if (g === 'queda') return true;
  if (g === 'normal') return false;
  // sinal 9 sem estar visível é o Android liberando um app em segundo plano: normal
  return s.importancia > 0 && s.importancia <= IMPORTANCIA_VISIVEL;
}

const mb = (kb: number) => `${Math.round(kb / 1024)} MB`;

/** "Falha nativa · sinal 11 (SIGSEGV)", "Sem memória · memória do app 412 MB"... */
export function descricaoDaSaida(s: SaidaAndroid): string {
  const partes = [MOTIVOS_SAIDA_ANDROID[s.motivo]?.rotulo ?? `Motivo ${s.motivo}`];
  if ((s.motivo === 2 || s.motivo === 5) && s.status > 0) partes.push(`sinal ${s.status}${SINAIS[s.status] ? ` (${SINAIS[s.status]})` : ''}`);
  const memoria = s.pss_kb > 0 ? s.pss_kb : s.rss_kb;
  if (memoria > 0) partes.push(`memória do app ${mb(memoria)}`);
  if (s.descricao) partes.push(s.descricao.slice(0, 160));
  return mascararDadoPessoal(partes.join(' · '));
}

/** Registro do "Último erro do app" para uma queda vista pelo Android (o erro Java junto, se for do mesmo fechamento). */
export function registroDaSaida(s: SaidaAndroid, erroJava: ErroJava | null): ErroRegistrado {
  const java = erroJava && s.motivo === 4 && Math.abs(erroJava.quando - s.quando) <= MESMO_FECHAMENTO_MS ? erroJava : null;
  const [primeira, ...resto] = java ? java.texto.split('\n').filter((l) => !l.startsWith('linha ')) : [];
  const mensagem = java && primeira ? `${descricaoDaSaida(s)}\n${mascararDadoPessoal(primeira).slice(0, 300)}` : descricaoDaSaida(s);
  const pilhaBruta = java ? resto.slice(0, 8).join('\n') : (s.pilha ?? '');
  return {
    quando: new Date(s.quando).toISOString(),
    origem: 'fatal',
    onde: 'Android',
    mensagem,
    pilha: pilhaBruta ? mascararDadoPessoal(pilhaBruta) : null,
  };
}

export interface DecisaoSaida {
  /** O que gravar como "Último erro do app" (`null` = nada novo). */
  registro: ErroRegistrado | null;
  /** Novo "visto até" (epoch ms) para não registrar a mesma saída de novo. */
  vistaAte: number;
}

/**
 * Próximo início: a queda mais recente ainda não vista vira o "Último erro do app". Na 1ª leitura (`vistaAte` nulo), vale o
 * histórico dos últimos 7 dias (a v1.0.2 já pode ter deixado a causa no Android). Se o JS já gravou um fatal do mesmo
 * fechamento (até 20 s de diferença), fica o do JS, que tem a pilha do código.
 */
export function saidaParaRegistrar(
  saidas: readonly SaidaAndroid[],
  vistaAte: number | null,
  erroJava: ErroJava | null,
  existente: Pick<ErroRegistrado, 'origem' | 'quando'> | null,
  agora: number,
): DecisaoSaida {
  const desde = vistaAte ?? agora - JANELA_PRIMEIRA_LEITURA_MS;
  const novas = saidas.filter((s) => s.quando > desde);
  const ate = Math.max(desde, ...novas.map((s) => s.quando));
  const queda = novas.filter(ehQueda).sort((a, b) => b.quando - a.quando)[0];
  if (!queda) return { registro: null, vistaAte: ate };
  if (existente?.origem === 'fatal') {
    const t = Date.parse(existente.quando);
    if (Number.isFinite(t) && Math.abs(t - queda.quando) <= MESMO_FECHAMENTO_MS) return { registro: null, vistaAte: ate };
  }
  return { registro: registroDaSaida(queda, erroJava), vistaAte: ate };
}

/**
 * Linhas do Diagnóstico: "Saídas do app (Android): hoje 05:33 · Falha nativa · sinal 11 (SIGSEGV)". `quando` formata no
 * fuso do tenant. Sem o módulo nativo (APK antigo) ou Android abaixo do 11: uma linha dizendo isso.
 */
export function linhasDasSaidas(saidas: readonly SaidaAndroid[] | null, quando: (iso: string) => string): string[] {
  if (saidas === null) return ['Saídas do app (Android): indisponível nesta versão'];
  if (saidas.length === 0) return ['Saídas do app (Android): nenhuma registrada'];
  return [
    'Saídas do app (Android):',
    ...saidas
      .slice(0, SAIDAS_NO_DIAGNOSTICO)
      .map((s) => `  ${quando(new Date(s.quando).toISOString())} · ${descricaoDaSaida(s)}${ehQueda(s) ? '' : ' (normal)'}`),
  ];
}
