/**
 * Kit de UI do BKO web (copiado de apps/web da Fase M): componentes, ícones, overlay/toasts,
 * formatação pt-BR e cores dos faróis. Usado pelo shell (apps/web) e pelas páginas `modules/<m>/web`.
 * As classes Tailwind são resolvidas pelo globals.css do shell (`@source` aponta para cá).
 */
export * from './ui';
export * from './icons';
export * from './overlay';
export * from './format';
export * from './erros';
export * from './tones';
export * from './cores';
export * from './cliente';
export * from './senha';
export * from '../comum/sincronizacao';
export * from './permissoes';
// T-0133: histórico do pedido/orçamento em tags (o mesmo do app)
export * from './historico';
// MC-0042: módulos adicionais do plano (nome e ícone)
export * from './adicionais';
// Portal config §15: confirmação por digitação (ações sem volta)
export * from './confirmar';
