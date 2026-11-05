/**
 * Barramento de eventos de domínio (docs/produto/04 "Comunicação entre módulos").
 *
 * - Nome `<modulo>.<entidade>.<fato>@vN`; o schema Zod fica em `modules/<publicador>/contracts`.
 * - Publicar = gravar o envelope na OUTBOX (na API real: tabela `plataforma.evento`, na mesma
 *   transação da escrita de negócio). A entrega é feita depois (pg-boss) chamando `entregar`.
 * - Consumo idempotente por (`consumidor`, `evento_id`).
 * - Só publica quem declarou o evento em `publica` no manifesto; só assina quem declarou em `consome`.
 *
 * Aqui ficam o contrato e uma implementação em memória (testes e dev). O adaptador Postgres +
 * pg-boss mora em apps/api.
 *
 * Subpath leve `@macuxi/platform-sdk/eventos` (T-0024, decisão a): os `contracts` que também rodam fora da API (o da
 * Integracao vai no pacote do Conector) importam `definirEvento` daqui, sem puxar o índice inteiro do SDK. Por isso este
 * arquivo só importa em tempo de execução `./nomes` (conferido em `eventos-subpath.test.ts`).
 */
import type { z } from 'zod';
import type { Manifesto } from './manifesto';
import type { ModuloId } from './nomes';
import { lerNomeEvento } from './nomes';

export interface DefinicaoEvento<S extends z.ZodTypeAny = z.ZodTypeAny> {
  nome: string;
  modulo: string;
  entidade: string;
  fato: string;
  versao: number;
  schema: S;
}

export function definirEvento<S extends z.ZodTypeAny>(nome: string, schema: S): DefinicaoEvento<S> {
  const n = lerNomeEvento(nome);
  if (!n) throw new Error(`Nome de evento inválido: ${nome} (use <modulo>.<entidade>.<fato>@vN)`);
  return { nome, ...n, schema };
}

export interface ContextoEvento {
  tenant_id: string;
  usuario_id?: string | null;
  request_id?: string | null;
}

export interface EnvelopeEvento<P = unknown> {
  evento_id: string;
  nome: string;
  origem: ModuloId;
  tenant_id: string;
  usuario_id: string | null;
  request_id: string | null;
  /** Instante UTC (ISO 8601 com Z). */
  ocorrido_em: string;
  payload: P;
}

export interface Outbox {
  gravar(envelope: EnvelopeEvento): Promise<void>;
}

export interface RegistroConsumo {
  jaProcessado(consumidor: ModuloId, eventoId: string): Promise<boolean>;
  marcarProcessado(consumidor: ModuloId, eventoId: string): Promise<void>;
}

export type Manipulador<P> = (payload: P, envelope: EnvelopeEvento<P>) => Promise<void> | void;

export interface ResultadoEntrega {
  entregues: ModuloId[];
  /** Já processado antes (idempotência) ou consumidor inativo no tenant. */
  ignorados: { modulo: ModuloId; motivo: 'ja_processado' | 'modulo_inativo' }[];
  /** Falhou: não marca como processado, a fila tenta de novo. */
  falhas: { modulo: ModuloId; erro: string }[];
}

export interface OpcoesBarramento {
  manifestos: readonly Manifesto[];
  outbox: Outbox;
  consumo: RegistroConsumo;
  /** Licença do consumidor no tenant; padrão: sempre ativo. */
  estaAtivo?: (tenantId: string, modulo: ModuloId) => boolean | Promise<boolean>;
  gerarId?: () => string;
  agora?: () => Date;
}

export class ErroEvento extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErroEvento';
  }
}

/** UUID v4 do ambiente (Node 20+, navegadores e Hermes com polyfill expo-crypto). */
export function uuidDoAmbiente(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (!c?.randomUUID) throw new Error('crypto.randomUUID indisponível: informe gerarId');
  return c.randomUUID();
}

export function criarBarramento(op: OpcoesBarramento) {
  const porId = new Map(op.manifestos.map((m) => [m.id, m] as const));
  const assinaturas = new Map<string, { modulo: ModuloId; def: DefinicaoEvento; fn: Manipulador<unknown> }[]>();
  const gerarId = op.gerarId ?? uuidDoAmbiente;
  const agora = op.agora ?? (() => new Date());

  const manifestoDe = (modulo: ModuloId) => {
    const m = porId.get(modulo);
    if (!m) throw new ErroEvento(`Módulo ${modulo} não está instalado`);
    return m;
  };

  return {
    async publicar<S extends z.ZodTypeAny>(
      modulo: ModuloId,
      def: DefinicaoEvento<S>,
      payload: z.input<S>,
      ctx: ContextoEvento,
    ): Promise<EnvelopeEvento<z.output<S>>> {
      if (def.modulo !== modulo) throw new ErroEvento(`${modulo} não pode publicar ${def.nome} (evento de ${def.modulo})`);
      if (!manifestoDe(modulo).publica.includes(def.nome)) {
        throw new ErroEvento(`${def.nome} não está em "publica" do manifesto de ${modulo}`);
      }
      if (!ctx.tenant_id) throw new ErroEvento('tenant_id obrigatório no evento');
      const valido = def.schema.safeParse(payload);
      if (!valido.success) throw new ErroEvento(`Payload inválido para ${def.nome}: ${valido.error.issues.map((i) => i.message).join('; ')}`);
      const envelope: EnvelopeEvento<z.output<S>> = {
        evento_id: gerarId(),
        nome: def.nome,
        origem: modulo,
        tenant_id: ctx.tenant_id,
        usuario_id: ctx.usuario_id ?? null,
        request_id: ctx.request_id ?? null,
        ocorrido_em: agora().toISOString(),
        payload: valido.data,
      };
      await op.outbox.gravar(envelope);
      return envelope;
    },

    assinar<S extends z.ZodTypeAny>(modulo: ModuloId, def: DefinicaoEvento<S>, fn: Manipulador<z.output<S>>): void {
      if (!manifestoDe(modulo).consome.includes(def.nome)) {
        throw new ErroEvento(`${def.nome} não está em "consome" do manifesto de ${modulo}`);
      }
      const lista = assinaturas.get(def.nome) ?? [];
      if (lista.some((a) => a.modulo === modulo)) throw new ErroEvento(`${modulo} já assina ${def.nome}`);
      lista.push({ modulo, def, fn: fn as Manipulador<unknown> });
      assinaturas.set(def.nome, lista);
    },

    /** Chamado pelo worker da fila para cada envelope lido da outbox. */
    async entregar(envelope: EnvelopeEvento): Promise<ResultadoEntrega> {
      const r: ResultadoEntrega = { entregues: [], ignorados: [], falhas: [] };
      for (const a of assinaturas.get(envelope.nome) ?? []) {
        if (op.estaAtivo && !(await op.estaAtivo(envelope.tenant_id, a.modulo))) {
          r.ignorados.push({ modulo: a.modulo, motivo: 'modulo_inativo' });
          continue;
        }
        if (await op.consumo.jaProcessado(a.modulo, envelope.evento_id)) {
          r.ignorados.push({ modulo: a.modulo, motivo: 'ja_processado' });
          continue;
        }
        try {
          const payload = a.def.schema.parse(envelope.payload);
          await a.fn(payload, { ...envelope, payload });
          await op.consumo.marcarProcessado(a.modulo, envelope.evento_id);
          r.entregues.push(a.modulo);
        } catch (e) {
          r.falhas.push({ modulo: a.modulo, erro: e instanceof Error ? e.message : String(e) });
        }
      }
      return r;
    },

    assinantes(nome: string): ModuloId[] {
      return (assinaturas.get(nome) ?? []).map((a) => a.modulo);
    },
  };
}

export type Barramento = ReturnType<typeof criarBarramento>;

/** Outbox em memória (testes e dev). */
export function criarOutboxEmMemoria() {
  const fila: EnvelopeEvento[] = [];
  return {
    async gravar(envelope: EnvelopeEvento) {
      fila.push(envelope);
    },
    pendentes(): readonly EnvelopeEvento[] {
      return fila;
    },
    retirar(): EnvelopeEvento[] {
      return fila.splice(0, fila.length);
    },
  } satisfies Outbox & Record<string, unknown>;
}

/** Registro de consumo em memória (testes e dev). */
export function criarConsumoEmMemoria(): RegistroConsumo {
  const feitos = new Set<string>();
  return {
    async jaProcessado(consumidor, eventoId) {
      return feitos.has(`${consumidor}:${eventoId}`);
    },
    async marcarProcessado(consumidor, eventoId) {
      feitos.add(`${consumidor}:${eventoId}`);
    },
  };
}
