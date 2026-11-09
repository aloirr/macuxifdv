/**
 * Validação dos cadastros de trade editados no BKO (RF-PRO-11; T-0069). Funções puras: devolvem a lista de problemas
 * em português (vazia = válido). Rodam na tela (feedback imediato) e na API (que sempre revalida).
 * Unidades: meta de share em PERCENTUAL (40 = 40%, coluna `meta_share.meta_pct numeric(5,2)`); preço em centavos inteiros.
 */

export type Problemas = string[];

const VAZIO = (t: string | null | undefined) => !t || t.trim().length === 0;

function nomeValido(nome: string, rotulo: string, max: number): Problemas {
  if (VAZIO(nome)) return [`Informe o nome ${rotulo}.`];
  if (nome.trim().length > max) return [`O nome ${rotulo} pode ter no máximo ${max} caracteres.`];
  return [];
}

/** RN-PRO-03: meta de share entre 0 e 100% (inclusive), com até 2 casas (o banco guarda numeric(5,2)). */
export function validarMetaShare(pct: number): Problemas {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return ['Informe a meta de share como um número, entre 0 e 100.'];
  if (pct < 0 || pct > 100) return ['A meta de share deve ficar entre 0 e 100%.'];
  if (Math.round(pct * 100) / 100 !== pct) return ['A meta de share aceita no máximo 2 casas decimais.'];
  return [];
}

export interface EtapaChecklistEntrada {
  id: string;
  rotulo: string;
  obrigatoria: boolean;
}

/** RN-PRO-06: o checklist precisa de pelo menos 1 etapa; cada etapa tem nome e id único (a obrigatoriedade é livre). */
export function validarChecklist(c: { nome: string; itens: readonly EtapaChecklistEntrada[] }): Problemas {
  const p = nomeValido(c.nome, 'do checklist', 120);
  if (c.itens.length === 0) {
    p.push('O checklist precisa de ao menos uma etapa.');
    return p;
  }
  if (c.itens.some((i) => VAZIO(i.rotulo))) p.push('Toda etapa precisa de um nome.');
  else if (c.itens.some((i) => i.rotulo.trim().length > 200)) p.push('O nome da etapa pode ter no máximo 200 caracteres.');
  if (new Set(c.itens.map((i) => i.id)).size !== c.itens.length) p.push('Há etapas com o mesmo identificador (repetidas). Recarregue a tela e tente de novo.');
  return p;
}

export function validarCategoria(c: { nome: string; ordem: number }): Problemas {
  const p = nomeValido(c.nome, 'da categoria', 120);
  if (!Number.isInteger(c.ordem) || c.ordem < 0) p.push('A ordem da categoria deve ser um número inteiro, de 0 em diante.');
  return p;
}

export function validarProdutoConcorrente(c: { nome: string }): Problemas {
  return nomeValido(c.nome, 'do produto do concorrente', 200);
}

/** RN-PRO-04: dinheiro em centavos, inteiro e nunca negativo. */
export function validarPrecoCents(cents: number): Problemas {
  if (!Number.isInteger(cents)) return ['Informe o preço em centavos, em número inteiro.'];
  if (cents < 0) return ['O preço não pode ser negativo.'];
  return [];
}

/** RN-PRO-10: o cadastro vale para uma loja OU um segmento OU todas as lojas (nunca loja e segmento juntos). */
export function validarAlvo(a: { cliente_id: string | null; segmento: string | null }): Problemas {
  if (a.cliente_id && a.segmento !== null) return ['Escolha uma loja ou um segmento, não os dois. Para valer para todas as lojas, deixe os dois em branco.'];
  if (a.segmento !== null && VAZIO(a.segmento)) return ['Informe o segmento ou deixe em branco para valer para todas as lojas.'];
  return [];
}

/** RN-PRO-10: vigência por data civil; o fim, se houver, não pode ser anterior ao início. */
export function validarVigencia(inicio: string, fim: string | null): Problemas {
  if (fim !== null && fim < inicio) return ['O fim da vigência não pode ser anterior ao início.'];
  return [];
}

/** Dependentes vivos (`deleted_at` nulo) de um cadastro, contados no mesmo tenant. */
export interface UsosCadastro {
  metas_share: number;
  mix_obrigatorio: number;
  produtos_concorrente: number;
}

export type ResultadoDesativacao = { ok: true } | { ok: false; codigo: 'CADASTRO_EM_USO'; mensagem: string; usos: UsosCadastro };

const plural = (n: number, art: 'a' | 'o', um: string, varios: string) => (n === 1 ? `${art} 1 ${um}` : `${art}s ${n} ${varios}`);

/**
 * RN-PRO-12 (regra do módulo, regras.md §16): cadastro em uso não se desativa. Categoria de gôndola com meta de share,
 * mix obrigatório ou produto de concorrente vivos só desativam depois
 * que os dependentes forem desativados (a marca concorrente é do Catálogo e sua inativação não é barrada aqui, ADR 0034; o Promotor reage na leitura). Senão sobrariam órfãos vivos e a lápide iria ao aparelho sem eles).
 */
export function validarDesativacao(tipo: string, usos: UsosCadastro): ResultadoDesativacao {
  const partes: string[] = [];
  let alvo = '';
  if (tipo === 'categoria_gondola') {
    if (usos.metas_share > 0) partes.push(plural(usos.metas_share, 'a', 'meta de share', 'metas de share'));
    if (usos.mix_obrigatorio > 0) partes.push(plural(usos.mix_obrigatorio, 'o', 'item do mix', 'itens do mix'));
    if (usos.produtos_concorrente > 0) partes.push(plural(usos.produtos_concorrente, 'o', 'produto de concorrente', 'produtos de concorrentes'));
    alvo = 'desta categoria';
  }
  if (partes.length === 0) return { ok: true };
  const lista = partes.length === 1 ? partes[0]! : `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;
  return { ok: false, codigo: 'CADASTRO_EM_USO', mensagem: `Desative antes ${lista} ${alvo}.`, usos };
}
