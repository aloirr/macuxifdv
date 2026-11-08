/**
 * Consultas entre módulos (ADR 0012; desenho T-0029 §3.5 e §11 E1): leitura SÍNCRONA, com contrato versionado, de um
 * módulo a outro — sem ler o schema do outro (regra 1) e sem importar o `domain` dele.
 *
 * - O DONO declara o contrato no próprio `contracts`: `definirConsulta({ nome: 'catalogo.precos_cliente@1', entrada, saida })`,
 *   lista em `ofereceConsultas` do manifesto e implementa na API (`ModuloApi.consultas` com `implementarConsulta`) e, se
 *   valer offline, no aparelho (`ModuloShell.consultas` com `implementarConsultaAparelho`, lendo só as próprias entidades
 *   e as dos módulos de `depende` do dono, só leitura; T-0084).
 * - O CONSUMIDOR lista em `usaConsultas` (dono em `depende` ou `opcionais`) ou, sem aresta de dependência (evita ciclo,
 *   ADR 0019), em `usaConsultasOpcionais`, e chama `tx.consultar(def, entrada)` dentro do
 *   próprio `comTenant` (mesma transação, tenant e RLS) ou, no aparelho, `ambiente.consultar(def, entrada)`.
 * - Entrada e saída passam pelo Zod nos dois lados. Dono inativo para o usuário (ou não instalado, se opcional) →
 *   `ConsultaIndisponivel` (503 se ninguém tratar; RN-CORE-03). Consulta é leitura: sem efeito colateral e sem evento.
 * - Logs da consulta levam `modulo` (dono), `consulta` e `request_id`, NUNCA a entrada nem a saída.
 */
import type { z } from 'zod';
import { ErroHttpModulo } from './api';
import type { AmbienteAparelho, AmbienteModulo, UsuarioAmbiente } from './ambiente';
import type { ConsultaTexto, DesfechoBusca } from './busca-tipos';
import type { DefinicaoConsulta } from './consultas-tipos';
import { consultasDeclaradas, type Manifesto } from './manifesto';
import { lerNomeConsulta, type ModuloId } from './nomes';
import type { ValorCampoLinha } from './motor-sync';

export type { DefinicaoConsulta } from './consultas-tipos';

/**
 * Declara o contrato. Nome fora do padrão = erro no import do `contracts`. Limite as listas da entrada no schema (ex.: ≤ 500 ids).
 * `configuracaoDoTenant: true` (ADR 0025 §4.1): a resposta é configuração do tenant, igual para qualquer usuário; libera
 * `{ licenca: 'tenant' }` também em rota de escrita (executada só leitura). Só o dono declara, e a revisão final confere.
 */
export function definirConsulta<E extends z.ZodTypeAny, S extends z.ZodTypeAny>(d: {
  nome: string;
  entrada: E;
  saida: S;
  configuracaoDoTenant?: boolean;
}): DefinicaoConsulta<E, S> {
  const n = lerNomeConsulta(d.nome);
  if (!n) throw new Error(`Nome de consulta inválido: ${d.nome} (use <modulo>.<consulta>@vN)`);
  if (d.configuracaoDoTenant !== undefined && typeof d.configuracaoDoTenant !== 'boolean')
    throw new Error(`Consulta ${d.nome}: configuracaoDoTenant precisa ser booleano (ADR 0025 §4.1)`);
  return Object.freeze({
    nome: d.nome,
    modulo: n.modulo as ModuloId,
    versao: n.versao,
    entrada: d.entrada,
    saida: d.saida,
    ...(d.configuracaoDoTenant ? { configuracaoDoTenant: true as const } : {}),
  });
}

export const CODIGO_CONSULTA_INDISPONIVEL = 'CONSULTA_INDISPONIVEL';

/**
 * O dono da consulta não está ativo para o usuário (licença, RN-CORE-02/03), não está instalado (opcional) ou não
 * implementa a consulta neste canal (ex.: `core.cadastro_resumo@1` só existe na API). O consumidor trata; sem tratamento,
 * a API responde 503 (o motor do app tenta de novo depois).
 */
export class ConsultaIndisponivel extends ErroHttpModulo {
  override readonly status = 503 as const;
  constructor(
    readonly consulta: string,
    readonly modulo: ModuloId,
    mensagem = 'Uma informação de outro módulo não está disponível agora. Tente de novo em instantes.',
  ) {
    super(503, CODIGO_CONSULTA_INDISPONIVEL, mensagem, { consulta, modulo });
    this.name = 'ConsultaIndisponivel';
  }
}

export function ehConsultaIndisponivel(e: unknown): e is ConsultaIndisponivel {
  return e instanceof ConsultaIndisponivel || (e instanceof Error && e.name === 'ConsultaIndisponivel');
}

function resumoZod(e: z.ZodError): string {
  return e.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`)
    .join('; ');
}

/**
 * Executa a implementação validando a entrada (erro do CONSUMIDOR) e a saída (erro do DONO). As duas falhas são erro de
 * programação (500 na API), com a mensagem dizendo de quem é — sem os valores (podem ter dado pessoal).
 */
export async function executarConsulta<E extends z.ZodTypeAny, S extends z.ZodTypeAny>(
  def: DefinicaoConsulta<E, S>,
  entrada: z.input<E>,
  impl: (entrada: z.output<E>) => Promise<unknown>,
): Promise<z.output<S>> {
  const e = def.entrada.safeParse(entrada);
  if (!e.success) throw new Error(`Consulta ${def.nome}: entrada inválida (erro de quem consulta) — ${resumoZod(e.error)}`);
  const bruta = await impl(e.data);
  const s = def.saida.safeParse(bruta);
  if (!s.success) throw new Error(`Consulta ${def.nome}: saída inválida (erro do módulo ${def.modulo}) — ${resumoZod(s.error)}`);
  return s.data;
}

// ---------- aparelho ----------

/**
 * O que a implementação da consulta no aparelho recebe: leitura das entidades locais (linhas do pull) do próprio módulo
 * e dos módulos em `depende` do dono (T-0084: `catalogo.busca_produtos@1` lê o `produto` do Core), o relógio, o usuário
 * logado e os parâmetros do próprio módulo (última sessão; valem offline). Só leitura; nada de fila nem de sobreposição.
 *
 * - Entidade de módulo fora de {dono} ∪ `depende` (inclusive `opcionais` e donos de `usaConsultasOpcionais`) ou sem dono
 *   registrado no shell = erro de programação (`Error`): para ler outro módulo opcional, use a consulta dele.
 * - Módulo de `depende` inativo para o usuário (não deveria acontecer: a licença ativa as dependências junto, RN-CORE-03)
 *   = `ConsultaIndisponivel`.
 */
export interface ContextoConsultaAparelho {
  linhas<L extends { id: string } = { id: string; updated_at: string }>(entidade: string): Promise<L[]>;
  linhasPorIds<L extends { id: string } = { id: string; updated_at: string }>(entidade: string, ids: readonly string[]): Promise<L[]>;
  /**
   * Linhas com `<campo>` de primeiro nível igual a um dos `valores` (igual a `motor.linhasPorCampo`, ADR 0003 T-0052-B4):
   * comparação estrita de tipo, repetidos/`null`/NaN ignorados, sem ordem garantida, campo fora de `[a-z][a-z0-9_]*` = erro.
   */
  linhasPorCampo<L extends { id: string } = { id: string; updated_at: string }>(
    entidade: string,
    campo: string,
    valores: readonly ValorCampoLinha[],
  ): Promise<L[]>;
  /**
   * Versão opaca das linhas locais da entidade (igual a `motor.versaoLinhas`): compare só com `===`; única no processo
   * (troca de usuário, limpeza ou nova geração = outro número), então serve de chave de memória GLOBAL do módulo.
   * Leia ANTES das linhas e guarde o derivado com ela.
   */
  versaoLinhas(entidade: string): number;
  /**
   * Busca textual nos índices do PRÓPRIO módulo (`definirModuloShell({ indicesBusca })`; T-0084): a mesma do
   * `motor.buscarComDesfecho` que a aba usa (FTS5 no SQLite, `bm25` com os pesos do índice, `MATCH ?` por parâmetro,
   * até `consulta.limite` resultados, padrão 200 e teto 500 de `LIMITES_CONSULTA`), para a pré-seleção de candidatos
   * antes do ranking do domain. `buscou: false` (sem SQLite, consulta vazia, índice inválido, erro do FTS) = não
   * conclua "nenhum produto": varra como a aba. Índice de outro módulo (inclusive de `depende`) = erro de programação.
   */
  buscarComDesfecho(indice: string, consulta: ConsultaTexto): Promise<DesfechoBusca>;
  agora(): Date;
  usuario(): UsuarioAmbiente | null;
  parametros(): Readonly<Record<string, unknown>>;
}

export interface ImplementacaoConsultaAparelho<E extends z.ZodTypeAny = z.ZodTypeAny, S extends z.ZodTypeAny = z.ZodTypeAny> {
  consulta: DefinicaoConsulta<E, S>;
  executar(entrada: z.output<E>, ctx: ContextoConsultaAparelho): Promise<z.input<S>>;
}

/** Implementação no aparelho (`definirModuloShell({ consultas: [...] })` do dono). */
export function implementarConsultaAparelho<E extends z.ZodTypeAny, S extends z.ZodTypeAny>(
  consulta: DefinicaoConsulta<E, S>,
  executar: (entrada: z.output<E>, ctx: ContextoConsultaAparelho) => Promise<z.input<S>>,
): ImplementacaoConsultaAparelho {
  return { consulta, executar } as unknown as ImplementacaoConsultaAparelho;
}

/** Fontes que o motor do aparelho entrega ao registro para executar uma consulta. */
export interface FontesConsultaAparelho {
  modulosAtivos(): readonly ModuloId[];
  /** Dono da entidade de sync (registro do shell), para restringir a leitura ao próprio módulo. */
  donoDaEntidade(entidade: string): ModuloId | undefined;
  linhas<L extends { id: string }>(entidade: string): Promise<L[]>;
  linhasPorIds<L extends { id: string }>(entidade: string, ids: readonly string[]): Promise<L[]>;
  linhasPorCampo<L extends { id: string }>(entidade: string, campo: string, valores: readonly ValorCampoLinha[]): Promise<L[]>;
  versaoLinhas(entidade: string): number;
  /** Busca do motor (`motor.buscarComDesfecho`). Ausente = `{ buscou: false, motivo: 'sem_busca' }`. */
  buscarComDesfecho?(indice: string, consulta: ConsultaTexto): Promise<DesfechoBusca>;
  agora(): Date;
  usuario(): UsuarioAmbiente | null;
  parametros(modulo: ModuloId): Readonly<Record<string, unknown>>;
}

export interface RegistroConsultasAparelho {
  /** Nomes com implementação no aparelho. */
  readonly nomes: readonly string[];
  consultar<E extends z.ZodTypeAny, S extends z.ZodTypeAny>(
    def: DefinicaoConsulta<E, S>,
    entrada: z.input<E>,
    fontes: FontesConsultaAparelho,
  ): Promise<z.output<S>>;
}

/**
 * Registro das consultas do aparelho (usado por `criarShell`). Problemas de montagem vão para `problemas`:
 * implementação fora de `ofereceConsultas` do módulo, de consulta de outro dono ou repetida.
 */
export function criarRegistroConsultasAparelho(
  modulos: readonly { manifesto: Manifesto; consultas?: readonly ImplementacaoConsultaAparelho[] }[],
): { registro: RegistroConsultasAparelho; problemas: string[] } {
  const problemas: string[] = [];
  const impls = new Map<string, ImplementacaoConsultaAparelho>();
  const usadas = new Set(modulos.flatMap((m) => consultasDeclaradas(m.manifesto)));
  /** Dono da consulta → módulos cujas entidades a implementação lê: ele e os de `depende` (nunca os `opcionais`). */
  const legiveis = new Map<ModuloId, readonly ModuloId[]>(modulos.map((m) => [m.manifesto.id, [m.manifesto.id, ...m.manifesto.depende]]));
  for (const m of modulos) {
    const id = m.manifesto.id;
    for (const i of m.consultas ?? []) {
      const nome = i.consulta.nome;
      if (i.consulta.modulo !== id) problemas.push(`${id}: implementa a consulta ${nome}, que é de ${i.consulta.modulo}`);
      else if (!m.manifesto.ofereceConsultas.includes(nome)) problemas.push(`${id}: consulta ${nome} não está em ofereceConsultas do manifesto`);
      if (impls.has(nome)) problemas.push(`consulta ${nome} implementada duas vezes`);
      impls.set(nome, i);
    }
  }
  const registro: RegistroConsultasAparelho = {
    nomes: [...impls.keys()],
    async consultar(def, entrada, f) {
      if (!usadas.has(def.nome)) throw new Error(`Consulta ${def.nome}: nenhum módulo instalado a declara em usaConsultas/usaConsultasOpcionais`);
      const impl = impls.get(def.nome);
      if (!impl || !f.modulosAtivos().includes(def.modulo)) throw new ConsultaIndisponivel(def.nome, def.modulo);
      const dono = def.modulo;
      const permitidos = legiveis.get(dono) ?? [dono];
      /** Só leitura das entidades do dono e dos módulos de `depende` dele que estejam efetivos para o usuário. */
      const legivel = (entidade: string) => {
        const de = f.donoDaEntidade(entidade);
        if (!de || !permitidos.includes(de))
          throw new Error(`Consulta ${def.nome}: só lê entidades de ${permitidos.join(', ')} (pediu ${entidade}${de ? `, de ${de}` : ''})`);
        if (de !== dono && !f.modulosAtivos().includes(de)) throw new ConsultaIndisponivel(def.nome, dono);
      };
      const ctx: ContextoConsultaAparelho = {
        linhas: async <L extends { id: string }>(entidade: string) => {
          legivel(entidade);
          return f.linhas<L>(entidade);
        },
        linhasPorIds: async <L extends { id: string }>(entidade: string, ids: readonly string[]) => {
          legivel(entidade);
          return f.linhasPorIds<L>(entidade, ids);
        },
        linhasPorCampo: async <L extends { id: string }>(entidade: string, campo: string, valores: readonly ValorCampoLinha[]) => {
          legivel(entidade);
          return f.linhasPorCampo<L>(entidade, campo, valores);
        },
        versaoLinhas: (entidade: string) => {
          legivel(entidade);
          return f.versaoLinhas(entidade);
        },
        buscarComDesfecho: async (indice: string, consulta: ConsultaTexto): Promise<DesfechoBusca> => {
          // ids de índice são `<modulo>.<nome>` (definirIndiceBusca): só os do dono da consulta
          if (!indice.startsWith(`${dono}.`)) throw new Error(`Consulta ${def.nome}: só busca nos índices de ${dono} (pediu ${indice})`);
          return f.buscarComDesfecho ? f.buscarComDesfecho(indice, consulta) : { buscou: false, motivo: 'sem_busca' };
        },
        agora: () => f.agora(),
        usuario: () => f.usuario(),
        parametros: () => f.parametros(dono),
      };
      return executarConsulta(def, entrada, (e) => impl.executar(e, ctx));
    },
  };
  return { registro, problemas };
}

const SEM_PARAMETROS: Readonly<Record<string, unknown>> = Object.freeze({});

/**
 * Completa o ambiente do shell (`AmbienteAparelho` → `AmbienteModulo`): `extra` (o do motor) vale sobre o do shell; sem
 * nenhum dos dois, `consultar` lança `ConsultaIndisponivel` e `parametros` devolve `{}` (ex.: BKO, que lê tudo pela API).
 */
export function completarAmbiente(base: AmbienteAparelho, extra: Partial<Pick<AmbienteModulo, 'consultar' | 'parametros'>> = {}): AmbienteModulo {
  return {
    ...base,
    consultar:
      extra.consultar ??
      base.consultar ??
      (async (def) => {
        throw new ConsultaIndisponivel(def.nome, def.modulo);
      }),
    parametros: extra.parametros ?? base.parametros ?? (() => SEM_PARAMETROS),
  };
}
