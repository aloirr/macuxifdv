'use client';

/**
 * Cliente HTTP do monitor da Integração (desenho `empresa-zerar.md` §6.4): o mesmo painel serve o BKO (JWT do usuário, `api` do SDK)
 * e a aba Integração da empresa no portal `config.` (sessão do super-admin, `chamarPortal` com o tenant no `x-macuxi-tenant`).
 * Quem monta o painel passa o cliente; as consultas do monitor o leem daqui. A API revalida perfil, licença e tenant nos dois casos.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { api, useSession } from '@macuxi/platform-sdk/web';

export interface OpcoesChamadaIntegracao {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
}

export interface ClienteIntegracao {
  /** Chamada JSON relativa a `/v1` (ex.: `/integracao/monitor`); erro = exceção com a mensagem da API. */
  chamar: <T = unknown>(caminho: string, opcoes?: OpcoesChamadaIntegracao) => Promise<T>;
  /** Separa o cache das consultas: `'bko'` no BKO; no portal, um por empresa (ex.: `portal:<tenant_id>`). */
  escopo: string;
  /** `false` enquanto a sessão não está pronta: nada é consultado. */
  ativo: boolean;
  /**
   * Intervalo de atualização do monitor (ms). Ausente = o `sync_auto_min` do tenant, lido de `/v1/me/modulos` com o JWT do usuário
   * (só o BKO tem essa rota). Fora do BKO é obrigatório: o portal passa o seu.
   */
  intervaloMs?: number;
}

export const ESCOPO_BKO = 'bko';

const Contexto = createContext<ClienteIntegracao | null>(null);

export function ClienteIntegracaoProvider({ cliente, children }: { cliente: ClienteIntegracao; children: ReactNode }) {
  return <Contexto.Provider value={cliente}>{children}</Contexto.Provider>;
}

/** O cliente passado por parâmetro ou o do painel em volta; sem nenhum, é erro de montagem. */
export function useClienteIntegracao(explicito?: ClienteIntegracao): ClienteIntegracao {
  const doPainel = useContext(Contexto);
  const c = explicito ?? doPainel;
  if (!c) throw new Error('Painel da Integração montado sem cliente HTTP (ClienteIntegracaoProvider).');
  return c;
}

/** Escopo do cliente em volta ou o do BKO (telas só do BKO, como o de-para, montadas fora do painel). */
export function useEscopoIntegracao(): string {
  return useContext(Contexto)?.escopo ?? ESCOPO_BKO;
}

/** Cliente do BKO: `api` do SDK com o JWT do usuário logado. */
export function useClienteDoBko(): ClienteIntegracao {
  const ativo = useSession().status === 'authenticated';
  return useMemo(() => ({ chamar: api, escopo: ESCOPO_BKO, ativo }), [ativo]);
}
