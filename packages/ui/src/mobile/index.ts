/**
 * Kit de UI do app Android (copiado de apps/mobile da Fase M): tema (tokens e movimento, T-0072), ícones, componentes,
 * datas/horas no fuso do tenant e textos curtos. Usado pelo shell (apps/mobile) e por `modules/<m>/app`.
 */
export * from './theme';
// T-0172: cabeçalho na faixa Azul noite (marca v1); o componente é o CabecalhoTela de ui.tsx
export * from './cabecalho';
export * from './entrada';
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
// N-1 do v1017: nome do módulo na tela (o mesmo do BKO), sem ícone nem React
export { nomeDoModulo } from '../comum/modulos';
export * from './historico-rn';
export * from './acoes';
export * from './acoes-rn';
// T-0140: tela de erro do shell (ErrorBoundary da tela de módulo e da raiz) e a linha do Diagnóstico
export * from './tela-de-erro';
export * from './tela-de-erro-rn';
// T-0166: falta no campo, só na tentativa (borda e texto curto); T-0165: Balao e CampoEscolha; T-0167: fim da lista da busca
export * from './falta';
export * from './falta-rn';
export * from './balao';
export * from './balao-rn';
export * from './campo-escolha';
export * from './campo-escolha-rn';
export * from './busca';
export * from './busca-rn';
// T-0165: BotaoEditar, o lápis do item já no pedido (aba Itens e Resumo; pedido-v4.md §5.8)
export * from './botao-editar';
export * from './botao-editar-rn';
// RD-0039: BotaoFolha (perigo sólido / contorno, toque por opacidade) e LinhaOpcaoFolha, das folhas de ação do pedido
export * from './botao-folha';
export * from './botao-folha-rn';
// R-20261115-071000: CampoSenha, o campo de senha único (olho em ícone, props de teclado de senha)
export * from './campo-senha';
export * from './campo-senha-rn';
// R-20261115-100000: segurar 10 s no Sincronizar = sincronização completa (parte pura); o popup é o `Dialogo` sem botões com a `BarraProgresso`
export * from './sincronizacao-completa';
export * from './barra-progresso-rn';
// RD-0951: CampoTexto (rótulo, entrada e erro) e RotuloCampo, o mesmo rótulo e a mesma entrada do CampoSenha
export * from './campo-texto-rn';
// Onda 1 do catálogo (solução 5): IndicadorCargaFundo ("Catálogo 63%") e CatalogoCarregando, o catálogo sem sinal na carga
export * from './carga-fundo';
export * from './carga-fundo-rn';
// T-0182: PlacaLogoCliente, a logo da empresa numa placa branca (carga 64/48 e fim do Mais 52/36)
export * from './placa-logo';
export * from './placa-logo-rn';
// RD-2355 (T-0186): TabelaRotuloValor e TabelaDados (CelulaTexto, BotaoCelula), as tabelas da ficha do Cliente 360 e do pedido
export * from './tabela-ficha';
export * from './tabela-ficha-rn';
// v1.0.17 (R-20261120-055304 item 2): SinoNotificacoes, o sino padrão de todas as telas (medidas, cores, selo e leitura em sino.ts)
export * from './sino';
export * from './sino-rn';
