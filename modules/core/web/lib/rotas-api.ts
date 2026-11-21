/**
 * Adaptadores entre `/v1/core/rotas`, `/v1/core/equipe/hierarquia` e `/v1/core/usuarios/:id/clientes` (T-0018) e
 * o modelo do editor de rotas herdado da Fase M (`RouteDay`, `Seller`, `Team`, `CustomerSummary`). O editor (lista,
 * mapa Leaflet, 2-opt, copiar dia) continua igual; só a camada de dados troca. Puro: sem React nem rede.
 */
import type { CustomerSummary, BaseNoMapa, DiaDaPrevia, MembroHierarquia, PutRota, RotasLista, RouteDay, RouteStop, Seller, Team } from '../../contracts';
import { routeDistanceKm, type GeoPoint } from '../../domain';

/** Sem base não há ponto de saída: o km conta a partir do 1º cliente (RN-CORE-75). */
export const SEM_BASE: GeoPoint = { lat: null, lng: null };

/** A base do vendedor como ponto do mapa e do cálculo de km. */
export const pontoDaBase = (b: Pick<BaseNoMapa, 'lat' | 'lng'> | null | undefined): GeoPoint => (b ? { lat: b.lat, lng: b.lng } : SEM_BASE);

type ItemRota = RotasLista['itens'][number];
type ParadaServidor = ItemRota['paradas'][number];

/** Cliente "magro" da carteira do usuário (`GET usuarios/:id/clientes`). */
export interface ClienteDaCarteira {
  id: string;
  nome: string;
  razao_social: string;
  /** Código do cliente no ERP e CNPJ: a busca do editor de rota casa por eles (`clienteCasaBusca`). */
  external_id?: string | null;
  documento?: string | null;
  cidade: string | null;
  bairro: string | null;
  lat: number | null;
  lng: number | null;
  ultima_compra_em: string | null;
  carteira_id?: string;
  papel?: 'vendedor' | 'promotor';
  frequencia_semanas: number | null;
  dia_semana: number | null;
  /** RN-CORE-16: cliente sem os campos mínimos do tenant (pedido só como orçamento). */
  cadastro_incompleto?: boolean;
}

const STATUS: Record<ParadaServidor['status'], RouteStop['status']> = { feita: 'done', em_atendimento: 'in_progress', proxima: 'next', pendente: 'pending' };

const diasDesde = (iso: string | null, hoje: string): number | null => (iso ? Math.max(0, Math.round((Date.parse(`${hoje}T12:00:00Z`) - Date.parse(`${iso}T12:00:00Z`)) / 86_400_000)) : null);

function resumo(base: { id: string; nome: string; razao: string; codigo?: string | null; documento?: string | null; cidade: string | null; bairro: string | null; lat: number | null; lng: number | null; ultima: string | null }, hoje: string): CustomerSummary {
  return {
    id: base.id,
    erp_code: base.codigo ?? '',
    trade_name: base.nome,
    legal_name: base.razao,
    cnpj: base.documento ?? '',
    segment: '',
    abc_curve: 'C',
    address: '',
    city: base.cidade ?? '',
    district: base.bairro ?? '',
    lat: base.lat,
    lng: base.lng,
    phone: '',
    email: '',
    seller_id: '',
    seller_name: '',
    customer_since: '',
    credit_limit_cents: 0,
    open_receivables_cents: 0,
    available_credit_cents: 0,
    overdue_count: 0,
    overdue_cents: 0,
    last_purchase_at: base.ultima,
    days_since_purchase: diasDesde(base.ultima, hoje),
    avg_monthly_cents: 0,
    positivated_this_month: false,
    price_table_id: null,
  };
}

export function clienteDaCarteira(c: ClienteDaCarteira, hoje: string): CustomerSummary {
  return resumo({ id: c.id, nome: c.nome, razao: c.razao_social, codigo: c.external_id, documento: c.documento, cidade: c.cidade, bairro: c.bairro, lat: c.lat, lng: c.lng, ultima: c.ultima_compra_em }, hoje);
}

/** Rota do servidor → `RouteDay` do editor. `inicio` (a base do vendedor) serve ao cálculo de km (base → paradas, estrada ≈ 1,3 × reta). */
export function paraRouteDay(item: ItemRota, hoje: string, inicio: GeoPoint = SEM_BASE): RouteDay {
  const stops: RouteStop[] = item.paradas.map((p) => ({
    id: p.id,
    sequence: p.sequencia,
    window_start: p.janela_inicio ?? '',
    window_end: p.janela_fim ?? '',
    status: STATUS[p.status],
    distance_km: 0,
    customer: resumo({ id: p.cliente_id, nome: p.cliente_nome || 'Cliente', razao: p.cliente_nome || '', cidade: p.cliente_cidade ?? null, bairro: p.cliente_bairro ?? null, lat: p.lat ?? null, lng: p.lng ?? null, ultima: null }, hoje),
    visit: null,
    order_total_cents: null,
  }));
  return {
    id: item.rota?.id ?? null,
    seller_id: item.usuario_id,
    date: item.data,
    status: item.rota?.situacao ?? 'planejada',
    region: item.rota?.regiao ?? '',
    total_km: Math.round(routeDistanceKm(inicio, stops.map((s) => ({ lat: s.customer.lat, lng: s.customer.lng })))),
    stops,
    done_count: item.feitas,
  };
}

type ParadaPendente = { id: string; customer: CustomerSummary; window_start: string; window_end: string };

/** Dia da prévia (RN-CORE-76): nada gravado (sem id), paradas pendentes na ordem dada; o km vem de quem montou a ordem. */
export function diaPendente(dia: { seller_id: string; date: string }, paradas: readonly ParadaPendente[], km: number): RouteDay {
  const stops: RouteStop[] = paradas.map((p, i) => ({
    id: p.id,
    sequence: i + 1,
    window_start: p.window_start,
    window_end: p.window_end,
    status: 'pending',
    distance_km: 0,
    customer: p.customer,
    visit: null,
    order_total_cents: null,
  }));
  return { id: null, seller_id: dia.seller_id, date: dia.date, status: 'planejada', region: '', total_km: km, stops, done_count: 0 };
}

/** Dia da prévia da API → `RouteDay` do editor, com o km que a API calculou (a tela não recalcula). */
export function diaDaPreviaParaRouteDay(dia: Pick<DiaDaPrevia, 'data' | 'paradas' | 'km'>, usuarioId: string, hoje: string): RouteDay {
  const paradas = dia.paradas.map((p) => ({
    id: p.cliente_id,
    window_start: '',
    window_end: '',
    customer: resumo({ id: p.cliente_id, nome: p.nome, razao: p.nome, cidade: p.cidade, bairro: p.bairro, lat: p.lat, lng: p.lng, ultima: null }, hoje),
  }));
  return diaPendente({ seller_id: usuarioId, date: dia.data }, paradas, dia.km);
}

/** Monta vendedores/"equipes" (o superior direto) dos membros que passam no filtro. */
function montarEquipes(membros: readonly MembroHierarquia[], perfis: readonly string[]): { ativos: MembroHierarquia[]; sellers: Seller[]; teams: Team[] } {
  const porId = new Map(membros.map((m) => [m.id, m]));
  const ativos = membros.filter((m) => m.ativo && perfis.includes(m.perfil));
  const teams = new Map<string, Team>();
  const sellers = ativos.map<Seller>((m) => {
    const sup = m.superior_id ? porId.get(m.superior_id) : undefined;
    const teamId = m.superior_id ?? 'sem-equipe';
    if (!teams.has(teamId)) teams.set(teamId, { id: teamId, name: sup ? `Equipe de ${sup.nome}` : 'Sem equipe', manager_user_id: sup?.id ?? null });
    return {
      id: m.id,
      erp_code: '',
      name: m.nome,
      short_name: m.nome.split(' ')[0] ?? m.nome,
      team_id: teamId,
      team_name: teams.get(teamId)!.name,
      branch_id: '',
      max_discount_pct: 0,
      wallet_size: 0,
    };
  });
  return { ativos, sellers: sellers.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')), teams: [...teams.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')) };
}

/** Equipe do BKO para os filtros: vendedores/promotores ativos; "equipe" = o superior direto (supervisor). */
export function equipesDaHierarquia(membros: readonly MembroHierarquia[]): { sellers: Seller[]; teams: Team[]; papeis: Record<string, 'vendedor' | 'promotor'> } {
  const { ativos, sellers, teams } = montarEquipes(membros, ['vendedor', 'promotor']);
  const papeis = Object.fromEntries(ativos.map((m) => [m.id, m.perfil === 'promotor' ? 'promotor' : 'vendedor'])) as Record<string, 'vendedor' | 'promotor'>;
  return { papeis, sellers, teams };
}

/** RN-CORE-13 (T-0187, P1 A): quem pode ter rota no BKO: a equipe de campo, o supervisor (a "equipe" dele é o gerente) e o gerente (sem rastreamento; a carteira da rota é a das equipes abaixo). */
export function donosDeRotaDaHierarquia(membros: readonly MembroHierarquia[]): { sellers: Seller[]; teams: Team[] } {
  const { sellers, teams } = montarEquipes(membros, ['vendedor', 'promotor', 'supervisor', 'gerente']);
  return { sellers, teams };
}

/** Corpo do `PUT /v1/core/rotas/:usuarioId/:data` a partir das paradas do rascunho (horário vazio vira nulo). */
export function corpoDaRota(stops: ReadonlyArray<{ customer: { id: string }; window_start: string; window_end: string }>): PutRota {
  return { paradas: stops.map((s) => ({ cliente_id: s.customer.id, janela_inicio: s.window_start || null, janela_fim: s.window_end || null })) };
}
