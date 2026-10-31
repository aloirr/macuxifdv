/** Tipos internos compartilhados entre `createApp` e as rotas da plataforma. */
import type { ContextoBase, Manifesto, ModuloApi, ModuloId } from '@macuxi/platform-sdk';
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
  /** Autentica, calcula os efetivos e devolve o contexto da requisição (lança ErroHttp 401/503). */
  preparar(req: FastifyRequest, modulo: ModuloId | null): Promise<RequisicaoPreparada>;
  relogio: () => Date;
  banco: BancoApp | null;
}
