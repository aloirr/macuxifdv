/**
 * Idempotência por (tenant, entidade, external_id) + hash do conteúdo canônico (RN-INT-02).
 * O hash é SHA-256 (hex, 64 caracteres) do JSON canônico — o formato do CHECK do banco (R-20261101-233652, 🔴; sem colisão
 * prática: colisão seria atualização perdida em silêncio). O domain roda só no servidor; SHA-256 puro em TypeScript (`./sha256`), sem módulos do Node.
 */
import { SCHEMA_REGISTRO, type AvisoLinha, type Entidade, type LinhaErro } from '../contracts';
import { classificarErroZod } from './erros';
import { limitarCatalogoDoProduto } from './catalogo-produto';
import { sha256Hex } from './sha256';

/** JSON com chaves ordenadas; `null`/`undefined` em objeto equivalem a campo ausente; `-0` vira `0`. */
export function jsonCanonico(valor: unknown): string {
  if (valor === null || valor === undefined) return 'null';
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) throw new Error('Número não finito não entra em registro canônico.');
    return JSON.stringify(valor === 0 ? 0 : valor);
  }
  if (typeof valor === 'string' || typeof valor === 'boolean') return JSON.stringify(valor);
  if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(',')}]`;
  if (typeof valor === 'object') {
    const o = valor as Record<string, unknown>;
    const partes = Object.keys(o)
      .filter((k) => o[k] !== null && o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${jsonCanonico(o[k])}`);
    return `{${partes.join(',')}}`;
  }
  throw new Error('Tipo não suportado em registro canônico.');
}

/** Hash SHA-256 (64 hexadecimais minúsculos) do registro: o formato que o CHECK `registro_atual_hash_formato` exige. Por padrão `alterado_em` não conta (só o conteúdo). */
export function hashRegistro(registro: unknown, opcoes: { ignorar?: readonly string[] } = {}): string {
  const ignorar = opcoes.ignorar ?? ['alterado_em'];
  let alvo = registro;
  if (alvo && typeof alvo === 'object' && !Array.isArray(alvo) && ignorar.length > 0) {
    alvo = Object.fromEntries(Object.entries(alvo as Record<string, unknown>).filter(([k]) => !ignorar.includes(k)));
  }
  return sha256Hex(jsonCanonico(alvo));
}

export interface LinhaBruta {
  indice: number;
  /** `null` quando a linha não traz um external_id legível (vira erro na validação). */
  external_id: string | null;
  registro: unknown;
}

function lerExternalId(registro: unknown): string | null {
  if (!registro || typeof registro !== 'object') return null;
  const v = (registro as Record<string, unknown>).external_id;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

/** RN-INT-02: external_id repetido no lote — vale a última ocorrência; as anteriores viram aviso. */
export function deduplicarNoLote(registros: readonly unknown[]): { linhas: LinhaBruta[]; avisos: AvisoLinha[] } {
  const ultimo = new Map<string, number>();
  const lidos = registros.map((r) => lerExternalId(r));
  lidos.forEach((id, i) => {
    if (id !== null) ultimo.set(id, i);
  });
  const linhas: LinhaBruta[] = [];
  const avisos: AvisoLinha[] = [];
  lidos.forEach((id, i) => {
    if (id !== null && ultimo.get(id) !== i) {
      avisos.push({
        indice: i,
        external_id: id,
        codigo: 'duplicado_no_lote',
        mensagem: `external_id repetido no lote: vale a última ocorrência (linha ${(ultimo.get(id) ?? i) + 1}); esta linha foi ignorada.`,
      });
      return;
    }
    linhas.push({ indice: i, external_id: id, registro: registros[i] });
  });
  return { linhas, avisos };
}

export interface LinhaValida<R = unknown> {
  indice: number;
  external_id: string;
  /** `alterado_em` do registro normalizado (ISO UTC); base da guarda de obsolescência (RN-INT-06). */
  alterado_em: string;
  /** Registro normalizado pelo schema (padrões aplicados, textos aparados). */
  registro: R;
  hash: string;
}

/** Deduplica, valida cada linha com o schema da entidade e calcula o hash. Erro de linha não trava o lote (RN-INT-03). */
export function validarLinhas(entidade: Entidade, registros: readonly unknown[]): { validas: LinhaValida[]; erros: LinhaErro[]; avisos: AvisoLinha[] } {
  const { linhas, avisos } = deduplicarNoLote(registros);
  const schema = SCHEMA_REGISTRO[entidade];
  const validas: LinhaValida[] = [];
  const erros: LinhaErro[] = [];
  for (const l of linhas) {
    const r = schema.safeParse(l.registro);
    if (r.success) {
      let dados: unknown = r.data;
      if (entidade === 'produto') {
        // T-0084/T-0085: corte com aviso do que passa dos tetos do Catálogo; o hash e o evento levam o registro já cortado
        const corte = limitarCatalogoDoProduto(r.data as Parameters<typeof limitarCatalogoDoProduto>[0]);
        dados = corte.registro;
        avisos.push(...corte.avisos.map((a) => ({ ...a, indice: l.indice })));
      }
      validas.push({ indice: l.indice, external_id: (r.data as { external_id: string }).external_id, alterado_em: (r.data as { alterado_em: string }).alterado_em, registro: dados, hash: hashRegistro(dados) });
    } else {
      erros.push(...classificarErroZod(r.error, { indice: l.indice, external_id: l.external_id }));
    }
  }
  return { validas, erros, avisos };
}

export interface RegistroExistente {
  hash: string;
  /** `alterado_em` do registro atual (ISO UTC). */
  alterado_em: string;
}

/** Instante em ms; texto ilegível vale -Infinity (nunca "mais novo"). */
function instante(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/**
 * RN-INT-02 + RN-INT-06 (guarda monotônica): contra os registros ativos já gravados, separa nova / atualizada / inalterada / obsoleta.
 * - Sem registro atual: nova.
 * - `alterado_em` MENOR que o do atual: obsoleta (reenvio antigo ou reprocessamento de `lote_linha_erro.payload`). Não troca o
 *   registro, não publica evento e conta no resumo do lote e no monitor. Vale mesmo com hash diferente.
 * - `alterado_em` igual ou maior e hash igual: inalterada (sem gravar nem publicar).
 * - `alterado_em` igual ou maior e hash diferente: atualizada. Empate no relógio com conteúdo diferente: a ÚLTIMA chegada vence
 *   (no banco, `excluded.alterado_em >= registro_atual.alterado_em`).
 * Registro inativado deve ter o hash esquecido, para voltar como nova.
 */
export function classificarMudancas<T extends { external_id: string; hash: string; alterado_em: string }>(
  validas: readonly T[],
  existentes: ReadonlyMap<string, RegistroExistente>,
): { novas: T[]; atualizadas: T[]; inalteradas: T[]; obsoletas: T[] } {
  const novas: T[] = [];
  const atualizadas: T[] = [];
  const inalteradas: T[] = [];
  const obsoletas: T[] = [];
  for (const v of validas) {
    const atual = existentes.get(v.external_id);
    if (atual === undefined) novas.push(v);
    else if (instante(v.alterado_em) < instante(atual.alterado_em)) obsoletas.push(v);
    else if (atual.hash === v.hash) inalteradas.push(v);
    else atualizadas.push(v);
  }
  return { novas, atualizadas, inalteradas, obsoletas };
}
