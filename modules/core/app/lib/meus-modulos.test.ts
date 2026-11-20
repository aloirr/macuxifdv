import type { ItemOutbox } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { itensNaoEnviadosPorModulo, linhasMeusModulos, podeConfirmarLimpeza, soTemOCore, versoesDaResposta, VERSAO_DESCONHECIDA } from './meus-modulos';

const item = (id: string, modulo: ItemOutbox['modulo'], situacao: ItemOutbox['situacao']): ItemOutbox => ({
  id, entidade: 'x', modulo, operacao: 'upsert', payload: {}, rotulo: '', detalhe: '', criado_em: '', tentativas: 0, ultimo_erro: '', ultima_tentativa_em: null, situacao, codigo: null,
});

describe('RF-CORE-02: tela Meus módulos', () => {
  it('RF-CORE-02: uma linha por módulo liberado, com a versão (— quando ainda não conhecida); o core é interno e não aparece', () => {
    expect(linhasMeusModulos(['core', 'vendedor', 'catalogo'], { core: '0.1.0', catalogo: '1.2.0' })).toEqual([
      { modulo: 'vendedor', versao: VERSAO_DESCONHECIDA },
      { modulo: 'catalogo', versao: '1.2.0' },
    ]);
    expect(linhasMeusModulos([], {})).toEqual([]);
    expect(linhasMeusModulos(['core'], { core: '0.1.0' })).toEqual([]);
  });

  it('RF-CORE-02: aviso de vazio só quando o core é o único ativo', () => {
    expect(soTemOCore(['core'])).toBe(true);
    expect(soTemOCore(['core', 'promotor'])).toBe(false);
  });

  it('RN-CORE-02: itens rejeitados por módulo desativado viram "não enviado — módulo desativado"', () => {
    const fila = [item('a', 'vendedor', 'modulo_inativo'), item('b', 'vendedor', 'pendente'), item('c', 'pesquisa', 'falhou')];
    expect(itensNaoEnviadosPorModulo(fila).map((i) => i.id)).toEqual(['a']);
  });

  it('RN-CORE-02: "Entendi" só libera quando o módulo saiu e nada ficou por tentar (nada some em silêncio)', () => {
    const fila = [item('a', 'vendedor', 'modulo_inativo')];
    expect(podeConfirmarLimpeza('vendedor', ['vendedor'], fila)).toBe(true);
    expect(podeConfirmarLimpeza('vendedor', [], fila)).toBe(false);
    expect(podeConfirmarLimpeza('vendedor', ['vendedor'], [...fila, item('b', 'vendedor', 'pendente')])).toBe(false);
  });

  it('GET /v1/me/modulos: lê as versões e ignora lixo', () => {
    expect(versoesDaResposta({ modulos: [{ id: 'core', versao: '0.1.0' }, { id: 5 }, null] })).toEqual({ core: '0.1.0' });
    expect(versoesDaResposta(null)).toEqual({});
  });
});
