import { describe, expect, it } from 'vitest';
import { ConectorAtualizar, ConectorCriar, ENTIDADES, type Entidade } from '../contracts';
import { validarEnvelope } from './envelope';
import { erroEntidadeDeOutroConector, verificarTopologiaConectores, type ConectorTopologia } from './topologia';

const cnx = (id: string, entidades: Entidade[], extra: Partial<ConectorTopologia> = {}): ConectorTopologia => ({
  id, conector_id: `cnx-${id}`, ativo: true, recebe_pedidos: false, entidades, ...extra,
});

describe('RN-INT-13 (P-6/P-7, T-0027): um Conector por entidade por empresa; o Hub recusa configuração conflitante', () => {
  it('RN-INT-13: Conectores com entidades separadas convivem (ex.: matriz com cadastro, outro com estoque)', () => {
    const r = verificarTopologiaConectores(cnx('b', ['estoque']), [cnx('a', ['cliente', 'produto', 'preco'], { recebe_pedidos: true })]);
    expect(r).toEqual({ ok: true });
  });

  it('RN-INT-13: a mesma entidade em dois Conectores ativos é recusada, com o dono atual e a ação na mensagem', () => {
    const r = verificarTopologiaConectores(cnx('b', ['cliente', 'estoque']), [cnx('a', ['cliente', 'produto'])]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.codigo).toBe('topologia_conflitante');
      expect(r.conflitos).toEqual([expect.objectContaining({ codigo: 'entidade_em_outro_conector', entidade: 'cliente', conector_id: 'cnx-a' })]);
      expect(r.conflitos[0]?.mensagem).toMatch(/outra empresa/);
    }
  });

  it('RN-INT-13 (P-7): só um Conector por empresa recebe pedidos', () => {
    const r = verificarTopologiaConectores(cnx('b', ['estoque'], { recebe_pedidos: true }), [cnx('a', ['cliente'], { recebe_pedidos: true })]);
    expect(r).toMatchObject({ ok: false, conflitos: [{ codigo: 'pedidos_em_outro_conector', conector_id: 'cnx-a' }] });
  });

  it('RN-INT-13: todos os conflitos voltam juntos', () => {
    const r = verificarTopologiaConectores(cnx('b', ['cliente', 'produto'], { recebe_pedidos: true }), [cnx('a', ['cliente', 'produto'], { recebe_pedidos: true })]);
    expect(r.ok ? 0 : r.conflitos.length).toBe(3);
  });

  it('RN-INT-13: editar o próprio Conector não conflita consigo; Conector inativo não conta; desativar sempre pode', () => {
    const a = cnx('a', ['cliente'], { recebe_pedidos: true });
    expect(verificarTopologiaConectores({ ...a, entidades: ['cliente', 'produto'] }, [a])).toEqual({ ok: true });
    expect(verificarTopologiaConectores(cnx('b', ['cliente'], { recebe_pedidos: true }), [{ ...a, ativo: false }])).toEqual({ ok: true });
    expect(verificarTopologiaConectores(cnx('b', ['cliente'], { ativo: false }), [a])).toEqual({ ok: true });
  });

  it('RN-INT-13: reativar um Conector confere de novo (outro já assumiu a entidade)', () => {
    const r = verificarTopologiaConectores(cnx('a', ['cliente'], { ativo: true }), [cnx('b', ['cliente'])]);
    expect(r.ok).toBe(false);
  });

  it('RN-INT-13: cadastro padrão leva as 8 entidades; lista vazia ou repetida é recusada no contrato', () => {
    expect(ConectorCriar.parse({ conector_id: 'matriz-01', nome: 'Matriz' }).entidades).toEqual([...ENTIDADES]);
    expect(ConectorCriar.safeParse({ conector_id: 'm', nome: 'M', entidades: [] }).success).toBe(false);
    expect(ConectorCriar.safeParse({ conector_id: 'm', nome: 'M', entidades: ['cliente', 'cliente'] }).success).toBe(false);
    expect(ConectorAtualizar.parse({ entidades: ['estoque'] }).entidades).toEqual(['estoque']);
  });

  it('RN-INT-13: lote de entidade que não é do Conector é recusado inteiro (422 entidade_de_outro_conector, campo entidade)', () => {
    const env = { versao_contrato: 'v1', entidade: 'estoque', modo: 'delta', registros: [{ external_id: 'E1' }] };
    const r = validarEnvelope(env, { entidadesDoConector: ['cliente', 'produto'] });
    expect(r).toMatchObject({ ok: false, erros: [{ codigo: 'entidade_de_outro_conector', campo: 'entidade' }] });
    expect(validarEnvelope(env, { entidadesDoConector: ['estoque'] }).ok).toBe(true);
    expect(validarEnvelope(env).ok).toBe(true);
    expect(erroEntidadeDeOutroConector('estoque', ['estoque'])).toBeNull();
    expect(erroEntidadeDeOutroConector('estoque', [])?.mensagem).toMatch(/conector retomar estoque/);
  });
});
