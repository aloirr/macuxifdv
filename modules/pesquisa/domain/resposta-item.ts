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
  | 'CODIGO_INVALIDO'
  | 'FOTO_GRANDE_DEMAIS';

export interface AvisoResposta {
  codigo: 'CODIGO_GS1_INVALIDO';
  pergunta_id: string;
  mensagem: string;
}

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

/** RN-PES-06: formato aceito = 3 a 48 caracteres, sem espaço (inclui EAN/UPC e códigos internos como Code 128). */
export function codigoDeBarrasValido(codigo: string): boolean {
  return /^\S{3,48}$/.test(codigo);
}

/**
 * RN-PES-06: só dígitos com 8, 12, 13 ou 14 posições são EAN-8, UPC-A, EAN-13 e DUN-14 e têm dígito GS1 para conferir.
 * Dígito errado gera AVISO, não bloqueio (o código digitado/lido vale mesmo assim).
 */
export function gs1Confere(codigo: string): boolean {
  if (/^\d+$/.test(codigo) && [8, 12, 13, 14].includes(codigo.length)) return gs1Valido(codigo);
  return true;
}

/** RN-PES-06: avisos do item que não impedem o envio (hoje, código com dígito GS1 inválido). */
export function avisarItem(pergunta: Pergunta, item: ItemResposta): AvisoResposta[] {
  if (pergunta.tipo !== 'codigo_barras' || item.tipo !== 'codigo_barras') return [];
  const c = item.codigo.trim();
  if (!codigoDeBarrasValido(c) || gs1Confere(c)) return [];
  return [{ codigo: 'CODIGO_GS1_INVALIDO', pergunta_id: pergunta.id, mensagem: `O dígito verificador do código de "${pergunta.enunciado}" não confere. Confira a leitura; se estiver certo, pode seguir.` }];
}

/**
 * RN-PES-06: tamanho final de uma foto = no máximo `max_lado_px` ([1600]) no maior lado, mantendo a proporção. O app
 * redimensiona e grava em JPEG com `foto_jpeg_qualidade` ([80]) antes de enfileirar.
 */
export function dimensoesDaFoto(largura: number, altura: number, max_lado_px: number): { largura: number; altura: number } {
  const maior = Math.max(largura, altura);
  if (maior <= max_lado_px) return { largura, altura };
  const f = max_lado_px / maior;
  return { largura: Math.max(1, Math.round(largura * f)), altura: Math.max(1, Math.round(altura * f)) };
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
      if (fotos.some((f) => Math.max(f.largura_px ?? 0, f.altura_px ?? 0) > parametros.foto_max_lado_px)) return erro('FOTO_GRANDE_DEMAIS', `Uma foto de ${rotulo} passa de ${parametros.foto_max_lado_px} px no maior lado. Tire a foto de novo (o app reduz sozinho).`);
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
