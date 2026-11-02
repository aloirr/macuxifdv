import { describe, expect, it } from 'vitest';
import { ConectorAtualizar, ConectorCriar, ENTIDADES, RecusaTopologiaConector, type Entidade } from '../contracts';
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

  it('P-6 (T-0031): a recusa diz qual Conector já recebe a entidade e pede a lista de entidades do novo, com as livres', () => {
    const r = verificarTopologiaConectores(cnx('b', ['cliente', 'produto', 'estoque']), [cnx('a', ['cliente', 'produto'])]);
    if (r.ok) throw new Error('esperado conflito');
    expect(r.mensagem).toBe(
      'O Conector "cnx-b" não foi salvo: as entidades "cliente" e "produto" já são recebidas pelo Conector "cnx-a". Na v1 cada entidade vem de um único Conector por empresa e só um recebe pedidos. Para salvar, informe a lista de entidades do Conector "cnx-b" só com as que ele alimenta (livres: "estoque") — sem a lista, o cadastro leva as 8 entidades.',
    );
    expect(r.entidades_livres).toEqual(['estoque']);
    expect(r.conflitos[0]?.mensagem).toMatch(/já é recebida pelo Conector "cnx-a".*informe a lista de entidades do Conector "cnx-b" sem "cliente"/);
    expect(RecusaTopologiaConector.safeParse({ codigo: r.codigo, mensagem: r.mensagem, detalhes: { conflitos: r.conflitos, entidades_livres: r.entidades_livres } }).success).toBe(true);
  });

  it('P-6 (T-0031): cadastro sem lista (padrão: as 8) contra um Conector existente — cita cada dono e as livres', () => {
    const padrao = ConectorCriar.parse({ conector_id: 'filial-02', nome: 'Filial' }).entidades;
    const r = verificarTopologiaConectores({ id: 'n', conector_id: 'filial-02', ativo: true, recebe_pedidos: false, entidades: padrao }, [
      cnx('a', ['cliente', 'vendedor']),
      cnx('c', ['estoque']),
    ]);
    if (r.ok) throw new Error('esperado conflito');
    expect(r.mensagem).toMatch(/"vendedor" e "cliente" já são recebidas pelo Conector "cnx-a"; a entidade "estoque" já é recebida pelo Conector "cnx-c"/);
    expect(r.mensagem).toMatch(/sem a lista, o cadastro leva as 8 entidades/);
    expect(r.entidades_livres).toEqual(padrao.filter((e) => !['cliente', 'vendedor', 'estoque'].includes(e)));
  });

  it('P-6 (T-0031): todas as entidades já têm Conector — a mensagem pede a lista e lembra que filial com ERP próprio é outra empresa', () => {
    const r = verificarTopologiaConectores(cnx('b', ['cliente']), [cnx('a', ['cliente'])]);
    if (r.ok) throw new Error('esperado conflito');
    expect(r.entidades_livres).toEqual([]);
    expect(r.mensagem).toMatch(/a entidade "cliente" já é recebida pelo Conector "cnx-a".*informe a lista de entidades do Conector "cnx-b" — todas as escolhidas já têm Conector.*outra empresa/);
  });

  it('RN-INT-13 (P-7): só um Conector por empresa recebe pedidos', () => {
    const r = verificarTopologiaConectores(cnx('b', ['estoque'], { recebe_pedidos: true }), [cnx('a', ['cliente'], { recebe_pedidos: true })]);
    expect(r).toMatchObject({ ok: false, conflitos: [{ codigo: 'pedidos_em_outro_conector', conector_id: 'cnx-a' }], entidades_livres: ['estoque'] });
    if (!r.ok) expect(r.mensagem).toBe('O Conector "cnx-b" não foi salvo: os pedidos já vão para o ERP pelo Conector "cnx-a". Na v1 cada entidade vem de um único Conector por empresa e só um recebe pedidos. Para salvar, desmarque "recebe pedidos".');
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
