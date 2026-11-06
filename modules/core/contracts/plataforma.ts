/**
 * Contratos do super-admin de plataforma no Core (T-0087; ADR 0029; RN-CORE-31; desenho docs/desenho/T-0087.md §4).
 * Os schemas Zod das rotas públicas `POST /v1/plataforma/auth/*` moram no `platform-sdk` (a API e o portal compartilham);
 * aqui ficam reexportados com os tipos e os códigos de erro que a tela trata pelo código.
 * Nada disto vai a log: e-mail, senha, convite, código TOTP, código de recuperação e segredo só trafegam no corpo.
 */
import type { z } from 'zod';
import {
  CodigosRecuperacaoSchema,
  DesafioSchema,
  EtapaLoginSchema,
  LoginPlataformaSchema,
  PrimeiroAcessoSchema,
  RegerarRecuperacaoSchema,
  SegundoFatorSchema,
  SessaoPlataformaSchema,
  TotpConfirmadoSchema,
  TotpConfirmarSchema,
  TotpInicioSchema,
} from '@macuxi/platform-sdk';

export {
  CodigosRecuperacaoSchema,
  DesafioSchema,
  EtapaLoginSchema,
  LoginPlataformaSchema,
  PrimeiroAcessoSchema,
  RegerarRecuperacaoSchema,
  SegundoFatorSchema,
  SessaoPlataformaSchema,
  TotpConfirmadoSchema,
  TotpConfirmarSchema,
  TotpInicioSchema,
};

export type PrimeiroAcesso = z.output<typeof PrimeiroAcessoSchema>;
export type LoginPlataforma = z.output<typeof LoginPlataformaSchema>;
export type EtapaLogin = z.output<typeof EtapaLoginSchema>;
export type DesafioEntrada = z.output<typeof DesafioSchema>;
export type TotpInicio = z.output<typeof TotpInicioSchema>;
export type TotpConfirmar = z.output<typeof TotpConfirmarSchema>;
export type TotpConfirmado = z.output<typeof TotpConfirmadoSchema>;
export type SegundoFator = z.output<typeof SegundoFatorSchema>;
export type SessaoPlataforma = z.output<typeof SessaoPlataformaSchema>;
export type RegerarRecuperacao = z.output<typeof RegerarRecuperacaoSchema>;

/** Códigos de erro das rotas `plataforma/auth/*` (a tela decide a mensagem e a volta pelo código). */
export const CODIGOS_PORTAL = {
  /** 401: e-mail ou senha errados (mesma resposta e mesmo tempo para e-mail inexistente). */
  credenciais: 'CREDENCIAIS_INVALIDAS',
  /** 423: 5 falhas seguidas, 15 min. */
  bloqueado: 'BLOQUEADO',
  /** 410: já existe super-admin; o primeiro acesso não volta. */
  primeiroAcessoEncerrado: 'PRIMEIRO_ACESSO_ENCERRADO',
  /** 401: convite errado no primeiro acesso. */
  conviteInvalido: 'CONVITE_INVALIDO',
  /** 401: desafio vencido, usado ou de outra etapa: volta ao e-mail e senha. */
  desafio: 'DESAFIO_INVALIDO',
  /** 401: código TOTP ou de recuperação errado (ou reutilizado). */
  codigoInvalido: 'CODIGO_INVALIDO',
  /** 409: confirmar o TOTP sem ter iniciado o cadastro (ou já confirmado). */
  totpNaoIniciado: 'TOTP_NAO_INICIADO',
  /** 401: token de plataforma ausente, vencido ou de sessão encerrada. */
  sessao: 'SESSAO_PLATAFORMA_INVALIDA',
  /** 503: faltam segredos do portal no ambiente (falha fechada). */
  indisponivel: 'PORTAL_INDISPONIVEL',
} as const;
