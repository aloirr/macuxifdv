/**
 * Ordem de dependência da carga e verificação de referências (RN-INT-04):
 * vendedor → cliente → (rota, título, nota); produto → (preço, estoque).
 */
import type { AvisoLinha, Entidade, LinhaErro } from '../contracts';
import { erroReferenciaAusente } from './erros';

/** Dependências diretas: a entidade da chave só carrega depois das listadas. */
export const DEPENDENCIAS: Readonly<Record<Entidade, readonly Entidade[]>> = {
  vendedor: [],
  catalogo_no: [],
  transportadora: [],
  // produto -> nó do catálogo é referência FRACA (aviso), mas o nó vai antes para o produto já entrar ligado
  produto: ['catalogo_no'],
  produto_unidade: ['produto'],
  // T-0089: forma antes de prazo; produto antes da faixa; cliente depois das formas (referência por código, sem recusar a linha)
  forma_pagamento: [],
  prazo_pagamento: ['forma_pagamento'],
  tabela_escalonada: ['produto', 'preco'],
  cliente: ['vendedor', 'forma_pagamento'],
  cliente_endereco: ['cliente'],
  rota: ['vendedor', 'cliente'],
  titulo: ['cliente'],
  nota: ['cliente', 'vendedor'],
  preco: ['produto'],
  estoque: ['produto'],
};

export type ResultadoOrdem<E extends string> = { ok: true; ordem: E[] } | { ok: false; ciclo: E[] };

/**
 * Ordenação topológica estável (DFS na ordem pedida). Só considera dependências presentes na seleção:
 * as ausentes já foram carregadas antes. Em ciclo, devolve o caminho (`a → b → a`).
 */
export function ordenarCarga<E extends string>(
  entidades: readonly E[],
  dependencias: Readonly<Record<E, readonly E[]>> = DEPENDENCIAS as unknown as Readonly<Record<E, readonly E[]>>,
): ResultadoOrdem<E> {
  const selecionadas = new Set(entidades);
  const estado = new Map<E, 'visitando' | 'feito'>();
  const ordem: E[] = [];
  let ciclo: E[] | null = null;

  const visitar = (e: E, trilha: E[]): void => {
    if (ciclo) return;
    const st = estado.get(e);
    if (st === 'feito') return;
    if (st === 'visitando') {
      ciclo = [...trilha.slice(trilha.indexOf(e)), e];
      return;
    }
    estado.set(e, 'visitando');
    for (const d of dependencias[e] ?? []) if (selecionadas.has(d)) visitar(d, [...trilha, e]);
    if (ciclo) return;
    estado.set(e, 'feito');
    ordem.push(e);
  };

  for (const e of entidades) visitar(e, []);
  return ciclo ? { ok: false, ciclo } : { ok: true, ordem };
}

export interface ReferenciaRegistro {
  entidade: Entidade;
  campo: string;
  external_id: string;
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

function ref(entidade: Entidade, campo: string, registro: Record<string, unknown>): ReferenciaRegistro[] {
  const id = texto(registro[campo]);
  return id ? [{ entidade, campo, external_id: id }] : [];
}

/** Referências a outras entidades que o registro (já validado) carrega. */
export function referenciasDoRegistro(entidade: Entidade, registro: unknown): ReferenciaRegistro[] {
  const r = (registro && typeof registro === 'object' ? registro : {}) as Record<string, unknown>;
  switch (entidade) {
    case 'cliente':
      return ref('vendedor', 'vendedor_external_id', r);
    case 'titulo':
      return ref('cliente', 'cliente_external_id', r);
    case 'nota':
      return [...ref('cliente', 'cliente_external_id', r), ...ref('vendedor', 'vendedor_external_id', r)];
    case 'prazo_pagamento':
      return ref('forma_pagamento', 'forma_external_id', r);
    case 'preco':
    case 'estoque':
    case 'tabela_escalonada':
    case 'produto_unidade':
      return ref('produto', 'produto_external_id', r);
    case 'cliente_endereco':
      return ref('cliente', 'cliente_external_id', r);
    case 'rota': {
      const paradas = Array.isArray(r.paradas) ? r.paradas : [];
      const doVendedor = ref('vendedor', 'vendedor_external_id', r);
      const dasParadas = paradas.flatMap((p, i) => {
        const id = texto((p as Record<string, unknown> | null)?.cliente_external_id);
        return id ? [{ entidade: 'cliente' as const, campo: `paradas[${i}].cliente_external_id`, external_id: id }] : [];
      });
      return [...doVendedor, ...dasParadas];
    }
    default:
      return [];
  }
}

/**
 * Referências FRACAS: o alvo ausente não recusa a linha; vira o aviso `referencia_fraca_ausente` e a linha entra sem o vínculo
 * (desenho T-0061 §4.4: produto -> nó do catálogo, que o Catálogo ordena depois).
 */
export function referenciasFracasDoRegistro(entidade: Entidade, registro: unknown): ReferenciaRegistro[] {
  const r = (registro && typeof registro === 'object' ? registro : {}) as Record<string, unknown>;
  return entidade === 'produto' ? ref('catalogo_no', 'catalogo_no_external_id', r) : [];
}

export function avisosReferenciaFraca<L extends LinhaComReferencias>(
  entidade: Entidade,
  linhas: readonly L[],
  existentes: Partial<Record<Entidade, ReadonlySet<string>>>,
): AvisoLinha[] {
  const avisos: AvisoLinha[] = [];
  for (const l of linhas) {
    for (const a of referenciasFracasDoRegistro(entidade, l.registro)) {
      if (existentes[a.entidade]?.has(a.external_id)) continue;
      avisos.push({
        indice: l.indice,
        external_id: l.external_id,
        codigo: 'referencia_fraca_ausente',
        mensagem: `O campo "${a.campo}" aponta para um nó do catálogo que ainda não foi carregado. A linha foi aplicada sem o vínculo; envie a árvore do catálogo (catalogo_no) para ligar o produto.`,
      });
    }
  }
  return avisos;
}

export interface LinhaComReferencias {
  indice: number;
  external_id: string;
  registro: unknown;
}

/**
 * Separa as linhas cujas referências existem das que citam external_id inexistente (erro
 * `referencia_ausente`, reprocessável). Sem conjunto informado para a entidade alvo, tudo é ausente:
 * nunca se assume que existe, para não criar registro órfão.
 */
export function verificarReferencias<L extends LinhaComReferencias>(
  entidade: Entidade,
  linhas: readonly L[],
  existentes: Partial<Record<Entidade, ReadonlySet<string>>>,
): { aceitas: L[]; erros: LinhaErro[] } {
  const aceitas: L[] = [];
  const erros: LinhaErro[] = [];
  for (const l of linhas) {
    const ausentes = referenciasDoRegistro(entidade, l.registro).filter((r) => !existentes[r.entidade]?.has(r.external_id));
    if (ausentes.length === 0) aceitas.push(l);
    else for (const a of ausentes) erros.push(erroReferenciaAusente(l.indice, l.external_id, a.campo, a.entidade));
  }
  return { aceitas, erros };
}
