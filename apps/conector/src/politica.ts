/**
 * Política de versão do Conector (T-0023): o Hub informa a versão mínima e a recomendada na resposta do sinal de vida; o Conector
 * guarda a última política recebida na fila local (tabela `meta`) e reavalia contra a própria versão a qualquer momento — assim o
 * `conector status` funciona sem rede e instalar uma versão nova libera o envio na hora, sem esperar o Hub.
 * Abaixo da mínima o Conector PARA de enviar dados ao Hub (lotes, retornos, busca de pedidos, reconciliação); só o sinal segue.
 */
import { PoliticaVersaoConector } from '@macuxi/integracao/contracts';
import type { Armazenamento } from './armazenamento/armazenamento';
import { avaliarVersao, VERSAO_CONECTOR, type AvaliacaoVersao } from './versao';

const CHAVE_POLITICA = 'politica_versao';
const CHAVE_POLITICA_EM = 'politica_versao_recebida_em';

export interface PoliticaGuardada {
  politica: PoliticaVersaoConector;
  recebidaEm: string | null;
}

export function guardarPolitica(store: Armazenamento, politica: PoliticaVersaoConector, agoraMs: number): void {
  store.transacao(() => {
    store.definirMeta(CHAVE_POLITICA, JSON.stringify(politica));
    store.definirMeta(CHAVE_POLITICA_EM, new Date(agoraMs).toISOString());
  });
}

/** Última política recebida do Hub; `null` se nunca recebeu ou se o que está guardado é ilegível. */
export function lerPolitica(store: Armazenamento): PoliticaGuardada | null {
  const bruto = store.meta(CHAVE_POLITICA);
  if (!bruto) return null;
  try {
    const r = PoliticaVersaoConector.safeParse(JSON.parse(bruto));
    return r.success ? { politica: r.data, recebidaEm: store.meta(CHAVE_POLITICA_EM) } : null;
  } catch {
    return null;
  }
}

export function avaliarVersaoLocal(store: Armazenamento, versao: string = VERSAO_CONECTOR): AvaliacaoVersao {
  return avaliarVersao(versao, lerPolitica(store)?.politica);
}

/** A avaliação, se o Conector está proibido de enviar dados ao Hub; `null` caso contrário. */
export function bloqueioPorVersao(ctx: { store: Armazenamento; versao?: string }): AvaliacaoVersao | null {
  const a = avaliarVersaoLocal(ctx.store, ctx.versao);
  return a.deveParar ? a : null;
}
