import { describe, expect, it } from 'vitest';
import { defineModule, ErroManifesto, ordenarPorDependencia, validarConjunto, type ManifestoEntrada } from './manifesto';
import { formatarNomeEvento, lerNomeEvento } from './nomes';

const promotor: ManifestoEntrada = {
  id: 'promotor',
  versao: '1.0.0',
  depende: ['core'],
  opcionais: ['catalogo', 'pesquisa', 'vendedor'],
  perfis: ['promotor', 'supervisor', 'gerente', 'analista'],
  apps: { campo: { abas: ['Loja'] }, gestao: { abas: ['Trade'] }, web: { menus: ['Trade marketing'] } },
  sync: ['checklist_loja', 'mix_obrigatorio'],
  publica: ['promotor.share.medido@1', 'promotor.ruptura.registrada@1'],
  consome: ['core.visita.checkin@1', 'core.visita.checkout@1'],
  usaExtensoes: ['cliente.abas', 'visita.etapas_checkout', 'inicio.cards'],
};

const core = defineModule({
  id: 'core',
  versao: '1.0.0',
  perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'],
  ofereceExtensoes: ['cliente.abas', 'visita.etapas_checkout', 'inicio.cards', 'menu.itens'],
  publica: ['core.visita.checkin@1', 'core.visita.checkout@1'],
});

function problemas(m: ManifestoEntrada): string[] {
  try {
    defineModule(m);
    return [];
  } catch (e) {
    expect(e).toBeInstanceOf(ErroManifesto);
    return (e as ErroManifesto).problemas;
  }
}

describe('nome de evento <modulo>.<entidade>.<fato>@vN', () => {
  it('lê e formata', () => {
    expect(lerNomeEvento('vendedor.pedido.status_alterado@2')).toEqual({ modulo: 'vendedor', entidade: 'pedido', fato: 'status_alterado', versao: 2 });
    expect(formatarNomeEvento({ modulo: 'core', entidade: 'visita', fato: 'checkin', versao: 1 })).toBe('core.visita.checkin@1');
  });

  it.each(['vendedor.pedido.criado', 'vendedor.pedido@1', 'Vendedor.pedido.criado@1', 'vendedor.pedido.criado@0', 'vendedor.pedido.criado@v1'])(
    'rejeita %s',
    (nome) => expect(lerNomeEvento(nome)).toBeNull(),
  );
});

describe('defineModule', () => {
  it('aceita o manifesto do exemplo do doc 04, preenche padrões e congela', () => {
    const m = defineModule(promotor);
    expect(m.ofereceExtensoes).toEqual([]);
    expect(m.apps.campo?.abas).toEqual(['Loja']);
    expect(Object.isFrozen(m)).toBe(true);
    expect(Object.isFrozen(m.publica)).toBe(true);
  });

  it('módulo só publica eventos com o próprio prefixo', () => {
    expect(problemas({ ...promotor, publica: ['vendedor.pedido.criado@1'] })).toEqual(['publica.0: módulo promotor só publica eventos promotor.*']);
  });

  it('todo módulo depende de core; core não depende de ninguém', () => {
    expect(problemas({ ...promotor, depende: [] })).toContain('depende: todo módulo depende de core');
    expect(problemas({ id: 'core', versao: '1.0.0', perfis: ['admin'], depende: ['catalogo'] })).toContain('depende: core não depende de nenhum módulo');
  });

  it('valida formatos e campos desconhecidos', () => {
    const p = problemas({ ...promotor, versao: '1.0', sync: ['ChecklistLoja'], usaExtensoes: ['abas'], perfis: [] } as ManifestoEntrada);
    expect(p.some((x) => x.startsWith('versao:'))).toBe(true);
    expect(p.some((x) => x.startsWith('sync.0:'))).toBe(true);
    expect(p.some((x) => x.startsWith('usaExtensoes.0:'))).toBe(true);
    expect(p).toContain('perfis: informe ao menos um perfil');
    expect(problemas({ ...promotor, telas: [] } as unknown as ManifestoEntrada).length).toBeGreaterThan(0);
  });

  it('não aceita repetidos nem o mesmo módulo em depende e opcionais', () => {
    expect(problemas({ ...promotor, sync: ['foto', 'foto'] })).toContain('sync: itens repetidos');
    expect(problemas({ ...promotor, opcionais: ['core'] })).toContain('opcionais: core é obrigatório, não opcional');
  });
});

describe('conjunto de módulos instalados', () => {
  const m = defineModule(promotor);

  it('ok quando dependências e extensões estão presentes', () => {
    expect(validarConjunto([core, m])).toEqual([]);
  });

  it('aponta dependência ausente, extensão sem dono e duplicado', () => {
    expect(validarConjunto([m])).toEqual(
      expect.arrayContaining([
        'promotor depende de core, que não está instalado',
        'promotor usa a extensão cliente.abas, que nenhum módulo oferece',
      ]),
    );
    expect(validarConjunto([core, core])).toContain('módulo core registrado duas vezes');
  });

  it('ordena dependências antes e detecta ciclo', () => {
    const vendedor = defineModule({ id: 'vendedor', versao: '1.0.0', depende: ['core'], opcionais: ['catalogo'], perfis: ['vendedor'] });
    const catalogo = defineModule({ id: 'catalogo', versao: '1.0.0', depende: ['core'], perfis: ['vendedor'] });
    expect(ordenarPorDependencia([vendedor, m, catalogo, core]).map((x) => x.id)).toEqual(['core', 'catalogo', 'vendedor', 'promotor']);
    const a = { id: 'a', depende: ['b'], opcionais: [] };
    const b = { id: 'b', depende: ['a'], opcionais: [] };
    expect(() => ordenarPorDependencia([a, b] as never)).toThrow('dependência circular entre módulos: a → b → a');
  });
});
