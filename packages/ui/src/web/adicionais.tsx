/**
 * MC-0042 (pedido do dono do produto, 14/11/2026: "VALORIZE-OS"): mapa único dos módulos adicionais do plano, do id do
 * contrato (`ADICIONAIS` de `planos.ts` no platform-sdk) ao nome na tela e ao ícone. Usado no portal `config.` (caixa do
 * adicional e linha da tabela de licenças) e no BKO. Spec: docs/design/telas/portal-config-enxuto.md §11.10.
 * Só rótulo e ícone: preço, quantidade e regra vêm do contrato.
 */
import type { ComponentType, SVGProps } from 'react';
import { IconPesquisa, IconPromotor, IconTreinamento } from './icons';

export type AdicionalDoPlano = 'promotor' | 'pesquisa' | 'treinamento';

type IconeDoAdicional = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

export const ADICIONAIS_DO_PLANO: readonly { id: AdicionalDoPlano; nome: string; Icone: IconeDoAdicional }[] = [
  { id: 'promotor', nome: 'Promotor Avulso', Icone: IconPromotor },
  { id: 'pesquisa', nome: 'Pesquisa', Icone: IconPesquisa },
  { id: 'treinamento', nome: 'Treinamento', Icone: IconTreinamento },
];

const PorId = new Map(ADICIONAIS_DO_PLANO.map((a) => [a.id, a]));

/** Nome do adicional na tela (com maiúscula: é nome de módulo). Id desconhecido volta como veio. */
export const nomeDoAdicional = (id: string): string => PorId.get(id as AdicionalDoPlano)?.nome ?? id;

/** Ícone do adicional, ou `undefined` para id desconhecido (a tela mostra só o nome). */
export const iconeDoAdicional = (id: string): IconeDoAdicional | undefined => PorId.get(id as AdicionalDoPlano)?.Icone;
