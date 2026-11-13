/**
 * `@macuxi/ui/mobile/puro` — parte PURA do kit mobile: datas/horas no fuso do tenant e textos curtos.
 * Não importa react-native, expo-router nem SVG: roda em Node (Vitest) e em libs puras de `modules/<m>/app`.
 * O índice `@macuxi/ui/mobile` reexporta tudo isto junto com tema, ícones e componentes.
 */
export * from './time';
export * from './text';
export * from './atualizacao';
export * from './componentes';
export * from './tokens';
export * from './cabecalho';
export * from './entrada';
export * from './movimento';
export * from './selecao';
export * from './periodo';
export * from './pendencias';
export * from '../comum/cadastro';
export * from '../comum/senha';
export * from './desconto';
export * from './acoes';
export * from '../comum/historico';
// RD-0014: nome curto e longo dos 7 perfis padrão (o mesmo do BKO, do portal e do login)
export * from '../comum/perfis';
// T-0140: textos da tela de erro e da linha do Diagnóstico
export * from './tela-de-erro';
// T-0166 / T-0165 / T-0167: falta no campo, Balao, CampoEscolha e o fim da lista da busca (partes puras)
export * from './falta';
export * from './balao';
export * from './campo-escolha';
export * from './busca';
// T-0165: BotaoEditar (medidas e leitura do TalkBack)
export * from './botao-editar';
