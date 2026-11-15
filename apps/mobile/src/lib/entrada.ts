/**
 * Tela única de entrada (T-0172; proposta aprovada em docs/marca/propostas/2026-11-12-entrada-sync, marca v1). Puro (roda
 * em Node nos testes): tamanho e posição do logo, rótulos da barra e o progresso da carga por etapas.
 *
 * - A splash nativa (app.config.ts) e esta tela têm o mesmo fundo e o mesmo logo, no mesmo tamanho e no centro: a passagem
 *   da splash para a sincronização não tem corte. As cores são do kit (`temaDaEntrada` do `@macuxi/ui`, do designer-ux):
 *   Campo no Azul noite com o logo negativo, Gestão no Pérola com o logo positivo.
 * - Antes do login, só o que não precisa de usuário: atualizar o app (a passagem dos dados do aparelho depois da
 *   atualização) e conferir o servidor. Sem nada a fazer, só o logo.
 * - Depois do login, as etapas nomeadas da carga (RN-CORE-48: `progressoDaEntrada` do `@macuxi/core/app`, contrato
 *   `ProgressoEntrada`) e o percentual do total. Aqui ficam só os textos da tela.
 */
import type { EtapaEntrada, ProgressoEntrada } from '@macuxi/core/contracts';
import { tamanhoFrase } from '@macuxi/platform-sdk';
import { MEDIDAS_FRASE_CARGA } from '@macuxi/ui/mobile/puro';

import { PROPORCAO_LOGO_EMPILHADO } from './logo-marca';

/** Largura do logo empilhado, em dp: a mesma `LARGURA_LOGO_SPLASH` do app.config.ts (o teste confere). */
export const LARGURA_LOGO_ENTRADA = 136;

/** Margem lateral e de baixo da área de sincronização (spec §2 e §5), em dp. */
export const MARGEM_ENTRADA = 32;

/** Nome da barra para o leitor de tela (spec §6). */
export const ROTULO_BARRA_ENTRADA = 'Sincronização';

/** Logo no centro da tela (onde a splash nativa o desenha): altura e distância do topo, em dp. */
export function posicaoDoLogo(alturaTela: number): { altura: number; topo: number } {
  const altura = Math.round(LARGURA_LOGO_ENTRADA / PROPORCAO_LOGO_EMPILHADO);
  return { altura, topo: Math.round((alturaTela - altura) / 2) };
}

/** Medidas da área de baixo (components/tela-entrada.tsx e spec §2 e §3), em dp. */
const ALTURA_BARRA = 34;
/** Linha do erro, "Tentar de novo" (52) e "Trocar usuário" (48), com os espaços. */
const ALTURA_ERRO = 24 + 18 + 52 + 18 + 48;
const ALTURA_ETAPA = 32;
const ESPACO_AREA = 18;
/** "Olá": o espaço acima e a linha do texto (fonte do sistema 16, ~19 dp desenhados na escala de fonte 1,0). */
const ACIMA_DA_SAUDACAO = 28;
const LINHA_SAUDACAO = 20;

const { titulo: TITULO, frase: FRASE, aviso: AVISO } = MEDIDAS_FRASE_CARGA;

/**
 * Escala de fonte do aparelho (`fontScale` do Android; 1 = normal). O texto cresce com ela, e a altura de cada linha também;
 * os espaços em dp, não. Fora de faixa (0, NaN) conta como 1.
 */
function linhaNaEscala(linha: number, escala: number): number {
  return Math.ceil(linha * (escala > 0 ? escala : 1));
}

/** "Olá" com o espaço acima dele, na escala de fonte dada. */
function alturaDaSaudacao(escala: number): number {
  return ACIMA_DA_SAUDACAO + linhaNaEscala(LINHA_SAUDACAO, escala);
}

/**
 * Linhas do aviso da carga (T-0181): o aviso nunca é cortado. Na escala 1,0 cabe nas linhas de `MEDIDAS_FRASE_CARGA.aviso`;
 * com fonte grande quebra e cabe em 2 até a escala 2,0, a maior do Android. Acima de 1,0 conta 2 de propósito: a conta nunca
 * fica abaixo do que a tela desenha.
 */
export function linhasDoAviso(escala = 1): number {
  return escala > 1 ? 2 : AVISO.linhas;
}

/** Aviso da carga e o espaço até a linha da barra (T-0181, spec carga-aviso-frases §1), na escala de fonte dada. */
export function alturaDoAviso(escala = 1): number {
  return linhasDoAviso(escala) * linhaNaEscala(AVISO.linha, escala) + AVISO.acimaDaBarra;
}

/** Linhas da frase do "Você sabia?" na tela: até `MEDIDAS_FRASE_CARGA.frase.linhasMax`, 1 ou nenhuma (o bloco inteiro sai). */
export type LinhasFrase = 0 | 1 | (typeof MEDIDAS_FRASE_CARGA)['frase']['linhasMax'];
/** Linhas com que a frase entra na tela (o bloco está na tela). */
export type LinhasNaTela = Exclude<LinhasFrase, 0>;

/** Altura do bloco "Você sabia?" (título e frase), pelas medidas de `MEDIDAS_FRASE_CARGA`; 0 sem o bloco. */
export function alturaDoBlocoFrase(linhas: LinhasFrase, escala = 1): number {
  if (linhas === 0) return 0;
  return TITULO.abaixoDoOla + linhaNaEscala(TITULO.linha, escala) + TITULO.ateFrase + linhas * linhaNaEscala(FRASE.linha, escala);
}

/**
 * Caracteres que cabem com folga numa linha de 280 dp em fonte do sistema 14 na escala de fonte 1,0 (largura média ~7,7 dp;
 * folga para as maiúsculas); com fonte grande, cabem menos na mesma proporção. Conta de propósito por baixo: a frase em
 * 1 linha nunca pode ser cortada (sem reticências, spec §1.1). A tela ainda confere o que desenhou (`fraseInteira`).
 */
export const CARACTERES_FRASE_EM_UMA_LINHA = 32;

/** A frase cabe inteira em 1 linha, na escala de fonte dada? Conta como o contrato (`tamanhoFrase` do SDK). */
export function fraseEmUmaLinha(texto: string, escala = 1): boolean {
  return tamanhoFrase(texto.trim()) * Math.max(1, escala) <= CARACTERES_FRASE_EM_UMA_LINHA;
}

/**
 * A frase desenhada (linhas medidas pela tela, `onTextLayout`) coube nas linhas dadas? Se não coube, o bloco "Você sabia?"
 * inteiro sai: a frase nunca é cortada com reticências (spec §1.1). Sem medida ainda (`null`), não aparece.
 */
export function fraseInteira(linhasMedidas: number | null, linhas: LinhasNaTela): boolean {
  return linhasMedidas !== null && linhasMedidas > 0 && linhasMedidas <= linhas;
}

/**
 * Espaço livre entre o pé do "Olá" e o topo do aviso, na carga (aviso e barra na área de baixo), em dp.
 */
function livreAbaixoDoOla(janela: number, insetInferior: number, escala: number): number {
  const { altura, topo } = posicaoDoLogo(janela);
  return janela - (topo + altura) - alturaDaSaudacao(escala) - (MARGEM_ENTRADA + insetInferior) - ALTURA_BARRA - alturaDoAviso(escala);
}

/**
 * Bloco "Você sabia?" na carga (spec carga-aviso-frases §1.1, MC-0077): precisa do espaço livre `frase.livreAteAviso` entre o
 * pé da frase e o topo do aviso. Sem isso, a frase cai para 1 linha (só se couber inteira em 1 linha); se ainda não couber, o bloco inteiro
 * sai (o título nunca aparece sozinho). Logo, "Olá", aviso e barra vêm antes; a lista de etapas sai antes do bloco
 * (`cabeLista` recebe o resultado daqui). A escala de fonte do aparelho entra nas alturas e no que cabe em 1 linha.
 */
export function cabeFrase(janela: number, insetInferior: number, texto: string, escala = 1): LinhasFrase {
  if (janela <= 0 || texto.trim() === '') return 0;
  const livre = livreAbaixoDoOla(janela, insetInferior, escala) - FRASE.livreAteAviso;
  if (livre >= alturaDoBlocoFrase(FRASE.linhasMax, escala)) return FRASE.linhasMax;
  if (livre >= alturaDoBlocoFrase(1, escala) && fraseEmUmaLinha(texto, escala)) return 1;
  return 0;
}

/** O que a carga põe entre o "Olá" e a barra (T-0181): o aviso acima da barra, o bloco "Você sabia?" e a escala de fonte. */
export interface ExtrasDaCarga {
  aviso?: boolean;
  linhasFrase?: LinhasFrase;
  /** Escala de fonte do aparelho (1 = normal); entra nas alturas do "Olá", do aviso e do bloco. */
  escala?: number;
}

/**
 * A lista de etapas cabe entre o logo (parado no centro) e a borda de baixo? Na tela baixa ela sai e ficam a barra com
 * "Etapa n de N · nome" e o percentual (ou, parada, a linha do erro e as ações), sem cobrir o logo. Na carga, conta o aviso
 * e o bloco "Você sabia?" (com o respiro até o aviso): a lista sai antes do bloco (spec carga-aviso-frases §1.1).
 */
export function cabeLista(
  alturaTela: number,
  etapas: number,
  insetInferior: number,
  comSaudacao: boolean,
  comErro = false,
  extras: ExtrasDaCarga = {},
): boolean {
  if (alturaTela <= 0) return false;
  const escala = extras.escala ?? 1;
  const { altura, topo } = posicaoDoLogo(alturaTela);
  const bloco = alturaDoBlocoFrase(extras.linhasFrase ?? 0, escala);
  const livre =
    alturaTela -
    (topo + altura) -
    (comSaudacao ? alturaDaSaudacao(escala) : 0) -
    (bloco > 0 ? bloco + FRASE.livreAteAviso : ESPACO_AREA) -
    (MARGEM_ENTRADA + insetInferior);
  const acimaDaLista = comErro ? ALTURA_ERRO : ALTURA_BARRA + (extras.aviso ? alturaDoAviso(escala) : 0);
  const precisa = acimaDaLista + ESPACO_AREA + etapas * ALTURA_ETAPA;
  return livre >= precisa;
}

/** Antes do login: a passagem dos dados do aparelho depois da atualização do app. */
export const ROTULO_ATUALIZANDO = 'Atualizando o app';
/** Antes do login: o teste do servidor (`/saude`). */
export const ROTULO_SERVIDOR = 'Conferindo o servidor';
export const ROTULO_PRONTO = 'Pronto';
/** Com tudo feito, o Início abre sozinho depois disto (spec §1, estado 5: dá para ver o 100%). */
export const ESPERA_PRONTO_MS = 600;
/** Conferir o servidor só mostra a barra se passar disto (sem piscar quando a resposta é rápida). */
export const ESPERA_BARRA_SERVIDOR_MS = 400;
/** Tempo máximo do teste do servidor na abertura: depois disto o login abre do mesmo jeito. */
export const TEMPO_SERVIDOR_ABERTURA_MS = 5_000;
/** O servidor é conferido uma vez por abertura do app (não a cada saída e volta ao login); o login marca aqui. */
export const servidorNaAbertura = { conferido: false };

/**
 * "Etapa 2 de 5 · Clientes e rota"; com a carga pronta, "Pronto". Sempre à vista em cima da barra, com ou sem a lista de
 * etapas (RD-1105); é também a região viva do leitor de tela.
 */
export function rotuloDaBarra(p: Pick<ProgressoEntrada, 'atual' | 'total' | 'pronta'>): string {
  return p.pronta ? ROTULO_PRONTO : `Etapa ${p.atual.numero} de ${p.total} · ${p.atual.nome}`;
}

/** O erro da carga é falta de sinal (modo sem sinal ligado ou a mensagem do motor/SDK sem conexão)? */
export function erroDeSinal(erro: string | null, offline: boolean): boolean {
  return offline || (erro !== null && /sem sinal|sem conex|network request failed/i.test(erro));
}

/**
 * Linha do erro. Sem a lista: "Sem internet na etapa 3 de 5" ou "Parou na etapa 3 de 5". Com a lista, que já marca a etapa
 * que parou (RD-0239): "Sem internet" ou "A sincronização parou".
 */
export function textoDoErro(
  parou: Pick<EtapaEntrada, 'numero'>,
  total: number,
  semSinal: boolean,
  comLista = false,
): string {
  if (comLista) return semSinal ? 'Sem internet' : 'A sincronização parou';
  return `${semSinal ? 'Sem internet' : 'Parou'} na etapa ${parou.numero} de ${total}`;
}

/**
 * RN-CORE-48 (pedido do dono do produto, 14/11: "1 de 5, 2 de 5, 3 de 5..."): guarda o último progresso mostrado e o devolve
 * como `anterior` no cálculo seguinte, para a etapa nunca voltar. Outra carga (outro usuário ou tenant: outra `chave`)
 * começa do zero (`anterior` = `null`).
 */
export function criarMemoriaDaEntrada(): (
  chave: string,
  calcular: (anterior: ProgressoEntrada | null) => ProgressoEntrada,
) => ProgressoEntrada {
  let guardado: { chave: string; ultimo: ProgressoEntrada } | null = null;
  return (chave, calcular) => {
    const ultimo = calcular(guardado?.chave === chave ? guardado.ultimo : null);
    guardado = { chave, ultimo };
    return ultimo;
  };
}
