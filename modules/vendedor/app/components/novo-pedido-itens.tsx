/**
 * Aba Itens do Novo pedido (T-0089; referência docs/produto/referencias/R-20261106-0703-alexandre-novo-pedido-itens-v2.png,
 * spec docs/design/novo-pedido-itens.md). Item em 3 linhas mais o total:
 *  1. código · nome · embalagem;  2. aplicação em até 2 linhas (RN-CAT-08);
 *  3. UN | CX, quantidade (− n +) e o desconto/acréscimo sempre aberto, com o tipo ao lado (Desc %, Desc R$, Acrésc %, Acrésc R$);
 *  fim: "Valor total:" à direita. O item não mostra "preço de tabela → preço final" nem o selo da faixa (a faixa aparece só
 *  no "Leve mais e pague menos" de Detalhes). Só lê e escreve o rascunho do aparelho (offline-first); o preço vem do cálculo
 *  de `lib/novo-pedido` (domain), nada é calculado aqui. Alvos de toque ≥ 44 dp (os do kit já garantem).
 */
import type { Product } from '@macuxi/catalogo/contracts';
import { DescontoCompacto, colors, fonte, sanearDecimal, type as t } from '@macuxi/ui/mobile';
import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { partirTrecho, type TrechoServeEm } from '../../domain/busca-seletor';
import { ajusteDoTipo, tipoDoAjuste, trocarTipoDoAjuste, valorDoAjuste, type Ajuste, type TipoDoAjuste } from '../lib/novo-pedido';
import { textoDoAjuste, valorDoTexto } from '../lib/ajuste-pedido';

/**
 * Desconto/acréscimo do item: o `DescontoCompacto` do kit, o mesmo do pedido (T-0130: um componente só para item e pedido).
 * Sempre aberto, com o tipo ao lado; cada número válido vale na hora (RN-VEN-02). O equivalente (% ↔ R$ por unidade) só serve para trocar o tipo
 * levando o valor; não aparece ao lado do campo (dono do produto, 14/11: repetia o cartão de totais da folha).
 */
export function AjusteDoItem({ k, nome, p, ajuste, equivalente, onAjuste }: { k: string; nome: string; p: Product; ajuste: Ajuste; equivalente: { cents: number; pct_exibicao: number } | null; onAjuste: (a: Ajuste) => void }) {
  const valorAtual = valorDoAjuste(ajuste);
  const [escolhido, setEscolhido] = useState<TipoDoAjuste>(tipoDoAjuste(ajuste));
  // com valor, o tipo é o do ajuste; sem valor, o que a pessoa escolheu
  const tipo = valorAtual > 0 ? tipoDoAjuste(ajuste) : escolhido;
  const [texto, setTexto] = useState(textoDoAjuste(tipo, valorAtual));
  // mudança de fora (trocar a medida, desfazer): o texto acompanha; o que foi digitado e já vale não é reescrito
  useEffect(() => {
    setTexto((atual) => (valorDoTexto(tipo, atual) === valorAtual ? atual : textoDoAjuste(tipo, valorAtual)));
  }, [valorAtual, tipo]);
  const teto = tipo === 'desc_reais' && p.price_cents !== null ? p.price_cents : undefined;
  return (
    <DescontoCompacto
      testID={`ajuste-${k}`}
      style={{ flexGrow: 1, minWidth: 124 }}
      tipo={tipo}
      onChangeTipo={(novo) => {
        setEscolhido(novo);
        if (valorAtual > 0) onAjuste(trocarTipoDoAjuste(ajuste, novo, equivalente));
        else setTexto('');
      }}
      texto={texto}
      onChangeTexto={(digitado) => {
        const t2 = sanearDecimal(digitado, 2);
        setTexto(t2);
        const n = valorDoTexto(tipo, t2);
        onAjuste(ajusteDoTipo(tipo, teto !== undefined ? Math.min(teto, n) : n));
      }}
      onConfirmar={() => setTexto(textoDoAjuste(tipo, valorDoAjuste(ajuste)))}
      equivalente={null}
      placeholder="0"
      rotuloAcessivel={`Valor do ajuste de ${nome}`}
      rotuloTipo={`Tipo do ajuste de ${nome}`}
      rotuloFechar="Fechar a lista"
    />
  );
}

/** RN-CAT-12: "Serve em" com os termos da busca marcados e "inclui 2012" quando o ano casou por faixa. */
export function ServeEm({ trecho, codigo }: { trecho: TrechoServeEm; codigo: string }) {
  const partes = partirTrecho(trecho.texto, trecho.marcas);
  return (
    <Text style={s.aplicacao} numberOfLines={2} testID={`serve-em-${codigo}`}>
      <Text style={t.label}>Serve em:</Text> {partes.map((x, i) => (x.marcado ? <Text key={i} style={t.label}>{x.texto}</Text> : x.texto))}
      {trecho.inclui_ano ? ` · inclui ${trecho.inclui_ano}` : ''}
    </Text>
  );
}

const s = StyleSheet.create({
  item: { paddingVertical: 12, paddingHorizontal: 14, gap: 8 },
  divisor: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  medida: { gap: 4 },
  titulo: { ...fonte.body, fontSize: 14, color: colors.ink },
  nome: { ...fonte.semibold, fontSize: 14, color: colors.ink },
  separador: { ...fonte.body, fontSize: 12, color: colors.ink3 },
  embalagem: { ...fonte.body, fontSize: 12, color: colors.ink2 },
  aplicacao: { ...fonte.body, fontSize: 14, color: colors.ink2 },
  controles: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 4, rowGap: 0 },
  total: { flexDirection: 'row', alignSelf: 'flex-end', alignItems: 'baseline', gap: 6, minHeight: 24 },
  totalRotulo: { ...fonte.body, fontSize: 12, color: colors.ink2 },
  totalValor: { ...fonte.semibold, fontSize: 14, color: colors.ink, fontVariant: ['tabular-nums'] },
});
