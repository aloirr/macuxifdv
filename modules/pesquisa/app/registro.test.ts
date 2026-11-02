import { criarShell, defineModule, type Perfil } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { montarModuloApp } from './registro';

/** Core mínimo de teste: só oferece os slots que a Pesquisa usa (o manifesto real é interno do Core). */
const core = defineModule({
  id: 'core',
  versao: '0.1.0',
  perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'],
  apps: { campo: { abas: [] }, gestao: { abas: [] }, web: { menus: [] } },
  ofereceExtensoes: ['cliente.abas', 'cliente.acoes', 'visita.etapas_checkout', 'inicio.cards', 'menu.itens'],
});

const pesquisa = montarModuloApp<string>({ pesquisas: 'Pesquisas', responder: 'Responder', abaCliente: 'Aba', etapaCheckout: 'Etapa', cardInicio: 'Card' }, () => true);
const visao = (app: 'campo' | 'gestao', perfil: Perfil, modulosAtivos: ('core' | 'pesquisa')[] = ['core', 'pesquisa']) => criarShell(app, [{ manifesto: core, paginas: [] }, pesquisa]).montar({ perfil, modulosAtivos });

describe('RF-PES-03: a Pesquisa no shell do app (Campo e Gestão)', () => {
  it('o registro é aceito pelo criarShell real nas duas variantes (rótulos, caminhos, ações, entidades, slots)', () => {
    expect(() => criarShell('campo', [{ manifesto: core, paginas: [] }, pesquisa])).not.toThrow();
    expect(() => criarShell('gestao', [{ manifesto: core, paginas: [] }, pesquisa])).not.toThrow();
  });

  it('doc 03 §2: vendedor e promotor (Campo), supervisor e gerente (Gestão) veem a aba, o formulário, a etapa, a ficha e o card', () => {
    for (const [app, perfil] of [['campo', 'vendedor'], ['campo', 'promotor'], ['gestao', 'supervisor'], ['gestao', 'gerente']] as const) {
      const v = visao(app, perfil);
      expect(v.navegacao.map((n) => n.rotulo), `${app} ${perfil}`).toEqual(['Pesquisas']);
      expect(v.pagina('responder-pesquisa')).not.toBeNull();
      for (const slot of ['visita.etapas_checkout', 'cliente.abas', 'inicio.cards']) expect(v.extensoes(slot), `${slot} ${perfil}`).toHaveLength(1);
    }
  });

  it('doc 03 §2: analista, assistente e admin não respondem — nada da Pesquisa aparece para eles no app', () => {
    for (const perfil of ['analista', 'assistente', 'admin'] as const) {
      const v = visao('gestao', perfil);
      expect(v.navegacao).toEqual([]);
      expect(v.pagina('pesquisas')).toBeNull();
      expect(v.extensoes('visita.etapas_checkout')).toEqual([]);
    }
  });

  it('RN-CORE-02/03: com o módulo desativado a aba, a etapa obrigatória e a seção somem (sem erro)', () => {
    const v = visao('campo', 'vendedor', ['core']);
    expect(v.navegacao).toEqual([]);
    expect(v.extensoes('visita.etapas_checkout')).toEqual([]);
    expect(v.extensoes('cliente.abas')).toEqual([]);
  });

  it('RN-PES-03: a etapa do checkout é obrigatória e usa o concluida() do módulo', () => {
    const [etapa] = visao('campo', 'vendedor').extensoes<{ obrigatoria: boolean; concluida: () => boolean }>('visita.etapas_checkout');
    expect(etapa!.payload.obrigatoria).toBe(true);
    expect(etapa!.payload.concluida()).toBe(true);
  });

  it('ADR 0009: o app registra as entidades questionario_versao (pull) e resposta_pesquisa (push + pull)', () => {
    expect(pesquisa.entidadesSync?.map((e) => [e.nome, e.direcao, e.conflito])).toEqual([
      ['questionario_versao', 'pull', 'servidor_vence'],
      ['resposta_pesquisa', 'ambos', 'somente_insercao'],
    ]);
  });
});
