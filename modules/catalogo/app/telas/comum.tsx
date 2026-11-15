/**
 * Peças das telas do Catálogo: cartão do produto, botão "Copiar código" e botões da extensão `produto.acoes`. Ações de
 * outros módulos (ex.: Vendedor) chegam só pela extensão; o shell já esconde do promotor o que é de pedido (RN-PRO-01, regra 7).
 */
import { useExtensoes } from '@macuxi/platform-sdk/react';
import { ALTURA, BotaoIcone, Button, Cartao, ChipEstado, colors, fonts, Icon, type IconName } from '@macuxi/ui/mobile';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Clipboard, Platform, Pressable, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import type { AcaoProduto, ContextoProduto, ItemVitrine, MiniaturaProduto as Miniatura } from '../../contracts';
import { rotuloPreco } from '../lib/apresentacao';
import { AVISO_CODIGO_COPIADO, copiarCodigo, ROTULO_COPIAR_CODIGO, rotuloAcessivelCopiar } from '../lib/copiar-codigo';
import { codigosDoCartao, precoDoCartao, rotuloAcessivelDoCartao, tagDeEstoque } from '../lib/grade';
import { MiniaturaProduto } from './miniatura';

/** Itens do slot `produto.acoes` visíveis ao usuário (módulo efetivo, perfil e ação). */
export function useAcoesProduto(): { id: string; payload: AcaoProduto }[] {
  return useExtensoes<AcaoProduto>('produto.acoes').map((e) => ({ id: e.id, payload: e.payload }));
}

export function contextoDoProduto(item: ItemVitrine, clienteId: string | null): ContextoProduto {
  return { produtoId: item.id, sku: item.erp_code, nomeProduto: item.description, clienteId, vendavel: item.price ? item.price.sellable : null };
}

/**
 * "Copiar código" (`erp_code`). `ficha`: botão com ícone e rótulo (48 dp); `icone`: só o ícone, alvo 48x48, dentro do cartão
 * da lista (sem disparar o toque do cartão). Um aviso só: na ficha, o rótulo vira "Código copiado" com ✓ por 2 s; no ícone, ✓ por
 * 2 s e o toast no Android. Sem toast, o leitor de tela anuncia.
 */
export function BotaoCopiarCodigo({ codigo, variante = 'ficha' }: { codigo: string; variante?: 'ficha' | 'icone' }) {
  const [copiado, setCopiado] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const copiar = async () => {
    const r = await copiarCodigo(codigo, (t) => Clipboard.setString(t));
    if (variante === 'icone' && Platform.OS === 'android') ToastAndroid.show(r.aviso, ToastAndroid.SHORT);
    else AccessibilityInfo.announceForAccessibility(r.aviso);
    setCopiado(r.ok);
    if (timer.current) clearTimeout(timer.current);
    if (r.ok) timer.current = setTimeout(() => setCopiado(false), 2000);
  };
  const rotuloAcessivel = copiado ? AVISO_CODIGO_COPIADO : rotuloAcessivelCopiar(codigo);
  if (variante === 'ficha') {
    return (
      <Button
        testID={`catalogo-copiar-codigo-${codigo}`}
        label={copiado ? AVISO_CODIGO_COPIADO : ROTULO_COPIAR_CODIGO}
        accessibilityLabel={rotuloAcessivel}
        icon={copiado ? 'check' : 'copy'}
        variant="outline"
        height={ALTURA.toque}
        onPress={() => void copiar()}
      />
    );
  }
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
 * Cartão da grade de 2 colunas (T-0173, docs/design/catalogo-grade.md §2): foto (sem foto, a caixa `neutralBg` vazia; RD-0242), nome em até 2 linhas,
 * marca, preço e uma tag de estoque. Uma informação por linha: sem código, hora nem etiquetas (ficam na ficha). O cartão inteiro
 * abre a ficha; o botão da extensão `produto.acoes` (de outro módulo, só dentro do fluxo dele) fica ao lado do preço. Códigos em duas linhas
 * (marca em cima; código do produto com o copiar embaixo; o copiar leva só o código do produto, catalogo-campo-v2 §1).
 */
export function CartaoGrade({ item, clienteId, miniatura = null, onPress }: { item: ItemVitrine; clienteId: string | null; miniatura?: Miniatura | null; onPress: () => void }) {
  const preco = rotuloPreco(item);
  const tag = tagDeEstoque(item);
  const codigos = codigosDoCartao(item);
  const linhaMarca = codigos.marca;
  const precoTexto = precoDoCartao(preco);
  const acoes = useAcoesProduto();
  const rotulo = rotuloAcessivelDoCartao([item.description, linhaMarca, precoTexto, tag?.texto]);
  return (
    <Cartao testID={`catalogo-item-${item.erp_code}`} onPress={onPress} rotuloAcessivel={rotulo} preenchimento={10} gap={6} style={g.cartao}>
      <MiniaturaProduto produtoId={item.id} miniatura={miniatura} altura={112} />
      <Text style={g.nome} numberOfLines={2}>
        {item.description}
      </Text>
      <Text style={g.marca} numberOfLines={1}>
        {linhaMarca}
      </Text>
      <View style={g.codigoLinha}>
        <Text style={g.codigo} numberOfLines={1}>
          {codigos.produto}
        </Text>
        <BotaoCopiarCodigo codigo={codigos.copiar} variante="icone" />
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
      <View style={g.rodape}>{tag ? <ChipEstado texto={tag.texto} tom={tag.tom} pequeno testID={`catalogo-estoque-${item.erp_code}`} /> : null}</View>
    </Cartao>
  );
}

const g = StyleSheet.create({
  cartao: { flex: 1, borderRadius: 16 },
  nome: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  marca: { fontFamily: fonts.body, fontSize: 13, color: colors.ink2, minHeight: 18 },
  precoLinha: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  preco: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink, fontVariant: ['tabular-nums'] },
  semPreco: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink3 },
  riscado: { fontFamily: fonts.body, fontSize: 12, color: colors.ink2, textDecorationLine: 'line-through' },
  acoes: { flexDirection: 'row', gap: 6, marginLeft: 'auto' },
  codigoLinha: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  codigo: { fontFamily: fonts.displayBold, fontSize: 13, color: colors.ink },
  rodape: { flexDirection: 'row', alignItems: 'center' },
  // 28 dp de caixa + 10 de folga em cada lado = alvo de 48 dp, sem empurrar o rodapé para fora da coluna de 360 dp
  copiar: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
});

const s = StyleSheet.create({
  acoes: { gap: 8 },
});
