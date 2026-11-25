/**
 * Perfis de acesso SEM perfil base (ADR 0073, etapa E1): cada perfil é nome + CARGO + o conjunto explícito das permissões
 * concedidas. As travas saem do cargo (RN-CORE-33, RN-PRO-01, RN-CORE-04) e da gestão do acesso (RN-CORE-35, RN-CORE-34), nunca
 * de uma combinação de caixas. Tudo aqui é função pura; o domain do Core e a API chamam as mesmas funções em toda escrita.
 *
 * Transição (ADR 0073 §2.8 e plano do banco §5): este arquivo é ADITIVO. O motor antigo (`permissoes-perfil.ts`: fábrica da base +
 * sobreposições) continua sendo o que a requisição lê até a troca de leitura (E6); os nomes daqui que colidiriam com os antigos
 * levam o sufixo `PeloCargo`/`V2` e trocam de nome quando o antigo sair.
 *
 * - CATÁLOGO: `catalogoDePermissoes(manifestos)` + `CATALOGO_PERMISSOES_VERSAO`, travado por teste de instantâneo
 *   (`apps/api/test/catalogo-permissoes.test.ts`, com os manifestos instalados).
 * - MODELOS (`modelosDePerfil`): os 7 conjuntos de hoje, cada um com o cargo; só para criar (provisionamento, "copiar de um
 *   modelo") e para migrar (`plataforma.modelo_permissao`). Nunca lidos na requisição.
 */
import { z } from 'zod';
import { CARGO_DA_BASE, CargoSchema, type Cargo } from './cargos';
import type { Manifesto } from './manifesto';
import { ACAO_RE, ehAcaoDeEscritaDePedido, PERFIS, type ModuloId, type Perfil } from './nomes';
import {
  ALVO_TODOS,
  CHAVE_ACESSO,
  CHAVES_GESTAO_DO_ACESSO,
  CHAVES_PLATAFORMA,
  CODIGO_PERFIL_RE,
  matrizDeFabrica,
  NIVEIS_ESCOPO,
  perfilDeFabrica,
  PermissoesDoPerfilSchema,
  posicaoDoNivel,
  REGRA_LIMITES_PERFIL,
  resolverPerfil,
  violacaoLimite as violacao,
  type DefinicaoChave,
  type NivelEscopo,
  type NivelPermissao,
  type PermissoesDoPerfil,
  type TravaDaChave,
  type ValorPermissao,
  type ViolacaoLimite,
} from './permissoes-perfil';

// ---------------------------------------------------------------- catálogo

/**
 * Versão do catálogo de permissões (ADR 0073 §2.2): sobe a cada chave nova, renomeada ou retirada (plataforma ou manifesto).
 * É a `versao` de `plataforma.modelo_permissao` e de `plataforma.catalogo_aplicado`. O teste de instantâneo dos manifestos
 * instalados falha se a lista de chaves mudar sem esta versão subir.
 */
export const CATALOGO_PERMISSOES_VERSAO = 2;

/** Permissão concedida a um perfil (chave ausente = negada). Mesma forma de `ValorPermissao`. */
export type Concessao = ValorPermissao;

// ---------------------------------------------------------------- modelos (os 7 perfis padrão)

/** Nome de um modelo de perfil = um dos 7 perfis padrão (também o `codigo` com que o perfil padrão nasce no tenant). */
export const MODELOS_PERFIL = PERFIS;
export type ModeloPerfil = Perfil;

/** Um modelo: o cargo com que o perfil padrão nasce e as permissões concedidas (chave → `{ nivel?, alvos? }`). */
export interface ModeloDePerfil {
  cargo: Cargo;
  permissoes: PermissoesDoPerfil;
}

/** Os 7 modelos, por nome (`vendedor` … `admin`). Formato estável: o banco gera `plataforma.modelo_permissao` a partir dele. */
export type ModelosDePerfil = Readonly<Record<ModeloPerfil, ModeloDePerfil>>;

/**
 * Os 7 modelos a partir dos manifestos instalados: o que o perfil padrão concede HOJE (fábrica da base com as travas da base,
 * igual a `resolverPerfil(perfilDeFabrica(base))`) e o cargo dele (`CARGO_DA_BASE`). Só para criar e migrar (ADR 0073 §2.3).
 */
export function modelosDePerfil(manifestos: readonly Manifesto[]): ModelosDePerfil {
  const matriz = matrizDeFabrica(manifestos);
  return Object.fromEntries(
    MODELOS_PERFIL.map((m) => [
      m,
      { cargo: CARGO_DA_BASE[m], permissoes: resolverPerfil(perfilDeFabrica(m), matriz).permissoes },
    ]),
  ) as unknown as ModelosDePerfil;
}

/** Uma linha de `plataforma.modelo_permissao` (sem as colunas comuns). `nivel`/`alvos` nulos quando a chave não os tem. */
export interface LinhaModeloPermissao {
  versao: number;
  modelo: ModeloPerfil;
  cargo: Cargo;
  chave: string;
  nivel: NivelPermissao | null;
  alvos: readonly string[] | null;
}

/** Os modelos em linhas, na ordem de `MODELOS_PERFIL` e depois da chave: a fonte do script que gera a migração. */
export function linhasDosModelos(
  modelos: ModelosDePerfil,
  versao: number = CATALOGO_PERMISSOES_VERSAO,
): LinhaModeloPermissao[] {
  return MODELOS_PERFIL.flatMap((modelo) => {
    const { cargo, permissoes } = modelos[modelo];
    return Object.keys(permissoes)
      .sort()
      .map((chave) => ({
        versao,
        modelo,
        cargo,
        chave,
        nivel: permissoes[chave]!.nivel ?? null,
        alvos: permissoes[chave]!.alvos ?? null,
      }));
  });
}

// ---------------------------------------------------------------- perfis do tenant

/** Perfil de acesso do tenant sem base (ADR 0073 §2.1): o que está marcado é o que vale. */
export interface PerfilPorCargo {
  /** UUID gerado no cliente; ausente nas validações que não precisam dele. */
  id?: string;
  codigo: string;
  nome?: string;
  cargo: Cargo;
  ativo: boolean;
  permissoes: Readonly<Record<string, Concessao>>;
}

/** Perfil resolvido para a requisição (sem base): `ctx.usuario.perfil_acesso` a partir da E6. */
export interface PerfilDaRequisicaoV2 {
  codigo: string;
  cargo: Cargo;
  permissoes: PermissoesDoPerfil;
}

/** Zod de `PerfilDaRequisicaoV2` (campo aditivo `perfil_acesso` de `GET /v1/me/modulos`, ADR 0073 §4.2). */
export const PerfilDaRequisicaoV2Schema = z
  .object({
    codigo: z.string().regex(CODIGO_PERFIL_RE),
    cargo: CargoSchema,
    permissoes: PermissoesDoPerfilSchema,
  })
  .strict();

// ---------------------------------------------------------------- travas pelo cargo

/** Teto do escopo de dados por cargo (RN-CORE-04, ADR 0073 §2.4). */
const TETO_ESCOPO_DO_CARGO: Readonly<Record<Cargo, NivelEscopo>> = {
  vendedor: 'carteira',
  promotor: 'carteira',
  supervisor: 'equipe',
  gerente: 'equipes_abaixo',
  administrativo: 'tenant',
};

export const tetoDeEscopoDoCargo = (cargo: Cargo): NivelEscopo => TETO_ESCOPO_DO_CARGO[cargo];

/** Cargos que nunca entram no BKO nem no portal (RN-CORE-33). */
const CARGOS_SEM_BKO: readonly Cargo[] = ['vendedor', 'promotor', 'supervisor'];
/** Cargos que entram no app Campo e no Gestão (ADR 0073 §2.5.3); o administrativo não entra nos apps. */
const CARGOS_DO_CAMPO: readonly Cargo[] = ['vendedor', 'promotor'];
const CARGOS_DO_GESTAO: readonly Cargo[] = ['supervisor', 'gerente'];

/**
 * Gestão do acesso completa (ADR 0073 §2.0 item 4): `acesso.bko` + `perfil.gerir` + `usuario.criar` + `usuario.editar` +
 * `usuario.desativar`. É o "admin" do sempre-um-admin (RN-CORE-35) e a condição do portal (RN-CORE-33).
 */
export function temGestaoDoAcesso(permissoes: Readonly<Record<string, unknown>>): boolean {
  return (
    Object.hasOwn(permissoes, CHAVE_ACESSO.bko) &&
    CHAVES_GESTAO_DO_ACESSO.every((c) => Object.hasOwn(permissoes, c))
  );
}

/** Quem tem `perfil.gerir` nunca tem a senha redefinida pelo BKO (RN-CORE-34, ADR 0073 §2.5.7). */
export const protegidoDaSenha = (permissoes: Readonly<Record<string, unknown>>): boolean =>
  Object.hasOwn(permissoes, 'perfil.gerir');

/**
 * RN-PRO-01 pelo CARGO (ADR 0073 §2.5): o cargo promotor nunca executa ação de escrita de pedido, qualquer que seja a tabela de
 * permissões (concessão gravada por engano, perfil montado à mão, manifesto que escape da validação). Leitura (`pedido.ver`) é
 * a concessão do perfil.
 */
export function vetadaPeloCargo(acao: string, cargo: Cargo | null | undefined): boolean {
  return cargo === 'promotor' && ehAcaoDeEscritaDePedido(acao);
}

/**
 * Trava de uma chave num perfil deste cargo (o cadeado da tabela, com a regra). `null` = a caixa é livre.
 * `gestaoDoAcesso` = o perfil tem a gestão do acesso completa (`temGestaoDoAcesso`): sem ela, o portal fica travado.
 * Não trava o nível (`dados.escopo` acima do teto é conferido por `validarPerfilPeloCargo`).
 */
export function travaDaChavePeloCargo(
  cargo: Cargo,
  chave: string,
  ctx: { gestaoDoAcesso: boolean },
): TravaDaChave | null {
  if (vetadaPeloCargo(chave, cargo)) {
    return {
      regra: 'RN-PRO-01',
      mensagem: 'Perfil de promotor nunca cria, edita, cancela, exclui ou aprova pedido.',
    };
  }
  if ((chave === CHAVE_ACESSO.bko || chave === CHAVE_ACESSO.portal) && CARGOS_SEM_BKO.includes(cargo)) {
    return { regra: 'RN-CORE-33', mensagem: 'Este cargo nunca entra no BKO nem no portal.' };
  }
  if (chave === CHAVE_ACESSO.portal && (cargo !== 'administrativo' || !ctx.gestaoDoAcesso)) {
    return {
      regra: 'RN-CORE-33',
      mensagem: 'O portal é só do cargo Administrativo com a gestão de perfis e de usuários.',
    };
  }
  if (chave === CHAVE_ACESSO.campo && !CARGOS_DO_CAMPO.includes(cargo)) {
    return { regra: 'RN-CORE-33', mensagem: 'O app Macuxi Campo é só dos cargos Vendedor e Promotor.' };
  }
  if (chave === CHAVE_ACESSO.gestao && !CARGOS_DO_GESTAO.includes(cargo)) {
    return { regra: 'RN-CORE-33', mensagem: 'O app Macuxi Gestão é só dos cargos Supervisor e Gerente.' };
  }
  return null;
}

/**
 * Leitura com falha fechada (ADR 0073 §2.5 e §2.7): tira as chaves travadas pelo cargo e corta `dados.escopo` no teto do cargo
 * (nível ausente ou fora da família = `carteira`). Concessão inválida no banco não vale. Só a troca de leitura (E6) a liga.
 */
export function resolverPerfilPeloCargo(
  perfil: Pick<PerfilPorCargo, 'codigo' | 'cargo' | 'permissoes'>,
): PerfilDaRequisicaoV2 {
  const p: Record<string, ValorPermissao> = {};
  for (const [chave, v] of Object.entries(perfil.permissoes))
    p[chave] = { ...(v.nivel ? { nivel: v.nivel } : {}), ...(v.alvos ? { alvos: [...v.alvos] } : {}) };
  const gestaoDoAcesso = temGestaoDoAcesso(p);
  for (const chave of Object.keys(p))
    if (travaDaChavePeloCargo(perfil.cargo, chave, { gestaoDoAcesso })) delete p[chave];
  const escopo = p['dados.escopo'];
  if (escopo) {
    const teto = tetoDeEscopoDoCargo(perfil.cargo);
    const pos = escopo.nivel ? posicaoDoNivel(escopo.nivel) : null;
    if (!pos || pos.familia !== 'escopo') p['dados.escopo'] = { nivel: 'carteira' };
    else if (pos.i > NIVEIS_ESCOPO.indexOf(teto)) p['dados.escopo'] = { nivel: teto };
  }
  return { codigo: perfil.codigo, cargo: perfil.cargo, permissoes: p };
}

// ---------------------------------------------------------------- consulta com alvo

/** Sobre quem a ação recai: se é o próprio usuário e o perfil dele (código e se ele tem `perfil.gerir`). */
export interface AlvoPorCargo {
  proprio: boolean;
  perfil: { codigo: string; gerePerfis: boolean } | null;
}

/**
 * O perfil resolvido pode `chave`? Sem perfil ou chave vetada pelo cargo (RN-PRO-01) = não (falha fechada). Com `alvo`: chave `nuncaNoProprio` recusa o próprio; chave
 * com alvos (`senha.redefinir`) cobre o perfil do alvo só se ele não tem `perfil.gerir` (RN-CORE-34) e está na lista (ou `*`).
 * A licença do módulo não é conferida aqui (vem antes, em `verificarAcao`).
 */
export function podePeloCargo(
  perfil: PerfilDaRequisicaoV2 | null | undefined,
  chave: string,
  alvo?: AlvoPorCargo,
): boolean {
  if (!perfil || vetadaPeloCargo(chave, perfil.cargo)) return false;
  const v = perfil.permissoes[chave];
  if (!v) return false;
  if (!alvo) return true;
  const def = Object.hasOwn(CHAVES_PLATAFORMA, chave)
    ? (CHAVES_PLATAFORMA[chave as keyof typeof CHAVES_PLATAFORMA] as Partial<DefinicaoChave>)
    : undefined;
  if (alvo.proprio && def?.nuncaNoProprio) return false;
  if (v.alvos)
    return (
      !!alvo.perfil &&
      !alvo.perfil.gerePerfis &&
      (v.alvos.includes(ALVO_TODOS) || v.alvos.includes(alvo.perfil.codigo))
    );
  return true;
}

// ---------------------------------------------------------------- nome de compatibilidade

/**
 * Valor de compatibilidade de `core.usuario.perfil`, do `perfil` do token e de `perfis[].base` (ADR 0073 §2.8), enquanto o código
 * ainda compara o nome fixo: cargo vendedor, promotor, supervisor ou gerente → o mesmo nome; administrativo → `admin` com a gestão
 * do acesso completa, senão `analista` com `carteira.editar` ou `pedido.aprovar`, senão `assistente`.
 * @deprecated só para a transição; sai com `core.usuario.perfil` (fase 2).
 */
export function perfilDeCompatibilidade(cargo: Cargo, permissoes: Readonly<Record<string, unknown>>): Perfil {
  if (cargo !== 'administrativo') return cargo;
  if (temGestaoDoAcesso(permissoes)) return 'admin';
  if (Object.hasOwn(permissoes, 'carteira.editar') || Object.hasOwn(permissoes, 'pedido.aprovar'))
    return 'analista';
  return 'assistente';
}

// ---------------------------------------------------------------- validação (escrita)

/** O que a validação de um perfil sabe dos outros perfis do tenant (alvos de senha): código → cargo e se tem `perfil.gerir`. */
export type PerfisDoTenantPorCargo = ReadonlyMap<string, { cargo: Cargo; gerePerfis: boolean }>;

export interface OpcoesValidarPerfil {
  /** Catálogo dos manifestos instalados; ausente = só as chaves da plataforma são conhecidas pelo formato. */
  catalogo?: readonly DefinicaoChave[];
  /** Módulos licenciados no tenant (RN-CORE-02). Ausente = não confere a licença. O Core é sempre licenciado. */
  licencas?: ReadonlySet<ModuloId>;
  /** Permissões gravadas antes: a chave de módulo sem licença que JÁ estava ligada fica guardada (ADR 0073 §2.5.8). */
  antes?: Readonly<Record<string, Concessao>>;
}

/**
 * Concessões que o perfil não pode gravar (ADR 0073 §2.5; a API responde 422 com a RN): código inválido; chave fora do catálogo;
 * valor fora do formato da chave; trava pelo cargo (RN-PRO-01, RN-CORE-33); escopo acima do teto do cargo (RN-CORE-04); alvo de
 * senha inexistente ou com a gestão de perfis (RN-CORE-34); perfil ativo sem nenhum lugar de acesso; chave de módulo sem licença
 * ligada agora (RN-CORE-02). Lista vazia = pode gravar.
 */
export function validarPerfilPeloCargo(
  perfil: PerfilPorCargo,
  perfisDoTenant: PerfisDoTenantPorCargo,
  opcoes: OpcoesValidarPerfil = {},
): ViolacaoLimite[] {
  const erros: ViolacaoLimite[] = [];
  const P = { perfil: perfil.codigo };
  if (!CODIGO_PERFIL_RE.test(perfil.codigo))
    erros.push(violacao('CODIGO_INVALIDO', REGRA_LIMITES_PERFIL, 'Código de perfil inválido.', P));
  const defs = new Map<string, Partial<DefinicaoChave>>(
    Object.entries(CHAVES_PLATAFORMA).map(([c, d]) => [c, { ...d, modulo: 'core' as const }]),
  );
  for (const d of opcoes.catalogo ?? []) defs.set(d.chave, d);
  const gestaoDoAcesso = temGestaoDoAcesso(perfil.permissoes);
  for (const [chave, v] of Object.entries(perfil.permissoes)) {
    const C = { ...P, chave };
    // sem catálogo, a chave de módulo bem formada passa pelo formato (e pelas travas); com catálogo, precisa estar nele
    const def = defs.get(chave) ?? (!opcoes.catalogo && ACAO_RE.test(chave) ? {} : undefined);
    if (!def) {
      erros.push(
        violacao('CHAVE_DESCONHECIDA', REGRA_LIMITES_PERFIL, `Permissão desconhecida: ${chave}.`, C),
      );
      continue;
    }
    const trava = travaDaChavePeloCargo(perfil.cargo, chave, { gestaoDoAcesso });
    if (trava) {
      erros.push(violacao('TRAVA_DO_PERFIL', trava.regra, trava.mensagem, C));
      continue;
    }
    const modulo = def.modulo ?? 'core';
    if (
      opcoes.licencas &&
      modulo !== 'core' &&
      !opcoes.licencas.has(modulo) &&
      !(opcoes.antes && Object.hasOwn(opcoes.antes, chave))
    ) {
      erros.push(
        violacao(
          'PERMISSAO_SEM_LICENCA',
          'RN-CORE-02',
          'Esta permissão é de um módulo que a empresa não contratou.',
          C,
        ),
      );
    }
    if (def.nivel) {
      const pos = v.nivel != null ? posicaoDoNivel(v.nivel) : null;
      if (!pos || pos.familia !== def.nivel)
        erros.push(violacao('VALOR_INVALIDO', REGRA_LIMITES_PERFIL, `Escolha o nível de ${chave}.`, C));
      else if (chave === 'dados.escopo' && pos.i > NIVEIS_ESCOPO.indexOf(tetoDeEscopoDoCargo(perfil.cargo))) {
        erros.push(
          violacao('ESCOPO_ACIMA_DO_CARGO', 'RN-CORE-04', 'O escopo de dados passa o limite do cargo.', C),
        );
      }
    } else if (v.nivel != null)
      erros.push(violacao('VALOR_INVALIDO', REGRA_LIMITES_PERFIL, `Nível não se aplica a ${chave}.`, C));
    if (def.alvos) {
      if (!v.alvos || v.alvos.length === 0) {
        erros.push(violacao('VALOR_INVALIDO', REGRA_LIMITES_PERFIL, `Escolha os perfis de ${chave}.`, C));
        continue;
      }
      for (const a of v.alvos) {
        if (a === ALVO_TODOS) continue;
        const alvo = perfisDoTenant.get(a);
        if (!alvo)
          erros.push(
            violacao('SENHA_ALVO_INVALIDO', REGRA_LIMITES_PERFIL, `Perfil-alvo inexistente: ${a}.`, C),
          );
        else if (alvo.gerePerfis)
          erros.push(
            violacao(
              'SENHA_ALVO_INVALIDO',
              'RN-CORE-34',
              'A senha de quem gerencia perfis não é redefinida por aqui.',
              C,
            ),
          );
      }
    } else if (v.alvos != null)
      erros.push(
        violacao('VALOR_INVALIDO', REGRA_LIMITES_PERFIL, `Perfis-alvo não se aplicam a ${chave}.`, C),
      );
  }
  if (
    perfil.ativo &&
    !Object.values(CHAVE_ACESSO).some(
      (c) =>
        Object.hasOwn(perfil.permissoes, c) && !travaDaChavePeloCargo(perfil.cargo, c, { gestaoDoAcesso }),
    )
  ) {
    erros.push(
      violacao(
        'PERFIL_SEM_ACESSO_ALGUM',
        REGRA_LIMITES_PERFIL,
        'Marque pelo menos um lugar onde o perfil entra.',
        P,
      ),
    );
  }
  return erros;
}

/** Usuário do tenant visto pela validação (sem dado pessoal): exatamente um perfil (RN-CORE-54). */
export interface UsuarioPorCargo {
  id: string;
  ativo: boolean;
  /** Código do perfil; `null` = sem perfil. */
  perfil: string | null;
}

export interface EstadoAcessoPorCargo {
  perfis: readonly PerfilPorCargo[];
  usuarios: readonly UsuarioPorCargo[];
}

export interface EntradaValidacaoPorCargo {
  /** Estado gravado antes (ausente = criação do zero, ex.: semeadura). */
  antes?: EstadoAcessoPorCargo;
  depois: EstadoAcessoPorCargo;
  /** Quem altera. Ausente = sistema (migração, provisionamento): sem a regra da autogestão. */
  atorId?: string;
  catalogo?: readonly DefinicaoChave[];
  licencas?: ReadonlySet<ModuloId>;
}

/** Usuário ativo cujo perfil ativo, já com as travas, tem a gestão do acesso completa (o "admin" do RN-CORE-35). */
function ehAdminComGestao(u: UsuarioPorCargo, porCodigo: ReadonlyMap<string, PerfilPorCargo>): boolean {
  const p = u.ativo && u.perfil ? porCodigo.get(u.perfil) : undefined;
  return !!p && p.ativo && temGestaoDoAcesso(resolverPerfilPeloCargo(p).permissoes);
}

/**
 * Limites do tenant inteiro para TODA escrita em perfis e no perfil do usuário (ADR 0073 §2.5; RN-CORE-35): cada perfil
 * (`validarPerfilPeloCargo`); códigos únicos; perfil com usuários não é apagado nem desativado (`PERFIL_EM_USO`) e não muda de
 * cargo (`CARGO_EM_USO`); todo usuário com exatamente um perfil vivo e ativo (RN-CORE-54); ao menos um usuário ativo com a gestão
 * do acesso (`ULTIMO_ADMIN`); o ator que a tinha não a tira de si (`AUTOGESTAO`). Lista vazia = pode gravar.
 */
export function validarAcessoPeloCargo(e: EntradaValidacaoPorCargo): ViolacaoLimite[] {
  const erros: ViolacaoLimite[] = [];
  const porCodigo = new Map<string, PerfilPorCargo>();
  for (const p of e.depois.perfis) {
    if (porCodigo.has(p.codigo))
      erros.push(
        violacao('CODIGO_REPETIDO', REGRA_LIMITES_PERFIL, `Já existe um perfil com o código ${p.codigo}.`, {
          perfil: p.codigo,
        }),
      );
    porCodigo.set(p.codigo, p);
  }
  const antesPorCodigo = new Map((e.antes?.perfis ?? []).map((p) => [p.codigo, p] as const));
  const alvos: PerfisDoTenantPorCargo = new Map(
    [...porCodigo].map(
      ([c, p]) => [c, { cargo: p.cargo, gerePerfis: protegidoDaSenha(p.permissoes) }] as const,
    ),
  );
  for (const p of e.depois.perfis) {
    erros.push(
      ...validarPerfilPeloCargo(p, alvos, {
        catalogo: e.catalogo,
        licencas: e.licencas,
        antes: antesPorCodigo.get(p.codigo)?.permissoes,
      }),
    );
  }
  const emUso = new Set(e.depois.usuarios.map((u) => u.perfil).filter((c): c is string => !!c));
  const emUsoReportado = new Set<string>();
  for (const a of e.antes?.perfis ?? []) {
    if (!emUso.has(a.codigo)) continue;
    const d = porCodigo.get(a.codigo);
    if (!d || !d.ativo) {
      erros.push(
        violacao(
          'PERFIL_EM_USO',
          REGRA_LIMITES_PERFIL,
          'Perfil com usuários não pode ser apagado nem desativado.',
          { perfil: a.codigo },
        ),
      );
      emUsoReportado.add(a.codigo);
    } else if (d.cargo !== a.cargo) {
      erros.push(
        violacao('CARGO_EM_USO', REGRA_LIMITES_PERFIL, 'O cargo de um perfil com usuários não muda.', {
          perfil: a.codigo,
        }),
      );
    }
  }
  for (const u of e.depois.usuarios) {
    if (!u.perfil)
      erros.push(
        violacao('USUARIO_SEM_PERFIL', 'RN-CORE-54', 'Todo usuário precisa de um perfil.', {
          usuario_id: u.id,
        }),
      );
    else if (!porCodigo.get(u.perfil)?.ativo && !emUsoReportado.has(u.perfil)) {
      erros.push(
        violacao('PERFIL_INDISPONIVEL', 'RN-CORE-54', 'Perfil inexistente ou desativado no usuário.', {
          usuario_id: u.id,
          perfil: u.perfil,
        }),
      );
    }
  }
  if (!e.depois.usuarios.some((u) => ehAdminComGestao(u, porCodigo))) {
    erros.push(
      violacao(
        'ULTIMO_ADMIN',
        REGRA_LIMITES_PERFIL,
        'A empresa ficaria sem nenhum usuário ativo com a gestão de usuários e perfis.',
      ),
    );
  }
  if (e.atorId && e.antes) {
    const atorAntes = e.antes.usuarios.find((u) => u.id === e.atorId);
    const atorDepois = e.depois.usuarios.find((u) => u.id === e.atorId);
    if (
      atorAntes &&
      ehAdminComGestao(atorAntes, antesPorCodigo) &&
      !(atorDepois && ehAdminComGestao(atorDepois, porCodigo))
    ) {
      erros.push(
        violacao(
          'AUTOGESTAO',
          REGRA_LIMITES_PERFIL,
          'Você não pode tirar de si mesmo a gestão de usuários e perfis. Peça a outra pessoa com essa gestão.',
          { usuario_id: e.atorId },
        ),
      );
    }
  }
  return erros;
}
