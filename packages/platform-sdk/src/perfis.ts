/**
 * Perfis por app (doc 03, esclarecimentos de 2026-10-30) e conversão dos papéis da Fase M.
 *
 * - BKO web: admin, analista, assistente e gerente. Promotor, vendedor e supervisor não acessam (Q6; T-0094, RN-CORE-33:
 *   o supervisor usa o Macuxi Gestão).
 * - Macuxi Campo: vendedor e promotor. Macuxi Gestão: supervisor e gerente.
 * - A Fase M (mock-api, `Role` de @macuxi/core/contracts) usa papéis em inglês; os shells convertem no
 *   login com `perfilDaFaseM` e daí em diante só falam `Perfil`. Some quando a API real (T-0003) emitir perfis.
 */
import { ROTULO_PERFIL_CURTO, ROTULO_PERFIL_LONGO as ROTULO_LONGO_COMUM } from '@macuxi/comum/perfis';
import { NOME_APP_VARIANTE } from './app-versao';
import type { AppId, Perfil } from './nomes';

export const PERFIS_DO_APP: Readonly<Record<Exclude<AppId, 'conector'>, readonly Perfil[]>> = {
  campo: ['vendedor', 'promotor'],
  gestao: ['supervisor', 'gerente'],
  web: ['admin', 'analista', 'assistente', 'gerente'],
};

export function perfilUsaApp(perfil: Perfil | null | undefined, app: keyof typeof PERFIS_DO_APP): boolean {
  return !!perfil && PERFIS_DO_APP[app].includes(perfil);
}

/**
 * RD-0014: nome CURTO do perfil em toda tela e mensagem (ex.: login "O perfil assistente não usa…"). Fonte única em
 * `@macuxi/comum/perfis` (o kit reexporta de lá); spec: docs/design/perfis-de-acesso.md §0.1.
 */
export const ROTULO_PERFIL: Readonly<Record<Perfil, string>> = ROTULO_PERFIL_CURTO;

/** RD-0014: nome por extenso, só para apresentar o perfil uma vez (cabeçalho do Perfil, dica do chip, convite). */
export const ROTULO_PERFIL_LONGO: Readonly<Record<Perfil, string>> = ROTULO_LONGO_COMUM;

/**
 * Papel da Fase M → perfil do doc 03. `manager` ("Gestor comercial", acima do supervisor nas alçadas
 * da Fase M) vira `gerente`. Papel desconhecido → null (o shell recusa o login).
 */
const DA_FASE_M: Readonly<Record<string, Perfil>> = {
  seller: 'vendedor',
  manager: 'gerente',
  analyst: 'analista',
  bko_assistant: 'assistente',
  admin: 'admin',
};

export function perfilDaFaseM(papel: string | null | undefined): Perfil | null {
  return (papel && DA_FASE_M[papel]) || null;
}

/** Nome do app ou do BKO na frase ("o app Macuxi Campo"), o mesmo das mensagens do login. RD-0016: exportado para os shells. */
export const NOME_DO_APP: Readonly<Record<keyof typeof PERFIS_DO_APP, string>> = {
  campo: `o app ${NOME_APP_VARIANTE.campo}`,
  gestao: `o app ${NOME_APP_VARIANTE.gestao}`,
  web: 'o backoffice (web)',
};

/**
 * Login certo num app que não é do perfil (ex.: promotor no BKO): mensagem com a ação seguinte, ou `null` se o perfil
 * usa este app. O shell recusa a entrada e encerra a sessão recém-criada (doc 03: promotor e vendedor não usam o BKO).
 */
export function mensagemPerfilForaDoApp(perfil: Perfil | null | undefined, app: keyof typeof PERFIS_DO_APP): string | null {
  if (perfilUsaApp(perfil, app)) return null;
  if (!perfil) return 'Seu perfil não foi reconhecido. Fale com o administrador da sua empresa.';
  const certo = (Object.keys(PERFIS_DO_APP) as (keyof typeof PERFIS_DO_APP)[]).filter((a) => a !== app && PERFIS_DO_APP[a].includes(perfil));
  const onde = certo.map((a) => NOME_DO_APP[a]).join(' ou ');
  return `O perfil ${ROTULO_PERFIL[perfil].toLowerCase()} não usa ${NOME_DO_APP[app]}.${onde ? ` Entre pelo ${onde.replace(/^o /, '').replace(/ ou o /g, ' ou pelo ')}.` : ''}`;
}

/**
 * T-0094 (RN-CORE-33; ADR 0032): apps com login de usuário do tenant. O shell manda o seu no `POST /v1/auth/login`
 * (`app`) e a API recusa, já no login, o perfil que não usa aquele app (403 `PERFIL_FORA_DO_APP`, sem abrir sessão).
 */
export const APPS_COM_LOGIN = ['campo', 'gestao', 'web'] as const satisfies readonly (keyof typeof PERFIS_DO_APP)[];
export type AppComLogin = (typeof APPS_COM_LOGIN)[number];

/** 403 do login: perfil certo, app errado (ex.: vendedor no BKO). Mensagem: `mensagemPerfilForaDoApp`. */
export const CODIGO_PERFIL_FORA_DO_APP = 'PERFIL_FORA_DO_APP';

/**
 * T-0094 (RN-CORE-33; ADR 0032): superfície exigida por uma rota de módulo (`RotaModulo.superficie`). `'bko'` = rota que só o
 * backoffice usa: a API recusa com 403 `PERFIL_SEM_BKO` todo perfil fora de `PERFIS_DO_APP.web`, qualquer que seja o app que
 * pediu o token. Rota usada também pelos apps (ex.: hierarquia da equipe no Gestão) não leva a marca.
 */
export const SUPERFICIES_ROTA = ['bko'] as const;
export type SuperficieRota = (typeof SUPERFICIES_ROTA)[number];

/** 403 da API: rota marcada `superficie: 'bko'` chamada por perfil que não usa o backoffice. */
export const CODIGO_PERFIL_SEM_BKO = 'PERFIL_SEM_BKO';

/** O perfil pode usar a superfície? Hoje `'bko'` = `PERFIS_DO_APP.web` (fonte única com o login do BKO). */
export function perfilUsaSuperficie(perfil: Perfil | null | undefined, superficie: SuperficieRota): boolean {
  return superficie === 'bko' && perfilUsaApp(perfil, 'web');
}
