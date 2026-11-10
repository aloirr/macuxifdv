/**
 * Aba Itens do Novo pedido (T-0089; referência docs/produto/referencias/R-20261106-0703-alexandre-novo-pedido-itens-v2.png,
 * spec docs/design/novo-pedido-itens.md). Item em 3 linhas mais o total:
 *  1. código · nome · embalagem;  2. aplicação em até 2 linhas (RN-CAT-08);
 *  3. UN | CX, quantidade (− n +) e o desconto/acréscimo sempre aberto, com o tipo ao lado (Desc %, Desc R$, Acrésc %, Acrésc R$);
 *  fim: "Valor total:" à direita. O item não mostra "preço de tabela → preço final" nem o selo da faixa (a faixa aparece só
 *  no "Leve mais e pague menos" de Detalhes). Só lê e escreve o rascunho do aparelho (offline-first); o preço vem do cálculo
 *  de `lib/novo-pedido` (domain), nada é calculado aqui. Alvos de toque ≥ 44 dp (os do kit já garantem).
 */
import { formatBRL } from '@macuxi/comum';
import type { Product } from '@macuxi/catalogo/contracts';
import { Cartao, DescontoCompacto, colors, fonts, larguraSegmentadoCompacto, Passo, sanearDecimal, Segmentado, type as t } from '@macuxi/ui/mobile';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { partirTrecho, type TrechoServeEm } from '../../domain/busca-seletor';
import { rotuloMedida } from '../../domain/preco-pedido';
import { medidasVisiveis, trocarMedidaDaLinha } from '../lib/medida-do-item';
import { chaveDaLinha, ajusteDoTipo, alternarAplicacao, tipoDoAjuste, trocarTipoDoAjuste, unidadesDoProduto, valorDoAjuste, type Ajuste, type CalculoPedido, type TipoDoAjuste, type UnidadeDaTela } from '../lib/novo-pedido';
import type { Rascunho } from '../lib/pedidos';
import { textoDoAjuste, valorDoTexto } from '../lib/ajuste-pedido';
import { CaixaAplicacao } from './novo-pedido';

export const TEXTO_VALOR_TOTAL = 'Valor total:';

export interface PropsListaDeItens {
  produtos: readonly Product[];
  rascunho: Rascunho;
  unidades: readonly UnidadeDaTela[];
  calculo: CalculoPedido;
  onLinhas: (lines: Record<string, number>, ajustes: Record<string, Ajuste>) => void;
  somenteLeitura?: boolean;
  aoTrocarMedida?: (texto: string, desfazer: () => void) => void;
  /** T-0084 C9: trecho "Serve em" por produto (busca do Catálogo) */
  serveEm?: ReadonlyMap<string, TrechoServeEm>;
}

export function ListaDeItens({ produtos, rascunho, unidades, calculo, onLinhas, somenteLeitura, aoTrocarMedida, serveEm }: PropsListaDeItens) {
  const ajustes = rascunho.ajustes ?? {};
  // último estado pedido (não só o renderizado): dois toques antes do redesenho somam em vez de um apagar o outro
  const ultimo = useRef({ lines: rascunho.lines, ajustes });
  ultimo.current = { lines: rascunho.lines, ajustes };
  const emitir = (lines: Record<string, number>, aj: Record<string, Ajuste>) => {
    ultimo.current = { lines, ajustes: aj };
    onLinhas(lines, aj);
  };
  const setQtd = (chave: string, q: number) => {
    const n = Math.max(0, Math.trunc(q));
    const atual = ultimo.current;
    if ((atual.lines[chave] ?? 0) === n) return;
    const lines = { ...atual.lines };
    if (n > 0) lines[chave] = n;
    else delete lines[chave];
    const novos = { ...atual.ajustes };
    if (n === 0) delete novos[chave];
    emitir(lines, novos);
  };
  const setAjuste = (chave: string, aj: Ajuste) => emitir(ultimo.current.lines, { ...ultimo.current.ajustes, [chave]: aj });
  // a troca da medida leva a quantidade para a outra linha do produto; o aviso do rodapé desfaz
  const trocarMedida = (tr: { de: string; para: string; rotuloPara: string; voltar: () => void }) => {
    const antes = ultimo.current;
    const r = trocarMedidaDaLinha(antes.lines, antes.ajustes, tr.de, tr.para);
    emitir(r.lines, r.ajustes);
    aoTrocarMedida?.(`Medida trocada para ${tr.rotuloPara}`, () => {
      emitir(antes.lines, antes.ajustes);
      tr.voltar();
    });
  };
  return (
    <Cartao gap={0} preenchimento={0}>
      {produtos.map((p, i) => (
        <ItemDoPedido
          key={p.id}
          p={p}
          serveEm={serveEm?.get(p.id) ?? null}
          medidas={unidadesDoProduto(p.id, unidades, p.unit)}
          lines={rascunho.lines}
          ajustes={ajustes}
          calculo={calculo}
          ultimo={i === produtos.length - 1}
          onQtd={setQtd}
          onAjuste={setAjuste}
          onTrocarMedida={trocarMedida}
          somenteLeitura={somenteLeitura}
        />
      ))}
    </Cartao>
  );
}

function ItemDoPedido({
  p,
  serveEm,
  medidas,
  lines,
  ajustes,
  calculo,
  ultimo,
  onQtd,
  onAjuste,
  onTrocarMedida,
  somenteLeitura,
}: {
  p: Product;
  serveEm?: TrechoServeEm | null;
  medidas: UnidadeDaTela[];
  lines: Record<string, number>;
  ajustes: Record<string, Ajuste>;
  calculo: CalculoPedido;
  ultimo: boolean;
  onQtd: (chave: string, q: number) => void;
  onAjuste: (chave: string, a: Ajuste) => void;
  onTrocarMedida: (tr: { de: string; para: string; rotuloPara: string; voltar: () => void }) => void;
  somenteLeitura?: boolean;
}) {
  const chaves = medidas.map((m, idx) => chaveDaLinha(p.id, idx === 0 ? null : m.unidade));
  const qtds = chaves.map((ch) => lines[ch] ?? 0);
  const [escolhida, setEscolhida] = useState<number | null>(null);
  const visiveis = medidasVisiveis(qtds, escolhida);
  const idxComQtd = qtds.findIndex((q) => q > 0);
  // a medida em uso (a que tem quantidade) vira a escolhida: se a quantidade zerar, a linha não volta para a principal
  useEffect(() => {
    if (visiveis.length === 1 && idxComQtd >= 0) setEscolhida(visiveis[0]!);
  }, [visiveis.length, idxComQtd]);
  return (
    <View style={[s.item, !ultimo && s.divisor]} testID={`product-${p.erp_code}`}>
      {visiveis.map((idx, n) => (
        <MedidaDoItem
          key={chaves[idx]}
          p={p}
          serveEm={n === 0 ? serveEm : null}
          medidas={medidas}
          idx={idx}
          qtd={qtds[idx]!}
          linha={calculo.linhas.find((l) => l.chave === chaves[idx]) ?? null}
          ajuste={ajustes[chaves[idx]!] ?? {}}
          onQtd={(q) => onQtd(chaves[idx]!, q)}
          onAjuste={(aj) => {
            const atual = ajustes[chaves[idx]!];
            onAjuste(chaves[idx]!, { ...aj, ...(atual?.aplicacao_marcada !== undefined ? { aplicacao_marcada: atual.aplicacao_marcada } : {}), ...(atual?.aplicacao_retrato ? { aplicacao_retrato: atual.aplicacao_retrato } : {}) });
          }}
          onAplicacao={() => onAjuste(chaves[idx]!, alternarAplicacao(ajustes[chaves[idx]!], Boolean(calculo.linhas.find((l) => l.chave === chaves[idx])?.aplicacao_marcada)))}
          onMedida={(para) => {
            if (qtds[idx]! > 0) onTrocarMedida({ de: chaves[idx]!, para: chaves[para]!, rotuloPara: rotuloMedida(medidas[para]!.unidade, medidas[para]!.fator), voltar: () => setEscolhida(idx) });
            setEscolhida(para);
          }}
          somenteLeitura={somenteLeitura}
        />
      ))}
    </View>
  );
}

function MedidaDoItem({
  p,
  serveEm,
  medidas,
  idx,
  qtd,
  linha,
  ajuste,
  onQtd,
  onAjuste,
  onAplicacao,
  onMedida,
  somenteLeitura,
}: {
  p: Product;
  serveEm: TrechoServeEm | null | undefined;
  medidas: UnidadeDaTela[];
  idx: number;
  qtd: number;
  linha: CalculoPedido['linhas'][number] | null;
  ajuste: Ajuste;
  onQtd: (q: number) => void;
  onAjuste: (a: Ajuste) => void;
  onAplicacao: () => void;
  onMedida: (para: number) => void;
  somenteLeitura?: boolean;
}) {
  const m = medidas[idx]!;
  const rotulo = rotuloMedida(m.unidade, m.fator);
  const k = p.erp_code + (medidas.length > 1 ? `-${rotulo.split(' ')[0]}` : '');
  const nome = `${p.description} ${rotulo}`;
  const semPreco = p.price_cents === null;
  return (
    <View style={s.medida}>
      {/* linha 1: código · nome · embalagem; linha 2: aplicação em até 2 linhas (RN-CAT-08) */}
      <Text style={s.titulo} numberOfLines={2}>
        <Text style={t.mono}>{p.erp_code}</Text>
        <Text style={s.separador}> · </Text>
        <Text style={s.nome}>{p.description}</Text>
        <Text style={s.separador}> · </Text>
        <Text style={s.embalagem}>{rotulo}</Text>
        {p.is_campaign ? <Text style={s.embalagem}> · Campanha</Text> : null}
      </Text>
      {serveEm ? <ServeEm trecho={serveEm} codigo={p.erp_code} /> : p.applications ? <Text style={s.aplicacao} numberOfLines={2} testID={`aplicacao-texto-${k}`}>{p.applications}</Text> : null}
      {semPreco ? (
        <Text style={[t.smallStrong, { color: colors.danger }]} testID={`sem-preco-${p.erp_code}`}>
          Sem preço para este cliente
        </Text>
      ) : null}
      {somenteLeitura ? (
        <Text style={t.bodyStrong}>{qtd}</Text>
      ) : (
        <View style={s.controles}>
          {medidas.length > 1 ? (
            <Segmentado
              testID={`medida-${k}`}
              rotuloAcessivel={`Medida de ${p.description}`}
              compacto
              style={{ flexGrow: 0, width: larguraSegmentadoCompacto(medidas.length) }}
              valor={String(idx)}
              opcoes={medidas.map((x, i) => ({ id: String(i), rotulo: x.unidade, rotuloAcessivel: `Medida ${rotuloMedida(x.unidade, x.fator)}`, testID: `medida-${k}-${x.unidade}` }))}
              onChange={(novo) => {
                const para = Number(novo);
                if (para !== idx) onMedida(para);
              }}
            />
          ) : null}
          <Passo
            compacto
            editavel
            valor={qtd}
            min={0}
            onChange={onQtd}
            rotulo={`Quantidade de ${nome}`}
            rotuloDiminuir={`Diminuir ${nome}`}
            rotuloAumentar={`Aumentar ${nome}`}
            desligadoAumentar={semPreco}
            testID={`qty-${k}`}
          />
          {qtd > 0 ? <AjusteDoItem k={k} nome={nome} p={p} ajuste={ajuste} medida={medidas[idx]?.unidade ?? null} equivalente={linha?.equivalente ?? null} onAjuste={onAjuste} /> : null}
        </View>
      )}
      {qtd > 0 && p.applications && !somenteLeitura ? <CaixaAplicacao testID={`aplicacao-${k}`} marcada={Boolean(linha?.aplicacao_marcada)} onPress={onAplicacao} nome={nome} /> : null}
      {qtd > 0 && linha ? (
        <View style={s.total} testID={`total-${k}`} accessible accessibilityLabel={`${TEXTO_VALOR_TOTAL} ${formatBRL(linha.total_cents)}`}>
          <Text style={s.totalRotulo}>{TEXTO_VALOR_TOTAL}</Text>
          <Text style={s.totalValor}>{formatBRL(linha.total_cents)}</Text>
        </View>
      ) : null}
    </View>
  );
}

export { textoDoAjuste, valorDoTexto };

/**
 * Desconto/acréscimo do item: o `DescontoCompacto` do kit, o mesmo do pedido (T-0130: um componente só para item e pedido).
 * Sempre aberto, com o tipo ao lado; cada número válido vale na hora (RN-VEN-02); o equivalente (% ↔ R$ por unidade) fica na linha.
 */
export function AjusteDoItem({ k, nome, p, ajuste, medida, equivalente, onAjuste }: { k: string; nome: string; p: Product; ajuste: Ajuste; medida: string | null; equivalente: { cents: number; pct_exibicao: number } | null; onAjuste: (a: Ajuste) => void }) {
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
      equivalente={equivalente ? { cents: equivalente.cents, pct: equivalente.pct_exibicao } : null}
      medida={medida}
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
      <Text style={t.smallStrong}>Serve em:</Text> {partes.map((x, i) => (x.marcado ? <Text key={i} style={t.smallStrong}>{x.texto}</Text> : x.texto))}
      {trecho.inclui_ano ? ` · inclui ${trecho.inclui_ano}` : ''}
    </Text>
  );
}

const s = StyleSheet.create({
  item: { paddingVertical: 12, paddingHorizontal: 14, gap: 8 },
  divisor: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  medida: { gap: 4 },
  titulo: { fontFamily: fonts.body, fontSize: 14, color: colors.ink },
  nome: { fontFamily: fonts.bold, fontSize: 14, color: colors.ink },
  separador: { fontFamily: fonts.body, fontSize: 12, color: colors.ink3 },
  embalagem: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink2 },
  aplicacao: { fontFamily: fonts.body, fontSize: 13, color: colors.ink2 },
  controles: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 4, rowGap: 0 },
  total: { flexDirection: 'row', alignSelf: 'flex-end', alignItems: 'baseline', gap: 6, minHeight: 24 },
  totalRotulo: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink2 },
  totalValor: { fontFamily: fonts.displayBold, fontSize: 14, color: colors.ink, fontVariant: ['tabular-nums'] },
});
