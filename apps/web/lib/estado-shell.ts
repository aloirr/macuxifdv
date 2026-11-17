/**
 * O que o miolo do BKO mostra (puro, testável sem navegador). T-0030 D-B30: as páginas de módulo (`[...caminho]`)
 * decidem 404 pela visão do shell; se a visão fosse montada antes de `GET /v1/me/modulos` responder (só com o Core),
 * abrir `/pedidos` direto pela URL (F5, link) com a rede lenta dava 404 de vez. Por isso o conteúdo só é montado com os
 * módulos efetivos já carregados (RN-CORE-01/03); até lá, "Carregando…".
 */
export type EstadoConteudo = 'erro_me' | 'perfil_fora_do_bko' | 'sem_filial' | 'erro_modulos' | 'carregando_modulos' | 'pronto';

export function estadoDoConteudo(e: {
  /** Só na demonstração (mock-api) o `GET /me` é usado. */
  erroMe: boolean;
  perfilUsaWeb: boolean;
  modulos: { isError: boolean; data: readonly string[] | undefined };
  /** T-0176 (RN-CORE-39): a API respondeu 403 `USUARIO_SEM_FILIAL` (nos módulos ou numa página): o aviso, não o erro genérico. */
  semFilial?: boolean;
}): EstadoConteudo {
  if (e.erroMe) return 'erro_me';
  if (!e.perfilUsaWeb) return 'perfil_fora_do_bko';
  if (e.semFilial) return 'sem_filial';
  if (e.modulos.isError) return 'erro_modulos';
  if (!e.modulos.data) return 'carregando_modulos';
  return 'pronto';
}

/**
 * O que o shell faz com a sessão (T-0117, revisão G2; puro). Só `anonymous` vai ao login: a API recusou a renovação
 * (401/423) ou não há usuário. `sem_conexao` (rede, tempo esgotado, servidor fora) mantém o usuário na aba com o aviso e o
 * "Tentar de novo"; o SDK tenta sozinho quando a rede volta e no foco da aba, e a tela volta sem novo login.
 */
export type EstadoSessaoShell = 'autenticada' | 'sem_conexao' | 'ir_ao_login' | 'carregando';

export function estadoDaSessao(status: 'loading' | 'anonymous' | 'sem_conexao' | 'authenticated'): EstadoSessaoShell {
  if (status === 'authenticated') return 'autenticada';
  if (status === 'sem_conexao') return 'sem_conexao';
  if (status === 'anonymous') return 'ir_ao_login';
  return 'carregando';
}
