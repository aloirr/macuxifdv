/**
 * T-0148 e T-0165 (docs/design/pedido-v4.md §5.3): a lista da aba Itens. Linha 1: "nome - marca" (o nome é tocável e abre o balão com só a
 * descrição 2); linha 2: código · Emb. · Est.; à direita o "+" (vira o lápis Editar, T-0165, quando o produto já está no pedido). Sem campo de quantidade na
 * linha: o toque abre a folha do item (`FolhaDoItem`). Sem marca de problema: o problema está nos Alertas (RN-VEN-42). Só desenha.
 * A lista é feita para receber a busca paginada da T-0167: recebe só a página que o pai monta e não conhece a consulta.
 */
import type { Product } from '@macuxi/catalogo/contracts';
import { Balao, Botao, BotaoEditar, colors, fonts, Icon } from '@macuxi/ui/mobile';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { TrechoServeEm } from '../../domain/busca-seletor';
import { semResultadoDaBusca } from '../lib/textos-pedido';
import { nomeComMarca } from '../lib/detalhe-pedido';
import { linhaDoProdutoNaLista } from '../lib/item-popup';
import type { UnidadeDaTela } from '../lib/novo-pedido';
import { ServeEm } from './novo-pedido-itens';

export function ResultadosDaBusca({
  produtos,
  medidasDe,
  noPedido,
  serveEm,
  aoAdicionar,
  comFoto,
  aoAbrirFoto,
}: {
  produtos: readonly Product[];
  /** as embalagens do cadastro (a principal sai na linha 2) */
  medidasDe: (produtoId: string) => readonly UnidadeDaTela[];
  /** produtos que já estão no pedido: o botão vira o lápis Editar */
  noPedido: ReadonlySet<string>;
  serveEm?: ReadonlyMap<string, TrechoServeEm>;
  aoAdicionar: (produtoId: string) => void;
  comFoto?: ReadonlySet<string>;
  aoAbrirFoto?: (produtoId: string) => void;
}) {
  return (
    <View style={s.cartao} testID="resultados-busca">
      {produtos.map((p, i) => {
        const trecho = serveEm?.get(p.id);
        const descricao2 = (p.applications ?? '').trim();
        const linha2 = linhaDoProdutoNaLista(p, medidasDe(p.id));
        const jaNoPedido = noPedido.has(p.id);
        return (
          <View key={p.id} style={i > 0 ? s.traco : undefined} testID={`product-${p.erp_code}`}>
            <View style={s.linha}>
              <View style={{ flex: 1, gap: 2 }}>
                <Balao testID={`nome-${p.erp_code}`} texto={descricao2} rotuloAcessivel={`${nomeComMarca(p.description, p.brand)}${descricao2 ? '. Toque para ver a descrição.' : ''}`}>
                  <Text style={s.nome} numberOfLines={2}>
                    <Text style={[s.nomeForte, descricao2 ? s.nomeLink : null]}>{p.description}</Text>
                    {p.brand?.trim() ? ` - ${p.brand.trim()}` : ''}
                  </Text>
                </Balao>
                <Text style={s.detalhe} numberOfLines={1}>
                  <Text style={s.codigo}>{linha2.codigo}</Text>
                  {`   Emb. ${linha2.emb}   Est. ${linha2.estoque}`}
                </Text>
                {trecho ? <ServeEm trecho={trecho} codigo={p.erp_code} /> : null}
                {p.price_cents === null ? (
                  <Text style={s.semPreco} testID={`sem-preco-${p.erp_code}`}>
                    Sem preço para este cliente
                  </Text>
                ) : null}
              </View>
              {comFoto?.has(p.id) && aoAbrirFoto ? (
                <Pressable testID={`foto-${p.erp_code}`} accessibilityRole="button" accessibilityLabel={`Ver foto de ${p.description}`} onPress={() => aoAbrirFoto(p.id)} hitSlop={4} style={s.foto}>
                  <Icon name="camera" size={22} color={colors.ink2} />
                </Pressable>
              ) : null}
              {jaNoPedido ? (
                <BotaoEditar testID={`adicionar-${p.erp_code}`} item={p.description} onPress={() => aoAdicionar(p.id)} />
              ) : (
                <Pressable
                  testID={`adicionar-${p.erp_code}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Adicionar ${p.description}`}
                  accessibilityState={{ disabled: p.price_cents === null }}
                  disabled={p.price_cents === null}
                  onPress={() => aoAdicionar(p.id)}
                  style={[s.botaoMais, p.price_cents === null && { opacity: 0.4 }]}>
                  <Icon name="plus" size={22} color={colors.ink} strokeWidth={2.2} />
                </Pressable>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** T-0167: "Mostrando 20 de 87" e o botão que traz os próximos 20 da lista já ranqueada; com tudo à vista, os dois somem. */
export function MostrarMais({ pagina, aoMostrarMais }: { pagina: { mostrando: number; total: number; temMais: boolean; texto: string }; aoMostrarMais: () => void }) {
  if (!pagina.temMais) return null;
  return (
    <View style={{ gap: 8, alignItems: 'center' }} testID="mostrar-mais">
      <Text style={s.contagem}>{pagina.texto}</Text>
      <View style={{ alignSelf: 'stretch' }}>
        <Botao testID="mostrar-mais-botao" nivel="secundario" rotulo="+ Mostrar mais" rotuloAcessivel="Mostrar mais 20 produtos" onPress={aoMostrarMais} />
      </View>
    </View>
  );
}

/** T-0167: nada encontrado; com termo parecido no índice, "Você quis dizer…?" busca o termo. */
export function SemResultadoDaBusca({ busca, sugestao, aoBuscar }: { busca: string; sugestao: string | null; aoBuscar: (termo: string) => void }) {
  const t = semResultadoDaBusca(busca, sugestao);
  return (
    <View style={s.semResultado} testID="busca-sem-resultado">
      <Text style={s.semResultadoTexto}>{t.frase}</Text>
      {t.sugestao ? (
        <Pressable testID="busca-sugestao" accessibilityRole="button" accessibilityLabel={t.rotuloSugestao ?? undefined} onPress={() => aoBuscar(t.sugestao ?? '')} style={s.sugestao}>
          <Text style={s.sugestaoTexto}>{t.rotuloSugestao}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** T-0148: foto do produto em tela cheia (endereço local `file://`); toque em qualquer ponto fecha. */
export function VisorDeFoto({ uri, aoFechar }: { uri: string | null; aoFechar: () => void }) {
  return (
    <Modal visible={uri !== null} transparent animationType="fade" onRequestClose={aoFechar}>
      <Pressable testID="visor-foto" accessibilityRole="button" accessibilityLabel="Fechar foto" onPress={aoFechar} style={s.visor}>
        {uri ? <Image source={{ uri }} style={s.visorImagem} resizeMode="contain" accessibilityIgnoresInvertColors /> : null}
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  cartao: { backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  foto: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  botaoMais: { width: 44, height: 44, borderRadius: 12, borderWidth: 1.5, borderColor: colors.accentInk, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  visor: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  visorImagem: { width: '100%', height: '80%' },
  traco: { borderTopWidth: 1, borderTopColor: colors.lineSoft },
  nome: { fontFamily: fonts.body, fontSize: 15, lineHeight: 20, color: colors.ink },
  nomeForte: { fontFamily: fonts.semibold, color: colors.ink },
  nomeLink: { textDecorationLine: 'underline', textDecorationStyle: 'dotted' },
  detalhe: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink2 },
  codigo: { fontFamily: fonts.mono, fontSize: 12, color: colors.ink2 },
  semPreco: { fontFamily: fonts.semibold, fontSize: 12, color: colors.danger },
  contagem: { fontFamily: fonts.body, fontSize: 13, color: colors.ink2 },
  semResultado: { backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: 12, padding: 14, gap: 4 },
  semResultadoTexto: { fontFamily: fonts.body, fontSize: 14, color: colors.ink },
  sugestao: { minHeight: 44, justifyContent: 'center' },
  sugestaoTexto: { fontFamily: fonts.semibold, fontSize: 14, color: colors.accentInk },
});
