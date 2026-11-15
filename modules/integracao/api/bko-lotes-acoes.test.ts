import { describe, expect, it } from 'vitest';
import { ErroHttpModulo } from '@macuxi/platform-sdk';
import { criarLimiteTentativas, criarRotaReprocessarLote, rotaCancelarLote, rotaCodigosMacuxi, rotaListarAutorizadores, type ResultadoSenha } from './bko-lotes-acoes';

const LOTE = '0b7e6c52-1c1c-4b43-9d1e-0a4f0f3a1111';
const ADMIN = '11111111-1111-4111-8111-111111111111';
const GERENTE = '22222222-2222-4222-8222-222222222222';
const SENHA = 'segredo-que-nao-pode-vazar';

interface Cenario {
  status: string;
  staging?: boolean;
  perfisPermitidos?: boolean;
}

function montar(c: Cenario) {
  const sqls: string[] = [];
  const auditoria: Array<Record<string, unknown>> = [];
  const eventos: unknown[] = [];
  const logs: unknown[] = [];
  const db = {
    query: async (sql: string) => {
      sqls.push(sql);
      if (/from integracao\.lote where/.test(sql)) return { rows: [{ id: LOTE, entidade: 'cliente', status: c.status, com_erro: 3, recebidas: 10 }] };
      if (/from integracao\.lote_staging/.test(sql)) return { rows: [{ tem: c.staging !== false }] };
      if (/join integracao\.conector/.test(sql)) return { rows: [{ conector: 'erp-1', entidade: 'cliente', modo: 'delta' }] };
      return { rows: [] };
    },
  };
  const tx = {
    auditar: async (r: Record<string, unknown>) => void auditoria.push(r),
    publicar: async (_d: unknown, p: unknown) => void eventos.push(p),
    consultar: async (def: { nome: string }) => {
      if (def.nome === 'core.usuarios_resumo@1') {
        return {
          usuarios: [
            { id: ADMIN, nome: 'Ana', perfil: 'admin', equipe_id: null, regional_id: null, ativo: true },
            { id: GERENTE, nome: 'Gil', perfil: 'gerente', equipe_id: null, regional_id: null, ativo: true },
            { id: '33333333-3333-4333-8333-333333333333', nome: 'Bia', perfil: 'analista', equipe_id: null, regional_id: null, ativo: false },
          ],
          proximo_cursor: null,
        };
      }
      return { formas: [{ codigo: 'B', nome: 'Boleto', ativo: true }, { codigo: 'A', nome: 'À vista', ativo: false }] };
    },
  };
  const perfis = c.perfisPermitidos ? [{ codigo: 'p', base: 'analista', permissoes: { 'lote.reprocessar': {} } }] : [];
  const ctx = {
    usuario: { id: 'u1', tenant_id: 't1', perfil: 'analista', perfis },
    params: { id: LOTE },
    agora: () => new Date('2026-11-15T18:00:00Z'),
    comTenant: async (fn: (d: unknown, t: unknown) => unknown) => fn(db, tx),
    log: { info: (...a: unknown[]) => logs.push(a), warn: (...a: unknown[]) => logs.push(a), error: (...a: unknown[]) => logs.push(a) },
  };
  return { ctx, sqls, auditoria, eventos, logs };
}

const executar = (r: { executar: (c: never) => Promise<unknown> }, ctx: unknown, extra: Record<string, unknown> = {}) => r.executar({ ...(ctx as object), ...extra } as never);
const erroDe = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as ErroHttpModulo;
  }
  throw new Error('era para falhar');
};

describe('RN-INT-15: cancelar lote', () => {
  it('RN-INT-15: lote em andamento vira cancelado e a auditoria grava o estado anterior', async () => {
    const m = montar({ status: 'processando' });
    expect(await executar(rotaCancelarLote, m.ctx)).toEqual({ lote_id: LOTE, status: 'cancelado' });
    expect(m.sqls.some((s) => /status = 'cancelado'/.test(s))).toBe(true);
    expect(m.auditoria[0]).toMatchObject({ acao: 'lote.cancelar', entidade_id: LOTE, antes: { status: 'processando' } });
  });

  it('RN-INT-15: lote que não está em andamento responde 409', async () => {
    for (const status of ['concluido', 'concluido_com_erros', 'falhou', 'cancelado']) {
      const e = await erroDe(executar(rotaCancelarLote, montar({ status }).ctx));
      expect(e.status, status).toBe(409);
      expect(e.codigo).toBe('lote_nao_esta_em_andamento');
    }
  });

  it('RN-INT-15: a rota exige a ação lote.cancelar', () => {
    expect(rotaCancelarLote.acao).toBe('lote.cancelar');
  });
});

describe('RN-INT-15/16: reprocessar lote', () => {
  const nunca = async (): Promise<ResultadoSenha> => {
    throw new Error('não deveria conferir senha');
  };

  it('RN-INT-15: quem tem lote.reprocessar reprocessa direto: volta para a fila e publica o lote recebido', async () => {
    const m = montar({ status: 'falhou', perfisPermitidos: true });
    const rota = criarRotaReprocessarLote({ verificarSenha: nunca, limite: criarLimiteTentativas() });
    expect(await executar(rota, m.ctx, { corpo: {} })).toEqual({ lote_id: LOTE, reenfileiradas: 3, status: 'recebido' });
    expect(m.eventos).toHaveLength(1);
    expect(m.auditoria[0]).toMatchObject({ acao: 'lote.reprocessar', depois: { via: 'direto', autorizado_por: null } });
  });

  it('RN-INT-15: só Com falha e Concluído com avisos reprocessam; os outros dão 409', async () => {
    const rota = criarRotaReprocessarLote({ verificarSenha: nunca, limite: criarLimiteTentativas() });
    for (const status of ['recebido', 'processando', 'concluido', 'cancelado']) {
      const e = await erroDe(executar(rota, montar({ status, perfisPermitidos: true }).ctx, { corpo: {} }));
      expect(e.status, status).toBe(409);
    }
    expect((await executar(rota, montar({ status: 'concluido_com_erros', perfisPermitidos: true }).ctx, { corpo: {} })) as { status: string }).toMatchObject({ status: 'recebido' });
  });

  it('RN-INT-15: conteúdo já apagado do staging não reprocessa (409 com a ação seguinte)', async () => {
    const rota = criarRotaReprocessarLote({ verificarSenha: nunca, limite: criarLimiteTentativas() });
    const e = await erroDe(executar(rota, montar({ status: 'falhou', staging: false, perfisPermitidos: true }).ctx, { corpo: {} }));
    expect(e.codigo).toBe('conteudo_expirado');
  });

  it('RN-INT-16: sem a permissão e sem autorizador, 403 pedindo o autorizador', async () => {
    const rota = criarRotaReprocessarLote({ verificarSenha: nunca, limite: criarLimiteTentativas() });
    const e = await erroDe(executar(rota, montar({ status: 'falhou' }).ctx, { corpo: {} }));
    expect(e.status).toBe(403);
    expect(e.codigo).toBe('autorizador_necessario');
  });

  it('RN-INT-16: senha certa de quem tem lote.reprocessar autoriza e a auditoria grava quem autorizou, sem a senha', async () => {
    const m = montar({ status: 'falhou' });
    const rota = criarRotaReprocessarLote({ verificarSenha: async (e) => (e.senha === SENHA && e.usuario_id === ADMIN ? 'ok' : 'incorreta'), limite: criarLimiteTentativas() });
    await executar(rota, m.ctx, { corpo: { autorizador_id: ADMIN, senha: SENHA } });
    expect(m.auditoria[0]).toMatchObject({ depois: { via: 'autorizado', autorizado_por: ADMIN } });
    expect(JSON.stringify([m.auditoria, m.logs, m.eventos])).not.toContain(SENHA);
  });

  it('RN-INT-16: o autorizador sem lote.reprocessar (gerente) ou fora da lista é recusado antes de conferir a senha', async () => {
    const rota = criarRotaReprocessarLote({ verificarSenha: nunca, limite: criarLimiteTentativas() });
    const e = await erroDe(executar(rota, montar({ status: 'falhou' }).ctx, { corpo: { autorizador_id: GERENTE, senha: SENHA } }));
    expect(e.codigo).toBe('autorizador_sem_permissao');
    const f = await erroDe(executar(rota, montar({ status: 'falhou' }).ctx, { corpo: { autorizador_id: '44444444-4444-4444-8444-444444444444', senha: SENHA } }));
    expect(f.status).toBe(403);
  });

  it('RN-INT-16: senha errada responde 422 e depois de 5 erros o solicitante é bloqueado por 15 minutos (429)', async () => {
    const limite = criarLimiteTentativas();
    const rota = criarRotaReprocessarLote({ verificarSenha: async () => 'incorreta', limite });
    for (let i = 0; i < 5; i++) {
      const e = await erroDe(executar(rota, montar({ status: 'falhou' }).ctx, { corpo: { autorizador_id: ADMIN, senha: 'x' } }));
      expect([e.status, e.codigo]).toEqual([422, 'senha_incorreta']);
    }
    const e = await erroDe(executar(rota, montar({ status: 'falhou' }).ctx, { corpo: { autorizador_id: ADMIN, senha: 'x' } }));
    expect([e.status, e.codigo]).toEqual([429, 'muitas_tentativas']);
    const depois = montar({ status: 'falhou' });
    depois.ctx.agora = () => new Date('2026-11-15T18:16:00Z');
    expect((await erroDe(executar(rota, depois.ctx, { corpo: { autorizador_id: ADMIN, senha: 'x' } }))).codigo).toBe('senha_incorreta');
  });

  it('RN-INT-16: sem a conferência do Core a autorização por senha responde 503 e nunca aceita', async () => {
    const rota = criarRotaReprocessarLote({ verificarSenha: async () => 'indisponivel', limite: criarLimiteTentativas() });
    const e = await erroDe(executar(rota, montar({ status: 'falhou' }).ctx, { corpo: { autorizador_id: ADMIN, senha: SENHA } }));
    expect(e.status).toBe(503);
  });
});

describe('T-0173: autorizadores e códigos do Macuxi', () => {
  it('RN-INT-16: lista só admin e analista ativos, sem e-mail', async () => {
    const r = (await executar(rotaListarAutorizadores, montar({ status: 'falhou' }).ctx)) as { itens: Array<Record<string, unknown>> };
    expect(r.itens).toEqual([{ id: ADMIN, nome: 'Ana', perfil: 'admin' }]);
    expect(rotaListarAutorizadores.acao).toBe('monitor.ver');
  });

  it('RN-INT-08: condições de pagamento vêm das formas do Vendedor, ordenadas por código; outros tipos ainda sem fonte', async () => {
    const m = montar({ status: 'falhou' });
    const r = (await executar(rotaCodigosMacuxi, m.ctx, { query: { tipo: 'condicao_pagamento' } })) as { disponivel: boolean; itens: Array<{ codigo: string }> };
    expect(r.disponivel).toBe(true);
    expect(r.itens.map((i) => i.codigo)).toEqual(['A', 'B']);
    expect(await executar(rotaCodigosMacuxi, m.ctx, { query: { tipo: 'deposito' } })).toEqual({ tipo: 'deposito', disponivel: false, itens: [] });
  });
});

