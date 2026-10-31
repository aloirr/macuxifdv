/**
 * Validação da resposta de UMA pergunta, por tipo (RF-PES-01): opções válidas, mínimo/máximo de seleções, limites de
 * número e texto, escala mínimo..máximo, data real, foto com referência, código de barras. Mensagens em português
 * com a ação seguinte. Nunca lança: devolve a lista de problemas (vazia = ok).
 */
import type { ItemResposta, Pergunta } from '../contracts';
import { PARAMETROS_PADRAO, type ParametrosPesquisa } from './parametros';
import { ehDataCivil } from './util';

export type CodigoErroResposta =
  | 'VERSAO_INEXISTENTE'
  | 'VERSAO_NAO_PUBLICADA'
  | 'PERGUNTA_DESCONHECIDA'
  | 'PERGUNTA_REPETIDA'
  | 'PERGUNTA_OCULTA'
  | 'OBRIGATORIA'
  | 'SEM_RESPOSTAS'
  | 'TIPO_DIFERENTE'
  | 'OPCAO_INVALIDA'
  | 'OPCAO_REPETIDA'
  | 'SELECOES_FORA_DO_LIMITE'
  | 'VALOR_FORA_DO_LIMITE'
  | 'VALOR_INVALIDO'
  | 'TEXTO_FORA_DO_LIMITE'
  | 'FOTOS_FORA_DO_LIMITE'
  | 'FOTO_REPETIDA'
  | 'FOTO_SEM_REFERENCIA'
  | 'CODIGO_INVALIDO';

export interface ErroResposta {
  codigo: CodigoErroResposta;
  pergunta_id: string | null;
  mensagem: string;
}

const NOME_DO_TIPO: Record<Pergunta['tipo'], string> = {
  sim_nao: 'sim ou não',
  unica: 'única escolha',
  multipla: 'múltipla escolha',
  numero: 'número',
  texto: 'texto',
  escala: 'escala',
  data: 'data',
  foto: 'foto',
  codigo_barras: 'código de barras',
};

/** Item em branco (texto vazio, múltipla sem opção, foto sem arquivo) não conta como resposta (RF-PES-04). */
export function itemRespondido(item: ItemResposta): boolean {
  switch (item.tipo) {
    case 'texto':
      return item.texto.trim().length > 0;
    case 'multipla':
      return item.opcao_ids.length > 0;
    case 'foto':
      return item.fotos.length > 0;
    case 'codigo_barras':
      return item.codigo.trim().length > 0;
    default:
      return true;
  }
}

/** Dígito verificador GS1 (EAN-8, UPC-A, EAN-13, DUN-14): soma ponderada 3-1-3… da direita para a esquerda. */
function gs1Valido(digitos: string): boolean {
  const n = digitos.length;
  let soma = 0;
  for (let i = n - 2, peso = 3; i >= 0; i--, peso = peso === 3 ? 1 : 3) soma += Number(digitos[i]) * peso;
  return (10 - (soma % 10)) % 10 === Number(digitos[n - 1]);
}

/**
 * Premissa T-0012: só dígitos com 8, 12, 13 ou 14 posições são EAN/UPC e precisam do dígito verificador certo;
 * qualquer outro código (ex.: Code 128 interno da loja) vale com 3 a 48 caracteres, sem espaço.
 */
export function codigoDeBarrasValido(codigo: string): boolean {
  if (/^\d+$/.test(codigo) && [8, 12, 13, 14].includes(codigo.length)) return gs1Valido(codigo);
  return /^\S{3,48}$/.test(codigo);
}

/** RF-PES-01: valida o item contra a definição da pergunta (tipo, limites, opções). */
export function validarItem(pergunta: Pergunta, item: ItemResposta, parametros: ParametrosPesquisa = PARAMETROS_PADRAO): ErroResposta[] {
  const erro = (codigo: CodigoErroResposta, mensagem: string): ErroResposta[] => [{ codigo, pergunta_id: pergunta.id, mensagem }];
  const rotulo = `"${pergunta.enunciado}"`;
  if (item.pergunta_id !== pergunta.id) return erro('PERGUNTA_DESCONHECIDA', `A resposta não é desta pergunta (${rotulo}). Abra a pergunta de novo e responda.`);
  if (item.tipo !== pergunta.tipo) return erro('TIPO_DIFERENTE', `A pergunta ${rotulo} é do tipo ${NOME_DO_TIPO[pergunta.tipo]}, mas veio uma resposta do tipo ${NOME_DO_TIPO[item.tipo]}.`);

  switch (pergunta.tipo) {
    case 'sim_nao':
      return typeof (item as { valor: unknown }).valor === 'boolean' ? [] : erro('VALOR_INVALIDO', `Responda ${rotulo} com sim ou não.`);
    case 'unica': {
      const id = (item as Extract<ItemResposta, { tipo: 'unica' }>).opcao_id;
      return pergunta.opcoes.some((o) => o.id === id) ? [] : erro('OPCAO_INVALIDA', `Escolha uma das opções de ${rotulo}.`);
    }
    case 'multipla': {
      const ids = (item as Extract<ItemResposta, { tipo: 'multipla' }>).opcao_ids;
      if (new Set(ids).size !== ids.length) return erro('OPCAO_REPETIDA', `Há opção marcada duas vezes em ${rotulo}. Desmarque a repetida.`);
      if (ids.some((id) => !pergunta.opcoes.some((o) => o.id === id))) return erro('OPCAO_INVALIDA', `Marque só as opções de ${rotulo}.`);
      const min = pergunta.min_selecoes ?? 1;
      const max = pergunta.max_selecoes ?? pergunta.opcoes.length;
      if (ids.length < min || ids.length > max) {
        const faixa = min === max ? `exatamente ${min}` : `de ${min} a ${max}`;
        return erro('SELECOES_FORA_DO_LIMITE', `Em ${rotulo}, marque ${faixa} opção(ões) (agora são ${ids.length}).`);
      }
      return [];
    }
    case 'numero': {
      const v = (item as Extract<ItemResposta, { tipo: 'numero' }>).numero;
      if (!Number.isFinite(v)) return erro('VALOR_INVALIDO', `Digite um número válido em ${rotulo}.`);
      if (pergunta.inteiro && !Number.isInteger(v)) return erro('VALOR_INVALIDO', `Digite um número inteiro em ${rotulo}.`);
      if ((pergunta.minimo !== undefined && v < pergunta.minimo) || (pergunta.maximo !== undefined && v > pergunta.maximo)) {
        return erro('VALOR_FORA_DO_LIMITE', `Em ${rotulo}, digite um valor${intervalo(pergunta.minimo, pergunta.maximo)}.`);
      }
      return [];
    }
    case 'texto': {
      const t = (item as Extract<ItemResposta, { tipo: 'texto' }>).texto.trim();
      const min = pergunta.min_caracteres ?? 0;
      const max = Math.min(pergunta.max_caracteres ?? parametros.texto_max_caracteres, parametros.texto_max_caracteres);
      if (t.length < min || t.length > max) return erro('TEXTO_FORA_DO_LIMITE', `Em ${rotulo}, escreva de ${min} a ${max} caracteres (agora são ${t.length}).`);
      return [];
    }
    case 'escala': {
      const v = (item as Extract<ItemResposta, { tipo: 'escala' }>).valor;
      if (!Number.isInteger(v)) return erro('VALOR_INVALIDO', `Escolha um ponto inteiro da escala em ${rotulo}.`);
      if (v < pergunta.minimo || v > pergunta.maximo) return erro('VALOR_FORA_DO_LIMITE', `Em ${rotulo}, escolha de ${pergunta.minimo} a ${pergunta.maximo}.`);
      return [];
    }
    case 'data': {
      const d = (item as Extract<ItemResposta, { tipo: 'data' }>).data;
      if (!ehDataCivil(d)) return erro('VALOR_INVALIDO', `Informe uma data que exista em ${rotulo}, no formato dia/mês/ano.`);
      if ((pergunta.minima !== undefined && d < pergunta.minima) || (pergunta.maxima !== undefined && d > pergunta.maxima)) {
        return erro('VALOR_FORA_DO_LIMITE', `Em ${rotulo}, digite uma data${intervalo(pergunta.minima, pergunta.maxima)}.`);
      }
      return [];
    }
    case 'foto': {
      const fotos = (item as Extract<ItemResposta, { tipo: 'foto' }>).fotos;
      if (fotos.some((f) => f.referencia.trim().length === 0)) return erro('FOTO_SEM_REFERENCIA', `Uma foto de ${rotulo} não foi salva. Tire a foto de novo.`);
      if (new Set(fotos.map((f) => f.id)).size !== fotos.length) return erro('FOTO_REPETIDA', `A mesma foto aparece duas vezes em ${rotulo}. Remova a repetida.`);
      const max = Math.min(pergunta.max_fotos, parametros.max_fotos_por_pergunta);
      if (fotos.length < pergunta.min_fotos || fotos.length > max) return erro('FOTOS_FORA_DO_LIMITE', `Em ${rotulo}, envie de ${pergunta.min_fotos} a ${max} fotos (agora são ${fotos.length}).`);
      return [];
    }
    case 'codigo_barras': {
      const c = (item as Extract<ItemResposta, { tipo: 'codigo_barras' }>).codigo.trim();
      return codigoDeBarrasValido(c) ? [] : erro('CODIGO_INVALIDO', `O código de ${rotulo} não confere. Leia de novo com a câmera ou digite os números.`);
    }
  }
}

function intervalo(min: string | number | undefined, max: string | number | undefined): string {
  if (min !== undefined && max !== undefined) return ` entre ${min} e ${max}`;
  if (min !== undefined) return ` a partir de ${min}`;
  return ` até ${max}`;
}
