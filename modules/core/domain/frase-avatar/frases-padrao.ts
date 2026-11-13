/**
 * RN-CORE-41: as 30 frases padrão da frase do dia, aprovadas pelo dono do produto (anexo
 * `recados/anexos/2026-11-12-T0170-final-frases-padrao.md` do repositório de recados). O tenant nasce com elas, na ordem
 * 1…30, com o código fixo `P01`…`P30` (carga idempotente: o código não muda nem é reaproveitado). A migração do banco
 * copia este mesmo texto (desenho §1.1).
 */
export interface FrasePadrao {
  readonly codigo: string;
  readonly texto: string;
}

const TEXTOS = [
  'Cada visita bem feita abre a porta para a próxima venda.',
  'O cliente lembra de quem aparece. Apareça.',
  'Rota cumprida é meta mais perto.',
  'Hoje é dia de positivar quem ficou para trás.',
  'Quem conhece o cliente vende mais do que quem só oferece.',
  'Um bom pedido começa com uma boa pergunta.',
  'A meta do mês se faz no dia de hoje.',
  'Constância vence talento que não aparece.',
  'Ouça primeiro, ofereça depois.',
  'Cada cliente atendido é uma relação que cresce.',
  'Seu sorriso também está no catálogo.',
  'Planejar a rota é ganhar tempo na rua.',
  'O "não" de hoje pode ser o pedido de amanhã.',
  'Mix bem vendido é cliente bem atendido.',
  'Chegue cedo, saia com o pedido.',
  'Quem cuida da gôndola cuida da venda.',
  'Resultado é a soma de pequenas visitas bem feitas.',
  'Confiança se constrói a cada entrega cumprida.',
  'Venda boa é a que o cliente quer repetir.',
  'Hoje tem cliente esperando a sua visita.',
  'Foco no que você controla: a próxima visita.',
  'Seu trabalho move o comércio da cidade.',
  'Cada quilômetro rodado tem um cliente no final.',
  'Bom atendimento não tem dia ruim.',
  'A diferença está nos detalhes da visita.',
  'Persistência transforma rota em resultado.',
  'O melhor argumento é conhecer bem o produto.',
  'Um cliente satisfeito indica outro.',
  'Comece forte, termine com pedido.',
  'Você é a cara da empresa na rua. Faça valer.',
] as const;

export const FRASES_PADRAO: readonly FrasePadrao[] = Object.freeze(
  TEXTOS.map((texto, i) => Object.freeze({ codigo: `P${String(i + 1).padStart(2, '0')}`, texto })),
);
