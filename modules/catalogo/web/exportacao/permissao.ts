/**
 * Quem vê a exportação do catálogo (RF-CAT-09). A API (fatia B) revalida perfil, licença do módulo e tenant (RLS);
 * aqui só se esconde o que o usuário não poderia usar.
 */
export const PERFIS_EXPORTACAO: readonly string[] = ['analista', 'admin'];

export function podeExportarCatalogo(v: { perfil: string | null | undefined; modulosAtivos: readonly string[] }): boolean {
  return !!v.perfil && PERFIS_EXPORTACAO.includes(v.perfil) && v.modulosAtivos.includes('catalogo');
}
