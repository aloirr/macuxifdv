/**
 * Peças das telas do Catálogo: cartão do produto, selo de estoque e botões da extensão `produto.acoes` (o Vendedor
 * registra "Adicionar ao pedido" com `acao: 'pedido.criar'`; o shell já esconde do promotor — RN-PRO-01, regra 7).
 */
import { useExtensoes } from '@macuxi/platform-sdk/react';
import { ALTURA, Button, Cartao, ChipEstado, colors, fonts, type IconName } from '@macuxi/ui/mobile';
import { StyleSheet, Text, View } from 'react-native';
import type { AcaoProduto, ContextoProduto, ItemVitrine, MiniaturaProduto as Miniatura } from '../../contracts';
import { rotuloPreco } from '../lib/apresentacao';
import { linhaDaMarca, precoDoCartao, rotuloAcessivelDoCartao, tagDeEstoque } from '../lib/grade';
import { MiniaturaProduto } from './miniatura';

/** Itens do slot `produto.acoes` visíveis ao usuário (módulo efetivo, perfil e ação). */
export function useAcoesProduto(): { id: string; payload: AcaoProduto }[] {
  return useExtensoes<AcaoProduto>('produto.acoes').map((e) => ({ id: e.id, payload: e.payload }));
}

export function contextoDoProduto(item: ItemVitrine, clienteId: string | null): ContextoProduto {
  return { produtoId: item.id, sku: item.erp_code, nomeProduto: item.description, clienteId, vendavel: item.price ? item.price.sellable : null };
}

/** Só a ficha leva o botão principal (laranja, 52): na vitrine cada cartão seria um principal por tela. */
const principal = (destaque: boolean | undefined, compacto: boolean) => !!destaque && !compacto;

export function BotoesAcao({ item, clienteId, compacto = false }: { item: ItemVitrine; clienteId: string | null; compacto?: boolean }) {
  const acoes = useAcoesProduto();
  if (acoes.length === 0) return null;
  const ctx = contextoDoProduto(item, clienteId);
  return (
    <View style={[s.acoes, compacto && s.acoesCompactas]}>
      {acoes.map((a) => (
        <Button
          key={a.id}
          testID={`${a.payload.testID}-${item.erp_code}`}
          label={a.payload.rotulo}
          icon={a.payload.icone as IconName | undefined}
          variant={principal(a.payload.destaque, compacto) ? 'accent' : 'outline'}
          height={principal(a.payload.destaque, compacto) ? ALTURA.principal : ALTURA.toque}
          onPress={() => a.payload.abrir(ctx)}
          style={compacto ? s.botaoCompacto : undefined}
        />
      ))}
    </View>
  );
}

/**
 * Cartão da grade de 2 colunas (T-0173, docs/design/catalogo-grade.md §2): foto (ou a inicial do nome), nome em até 2 linhas,
 * marca, preço e uma tag de estoque. Uma informação por linha: sem código, hora nem etiquetas (ficam na ficha). O cartão inteiro
 * abre a ficha; o botão da extensão `produto.acoes` (só dentro do pedido) fica ao lado do preço.
 */
export function CartaoGrade({ item, clienteId, miniatura = null, onPress }: { item: ItemVitrine; clienteId: string | null; miniatura?: Miniatura | null; onPress: () => void }) {
  const preco = rotuloPreco(item);
  const tag = tagDeEstoque(item, { filialDoCliente: clienteId !== null });
  const linhaMarca = linhaDaMarca(item);
  const precoTexto = precoDoCartao(preco);
  const inicial = item.description.trim().charAt(0).toUpperCase();
  const acoes = useAcoesProduto();
  const rotulo = rotuloAcessivelDoCartao([item.description, linhaMarca, precoTexto, tag?.texto]);
  return (
    <Cartao testID={`catalogo-item-${item.erp_code}`} onPress={onPress} rotuloAcessivel={rotulo} preenchimento={10} gap={6} style={g.cartao}>
      <MiniaturaProduto
        produtoId={item.id}
        miniatura={miniatura}
        altura={112}
        reserva={
          <Text style={g.inicial} accessible={false}>
            {inicial}
          </Text>
        }
      />
      <Text style={g.nome} numberOfLines={2}>
        {item.description}
      </Text>
      <Text style={g.marca} numberOfLines={1}>
        {linhaMarca}
      </Text>
      <View style={{ flex: 1 }} />
      {preco ? (
        <View style={g.precoLinha}>
          <Text style={[preco.vendavel ? g.preco : g.semPreco]} testID={`catalogo-preco-${item.erp_code}`}>
            {precoTexto}
          </Text>
          {preco.riscado ? <Text style={g.riscado}>{preco.riscado}</Text> : null}
          {acoes.length > 0 ? <View style={{ marginLeft: 'auto' }}><BotoesAcao item={item} clienteId={clienteId} compacto /></View> : null}
        </View>
      ) : null}
      {tag ? (
        <View style={g.tag}>
          <ChipEstado texto={tag.texto} tom={tag.tom} pequeno testID={`catalogo-estoque-${item.erp_code}`} />
        </View>
      ) : null}
    </Cartao>
  );
}

const g = StyleSheet.create({
  cartao: { flex: 1, borderRadius: 16 },
  inicial: { fontFamily: fonts.display, fontSize: 34, color: colors.ink3 },
  nome: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  marca: { fontFamily: fonts.body, fontSize: 13, color: colors.ink2, minHeight: 18 },
  precoLinha: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  preco: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink, fontVariant: ['tabular-nums'] },
  semPreco: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink3 },
  riscado: { fontFamily: fonts.body, fontSize: 12, color: colors.ink2, textDecorationLine: 'line-through' },
  tag: { flexDirection: 'row' },
});

const s = StyleSheet.create({
  acoes: { gap: 8 },
  acoesCompactas: { flexDirection: 'row', flexWrap: 'wrap' },
  botaoCompacto: { flexGrow: 1 },
});
