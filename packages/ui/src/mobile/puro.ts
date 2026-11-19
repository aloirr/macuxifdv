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
// R-20261115-071000: CampoSenha (medidas, ícone do olho e props de teclado)
export * from './campo-senha';
// R-20261115-100000: segurar 10 s no Sincronizar = sincronização completa (tempos, textos, desenho e controle do gesto)
export * from './sincronizacao-completa';
// Onda 1 do catálogo (solução 5): textos e medidas do indicador de carga em segundo plano
export * from './carga-fundo';
// T-0182: PlacaLogoCliente (medidas, caixa pela proporção e leitura do TalkBack)
export * from './placa-logo';
// RD-2355 (T-0186): tabelas da ficha (medidas, largura e alinhamento das colunas, leitura do par rótulo-valor)
export * from './tabela-ficha';
