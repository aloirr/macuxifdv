/**
 * T-0103 (desenho §14): aviso `marca_concorrente_desconhecida` no monitor do lote, a partir de
 * `catalogo.referencia.marca_desconhecida@1`. Aviso, nunca erro: o lote já terminou e a referência foi carregada.
 * Funções puras; a API só grava o resultado em `integracao.lote.avisos`.
 */
import type { AvisoLinha } from '../contracts';

export const LIMITE_AVISOS_POR_LOTE = 200;
const PREFIXO_RESTANTE = 'e mais ';

export interface MarcaDesconhecidaEntrada {
  produto_external_id: string;
  produto_codigo: string | null;
  marcas: string[];
}

export type AvisoDoLote = Omit<AvisoLinha, 'indice'> & { indice?: number };

export function avisoMarcaDesconhecida(e: MarcaDesconhecidaEntrada): AvisoLinha {
  const marcas = e.marcas.map((m) => `"${m}"`).join(', ');
  return {
    indice: 0,
    external_id: e.produto_external_id,
    codigo: 'marca_concorrente_desconhecida',
    mensagem: `Produto ${e.produto_codigo ?? e.produto_external_id}: marca ${marcas} não cadastrada; a referência foi carregada sem marca resolvida. Cadastre a marca em Catálogo > Marcas.`,
  };
}

const ehResto = (a: AvisoLinha) => a.codigo === 'avisos_omitidos';

/** Acrescenta sem repetir (mesmo código, produto e mensagem) e limita a 200 + o aviso "e mais N". */
export function acrescentarAvisosAoLote(atuais: AvisoLinha[], novos: AvisoLinha[]): { avisos: AvisoLinha[]; alterou: boolean } {
  const resto = atuais.find(ehResto);
  const lista = atuais.filter((a) => !ehResto(a));
  let omitidos = resto ? Number(/^e mais (\d+)/.exec(resto.mensagem)?.[1] ?? 0) : 0;
  let alterou = false;
  for (const n of novos) {
    if (lista.some((a) => a.codigo === n.codigo && a.external_id === n.external_id && a.mensagem === n.mensagem)) continue;
    alterou = true;
    if (lista.length >= LIMITE_AVISOS_POR_LOTE) omitidos++;
    else lista.push(n);
  }
  if (omitidos > 0) lista.push({ indice: 0, external_id: '', codigo: 'avisos_omitidos', mensagem: `${PREFIXO_RESTANTE}${omitidos} aviso(s) não mostrados` });
  return { avisos: lista, alterou };
}
