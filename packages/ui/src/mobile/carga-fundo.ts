/**
 * Onda 1 do catálogo, solução 5 (recado R-20261115-070200 do dono do produto; docs/design/carga-em-segundo-plano.md):
 * parte PURA do indicador discreto de carga em segundo plano ("Catálogo 63%") e o texto do catálogo sem sinal durante a
 * primeira carga. O indicador não é aviso (RN-VEN-42: aviso só na área Alertas) e não explica o que o app faz por trás
 * (R-20261110-192153). Sem react-native: roda em Node (Vitest) e é reexportado por `@macuxi/ui/mobile/puro`.
 */
import { ALVO_TOQUE } from './componentes';

/** Altura visual da linha (dp). O alvo de toque chega a 48 com `FOLGA_TOQUE_CARGA` em cima e embaixo. */
export const ALTURA_CARGA_FUNDO = 32;
/** Folga de toque vertical (hitSlop) de cada lado: 32 + 2 × 8 = 48 (`ALVO_TOQUE`). */
export const FOLGA_TOQUE_CARGA = (ALVO_TOQUE - ALTURA_CARGA_FUNDO) / 2;
/** Espessura da barra de progresso no pé da linha (dp). */
export const ESPESSURA_BARRA_CARGA = 2;

/**
 * Texto curto depois do percentual quando o aparelho está sem sinal: a carga está parada. A causa ("Sem sinal") já está no
 * Sincronizar do Início e no selo do cabeçalho das listas (uma informação, um lugar); o TalkBack lê a causa junto.
 */
export const SUFIXO_SEM_SINAL_CARGA = 'parado';

/** Catálogo sem sinal enquanto a primeira carga não terminou (tela do catálogo, ficha e busca do Novo pedido). */
export const TITULO_CATALOGO_CARREGANDO = 'Catálogo ainda carregando';
export const TEXTO_CATALOGO_CARREGANDO = 'Busque quando tiver sinal.';

/** Percentual inteiro de 0 a 99: enquanto o indicador está montado, a etapa não terminou (100% = o shell desmonta). */
export function percentualDaCarga(percentual: number): number {
  if (!Number.isFinite(percentual)) return 0;
  return Math.min(99, Math.max(0, Math.floor(percentual)));
}

export interface DesenhoCargaFundo {
  /** "Catálogo 63%" ou "Catálogo 63% · parado". */
  texto: string;
  /** Largura do preenchimento da barra, 0..99. */
  percentual: number;
  /** Ícone da linha: `sync` com sinal, `wifiOff` sem sinal. */
  icone: 'sync' | 'wifiOff';
  /** TalkBack: "Catálogo carregando, 63%" (+ ", parado sem sinal"). */
  rotuloAcessivel: string;
  /** TalkBack do toque, só quando há `aoTocar`. */
  dica: string;
}

export function desenhoCargaFundo({ etapa, percentual, semSinal = false }: { etapa: string; percentual: number; semSinal?: boolean }): DesenhoCargaFundo {
  const nome = etapa.trim();
  const p = percentualDaCarga(percentual);
  const base = `${nome} ${p}%`;
  return {
    texto: semSinal ? `${base} · ${SUFIXO_SEM_SINAL_CARGA}` : base,
    percentual: p,
    icone: semSinal ? 'wifiOff' : 'sync',
    rotuloAcessivel: `${nome} carregando, ${p}%${semSinal ? `, ${SUFIXO_SEM_SINAL_CARGA} sem sinal` : ''}`,
    dica: 'Abre o detalhe da carga',
  };
}
