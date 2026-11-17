/**
 * Parâmetros de URL dos painéis de /parametros/acesso. Os painéis Perfis e Módulos dividem a rota,
 * então cada um lê só o seu parâmetro: um não abre o outro.
 */
export const PARAM_EDITAR_PERFIL = 'editar_perfil';
export const PARAM_MODULOS_PERFIL = 'modulos_perfil';

interface Leitor {
  get(nome: string): string | null;
}

/** Perfil em edição no painel Perfis. `?perfil=` (link antigo `/perfis?perfil=X`) só vale sem `nivel`/`modulos_perfil`, que são do painel Módulos. */
export function perfilEmEdicao(params: Leitor): string | null {
  const novo = params.get(PARAM_EDITAR_PERFIL);
  if (novo) return novo;
  const antigo = params.get('perfil');
  if (antigo && !params.get('nivel') && !params.get(PARAM_MODULOS_PERFIL)) return antigo;
  return null;
}

/** Perfil filtrado no painel Módulos: `?modulos_perfil=` ou, no link antigo, `?nivel=…&perfil=X` sem `editar_perfil`. */
export function perfilDosModulos(params: Leitor): string | null {
  const novo = params.get(PARAM_MODULOS_PERFIL);
  if (novo) return novo;
  const antigo = params.get('perfil');
  if (antigo && params.get('nivel') && !params.get(PARAM_EDITAR_PERFIL)) return antigo;
  return null;
}
