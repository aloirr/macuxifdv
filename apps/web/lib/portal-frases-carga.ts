/**
 * T-0174 (spec docs/design/carga-aviso-frases/spec.md §3): Portal › Frases da carga, só do time Macuxi (super-admin). Puro,
 * para teste: textos, ordem da tabela, contador do campo e a mensagem de erro na linha do campo. A regra do texto é a do SDK
 * (`validarTextoFrase`); a API revalida e o índice único do banco dá a palavra final na duplicidade.
 */
import {
  CODIGOS_FRASE_CARGA,
  FRASE_CARGA_MAX,
  MENSAGENS_FRASE_CARGA,
  ordenarFrasesDoPortal,
  tamanhoFrase,
  validarTextoFrase,
  type FraseCarga,
} from '@macuxi/platform-sdk';
import type { BadgeTone } from '@macuxi/ui/web';

/** Página do portal (sem o prefixo `/config`: no host `config.` o navegador vê `/frases-carga`). */
export const CAMINHO_FRASES_CARGA = '/frases-carga';

export const TEXTOS_PORTAL_FRASES = {
  titulo: 'Frases da carga',
  incluir: 'Incluir frase',
  carregando: 'Buscando as frases…',
  vazio: 'Nenhuma frase cadastrada.',
  semAcesso: 'Esta área é só do time Macuxi.',
  editar: 'Editar',
  ativar: 'Ativar',
  desativar: 'Desativar',
  campo: 'Frase',
  cancelar: 'Cancelar',
  salvar: 'Salvar',
  salvando: 'Salvando…',
} as const;

export const tituloDoDialogoFrase = (numero: number | null): string => (numero === null ? TEXTOS_PORTAL_FRASES.incluir : `Editar frase ${numero}`);

/** Selo da Situação. */
export function situacaoDaFrase(ativa: boolean): { rotulo: string; tom: BadgeTone } {
  return ativa ? { rotulo: 'Ativa', tom: 'success' } : { rotulo: 'Inativa', tom: 'neutral' };
}

/** Link da linha que muda a situação (imediato, sem confirmação). */
export const acaoDaSituacao = (ativa: boolean): string => (ativa ? TEXTOS_PORTAL_FRASES.desativar : TEXTOS_PORTAL_FRASES.ativar);

/** Ordem da tabela: ativas primeiro pelo Nº, inativas no fim. */
export const frasesDaTabela = (lista: readonly FraseCarga[]): FraseCarga[] => ordenarFrasesDoPortal(lista);

/** A área de texto para em 90 caracteres (por ponto de código, como o banco conta). */
export function cortarFrase(texto: string): string {
  const c = Array.from(texto);
  return c.length > FRASE_CARGA_MAX ? c.slice(0, FRASE_CARGA_MAX).join('') : texto;
}

/** Contador abaixo do campo: "64 de 90". */
export const contadorDaFrase = (texto: string): string => `${tamanhoFrase(texto.trim())} de ${FRASE_CARGA_MAX}`;

/** Erro do formulário antes de enviar (vazia, longa ou já na lista); `null` = pode salvar. */
export function erroDoFormulario(texto: string, lista: readonly FraseCarga[], idProprio?: string): string | null {
  const r = validarTextoFrase(texto, lista, idProprio);
  return r.ok ? null : r.mensagem;
}

/** Erro da API (422) na linha do campo; os outros erros vão para o aviso do diálogo. */
export function erroDoCampo(codigo: string | null | undefined): string | null {
  const c = Object.values(CODIGOS_FRASE_CARGA).find((x) => x === codigo);
  return c ? MENSAGENS_FRASE_CARGA[c] : null;
}
