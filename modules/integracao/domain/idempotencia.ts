/**
 * Idempotência por (tenant, entidade, external_id) + hash do conteúdo canônico (RN-INT-02).
 * O hash é FNV-1a de 2 x 32 bits sobre o JSON canônico: puro, determinístico e sem `node:crypto`
 * (roda igual no servidor, no Conector e no app). Serve para detectar mudança, não para segurança.
 */
import { SCHEMA_REGISTRO, type AvisoLinha, type Entidade, type LinhaErro } from '../contracts';
import { classificarErroZod } from './erros';

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

function fnv1a(texto: string, semente: number): number {
  let h = semente >>> 0;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const hex8 = (n: number) => n.toString(16).padStart(8, '0');

/** Hash de 16 hexadecimais do registro. Por padrão `alterado_em` não conta (só o conteúdo). */
export function hashRegistro(registro: unknown, opcoes: { ignorar?: readonly string[] } = {}): string {
  const ignorar = opcoes.ignorar ?? ['alterado_em'];
  let alvo = registro;
  if (alvo && typeof alvo === 'object' && !Array.isArray(alvo) && ignorar.length > 0) {
    alvo = Object.fromEntries(Object.entries(alvo as Record<string, unknown>).filter(([k]) => !ignorar.includes(k)));
  }
  const json = jsonCanonico(alvo);
  return hex8(fnv1a(json, 0x811c9dc5)) + hex8(fnv1a(json, 0x9747b28c));
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
      validas.push({ indice: l.indice, external_id: (r.data as { external_id: string }).external_id, registro: r.data, hash: hashRegistro(r.data) });
    } else {
      erros.push(...classificarErroZod(r.error, { indice: l.indice, external_id: l.external_id }));
    }
  }
  return { validas, erros, avisos };
}

/**
 * RN-INT-02: contra os hashes já gravados (só de registros ativos), separa nova / atualizada / inalterada.
 * Inalterada não grava nem publica evento. Registro inativado deve ter o hash esquecido, para voltar como nova.
 */
export function classificarMudancas<T extends { external_id: string; hash: string }>(
  validas: readonly T[],
  hashesExistentes: ReadonlyMap<string, string>,
): { novas: T[]; atualizadas: T[]; inalteradas: T[] } {
  const novas: T[] = [];
  const atualizadas: T[] = [];
  const inalteradas: T[] = [];
  for (const v of validas) {
    const atual = hashesExistentes.get(v.external_id);
    if (atual === undefined) novas.push(v);
    else if (atual === v.hash) inalteradas.push(v);
    else atualizadas.push(v);
  }
  return { novas, atualizadas, inalteradas };
}
