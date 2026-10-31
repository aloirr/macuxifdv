import { describe, expect, it } from 'vitest';
import { DisponibilidadeEmNome, type MembroEquipe } from '../contracts';
import manifest from '../manifest';
import { contextoPedidoEmNome, disponibilidadePedidoEmNome } from './pedido-em-nome';
import { CLIENTE_A, u } from './fixtures';

const GER = u(1), SUP = u(2), V1 = u(11), P1 = u(21), OUTRO = u(13), SUP2 = u(3);
const m = (id: string, nome: string, perfil: MembroEquipe['perfil'], superior_id: string | null, ativo = true): MembroEquipe => ({ id, nome, perfil, superior_id, ativo });
const ROSTER = [m(GER, 'G', 'gerente', null), m(SUP, 'S', 'supervisor', GER), m(SUP2, 'S2', 'supervisor', GER), m(V1, 'V1', 'vendedor', SUP), m(P1, 'P1', 'promotor', SUP), m(OUTRO, 'O', 'vendedor', SUP2), m(u(14), 'Inativo', 'vendedor', SUP, false)];
const COM_VENDEDOR = new Set(['core', 'vendedor']);
const consulta = (autor: { id: string; perfil: MembroEquipe['perfil'] }, vendedor_id: string, modulos: ReadonlySet<string> = COM_VENDEDOR) => disponibilidadePedidoEmNome({ autor, vendedor_id, membros: ROSTER, modulos });

describe('RF-GES-05: pedido em nome do vendedor (extensão pedido.criar_em_nome do Vendedor)', () => {
  it('supervisor faz pedido em nome de vendedor da própria equipe; gerente também (equipes abaixo)', () => {
    const r = consulta({ id: SUP, perfil: 'supervisor' }, V1);
    expect(r).toEqual({ visivel: true, permitido: true, codigo: null, mensagem: null });
    expect(DisponibilidadeEmNome.parse(r)).toEqual(r);
    expect(consulta({ id: GER, perfil: 'gerente' }, OUTRO).permitido).toBe(true);
  });

  it('RN-CORE-03: com o Vendedor desativado a função some, sem erro nem mensagem', () => {
    expect(consulta({ id: SUP, perfil: 'supervisor' }, V1, new Set(['core']))).toEqual({ visivel: false, permitido: false, codigo: 'MODULO_VENDEDOR_INATIVO', mensagem: null });
  });

  it('matriz do doc 03: vendedor, promotor, assistente, analista e admin não têm a ação (nem a veem)', () => {
    for (const perfil of ['vendedor', 'promotor', 'assistente', 'analista', 'admin'] as const) {
      expect(consulta({ id: u(60), perfil }, V1)).toMatchObject({ visivel: false, permitido: false, codigo: 'PERFIL_SEM_ACESSO' });
    }
  });

  it('o motor é do Vendedor: o Gestor só usa a extensão e não declara ação de pedido', () => {
    expect(manifest.usaExtensoes).toContain('pedido.criar_em_nome');
    expect(Object.keys(manifest.acoes).some((a) => a.startsWith('pedido'))).toBe(false);
  });

  it('RN-CORE-04: vendedor de outra equipe está fora do escopo (a ação aparece, mas é negada com mensagem)', () => {
    const r = consulta({ id: SUP, perfil: 'supervisor' }, OUTRO);
    expect(r).toMatchObject({ visivel: true, permitido: false, codigo: 'FORA_DO_ESCOPO' });
    expect(r.mensagem).toMatch(/equipe/);
  });

  it('RN-PRO-01: nunca em nome de promotor; vendedor inativo ou inexistente também é recusado', () => {
    expect(consulta({ id: SUP, perfil: 'supervisor' }, P1)).toMatchObject({ permitido: false, codigo: 'VENDEDOR_INVALIDO' });
    expect(consulta({ id: SUP, perfil: 'supervisor' }, P1).mensagem).toMatch(/promotor/i);
    expect(consulta({ id: SUP, perfil: 'supervisor' }, u(14))).toMatchObject({ permitido: false, codigo: 'VENDEDOR_INVALIDO' });
    expect(consulta({ id: SUP, perfil: 'supervisor' }, u(999))).toMatchObject({ permitido: false, codigo: 'FORA_DO_ESCOPO' });
  });
});

describe('RN-VEN-35: contexto passado à extensão', () => {
  it('vendedor_id = vendedor (a venda conta para ele, RN-CORE-21) e autor_id = gestor', () => {
    const r = contextoPedidoEmNome({ autor_id: SUP, vendedor_id: V1, cliente_id: CLIENTE_A });
    expect(r).toEqual({ ok: true, contexto: { vendedor_id: V1, autor_id: SUP, cliente_id: CLIENTE_A, visita_id: null } });
  });

  it('autor igual ao vendedor não é pedido em nome; ids inválidos são recusados em português', () => {
    expect(contextoPedidoEmNome({ autor_id: V1, vendedor_id: V1, cliente_id: CLIENTE_A })).toMatchObject({ ok: false });
    const ruim = contextoPedidoEmNome({ autor_id: SUP, vendedor_id: 'abc', cliente_id: CLIENTE_A });
    expect(ruim.ok).toBe(false);
  });
});
