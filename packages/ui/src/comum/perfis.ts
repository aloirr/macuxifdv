/**
 * RD-0014 (T-0111, R-20261108-173629-corretor-redundancias): o nome de cada um dos 7 perfis padrão, o MESMO no BKO
 * (Perfis de acesso, Usuários), no portal, no login e nos apps. Puro (roda em Node nos testes). Spec:
 * docs/design/perfis-de-acesso.md §0.1.
 *
 * - **Curto** (`ROTULO_PERFIL_CURTO`): o nome do perfil em toda tela — chip, coluna, seletor, "Perfil base: X", trava,
 *   mensagem do login ("O perfil assistente não usa…"), auditoria. É o do desenho aprovado da T-0111.
 * - **Longo** (`ROTULO_PERFIL_LONGO`): só onde o perfil é APRESENTADO a alguém, uma vez, com espaço — o cabeçalho do Perfil
 *   no app (embaixo do nome), a dica (`title`/leitor de tela) do chip do perfil e o convite por e-mail. Nunca no lugar do
 *   curto numa lista ou mensagem.
 *
 * O código (`vendedor`, `admin`…) nunca aparece na tela (perfis-de-acesso.md, glossário). Fonte única proposta ao
 * engenheiro-software: o `ROTULO_PERFIL` do platform-sdk passa a ter estes textos (hoje diz "Assistente de BKO") e o kit
 * reexporta quando depender do SDK; até lá, este mapa é o texto fixado e o teste trava as 14 strings.
 */

/** Os 7 perfis padrão, na ordem de tela (seletor "Perfil base", lista de Perfis, caixas do campo Perfis). Igual a `PERFIS` do SDK. */
export const ORDEM_PERFIL_PADRAO = ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'] as const;
export type PerfilPadrao = (typeof ORDEM_PERFIL_PADRAO)[number];

/** Nome do perfil em toda tela (1 palavra, cabe num chip de 360 dp). */
export const ROTULO_PERFIL_CURTO: Readonly<Record<PerfilPadrao, string>> = {
  vendedor: 'Vendedor',
  promotor: 'Promotor',
  supervisor: 'Supervisor',
  gerente: 'Gerente',
  analista: 'Analista',
  assistente: 'Assistente',
  admin: 'Admin',
};

/** Nome por extenso, para apresentar o perfil uma vez (cabeçalho do Perfil no app, dica do chip, convite). */
export const ROTULO_PERFIL_LONGO: Readonly<Record<PerfilPadrao, string>> = {
  vendedor: 'Vendedor de campo',
  promotor: 'Promotor de trade marketing',
  supervisor: 'Supervisor de vendas',
  gerente: 'Gerente comercial',
  analista: 'Analista comercial',
  assistente: 'Assistente de backoffice',
  admin: 'Administrador da empresa',
};

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
