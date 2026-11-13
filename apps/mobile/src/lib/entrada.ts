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

import { PROPORCAO_LOGO_EMPILHADO } from './logo-marca';

/** Largura do logo empilhado, em dp: a mesma `LARGURA_LOGO_SPLASH` do app.config.ts (o teste confere). */
export const LARGURA_LOGO_ENTRADA = 168;

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
const ALTURA_SAUDACAO = 40;

/**
 * A lista de etapas cabe entre o logo (parado no centro) e a borda de baixo? Na tela baixa ela sai e ficam a barra com
 * "Etapa n de N · nome" e o percentual (ou, parada, a linha do erro e as ações), sem cobrir o logo.
 */
export function cabeLista(
  alturaTela: number,
  etapas: number,
  insetInferior: number,
  comSaudacao: boolean,
  comErro = false,
): boolean {
  if (alturaTela <= 0) return false;
  const { altura, topo } = posicaoDoLogo(alturaTela);
  const livre =
    alturaTela -
    (topo + altura) -
    (comSaudacao ? ALTURA_SAUDACAO : 0) -
    ESPACO_AREA -
    (MARGEM_ENTRADA + insetInferior);
  const precisa = (comErro ? ALTURA_ERRO : ALTURA_BARRA) + ESPACO_AREA + etapas * ALTURA_ETAPA;
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
