/**
 * T-0173 / v1.0.14 — cards "Pedidos no ERP" (BKO › Pedidos) × regra, integração entre módulos SEM banco:
 * rota real `GET /v1/integracao/monitor` do Hub (`rotaMonitor`, modules/integracao) sobre uma fila `integracao.pedido_fila_erp`
 * em memória → contrato `MonitorResumo.resumo_pedidos` → cards do Vendedor (`cardsPedidosErp`, modules/vendedor/web).
 *
 * Valor × regra: o esperado sai À MÃO da fila, pela RN-INT-08 (estados `pendente` → `enviado` → `rejeitado_erp`), pelo parâmetro
 * `tentativasAlertaPedido` (padrão 5: "Presos sem retorno" = `enviado` com tentativas >= limite, igual ao limite já conta) e pelo
 * rótulo do card ("Retidos sem mapeamento" = retenção por de-para: `mapeamento_ausente`/`mapeamento_ambiguo`, sem a retenção por
 * cadastro, que o próprio Hub separa com `ehRetencaoPorCadastro`). Rótulo × valor: o título do card diz o que o número conta.
 * Também: multi-tenant (a fila de B nunca entra no número de A), licença do módulo (403 MODULO_INATIVO) e perfil (só admin e analista).
 */
import { MonitorResumo } from '@macuxi/integracao/contracts';
import { manifest as core } from '@macuxi/core/manifest';
import { manifest as integracao } from '@macuxi/integracao/manifest';
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import { criarPermissoes, verificarAcao, PERFIS, type ModuloId } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { rotaMonitor } from '../../modules/integracao/api/bko-monitor';
import { cardsPedidosErp } from '../../modules/vendedor/web/lib/cards-erp';

const TENANT_A = '0a000000-0000-4000-8000-0000000000a1';
const TENANT_B = '0b000000-0000-4000-8000-0000000000b2';
const AGORA = new Date('2026-11-15T18:40:00Z'); // 15/11 14:40 em Manaus

type Estado = 'pendente' | 'enviado' | 'integrado' | 'rejeitado_erp' | 'faturado_parcial' | 'faturado_total' | 'cancelado';
interface LinhaFila {
  tenant: string;
  estado: Estado;
  tentativas?: number;
  retencao_codigo?: 'mapeamento_ausente' | 'mapeamento_ambiguo' | 'sequencia_repetida' | null;
  retencao_mensagem?: string | null;
  apagado?: boolean;
}

let seq = 0;
const uuid = () => `0c000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

/** Banco do Hub simulado: só a fila de pedidos tem linhas; as outras leituras do monitor voltam vazias. */
function dbDaFila(fila: readonly LinhaFila[]) {
  const linhas = fila.map((l) => ({ ...l, pedido_uuid: uuid() }));
  const vivos = (tenant: unknown) => linhas.filter((l) => l.tenant === tenant && !l.apagado);
  return {
    query: async (sql: string, params: unknown[] = []) => {
      if (/from integracao\.pedido_fila_erp where tenant_id = \$1 and deleted_at is null group by estado/.test(sql)) {
        const n = new Map<string, number>();
        for (const l of vivos(params[0])) n.set(l.estado, (n.get(l.estado) ?? 0) + 1);
        return { rows: [...n].map(([estado, c]) => ({ estado, n: c })) };
      }
      if (/estado = 'enviado' and tentativas >= \$2/.test(sql))
        return { rows: vivos(params[0]).filter((l) => l.estado === 'enviado' && (l.tentativas ?? 0) >= Number(params[1])) };
      if (/retencao_codigo is not null/.test(sql))
        return { rows: vivos(params[0]).filter((l) => (l.retencao_codigo ?? null) !== null).map((l) => ({ pedido_uuid: l.pedido_uuid, retencao_mensagem: l.retencao_mensagem ?? null })) };
      return { rows: [] };
    },
  };
}

async function monitor(fila: readonly LinhaFila[], o: { tenant?: string; parametros?: Record<string, unknown> } = {}) {
  const db = dbDaFila(fila);
  const ctx = {
    usuario: { id: '0e000000-0000-4000-8000-000000000001', tenant_id: o.tenant ?? TENANT_A, perfil: 'admin' },
    agora: () => AGORA,
    parametros: () => o.parametros ?? {},
    log: { info: () => {}, warn: () => {}, error: () => {} },
    comTenant: async <T,>(fn: (d: unknown, t: unknown) => Promise<T>) => fn(db, {}),
  };
  return MonitorResumo.parse(await rotaMonitor.executar(ctx as never));
}

/** [rótulo, número] de cada card, como a tela mostra. */
const naTela = (m: MonitorResumo) => cardsPedidosErp(m.resumo_pedidos).map((c) => [c.rotulo, c.texto]);

const vezes = (n: number, l: LinhaFila): LinhaFila[] => Array.from({ length: n }, () => ({ ...l }));
const A = (l: Omit<LinhaFila, 'tenant'>, n = 1) => vezes(n, { tenant: TENANT_A, ...l });
const B = (l: Omit<LinhaFila, 'tenant'>, n = 1) => vezes(n, { tenant: TENANT_B, ...l });

describe('T-0173 / RN-INT-08 — cards "Pedidos no ERP" = a fila do ERP do tenant (Hub → contrato → Vendedor)', () => {
  it('caminho feliz: cada card conta o estado do rótulo; Integrado, Faturado e Cancelado não entram em card nenhum', async () => {
    const fila = [
      ...A({ estado: 'pendente' }, 7),
      ...A({ estado: 'enviado', tentativas: 1 }, 3),
      ...A({ estado: 'enviado', tentativas: 5 }, 2), // presos: no limite padrão (5) já conta
      ...A({ estado: 'rejeitado_erp' }, 4),
      ...A({ estado: 'integrado' }, 9),
      ...A({ estado: 'faturado_parcial' }, 2),
      ...A({ estado: 'faturado_total' }, 11),
      ...A({ estado: 'cancelado' }, 6),
      ...A({ estado: 'pendente', apagado: true }, 8), // apagado (deleted_at) não conta
    ];
    // esperado à mão: Na fila = 7 pendentes; Entregue = 3 + 2 enviados; Rejeitado = 4; Presos = 2 (tentativas >= 5); Retidos = 0
    expect(naTela(await monitor(fila))).toEqual([
      ['Na fila', '7'],
      ['Entregue ao Conector', '5'],
      ['Rejeitado pelo ERP', '4'],
      ['Presos sem retorno', '2'],
      ['Retidos sem mapeamento', '0'],
    ]);
  });

  it('fila vazia: os 5 cards mostram 0 (estado sem pedido conta zero) e nenhum fica em destaque', async () => {
    const m = await monitor([]);
    expect(naTela(m).map(([, t]) => t)).toEqual(['0', '0', '0', '0', '0']);
    expect(cardsPedidosErp(m.resumo_pedidos).map((c) => c.tom)).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it('limite dos presos (parâmetro tentativasAlertaPedido): 4 tentativas não é preso, 5 é; com o limite do tenant em 3, 3 já é', async () => {
    const fila = [...A({ estado: 'enviado', tentativas: 3 }), ...A({ estado: 'enviado', tentativas: 4 }), ...A({ estado: 'enviado', tentativas: 5 })];
    expect((await monitor(fila)).resumo_pedidos.presos_sem_retorno).toBe(1);
    expect((await monitor(fila, { parametros: { tentativasAlertaPedido: 3 } })).resumo_pedidos.presos_sem_retorno).toBe(3);
  });

  it('números grandes: 1.234 no padrão pt-BR, sem arredondar', async () => {
    const m = await monitor(A({ estado: 'pendente' }, 1234));
    expect(naTela(m)[0]).toEqual(['Na fila', '1.234']);
  });

  it('multi-tenant: a fila de B nunca entra nos números de A, e B vê só a dele', async () => {
    const fila = [...A({ estado: 'pendente' }, 2), ...B({ estado: 'pendente' }, 5), ...B({ estado: 'rejeitado_erp' }, 1), ...B({ estado: 'enviado', tentativas: 9 }, 1)];
    expect((await monitor(fila)).resumo_pedidos).toEqual({ na_fila: 2, entregue_ao_conector: 0, rejeitado_pelo_erp: 0, presos_sem_retorno: 0, retidos_sem_mapeamento: 0 });
    expect((await monitor(fila, { tenant: TENANT_B })).resumo_pedidos).toEqual({ na_fila: 5, entregue_ao_conector: 1, rejeitado_pelo_erp: 1, presos_sem_retorno: 1, retidos_sem_mapeamento: 0 });
  });

  it('rótulo × valor (D-T0173-A1): "Retidos sem mapeamento" conta só a retenção por de-para, sem a de cadastro nem a de sequência repetida', async () => {
    const fila = [
      ...A({ estado: 'pendente', retencao_codigo: 'mapeamento_ausente', retencao_mensagem: 'Condição 28D sem código do ERP.' }, 2),
      ...A({ estado: 'pendente', retencao_codigo: 'mapeamento_ambiguo', retencao_mensagem: 'Condição AV com dois códigos do ERP.' }, 1),
      // o Hub grava a retenção por cadastro com o código `mapeamento_ausente` e a mensagem com o prefixo de cadastro (pedido-fila.ts)
      ...A({ estado: 'pendente', retencao_codigo: 'mapeamento_ausente', retencao_mensagem: 'Pedido retido por cadastro: cliente sem código do ERP.' }, 4),
      ...A({ estado: 'pendente', retencao_codigo: 'sequencia_repetida', retencao_mensagem: 'Item com sequência repetida.' }, 1),
    ];
    // esperado à mão pelo rótulo: 2 ausentes + 1 ambíguo = 3 sem mapeamento (o de-para resolve só esses)
    expect((await monitor(fila)).resumo_pedidos.retidos_sem_mapeamento).toBe(3);
  });
});

describe('T-0173 — quem vê os números (RN-CORE-03 licença, monitor.ver)', () => {
  const quemPode = (modulos: ModuloId[]) => {
    const p = criarPermissoes([core, integracao, vendedor]);
    return PERFIS.filter((perfil) => verificarAcao({ id: 'x', tenant_id: TENANT_A, perfil, modulos }, p, rotaMonitor.acao!).ok);
  };

  it('a rota dos cards é a do monitor, com a ação monitor.ver: só admin e analista; promotor, vendedor e gestores não', () => {
    expect(rotaMonitor.acao).toBe('monitor.ver');
    expect(quemPode(['core', 'vendedor', 'integracao']).sort()).toEqual(['admin', 'analista']);
  });

  it('sem a licença do Integração, ninguém lê (403 MODULO_INATIVO): os cards somem da tela de Pedidos', () => {
    expect(quemPode(['core', 'vendedor'])).toEqual([]);
    const p = criarPermissoes([core, integracao, vendedor]);
    expect(verificarAcao({ id: 'x', tenant_id: TENANT_A, perfil: 'admin', modulos: ['core', 'vendedor'] }, p, 'monitor.ver')).toMatchObject({ ok: false, status: 403, codigo: 'MODULO_INATIVO' });
  });
});
