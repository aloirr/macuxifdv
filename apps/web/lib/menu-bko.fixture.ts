/**
 * Preparo comum dos testes do menu do BKO: registro real dos 8 módulos, perfil admin, menu com Parâmetros (ADRs 0050 e 0060).
 */
import { montarGruposMenu } from './menu-bko';
import { SHELL_WEB } from './modulos';
import { secoesParametros } from './parametros';

export const TODOS_MODULOS = ['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento', 'integracao'] as const;
export type ModuloInstalado = (typeof TODOS_MODULOS)[number];

/** Admin com `ativos` (padrão: os 8) e, se dado, a contratação da empresa (`contratados`). */
export function montarMenuAdmin(ativos: readonly ModuloInstalado[] = TODOS_MODULOS, contratados?: readonly ModuloInstalado[]) {
  const visao = SHELL_WEB.montar({ perfil: 'admin', modulosAtivos: [...ativos], menuParametros: true, ...(contratados ? { modulosContratados: [...contratados] } : {}) });
  const secoes = secoesParametros(visao);
  return { visao, secoes, grupos: montarGruposMenu({ navegacao: visao.navegacao, plataforma: true, parametros: secoes.length > 0 }) };
}
