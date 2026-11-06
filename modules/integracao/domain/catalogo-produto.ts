/**
 * T-0084/T-0085: aplicação, referências cruzadas, "oferece junto" e etiquetas do produto vindos do ERP.
 * O que passa dos tetos do Catálogo é CORTADO com aviso no monitor, sem recusar a linha (RN-CAT-11, RN-CAT-09).
 * Campo ausente (undefined) não é tocado: ausente = não altera.
 */
import { LIMITES_CATALOGO_PRODUTO, LIMITES_REFERENCIA, EXTERNAL_ID_MAX, type AvisoLinha, type ProdutoPayload } from '../contracts';

export type AvisoCorte = Omit<AvisoLinha, 'indice'>;

/** Corta por code point (não parte emoji em surrogate) e remove o espaço que sobrou no fim. */
export function cortarPorCodePoint(texto: string, max: number): string {
  const pontos = Array.from(texto);
  return pontos.length <= max ? texto : pontos.slice(0, max).join('').trimEnd();
}

function referenciaValida(x: { marca_external_id?: string | null; marca_nome?: string | null; codigo: string }): boolean {
  const cod = x.codigo.trim();
  const ext = x.marca_external_id?.trim() ?? '';
  const nome = x.marca_nome?.trim() ?? '';
  return cod.length >= 1 && cod.length <= LIMITES_REFERENCIA.codigo && ext.length <= EXTERNAL_ID_MAX && nome.length <= LIMITES_REFERENCIA.marcaNome && (ext !== '' || nome !== '');
}

export function limitarCatalogoDoProduto(registro: ProdutoPayload): { registro: ProdutoPayload; avisos: AvisoCorte[] } {
  const L = LIMITES_CATALOGO_PRODUTO;
  const avisos: AvisoCorte[] = [];
  const r: ProdutoPayload = { ...registro };
  const id = registro.external_id;

  if (typeof r.aplicacao === 'string') {
    const tamanho = Array.from(r.aplicacao).length;
    if (tamanho > L.aplicacao) {
      r.aplicacao = cortarPorCodePoint(r.aplicacao, L.aplicacao);
      avisos.push({ external_id: id, codigo: 'aplicacao_cortada', mensagem: `Aplicação com ${tamanho} caracteres foi cortada em ${L.aplicacao} (RN-CAT-11).` });
    }
  }
  if (r.referencias) {
    const validas = r.referencias.filter((x) => referenciaValida(x));
    const fora = r.referencias.length - validas.length;
    if (fora > 0) {
      r.referencias = validas;
      avisos.push({ external_id: id, codigo: 'referencia_descartada', mensagem: `${fora} referência(s) sem marca ou com código vazio/maior que ${LIMITES_REFERENCIA.codigo} foram descartadas; o produto foi carregado (RN-CAT-09).` });
    }
  }
  if (r.referencias && r.referencias.length > L.referencias) {
    const n = r.referencias.length;
    r.referencias = r.referencias.slice(0, L.referencias);
    avisos.push({ external_id: id, codigo: 'referencias_cortadas', mensagem: `${n} referências recebidas; ficaram as ${L.referencias} primeiras (RN-CAT-09).` });
  }
  if (r.oferece_junto && r.oferece_junto.length > L.ofereceJunto) {
    const n = r.oferece_junto.length;
    r.oferece_junto = r.oferece_junto.slice(0, L.ofereceJunto);
    avisos.push({ external_id: id, codigo: 'oferece_junto_cortado', mensagem: `${n} produtos em "oferece junto"; ficaram os ${L.ofereceJunto} primeiros (RN-CAT-09).` });
  }
  if (r.etiquetas) {
    const limpas = r.etiquetas.map((e) => cortarPorCodePoint(e.trim(), LIMITES_REFERENCIA.etiqueta)).filter((e) => e !== '');
    r.etiquetas = limpas.length > L.etiquetas ? limpas.slice(0, L.etiquetas) : limpas;
  }
  return { registro: r, avisos };
}
