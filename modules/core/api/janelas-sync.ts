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
  /** `data >= hoje − 40`, sem limite superior */
  rota: dataDesde('data', 40),
  rota_parada: dataDesde('data', 40),
  /** `data_local >= hoje − 40` */
  visita: dataDesde('data_local', 40),
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
