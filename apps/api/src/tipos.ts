/** Tipos internos compartilhados entre `createApp` e as rotas da plataforma. */
import type { ContextoBase, Manifesto, ModoSuperAdmin, ModuloApi, ModuloId, Permissoes } from '@macuxi/platform-sdk';
import type { FastifyRequest } from 'fastify';
import type { BancoApp } from './banco';
import type { LicencasUsuario } from './licencas';

/** Contexto já checado de uma requisição autenticada. */
export interface RequisicaoPreparada {
  ctx: ContextoBase;
  licencas: LicencasUsuario;
  /** Mesmo usuário e requisição, com outro módulo de origem (logs e eventos publicados). */
  doModulo(modulo: ModuloId): ContextoBase;
}

export interface Plataforma {
  manifestos: readonly Manifesto[];
  modulos: readonly ModuloApi[];
  /** Permissão por ação dos manifestos instalados (ADR 0004). */
  permissoes: Permissoes;
  /**
   * Autentica, calcula os efetivos e devolve o contexto da requisição (lança ErroHttp 401/503). `superAdmin` (só rota de
   * módulo que declarou, ADR 0029): aceita também o token de plataforma, com o tenant do cabeçalho `x-macuxi-tenant`.
   */
  preparar(req: FastifyRequest, modulo: ModuloId | null, superAdmin?: ModoSuperAdmin): Promise<RequisicaoPreparada>;
  relogio: () => Date;
  banco: BancoApp | null;
}
