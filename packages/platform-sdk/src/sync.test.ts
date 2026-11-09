import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { defineModule } from './manifesto';
import {
  codificarCursor,
  compararCursor,
  criarRegistroSync,
  decodificarCursor,
  definirEntidadeSync,
  ehSyncNaoImplementado,
  paginar,
  PushRequestSchema,
  rejeitarItensInvalidos,
} from './sync';

const manifestos = [
  defineModule({ id: 'core', versao: '1.0.0', perfis: ['admin'], sync: ['cliente', 'visita'] }),
  defineModule({ id: 'vendedor', versao: '1.0.0', depende: ['core'], perfis: ['vendedor'], sync: ['pedido', 'pedido_item'] }),
  defineModule({ id: 'promotor', versao: '1.0.0', depende: ['core'], perfis: ['promotor'], sync: ['checklist_loja'] }),
];

function registro() {
  const r = criarRegistroSync(manifestos);
  r.registrar(definirEntidadeSync({ nome: 'cliente', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: z.object({ nome: z.string() }) }));
  r.registrar(definirEntidadeSync({ nome: 'visita', modulo: 'core', direcao: 'ambos', conflito: 'somente_insercao', schema: z.object({ cliente_id: z.string() }) }));
  r.registrar(
    definirEntidadeSync({ nome: 'pedido', modulo: 'vendedor', direcao: 'ambos', conflito: 'app_edita_ate_status', schema: z.object({ total_cents: z.number().int() }) }),
  );
  return r;
}

const U1 = '0b7f6c1e-3d2a-4c5b-9e8f-7a6b5c4d3e21';
const U2 = '0b7f6c1e-3d2a-4c5b-9e8f-7a6b5c4d3e22';
const U3 = '0b7f6c1e-3d2a-4c5b-9e8f-7a6b5c4d3e23';

describe('registro de entidades de sync', () => {
  it('só registra o que o manifesto declara, sem duplicar', () => {
    const r = registro();
    expect(() => r.registrar(definirEntidadeSync({ nome: 'titulo', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: z.any() }))).toThrow(
      'não está em "sync"',
    );
    expect(() => r.registrar(definirEntidadeSync({ nome: 'cliente', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: z.any() }))).toThrow(
      'já registrada',
    );
    expect(() => definirEntidadeSync({ nome: 'Pedido', modulo: 'vendedor', direcao: 'push', conflito: 'servidor_vence', schema: z.any() })).toThrow('inválida');
  });

  it('RN-CORE-02: entidades de módulo inativo não sincronizam', () => {
    const r = registro();
    expect(r.entidadesAtivas(['core']).map((e) => e.nome)).toEqual(['cliente', 'visita']);
    expect(r.entidadesAtivas(['core', 'vendedor'], 'push').map((e) => e.nome)).toEqual(['pedido', 'visita']);
  });
});

describe('cursor (updated_at, id) e paginação do pull', () => {
  const linhas = [
    { id: 'b', updated_at: '2026-10-12T10:00:00.000Z', deleted_at: null },
    { id: 'a', updated_at: '2026-10-12T10:00:00.000Z', deleted_at: null },
    { id: 'c', updated_at: '2026-10-12T11:00:00.000Z', deleted_at: '2026-10-12T11:00:00.000Z' },
  ];

  it('codifica, decodifica e rejeita cursor inválido', () => {
    const c = { updated_at: '2026-10-12T10:00:00.000Z', id: 'a|b' };
    expect(decodificarCursor(codificarCursor(c))).toEqual(c);
    expect(decodificarCursor('lixo')).toBeNull();
    expect(decodificarCursor('nao-e-data|x')).toBeNull();
    expect(decodificarCursor(null)).toBeNull();
  });

  it('empate de updated_at desempata por id', () => {
    expect(compararCursor(linhas[1]!, linhas[0]!)).toBeLessThan(0);
  });

  it('pagina em ordem, inclui removidos e devolve o próximo cursor só quando há mais', () => {
    const p1 = paginar(linhas, null, 2);
    expect(p1.itens.map((l) => l.id)).toEqual(['a', 'b']);
    expect(p1.proximo_cursor).toBe('2026-10-12T10:00:00.000Z|b');
    const p2 = paginar(linhas, p1.proximo_cursor, 2);
    expect(p2.itens.map((l) => [l.id, l.deleted_at !== null])).toEqual([['c', true]]);
    expect(p2.proximo_cursor).toBeNull();
  });
});

describe('push idempotente por UUID do aparelho', () => {
  it('UUID obrigatório e lote limitado', () => {
    expect(PushRequestSchema.safeParse({ itens: [{ entidade: 'pedido', id: '123', payload: {} }] }).success).toBe(false);
    expect(PushRequestSchema.safeParse({ itens: [] }).success).toBe(false);
    expect(PushRequestSchema.parse({ itens: [{ entidade: 'pedido', id: U1, payload: {} }] }).itens[0]!.operacao).toBe('upsert');
  });

  it('rejeita com código (nunca descarta): entidade só-pull, módulo inativo, payload inválido', () => {
    const req = PushRequestSchema.parse({
      itens: [
        { entidade: 'visita', id: U1, payload: { cliente_id: 'c1' } },
        { entidade: 'cliente', id: U2, payload: { nome: 'x' } },
        { entidade: 'pedido', id: U3, payload: { total_cents: 10 } },
      ],
    });
    const r = rejeitarItensInvalidos(req, registro(), ['core']);
    expect(r.validos.map((i) => i.id)).toEqual([U1]);
    expect(r.rejeitados.map((x) => (x.status === 'rejeitado' ? x.codigo : x.status))).toEqual(['ENTIDADE_DESCONHECIDA', 'MODULO_INATIVO']);
    const inval = rejeitarItensInvalidos(PushRequestSchema.parse({ itens: [{ entidade: 'visita', id: U1, payload: {} }] }), registro(), ['core']);
    expect(inval.rejeitados[0]).toMatchObject({ status: 'rejeitado', codigo: 'PAYLOAD_INVALIDO' });
  });

  it('PAYLOAD_INVALIDO chega à tela em português, sem código nem nome de campo; a mensagem do contrato é mantida', () => {
    const r = criarRegistroSync(manifestos);
    r.registrar(
      definirEntidadeSync({
        nome: 'visita',
        modulo: 'core',
        direcao: 'ambos',
        conflito: 'somente_insercao',
        schema: z.object({
          cliente_id: z.string().uuid(),
          data: z.string().refine((d) => d.startsWith('2026'), 'Data fora do ano da campanha.'),
          nota: z.number().int().max(10),
          tipo: z.enum(['a', 'b']),
          obs: z.string({ required_error: 'Escreva a observação' }),
        }),
      }),
    );
    const enviar = (payload: unknown) => {
      const x = rejeitarItensInvalidos(PushRequestSchema.parse({ itens: [{ entidade: 'visita', id: U1, payload }] }), r, ['core']).rejeitados[0]!;
      expect(x).toMatchObject({ status: 'rejeitado', codigo: 'PAYLOAD_INVALIDO' });
      return x.status === 'rejeitado' ? x.mensagem : '';
    };
    // tudo faltando: o padrão do Zod ("Required") vira português, sem repetir; o required_error do contrato fica
    expect(enviar({})).toBe('O servidor não aceitou os dados deste registro: falta um dado obrigatório; Escreva a observação.');
    const m = enviar({ cliente_id: 'x', data: '2025-01-01', nota: 11.5, tipo: 'c', obs: 'ok' });
    expect(m).toBe(
      'O servidor não aceitou os dados deste registro: há um texto no formato errado; Data fora do ano da campanha; há um número que precisa ser inteiro e mais 2.',
    );
    for (const texto of [enviar({}), m]) {
      expect(texto).not.toMatch(/Required|Invalid|Expected|received|PAYLOAD_INVALIDO|cliente_id|nota|tipo/);
    }
  });

  it('D-1 / RN-CORE-02: entidade do manifesto de módulo inativo volta MODULO_INATIVO mesmo sem definição registrada', () => {
    const r = registro();
    expect(r.dono('checklist_loja')).toBe('promotor');
    expect(r.dono('nao_existe')).toBeUndefined();
    const req = PushRequestSchema.parse({ itens: [{ entidade: 'checklist_loja', id: U1, payload: {} }, { entidade: 'nao_existe', id: U2, payload: {} }] });
    expect(rejeitarItensInvalidos(req, r, ['core']).rejeitados).toEqual([
      { id: U1, status: 'rejeitado', codigo: 'MODULO_INATIVO', mensagem: 'Módulo promotor inativo' },
      { id: U2, status: 'rejeitado', codigo: 'ENTIDADE_DESCONHECIDA', mensagem: 'Entidade nao_existe não aceita push' },
    ]);
    // ADR 0009 §7 (D-2): módulo ativo e sem definição = ainda não implementado no servidor (retentável no app)
    expect(rejeitarItensInvalidos(req, r, ['core', 'promotor']).rejeitados.map((x) => (x.status === 'rejeitado' ? x.codigo : x.status))).toEqual(['SYNC_NAO_IMPLEMENTADO', 'ENTIDADE_DESCONHECIDA']);
  });

  it('RN-PRO-01: promotor enviando entidade de pedido → RN-PRO-01 (antes de desconhecida), mas módulo inativo vem primeiro', () => {
    const req = PushRequestSchema.parse({
      itens: [
        { entidade: 'pedido', id: U1, payload: { total_cents: 10 } },
        { entidade: 'pedido_item', id: U2, payload: {} },
      ],
    });
    const codigos = (ativos: ('core' | 'vendedor')[], perfil?: 'promotor' | 'vendedor') =>
      rejeitarItensInvalidos(req, registro(), ativos, { perfil }).rejeitados.map((x) => (x.status === 'rejeitado' ? x.codigo : x.status));
    expect(codigos(['core', 'vendedor'], 'promotor')).toEqual(['RN-PRO-01', 'RN-PRO-01']);
    expect(codigos(['core'], 'promotor')).toEqual(['MODULO_INATIVO', 'MODULO_INATIVO']);
    expect(codigos(['core', 'vendedor'], 'vendedor')).toEqual(['SYNC_NAO_IMPLEMENTADO']); // pedido_item sem definição (ADR 0009 §7)
  });
});

describe('ADR 0009 §7 (D-2): entidade ainda não implementada no servidor', () => {
  it('reconhece o 501 / SYNC_NAO_IMPLEMENTADO do transporte (codigo da API de teste, code do HttpError do app)', () => {
    expect(ehSyncNaoImplementado({ status: 501 })).toBe(true);
    expect(ehSyncNaoImplementado({ status: 400, codigo: 'SYNC_NAO_IMPLEMENTADO' })).toBe(true);
    expect(ehSyncNaoImplementado(Object.assign(new Error('x'), { status: 501, code: 'SYNC_NAO_IMPLEMENTADO' }))).toBe(true);
    for (const e of [new Error('Sem conexão'), { status: 500, codigo: 'ERRO_INTERNO' }, { status: 403, code: 'MODULO_INATIVO' }, null, 'x']) {
      expect(ehSyncNaoImplementado(e)).toBe(false);
    }
  });
});
