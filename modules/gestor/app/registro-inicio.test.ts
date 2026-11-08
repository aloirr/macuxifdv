import { criarShell, defineModule, type Perfil } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { manifest } from '../manifest';
import { ORDEM_CARD_APROVACOES, extensoesDaFicha, extensoesDoInicio } from './registro-inicio';

/** Core mínimo de teste: só oferece os slots que o Gestor usa. */
const core = defineModule({
  id: 'core',
  versao: '0.1.0',
  perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'],
  apps: { campo: { abas: [] }, gestao: { abas: [] }, web: { menus: [] } },
  ofereceConsultas: ['core.cadastro_resumo@1'],
  ofereceExtensoes: ['cliente.abas', 'cliente.acoes', 'cliente.avisos', 'visita.etapas_checkout', 'inicio.cards', 'menu.itens'],
});
const gestor = { manifesto: manifest, paginas: [], extensoes: [...extensoesDoInicio<string>('Card'), ...extensoesDaFicha<string>('Aviso')] };
const visao = (app: 'campo' | 'gestao', perfil: Perfil, modulosAtivos: ('core' | 'gestor')[] = ['core', 'gestor']) =>
  criarShell(app, [{ manifesto: core, paginas: [] }, gestor]).montar({ perfil, modulosAtivos });

describe('T-0073: card "Pedidos para aprovar" no slot inicio.cards', () => {
  it('o registro é aceito pelo criarShell real e o card sai com ordem 10 (antes dos cards de outros módulos)', () => {
    const [card] = visao('gestao', 'supervisor').extensoes<{ testID: string; ordem: number }>('inicio.cards');
    expect(card!.payload).toMatchObject({ testID: 'inicio.card-aprovacoes', ordem: ORDEM_CARD_APROVACOES });
    expect(ORDEM_CARD_APROVACOES).toBeLessThan(100);
  });

  it('RN-CORE-04: supervisor e gerente (Gestão) veem o card', () => {
    for (const perfil of ['supervisor', 'gerente'] as const) expect(visao('gestao', perfil).extensoes('inicio.cards'), perfil).toHaveLength(1);
  });

  it('RN-PRO-01: o Campo (vendedor, promotor) nunca tem o card de aprovação', () => {
    for (const perfil of ['vendedor', 'promotor'] as const) expect(visao('campo', perfil).extensoes('inicio.cards'), perfil).toEqual([]);
  });

  it('RN-GES-07: analista e admin não aprovam, então não têm o card', () => {
    for (const perfil of ['analista', 'admin'] as const) expect(visao('gestao', perfil).extensoes('inicio.cards'), perfil).toEqual([]);
  });

  it('RN-CORE-02/03: com o Gestor desligado o card some, sem erro', () => {
    expect(visao('gestao', 'supervisor', ['core']).extensoes('inicio.cards')).toEqual([]);
  });
});

describe('T-0102: aviso da etapa pendente da equipe no slot cliente.avisos', () => {
  it('RN-CORE-12: supervisor e gerente (Gestão) recebem o aviso com o testID combinado', () => {
    for (const perfil of ['supervisor', 'gerente'] as const) {
      const [item] = visao('gestao', perfil).extensoes<{ testID: string }>('cliente.avisos');
      expect(item!.payload.testID, perfil).toBe('gestor.cliente-etapa-pendente-equipe');
    }
  });

  it('RN-PRO-01/RN-GES-07: Campo, analista e admin não têm o aviso', () => {
    for (const perfil of ['vendedor', 'promotor'] as const) expect(visao('campo', perfil).extensoes('cliente.avisos'), perfil).toEqual([]);
    for (const perfil of ['analista', 'admin'] as const) expect(visao('gestao', perfil).extensoes('cliente.avisos'), perfil).toEqual([]);
  });

  it('RN-CORE-02/03: com o Gestor desligado o aviso some, sem erro', () => {
    expect(visao('gestao', 'supervisor', ['core']).extensoes('cliente.avisos')).toEqual([]);
  });

  it('o manifesto declara o uso do slot', () => {
    expect(manifest.usaExtensoes).toContain('cliente.avisos');
  });
});
