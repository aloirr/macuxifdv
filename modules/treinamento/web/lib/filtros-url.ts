/**
 * Filtros da página Trilhas na URL (BKO: quem recarrega ou compartilha o link vê a mesma tela). Funções puras
 * (testadas); o hook que liga ao navegador está em `use-filtros.ts`.
 */
import { STATUS_TRILHA } from '../../contracts';

export const ABAS = ['adesao', 'pessoas', 'trilhas'] as const;
export type Aba = (typeof ABAS)[number];

export interface FiltrosTrilhas {
  /** vazio = a primeira aba que o perfil pode ver */
  aba: Aba | '';
  /** AAAA-MM; vazio = mês atual (a API decide, no fuso do tenant) */
  mes: string;
  /** UUID da equipe; vazio = todo o escopo do perfil */
  equipe: string;
  /** status da trilha no cadastro; vazio = todos */
  status: string;
  busca: string;
}

export const FILTROS_VAZIOS: FiltrosTrilhas = { aba: '', mes: '', equipe: '', status: '', busca: '' };

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lê a querystring ignorando o que não faz sentido (link velho ou digitado à mão). */
export function lerFiltros(busca: string): FiltrosTrilhas {
  const p = new URLSearchParams(busca);
  const aba = p.get('aba') ?? '';
  const mes = p.get('mes') ?? '';
  const equipe = p.get('equipe') ?? '';
  const status = p.get('status') ?? '';
  return {
    aba: (ABAS as readonly string[]).includes(aba) ? (aba as Aba) : '',
    mes: MES.test(mes) ? mes : '',
    equipe: UUID.test(equipe) ? equipe : '',
    status: (STATUS_TRILHA as readonly string[]).includes(status) ? status : '',
    busca: (p.get('busca') ?? '').slice(0, 100),
  };
}

/** Querystring só com o que está preenchido (`''` quando não há filtro). */
export function paraBusca(f: FiltrosTrilhas): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Query de `GET /treinamento/adesao` e `/adesao/pessoas` (RF-TRE-05). */
export function queryDoPainel(f: FiltrosTrilhas): Record<string, string> {
  // enquanto o id da equipe está sendo digitado (incompleto), o painel fica no escopo inteiro
  return { ...(MES.test(f.mes) ? { mes: f.mes } : {}), ...(UUID.test(f.equipe) ? { equipe_id: f.equipe } : {}) };
}

/** Query de `GET /treinamento/bko/trilhas` (RF-TRE-01). */
export function queryDasTrilhas(f: FiltrosTrilhas): Record<string, string> {
  const busca = f.busca.trim();
  return { ...(f.status ? { status: f.status } : {}), ...(busca ? { busca } : {}) };
}

/** Aba que abre: a pedida na URL, se o perfil pode; senão a primeira permitida; null se nenhuma. */
export function abaVisivel(pedida: Aba | '', permitidas: Readonly<Record<Aba, boolean>>): Aba | null {
  if (pedida && permitidas[pedida]) return pedida;
  return ABAS.find((a) => permitidas[a]) ?? null;
}
