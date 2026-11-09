/**
 * Kit de UI do app Android (copiado de apps/mobile da Fase M): tema (tokens e movimento, T-0072), ícones, componentes,
 * datas/horas no fuso do tenant e textos curtos. Usado pelo shell (apps/mobile) e por `modules/<m>/app`.
 */
export * from './theme';
export * from './icon';
export * from './ui';
export * from './time';
export * from './text';
export * from './atualizacao';
export * from './atualizacao-hook';
export * from './sincronizacao';
export * from './cliente';
export * from './navegacao';
export * from './componentes';
export * from './formulario';
export * from './folha';
export * from './valores';
export * from './movimento-rn';
export * from './base';
export * from './voltar';
export * from './selecao';
export * from './periodo';
export * from './suspensa';
export * from './filtro';
export * from './cartoes-pedido';
export * from './senha';
export * from './pendencias';
export * from './pendencias-rn';
// T-0133 (Novo pedido v2): desconto compacto único (item e pedido), histórico em tags e rodapé de ações compacto
export * from './desconto';
export * from './desconto-rn';
export * from '../comum/historico';
// RD-0014: nome curto e longo dos 7 perfis padrão (o mesmo do BKO, do portal e do login)
export * from '../comum/perfis';
export * from './historico-rn';
export * from './acoes';
export * from './acoes-rn';
// T-0140: tela de erro do shell (ErrorBoundary da tela de módulo e da raiz) e a linha do Diagnóstico
export * from './tela-de-erro';
export * from './tela-de-erro-rn';
