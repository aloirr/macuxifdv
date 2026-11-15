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
  /**
   * T-0176 (RN-CORE-39; ADR 0056): usuário sem a filial de cadastro numa entrada que o aceita (`semFilial: 'aceita'`). A carteira
   * vem vazia e a equipe é só ele; quem chamou serve só o estado de bloqueio.
   */
  restritoSemFilial: boolean;
}

/** Opções do `preparar`. */
export interface OpcoesPreparar {
  /** Só rota de módulo que declarou (ADR 0029): aceita também o token de plataforma, com o tenant do cabeçalho `x-macuxi-tenant`. */
  superAdmin?: ModoSuperAdmin | undefined;
  /** T-0176 (ADR 0056): a entrada atende o usuário sem filial (restrito). Ausente = 403 `USUARIO_SEM_FILIAL` para ele. */
  semFilial?: 'aceita' | undefined;
}

export interface Plataforma {
  manifestos: readonly Manifesto[];
  modulos: readonly ModuloApi[];
  /** Permissão por ação dos manifestos instalados (ADR 0004). */
  permissoes: Permissoes;
  /**
   * Autentica, aplica a guarda do usuário sem filial (403 `USUARIO_SEM_FILIAL`, RN-CORE-39), calcula os efetivos e devolve o
   * contexto da requisição (lança ErroHttp 401/403/503). Ver `OpcoesPreparar`.
   */
  preparar(req: FastifyRequest, modulo: ModuloId | null, opcoes?: OpcoesPreparar): Promise<RequisicaoPreparada>;
  relogio: () => Date;
  banco: BancoApp | null;
}
