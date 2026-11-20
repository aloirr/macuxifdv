/**
 * Cartão "Logo" e campo "Nome fantasia" da aba Empresa do portal `config.` (T-0182; spec docs/design/telas/logo-cliente.md §2;
 * desenho docs/desenho/T-0182-logo-cliente.md §2). Regras e textos puros, sem React: a tela (`components/portal/cartao-logo.tsx`)
 * só desenha o que sai daqui.
 * - Só o time da Macuxi grava (RN-CORE-33); o admin do cliente vê a logo e o nome fantasia, sem botões.
 * - A conferência do arquivo antes de enviar é a mesma da API (`conferirLogo` do SDK: tipo, tamanho, altura e lado máximo, pelo
 *   cabeçalho); o servidor revalida sempre.
 * - Erros: a frase exata da spec por código (`MENSAGENS_LOGO`); rota ausente = `TEXTO_INDISPONIVEL`; o resto
 *   (rede, 5xx, 503) = "Não foi possível salvar. Tente de novo." Nunca o texto do servidor em inglês.
 */
import {
  CODIGOS_LOGO,
  conferirLogo,
  MENSAGENS_LOGO,
  nomeDaEmpresa,
  rotuloDaLogo,
  TEXTO_LIMITES_LOGO,
  type CodigoLogo,
  type MarcaEmpresa,
} from '@macuxi/platform-sdk';

import { ehRotaAusente, ErroPortal, TEXTO_INDISPONIVEL } from './portal-api';

export const TEXTOS_LOGO = {
  titulo: 'Logo',
  limites: TEXTO_LIMITES_LOGO,
  enviar: 'Enviar logo',
  salvar: 'Salvar',
  salvando: 'Salvando…',
  cancelar: 'Cancelar',
  trocar: 'Trocar',
  remover: 'Remover',
  dialogo: 'Remover a logo?',
  carregando: 'Buscando a logo…',
  falhaSalvar: 'Não foi possível salvar. Tente de novo.',
  /** A constante única do portal para rota ausente (RD-0288). */
  rotaAusente: TEXTO_INDISPONIVEL,
  nomeFantasia: 'Nome fantasia',
  /** Item 15 (v1.0.17): liga/desliga do time da Macuxi, no cartão da logo. */
  ocultarMarca: 'Ocultar a logomarca do Macuxi',
} as const;

/** Tipos aceitos no seletor de arquivo do sistema (spec §2: filtrado em PNG e JPG). */
export const ACEITA_LOGO = 'image/png,image/jpeg';

/** "Logo da <nome fantasia>" (spec §1, acessibilidade); sem nome fantasia, vale a razão social. */
export function altDaLogo(m: Pick<MarcaEmpresa, 'nome_fantasia' | 'razao_social'>): string {
  return rotuloDaLogo(nomeDaEmpresa(m.nome_fantasia, m.razao_social));
}

const CODIGOS = new Set<string>(Object.values(CODIGOS_LOGO));
const ehCodigoLogo = (c: string): c is CodigoLogo => CODIGOS.has(c);

/** Erro do arquivo (volta ao estado anterior, spec §2 estado 5) ou da gravação (o arquivo escolhido fica para tentar de novo). */
export interface ErroDaLogo {
  mensagem: string;
  /** `true`: o arquivo foi recusado (formato, tamanho, altura, lado) e a pré-visualização sai. */
  doArquivo: boolean;
}

/** Erro de uma chamada de gravação (logo ou nome) → frase da spec. */
export function erroDaGravacao(e: unknown): ErroDaLogo {
  if (ehRotaAusente(e)) return { mensagem: TEXTOS_LOGO.rotaAusente, doArquivo: false };
  if (e instanceof ErroPortal) {
    if (ehCodigoLogo(e.codigo) && e.codigo !== CODIGOS_LOGO.naoEncontrada) return { mensagem: MENSAGENS_LOGO[e.codigo], doArquivo: true };
    // proxy ou servidor que recusou antes da rota (sem o corpo da API): o status diz qual foi
    if (e.status === 413) return { mensagem: MENSAGENS_LOGO[CODIGOS_LOGO.grande], doArquivo: true };
    if (e.status === 415) return { mensagem: MENSAGENS_LOGO[CODIGOS_LOGO.formato], doArquivo: true };
  }
  return { mensagem: TEXTOS_LOGO.falhaSalvar, doArquivo: false };
}

/** Confere o arquivo escolhido antes de mostrar a pré-visualização: `null` = aceito; senão, a frase do erro. */
export function recusaDoArquivo(bytes: Uint8Array, tipo: string): string | null {
  const c = conferirLogo(bytes, tipo);
  return c.ok ? null : MENSAGENS_LOGO[c.codigo];
}

/** O que o cartão mostra (spec §2, os 6 estados). */
export type EstadoCartaoLogo =
  | { tipo: 'sem-logo' }
  | { tipo: 'escolhido' }
  | { tipo: 'salvando' }
  | { tipo: 'salva' };

/** Botões de cada estado; o admin do cliente (só leitura) não tem nenhum. */
export type BotaoLogo = 'enviar' | 'salvar' | 'salvando' | 'cancelar' | 'cancelar-desabilitado' | 'trocar' | 'remover';

export function botoesDoCartao(estado: EstadoCartaoLogo, podeGravar: boolean): readonly BotaoLogo[] {
  if (!podeGravar) return [];
  switch (estado.tipo) {
    case 'sem-logo':
      return ['enviar'];
    case 'escolhido':
      return ['salvar', 'cancelar'];
    case 'salvando':
      return ['salvando', 'cancelar-desabilitado'];
    case 'salva':
      return ['trocar', 'remover'];
  }
}

/** Estado pelo que há: arquivo escolhido (com ou sem gravação em curso) ou a logo salva. */
export function estadoDoCartao(p: { escolhido: boolean; salvando: boolean; temLogoSalva: boolean }): EstadoCartaoLogo {
  if (p.escolhido) return { tipo: p.salvando ? 'salvando' : 'escolhido' };
  return { tipo: p.temLogoSalva ? 'salva' : 'sem-logo' };
}

/** Linha de baixo: o erro no lugar dos limites (spec §2); o admin do cliente não envia, então não vê os limites. */
export function linhaDeBaixo(erro: string | null, podeGravar: boolean): { tipo: 'erro'; texto: string } | { tipo: 'limites'; texto: string } | null {
  if (erro) return { tipo: 'erro', texto: erro };
  return podeGravar ? { tipo: 'limites', texto: TEXTOS_LOGO.limites } : null;
}

/** Nome fantasia digitado mudou em relação ao salvo? (vazio e só espaços = apagar, como o `GravarNomeFantasiaSchema`). */
export function nomeMudou(digitado: string, salvo: string | null): boolean {
  return (digitado.trim() || null) !== (salvo ?? null);
}
