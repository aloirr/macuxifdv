import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { defineModule } from './manifesto';
import {
  codificarCursor,
  compararCursor,
  criarRegistroSync,
  decodificarCursor,
  definirEntidadeSync,
  paginar,
  PushRequestSchema,
  rejeitarItensInvalidos,
} from './sync';

const manifestos = [
  defineModule({ id: 'core', versao: '1.0.0', perfis: ['admin'], sync: ['cliente', 'visita'] }),
  defineModule({ id: 'vendedor', versao: '1.0.0', depende: ['core'], perfis: ['vendedor'], sync: ['pedido'] }),
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
});
