/**
 * Estado do Core no aparelho (ADR 0003, desenho T-0001 §13; T-0018). Offline-first: clientes, rota do dia e visitas
 * são MONTADOS das linhas que o sync deixou no aparelho (`motor.linhas`) ⊕ os itens pendentes da fila
 * (`rota-local.ts`, ADR 0009 §3) — não há mais carga REST da Fase M para eles. Check-in e checkout só entram na
 * fila (`motor.enfileirar`, entidades `visita` e `visita_checkout`) e a tela recalcula.
 * No armazenamento do módulo (`motor.armazenamentoDoModulo('core')`, apagado se o módulo for desativado — RN-CORE-02)
 * ficam só `me` (gravado pelo shell), `metas` e `pedidos` (T-0020 e Vendedor ainda na carga da Fase M) e `carregado_em`.
 */
import type { ItemOutbox, LinhaSync, MotorSync } from '@macuxi/platform-sdk';
import { DEFAULT_TZ } from '@macuxi/ui/mobile/puro';

import type {
  ClienteContatoSync,
  ClienteFinanceiroSync,
  ClienteSync,
  CustomerSummary,
  HistoricoCompraSync,
  Me,
  MotivoSync,
  ParametroSync,
  RotaParadaSync,
  RotaSync,
  RouteDay,
  SellerGoals,
  TituloSync,
  VisitaSync,
} from '../../contracts';
import { dataLocal } from '../../domain';
import { montarEstadoLocal } from './rota-local';
import type { LocalVisit } from './route';
import type { OrderLike } from './visit';

export interface EstadoCore {
  carregado: boolean;
  me: Me | null;
  clientes: CustomerSummary[];
  rota: RouteDay | null;
  metas: SellerGoals | null;
  /** Pedidos do mês (servidor), só o que liga pedido à visita. */
  pedidos: OrderLike[];
  visitas: LocalVisit[];
  /** Motivos do tenant (pull `motivo`): lista do checkout (RN-CORE-12/14). */
  motivos: MotivoSync[];
  /** Raio do check-in do tenant (pull `parametro` `checkin.raio_m`, RN-CORE-10); `null` = ainda não sincronizado (vale o padrão do domínio). */
  raioCheckinM: number | null;
  sincronizadoEm: string | null;
}

export const CHAVES = {
  me: 'me',
  metas: 'metas',
  pedidos: 'pedidos',
  /** Cópia de `GET /v1/core/inicio` (etapa `core-inicio`, T-0073); a tela recalcula tudo com `montarInicio`. */
  inicio: 'inicio',
  /** Cópia da própria RV de `GET /v1/core/rv` (etapa `core-rv`, T-0082). */
  rv: 'rv',
  carregadoEm: 'carregado_em',
} as const;

export const ESTADO_VAZIO: EstadoCore = {
  carregado: false,
  me: null,
  clientes: [],
  rota: null,
  metas: null,
  pedidos: [],
  visitas: [],
  motivos: [],
  raioCheckinM: null,
  sincronizadoEm: null,
};

/** RN-CORE-10: valor do parâmetro `core.checkin.raio_m` nas linhas sincronizadas; inválido/ausente = `null`. */
export function raioDosParametros(linhas: readonly { modulo: string; chave: string; valor?: unknown; deleted_at?: string | null }[]): number | null {
  const l = linhas.find((x) => x.modulo === 'core' && x.chave === 'checkin.raio_m' && !x.deleted_at);
  const n = Number(l?.valor);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function fusoDe(me: Me | null, fusoAmbiente?: string | null): string {
  return fusoAmbiente || me?.tenant.timezone || DEFAULT_TZ;
}

/** Id do usuário (UUID da sessão; na demonstração, o vendedor do mock-api). */
export function vendedorDe(me: Me | null): string {
  return me?.seller?.id ?? me?.user.seller_id ?? '';
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

/** Armazém em memória do Core, recalculado das linhas do sync e da fila. Um por motor (por usuário). */
export class ArmazemCore {
  private atual: EstadoCore = ESTADO_VAZIO;
  private ouvintes = new Set<Ouvinte>();
  private carregando: Promise<void> | null = null;
  private pedirOutra = false;

  constructor(private readonly motor: MotorSync) {}

  /** Fuso do tenant: o do login v1 (`ambiente.usuario().fuso`); na demonstração, o do `me`. */
  fuso(me: Me | null): string {
    return fusoDe(me, this.motor.ambiente.usuario()?.fuso);
  }

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

  /** Id do usuário da sessão (o `usuario_id` das visitas e rotas); na demonstração, o do vendedor. */
  usuarioId(me: Me | null): string {
    return this.motor.ambiente.usuario()?.id ?? vendedorDe(me);
  }

  /** Lê o disco e as linhas do aparelho e recalcula. Chamado de novo durante uma leitura, roda mais uma vez ao fim. */
  carregar(): Promise<void> {
    if (this.carregando) {
      this.pedirOutra = true;
      return this.carregando;
    }
    const run = (async () => {
      do {
        this.pedirOutra = false;
        await this.uma();
      } while (this.pedirOutra);
    })();
    this.carregando = run;
    void run.finally(() => {
      this.carregando = null;
    });
    return run;
  }

  private async uma(): Promise<void> {
    const d = this.disco;
    const [me, metas, pedidos, quando] = await Promise.all([d.ler<Me>(CHAVES.me), d.ler<SellerGoals>(CHAVES.metas), d.ler<OrderLike[]>(CHAVES.pedidos), d.ler<string>(CHAVES.carregadoEm)]);
    const m = this.motor;
    const [clientes, financeiros, titulos, historico, contatos, rotas, paradas, visitas, motivos, parametros] = await Promise.all([
      m.linhas<ClienteSync & LinhaSync>('cliente'),
      m.linhas<ClienteFinanceiroSync & LinhaSync>('cliente_financeiro'),
      m.linhas<TituloSync & LinhaSync>('titulo'),
      m.linhas<HistoricoCompraSync & LinhaSync>('historico_compra'),
      m.linhas<ClienteContatoSync & LinhaSync>('cliente_contato'),
      m.linhas<RotaSync & LinhaSync>('rota'),
      m.linhas<RotaParadaSync & LinhaSync>('rota_parada'),
      m.linhas<VisitaSync & LinhaSync>('visita'),
      m.linhas<MotivoSync & LinhaSync>('motivo'),
      m.linhas<ParametroSync & LinhaSync>('parametro'),
    ]);
    const agora = new Date();
    const fuso = this.fuso(me);
    const local = montarEstadoLocal({ clientes, financeiros, titulos, historico, contatos, rotas, paradas, visitas, motivos }, m.sobreposicao(), {
      usuarioId: this.usuarioId(me),
      hoje: dataLocal(agora, fuso),
      fuso,
      agora,
    });
    this.mudar({
      carregado: true,
      me,
      clientes: local.clientes,
      rota: local.rota,
      visitas: local.visitas,
      motivos: motivos.filter((x) => x.ativo),
      raioCheckinM: raioDosParametros(parametros),
      metas: metas ?? null,
      pedidos: pedidos ?? [],
      sincronizadoEm: quando ?? m.estado().sincronizado_em ?? null,
    });
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
