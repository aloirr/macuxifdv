import { formatInt } from '@macuxi/ui/web';
import { PARAMETROS_PADRAO, type ParametrosPromotor } from '../../domain/parametros';

/**
 * Parâmetros › Trade (ADR 0058, D7): os 5 parâmetros do Promotor em 3 painéis, só leitura (a rota de gravação é lote futuro).
 * Valor atual vindo da API e "Padrão: X" só quando difere do padrão do domain (RN-PRO-04, RN-PRO-07, RN-PRO-08, RN-PRO-11). Sem React.
 */
export interface CampoParametroTrade {
  chave: keyof ParametrosPromotor;
  rotulo: string;
  /** Valor atual formatado, ex.: "7 dias". */
  valor: string;
  /** "Padrão: 30 dias"; ausente quando o valor é o padrão. */
  padrao?: string;
}

/** Painéis de Parâmetros › Trade (o título de cada um está em `web/index.ts`). */
export type PainelParametroTrade = 'validade' | 'visita-coleta' | 'gondola';

type Formato = (n: number) => string;
const dias: Formato = (n) => `${formatInt(n)} ${n === 1 ? 'dia' : 'dias'}`;
const min: Formato = (n) => `${formatInt(n)} min`;
const pct: Formato = (n) => `${formatInt(n)}%`;
/** Peso de 0 a 1 mostrado como percentual ("0%", "50%"). */
const pesoPct: Formato = (n) => pct(Math.round(n * 100));

const DEFINICAO: readonly { painel: PainelParametroTrade; chave: keyof ParametrosPromotor; rotulo: string; formato: Formato }[] = [
  { painel: 'validade', chave: 'validade_critica_dias', rotulo: 'Crítica até', formato: dias },
  { painel: 'validade', chave: 'validade_proxima_dias', rotulo: 'Em atenção até', formato: dias },
  { painel: 'visita-coleta', chave: 'permanencia_min_min', rotulo: 'Permanência mínima', formato: min },
  { painel: 'visita-coleta', chave: 'variacao_preco_max_pct', rotulo: 'Variação de preço sem confirmar', formato: pct },
  { painel: 'gondola', chave: 'peso_parcial_conformidade', rotulo: 'Peso do parcial na conformidade', formato: pesoPct },
];

/** Campos de um painel, na ordem do desenho; `padrao` só aparece quando o valor do tenant difere do padrão (RN-PRO-04/07/08/11). */
export function camposDoPainel(painel: PainelParametroTrade, atual: ParametrosPromotor): CampoParametroTrade[] {
  return DEFINICAO.filter((d) => d.painel === painel).map((d) => {
    const padrao = PARAMETROS_PADRAO[d.chave];
    return { chave: d.chave, rotulo: d.rotulo, valor: d.formato(atual[d.chave]), ...(atual[d.chave] !== padrao ? { padrao: `Padrão: ${d.formato(padrao)}` } : {}) };
  });
}
