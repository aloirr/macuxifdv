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
const ALTURA_SAUDACAO = 48;

/** Aviso da carga (1 linha) e o espaço até a linha da barra (T-0174, spec carga-aviso-frases §1). */
const ALTURA_AVISO = MEDIDAS_FRASE_CARGA.aviso.linha + MEDIDAS_FRASE_CARGA.aviso.acimaDaBarra;

/** Linhas da frase do "Você sabia?" na tela: 2, 1 ou nenhuma (o bloco inteiro sai). */
export type LinhasFrase = 0 | 1 | 2;

/** Altura do bloco "Você sabia?" (título e frase): 84 dp com 2 linhas, 64 com 1, 0 sem o bloco. */
export function alturaDoBlocoFrase(linhas: LinhasFrase): number {
  if (linhas === 0) return 0;
  const { titulo, frase } = MEDIDAS_FRASE_CARGA;
  return titulo.abaixoDoOla + titulo.linha + titulo.ateFrase + linhas * frase.linha;
}

/**
 * Caracteres que cabem com folga numa linha de 280 dp em IBM Plex Sans 14 (largura média ~7,7 dp; folga para as
 * maiúsculas). Conta de propósito por baixo: a frase em 1 linha nunca pode ser cortada (sem reticências, spec §1.1).
 */
export const CARACTERES_FRASE_EM_UMA_LINHA = 32;

/** A frase cabe inteira em 1 linha? */
export function fraseEmUmaLinha(texto: string): boolean {
  return Array.from(texto.trim()).length <= CARACTERES_FRASE_EM_UMA_LINHA;
}

/**
 * Espaço livre entre o pé do "Olá" e o topo do aviso, na carga (aviso e barra na área de baixo), em dp.
 */
function livreAbaixoDoOla(janela: number, insetInferior: number): number {
  const { altura, topo } = posicaoDoLogo(janela);
  return janela - (topo + altura) - ALTURA_SAUDACAO - (MARGEM_ENTRADA + insetInferior) - ALTURA_BARRA - ALTURA_AVISO;
}

/**
 * Bloco "Você sabia?" na carga (spec carga-aviso-frases §1.1, MC-0077): precisa de 24 dp livres entre o pé da frase e o
 * topo do aviso. Sem isso, a frase cai para 1 linha (só se couber inteira em 1 linha); se ainda não couber, o bloco inteiro
 * sai (o título nunca aparece sozinho). Logo, "Olá", aviso e barra vêm antes; a lista de etapas sai antes do bloco
 * (`cabeLista` recebe o resultado daqui).
 */
export function cabeFrase(janela: number, insetInferior: number, texto: string): LinhasFrase {
  if (janela <= 0 || texto.trim() === '') return 0;
  const livre = livreAbaixoDoOla(janela, insetInferior) - MEDIDAS_FRASE_CARGA.frase.livreAteAviso;
  if (livre >= alturaDoBlocoFrase(2)) return 2;
  if (livre >= alturaDoBlocoFrase(1) && fraseEmUmaLinha(texto)) return 1;
  return 0;
}

/** O que a carga põe entre o "Olá" e a barra (T-0174): o aviso acima da barra e o bloco "Você sabia?". */
export interface ExtrasDaCarga {
  aviso?: boolean;
  linhasFrase?: LinhasFrase;
}

/**
 * A lista de etapas cabe entre o logo (parado no centro) e a borda de baixo? Na tela baixa ela sai e ficam a barra com
 * "Etapa n de N · nome" e o percentual (ou, parada, a linha do erro e as ações), sem cobrir o logo. Na carga, conta o aviso
 * e o bloco "Você sabia?" (com o respiro de 24 dp): a lista sai antes do bloco (spec carga-aviso-frases §1.1).
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
  const { altura, topo } = posicaoDoLogo(alturaTela);
  const bloco = alturaDoBlocoFrase(extras.linhasFrase ?? 0);
  const livre =
    alturaTela -
    (topo + altura) -
    (comSaudacao ? ALTURA_SAUDACAO : 0) -
    (bloco > 0 ? bloco + MEDIDAS_FRASE_CARGA.frase.livreAteAviso : ESPACO_AREA) -
    (MARGEM_ENTRADA + insetInferior);
  const acimaDaLista = comErro ? ALTURA_ERRO : ALTURA_BARRA + (extras.aviso ? ALTURA_AVISO : 0);
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
 * "Etapa 2 de 5 · Clientes e rota"; com a carga pronta, "Pronto". Na tela só sem a lista de etapas (tela baixa); com a
 * lista visível, vai só ao leitor de tela (RD-0239: a lista já mostra a etapa em destaque).
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
