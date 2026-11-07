/**
 * Mapeamento coluna do ERP → campo do contrato canônico (RN-INT-09) e validação local por linha.
 *
 * - `campos` do arquivo de configuração: `campo` (aceita caminho com ponto, ex. `endereco.cidade`) → coluna | {coluna, transformar} | {valor}.
 * - `alterado_em` aceita Date, texto ISO, número (milissegundos desde 1970) ou bigint; é sempre enviado em ISO UTC com milissegundos (RN-INT-05).
 * - Validação com `SCHEMA_REGISTRO[entidade]` do contrato. As mensagens de erro locais NUNCA carregam o valor da linha.
 * - Valores nulos são omitidos (equivale a campo ausente no Hub: não altera o que o Macuxi tem). Opt-in por campo (T-0099):
 *   `{ coluna, nulo: "limpa" }` envia `null` quando a coluna vem NULL, e o Hub limpa o campo. Coluna inexistente na linha continua
 *   omitida (não é um NULL da view).
 */
import { EXTERNAL_ID_MAX, LIMITE_REGISTROS_LOTE, SCHEMA_REGISTRO, type Cursor, type Entidade, type LinhaInvalidaConector } from '@macuxi/integracao/contracts';
import type { ColunaConfig, EntidadeConfig, Transformacao } from './config/esquema';
import type { Linha } from './erp/driver';

export class ErroMapeamento extends Error {}

function paraDataUtc(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') return Number.isFinite(v) ? new Date(v) : null;
  if (typeof v === 'bigint') return new Date(Number(v));
  if (typeof v === 'string') {
    const t = v.trim();
    if (/^\d{10,}$/.test(t)) return new Date(Number(t));
    // sem fuso explícito = UTC (a view do ERP entrega UTC)
    const d = new Date(/(Z|[+-]\d{2}:?\d{2})$/i.test(t) ? t : `${t.replace(' ', 'T')}Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Texto decimal ("19.99", "-0.5", "1234") → centavos inteiros SEM ponto flutuante (aritmética de texto/BigInt). A terceira casa
 * decimal arredonda para cima a partir de 5 (meio centavo sobe, em módulo). `null` se não for decimal simples ou passar do limite seguro.
 */
export function decimalParaCentavos(texto: string): number | null {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(texto.trim());
  if (!m) return null;
  const frac = (m[3] ?? '').padEnd(3, '0');
  let centavos = BigInt(m[2] as string) * 100n + BigInt(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) centavos += 1n;
  const n = Number(m[1] === '-' ? -centavos : centavos);
  return Number.isSafeInteger(n) ? n : null;
}

function paraBooleano(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number' || typeof v === 'bigint') return Number(v) !== 0;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (['1', 's', 'sim', 'y', 'yes', 't', 'true', 'v', 'verdadeiro'].includes(t)) return true;
    if (['0', 'n', 'nao', 'não', 'no', 'f', 'false', 'falso', ''].includes(t)) return false;
  }
  return null;
}

function paraNumero(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim().replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function transformar(v: unknown, t: Transformacao | undefined, campo: string): unknown {
  if (v === null || v === undefined) return undefined;
  switch (t) {
    case undefined:
      if (v instanceof Date) return v.toISOString();
      if (typeof v === 'bigint') return Number(v);
      if (Buffer.isBuffer(v)) return v.toString('utf8');
      return v;
    case 'texto':
      return v instanceof Date ? v.toISOString() : String(v);
    case 'inteiro': {
      const n = paraNumero(v);
      return n === null ? v : Math.trunc(n);
    }
    case 'numero': {
      const n = paraNumero(v);
      return n === null ? v : n;
    }
    case 'centavos_de_decimal': {
      // texto decimal exato (ex.: NUMBER do Oracle, "19.99") converte sem ponto flutuante; número usa o arredondamento comum
      if (typeof v === 'string') {
        const exato = decimalParaCentavos(v);
        if (exato !== null) return exato;
      }
      const n = paraNumero(v);
      return n === null ? v : Math.round(n * 100);
    }
    case 'booleano': {
      const b = paraBooleano(v);
      return b === null ? v : b;
    }
    case 'data_hora_utc': {
      const d = paraDataUtc(v);
      return d ? d.toISOString() : v;
    }
    case 'data_civil': {
      const d = paraDataUtc(v);
      return d ? d.toISOString().slice(0, 10) : v;
    }
    case 'json': {
      if (typeof v !== 'string') return v;
      try {
        return JSON.parse(v);
      } catch {
        throw new ErroMapeamento(`a coluna do campo "${campo}" não contém JSON válido`);
      }
    }
  }
}

function definir(obj: Record<string, unknown>, caminho: string, valor: unknown): void {
  const partes = caminho.split('.');
  let alvo = obj;
  for (const p of partes.slice(0, -1)) {
    const atual = alvo[p];
    if (atual === undefined || atual === null || typeof atual !== 'object') alvo[p] = {};
    alvo = alvo[p] as Record<string, unknown>;
  }
  alvo[partes[partes.length - 1] as string] = valor;
}

function lerColuna(linha: Linha, spec: ColunaConfig, campo: string): unknown {
  if (typeof spec === 'string') return transformar(achar(linha, spec), undefined, campo);
  if ('valor' in spec) return spec.valor;
  const bruto = achar(linha, spec.coluna);
  if (bruto === null && spec.nulo === 'limpa') return null;
  return transformar(bruto, spec.transformar, campo);
}

/** Nome de coluna sem diferenciar maiúsculas (SQL Server e PostgreSQL divergem no caixa dos aliases). */
function achar(linha: Linha, coluna: string): unknown {
  if (coluna in linha) return linha[coluna];
  const alvo = coluna.toLowerCase();
  for (const k of Object.keys(linha)) if (k.toLowerCase() === alvo) return linha[k];
  return undefined;
}

export interface LinhaMapeada {
  /** Posição na leitura (base 0). */
  posicao: number;
  external_id: string | null;
  /** Instante da alteração (ms) — null se ilegível. */
  alterado_ms: number | null;
  registro: Record<string, unknown>;
}

export function mapearLinha(config: EntidadeConfig, linha: Linha, posicao: number): LinhaMapeada {
  const registro: Record<string, unknown> = {};
  for (const [campo, spec] of Object.entries(config.campos)) {
    const v = lerColuna(linha, spec, campo);
    if (v !== undefined) definir(registro, campo, v);
  }
  const id = registro.external_id;
  const externalId = id === undefined || id === null ? null : String(id).trim();
  if (externalId !== null) registro.external_id = externalId;
  const d = paraDataUtc(achar(linha, typeof config.campos.alterado_em === 'string' ? config.campos.alterado_em : 'alterado_em') ?? registro.alterado_em);
  const alteradoMs = d ? d.getTime() : null;
  if (alteradoMs !== null) registro.alterado_em = new Date(alteradoMs).toISOString();
  return { posicao, external_id: externalId === '' ? null : externalId, alterado_ms: alteradoMs, registro };
}

export type CodigoProblema = LinhaInvalidaConector['codigo'];

export interface ProblemaLinha {
  posicao: number;
  external_id: string | null;
  campo: string;
  /** Código do contrato (`LinhaErro`): é o que o BKO mostra ao lado da mensagem. */
  codigo: CodigoProblema;
  /** Texto sem valor de dado. */
  mensagem: string;
}

type IssueZod = { code: string; path: (string | number)[]; message: string; expected?: unknown; received?: unknown };

function codificar(i: IssueZod): CodigoProblema {
  switch (i.code) {
    case 'invalid_type':
      return i.received === 'undefined' || i.received === 'null' ? 'campo_obrigatorio' : 'tipo_invalido';
    case 'invalid_enum_value':
    case 'invalid_literal':
      return 'valor_nao_permitido';
    case 'invalid_string':
      return 'formato_invalido';
    case 'too_small':
    case 'too_big':
      return 'valor_fora_da_faixa';
    case 'custom':
      return 'regra_invalida';
    default:
      return 'registro_invalido';
  }
}

function descrever(i: IssueZod): string {
  switch (i.code) {
    case 'invalid_type':
      return i.received === 'undefined' || i.received === 'null' ? 'campo obrigatório sem valor' : `tipo inválido (esperado ${String(i.expected)})`;
    case 'invalid_enum_value':
    case 'invalid_literal':
      return 'valor não permitido';
    case 'invalid_string':
      return 'formato inválido';
    case 'too_small':
    case 'too_big':
      return 'valor fora da faixa permitida';
    case 'custom':
      return i.message;
    default:
      return 'valor inválido';
  }
}

export interface ResultadoValidacao {
  ok: boolean;
  /** Registro normalizado pelo schema quando ok; senão, o registro mapeado cru. */
  registro: Record<string, unknown>;
  problemas: ProblemaLinha[];
}

export function validarLinha(entidade: Entidade, m: LinhaMapeada): ResultadoValidacao {
  const r = SCHEMA_REGISTRO[entidade].safeParse(m.registro);
  if (r.success) return { ok: true, registro: r.data as Record<string, unknown>, problemas: [] };
  const vistos = new Set<string>();
  const problemas: ProblemaLinha[] = [];
  for (const i of r.error.issues) {
    const campo = i.path.join('.') || '(registro)';
    if (vistos.has(campo)) continue;
    vistos.add(campo);
    problemas.push({ posicao: m.posicao, external_id: m.external_id, campo, codigo: codificar(i as IssueZod), mensagem: descrever(i as IssueZod) });
  }
  return { ok: false, registro: m.registro, problemas };
}

export interface ResultadoMapeamento {
  /** Registros a enviar ao Hub, na ordem de leitura. */
  registros: Record<string, unknown>[];
  /** Maior cursor (ordem do contrato) entre TODAS as linhas lidas com chave e data legíveis: é o `cursor` declarado no lote. */
  cursor: Cursor | null;
  /** Par da última linha legível NA ORDEM DA CONSULTA: de onde a leitura continua (a colação do banco manda na ordem do SQL). */
  ultimo: Cursor | null;
  problemas: ProblemaLinha[];
  /**
   * Linhas recusadas localmente, UMA entrada por linha (campo e código do primeiro problema; a mensagem resume todos), sem valores.
   * Só preenchida com `linhasInvalidas: enviar`; é o que vai em `linhas_invalidas` do lote (o limite por lote é aplicado depois).
   */
  linhasInvalidas: LinhaInvalidaConector[];
  /** Linhas descartadas por falta de external_id/alterado_em (sem eles não há cursor). */
  descartadas: number;
  invalidas: number;
  /** Linhas já lidas antes (par não maior que o cursor de leitura): ignoradas. */
  repetidas: number;
}

/** Melhor esforço para identificar a linha cujo mapeamento falhou (ex.: JSON inválido em outra coluna): só a coluna do external_id. */
function externalIdBruto(config: EntidadeConfig, linha: Linha): string | null {
  try {
    const v = lerColuna(linha, config.campos.external_id as ColunaConfig, 'external_id');
    const t = v === undefined || v === null ? '' : String(v).trim();
    return t === '' ? null : t;
  } catch {
    return null;
  }
}

export interface OpcoesMapeamento {
  /**
   * Força o envio das linhas inválidas ao Hub mesmo com `linhasInvalidas: descartar`. A carga completa SEMPRE envia (T-0027,
   * RN-INT-06): o `external_id` da linha inválida é o que impede o Hub de inativar um registro que continua no ERP.
   */
  enviarInvalidas?: boolean;
}

/**
 * `depoisDe`: linhas cujo par (alterado_em, external_id) não é maior que ele já foram lidas e são ignoradas. Cobre a linha
 * cujo `alterado_em` tem precisão maior que milissegundos: o filtro do SQL a devolveria de novo a cada ciclo.
 */
export function mapearEValidar(entidade: Entidade, config: EntidadeConfig, linhas: Linha[], depoisDe: Cursor | null = null, opcoes: OpcoesMapeamento = {}): ResultadoMapeamento {
  const enviar = opcoes.enviarInvalidas === true || config.linhasInvalidas === 'enviar';
  const registros: Record<string, unknown>[] = [];
  const problemas: ProblemaLinha[] = [];
  const linhasInvalidas: LinhaInvalidaConector[] = [];
  let descartadas = 0;
  let invalidas = 0;
  let repetidas = 0;
  let cursor: Cursor | null = null;
  let ultimo: Cursor | null = null;
  /** Registra os problemas de UMA linha e (se configurado) a entrada única que irá ao Hub. */
  const recusar = (doLote: ProblemaLinha[]) => {
    problemas.push(...doLote);
    if (enviar) linhasInvalidas.push(resumirLinha(doLote));
  };
  for (const [posicao, linha] of linhas.entries()) {
    let m: LinhaMapeada;
    try {
      m = mapearLinha(config, linha, posicao);
    } catch (e) {
      descartadas++;
      const conhecido = e instanceof ErroMapeamento;
      recusar([{ posicao, external_id: externalIdBruto(config, linha), campo: '(linha)', codigo: conhecido ? 'formato_invalido' : 'registro_invalido', mensagem: conhecido ? e.message : 'erro ao converter a linha' }]);
      continue;
    }
    if (m.external_id === null || m.alterado_ms === null) {
      descartadas++;
      recusar([
        {
          posicao,
          external_id: m.external_id,
          campo: m.external_id === null ? 'external_id' : 'alterado_em',
          codigo: 'campo_obrigatorio',
          mensagem: m.external_id === null ? 'external_id ausente: a linha não pode ser enviada' : 'alterado_em ausente ou ilegível: a linha não pode ser enviada',
        },
      ]);
      continue;
    }
    const par: Cursor = { alterado_em: new Date(m.alterado_ms).toISOString(), external_id: m.external_id };
    if (depoisDe && compararCursor(par, depoisDe) <= 0) {
      repetidas++;
      continue;
    }
    if (cursor === null || compararCursor(par, cursor) > 0) cursor = par;
    ultimo = par;
    const v = validarLinha(entidade, m);
    if (v.ok) {
      registros.push(v.registro);
    } else {
      // a linha inválida NÃO vai em `registros`: vai em `linhas_invalidas`, com o motivo e sem o valor (RN-INT-03)
      invalidas++;
      recusar(v.problemas);
    }
  }
  return { registros, cursor, ultimo, problemas, linhasInvalidas, descartadas, invalidas, repetidas };
}

/** Uma linha com vários campos ruins vira UMA entrada: campo e código do primeiro problema, mensagem resumindo todos (sem valores). */
export function resumirLinha(problemas: ProblemaLinha[]): LinhaInvalidaConector {
  const primeiro = problemas[0] as ProblemaLinha;
  const mensagem =
    problemas.length === 1
      ? primeiro.mensagem
      : problemas.map((p) => `${p.campo}: ${p.mensagem}`).join('; ');
  // external_id acima do limite do contrato (200) não viaja: cortar inventaria outra chave e o envelope seria recusado inteiro.
  // Sem id, o Hub não inativa nada na sessão (RN-INT-06), o que é o lado seguro.
  const id = primeiro.external_id !== null && primeiro.external_id.length <= EXTERNAL_ID_MAX ? primeiro.external_id : null;
  return {
    external_id: id,
    codigo: primeiro.codigo,
    campo: primeiro.campo.slice(0, 100),
    mensagem: mensagem.length > 300 ? `${mensagem.slice(0, 297)}...` : mensagem,
  };
}

/** Aplica o limite de linhas inválidas por lote: as primeiras `max` vão com o motivo; o resto só na contagem. */
export function limitarLinhasInvalidas(linhas: LinhaInvalidaConector[], max: number): { enviadas: LinhaInvalidaConector[]; omitidas: number } {
  const teto = Math.min(Math.max(0, max), LIMITE_REGISTROS_LOTE);
  return { enviadas: linhas.slice(0, teto), omitidas: Math.max(0, linhas.length - teto) };
}

/** Mesma ordem do Hub (RN-INT-05): instante, depois `external_id` em ordem ordinal. */
export function compararCursor(a: Cursor, b: Cursor): number {
  const dt = Date.parse(a.alterado_em) - Date.parse(b.alterado_em);
  if (dt !== 0) return dt < 0 ? -1 : 1;
  if (a.external_id === b.external_id) return 0;
  return a.external_id < b.external_id ? -1 : 1;
}
