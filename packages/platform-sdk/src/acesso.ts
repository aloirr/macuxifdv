/**
 * Verificação de acesso aplicada em TODA rota de módulo (CLAUDE.md regra 6):
 * autenticação → licença do módulo (RN-CORE-02) → perfil → escopo de carteira (RN-CORE-04).
 * A API responde com o status e o código devolvidos aqui; o shell usa o mesmo resultado para
 * esconder o que não pode ser usado.
 */
import { z } from 'zod';
import type { ModuloId, Perfil } from './nomes';
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
}

export type CodigoAcesso = 'NAO_AUTENTICADO' | 'MODULO_INATIVO' | 'PERFIL_SEM_ACESSO' | 'FORA_DA_CARTEIRA';

export type ResultadoAcesso = { ok: true } | { ok: false; status: 401 | 403; codigo: CodigoAcesso; mensagem: string };

export interface RegraRota {
  modulo: ModuloId;
  /** Perfis aceitos nesta rota (ex.: criar pedido exclui promotor — RN-PRO-01). */
  perfis: readonly Perfil[];
}

export function verificarAcesso(usuario: UsuarioAcesso | null | undefined, regra: RegraRota): ResultadoAcesso {
  if (!usuario) return { ok: false, status: 401, codigo: 'NAO_AUTENTICADO', mensagem: 'Faça login para continuar.' };
  if (![...usuario.modulos].includes(regra.modulo)) {
    return { ok: false, status: 403, codigo: 'MODULO_INATIVO', mensagem: `O módulo ${regra.modulo} não está ativo para você.` };
  }
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
