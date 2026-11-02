/**
 * Persistência do Gestor atrás de uma interface (T-0055). A migração do schema `gestor` (read-models
 * `painel_vendedor_dia`, `alerta`, regras e estado da projeção) é do banco-dados e ainda não está no main: até ela chegar
 * a API usa `criarRepositorioEmMemoria()` (por processo, por tenant). Trocar pela implementação SQL = outra fábrica
 * com a MESMA interface, usando o `db` da transação do tenant (RLS); rotas e consumidores não mudam.
 *
 * Cada operação recebe o acesso da transação (`db` + `tenant_id` do TOKEN ou do ENVELOPE): nunca do corpo/query.
 */
import type { ClienteBanco } from '@macuxi/platform-sdk';
import type { AjustesRegras, Alerta } from '../contracts';
import { aplicarEventos, estadoInicial, type EstadoProjecao, type EventoRecebido, type OperacoesAlerta, type SituacaoAplicacao } from '../domain';

export interface AcessoTenant {
  db: ClienteBanco;
  tenant_id: string;
}

export interface RepositorioGestor {
  /** Estado da projeção do tenant (somente leitura para quem chama). */
  estado(a: AcessoTenant): Promise<EstadoProjecao>;
  /** Aplica eventos (idempotente por `evento_id` e por chave de negócio: `aplicarEvento` do domain). */
  aplicar(a: AcessoTenant, eventos: readonly EventoRecebido[]): Promise<{ contagem: Record<SituacaoAplicacao, number>; avisos: number }>;
  alertas(a: AcessoTenant): Promise<Alerta[]>;
  /** Grava o resultado de `reconciliarAlertas` (abrir/atualizar/encerrar). `novoId` gera o UUID dos novos. */
  aplicarOperacoesAlerta(a: AcessoTenant, ops: OperacoesAlerta, o: { agora: string; novoId: () => string }): Promise<void>;
  /** Grava um alerta já alterado (ex.: dispensado). */
  gravarAlerta(a: AcessoTenant, alerta: Alerta): Promise<void>;
  ajustesRegras(a: AcessoTenant): Promise<AjustesRegras>;
  gravarAjustesRegras(a: AcessoTenant, ajustes: AjustesRegras): Promise<void>;
}

interface DadosTenant {
  estado: EstadoProjecao;
  alertas: Map<string, Alerta>;
  ajustes: AjustesRegras;
}

/**
 * Implementação em memória (padrão até a migração do banco-dados). Isolada por `tenant_id` (RN-CORE-05): um tenant
 * nunca lê o mapa do outro. Perde-se ao reiniciar o processo: os eventos novos voltam a alimentar a projeção.
 * Devolve CÓPIAS (quem chama não altera o guardado sem passar pelo repositório).
 */
export function criarRepositorioEmMemoria(): RepositorioGestor & { limpar(): void } {
  const porTenant = new Map<string, DadosTenant>();
  const dados = (tenant: string): DadosTenant => {
    let d = porTenant.get(tenant);
    if (!d) {
      d = { estado: estadoInicial(), alertas: new Map(), ajustes: {} };
      porTenant.set(tenant, d);
    }
    return d;
  };
  const copia = <T>(x: T): T => structuredClone(x);

  return {
    limpar: () => porTenant.clear(),
    async estado(a) {
      return dados(a.tenant_id).estado;
    },
    async aplicar(a, eventos) {
      const d = dados(a.tenant_id);
      const r = aplicarEventos(d.estado, eventos);
      d.estado = r.estado;
      return { contagem: r.contagem, avisos: r.avisos };
    },
    async alertas(a) {
      return [...dados(a.tenant_id).alertas.values()].map(copia);
    },
    async aplicarOperacoesAlerta(a, ops, o) {
      const d = dados(a.tenant_id);
      for (const c of ops.abrir) {
        const id = o.novoId();
        d.alertas.set(id, { ...c, id, status: 'aberto', aberto_em: o.agora, encerrado_em: null, motivo_encerramento: null });
      }
      for (const x of ops.atualizar) {
        const atual = d.alertas.get(x.id);
        if (atual) d.alertas.set(x.id, { ...atual, valor: x.valor, mensagem: x.mensagem, severidade: x.severidade });
      }
      for (const x of ops.encerrar) {
        const atual = d.alertas.get(x.id);
        if (atual) d.alertas.set(x.id, { ...atual, status: 'encerrado', encerrado_em: x.encerrado_em, motivo_encerramento: x.motivo });
      }
    },
    async gravarAlerta(a, alerta) {
      dados(a.tenant_id).alertas.set(alerta.id, copia(alerta));
    },
    async ajustesRegras(a) {
      return copia(dados(a.tenant_id).ajustes);
    },
    async gravarAjustesRegras(a, ajustes) {
      dados(a.tenant_id).ajustes = copia(ajustes);
    },
  };
}
