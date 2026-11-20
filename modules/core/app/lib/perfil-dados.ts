/**
 * Dados do Perfil do app (itens 17 e 18 do teste de campo do Campo v1.0.16). Puro: o shell (`apps/mobile`, tela Perfil) só
 * desenha a tabela de rótulo e valor com estas linhas. Linha sem valor não aparece (nada de "—" no lugar do gestor).
 */
export interface LinhaDoPerfil {
  id: 'cargo' | 'email' | 'empresa' | 'gestor';
  rotulo: string;
  valor: string;
}

export function linhasDoPerfil(d: { cargo: string; email: string; empresa?: string | null; gestor?: string | null }): LinhaDoPerfil[] {
  const linhas: Array<[LinhaDoPerfil['id'], string, string | null | undefined]> = [
    ['cargo', 'Cargo', d.cargo],
    ['email', 'E-mail', d.email],
    ['empresa', 'Empresa', d.empresa],
    ['gestor', 'Gestor imediato', d.gestor],
  ];
  return linhas.flatMap(([id, rotulo, valor]) => (valor && valor.trim() ? [{ id, rotulo, valor: valor.trim() }] : []));
}
