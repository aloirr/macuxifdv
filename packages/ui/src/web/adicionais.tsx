/**
 * MC-0042 (pedido do dono do produto, 14/11/2026: "VALORIZE-OS"): os módulos adicionais do plano, do id do contrato
 * (`ADICIONAIS` de `planos.ts` no platform-sdk) ao nome na tela e ao ícone. Usado no portal `config.` e no BKO.
 * Spec: docs/design/telas/portal-config-enxuto.md §11.10. Nome e ícone vêm do mapa único dos módulos (`./modulos`,
 * RD-0366): "Promotor" em todo lugar ("avulso" só na linha do preço; decisão (e) da bko-revisao.md §P13).
 * Só rótulo e ícone: preço, quantidade e regra vêm do contrato.
 */
import { iconeDoModulo, infoDoModulo } from './modulos';

export type AdicionalDoPlano = 'promotor' | 'pesquisa' | 'treinamento';

const IDS: readonly AdicionalDoPlano[] = ['promotor', 'pesquisa', 'treinamento'];

export const ADICIONAIS_DO_PLANO = IDS.map((id) => ({ id, nome: infoDoModulo(id).nome, Icone: iconeDoModulo(id) }));

const PorId = new Map(ADICIONAIS_DO_PLANO.map((a) => [a.id, a]));

/** Nome do adicional na tela (com maiúscula: é nome de módulo). Id desconhecido volta como veio. */
export const nomeDoAdicional = (id: string): string => PorId.get(id as AdicionalDoPlano)?.nome ?? id;

/** Ícone do adicional, ou `undefined` para id desconhecido (a tela mostra só o nome). */
export const iconeDoAdicional = (id: string) => PorId.get(id as AdicionalDoPlano)?.Icone;
