/**
 * Peças do novo pedido de distribuidora em 3 abas (T-0061): Itens, Condições e Entrega/Resumo. Componentes locais do Vendedor
 * (se o engenheiro-apps promover algum para `packages/ui`, trocamos). Alvos de toque ≥ 48 dp; só lê e escreve o rascunho
 * do aparelho (offline-first). O cálculo e as regras vêm de `lib/novo-pedido.ts` (domain de preço), nada é calculado aqui.
 */
import { formatBRL, formatPct } from '@macuxi/comum';
import type { Product } from '@macuxi/catalogo/contracts';
import { Badge, Banner, Card, colors, fonts, Icon, radius, Strong, type as t } from '@macuxi/ui/mobile';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { limitarDesconto, PASSO_DESCONTO_PCT } from '../../domain/quantidade';
import { rotuloMedida } from '../../domain/preco-pedido';
import type { Rascunho } from '../lib/pedidos';
import {
  alternarUnidade,
  chaveDaLinha,
  enderecosDoCliente,
  freteValido,
  rotuloDoFrete,
  textoDaAlcada,
  textoDoEndereco,
  transportadorasAtivas,
  unidadesDoProduto,
  type Ajuste,
  type CalculoPedido,
  type EnderecoDaTela,
  type FreteDoRascunho,
  type TransportadoraDaTela,
  type UnidadeDaTela,
} from '../lib/novo-pedido';
import { parsePct } from '../lib/catalog';

export type AbaDoPedido = 'itens' | 'condicoes' | 'entrega';
const ABAS: Array<{ id: AbaDoPedido; rotulo: string }> = [
  { id: 'itens', rotulo: 'Itens' },
  { id: 'condicoes', rotulo: 'Condições' },
  { id: 'entrega', rotulo: 'Entrega e resumo' },
];

/** Barra de abas fixa no alto; a aba Itens mostra a contagem. */
export function BarraDeAbas({ aba, onAba, itens, pendencias }: { aba: AbaDoPedido; onAba: (a: AbaDoPedido) => void; itens: number; pendencias: Partial<Record<AbaDoPedido, boolean>> }) {
  return (
    <View style={s.abas} accessibilityRole="tablist" testID="abas-pedido">
      {ABAS.map((a) => {
        const on = aba === a.id;
        return (
          <Pressable key={a.id} testID={`aba-${a.id}`} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onAba(a.id)} style={[s.aba, on && s.abaOn]}>
            <Text style={[s.abaTexto, on && { color: colors.ink }]} numberOfLines={1}>
              {a.rotulo}
              {a.id === 'itens' && itens > 0 ? ` (${itens})` : ''}
            </Text>
            {pendencias[a.id] ? <View style={s.ponto} accessibilityLabel="Pendência nesta aba" /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------- campos ----------
function Passo({ icone, rotulo, onPress, desligado, testID }: { icone: 'plus' | 'minus'; rotulo: string; onPress: () => void; desligado?: boolean; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={rotulo} disabled={desligado} onPress={onPress} style={({ pressed }) => [s.passo, desligado && { opacity: 0.4 }, pressed && { opacity: 0.6 }]}>
      <Icon name={icone} size={16} color={colors.ink} strokeWidth={2.2} />
    </Pressable>
  );
}

function fmtPct(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: n % 1 === 0 ? 0 : 1, maximumFractionDigits: 2 });
}

/** Percentual com − e + de 48 dp e digitação direta. */
export function CampoPct({ valor, onChange, rotulo, testID, maximo }: { valor: number; onChange: (n: number) => void; rotulo: string; testID: string; maximo?: number }) {
  const [texto, setTexto] = useState(fmtPct(valor));
  useEffect(() => setTexto(fmtPct(valor)), [valor]);
  const aplicar = (n: number) => onChange(Math.min(maximo ?? 100, limitarDesconto(n)));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Passo icone="minus" rotulo={`Diminuir ${rotulo}`} desligado={valor <= 0} onPress={() => aplicar(valor - PASSO_DESCONTO_PCT)} testID={`${testID}-menos`} />
      <View style={s.pctBox}>
        <TextInput
          testID={testID}
          value={texto}
          onChangeText={setTexto}
          onBlur={() => aplicar(parsePct(texto))}
          onSubmitEditing={() => aplicar(parsePct(texto))}
          keyboardType="decimal-pad"
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

export function Segmentos<T extends string>({ opcoes, valor, onChange, testID }: { opcoes: Array<{ id: T; rotulo: string }>; valor: T; onChange: (id: T) => void; testID: string }) {
  return (
    <View style={s.segmento}>
      {opcoes.map((o) => {
        const on = o.id === valor;
        return (
          <Pressable key={o.id} testID={`${testID}-${o.id}`} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => onChange(o.id)} style={[s.segItem, on && s.segOn]}>
            <Text style={[s.segTexto, on && { color: colors.surface }]}>{o.rotulo}</Text>
          </Pressable>
        );
      })}
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

export function ListaDeItens({ produtos, rascunho, unidades, calculo, onLinhas, somenteLeitura }: { produtos: readonly Product[] } & Omit<PropsAbaItens, 'catalogo' | 'resultados'>) {
  const ajustes = rascunho.ajustes ?? {};
  const setQtd = (chave: string, q: number) => {
    const n = Math.max(0, Math.trunc(q));
    const lines = { ...rascunho.lines };
    if (n > 0) lines[chave] = n;
    else delete lines[chave];
    const novos = { ...ajustes };
    if (n === 0) delete novos[chave];
    onLinhas(lines, novos);
  };
  const setAjuste = (chave: string, aj: Ajuste) => onLinhas(rascunho.lines, { ...ajustes, [chave]: aj });
  return (
    <Card>
      {produtos.map((p, i) => (
        <LinhaDoProduto key={p.id} p={p} medidas={unidadesDoProduto(p.id, unidades, p.unit)} lines={rascunho.lines} ajustes={ajustes} calculo={calculo} ultimo={i === produtos.length - 1} onQtd={setQtd} onAjuste={setAjuste} somenteLeitura={somenteLeitura} />
      ))}
    </Card>
  );
}

function LinhaDoProduto({
  p,
  medidas,
  lines,
  ajustes,
  calculo,
  ultimo,
  onQtd,
  onAjuste,
  somenteLeitura,
}: {
  p: Product;
  medidas: UnidadeDaTela[];
  lines: Record<string, number>;
  ajustes: Record<string, Ajuste>;
  calculo: CalculoPedido;
  ultimo: boolean;
  onQtd: (chave: string, q: number) => void;
  onAjuste: (chave: string, a: Ajuste) => void;
  somenteLeitura?: boolean;
}) {
  const semPreco = p.price_cents === null;
  return (
    <View style={[s.produto, !ultimo && s.divisor]} testID={`product-${p.erp_code}`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <Text style={t.mono}>{p.erp_code}</Text>
          <Text style={t.bodyStrong}>{p.description}</Text>
          {p.applications ? <Text style={t.small}>{p.applications}</Text> : null}
        </View>
        {p.is_campaign ? <Badge label="Campanha" tone="accent" /> : null}
      </View>
      {semPreco ? (
        <Text style={[t.smallStrong, { color: colors.danger }]} testID={`sem-preco-${p.erp_code}`}>
          Sem preço para este cliente
        </Text>
      ) : null}
      {medidas.map((m, idx) => {
        const chave = chaveDaLinha(p.id, idx === 0 ? null : m.unidade);
        const qtd = lines[chave] ?? 0;
        const linha = calculo.linhas.find((l) => l.chave === chave);
        const precoMedida = semPreco ? null : (p.price_cents ?? 0) * m.fator;
        return (
          <MedidaDoItem
            key={chave}
            p={p}
            rotulo={rotuloMedida(m.unidade, m.fator)}
            preco={precoMedida}
            qtd={qtd}
            totalLinha={linha?.total_cents ?? null}
            ajuste={ajustes[chave] ?? {}}
            onQtd={(q) => onQtd(chave, q)}
            onAjuste={(a) => onAjuste(chave, a)}
            somenteLeitura={somenteLeitura}
            comRotulo={medidas.length > 1}
          />
        );
      })}
    </View>
  );
}

function MedidaDoItem({ p, rotulo, preco, qtd, totalLinha, ajuste, onQtd, onAjuste, somenteLeitura, comRotulo }: { p: Product; rotulo: string; preco: number | null; qtd: number; totalLinha: number | null; ajuste: Ajuste; onQtd: (q: number) => void; onAjuste: (a: Ajuste) => void; somenteLeitura?: boolean; comRotulo: boolean }) {
  const [texto, setTexto] = useState(String(qtd));
  const [aberto, setAberto] = useState(Boolean((ajuste.desconto_pct ?? 0) > 0 || (ajuste.acrescimo_pct ?? 0) > 0));
  useEffect(() => setTexto(String(qtd)), [qtd]);
  const tipo: 'desconto' | 'acrescimo' = (ajuste.acrescimo_pct ?? 0) > 0 ? 'acrescimo' : 'desconto';
  const valor = tipo === 'acrescimo' ? (ajuste.acrescimo_pct ?? 0) : (ajuste.desconto_pct ?? 0);
  const k = p.erp_code + (comRotulo ? `-${rotulo.split(' ')[0]}` : '');
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={t.smallStrong} numberOfLines={1}>
            {comRotulo ? rotulo : 'Quantidade'}
            {preco !== null ? ` · ${formatBRL(preco)}` : ''}
          </Text>
        </View>
        {somenteLeitura ? (
          <Text style={[t.bodyStrong, { fontFamily: fonts.bold }]}>{qtd}</Text>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Passo icone="minus" rotulo={`Diminuir ${p.description} ${rotulo}`} desligado={qtd <= 0} onPress={() => onQtd(qtd - 1)} testID={`dec-${k}`} />
            <TextInput
              testID={`qty-${k}`}
              value={texto}
              onChangeText={(v) => setTexto(v.replace(/\D/g, ''))}
              onBlur={() => onQtd(Number(texto || 0))}
              onSubmitEditing={() => onQtd(Number(texto || 0))}
              keyboardType="number-pad"
              selectTextOnFocus
              accessibilityLabel={`Quantidade de ${p.description} em ${rotulo}`}
              style={s.qtd}
            />
            <Passo icone="plus" rotulo={`Aumentar ${p.description} ${rotulo}`} desligado={preco === null} onPress={() => onQtd(qtd + 1)} testID={`inc-${k}`} />
          </View>
        )}
      </View>
      {qtd > 0 ? (
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            {somenteLeitura ? (
              <Text style={t.small}>{valor > 0 ? `${tipo === 'acrescimo' ? 'Acréscimo' : 'Desconto'} de ${formatPct(valor)}` : ''}</Text>
            ) : (
              <Pressable testID={`ajuste-${k}`} accessibilityRole="button" accessibilityLabel={`Desconto ou acréscimo do item ${p.description}`} onPress={() => setAberto((a) => !a)} style={s.linkAjuste}>
                <Text style={[t.smallStrong, { color: colors.accentInk }]}>{valor > 0 ? `${tipo === 'acrescimo' ? 'Acréscimo' : 'Desconto'} ${formatPct(valor)}` : 'Desconto ou acréscimo'}</Text>
              </Pressable>
            )}
            {totalLinha !== null ? <Text style={[t.bodyStrong, { fontVariant: ['tabular-nums'] }]}>{formatBRL(totalLinha)}</Text> : null}
          </View>
          {aberto && !somenteLeitura ? (
            <View style={s.ajuste} testID={`ajuste-painel-${k}`}>
              <Segmentos
                testID={`ajuste-tipo-${k}`}
                valor={tipo}
                opcoes={[
                  { id: 'desconto', rotulo: 'Desconto' },
                  { id: 'acrescimo', rotulo: 'Acréscimo' },
                ]}
                onChange={(novo) => onAjuste(novo === 'acrescimo' ? { acrescimo_pct: valor } : { desconto_pct: valor })}
              />
              <CampoPct valor={valor} rotulo={tipo === 'acrescimo' ? 'acréscimo do item' : 'desconto do item'} testID={`ajuste-pct-${k}`} onChange={(n) => onAjuste(tipo === 'acrescimo' ? { acrescimo_pct: n } : { desconto_pct: n })} />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// ---------- aba Condições ----------
export interface PropsAbaCondicoes {
  rascunho: Rascunho;
  prazos: Array<{ id: string | null; rotulo: string }>;
  transportadoras: readonly TransportadoraDaTela[];
  calculo: CalculoPedido;
  limiteVendedor: number;
  preVendaLigada: boolean;
  edicao: boolean;
  onRascunho: (fn: (r: Rascunho) => Rascunho) => void;
  /** frete padrão do tenant (parâmetro `frete.modalidade_padrao`), usado quando o rascunho ainda não escolheu */
  fretePadrao: 'CIF' | 'FOB';
}

export function AbaCondicoes(p: PropsAbaCondicoes) {
  const { rascunho: r, onRascunho } = p;
  const frete: FreteDoRascunho = r.frete ?? { modalidade: p.fretePadrao };
  const ativas = transportadorasAtivas(p.transportadoras);
  const digitando = frete.modalidade === 'FOB' && !frete.transportadora_id && frete.transportadora_digitada != null;
  const tipoPedido: 'desconto' | 'acrescimo' = (r.acrescimo_pct ?? 0) > 0 ? 'acrescimo' : 'desconto';
  const valorPedido = tipoPedido === 'acrescimo' ? (r.acrescimo_pct ?? 0) : r.discount_pct;
  const setFrete = (f: FreteDoRascunho) => onRascunho((d) => ({ ...d, frete: f }));
  const alcada = textoDaAlcada(p.calculo, p.limiteVendedor);
  const msgFrete = freteValido(frete);
  return (
    <View style={{ gap: 12 }} testID="aba-condicoes-conteudo">
      <Card style={{ padding: 14, gap: 14 }}>
        <View style={{ gap: 8 }}>
          <Text style={t.label}>Desconto ou acréscimo do pedido</Text>
          <Segmentos
            testID="pedido-ajuste-tipo"
            valor={tipoPedido}
            opcoes={[
              { id: 'desconto', rotulo: 'Desconto' },
              { id: 'acrescimo', rotulo: 'Acréscimo' },
            ]}
            onChange={(novo) => onRascunho((d) => (novo === 'acrescimo' ? { ...d, discount_pct: 0, acrescimo_pct: valorPedido } : { ...d, acrescimo_pct: 0, discount_pct: valorPedido }))}
          />
          <CampoPct
            valor={valorPedido}
            rotulo={tipoPedido === 'acrescimo' ? 'acréscimo do pedido' : 'desconto do pedido'}
            testID="discount-input"
            onChange={(n) => onRascunho((d) => (tipoPedido === 'acrescimo' ? { ...d, discount_pct: 0, acrescimo_pct: n } : { ...d, acrescimo_pct: 0, discount_pct: n }))}
          />
          <Text style={[t.smallStrong, { color: alcada.tom === 'erro' ? colors.danger : alcada.tom === 'aviso' ? colors.accentInk : alcada.tom === 'ok' ? colors.success : colors.ink2 }]} testID="discount-line">
            {alcada.texto}
          </Text>
          <Text style={t.small}>A alçada olha o desconto efetivo do pedido inteiro (itens e pedido juntos, sem frete).</Text>
        </View>
        <View style={{ gap: 8 }}>
          <Text style={t.label}>Prazo</Text>
          <View style={s.segmento}>
            {p.prazos.map((op) => {
              const on = op.id ? r.condicao_pagamento_id === op.id : r.payment_terms === op.rotulo;
              return (
                <Pressable key={op.id ?? op.rotulo} testID={`terms-${op.rotulo}`} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => onRascunho((d) => ({ ...d, payment_terms: op.rotulo, condicao_pagamento_id: op.id }))} style={[s.segItem, on && s.segOn]}>
                  <Text style={[s.segTexto, on && { color: colors.surface }]}>{op.rotulo}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        {p.preVendaLigada && !p.edicao ? (
          <View style={{ gap: 8 }} testID="order-tipo">
            <Text style={t.label}>Tipo</Text>
            <Segmentos
              testID="tipo"
              valor={r.tipo ?? 'pedido'}
              opcoes={[
                { id: 'pedido', rotulo: 'Pedido' },
                { id: 'orcamento', rotulo: 'Orçamento' },
              ]}
              onChange={(tp) => onRascunho((d) => ({ ...d, tipo: tp }))}
            />
            {r.tipo === 'orcamento' ? <Text style={t.small}>Orçamento não vai para aprovação nem para o ERP, não reserva estoque e vale pelo prazo da empresa (padrão 7 dias). Converta em pedido quando o cliente fechar.</Text> : null}
          </View>
        ) : null}
      </Card>

      <Card style={{ padding: 14, gap: 12 }} testID="frete-card">
        <Text style={t.label}>Frete</Text>
        <Segmentos
          testID="frete"
          valor={frete.modalidade}
          opcoes={[
            { id: 'CIF', rotulo: 'CIF · empresa paga' },
            { id: 'FOB', rotulo: 'FOB · cliente paga' },
          ]}
          onChange={(m) => setFrete(m === 'CIF' ? { modalidade: 'CIF' } : { modalidade: 'FOB', transportadora_id: frete.transportadora_id ?? null, transportadora_digitada: frete.transportadora_digitada ?? null })}
        />
        {frete.modalidade === 'CIF' ? (
          <Text style={t.small}>O frete está no preço. O pedido não leva valor de frete nem transportadora.</Text>
        ) : (
          <View style={{ gap: 8 }}>
            <Text style={t.small}>O cliente paga o frete direto à transportadora. Escolha da lista ou informe uma nova.</Text>
            {ativas.map((tr) => {
              const on = frete.transportadora_id === tr.id;
              return (
                <Pressable key={tr.id} testID={`transp-${tr.nome}`} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => setFrete({ modalidade: 'FOB', transportadora_id: tr.id, transportadora_digitada: null })} style={[s.opcao, on && s.opcaoOn]}>
                  <View style={{ flex: 1 }}>
                    <Text style={t.bodyStrong}>{tr.nome}</Text>
                    {tr.documento ? <Text style={t.small}>CNPJ {tr.documento}</Text> : null}
                  </View>
                  {on ? <Icon name="check" size={18} color={colors.success} strokeWidth={2.4} /> : null}
                </Pressable>
              );
            })}
            <Pressable testID="transp-outra" accessibilityRole="radio" accessibilityState={{ checked: digitando }} onPress={() => setFrete({ modalidade: 'FOB', transportadora_id: null, transportadora_digitada: frete.transportadora_digitada ?? { nome: '', cnpj: '', telefone: '' } })} style={[s.opcao, digitando && s.opcaoOn]}>
              <Text style={[t.bodyStrong, { flex: 1 }]}>Outra transportadora (digitar)</Text>
              {digitando ? <Icon name="check" size={18} color={colors.success} strokeWidth={2.4} /> : null}
            </Pressable>
            {digitando && frete.transportadora_digitada ? (
              <View style={{ gap: 8 }} testID="transp-digitada">
                <CampoTexto rotulo="Nome da transportadora" valor={frete.transportadora_digitada.nome} testID="transp-nome" onChange={(v) => setFrete({ ...frete, transportadora_digitada: { ...frete.transportadora_digitada!, nome: v } })} />
                <CampoTexto rotulo="CNPJ (14 dígitos)" valor={frete.transportadora_digitada.cnpj} testID="transp-cnpj" teclado="number-pad" onChange={(v) => setFrete({ ...frete, transportadora_digitada: { ...frete.transportadora_digitada!, cnpj: v.replace(/\D/g, '').slice(0, 14) } })} />
                <CampoTexto rotulo="Telefone (opcional)" valor={frete.transportadora_digitada.telefone ?? ''} testID="transp-telefone" teclado="phone-pad" onChange={(v) => setFrete({ ...frete, transportadora_digitada: { ...frete.transportadora_digitada!, telefone: v } })} />
              </View>
            ) : null}
            {msgFrete ? (
              <Text style={[t.smallStrong, { color: colors.danger }]} testID="frete-aviso">
                {msgFrete}
              </Text>
            ) : null}
          </View>
        )}
      </Card>

      <Card style={{ padding: 14, gap: 8 }}>
        <Text style={t.label}>Observação (opcional)</Text>
        <TextInput
          testID="observacao"
          value={r.observacao ?? ''}
          onChangeText={(v) => onRascunho((d) => ({ ...d, observacao: v.slice(0, 500) }))}
          placeholder="Ex.: entregar pela manhã"
          placeholderTextColor={colors.ink3}
          multiline
          accessibilityLabel="Observação do pedido"
          style={[s.texto, { minHeight: 72, textAlignVertical: 'top', paddingTop: 10 }]}
        />
      </Card>
    </View>
  );
}

function CampoTexto({ rotulo, valor, onChange, testID, teclado }: { rotulo: string; valor: string; onChange: (v: string) => void; testID: string; teclado?: 'number-pad' | 'phone-pad' }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={t.smallStrong}>{rotulo}</Text>
      <TextInput testID={testID} value={valor} onChangeText={onChange} keyboardType={teclado} accessibilityLabel={rotulo} style={s.texto} autoCorrect={false} />
    </View>
  );
}

// ---------- aba Entrega e resumo ----------
export interface PropsAbaEntrega {
  rascunho: Rascunho;
  clienteId: string;
  enderecos: readonly EnderecoDaTela[];
  transportadoras: readonly TransportadoraDaTela[];
  calculo: CalculoPedido;
  limiteVendedor: number;
  fretePadrao: 'CIF' | 'FOB';
  prazo: string;
  onRascunho: (fn: (r: Rascunho) => Rascunho) => void;
  somenteLeitura?: boolean;
  /** descrição dos produtos por id, para o resumo */
  nomes: ReadonlyMap<string, string>;
}

export function AbaEntrega(p: PropsAbaEntrega) {
  const lista = enderecosDoCliente(p.enderecos, p.clienteId);
  const principal = lista.find((e) => e.principal || e.tipo === 'principal') ?? null;
  const escolhido = p.rascunho.endereco_entrega_id ? (lista.find((e) => e.id === p.rascunho.endereco_entrega_id) ?? null) : principal;
  const frete = p.rascunho.frete ?? { modalidade: p.fretePadrao };
  return (
    <View style={{ gap: 12 }} testID="aba-entrega-conteudo">
      <Card style={{ padding: 14, gap: 8 }}>
        <Text style={t.label}>Endereço de entrega</Text>
        {lista.length === 0 ? (
          <Text style={t.small} testID="sem-endereco">
            Este cliente não tem endereço de entrega sincronizado. O pedido segue com o endereço do cadastro do cliente no ERP.
          </Text>
        ) : (
          lista.map((e) => {
            const on = escolhido?.id === e.id;
            const ehPrincipal = e.principal || e.tipo === 'principal';
            return (
              <Pressable key={e.id} testID={`endereco-${e.id}`} accessibilityRole="radio" accessibilityState={{ checked: on }} disabled={p.somenteLeitura} onPress={() => p.onRascunho((d) => ({ ...d, endereco_entrega_id: ehPrincipal ? null : e.id }))} style={[s.opcao, on && s.opcaoOn]}>
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={t.bodyStrong}>
                    {e.descricao || (ehPrincipal ? 'Endereço principal' : 'Entrega')}
                    {ehPrincipal ? ' · padrão' : ''}
                  </Text>
                  <Text style={t.small}>{textoDoEndereco(e)}</Text>
                </View>
                {on ? <Icon name="check" size={18} color={colors.success} strokeWidth={2.4} /> : null}
              </Pressable>
            );
          })
        )}
        <Text style={t.small}>Endereço novo entra pelo cadastro no ERP.</Text>
      </Card>

      <Card style={{ padding: 14, gap: 6 }} testID="resumo-pedido">
        <Text style={t.label}>Resumo</Text>
        {p.calculo.linhas.length === 0 ? <Text style={t.small}>Nenhum item ainda.</Text> : null}
        {p.calculo.linhas.map((l) => (
          <View key={l.chave} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text style={[t.small, { flex: 1 }]} numberOfLines={2}>
              {l.quantity} {l.unidade ? rotuloMedida(l.unidade_sigla, l.fator) : l.unidade_sigla} · {p.nomes.get(l.product_id) ?? ''}
              {l.desconto_pct > 0 ? ` · desc. ${formatPct(l.desconto_pct)}` : l.acrescimo_pct > 0 ? ` · acrésc. ${formatPct(l.acrescimo_pct)}` : ''}
            </Text>
            <Text style={[t.small, { fontVariant: ['tabular-nums'] }]}>{formatBRL(l.total_cents)}</Text>
          </View>
        ))}
        <Linha rotulo="Total pela tabela" valor={formatBRL(p.calculo.total_tabela_cents)} />
        {p.calculo.desconto_cents > 0 ? <Linha rotulo="Descontos" valor={`− ${formatBRL(p.calculo.desconto_cents)}`} /> : null}
        {p.calculo.total_cents > p.calculo.total_tabela_cents ? <Linha rotulo="Acréscimos" valor={`+ ${formatBRL(p.calculo.total_cents - p.calculo.total_tabela_cents)}`} /> : null}
        <Linha rotulo="Desconto efetivo" valor={formatPct(p.calculo.desconto_efetivo_pct)} />
        <Linha rotulo="Frete" valor={rotuloDoFrete(frete, p.transportadoras)} />
        <Linha rotulo="Prazo" valor={p.prazo} />
        <Linha rotulo="Entrega em" valor={escolhido ? textoDoEndereco(escolhido) : 'Endereço do cadastro'} />
        <Text style={[t.small, { marginTop: 4 }]}>O frete não tem valor no pedido: o cliente paga direto à transportadora (FOB) ou já está no preço (CIF).</Text>
      </Card>
    </View>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
      <Text style={t.small}>{rotulo}</Text>
      <Text style={[t.smallStrong, { flexShrink: 1, textAlign: 'right' }]}>{valor}</Text>
    </View>
  );
}

/** Aviso do que falta (aparece acima do rodapé quando o botão está desligado por regra). */
export function PendenciasDoPedido({ erros, freteAviso, onIrPara }: { erros: string[]; freteAviso: string | null; onIrPara: (a: AbaDoPedido) => void }) {
  if (erros.length === 0 && !freteAviso) return null;
  return (
    <Banner icon="alert" tone="danger" testID="pendencias-pedido">
      {erros.length > 0 ? <Text>{erros.join(' ')} </Text> : null}
      {freteAviso ? (
        <Text onPress={() => onIrPara('condicoes')}>
          <Strong>{freteAviso}</Strong> Toque aqui para abrir Condições.
        </Text>
      ) : null}
    </Banner>
  );
}

export { alternarUnidade };

const s = StyleSheet.create({
  abas: { flexDirection: 'row', backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.line },
  aba: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4, borderBottomWidth: 3, borderBottomColor: 'transparent', paddingHorizontal: 4 },
  abaOn: { borderBottomColor: colors.accent },
  abaTexto: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink2 },
  ponto: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
  divisor: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  produto: { gap: 8, paddingVertical: 12, paddingHorizontal: 14 },
  passo: { width: 48, height: 48, borderRadius: 10, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  qtd: { width: 52, height: 48, textAlign: 'center', fontFamily: fonts.bold, fontSize: 16, color: colors.ink, fontVariant: ['tabular-nums'], padding: 0 },
  linkAjuste: { minHeight: 48, justifyContent: 'center', paddingRight: 8 },
  ajuste: { gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: colors.ground },
  pctBox: { flex: 1, height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  pctInput: { flex: 1, minWidth: 0, height: 46, textAlign: 'right', fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink, padding: 0 },
  pctSufixo: { flex: 1, fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink2, marginLeft: 2 },
  segmento: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  segItem: { flexGrow: 1, minWidth: 72, paddingHorizontal: 10, height: 48, borderRadius: 10, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  segTexto: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  opcao: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface },
  opcaoOn: { borderColor: colors.success, backgroundColor: colors.successBg },
  texto: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, paddingHorizontal: 12, fontFamily: fonts.body, fontSize: 15, color: colors.ink },
});
