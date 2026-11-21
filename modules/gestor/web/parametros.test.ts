/**
 * Alertas em Parâmetros (RD-1988, R-20261110-093124; ADR 0060): as regras da equipe e a produtividade do dia são painéis
 * da seção "Alertas" da página Parâmetros, e não uma página própria com título repetido. `alerta_regra.gerenciar` é só
 * analista e admin (a API revalida).
 */
import { describe, expect, it } from 'vitest';
import { criarShell, defineModule, definirModuloShell, type Perfil } from '@macuxi/platform-sdk';
import { moduloWeb } from './index';

// stub do Core (a fronteira proíbe importar o manifesto dele): só o que o Gestor exige, com os perfis do real
const coreStub = definirModuloShell({
  manifesto: defineModule({
    id: 'core',
    versao: '1.0.0',
    perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'],
    acoes: {
      'parametro.alertas_produtividade': { perfis: ['analista', 'admin'] },
      'trajeto.ver_equipe': { perfis: ['supervisor', 'gerente'] },
    },
    ofereceConsultas: ['core.cadastro_resumo@1', 'core.calendario_metas@1', 'core.produtividade_equipe@1', 'core.trajeto_do_dia@1'],
  }),
});
const shell = criarShell('web', [coreStub, moduloWeb]);
const visao = (perfil: Perfil) => shell.montar({ menuParametros: true, perfil, modulosAtivos: ['core', 'gestor'] });

describe('Gestor em Parâmetros › Alertas', () => {
  it('ADR 0060: a seção "alertas" traz Alertas da equipe e Produtividade do dia como painéis', () => {
    const secao = visao('analista').parametros.find((s) => s.secao === 'alertas');
    expect(secao?.paineis.map((p) => [p.ancora, p.titulo, p.origem])).toEqual([
      ['gestor-regras-alerta', 'Alertas da equipe', 'painel'],
      ['gestor-produtividade', 'Produtividade do dia', 'painel'],
    ]);
  });

  it('RD-1988: "Regras de alerta" não é mais página nem item de navegação', () => {
    const v = visao('analista');
    expect(moduloWeb.paginas?.some((p) => p.id === 'regras-alerta')).toBe(false);
    expect(v.navegacao.some((n) => n.id === 'regras-alerta')).toBe(false);
    expect(v.pagina('parametros/alertas')).toBeNull();
  });

  it('alerta_regra.gerenciar: supervisor não vê a seção', () => {
    const v = visao('supervisor');
    expect(v.parametros.some((s) => s.secao === 'alertas')).toBe(false);
  });
});
