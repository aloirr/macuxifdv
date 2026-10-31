/**
 * Perfis por app (doc 03, esclarecimentos de 2026-10-30) e conversão dos papéis da Fase M.
 *
 * - BKO web: admin, analista, assistente, supervisor e gerente. Promotor e vendedor não acessam (Q6).
 * - Macuxi Campo: vendedor e promotor. Macuxi Gestão: supervisor e gerente.
 * - A Fase M (mock-api, `Role` de @macuxi/core/contracts) usa papéis em inglês; os shells convertem no
 *   login com `perfilDaFaseM` e daí em diante só falam `Perfil`. Some quando a API real (T-0003) emitir perfis.
 */
import type { AppId, Perfil } from './nomes';

export const PERFIS_DO_APP: Readonly<Record<Exclude<AppId, 'conector'>, readonly Perfil[]>> = {
  campo: ['vendedor', 'promotor'],
  gestao: ['supervisor', 'gerente'],
  web: ['admin', 'analista', 'assistente', 'supervisor', 'gerente'],
};

export function perfilUsaApp(perfil: Perfil | null | undefined, app: keyof typeof PERFIS_DO_APP): boolean {
  return !!perfil && PERFIS_DO_APP[app].includes(perfil);
}

export const ROTULO_PERFIL: Readonly<Record<Perfil, string>> = {
  vendedor: 'Vendedor',
  promotor: 'Promotor',
  supervisor: 'Supervisor',
  gerente: 'Gerente',
  analista: 'Analista',
  assistente: 'Assistente de BKO',
  admin: 'Admin',
};

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

const NOME_DO_APP: Readonly<Record<keyof typeof PERFIS_DO_APP, string>> = { campo: 'o app Macuxi Campo', gestao: 'o app Macuxi Gestão', web: 'o backoffice (web)' };

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
