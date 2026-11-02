/**
 * Fixture dois-tenants — schema `gestor` (0014, T-0055). Uma linha (ou mais) em cada tabela nos DOIS tenants, para o
 * teste de vazamento (RLS) e a conformidade cobrirem as tabelas novas. Ids fixos com o prefixo do tenant (grupos
 * 0x70–0x73, reservados ao Gestor). Instantes FIXOS (fixture idempotente: recarregar não muda nada; nenhum teste
 * compara estes instantes com o relógio). Ligada em dois-tenants.ts (ORDEM_GESTOR e dadosGestor).
 */
import type { Linha } from '../../src/gravar';
import { idFixo } from '../../src/ids';

const G = { evento_aplicado: 0x70, projecao_fato: 0x71, alerta: 0x72, alerta_regra: 0x73 } as const;
export const idGestorA = (grupo: keyof typeof G, seq: number) => idFixo('aaaaaaaa', G[grupo], seq);
export const idGestorB = (grupo: keyof typeof G, seq: number) => idFixo('bbbbbbbb', G[grupo], seq);

/** Ordem de gravação (sem FK entre elas). */
export const ORDEM_GESTOR = ['gestor.evento_aplicado', 'gestor.projecao_fato', 'gestor.alerta', 'gestor.alerta_regra'] as const;
export type TabelaGestor = (typeof ORDEM_GESTOR)[number];

const INSTANTE_FIXO = '2026-10-30T13:00:00Z';
/** Carimbo do domain: `<ms com 15 dígitos>|<evento_id>`. */
const carimbo = (iso: string, eventoId: string) => `${String(Date.parse(iso)).padStart(15, '0')}|${eventoId}`;

interface Pessoas {
  tenant: string;
  vendedor: string;
  cliente: string;
  ab: (grupo: keyof typeof G, seq: number) => string;
}

function doTenant(p: Pessoas): Record<TabelaGestor, Linha[]> {
  const evento = p.ab('evento_aplicado', 1);
  const v = carimbo(INSTANTE_FIXO, evento);
  return {
    'gestor.evento_aplicado': [{ id: evento, tenant_id: p.tenant, evento_id: evento, nome: 'core.cliente.atualizado@1', ocorrido_em: INSTANTE_FIXO, deleted_at: null, external_id: null }],
    'gestor.projecao_fato': [
      {
        id: p.ab('projecao_fato', 1), tenant_id: p.tenant, tabela: 'clientes', chave: p.cliente, carimbo: v,
        dados: JSON.stringify({ cliente_id: p.cliente, vendedor_id: p.vendedor, ativo: true, frequencia_visita: null, na_carteira_desde: null, v }),
        ocorrido_em: INSTANTE_FIXO, usuario_id: p.vendedor, deleted_at: null, external_id: null,
      },
      {
        id: p.ab('projecao_fato', 2), tenant_id: p.tenant, tabela: 'entradas_carteira', chave: `${p.cliente}|${p.vendedor}`, carimbo: v,
        dados: JSON.stringify(INSTANTE_FIXO), ocorrido_em: INSTANTE_FIXO, usuario_id: p.vendedor, deleted_at: null, external_id: null,
      },
    ],
    'gestor.alerta': [
      {
        id: p.ab('alerta', 1), tenant_id: p.tenant, chave: `cliente_sem_visita:${p.cliente}`, tipo: 'cliente_sem_visita', alvo_tipo: 'cliente', alvo_id: p.cliente,
        responsavel_id: p.vendedor, valor: 21, limiar: 14, severidade: 'atencao', mensagem: 'Cliente sem visita há 21 dias (limite 14).', status: 'aberto',
        aberto_em: INSTANTE_FIXO, encerrado_em: null, motivo_encerramento: null, deleted_at: null, external_id: null,
      },
    ],
    'gestor.alerta_regra': [
      { id: p.ab('alerta_regra', 1), tenant_id: p.tenant, tipo: 'cliente_sem_visita', ajuste: JSON.stringify({ limiar: 14 }), atualizado_por_id: null, deleted_at: null, external_id: null },
    ],
  };
}

/** Linhas do schema gestor para A e B (vendedor e cliente de cada tenant da fixture). */
export function dadosGestor(A: { tenant: string; vendedor: string; cliente: string }, B: { tenant: string; vendedor: string; cliente: string }): Record<TabelaGestor, Linha[]> {
  const a = doTenant({ ...A, ab: idGestorA });
  const b = doTenant({ ...B, ab: idGestorB });
  return Object.fromEntries(ORDEM_GESTOR.map((t) => [t, [...a[t], ...b[t]]])) as Record<TabelaGestor, Linha[]>;
}
