/**
 * RD-0014 (T-0111, R-20261108-173629 e R-20261109-023654-corretor-redundancias): o nome de cada um dos 7 perfis padrão, o MESMO
 * no BKO (Perfis de acesso, Usuários), no portal, no login e nos apps. Puro (roda em Node nos testes). Spec:
 * docs/design/perfis-de-acesso.md §0.1.
 *
 * FONTE ÚNICA dos mapas: `@macuxi/comum/perfis` (`packages/comum/src/perfis.ts`), que o platform-sdk (`ROTULO_PERFIL`) também
 * reexporta. O kit não escreve rótulo nenhum: só reexporta e acrescenta o `rotuloDoPerfil` (curto, longo ou o nome do perfil
 * criado pela empresa).
 *
 * - **Curto** (`ROTULO_PERFIL_CURTO`): o nome do perfil em toda tela — chip, coluna, seletor, "Perfil base: X", trava,
 *   mensagem do login ("O perfil assistente não usa…"), auditoria. É o do desenho aprovado da T-0111.
 * - **Longo** (`ROTULO_PERFIL_LONGO`): só onde o perfil é APRESENTADO a alguém, uma vez, com espaço — o cabeçalho do Perfil
 *   no app (embaixo do nome), a dica (`title`/leitor de tela) do chip do perfil e o convite por e-mail. Nunca no lugar do
 *   curto numa lista ou mensagem.
 *
 * O código (`vendedor`, `admin`…) nunca aparece na tela (perfis-de-acesso.md, glossário).
 */
import { ORDEM_PERFIL_PADRAO, ROTULO_PERFIL_CURTO, ROTULO_PERFIL_LONGO, type PerfilPadrao } from '@macuxi/comum/perfis';

export { ORDEM_PERFIL_PADRAO, ROTULO_PERFIL_CURTO, ROTULO_PERFIL_LONGO, type PerfilPadrao } from '@macuxi/comum/perfis';

export const ehPerfilPadrao = (codigo: string | null | undefined): codigo is PerfilPadrao =>
  !!codigo && (ORDEM_PERFIL_PADRAO as readonly string[]).includes(codigo);

/**
 * Nome do perfil para a tela. Perfil padrão → curto (ou longo); perfil criado pela empresa → o `nome` que ela deu (vem da API);
 * sem nome → o próprio código, como última saída (nunca vazio).
 */
export function rotuloDoPerfil(codigo: string, opcoes: { forma?: 'curto' | 'longo'; nome?: string | null } = {}): string {
  const nome = opcoes.nome?.trim();
  if (ehPerfilPadrao(codigo)) return (opcoes.forma === 'longo' ? ROTULO_PERFIL_LONGO : ROTULO_PERFIL_CURTO)[codigo];
  return nome || codigo;
}
