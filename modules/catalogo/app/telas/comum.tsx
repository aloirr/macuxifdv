/**
 * Peças das telas do Catálogo: cartão do produto, botão "Copiar código" e botões da extensão `produto.acoes`. Ações de
 * outros módulos (ex.: Vendedor) chegam só pela extensão; o shell já esconde do promotor o que é de pedido (RN-PRO-01, regra 7).
 */
import { useExtensoes } from '@macuxi/platform-sdk/react';
import { ALTURA, BotaoIcone, Button, Cartao, ChipEstado, colors, fonte, Icon, type IconName, type as t } from '@macuxi/ui/mobile';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Clipboard, Platform, Pressable, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import type { AcaoProduto, ContextoProduto, ItemVitrine, MiniaturaProduto as Miniatura } from '../../contracts';
import { rotuloPreco } from '../lib/apresentacao';
import { AVISO_CODIGO_COPIADO, copiarCodigo, rotuloAcessivelCopiar } from '../lib/copiar-codigo';
import { estoqueCarregandoVisivel, LEITURA_ESTOQUE_CARREGANDO, TEXTO_ESTOQUE_CARREGANDO } from '../lib/carga-do-cartao';
import { linhaDaMarca, precoDoCartao, rotuloAcessivelDoCartao, tagDeEstoque } from '../lib/grade';
import { BotaoEstoquePorFilial } from './estoque-filial';
import { MiniaturaProduto } from './miniatura';

/** Itens do slot `produto.acoes` visíveis ao usuário (módulo efetivo, perfil e ação). */
export function useAcoesProduto(): { id: string; payload: AcaoProduto }[] {
  return useExtensoes<AcaoProduto>('produto.acoes').map((e) => ({ id: e.id, payload: e.payload }));
}

export function contextoDoProduto(item: ItemVitrine, clienteId: string | null): ContextoProduto {
  return { produtoId: item.id, sku: item.erp_code, nomeProduto: item.description, clienteId, vendavel: item.price ? item.price.sellable : null };
}

/**
 * "Copiar código" (`erp_code`), só no cartão da lista: ícone com alvo 48x48, sem disparar o toque do cartão. Aviso único: ✓ por 2 s e
 * o toast no Android; sem toast, o leitor de tela anuncia. A ficha do produto não tem o botão.
 */
export function BotaoCopiarCodigo({ codigo }: { codigo: string }) {
  const [copiado, setCopiado] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const copiar = async () => {
    const r = await copiarCodigo(codigo, (t) => Clipboard.setString(t));
    if (Platform.OS === 'android') ToastAndroid.show(r.aviso, ToastAndroid.SHORT);
    else AccessibilityInfo.announceForAccessibility(r.aviso);
    setCopiado(r.ok);
    if (timer.current) clearTimeout(timer.current);
    if (r.ok) timer.current = setTimeout(() => setCopiado(false), 2000);
  };
  const rotuloAcessivel = copiado ? AVISO_CODIGO_COPIADO : rotuloAcessivelCopiar(codigo);
  return (
    <Pressable
      testID={`catalogo-copiar-codigo-${codigo}`}
      accessibilityRole="button"
      accessibilityLabel={rotuloAcessivel}
      onPress={() => void copiar()}
      hitSlop={10}
      style={({ pressed }) => [g.copiar, pressed && { backgroundColor: colors.ground }]}
    >
      <Icon name={copiado ? 'check' : 'copy'} size={20} color={copiado ? colors.success : colors.ink2} />
    </Pressable>
  );
}

/** Botões da extensão na ficha: o `destaque` vira o principal (laranja, 52). */
export function BotoesAcao({ item, clienteId }: { item: ItemVitrine; clienteId: string | null }) {
  const acoes = useAcoesProduto();
  if (acoes.length === 0) return null;
  const ctx = contextoDoProduto(item, clienteId);
  return (
    <View style={s.acoes}>
      {acoes.map((a) => (
        <Button
          key={a.id}
          testID={`${a.payload.testID}-${item.erp_code}`}
          label={a.payload.rotulo}
          icon={a.payload.icone as IconName | undefined}
          variant={a.payload.destaque ? 'accent' : 'outline'}
          height={a.payload.destaque ? ALTURA.principal : ALTURA.toque}
          onPress={() => a.payload.abrir(ctx)}
        />
      ))}
    </View>
  );
}

/**
 * Botões da extensão no cartão da grade (docs/design/catalogo-grade.md §2): só o ícone, 44 dp com borda, à direita do preço; o
 * rótulo vai para o TalkBack com o nome do produto. Com texto, o botão não cabe na coluna de 360 dp (print de 14/11).
 */
function BotoesAcaoDoCartao({ item, clienteId, acoes }: { item: ItemVitrine; clienteId: string | null; acoes: { id: string; payload: AcaoProduto }[] }) {
  const ctx = contextoDoProduto(item, clienteId);
  return (
    <View style={g.acoes}>
      {acoes.map((a) => (
        <BotaoIcone
          key={a.id}
          testID={`${a.payload.testID}-${item.erp_code}`}
          icone={(a.payload.icone as IconName | undefined) ?? 'plus'}
          rotuloAcessivel={`${a.payload.rotulo}: ${item.description}`}
          tamanho={44}
          cor={colors.ink}
          onPress={() => a.payload.abrir(ctx)}
        />
      ))}
    </View>
  );
}

/**
 * Cartão da grade de 2 colunas (docs/design/catalogo-campo-v2/spec.md §1 e §3): foto de 96 dp, nome em até 3 linhas, marca, o código
 * do produto com o copiar (copia só o código), preço e, na última linha, `Estoque: N` com o botão da folha "Estoque por filial" (só com
 * mais de uma filial). O cartão inteiro abre a ficha; o copiar e o botão de estoque não abrem. O botão da extensão `produto.acoes`
 * (de outro módulo, só dentro do fluxo dele) fica ao lado do preço.
 */
export function CartaoGrade({ item, clienteId, miniatura = null, estoqueCarregando = false, onPress, onEstoquePorFilial }: { item: ItemVitrine; clienteId: string | null; miniatura?: Miniatura | null; estoqueCarregando?: boolean; onPress: () => void; onEstoquePorFilial: () => void }) {
  const preco = rotuloPreco(item);
  const tag = tagDeEstoque(item);
  const linhaMarca = linhaDaMarca(item);
  const precoTexto = precoDoCartao(preco);
  const acoes = useAcoesProduto();
  // T-0192 §7.3: estoque em carga = chip neutro "Estoque: —"; o perfil que não vê preço e estoque não ganha o chip
  const mostraEstoqueCarregando = estoqueCarregandoVisivel(estoqueCarregando, item.price_stock_visible);
  const rotulo = rotuloAcessivelDoCartao([item.description, linhaMarca, item.erp_code, precoTexto, mostraEstoqueCarregando ? LEITURA_ESTOQUE_CARREGANDO : tag?.texto]);
  return (
    <Cartao testID={`catalogo-item-${item.erp_code}`} onPress={onPress} rotuloAcessivel={rotulo} preenchimento={10} gap={6} style={g.cartao}>
      <MiniaturaProduto produtoId={item.id} miniatura={miniatura} altura={96} />
      <Text style={g.nome} numberOfLines={3}>
        {item.description}
      </Text>
      <Text style={g.marca} numberOfLines={1}>
        {linhaMarca}
      </Text>
      <View style={g.codigo}>
        <Text style={g.codigoTexto} numberOfLines={1}>
          {item.erp_code}
        </Text>
        <BotaoCopiarCodigo codigo={item.erp_code} />
      </View>
      <View style={{ flex: 1 }} />
      {preco ? (
        <View style={g.precoLinha}>
          <Text style={[preco.vendavel ? g.preco : g.semPreco]} testID={`catalogo-preco-${item.erp_code}`}>
            {precoTexto}
          </Text>
          {preco.riscado ? <Text style={g.riscado}>{preco.riscado}</Text> : null}
          {acoes.length > 0 ? <BotoesAcaoDoCartao item={item} clienteId={clienteId} acoes={acoes} /> : null}
        </View>
      ) : null}
      {mostraEstoqueCarregando ? (
        <View style={g.rodape}>
          <ChipEstado texto={TEXTO_ESTOQUE_CARREGANDO} tom="neutro" pequeno rotuloAcessivel={LEITURA_ESTOQUE_CARREGANDO} testID={`catalogo-estoque-${item.erp_code}`} />
        </View>
      ) : tag ? (
        <View style={g.rodape}>
          <ChipEstado texto={tag.texto} tom={tag.tom} pequeno rotuloAcessivel={tag.leitura} testID={`catalogo-estoque-${item.erp_code}`} />
          <BotaoEstoquePorFilial availability={item.availability} onPress={onEstoquePorFilial} testID={`catalogo-estoque-filial-${item.erp_code}`} />
        </View>
      ) : null}
    </Cartao>
  );
}

const g = StyleSheet.create({
  cartao: { flex: 1, borderRadius: 16 },
  nome: t.bodyStrong,
  marca: { ...fonte.body, fontSize: 14, color: colors.ink2, minHeight: 18 },
  precoLinha: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  preco: t.number,
  semPreco: { ...fonte.semibold, fontSize: 16, color: colors.ink3 },
  riscado: { ...fonte.body, fontSize: 12, color: colors.ink2, textDecorationLine: 'line-through' },
  acoes: { flexDirection: 'row', gap: 6, marginLeft: 'auto' },
  rodape: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  codigo: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  codigoTexto: { ...fonte.mono, fontSize: 14, color: colors.ink, flexShrink: 1 },
  // 28 dp de caixa + 10 de folga em cada lado = alvo de 48 dp, sem empurrar o rodapé para fora da coluna de 360 dp
  copiar: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
});

const s = StyleSheet.create({
  acoes: { gap: 8 },
});
