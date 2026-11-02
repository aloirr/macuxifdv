import type { ClienteBanco, ContextoConector, EntradaAutenticacaoConector, RotaConector } from '@macuxi/platform-sdk';
import { describe, expect, it, vi } from 'vitest';
import { criarAutenticacaoHub, MSG_401, type ConectorHub } from './autenticacao';
import { hashDaChave } from './chave';

const PEPPER = 'pepper-de-teste-com-mais-de-trinta-e-dois-bytes';
const CHAVE = 'mxc_chave-de-teste-0123456789abcdef';
const T0 = new Date('2026-11-01T12:00:00.000Z');
const TENANT = '0a000000-0000-4000-8000-000000000001';

const linha = (extra: Record<string, unknown> = {}) => ({
  credencial_id: 'c1', tenant_id: TENANT, conector_id: 'k1', escopo: 'integracao.v1', papel: 'atual', criada_em: new Date('2026-10-01T00:00:00Z'),
  expira_em: null, anterior_valida_ate: null, revogada_em: null, ultimo_uso_em: null, conector_identificador: 'erp-alfa', conector_ativo: true,
  ips_permitidos: [], recebe_pedidos: true, entidades: ['cliente', 'produto'], ...extra,
});

function entrada(o: { linhas?: unknown[]; cab?: Record<string, string | undefined>; ip?: string; consultas?: unknown[][] } = {}): EntradaAutenticacaoConector {
  return {
    cabecalhos: { authorization: `Bearer ${CHAVE}`, 'x-macuxi-conector-id': 'erp-alfa', ...(o.cab ?? {}) },
    ip: o.ip ?? '198.51.100.7',
    rota: 'enviar_lote',
    agora: () => T0,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    semTenant: async <T>(fn: (db: ClienteBanco) => Promise<T>) =>
      fn({ query: async (_sql: string, valores?: readonly unknown[]) => { o.consultas?.push([...(valores ?? [])]); return { rows: (o.linhas ?? []) as never[], rowCount: (o.linhas ?? []).length }; } }),
  };
}

describe('RN-INT-10: autenticar do Hub (chave por Conector, recusa 401 genérica)', () => {
  const a = criarAutenticacaoHub({ pepper: () => PEPPER });

  it('RN-INT-10: chave válida devolve o tenant da CHAVE e o Conector com entidades e recebe_pedidos; consulta pelo HMAC, nunca pela chave', async () => {
    const consultas: unknown[][] = [];
    const r = await a.autenticar(entrada({ linhas: [linha()], consultas }));
    expect(r).toMatchObject({ ok: true, tenantId: TENANT, conector: { id: 'k1', identificador: 'erp-alfa', entidades: ['cliente', 'produto'], recebe_pedidos: true, situacao_chave: 'ativa' } });
    expect(consultas).toEqual([[hashDaChave(PEPPER, CHAVE)]]);
  });

  it('RN-INT-10: chave desconhecida, revogada ou de outro Conector = 401 com a MESMA mensagem genérica (motivo só no log)', async () => {
    const desconhecida = await a.autenticar(entrada({ linhas: [] }));
    const revogada = await a.autenticar(entrada({ linhas: [linha({ revogada_em: new Date('2026-10-02T00:00:00Z') })] }));
    const outro = await a.autenticar(entrada({ linhas: [linha()], cab: { 'x-macuxi-conector-id': 'erp-beta' } }));
    for (const r of [desconhecida, revogada, outro]) expect(r).toMatchObject({ ok: false, status: 401, codigo: 'credencial_invalida', mensagem: MSG_401 });
    expect([desconhecida, revogada, outro].map((r) => (r.ok ? '' : r.motivo))).toEqual(['chave_desconhecida', 'revogada', 'conector_divergente']);
  });

  it('RN-INT-10: Conector inativo ou IP fora da lista = 403 acesso_negado', async () => {
    expect(await a.autenticar(entrada({ linhas: [linha({ conector_ativo: false })] }))).toMatchObject({ ok: false, status: 403, codigo: 'acesso_negado', motivo: 'conector_inativo' });
    expect(await a.autenticar(entrada({ linhas: [linha({ ips_permitidos: ['203.0.113.0/24'] })], ip: '198.51.100.7' }))).toMatchObject({ ok: false, status: 403, motivo: 'ip_nao_permitido' });
    expect(await a.autenticar(entrada({ linhas: [linha({ ips_permitidos: ['203.0.113.0/24'] })], ip: '203.0.113.9' }))).toMatchObject({ ok: true });
  });

  it('RN-INT-10: chave anterior dentro da convivência entra como em_convivencia', async () => {
    const r = await a.autenticar(entrada({ linhas: [linha({ papel: 'anterior', anterior_valida_ate: new Date('2026-11-02T00:00:00Z') })] }));
    expect(r).toMatchObject({ ok: true, conector: { situacao_chave: 'em_convivencia' } });
  });

  it('RN-INT-10: cabeçalho malformado = 400 requisicao_invalida (sem consultar o banco)', async () => {
    const consultas: unknown[][] = [];
    expect(await a.autenticar(entrada({ cab: { authorization: 'Basic abc' }, consultas }))).toMatchObject({ ok: false, status: 400, codigo: 'requisicao_invalida' });
    expect(await a.autenticar(entrada({ cab: { authorization: undefined }, consultas }))).toMatchObject({ ok: false, status: 400 });
    expect(consultas).toEqual([]);
  });

  it('RN-INT-10: sem pepper (ou pepper curto) o Hub falha fechado: 503 e log de erro, sem consultar o banco', async () => {
    for (const pepper of [undefined, 'curto']) {
      const consultas: unknown[][] = [];
      const e = entrada({ linhas: [linha()], consultas });
      const r = await criarAutenticacaoHub({ pepper: () => pepper }).autenticar(e);
      expect(r).toMatchObject({ ok: false, status: 503, codigo: 'servico_indisponivel', motivo: 'sem_pepper' });
      expect(e.log.error).toHaveBeenCalled();
      expect(consultas).toEqual([]);
    }
  });
});

describe('RN-INT-12/RN-INT-11: antes das rotas (taxa, tamanho e versão)', () => {
  const rota = (id: string, metodo: 'GET' | 'POST', caminho: string) => ({ id, metodo, caminho }) as unknown as RotaConector<ConectorHub>;
  function ctxDe(o: { politica?: unknown; parametros?: Record<string, unknown>; bytes?: number; versao?: string; recebePedidos?: boolean; agora?: Date; consultas?: string[] }): ContextoConector<ConectorHub> {
    const db: ClienteBanco = {
      query: async (sql: string) => {
        o.consultas?.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
        return { rows: (sql.includes('politica_versao') && o.politica ? [o.politica] : []) as never[], rowCount: 0 };
      },
    };
    return {
      tenantId: TENANT,
      conector: { id: 'k1', identificador: 'erp-alfa', entidades: ['cliente'], recebe_pedidos: o.recebePedidos ?? true, credencial_id: 'c1', situacao_chave: 'ativa' },
      rota: 'x', cabecalhos: { 'x-macuxi-conector-versao': o.versao ?? '1.2.1' }, corpo: undefined, query: {}, params: {},
      bytesCorpo: o.bytes ?? 100, ip: '198.51.100.7', requestId: 'r', agora: () => o.agora ?? T0, fuso: () => 'America/Manaus',
      parametros: () => o.parametros ?? {}, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      comTenant: async (fn: (db: ClienteBanco, tx: never) => Promise<unknown>) => fn(db, undefined as never),
    } as unknown as ContextoConector<ConectorHub>;
  }
  const politica = { versao_minima: '1.1.0', versao_recomendada: '1.2.0', mensagem: null, pacote: null };

  it('RN-INT-11: abaixo da mínima = 426 com detalhes.versao_minima; o sinal de vida passa; sem política nunca bloqueia', async () => {
    const a = criarAutenticacaoHub({ pepper: () => PEPPER });
    const velho = ctxDe({ politica, versao: '1.0.0' });
    await expect(a.antes(velho, rota('enviar_lote', 'POST', '/lotes'))).rejects.toMatchObject({ status: 426, corpo: { codigo: 'versao_conector_nao_suportada', detalhes: { versao_minima: '1.1.0' } } });
    await expect(a.antes(ctxDe({ politica, versao: '1.0.0' }), rota('sinal', 'POST', '/sinal'))).resolves.toBeUndefined();
    await expect(a.antes(ctxDe({ versao: '0.0.1', recebePedidos: false }), rota('enviar_lote', 'POST', '/lotes'))).resolves.toBeUndefined();
    await expect(a.antes(ctxDe({ politica, versao: '1.1.0' }), rota('enviar_lote', 'POST', '/lotes'))).resolves.toBeUndefined();
  });

  it('RN-INT-11: sem política gravada, Conector que recebe pedidos exige 1.2.1 (426 com a mensagem de atualizar); com política gravada vale a da empresa', async () => {
    const a = criarAutenticacaoHub({ pepper: () => PEPPER });
    await expect(a.antes(ctxDe({ versao: '1.2.0' }), rota('enviar_lote', 'POST', '/lotes'))).rejects.toMatchObject({
      status: 426,
      corpo: { codigo: 'versao_conector_nao_suportada', detalhes: { versao_minima: '1.2.1' }, mensagem: expect.stringMatching(/Atualize o Conector/) },
    });
    await expect(a.antes(ctxDe({ versao: '1.2.0' }), rota('sinal', 'POST', '/sinal'))).resolves.toBeUndefined();
    await expect(a.antes(ctxDe({ versao: '1.2.1' }), rota('enviar_lote', 'POST', '/lotes'))).resolves.toBeUndefined();
    await expect(a.antes(ctxDe({ versao: '1.2.0', recebePedidos: false }), rota('enviar_lote', 'POST', '/lotes'))).resolves.toBeUndefined();
    await expect(a.antes(ctxDe({ politica, versao: '1.2.0' }), rota('enviar_lote', 'POST', '/lotes'))).resolves.toBeUndefined();
  });

  it('RN-INT-12: corpo acima do limite da classe = 413 corpo_grande; o lote tem limite maior que as demais rotas', async () => {
    const a = criarAutenticacaoHub({ pepper: () => PEPPER });
    await expect(a.antes(ctxDe({ bytes: 2 * 1024 * 1024 }), rota('sinal', 'POST', '/sinal'))).rejects.toMatchObject({ status: 413, corpo: { codigo: 'corpo_grande' } });
    await expect(a.antes(ctxDe({ bytes: 2 * 1024 * 1024 }), rota('enviar_lote', 'POST', '/lotes'))).resolves.toBeUndefined();
    await expect(a.antes(ctxDe({ bytes: 9 * 1024 * 1024 }), rota('enviar_lote', 'POST', '/lotes'))).rejects.toMatchObject({ status: 413 });
  });

  it('RN-INT-12: a taxa é por Conector e por classe de rota; passou do balde = 429 com Retry-After inteiro > 0, e o tempo repõe', async () => {
    const a = criarAutenticacaoHub({ pepper: () => PEPPER });
    const parametros = { taxaPorConector: { lote: { capacidade: 2, reposicaoPorMin: 60 }, geral: { capacidade: 300, reposicaoPorMin: 300 } } };
    const lote = rota('enviar_lote', 'POST', '/lotes');
    await a.antes(ctxDe({ parametros }), lote);
    await a.antes(ctxDe({ parametros }), lote);
    const erro = await a.antes(ctxDe({ parametros }), lote).catch((e: unknown) => e);
    expect(erro).toMatchObject({ status: 429, corpo: { codigo: 'limite_de_taxa' } });
    expect(Number((erro as { cabecalhos: Record<string, string> }).cabecalhos['retry-after'])).toBeGreaterThan(0);
    await expect(a.antes(ctxDe({ parametros }), rota('sinal', 'POST', '/sinal'))).resolves.toBeUndefined(); // balde geral intacto
    await expect(a.antes(ctxDe({ parametros, agora: new Date(T0.getTime() + 2000) }), lote)).resolves.toBeUndefined();
  });

  it('RN-INT-10: ultimo_uso_em é gravado no máximo 1 vez por minuto por credencial', async () => {
    const a = criarAutenticacaoHub({ pepper: () => PEPPER });
    const consultas: string[] = [];
    const r = rota('sinal', 'POST', '/sinal');
    await a.antes(ctxDe({ consultas }), r);
    await a.antes(ctxDe({ consultas, agora: new Date(T0.getTime() + 10_000) }), r);
    await a.antes(ctxDe({ consultas, agora: new Date(T0.getTime() + 61_000) }), r);
    expect(consultas.filter((c) => c.startsWith('update integracao.credencial'))).toHaveLength(2);
  });
});
