import { describe, expect, it } from 'vitest';
import {
  estadoAposPush,
  itensParaMostrarNaTelaDeSync,
  itensParaTentarEnviar,
  podeApagarDadosLocais,
  ROTULO_NAO_ENVIADO,
  type ItemFila,
} from './fila-modulo-desativado';

const item = (id: string, modulo: ItemFila['modulo'], estado: ItemFila['estado']): ItemFila => ({ id, modulo, estado });

describe('fila offline de módulo desativado (S0-048)', () => {
  it('RN-CORE-02: 403 MODULO_INATIVO no push marca o item como rejeitado por módulo desativado', () => {
    expect(estadoAposPush({ ok: false, status: 403, codigo: 'MODULO_INATIVO' })).toBe('rejeitado_modulo_inativo');
    expect(estadoAposPush({ ok: true })).toBe('enviado');
    expect(estadoAposPush({ ok: false, status: 500 })).toBe('falhou');
    expect(estadoAposPush({ ok: false, status: 403, codigo: 'PERFIL_SEM_ACESSO' })).toBe('falhou');
  });

  it('RN-CORE-02: antes de apagar, o app tenta enviar a fila dos módulos removidos', () => {
    const fila = [item('1', 'vendedor', 'pendente'), item('2', 'vendedor', 'falhou'), item('3', 'vendedor', 'enviado'), item('4', 'pesquisa', 'pendente')];
    expect(itensParaTentarEnviar(fila, ['vendedor']).map((i) => i.id)).toEqual(['1', '2']);
  });

  it('RN-CORE-02: itens não enviados aparecem na tela de sync como "não enviado — módulo desativado"', () => {
    const fila = [item('1', 'vendedor', 'rejeitado_modulo_inativo'), item('2', 'vendedor', 'enviado'), item('3', 'pesquisa', 'pendente')];
    expect(itensParaMostrarNaTelaDeSync(fila, ['vendedor']).map((i) => i.id)).toEqual(['1']);
    expect(ROTULO_NAO_ENVIADO).toBe('Não enviado — módulo desativado');
  });

  it('RN-CORE-02: sem itens não enviados, os dados locais podem ser apagados', () => {
    expect(podeApagarDadosLocais([item('1', 'vendedor', 'enviado')], 'vendedor', false)).toBe(true);
    expect(podeApagarDadosLocais([], 'vendedor', false)).toBe(true);
  });

  it('RN-CORE-02: com itens rejeitados, só apaga depois que o usuário confirma que viu (nada some em silêncio)', () => {
    const fila = [item('1', 'vendedor', 'rejeitado_modulo_inativo')];
    expect(podeApagarDadosLocais(fila, 'vendedor', false)).toBe(false);
    expect(podeApagarDadosLocais(fila, 'vendedor', true)).toBe(true);
  });

  it('RN-CORE-02: nunca apaga enquanto ainda há item pendente por tentar, mesmo com confirmação', () => {
    expect(podeApagarDadosLocais([item('1', 'vendedor', 'pendente')], 'vendedor', true)).toBe(false);
  });

  it('RN-CORE-02: itens de outro módulo não seguram a limpeza deste', () => {
    expect(podeApagarDadosLocais([item('1', 'pesquisa', 'pendente')], 'vendedor', false)).toBe(true);
  });
});
