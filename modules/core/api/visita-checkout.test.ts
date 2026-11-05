/**
 * T-0039: o push de checkout revalida RN-CORE-12/14 no servidor. Sem banco: o `db` falso responde por trecho de SQL
 * e registra os comandos, para provar que a visita NÃO é gravada como concluída quando o checkout é inválido.
 * Sem relógio real: as horas vêm do próprio payload.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ClienteBanco, ContextoBase, ItemPush } from '@macuxi/platform-sdk';
import { receberCheckouts } from './visita-push';
import type { VerificarEtapas } from './etapas-checkout';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const VISITA = uuid(1);
const CLIENTE = uuid(2);
const USUARIO = uuid(3);
const CHECKIN = new Date('2026-03-10T12:00:00.000Z');

interface Cenario {
  motivos?: Record<string, { tipo: string; codigo: string; ativo: boolean; updated_at?: Date; deleted_at?: Date | null }>;
  modulos?: string[];
}

function montar(c: Cenario = {}) {
  const comandos: string[] = [];
  const params: unknown[][] = [];
  const db = {
    query: vi.fn(async (sql: string, params_: unknown[] = []) => {
      comandos.push(sql);
      params.push(params_);
      if (sql.includes('from core.visita where id = $1 and usuario_id = $2'))
        return { rows: params_[0] === VISITA && params_[1] === USUARIO ? [{ id: VISITA, cliente_id: CLIENTE, checkin_em: CHECKIN, checkout_em: null, checkout_id: null, fechada_por: null }] : [] };
      if (sql.includes('from core.motivo')) return { rows: c.motivos?.[params_[0] as string] ? [c.motivos[params_[0] as string]] : [] };
      return { rows: [] };
    }),
  } as unknown as ClienteBanco;
  const tx = { publicar: vi.fn(async () => undefined), registrarArquivo: vi.fn(async () => undefined) };
  const ctx = {
    usuario: { id: USUARIO, modulos: c.modulos ?? ['core', 'vendedor'] },
    fuso: () => 'America/Manaus',
    agora: () => CHECKIN,
    comTenant: async (fn: (d: ClienteBanco, t: unknown) => Promise<unknown>) => fn(db, tx),
  } as unknown as ContextoBase;
  const item = (payload: Record<string, unknown>): ItemPush => {
    const id = uuid(100);
    return { id, operacao: 'upsert', payload: { id, visita_id: VISITA, checkout_em: '2026-03-10T13:00:00.000Z', resultado: 'sem_pedido', etapas: [], ...payload } } as unknown as ItemPush;
  };
  const gravou = () => comandos.some((s) => s.includes('update core.visita'));
  return { ctx, tx, item, gravou, comandos, params };
}

const semEtapas: VerificarEtapas = async () => [];
const pesquisaPendente: VerificarEtapas = async () => [{ modulo: 'pesquisa', etapa: 'pesquisa.preco', rotulo: 'Pesquisa de preço', obrigatoria: true, concluida: false }];
const pesquisaFeita: VerificarEtapas = async () => [{ modulo: 'pesquisa', etapa: 'pesquisa.preco', rotulo: 'Pesquisa de preço', obrigatoria: true, concluida: true }];

describe('RN-CORE-12: push do visita_checkout revalidado na API', () => {
  it('RN-CORE-12: motivo fora da lista do tenant é rejeitado (MOTIVO_INVALIDO) e a visita não é concluída', async () => {
    const t = montar({ motivos: {} });
    const [r] = await receberCheckouts(t.ctx, [t.item({ motivo_id: uuid(50) })], semEtapas);
    expect(r).toMatchObject({ status: 'rejeitado', codigo: 'MOTIVO_INVALIDO' });
    expect(t.gravou()).toBe(false);
    expect(t.tx.publicar).not.toHaveBeenCalled();
  });

  it('RN-CORE-12: motivo desativado ANTES do checkout é rejeitado', async () => {
    const t = montar({ motivos: { [uuid(50)]: { tipo: 'nao_venda', codigo: 'estoque_alto', ativo: false, updated_at: new Date('2026-03-10T12:30:00.000Z'), deleted_at: null } } });
    const [r] = await receberCheckouts(t.ctx, [t.item({ motivo_id: uuid(50) })], semEtapas);
    expect(r).toMatchObject({ status: 'rejeitado', codigo: 'MOTIVO_INVALIDO' });
    expect(t.gravou()).toBe(false);
  });

  it('RN-CORE-12: motivo desativado DEPOIS do checkout (checkout offline) é aceito', async () => {
    const t = montar({ motivos: { [uuid(50)]: { tipo: 'nao_venda', codigo: 'estoque_alto', ativo: false, updated_at: new Date('2026-03-10T14:00:00.000Z'), deleted_at: null } } });
    const [r] = await receberCheckouts(t.ctx, [t.item({ motivo_id: uuid(50) })], semEtapas);
    expect(r).toMatchObject({ status: 'aceito' });
    expect(t.gravou()).toBe(true);
  });

  it('RN-CORE-12 (T-0039 §2): etapa obrigatória de outro módulo pendente NÃO recusa; o checkout é aceito e grava a pendência', async () => {
    const t = montar({ motivos: { [uuid(50)]: { tipo: 'nao_venda', codigo: 'estoque_alto', ativo: true } } });
    // mesmo com a etapa marcada como concluída pelo aparelho, vale o que o servidor verificou
    const etapas = [{ modulo: 'pesquisa', etapa: 'pesquisa.preco', situacao: 'concluida' }];
    const [r] = await receberCheckouts(t.ctx, [t.item({ motivo_id: uuid(50), etapas })], pesquisaPendente);
    expect(r).toMatchObject({ status: 'aceito' });
    expect(t.gravou()).toBe(true);
    expect(t.tx.publicar).toHaveBeenCalledTimes(1);
    const ins = t.comandos.findIndex((s) => s.includes('insert into core.visita_etapa'));
    expect(ins).toBeGreaterThan(-1);
    expect(t.params[ins]).toEqual([VISITA, 'pesquisa', 'pesquisa.preco', 'pendente', null, 'Pesquisa de preço', CHECKIN.toISOString()]);
    // nunca rebaixa uma linha já concluída e recalcula a contagem na mesma transação
    expect(t.comandos[ins]).toContain("where core.visita_etapa.situacao not in ('concluida', 'dispensada')");
    expect(t.comandos.some((s) => s.includes('set etapas_pendentes'))).toBe(true);
  });

  it('RN-CORE-12: regra do Core continua recusando (422) mesmo com a etapa de outro módulo pendente, e nada é gravado', async () => {
    const t = montar({ motivos: {} });
    const [r] = await receberCheckouts(t.ctx, [t.item({ motivo_id: uuid(50) })], pesquisaPendente);
    expect(r).toMatchObject({ status: 'rejeitado', codigo: 'MOTIVO_INVALIDO' });
    expect(t.gravou()).toBe(false);
    expect(t.comandos.some((s) => s.includes('insert into core.visita_etapa'))).toBe(false);
  });

  it('RN-CORE-12: com a etapa cumprida segundo o servidor, o checkout é aceito e grava a visita', async () => {
    const t = montar({ motivos: { [uuid(50)]: { tipo: 'nao_venda', codigo: 'estoque_alto', ativo: true } } });
    const [r] = await receberCheckouts(t.ctx, [t.item({ motivo_id: uuid(50) })], pesquisaFeita);
    expect(r).toMatchObject({ status: 'aceito' });
    expect(t.gravou()).toBe(true);
    expect(t.tx.publicar).toHaveBeenCalledTimes(1);
  });

  it('RN-CORE-12: visita de outro usuário ou tenant não é encontrada e nada é gravado', async () => {
    const t = montar();
    const outra = { ...t.item({}), payload: { ...(t.item({}).payload as object), visita_id: uuid(999) } } as ItemPush;
    const [r] = await receberCheckouts(t.ctx, [outra], semEtapas);
    expect(r).toMatchObject({ status: 'rejeitado', codigo: 'VISITA_NAO_ENCONTRADA' });
    expect(t.gravou()).toBe(false);
  });

  it('RN-CORE-14: cliente fechado com a etapa pendente é aceito e a etapa fica dispensada', async () => {
    const t = montar({ motivos: { [uuid(51)]: { tipo: 'cliente_fechado', codigo: 'loja_fechada', ativo: true } } });
    const [r] = await receberCheckouts(t.ctx, [t.item({ resultado: 'cliente_fechado', motivo_id: uuid(51), foto_fachada_id: uuid(60) })], pesquisaPendente);
    expect(r).toMatchObject({ status: 'aceito' });
    expect(t.tx.registrarArquivo).toHaveBeenCalledTimes(1);
    const ins = t.comandos.findIndex((s) => s.includes('insert into core.visita_etapa'));
    expect(t.params[ins]?.[3]).toBe('dispensada');
  });
});
