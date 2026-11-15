import { PARAMETROS_PADRAO, type ParametrosPromotor } from '../../domain/parametros';

/**
 * Parâmetros › Trade (ADR 0058, D7): os 5 parâmetros do Promotor em 3 painéis, só leitura (a rota de gravação é lote futuro).
 * Valor atual vindo da API e "Padrão: X" só quando difere do padrão do domain (RN-PRO-04, RN-PRO-07, RN-PRO-08, RN-PRO-11). Sem React.
 */
export interface CampoParametroTrade {
  chave: keyof ParametrosPromotor;
  rotulo: string;
  ajuda: string;
  /** Valor atual formatado, ex.: "7 dias". */
  valor: string;
  /** "Padrão: 30 dias"; ausente quando o valor é o padrão. */
  padrao?: string;
}

export interface PainelParametroTrade {
  id: 'validade' | 'visita-coleta' | 'gondola';
  titulo: string;
  campos: CampoParametroTrade[];
}

type Formato = (n: number) => string;
const num = (n: number) => String(n).replace('.', ',');
const dias: Formato = (n) => `${num(n)} ${n === 1 ? 'dia' : 'dias'}`;
const min: Formato = (n) => `${num(n)} min`;
const pct: Formato = (n) => `${num(n)}%`;

const DEFINICAO: readonly { painel: PainelParametroTrade['id']; titulo: string; chave: keyof ParametrosPromotor; rotulo: string; ajuda: string; formato: Formato }[] = [
  { painel: 'validade', titulo: 'Validade', chave: 'validade_critica_dias', rotulo: 'Crítica até', ajuda: 'Dias para vencer.', formato: dias },
  { painel: 'validade', titulo: 'Validade', chave: 'validade_proxima_dias', rotulo: 'Em atenção até', ajuda: 'Acima disso, ok.', formato: dias },
  { painel: 'visita-coleta', titulo: 'Visita e coleta', chave: 'permanencia_min_min', rotulo: 'Permanência mínima', ajuda: 'Para contar nos indicadores.', formato: min },
  { painel: 'visita-coleta', titulo: 'Visita e coleta', chave: 'variacao_preco_max_pct', rotulo: 'Variação de preço sem confirmar', ajuda: 'Sobre a última coleta.', formato: pct },
  { painel: 'gondola', titulo: 'Gôndola', chave: 'peso_parcial_conformidade', rotulo: 'Peso do parcial na conformidade', ajuda: 'De 0 a 1.', formato: num },
];

/** Monta os painéis na ordem do desenho; `padrao` só aparece quando o valor do tenant difere do padrão (RN-PRO-04/07/08/11). */
export function painelDeParametrosTrade(atual: ParametrosPromotor): PainelParametroTrade[] {
  const paineis: PainelParametroTrade[] = [];
  for (const d of DEFINICAO) {
    let p = paineis.find((x) => x.id === d.painel);
    if (!p) paineis.push((p = { id: d.painel, titulo: d.titulo, campos: [] }));
    const padrao = PARAMETROS_PADRAO[d.chave];
    p.campos.push({ chave: d.chave, rotulo: d.rotulo, ajuda: d.ajuda, valor: d.formato(atual[d.chave]), ...(atual[d.chave] !== padrao ? { padrao: `Padrão: ${d.formato(padrao)}` } : {}) });
  }
  return paineis;
}
