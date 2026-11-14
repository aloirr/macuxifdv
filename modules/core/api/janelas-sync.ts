/**
 * Janelas de poda local das entidades de sync do Core (T-0121; ADR 0009 §5). Cada predicado ESPELHA o SQL de `janela`
 * em `sync.ts`/`notificacoes.ts` (`TABELAS_SYNC`) e devolve `true` na dúvida (campo ausente ou formato estranho): a
 * linha só some do aparelho quando é certo que o servidor não a manda mais. `hoje` = `AAAA-MM-DD` (com folga de 24 h).
 */
import { diasAntes, mesesAntes } from '@macuxi/platform-sdk';

type Linha = Readonly<Record<string, unknown>>;
type NaJanela = (linha: Linha, hoje: string) => boolean;

const texto = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Campo de data `>= hoje − n dias`; sem o campo, fica. */
const dataDesde = (campo: string, dias: number): NaJanela => (l, h) => {
  const v = texto(l[campo]);
  return v === null || v.slice(0, 10) >= diasAntes(h, dias);
};

/**
 * SQL da janela `campo >= least(hoje − 40, início do mês anterior)` (T-0170, `performance-produtividade.md` §7.2): a Performance
 * do aparelho mostra o "Mês passado" inteiro. Mesma regra em `dataDesdeMesAnteriorOu40` (poda local).
 */
export const janelaMesAnteriorOu40 = (campo: string): string => `${campo} >= least({{hoje}} - 40, date_trunc('month', {{hoje}} - interval '1 month')::date)`;

/** Poda local de `janelaMesAnteriorOu40`; sem o campo, fica. */
export const dataDesdeMesAnteriorOu40 = (campo: string): NaJanela => (l, h) => {
  const v = texto(l[campo]);
  if (v === null) return true;
  const inicioMesAnterior = `${mesesAntes(h, 1).slice(0, 8)}01`;
  const menos40 = diasAntes(h, 40);
  return v.slice(0, 10) >= (menos40 < inicioMesAnterior ? menos40 : inicioMesAnterior);
};

export const JANELAS_CORE = {
  /** `fim is null or fim >= hoje − 40` */
  carteira: dataDesde('fim', 40),
  /** `situacao = 'aberto' or vencimento >= hoje − 90` */
  titulo: (l, h) => l.situacao === 'aberto' || dataDesde('vencimento', 90)(l, h),
  /** `ano_mes >= hoje − 12 meses` (AAAA-MM) */
  historico_compra: (l, h) => {
    const v = texto(l.ano_mes);
    return v === null || v >= mesesAntes(h, 12).slice(0, 7);
  },
  /** `data >= least(hoje − 40, início do mês anterior)`, sem limite superior */
  rota: dataDesdeMesAnteriorOu40('data'),
  rota_parada: dataDesdeMesAnteriorOu40('data'),
  /** `data_local >= least(hoje − 40, início do mês anterior)` */
  visita: dataDesdeMesAnteriorOu40('data_local'),
  /** `periodo >= hoje − 1 mês` (AAAA-MM) */
  meta: (l, h) => {
    const v = texto(l.periodo);
    return v === null || v >= mesesAntes(h, 1).slice(0, 7);
  },
  /** `data >= início do mês anterior` */
  indicador_diario: (l, h) => {
    const v = texto(l.data);
    return v === null || v.slice(0, 10) >= `${mesesAntes(h, 1).slice(0, 8)}01`;
  },
  /** `created_at >= hoje − 30 dias e (expira_em nulo ou expira_em > agora)` */
  notificacao: (l, h) => {
    const criada = texto(l.created_at);
    const expira = texto(l.expira_em);
    return (criada === null || criada.slice(0, 10) >= diasAntes(h, 30)) && (expira === null || expira.slice(0, 10) >= h);
  },
} as const satisfies Record<string, NaJanela>;
