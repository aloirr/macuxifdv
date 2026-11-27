/**
 * Acesso da requisição pelo perfil SEM base (ADR 0073 §2.7 e §2.8, etapa E3): o que a API usa para preencher
 * `ctx.usuario.cargo` e `ctx.usuario.perfil_acesso` e para autorizar a rota sem `RotaModulo.perfis` nem o `perfis` do manifesto.
 *
 * Transição: tudo aqui é puro. No tenant em 'legado' a API decide pelo motor antigo (`verificarAcao`, `perfis`); no tenant em
 * 'concessao' (marca `plataforma.catalogo_aplicado`, `motorDePermissao`; ligada pela 0109, E6) decide por aqui.
 */
import { verificarLicenca, type ResultadoAcesso, type UsuarioAcesso } from './acesso';
import { ErroHttpModulo, promotorBarradoNaRota, type RotaModulo } from './api';
import type { Cargo } from './cargos';
import type { ModuloId, Perfil } from './nomes';
import { CODIGO_PERFIL_SEM_BKO } from './perfis';
import {
  podePeloCargo,
  resolverPerfilPeloCargo,
  type AlvoPorCargo,
  type PerfilDaRequisicaoV2,
  type PerfilPorCargo,
} from './perfis-por-cargo';
import { SEM_ACESSO, verificarAcaoPeloCargo, type ContextoPermissao, type Permissoes } from './permissoes';
import {
  CHAVE_ACESSO,
  combinarPerfis,
  type PerfilDaRequisicao,
  type ValorPermissao,
} from './permissoes-perfil';

/** Campos novos do usuário da requisição (sempre juntos: o cargo é o do perfil). */
export interface CamposPeloCargo {
  cargo?: Cargo;
  perfil_acesso?: PerfilDaRequisicaoV2;
}

/**
 * `ctx.usuario.cargo` e `ctx.usuario.perfil_acesso` a partir do perfil vivo e ativo do usuário (`plataforma.perfil_do_usuario`):
 * aplica as travas do cargo e o teto do escopo (`resolverPerfilPeloCargo`, falha fechada). Sem perfil = nenhum campo (nada
 * permitido no caminho novo). O super-admin recebe o modelo `admin` (`modelosDePerfil(manifestos).admin`, código `admin`).
 */
export function camposPeloCargo(
  perfil: Pick<PerfilPorCargo, 'codigo' | 'cargo' | 'permissoes'> | null | undefined,
): CamposPeloCargo {
  if (!perfil) return {};
  const perfil_acesso = resolverPerfilPeloCargo(perfil);
  return { cargo: perfil_acesso.cargo, perfil_acesso };
}

/** Recusa da rota do BKO a quem o perfil não dá `acesso.bko` (RN-CORE-33). */
export type ResultadoRotaPeloCargo =
  ResultadoAcesso | { ok: false; status: 403; codigo: typeof CODIGO_PERFIL_SEM_BKO; mensagem: string };

/**
 * Autorização da rota de módulo pelo caminho novo (ADR 0073, E3), na ordem da API (`apps/api/src/app.ts`, `montarRota`):
 * 1. licença do módulo da rota (401 sem usuário; 403 MODULO_INATIVO, RN-CORE-02);
 * 2. rota só do BKO (`superficie: 'bko'`): o perfil precisa de `acesso.bko`, já travado pelo cargo (403 PERFIL_SEM_BKO, RN-CORE-33);
 * 3. RN-PRO-01 pelo CARGO promotor: rota de escrita de pedido (`promotorBarradoNaRota`) → 403 PERFIL_SEM_ACESSO;
 * 4. com `acao`: `verificarAcaoPeloCargo` (licença do módulo dono + concessão); sem `acao`: basta a licença do passo 1 (o
 *    "perfil usa o módulo" já está nos módulos efetivos, `perfil_modulo`) e um perfil resolvido (falha fechada).
 * O super-admin em rota `superAdmin` não passa por aqui (a opção da rota é a autorização, ADR 0029 §5).
 */
export function autorizarRotaPeloCargo(
  usuario: UsuarioAcesso | null | undefined,
  permissoes: Permissoes,
  modulo: ModuloId,
  rota: Pick<RotaModulo, 'metodo' | 'caminho' | 'acao' | 'superficie'>,
): ResultadoRotaPeloCargo {
  const lic = verificarLicenca(usuario, modulo);
  if (!lic.ok) return lic;
  const perfil = usuario!.perfil_acesso;
  if (rota.superficie === 'bko' && !podePeloCargo(perfil, CHAVE_ACESSO.bko))
    return {
      ok: false,
      status: 403,
      codigo: CODIGO_PERFIL_SEM_BKO,
      mensagem: 'Seu perfil não tem acesso ao backoffice.',
    };
  if (!perfil || (perfil.cargo === 'promotor' && promotorBarradoNaRota(rota))) return SEM_ACESSO;
  return rota.acao ? verificarAcaoPeloCargo(usuario, permissoes, rota.acao) : { ok: true };
}

/**
 * Recusa com 403 `PERFIL_SEM_ACESSO` se o perfil sem base não dá `chave` (sobre `alvo`, quando a ação recai num usuário) ou se
 * o cargo a veta (RN-PRO-01). Par de `exigirPermissao` para o caminho novo; use no meio do `executar`.
 */
export function exigirPermissaoPeloCargo(
  usuario: { perfil_acesso?: PerfilDaRequisicaoV2 },
  chave: string,
  alvo?: AlvoPorCargo,
): void {
  if (!podePeloCargo(usuario.perfil_acesso, chave, alvo))
    throw new ErroHttpModulo(403, 'PERFIL_SEM_ACESSO', 'Seu perfil não tem acesso a esta ação.');
}

/**
 * RN-PRO-01 fora da rota de módulo (sync: pull, novidades, pacotes e push): no caminho novo vale o CARGO promotor do perfil; sem
 * `perfil_acesso` (motor antigo), o perfil do token.
 */
export function promotorNaRequisicao(usuario: { perfil?: Perfil; perfil_acesso?: PerfilDaRequisicaoV2 }): boolean {
  return usuario.perfil_acesso ? usuario.perfil_acesso.cargo === 'promotor' : usuario.perfil === 'promotor'; // perfil-fixo-ok: motor antigo (tenant em 'legado'; sai na fase 2)
}

/**
 * `ContextoPermissao` de `Permissoes.pode` fora da rota de módulo (sync), sem os `perfis` (o sync decide pela ação do manifesto):
 * com `perfil_acesso` (tenant em 'concessao') decide a concessão; sem ele, o perfil do token.
 */
export function contextoDePermissao(usuario: {
  perfil?: Perfil;
  modulos: Iterable<ModuloId>;
  perfil_acesso?: PerfilDaRequisicaoV2;
}): ContextoPermissao {
  return {
    perfil: usuario.perfil,
    modulosAtivos: usuario.modulos,
    ...(usuario.perfil_acesso ? { perfilAcesso: usuario.perfil_acesso } : {}),
  };
}

/** Uma chave em que os dois motores discordam (`null` = negada naquele motor). */
export interface DiferencaDeMotor {
  chave: string;
  base: ValorPermissao | null;
  cargo: ValorPermissao | null;
}

const normal = (v: ValorPermissao | undefined): string =>
  v ? JSON.stringify({ nivel: v.nivel ?? null, alvos: v.alvos ? [...v.alvos].sort() : null }) : '';

/**
 * Leitura dupla (E4): as chaves em que o motor antigo (`perfis`, fábrica + sobreposições) e o novo (`perfil_acesso`) discordam
 * — concessão, nível ou alvos —, em ordem alfabética. Lista vazia = equivalentes. Só para teste e diagnóstico: não decide nada.
 */
export function diferencasEntreMotores(
  perfis: readonly PerfilDaRequisicao[] | null | undefined,
  perfilAcesso: PerfilDaRequisicaoV2 | null | undefined,
): DiferencaDeMotor[] {
  const antigo = perfis && perfis.length > 0 ? combinarPerfis(perfis) : {};
  const novo = perfilAcesso?.permissoes ?? {};
  return [...new Set([...Object.keys(antigo), ...Object.keys(novo)])]
    .sort()
    .filter((c) => normal(antigo[c]) !== normal(novo[c]))
    .map((chave) => ({ chave, base: antigo[chave] ?? null, cargo: novo[chave] ?? null }));
}
