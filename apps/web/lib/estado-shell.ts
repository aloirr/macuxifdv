/**
 * O que o miolo do BKO mostra (puro, testável sem navegador). T-0030 D-B30: as páginas de módulo (`[...caminho]`)
 * decidem 404 pela visão do shell; se a visão fosse montada antes de `GET /v1/me/modulos` responder (só com o Core),
 * abrir `/pedidos` direto pela URL (F5, link) com a rede lenta dava 404 de vez. Por isso o conteúdo só é montado com os
 * módulos efetivos já carregados (RN-CORE-01/03); até lá, "Carregando…".
 */
export type EstadoConteudo = 'erro_me' | 'perfil_fora_do_bko' | 'erro_modulos' | 'carregando_modulos' | 'pronto';

export function estadoDoConteudo(e: {
  /** Só na demonstração (mock-api) o `GET /me` é usado. */
  erroMe: boolean;
  perfilUsaWeb: boolean;
  modulos: { isError: boolean; data: readonly string[] | undefined };
}): EstadoConteudo {
  if (e.erroMe) return 'erro_me';
  if (!e.perfilUsaWeb) return 'perfil_fora_do_bko';
  if (e.modulos.isError) return 'erro_modulos';
  if (!e.modulos.data) return 'carregando_modulos';
  return 'pronto';
}
