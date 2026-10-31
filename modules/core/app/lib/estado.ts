/**
 * Estado do Core no aparelho (substitui a parte de carteira, rota, metas e visitas do `app-store.tsx` da
 * Fase M — ADR 0003, desenho T-0001 §13). Offline-first: tudo vive no armazenamento do módulo
 * (`motor.armazenamentoDoModulo('core')`, apagado se o módulo for desativado — RN-CORE-02); as escritas no
 * servidor (check-in, checkout) vão pela fila do motor (`motor.enfileirar`, entidade `visita`).
 *
 * Chaves do módulo: me · clientes · rota · metas · pedidos · extras · visitas · visita_servidor · carregado_em.
 * `me` é gravado pelo shell; as demais, pelas etapas de `cargas.ts` e pelas ações de visita abaixo.
 */
import type { ItemOutbox, MotorSync } from '@macuxi/platform-sdk';
import { DEFAULT_TZ } from '@macuxi/ui/mobile/puro';

import type { CustomerSummary, Me, OpenVisit, Receivable, RouteDay, SellerGoals } from '../../contracts';
import type { LocalVisit } from './route';
import { normalizeVisits, reconcileOpenVisit, type OrderLike, type StoredVisit } from './visit';

/** Ficha do cliente além do resumo: os títulos em aberto (Core). Mix e últimos pedidos são do Vendedor (slots). */
export interface ClienteDetalhe extends CustomerSummary {
  receivables: Receivable[];
}

export interface ExtraCliente {
  detalhe?: ClienteDetalhe;
  at: string;
}

export interface VisitaServidor {
  aberta: OpenVisit;
  /** Quando a consulta `GET /visits/open` começou (visitas criadas depois não são julgadas por ela). */
  buscado_em: string;
}

export interface EstadoCore {
  carregado: boolean;
  me: Me | null;
  clientes: CustomerSummary[];
  rota: RouteDay | null;
  metas: SellerGoals | null;
  /** Pedidos do mês (servidor), só o que liga pedido à visita. */
  pedidos: OrderLike[];
  extras: Record<string, ExtraCliente>;
  visitas: LocalVisit[];
  sincronizadoEm: string | null;
}

export const CHAVES = {
  me: 'me',
  clientes: 'clientes',
  rota: 'rota',
  metas: 'metas',
  pedidos: 'pedidos',
  extras: 'extras',
  visitas: 'visitas',
  visitaServidor: 'visita_servidor',
  carregadoEm: 'carregado_em',
} as const;

export const ESTADO_VAZIO: EstadoCore = {
  carregado: false,
  me: null,
  clientes: [],
  rota: null,
  metas: null,
  pedidos: [],
  extras: {},
  visitas: [],
  sincronizadoEm: null,
};

export function fusoDe(me: Me | null): string {
  return me?.tenant.timezone || DEFAULT_TZ;
}

export function vendedorDe(me: Me | null): string {
  return me?.seller?.id ?? me?.user.seller_id ?? '';
}

/** Ids das visitas com check-in/checkout ainda na fila (o aparelho vale mais que o servidor). */
export function pendentesDaFila(fila: readonly ItemOutbox[]): { checkins: Set<string>; checkouts: Set<string> } {
  const checkins = new Set<string>();
  const checkouts = new Set<string>();
  for (const i of fila) {
    if (i.entidade !== 'visita') continue;
    const p = (i.payload ?? {}) as { id?: string; visit_id?: string };
    if (p.visit_id) checkouts.add(p.visit_id);
    else if (p.id) checkins.add(p.id);
  }
  return { checkins, checkouts };
}

/** Pedidos ainda na fila do aparelho (entidade `pedido` do Vendedor) vistos como `OrderLike` — sem importar o Vendedor. */
export function pedidosDaFila(fila: readonly ItemOutbox[]): OrderLike[] {
  const out: OrderLike[] = [];
  for (const i of fila) {
    if (i.entidade !== 'pedido') continue;
    const p = (i.payload ?? {}) as { id?: string; customer_id?: string; created_offline_at?: string | null; total_cents?: number };
    if (!p.id || !p.customer_id) continue;
    out.push({ id: p.id, number: '', customer_id: p.customer_id, status: 'queued', total_cents: p.total_cents ?? 0, received_at: i.criado_em, created_offline_at: p.created_offline_at ?? i.criado_em });
  }
  return out;
}

type Ouvinte = () => void;

/** Armazém em memória do Core, espelhado no armazenamento do módulo. Um por motor (por usuário). */
export class ArmazemCore {
  private atual: EstadoCore = ESTADO_VAZIO;
  private ouvintes = new Set<Ouvinte>();
  private carregando: Promise<void> | null = null;

  constructor(private readonly motor: MotorSync) {}

  obter = (): EstadoCore => this.atual;

  assinar = (f: Ouvinte): (() => void) => {
    this.ouvintes.add(f);
    return () => this.ouvintes.delete(f);
  };

  private mudar(parcial: Partial<EstadoCore>) {
    this.atual = { ...this.atual, ...parcial };
    for (const f of this.ouvintes) f();
  }

  private get disco() {
    return this.motor.armazenamentoDoModulo('core');
  }

  /** Lê tudo do armazenamento, normaliza as visitas e concilia com o atendimento aberto do servidor. */
  carregar(): Promise<void> {
    if (this.carregando) return this.carregando;
    const run = (async () => {
      const d = this.disco;
      const [me, clientes, rota, metas, pedidos, extras, visitas, servidor, quando] = await Promise.all([
        d.ler<Me>(CHAVES.me),
        d.ler<CustomerSummary[]>(CHAVES.clientes),
        d.ler<RouteDay>(CHAVES.rota),
        d.ler<SellerGoals>(CHAVES.metas),
        d.ler<OrderLike[]>(CHAVES.pedidos),
        d.ler<Record<string, ExtraCliente>>(CHAVES.extras),
        d.ler<StoredVisit[]>(CHAVES.visitas),
        d.ler<VisitaServidor>(CHAVES.visitaServidor),
        d.ler<string>(CHAVES.carregadoEm),
      ]);
      const agora = new Date();
      const tz = fusoDe(me);
      const vendedor = vendedorDe(me);
      let lista = normalizeVisits(visitas ?? [], vendedor, agora, tz);
      let mudou = JSON.stringify(lista) !== JSON.stringify(visitas ?? []);
      if (servidor) {
        const { checkins, checkouts } = pendentesDaFila(this.motor.estado().fila);
        lista = reconcileOpenVisit(lista, servidor.aberta, { sellerId: vendedor, fetchStartedAt: new Date(servidor.buscado_em), pendingCheckins: checkins, pendingCheckouts: checkouts, now: agora });
        await d.remover(CHAVES.visitaServidor);
        mudou = true;
      }
      if (mudou) await d.gravar(CHAVES.visitas, lista);
      this.mudar({ carregado: true, me, clientes: clientes ?? [], rota: rota ?? null, metas: metas ?? null, pedidos: pedidos ?? [], extras: extras ?? {}, visitas: lista, sincronizadoEm: quando ?? null });
    })();
    this.carregando = run;
    void run.finally(() => {
      this.carregando = null;
    });
    return run;
  }

  /** Atualiza as visitas na hora (tela) e grava no aparelho. */
  async atualizarVisitas(fn: (l: LocalVisit[]) => LocalVisit[]): Promise<LocalVisit[]> {
    const proximas = fn(this.atual.visitas);
    this.mudar({ visitas: proximas });
    await this.disco.gravar(CHAVES.visitas, proximas);
    return proximas;
  }

  /** Guarda a ficha detalhada de um cliente e atualiza o resumo dele na carteira. */
  async gravarDetalhe(id: string, detalhe: ClienteDetalhe): Promise<void> {
    const { receivables: _r, ...resumo } = detalhe;
    const extras = { ...this.atual.extras, [id]: { detalhe, at: new Date().toISOString() } };
    const clientes = this.atual.clientes.map((c) => (c.id === id ? (resumo as CustomerSummary) : c));
    this.mudar({ extras, clientes });
    await Promise.all([this.disco.gravar(CHAVES.extras, extras), this.disco.gravar(CHAVES.clientes, clientes)]);
  }
}

const armazens = new WeakMap<MotorSync, ArmazemCore>();

export function armazemDe(motor: MotorSync): ArmazemCore {
  let a = armazens.get(motor);
  if (!a) {
    a = new ArmazemCore(motor);
    armazens.set(motor, a);
  }
  return a;
}
