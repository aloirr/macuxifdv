import { describe, expect, it } from 'vitest';
import { copiarMetas, expandirEquipe, podeEditarMetaDe } from './metas-edicao';

const equipe = new Set(['v1', 'v2']);
const abaixo = new Set(['v3']);
const base = { alvoId: 'v1', editorId: 'ed', equipe, equipesAbaixo: abaixo };

describe('RN-CORE-20: quem pode editar a meta de quem', () => {
  it('RN-CORE-20: supervisor edita a própria meta e a da equipe que responde', () => {
    expect(podeEditarMetaDe({ ...base, perfil: 'supervisor' })).toEqual({ ok: true });
    expect(podeEditarMetaDe({ ...base, perfil: 'supervisor', alvoId: 'ed' })).toEqual({ ok: true });
  });
  it('RN-CORE-20: supervisor não edita meta fora da equipe (META_FORA_DA_EQUIPE)', () => {
    const r = podeEditarMetaDe({ ...base, perfil: 'supervisor', alvoId: 'v3' });
    expect(r).toMatchObject({ ok: false, codigo: 'META_FORA_DA_EQUIPE' });
  });
  it('RN-CORE-20: gerente edita a equipe e as equipes abaixo, não as de fora', () => {
    expect(podeEditarMetaDe({ ...base, perfil: 'gerente', alvoId: 'v3' })).toEqual({ ok: true });
    expect(podeEditarMetaDe({ ...base, perfil: 'gerente', alvoId: 'x' })).toMatchObject({ ok: false, codigo: 'META_FORA_DA_EQUIPE' });
  });
  it('RN-CORE-20: admin edita qualquer usuário do tenant', () => {
    expect(podeEditarMetaDe({ ...base, perfil: 'admin', alvoId: 'qualquer' })).toEqual({ ok: true });
  });
  it('RN-CORE-04/RN-CORE-20: analista edita qualquer usuário do tenant, como o admin (doc 03, "Criar/editar/copiar metas do mês")', () => {
    expect(podeEditarMetaDe({ ...base, perfil: 'analista', alvoId: 'qualquer', equipe: new Set(), equipesAbaixo: new Set() })).toEqual({ ok: true });
  });
  it('RN-CORE-04/RN-CORE-20: vendedor, promotor e assistente nunca editam (META_SEM_PERMISSAO; doc 03)', () => {
    for (const perfil of ['vendedor', 'promotor', 'assistente'] as const) {
      expect(podeEditarMetaDe({ ...base, perfil, alvoId: 'ed' })).toMatchObject({ ok: false, codigo: 'META_SEM_PERMISSAO' });
    }
  });
});

describe('RN-CORE-20: alvos da meta por equipe', () => {
  it('RN-CORE-20: expande só vendedores e promotores ativos da equipe, sem repetir', () => {
    const ids = expandirEquipe([
      { id: 'a', perfil: 'vendedor', ativo: true },
      { id: 'b', perfil: 'promotor', ativo: true },
      { id: 'c', perfil: 'vendedor', ativo: false },
      { id: 'd', perfil: 'supervisor', ativo: true },
      { id: 'a', perfil: 'vendedor', ativo: true },
    ]);
    expect(ids).toEqual(['a', 'b']);
  });
});

describe('RN-CORE-20: copiar metas do mês anterior', () => {
  const m = (usuario_id: string, indicador: 'venda_cents' | 'visitas', valor: number, tipo: 'pedido' | 'faturamento' = 'pedido') => ({ usuario_id, indicador, valor, tipo });
  it('RN-CORE-20: copia o que não existe no destino e nunca sobrescreve meta já definida', () => {
    const r = copiarMetas([m('a', 'venda_cents', 1000, 'faturamento'), m('a', 'visitas', 40), m('b', 'visitas', 30)], [m('a', 'visitas', 50)]);
    expect(r).toEqual([m('a', 'venda_cents', 1000, 'faturamento'), m('b', 'visitas', 30)]);
  });
  it('RN-CORE-20: meta com valor 0 não é copiada (0 = sem meta)', () => {
    expect(copiarMetas([m('a', 'visitas', 0)], [])).toEqual([]);
  });
});
