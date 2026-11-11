/**
 * Peças das telas do Catálogo: cartão do produto, selo de estoque e botões da extensão `produto.acoes` (o Vendedor
 * registra "Adicionar ao pedido" com `acao: 'pedido.criar'`; o shell já esconde do promotor — RN-PRO-01, regra 7).
 */
import { useExtensoes } from '@macuxi/platform-sdk/react';
import { ALTURA, Badge, Button, Card, colors, fonts, type as t, type IconName } from '@macuxi/ui/mobile';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AcaoProduto, ContextoProduto, ItemVitrine, MiniaturaProduto as Miniatura } from '../../contracts';
import { etiquetasDoItem, textoEquivale, type ExtrasProduto } from '../lib/extras-item';
import { partirPorMarcas, rotuloEstoque, rotuloIncluiAno, rotuloPreco, subtituloProduto, textoEquivaleA } from '../lib/apresentacao';
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

/** Texto com os termos achados em negrito (trecho "Serve em" e "Equivale a"). */
function TextoMarcado({ texto, marcas, estilo }: { texto: string; marcas: readonly (readonly [number, number])[]; estilo: object }) {
  return (
    <Text style={estilo} numberOfLines={2}>
      {partirPorMarcas(texto, marcas).map((p, i) => (
        <Text key={`${i}:${p.texto}`} style={p.marcado ? s.marcado : undefined}>
          {p.texto}
        </Text>
      ))}
    </Text>
  );
}

/**
 * "Serve em: Fiat Uno 1.0/1.4 2010–2014 · inclui 2012" e "Equivale a: Freiomax CB 3401" (RN-CAT-12, RN-CAT-09). Na busca
 * vêm do item, com o trecho em negrito; sem busca (lista do último nível da hierarquia) vêm dos `extras` do aparelho, sem destaque.
 */
function LinhasDaBusca({ item, extras }: { item: ItemVitrine; extras?: ExtrasProduto }) {
  const incluiAno = rotuloIncluiAno(item);
  const equivale = textoEquivaleA(item);
  const aplicacao = !item.serve_em ? extras?.aplicacao ?? null : null;
  const equivaleLocal = !equivale ? textoEquivale(extras?.referencias ?? []) : null;
  if (!item.serve_em && !equivale && !aplicacao && !equivaleLocal) return null;
  return (
    <View style={{ gap: 2 }}>
      {aplicacao ? (
        <View testID={`catalogo-aplicacao-${item.erp_code}`}>
          <Text style={t.sub} numberOfLines={2}>
            <Text style={t.smallStrong}>Serve em: </Text>
            {aplicacao}
          </Text>
        </View>
      ) : null}
      {equivaleLocal ? (
        <View testID={`catalogo-equivale-a-${item.erp_code}`}>
          <Text style={t.sub} numberOfLines={2}>
            {equivaleLocal}
          </Text>
        </View>
      ) : null}
      {item.serve_em ? (
        <View testID={`catalogo-serve-em-${item.erp_code}`}>
          <Text style={t.sub}>
            <Text style={t.smallStrong}>Serve em: </Text>
            <TextoMarcado texto={`${item.serve_em.texto}${incluiAno ? ` · ${incluiAno}` : ''}`} marcas={item.serve_em.marcas} estilo={t.sub} />
          </Text>
        </View>
      ) : null}
      {item.equivale_a && equivale ? (
        <View testID={`catalogo-equivale-a-${item.erp_code}`}>
          <Text style={t.sub}>
            <Text style={t.smallStrong}>Equivale a: </Text>
            <TextoMarcado texto={equivale} marcas={item.equivale_a.marcas} estilo={t.sub} />
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function CartaoProduto({ item, agora, fuso, clienteId, miniatura = null, extras, onPress }: { item: ItemVitrine; agora: string; fuso: string; clienteId: string | null; miniatura?: Miniatura | null; extras?: ExtrasProduto; onPress: () => void }) {
  const etiquetas = etiquetasDoItem(extras?.etiquetas ?? []);
  const preco = rotuloPreco(item);
  const estoque = rotuloEstoque(item, agora, fuso, { filialDoCliente: clienteId !== null });
  return (
    <Card testID={`catalogo-item-${item.erp_code}`} style={s.card}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Abrir ${item.description}`} onPress={onPress} style={({ pressed }) => [s.toque, pressed && { opacity: 0.7 }]}>
        <View style={s.linha}>
          {miniatura ? <MiniaturaProduto produtoId={item.id} miniatura={miniatura} /> : null}
          <Text style={[t.title16, s.nome]} numberOfLines={2}>
            {item.description}
          </Text>
          {item.is_campaign ? <Badge label="Destaque" tone="accent" /> : null}
        </View>
        <Text style={t.small}>{subtituloProduto(item)}</Text>
        <LinhasDaBusca item={item} extras={extras} />
        {etiquetas.length > 0 ? (
          <View style={s.linha} testID={`catalogo-etiquetas-${item.erp_code}`}>
            {etiquetas.map((e) => (
              <Badge key={e} label={e} tone="neutral" />
            ))}
          </View>
        ) : null}
        {preco ? (
          <View style={s.linha}>
            <Text style={[preco.vendavel ? s.preco : s.semPreco]} testID={`catalogo-preco-${item.erp_code}`}>
              {preco.texto}
            </Text>
            {preco.riscado ? <Text style={s.riscado}>{preco.riscado}</Text> : null}
          </View>
        ) : null}
        {estoque ? (
          <View style={s.linha}>
            <Badge label={estoque.texto} tone={estoque.tom} />
            <Text style={[t.small, estoque.desatualizado && { color: colors.warning }]}>{estoque.detalhe}</Text>
          </View>
        ) : null}
      </Pressable>
      <BotoesAcao item={item} clienteId={clienteId} compacto />
    </Card>
  );
}

const s = StyleSheet.create({
  card: { padding: 14, gap: 10 },
  toque: { gap: 6, minHeight: 48 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  nome: { flex: 1 },
  preco: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink },
  semPreco: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink2 },
  marcado: { fontFamily: fonts.bold, color: colors.ink },
  riscado: { fontFamily: fonts.body, fontSize: 13, color: colors.ink3, textDecorationLine: 'line-through' },
  acoes: { gap: 8 },
  acoesCompactas: { flexDirection: 'row', flexWrap: 'wrap' },
  botaoCompacto: { flexGrow: 1 },
});
