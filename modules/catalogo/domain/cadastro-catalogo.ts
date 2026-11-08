/**
 * Cadastro do Catálogo por produto (RN-CAT-09, RN-CAT-11; T-0085 §4): referência cruzada (até 3, código até 30), "oferece
 * junto" (até 5), etiquetas (até 4 de até 20) e a Aplicação. Função pura: a API e o BKO usam a mesma validação.
 * `codigosDaConsulta` (n-gramas compactos da consulta) mora em `ranking.ts`, junto de `codigoCompacto`.
 */
import type { SalvarCadastroCatalogo } from '../contracts';
import { codigoCompacto } from './ranking';

export const LIMITES_CADASTRO_CATALOGO = { referencias: 3, codigo: 30, ofereceJunto: 5, etiquetas: 4, etiqueta: 20 } as const;

export interface ErroCadastro {
  regra: 'RN-CAT-09' | 'RN-CAT-11';
  campo: 'aplicacao' | 'referencias' | 'oferece_junto' | 'etiquetas';
  mensagem: string;
}

/** Devolve os erros do cadastro (`[]` = ok). A API revalida com esta mesma função (422 com a regra e o campo). */
export function validarCadastroCatalogo(produtoId: string, c: SalvarCadastroCatalogo, opcoes: { aplicacaoMax: number }): ErroCadastro[] {
  const L = LIMITES_CADASTRO_CATALOGO;
  const erros: ErroCadastro[] = [];
  const erro = (regra: ErroCadastro['regra'], campo: ErroCadastro['campo'], mensagem: string) => erros.push({ regra, campo, mensagem });

  if (c.aplicacao !== null && c.aplicacao.trim().length > opcoes.aplicacaoMax) {
    erro('RN-CAT-11', 'aplicacao', `A aplicação passa de ${opcoes.aplicacaoMax} caracteres. Encurte o texto e salve de novo.`);
  }

  const referencias = c.referencias ?? [];
  if (referencias.length > L.referencias) erro('RN-CAT-09', 'referencias', `Use até ${L.referencias} referências cruzadas por produto. Tire uma e salve de novo.`);
  const vistas = new Set<string>();
  for (const r of referencias) {
    const codigo = r.codigo.trim();
    if (codigo.length > L.codigo) erro('RN-CAT-09', 'referencias', `O código "${codigo.slice(0, 12)}…" passa de ${L.codigo} caracteres. Use o código curto do concorrente.`);
    const compacto = codigoCompacto(codigo);
    if (compacto === '') {
      erro('RN-CAT-09', 'referencias', 'Informe o código do concorrente com letras ou números.');
      continue;
    }
    const chave = `${r.marca_id}:${compacto}`;
    if (vistas.has(chave)) erro('RN-CAT-09', 'referencias', `A referência "${codigo}" está repetida para a mesma marca. Deixe só uma.`);
    vistas.add(chave);
  }

  if (c.oferece_junto.length + (c.oferece_junto_codigos?.length ?? 0) > L.ofereceJunto) erro('RN-CAT-09', 'oferece_junto', `Oferece junto: use até ${L.ofereceJunto} produtos.`);
  if (c.oferece_junto.includes(produtoId)) erro('RN-CAT-09', 'oferece_junto', 'O produto não pode oferecer ele mesmo. Escolha outro.');
  if (new Set(c.oferece_junto).size !== c.oferece_junto.length) erro('RN-CAT-09', 'oferece_junto', 'Há produto repetido em "Oferece junto". Deixe só um de cada.');

  if (c.etiquetas.length > L.etiquetas) erro('RN-CAT-09', 'etiquetas', `Use até ${L.etiquetas} etiquetas, com até ${L.etiqueta} caracteres cada.`);
  if (c.etiquetas.some((e) => e.trim().length > L.etiqueta || e.trim() === '')) erro('RN-CAT-09', 'etiquetas', `Use até ${L.etiquetas} etiquetas, com até ${L.etiqueta} caracteres cada.`);
  return erros;
}
