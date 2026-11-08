/**
 * RN-CORE-36 / RN-VEN-16 / RN-VEN-24: pendências de preenchimento do Novo pedido, cada uma com a aba onde se corrige.
 * Função pura; a tela só mostra o bloco "Falta para salvar" no Resumo e a bolinha na aba (padrão em `@macuxi/ui`).
 * O formato de cada pendência é o `PendenciaPreenchimento` do `@macuxi/ui` (id estável, texto sem verbo e sem ponto final, aba).
 */
export type AbaDoPedido = 'venda' | 'itens' | 'entrega' | 'resumo';

export interface PendenciaDoPedido {
  id: string;
  texto: string;
  aba: AbaDoPedido;
}

export interface EntradaPendencias {
  itens: number;
  quantidade_invalida: boolean;
  /** Situação do pagamento (forma e prazo ficam na aba Venda). */
  pagamento: { tipo: 'ok' } | { tipo: 'sem_forma_permitida' } | { tipo: 'forma' } | { tipo: 'prazo' } | { tipo: 'invalido'; mensagem: string };
  /** Frete (RN-VEN-16): `transportadora` = FOB sem transportadora; `cnpj` = transportadora digitada com CNPJ inválido. */
  frete: 'ok' | 'transportadora' | 'cnpj';
  /** `CalculoPedido.erros`: mensagens do cálculo (item sem preço, medida, desconto, alçada). */
  erros_calculo: readonly string[];
}

const NOMES_DA_ABA: Record<AbaDoPedido, string> = { venda: 'Venda', itens: 'Itens', entrega: 'Entrega', resumo: 'Resumo' };

function semPontoFinal(t: string): string {
  return t.trim().replace(/\.+$/, '');
}

/** Mensagem do cálculo ou do pagamento → o que falta, em substantivo (spec §1.2): sem ordem ("Reduza…") e sem "Pedido:". */
export function textoDaPendencia(mensagem: string): string {
  const m = mensagem.trim();
  let x: RegExpMatchArray | null;
  if ((x = m.match(/^(.+?): sem preço na tabela/))) return `${x[1]} sem preço na tabela do cliente`;
  if ((x = m.match(/^(.+?): a medida .+ não está mais disponível/))) return `Medida de ${x[1]}`;
  if (m.startsWith('Pedido: Desconto e acréscimo são excludentes')) return 'Desconto ou acréscimo do pedido (só um dos dois)';
  if ((x = m.match(/^(.+?): Desconto e acréscimo são excludentes/))) return `Desconto ou acréscimo de ${x[1]} (só um dos dois)`;
  if (/^Pedido: o desconto em R\$ passa do total/.test(m)) return 'Desconto do pedido acima do total dos itens';
  if ((x = m.match(/^(.+?): o desconto em R\$ passa do preço de tabela/))) return `Desconto de ${x[1]} acima do preço de tabela`;
  if ((x = m.match(/^Desconto efetivo de .+? acima da alçada máxima \((.+?)\)/))) return `Desconto acima da alçada máxima (${x[1]})`;
  if (m.startsWith('Forma de pagamento indisponível')) return 'Forma de pagamento (a escolhida saiu da lista)';
  if (m.startsWith('Prazo indisponível')) return 'Prazo de pagamento (o escolhido não vale para esta forma)';
  if (m.startsWith('Este cliente não aceita esta forma')) return 'Forma de pagamento aceita pelo cliente';
  if (m.startsWith('Prazo acima do prazo médio')) return 'Prazo dentro do prazo médio do cliente';
  // sem tradução conhecida: 1ª frase, sem o prefixo "Pedido: "
  return semPontoFinal(m.replace(/^Pedido:\s*/, '').split(/(?<=\.)\s/)[0] ?? m);
}

/** Erros do pedido inteiro (ajuste, alçada) se corrigem no Resumo; os de item, na aba Itens. */
function abaDoErroDeCalculo(e: string): AbaDoPedido {
  return e.startsWith('Pedido:') || e.startsWith('Desconto efetivo') ? 'resumo' : 'itens';
}

/** Pendências na ordem das abas: Venda (forma, prazo), Itens (itens, cálculo), Entrega (frete), Resumo (ajuste do pedido). */
export function pendenciasDePreenchimento(e: EntradaPendencias): PendenciaDoPedido[] {
  const r: PendenciaDoPedido[] = [];
  if (e.itens === 0) r.push({ id: 'sem-item', texto: 'Pelo menos 1 item', aba: 'itens' });
  if (e.quantidade_invalida) r.push({ id: 'quantidade', texto: 'Quantidade dos itens', aba: 'itens' });
  switch (e.pagamento.tipo) {
    case 'sem_forma_permitida':
      r.push({ id: 'forma', texto: 'Forma de pagamento aceita pelo cliente', aba: 'venda' });
      break;
    case 'forma':
      r.push({ id: 'forma', texto: 'Forma de pagamento', aba: 'venda' });
      break;
    case 'prazo':
      r.push({ id: 'prazo', texto: 'Prazo de pagamento', aba: 'venda' });
      break;
    case 'invalido':
      r.push({ id: 'pagamento', texto: textoDaPendencia(e.pagamento.mensagem), aba: 'venda' });
      break;
    default:
  }
  e.erros_calculo.forEach((m, i) => r.push({ id: `calculo-${i}`, texto: textoDaPendencia(m), aba: abaDoErroDeCalculo(m) }));
  if (e.frete !== 'ok') r.push({ id: 'frete', texto: e.frete === 'cnpj' ? 'CNPJ da transportadora' : 'Transportadora do frete FOB', aba: 'entrega' });
  const ordem: AbaDoPedido[] = ['venda', 'itens', 'entrega', 'resumo'];
  return r.map((p, i) => ({ p, i })).sort((a, b) => ordem.indexOf(a.p.aba) - ordem.indexOf(b.p.aba) || a.i - b.i).map((x) => x.p);
}

/** Linha do bloco: "Transportadora do frete FOB — aba Entrega". */
export function linhaDaPendenciaDoPedido(p: PendenciaDoPedido): string {
  return `${p.texto} — aba ${NOMES_DA_ABA[p.aba]}`;
}
