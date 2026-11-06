/**
 * Peças do novo pedido de distribuidora em 3 abas (T-0061/T-0071): Itens, Detalhes e Resumo. Componentes locais do Vendedor
 * (se o engenheiro-apps promover algum para `packages/ui`, trocamos). Alvos de toque ≥ 48 dp; só lê e escreve o rascunho
 * do aparelho (offline-first). O cálculo e as regras vêm de `lib/novo-pedido.ts` (domain de preço), nada é calculado aqui.
 */
import { formatBRL } from '@macuxi/comum';
import type { Product } from '@macuxi/catalogo/contracts';
import { Badge, Banner, Botao, Card, ChipMedida, colors, fonts, Icon, radius, Segmentado, type as t } from '@macuxi/ui/mobile';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { limitarDesconto, PASSO_DESCONTO_PCT } from '../../domain/quantidade';
import { rotuloMedida } from '../../domain/preco-pedido';
import { partirTrecho, type TrechoServeEm } from '../../domain/busca-seletor';
import type { Rascunho } from '../lib/pedidos';
import {
  alternarUnidade,
  centsParaCampo,
  chaveDaLinha,
  alternarAplicacao,
  trocarModoDoAjuste,
  unidadesDoProduto,
  type Ajuste,
  type CalculoPedido,
  type UnidadeDaTela,
} from '../lib/novo-pedido';
import { medidasVisiveis, proximaMedida, trocarMedidaDaLinha } from '../lib/medida-do-item';
import { textoEquivalente, textoPrecoDaLinha } from '../lib/textos-pedido';
import { quantidadeAoConfirmar, quantidadeAoDigitar, quantidadePorPasso, registrarValorPendente, textoAposMudancaDoValor, valorPendentePct, valorPendenteQuantidade, valorPendenteReais } from '../lib/valor-pendente';

// ---------- campos ----------
/** Alvo de toque do −/+: botão visual de 32 dp com 8 dp de folga em cima/embaixo e 6 dp dos lados (44 × 48 dp, ≥ 44 dp). */
const HIT_SLOP_PASSO = { top: 8, bottom: 8, left: 6, right: 6 } as const;

function Passo({ icone, rotulo, onPress, desligado, testID }: { icone: 'plus' | 'minus'; rotulo: string; onPress: () => void; desligado?: boolean; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={rotulo} accessibilityState={{ disabled: Boolean(desligado) }} disabled={desligado} onPress={onPress} hitSlop={HIT_SLOP_PASSO} style={({ pressed }) => [s.passo, desligado && s.passoDesligado, pressed && { opacity: 0.6 }]}>
      <Icon name={icone} size={16} color={desligado ? colors.ink3 : colors.ink} strokeWidth={2.2} />
    </Pressable>
  );
}

function fmtPct(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: n % 1 === 0 ? 0 : 1, maximumFractionDigits: 2 });
}

/** Percentual com − e + de 48 dp e digitação direta. O que está digitado vale a cada número válido (V2). */
export function CampoPct({ valor, onChange, rotulo, testID, maximo }: { valor: number; onChange: (n: number) => void; rotulo: string; testID: string; maximo?: number }) {
  const teto = maximo ?? 100;
  const [texto, setTexto] = useState(fmtPct(valor));
  const focado = useRef(false);
  useEffect(() => setTexto((atual) => textoAposMudancaDoValor({ texto: atual, valor, focado: focado.current, pendente: (x) => valorPendentePct(x, teto), formatar: fmtPct })), [valor, teto]);
  const aplicar = (n: number) => onChange(Math.min(teto, limitarDesconto(n)));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Passo icone="minus" rotulo={`Diminuir ${rotulo}`} desligado={valor <= 0} onPress={() => aplicar(valor - PASSO_DESCONTO_PCT)} testID={`${testID}-menos`} />
      <View style={s.pctBox}>
        <TextInput
          testID={testID}
          value={texto}
          onChangeText={(v) => {
            setTexto(v);
            const n = valorPendentePct(v, teto);
            if (n !== null && n !== valor) onChange(n);
          }}
          onFocus={() => {
            focado.current = true;
          }}
          onBlur={() => {
            focado.current = false;
            const n = valorPendentePct(texto, teto) ?? 0;
            setTexto(fmtPct(n));
            if (n !== valor) onChange(n);
          }}
          keyboardType="decimal-pad"
          returnKeyType="done"
          accessibilityLabel={`${rotulo} em porcentagem`}
          style={s.pctInput}
          selectTextOnFocus
        />
        <Text style={s.pctSufixo}>%</Text>
      </View>
      <Passo icone="plus" rotulo={`Aumentar ${rotulo}`} onPress={() => aplicar(valor + PASSO_DESCONTO_PCT)} testID={`${testID}-mais`} />
    </View>
  );
}

/** Valor em R$ (centavos) com − e + de 48 dp e digitação direta. `maximo` em centavos (o desconto não passa do preço). Vale a cada número válido (V2). */
export function CampoReais({ valor, onChange, rotulo, testID, maximo, passo = 10 }: { valor: number; onChange: (cents: number) => void; rotulo: string; testID: string; maximo?: number; passo?: number }) {
  const [texto, setTexto] = useState(centsParaCampo(valor));
  const focado = useRef(false);
  useEffect(() => setTexto((atual) => textoAposMudancaDoValor({ texto: atual, valor, focado: focado.current, pendente: (x) => valorPendenteReais(x, maximo), formatar: centsParaCampo })), [valor, maximo]);
  const aplicar = (c: number) => onChange(Math.max(0, maximo === undefined ? c : Math.min(maximo, c)));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Passo icone="minus" rotulo={`Diminuir ${rotulo}`} desligado={valor <= 0} onPress={() => aplicar(valor - passo)} testID={`${testID}-menos`} />
      <View style={s.pctBox}>
        <Text style={s.reaisPrefixo}>R$</Text>
        <TextInput
          testID={testID}
          value={texto}
          onChangeText={(v) => {
            setTexto(v);
            const n = valorPendenteReais(v, maximo);
            if (n !== null && n !== valor) onChange(n);
          }}
          onFocus={() => {
            focado.current = true;
          }}
          onBlur={() => {
            focado.current = false;
            const n = valorPendenteReais(texto, maximo) ?? 0;
            setTexto(centsParaCampo(n));
            if (n !== valor) onChange(n);
          }}
          keyboardType="decimal-pad"
          returnKeyType="done"
          accessibilityLabel={`${rotulo} em reais`}
          style={s.pctInput}
          selectTextOnFocus
        />
      </View>
      <Passo icone="plus" rotulo={`Aumentar ${rotulo}`} desligado={maximo !== undefined && valor >= maximo} onPress={() => aplicar(valor + passo)} testID={`${testID}-mais`} />
    </View>
  );
}

// ---------- aba Itens ----------
export interface PropsAbaItens {
  rascunho: Rascunho;
  catalogo: readonly Product[];
  resultados: readonly Product[] | null;
  unidades: readonly UnidadeDaTela[];
  calculo: CalculoPedido;
  onLinhas: (lines: Record<string, number>, ajustes: Record<string, Ajuste>) => void;
  somenteLeitura?: boolean;
}

export function ListaDeItens({ produtos, rascunho, unidades, calculo, onLinhas, somenteLeitura, aoTrocarMedida, serveEm }: { produtos: readonly Product[]; aoTrocarMedida?: (texto: string, desfazer: () => void) => void; /** T-0084 C9: trecho "Serve em" por produto (busca do Catálogo) */ serveEm?: ReadonlyMap<string, TrechoServeEm> } & Omit<PropsAbaItens, 'catalogo' | 'resultados'>) {
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
  // V4: a troca da medida leva a quantidade para a outra linha do produto; o aviso do rodapé desfaz
  const trocarMedida = (tr: { de: string; para: string; rotuloPara: string; voltar: () => void }) => {
    const antes = { lines: rascunho.lines, ajustes };
    const r = trocarMedidaDaLinha(rascunho.lines, ajustes, tr.de, tr.para);
    onLinhas(r.lines, r.ajustes);
    aoTrocarMedida?.(`Medida trocada para ${tr.rotuloPara}`, () => {
      onLinhas(antes.lines, antes.ajustes);
      tr.voltar();
    });
  };
  return (
    <Card>
      {produtos.map((p, i) => (
        <LinhaDoProduto key={p.id} p={p} serveEm={serveEm?.get(p.id) ?? null} medidas={unidadesDoProduto(p.id, unidades, p.unit)} lines={rascunho.lines} ajustes={ajustes} calculo={calculo} ultimo={i === produtos.length - 1} onQtd={setQtd} onAjuste={setAjuste} onTrocarMedida={trocarMedida} somenteLeitura={somenteLeitura} />
      ))}
    </Card>
  );
}

function LinhaDoProduto({
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
  const semPreco = p.price_cents === null;
  const chaves = medidas.map((m, idx) => chaveDaLinha(p.id, idx === 0 ? null : m.unidade));
  const rotulos = medidas.map((m) => rotuloMedida(m.unidade, m.fator));
  const qtds = chaves.map((ch) => lines[ch] ?? 0);
  const [escolhida, setEscolhida] = useState<number | null>(null);
  const visiveis = medidasVisiveis(qtds, escolhida);
  const unica = visiveis.length === 1 ? visiveis[0]! : null;
  const idxComQtd = qtds.findIndex((q) => q > 0);
  // a medida em uso (a que tem quantidade) vira a escolhida: se a quantidade zerar, a linha não volta para a principal
  useEffect(() => {
    if (unica !== null && idxComQtd >= 0) setEscolhida(unica);
  }, [unica, idxComQtd]);
  const kDe = (idx: number) => p.erp_code + (medidas.length > 1 ? `-${rotulos[idx]!.split(' ')[0]}` : '');
  const chipDe = (idx: number, tocavel: boolean) => {
    const prox = proximaMedida(idx, medidas.length);
    return tocavel ? (
      <ChipMedida
        testID={`medida-${kDe(idx)}`}
        rotulo={rotulos[idx]!}
        rotuloAcessivel={`Medida ${rotulos[idx]}, tocar para trocar por ${rotulos[prox]}`}
        onPress={() => {
          setEscolhida(prox);
          if (qtds[idx]! > 0) onTrocarMedida({ de: chaves[idx]!, para: chaves[prox]!, rotuloPara: rotulos[prox]!, voltar: () => setEscolhida(idx) });
        }}
      />
    ) : (
      <ChipMedida testID={`medida-${kDe(idx)}`} rotulo={rotulos[idx]!} />
    );
  };
  const tocavel = medidas.length > 1 && unica !== null && !somenteLeitura;
  return (
    <View style={[s.produto, !ultimo && s.divisor]} testID={`product-${p.erp_code}`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <Text style={t.mono}>{p.erp_code}</Text>
          <Text style={t.bodyStrong}>{p.description}</Text>
          {serveEm ? <ServeEm trecho={serveEm} codigo={p.erp_code} /> : p.applications ? <Text style={t.small} numberOfLines={2}>{p.applications}</Text> : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          {unica !== null ? chipDe(unica, tocavel) : null}
          {p.is_campaign ? <Badge label="Campanha" tone="accent" /> : null}
        </View>
      </View>
      {semPreco ? (
        <Text style={[t.smallStrong, { color: colors.danger }]} testID={`sem-preco-${p.erp_code}`}>
          Sem preço para este cliente
        </Text>
      ) : null}
      {visiveis.map((idx) => {
        const m = medidas[idx]!;
        const chave = chaves[idx]!;
        const linha = calculo.linhas.find((l) => l.chave === chave);
        const precoMedida = semPreco ? null : (p.price_cents ?? 0) * m.fator;
        return (
          <MedidaDoItem
            key={chave}
            p={p}
            rotulo={rotulos[idx]!}
            chip={unica === null ? chipDe(idx, false) : null}
            preco={precoMedida}
            qtd={qtds[idx]!}
            linha={linha ?? null}
            totalLinha={linha?.total_cents ?? null}
            ajuste={ajustes[chave] ?? {}}
            onQtd={(q) => onQtd(chave, q)}
            onAjuste={(aj) => onAjuste(chave, { ...aj, ...(ajustes[chave]?.aplicacao_marcada !== undefined ? { aplicacao_marcada: ajustes[chave]!.aplicacao_marcada } : {}), ...(ajustes[chave]?.aplicacao_retrato ? { aplicacao_retrato: ajustes[chave]!.aplicacao_retrato } : {}) })}
            onAplicacao={() => onAjuste(chave, alternarAplicacao(ajustes[chave], Boolean(linha?.aplicacao_marcada)))}
            somenteLeitura={somenteLeitura}
            k={kDe(idx)}
          />
        );
      })}
    </View>
  );
}

function MedidaDoItem({
  p,
  rotulo,
  chip,
  preco,
  qtd,
  linha,
  totalLinha,
  ajuste,
  onQtd,
  onAjuste,
  onAplicacao,
  somenteLeitura,
  k,
}: {
  p: Product;
  rotulo: string;
  /** chip da medida na linha (só quando o produto tem duas medidas com quantidade; senão fica no alto do produto) */
  chip: ReactNode;
  preco: number | null;
  qtd: number;
  linha: CalculoPedido['linhas'][number] | null;
  totalLinha: number | null;
  ajuste: Ajuste;
  onQtd: (q: number) => void;
  onAjuste: (a: Ajuste) => void;
  /** T-0084 (RN-VEN-19): alterna a caixa "Incluir aplicação no orçamento" deste item */
  onAplicacao: () => void;
  somenteLeitura?: boolean;
  k: string;
}) {
  const [texto, setTexto] = useState(String(qtd));
  const focado = useRef(false);
  // o campo em foco expõe o que está digitado a Salvar/Avançar/abas/+− (o "0" só vale ao confirmar)
  const vivo = useRef({ texto, qtd, onQtd });
  vivo.current = { texto, qtd, onQtd };
  const desregistrar = useRef<(() => void) | null>(null);
  useEffect(() => () => desregistrar.current?.(), []);
  // toques seguidos somam mesmo antes da tela redesenhar: o passo parte da última quantidade pedida, não da renderizada
  const passo = (delta: number) => {
    const n = quantidadePorPasso({ texto: vivo.current.texto, focado: focado.current, qtd: vivo.current.qtd }, delta);
    vivo.current.qtd = n;
    vivo.current.onQtd(n);
  };
  const modo: 'pct' | 'valor' = ajuste.em === 'valor' ? 'valor' : 'pct';
  const sentido: 'desconto' | 'acrescimo' = modo === 'valor' ? ((ajuste.acrescimo_cents ?? 0) > 0 ? 'acrescimo' : 'desconto') : (ajuste.acrescimo_pct ?? 0) > 0 ? 'acrescimo' : 'desconto';
  const valorPct = sentido === 'acrescimo' ? (ajuste.acrescimo_pct ?? 0) : (ajuste.desconto_pct ?? 0);
  const valorCents = sentido === 'acrescimo' ? (ajuste.acrescimo_cents ?? 0) : (ajuste.desconto_cents ?? 0);
  const temAjuste = (modo === 'valor' ? valorCents : valorPct) > 0;
  const [aberto, setAberto] = useState(temAjuste);
  useEffect(() => setTexto((atual) => textoAposMudancaDoValor({ texto: atual, valor: qtd, focado: focado.current, pendente: valorPendenteQuantidade, formatar: String })), [qtd]);
  const gravar = (s2: 'desconto' | 'acrescimo', m: 'pct' | 'valor', v: number): Ajuste =>
    m === 'valor' ? { em: 'valor', ...(s2 === 'acrescimo' ? { acrescimo_cents: v } : { desconto_cents: v }) } : { em: 'pct', ...(s2 === 'acrescimo' ? { acrescimo_pct: v } : { desconto_pct: v }) };
  const tetoDesconto = sentido === 'desconto' && modo === 'valor' && preco !== null ? preco : undefined;
  const eq = linha ? textoEquivalente(linha) : '';
  const nome = `${p.description} ${rotulo}`;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {chip}
          <Text style={t.smallStrong} numberOfLines={1} testID={`preco-${k}`}>
            {preco === null ? '' : linha && qtd > 0 ? textoPrecoDaLinha(linha) : formatBRL(preco)}
          </Text>
        </View>
        {somenteLeitura ? (
          <Text style={[t.bodyStrong, { fontFamily: fonts.bold }]}>{qtd}</Text>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Passo icone="minus" rotulo={`Diminuir ${nome}`} desligado={qtd <= 0} onPress={() => passo(-1)} testID={`dec-${k}`} />
            <TextInput
              testID={`qty-${k}`}
              value={texto}
              onChangeText={(v) => {
                const limpo = v.replace(/\D/g, '');
                setTexto(limpo);
                // W1: zero ou vazio no meio da digitação não tira o item; vale ao sair do campo ou pelo −
                const n = quantidadeAoDigitar(limpo);
                if (n !== null) onQtd(n);
              }}
              onFocus={() => {
                focado.current = true;
                desregistrar.current?.();
                desregistrar.current = registrarValorPendente(() => vivo.current.onQtd(quantidadeAoConfirmar(vivo.current.texto)));
              }}
              onBlur={() => {
                focado.current = false;
                desregistrar.current?.();
                desregistrar.current = null;
                const n = quantidadeAoConfirmar(texto);
                setTexto(String(n));
                onQtd(n);
              }}
              keyboardType="number-pad"
              returnKeyType="done"
              selectTextOnFocus
              accessibilityLabel={`Quantidade de ${nome}`}
              style={s.qtd}
            />
            <Passo icone="plus" rotulo={`Aumentar ${nome}`} desligado={preco === null} onPress={() => passo(1)} testID={`inc-${k}`} />
          </View>
        )}
      </View>
      {qtd > 0 ? (
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            {somenteLeitura ? (
              <Text style={t.small}>{temAjuste ? `${sentido === 'acrescimo' ? 'Acréscimo' : 'Desconto'} ${eq}`.trim() : ''}</Text>
            ) : (
              <Pressable testID={`ajuste-${k}`} accessibilityRole="button" accessibilityLabel={`Desconto ou acréscimo do item ${nome}`} onPress={() => setAberto((a) => !a)} style={s.linkAjuste}>
                <Text style={[t.smallStrong, { color: !temAjuste ? colors.accentInk : sentido === 'acrescimo' ? colors.ink2 : colors.success }]} testID={`equivalente-${k}`}>
                  {temAjuste ? eq || (sentido === 'acrescimo' ? 'Acréscimo' : 'Desconto') : '+ desconto'}
                </Text>
              </Pressable>
            )}
            {totalLinha !== null ? (
              <Text style={[t.bodyStrong, { fontVariant: ['tabular-nums'] }]} testID={`total-${k}`}>
                {formatBRL(totalLinha)}
              </Text>
            ) : null}
          </View>
          {p.applications && !somenteLeitura ? <CaixaAplicacao testID={`aplicacao-${k}`} marcada={Boolean(linha?.aplicacao_marcada)} onPress={onAplicacao} nome={nome} /> : null}
          {aberto && !somenteLeitura ? (
            <View style={s.ajuste} testID={`ajuste-painel-${k}`}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Segmentado
                  testID={`ajuste-tipo-${k}`}
                  rotuloAcessivel="Desconto ou acréscimo do item"
                  compacto
                  style={{ flex: 1 }}
                  valor={sentido}
                  opcoes={[
                    { id: 'desconto', rotulo: 'Desc.', rotuloAcessivel: 'Desconto' },
                    { id: 'acrescimo', rotulo: 'Acrésc.', rotuloAcessivel: 'Acréscimo' },
                  ]}
                  onChange={(novo) => onAjuste(gravar(novo, modo, modo === 'valor' ? valorCents : valorPct))}
                />
                <Segmentado
                  testID={`ajuste-modo-${k}`}
                  rotuloAcessivel="Ajuste em porcentagem ou em reais"
                  compacto
                  style={{ flex: 1 }}
                  valor={modo}
                  opcoes={[
                    { id: 'pct', rotulo: '%', rotuloAcessivel: 'Porcentagem' },
                    { id: 'valor', rotulo: 'R$', rotuloAcessivel: 'Reais por unidade' },
                  ]}
                  onChange={(novo) => onAjuste(trocarModoDoAjuste(ajuste, novo, linha?.equivalente ?? null))}
                />
              </View>
              {modo === 'valor' ? (
                <CampoReais valor={valorCents} maximo={tetoDesconto} rotulo={sentido === 'acrescimo' ? 'acréscimo do item' : 'desconto do item'} testID={`ajuste-valor-${k}`} onChange={(n) => onAjuste(gravar(sentido, 'valor', n))} />
              ) : (
                <CampoPct valor={valorPct} rotulo={sentido === 'acrescimo' ? 'acréscimo do item' : 'desconto do item'} testID={`ajuste-pct-${k}`} onChange={(n) => onAjuste(gravar(sentido, 'pct', n))} />
              )}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * T-0084 (RN-VEN-19): caixa por item "Incluir aplicação no orçamento" (alvo de 48 dp). Marcada pelo padrão do tenant; vale
 * item a item. O texto sai da linha da aplicação mostrada acima (2 linhas).
 */
/** RN-CAT-12: "Serve em" com os termos da busca marcados e "inclui 2012" quando o ano casou por faixa. */
function ServeEm({ trecho, codigo }: { trecho: TrechoServeEm; codigo: string }) {
  const partes = partirTrecho(trecho.texto, trecho.marcas);
  return (
    <Text style={t.small} numberOfLines={2} testID={`serve-em-${codigo}`}>
      Serve em: {partes.map((x, i) => (x.marcado ? <Text key={i} style={t.smallStrong}>{x.texto}</Text> : x.texto))}
      {trecho.inclui_ano ? ` · inclui ${trecho.inclui_ano}` : ''}
    </Text>
  );
}

export function CaixaAplicacao({ marcada, onPress, nome, testID }: { marcada: boolean; onPress: () => void; nome: string; testID: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityLabel={`Incluir aplicação no orçamento: ${nome}`}
      accessibilityState={{ checked: marcada }}
      onPress={onPress}
      style={({ pressed }) => [s.caixaAplicacao, pressed && { opacity: 0.6 }]}>
      <View style={[s.caixa, marcada && s.caixaMarcada]}>{marcada ? <Icon name="check" size={16} color={colors.surface} strokeWidth={2.6} /> : null}</View>
      <Text style={t.small}>Incluir aplicação no orçamento</Text>
    </Pressable>
  );
}

/** Aviso do que falta (aparece acima do rodapé quando o botão está desligado por regra). */
export function PendenciasDoPedido({ erros, freteAviso, onIrPara }: { erros: string[]; freteAviso: string | null; onIrPara: () => void }) {
  if (erros.length === 0 && !freteAviso) return null;
  return (
    <View style={{ gap: 8 }} testID="pendencias-pedido">
      <Banner icon="alert" tone="danger">
        {erros.length > 0 ? <Text>{erros.join(' ')} </Text> : null}
        {freteAviso ? <Text>{freteAviso}</Text> : null}
      </Banner>
      {freteAviso ? <Botao testID="pendencia-corrigir-frete" nivel="neutro" rotulo="Corrigir frete" onPress={onIrPara} /> : null}
    </View>
  );
}

export { alternarUnidade };

const s = StyleSheet.create({
  divisor: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  produto: { gap: 8, paddingVertical: 12, paddingHorizontal: 14 },
  passoDesligado: { backgroundColor: colors.ground, borderColor: colors.line },
  passo: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  qtd: { width: 52, height: 48, textAlign: 'center', fontFamily: fonts.bold, fontSize: 16, color: colors.ink, fontVariant: ['tabular-nums'], padding: 0 },
  caixaAplicacao: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 },
  caixa: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, borderColor: colors.lineStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  caixaMarcada: { backgroundColor: colors.accentInk, borderColor: colors.accentInk },
  linkAjuste: { minHeight: 48, justifyContent: 'center', paddingRight: 8 },
  ajuste: { gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: colors.ground },
  pctBox: { flex: 1, height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  pctInput: { flex: 1, minWidth: 0, height: 46, textAlign: 'right', fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink, padding: 0 },
  reaisPrefixo: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink2, marginRight: 4 },
  pctSufixo: { flex: 1, fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink2, marginLeft: 2 },
});
