/**
 * Verificação de acesso aplicada em TODA rota de módulo (CLAUDE.md regra 6):
 * autenticação → licença do módulo (RN-CORE-02) → perfil → escopo de carteira (RN-CORE-04).
 * A API responde com o status e o código devolvidos aqui; o shell usa o mesmo resultado para
 * esconder o que não pode ser usado.
 */
import { z } from 'zod';
import type { ModuloId, Perfil } from './nomes';
import type { Cargo } from './cargos';
import type { PerfilDaRequisicaoV2 } from './perfis-por-cargo';
import type { PerfilDaRequisicao } from './permissoes-perfil';

/**
 * Corpo de erro da API v1 (todas as rotas, todos os módulos): 401/403 de acesso e 422 de regra
 * de negócio (`codigo` = id da RN ou código da plataforma, ex.: `MODULO_INATIVO`, `RN-VEN-03`).
 */
export const ErroApiSchema = z.object({
  codigo: z.string().min(1),
  mensagem: z.string(),
  detalhes: z.record(z.unknown()).optional(),
});
export type ErroApi = z.infer<typeof ErroApiSchema>;

/** Corpo HTTP para um acesso negado (a API responde com `status` e este corpo). */
export function corpoDoErro(r: Extract<ResultadoAcesso, { ok: false }>): ErroApi {
  return { codigo: r.codigo, mensagem: r.mensagem };
}

export interface UsuarioAcesso {
  id: string;
  tenant_id: string;
  perfil: Perfil;
  /** Módulos efetivos (ver `modulosEfetivos`). */
  modulos: Iterable<ModuloId>;
  /**
   * ADR 0033 (T-0111/T-0112): os perfis de acesso do usuário já resolvidos (fábrica + o que o tenant mudou + limites travados).
   * Presentes, a lista `perfis` da regra aceita qualquer perfil base deles, e a ação (`verificarAcao`) consulta o motor.
   */
  perfis?: readonly PerfilDaRequisicao[];
  /** ADR 0073 §2.8 (E3): cargo do perfil do usuário ("onde está na hierarquia"). Igual a `perfil_acesso.cargo`. */
  cargo?: Cargo;
  /**
   * ADR 0073 §2.7 (E3): o perfil resolvido sem base (`resolverPerfilPeloCargo`). Só o caminho novo (`verificarAcaoPeloCargo`,
   * `autorizarRotaPeloCargo`) o lê; o motor antigo continua com `perfis` até a troca de leitura (E6).
   */
  perfil_acesso?: PerfilDaRequisicaoV2;
}

export type CodigoAcesso = 'NAO_AUTENTICADO' | 'MODULO_INATIVO' | 'PERFIL_SEM_ACESSO' | 'FORA_DA_CARTEIRA';

export type ResultadoAcesso = { ok: true } | { ok: false; status: 401 | 403; codigo: CodigoAcesso; mensagem: string };

export interface RegraRota {
  modulo: ModuloId;
  /** Perfis aceitos nesta rota (ex.: criar pedido exclui promotor — RN-PRO-01). */
  perfis: readonly Perfil[];
}

/** Só a licença do módulo (RN-CORE-02/01): o módulo está nos módulos efetivos do usuário (401 sem usuário). */
export function verificarLicenca(usuario: UsuarioAcesso | null | undefined, modulo: ModuloId): ResultadoAcesso {
  if (!usuario) return { ok: false, status: 401, codigo: 'NAO_AUTENTICADO', mensagem: 'Faça login para continuar.' };
  if (![...usuario.modulos].includes(modulo)) {
    return { ok: false, status: 403, codigo: 'MODULO_INATIVO', mensagem: `O módulo ${modulo} não está ativo para você.` };
  }
  return { ok: true };
}

export function verificarAcesso(usuario: UsuarioAcesso | null | undefined, regra: RegraRota): ResultadoAcesso {
  const lic = verificarLicenca(usuario, regra.modulo);
  if (!lic.ok || !usuario) return lic;
  if (!regra.perfis.includes(usuario.perfil) && !usuario.perfis?.some((p) => regra.perfis.includes(p.base))) {
    return { ok: false, status: 403, codigo: 'PERFIL_SEM_ACESSO', mensagem: 'Seu perfil não tem acesso a esta ação.' };
  }
  return { ok: true };
}

/**
 * RN-CORE-04: vendedor/promotor → própria carteira; supervisor → carteira da equipe;
 * gerente → equipes abaixo; analista/assistente/admin → tenant inteiro.
 */
export type Escopo = 'carteira' | 'equipe' | 'equipes_abaixo' | 'tenant';

export function escopoDoPerfil(perfil: Perfil): Escopo {
  switch (perfil) {
    case 'vendedor':
    case 'promotor':
      return 'carteira';
    case 'supervisor':
      return 'equipe';
    case 'gerente':
      return 'equipes_abaixo';
    case 'analista':
    case 'assistente':
    case 'admin':
      return 'tenant';
  }
}

/**
 * Confere se o cliente está no escopo. `clientesVisiveis` é a carteira já resolvida para o escopo
 * do usuário (o core calcula a partir de carteira/equipe); `'tenant'` libera tudo.
 */
export function verificarCarteira(clienteId: string, clientesVisiveis: ReadonlySet<string> | 'tenant'): ResultadoAcesso {
  if (clientesVisiveis === 'tenant' || clientesVisiveis.has(clienteId)) return { ok: true };
  return { ok: false, status: 403, codigo: 'FORA_DA_CARTEIRA', mensagem: 'Cliente fora da sua carteira.' };
}
