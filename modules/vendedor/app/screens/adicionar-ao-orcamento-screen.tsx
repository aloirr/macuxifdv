/**
 * Catálogo → "Adicionar ao orçamento" (decisão do dono do produto, R-20261114-151000). Folha com os orçamentos em aberto do
 * vendedor (cliente; número e data): tocar em um põe o produto nele com quantidade 1 (ou soma 1). Lê do aparelho e grava pela
 * mesma via do "Editar orçamento" (vale sem sinal para o que está na fila). Sem orçamento em aberto: só "Nenhum orçamento em aberto.".
 * A regra de "em aberto" é do domain (`orcamentosEmAberto`).
 */
import { localIsoDate } from '@macuxi/comum/fuso';
import { colors, EstadoVazio, fonte, Pressionavel, radius, Screen } from '@macuxi/ui/mobile';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { dataDaValidade } from '../../domain/orcamento';
import { TEXTO_SEM_ORCAMENTO_EM_ABERTO } from '../../domain/orcamento-em-aberto';
import { AvisoRapido, useAviso } from '../components/aviso';
import { errorMessage } from '../lib/erros';
import { hrefPedidos } from '../rotas';
import { useVendedor } from '../state/use-vendedor';

export default function AdicionarAoOrcamentoScreen() {
  const { produtoId, nome } = useLocalSearchParams<{ produtoId: string; nome?: string }>();
  const app = useVendedor();
  const { aviso, mostrar } = useAviso();
  const [gravando, setGravando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const lista = app.orcamentosParaAdicionar;

  const escolher = async (id: string) => {
    if (gravando || !produtoId) return;
    setGravando(id);
    setErro(null);
    try {
      mostrar(await app.adicionarProdutoAoOrcamento(id, produtoId));
      setTimeout(() => (router.canGoBack() ? router.back() : router.replace(hrefPedidos() as never)), 900);
    } catch (e) {
      setErro(errorMessage(e));
      setGravando(null);
    }
  };

  // o aviso fica fora da rolagem (irmão do Screen), preso ao rodapé da tela, como no detalhe do pedido
  return (
    <View style={s.raiz}>
      <Screen testID="adicionar-ao-orcamento" cabecalho={{ titulo: 'Adicionar ao orçamento', voltar: { label: 'Voltar', fallback: hrefPedidos(), testID: 'adicionar-ao-orcamento-voltar' } }}>
        {!app.carregado ? null : lista.length === 0 ? (
          <EstadoVazio testID="adicionar-ao-orcamento-vazio" icone="clipboard" titulo={TEXTO_SEM_ORCAMENTO_EM_ABERTO} />
        ) : (
          <>
            {nome ? (
              <Text style={s.produto} numberOfLines={2} testID="adicionar-ao-orcamento-produto">
                {nome}
              </Text>
            ) : null}
            {erro ? (
              <Text style={s.erro} accessibilityRole="alert" testID="adicionar-ao-orcamento-erro">
                {erro}
              </Text>
            ) : null}
            <View style={s.cartao} testID="adicionar-ao-orcamento-lista">
              {lista.map((o, i) => {
                const detalhe = [o.numero ? `Nº ${o.numero}` : null, dataDaValidade(localIsoDate(o.criado_em, app.tz), true)].filter(Boolean).join(' · ');
                return (
                  <Pressionavel
                    key={o.id}
                    testID={`orcamento-${o.numero || o.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${o.cliente_nome || 'Cliente'}, ${detalhe}`}
                    disabled={gravando !== null}
                    onPress={() => void escolher(o.id)}
                    style={[s.linha, i > 0 && s.traco, gravando !== null && gravando !== o.id && s.apagada]}>
                    <Text style={s.cliente} numberOfLines={1}>
                      {o.cliente_nome || 'Cliente'}
                    </Text>
                    <Text style={s.detalhe}>{detalhe}</Text>
                  </Pressionavel>
                );
              })}
            </View>
          </>
        )}
      </Screen>
      <AvisoRapido aviso={aviso} />
    </View>
  );
}

const s = StyleSheet.create({
  raiz: { flex: 1 },
  produto: { ...fonte.semibold, fontSize: 14, color: colors.ink2 },
  erro: { ...fonte.body, fontSize: 14, color: colors.danger },
  cartao: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, overflow: 'hidden' },
  linha: { minHeight: 64, paddingVertical: 12, paddingHorizontal: 14, gap: 3, justifyContent: 'center' },
  traco: { borderTopWidth: 1, borderTopColor: colors.lineSoft },
  apagada: { opacity: 0.5 },
  cliente: { ...fonte.semibold, fontSize: 16, color: colors.ink },
  detalhe: { ...fonte.body, fontSize: 14, color: colors.ink2, fontVariant: ['tabular-nums'] },
});
