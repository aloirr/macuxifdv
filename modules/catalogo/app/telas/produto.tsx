/**
 * Ficha do produto (RF-CAT-03, T-0052). OFFLINE-FIRST: abre do aparelho (cadastro, preço da tabela do cliente,
 * estoque, atributos e conteúdo sincronizados); com sinal e sem o produto no aparelho, busca na API. Preço e estoque
 * seguem o RN-CAT-05; as ações vêm da extensão `produto.acoes` (o promotor nunca vê "Adicionar ao pedido").
 */
import { relogioReal } from '@macuxi/comum/relogio';
import { useAmbiente, useMotorSync, useParametros } from '@macuxi/platform-sdk/react';
import { BackLink, Badge, Card, colors, DEFAULT_TZ, Empty, fonts, Screen, SectionHeader, type as t } from '@macuxi/ui/mobile';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { caminhoCatalogo, type FichaProduto } from '../../contracts';
import { aplicacaoPrecisaRecolher, LINHAS_APLICACAO_RECOLHIDA, rotuloEstoque, rotuloEstoqueFilial, rotuloPreco, subtituloProduto } from '../lib/apresentacao';
import { fichaLocal } from '../lib/local';
import { hrefCatalogo, irParaProduto } from '../rotas';
import { BotoesAcao } from './comum';

type Estado = { fase: 'carregando' } | { fase: 'pronta'; ficha: FichaProduto } | { fase: 'nao_encontrado' };

export default function TelaProduto() {
  const params = useLocalSearchParams<{ id?: string; cliente?: string }>();
  const id = String(params.id ?? '');
  const clienteId = params.cliente ? String(params.cliente) : null;
  const ambiente = useAmbiente();
  const { motor, estado: sync } = useMotorSync();
  const parametros = useParametros('catalogo');
  const usuario = ambiente.usuario();
  const fuso = usuario?.fuso ?? DEFAULT_TZ;
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });
  const [aplicacaoAberta, setAplicacaoAberta] = useState(false);

  useEffect(() => {
    let vivo = true;
    const carregar = async (): Promise<Estado> => {
      const local = motor ? await fichaLocal(motor, { perfil: usuario?.perfil ?? null, parametros, agora: relogioReal().agora().toISOString(), clienteId, produtoId: id }) : null;
      if (local) return { fase: 'pronta', ficha: local };
      if (!ambiente.online() || !id) return { fase: 'nao_encontrado' };
      try {
        const ficha = await ambiente.http.get<FichaProduto>(caminhoCatalogo('produto', { id }), { customer_id: clienteId });
        return { fase: 'pronta', ficha };
      } catch {
        return { fase: 'nao_encontrado' };
      }
    };
    void carregar().then((e) => vivo && setEstado(e));
    return () => {
      vivo = false;
    };
  }, [motor, id, clienteId, parametros, ambiente, usuario?.perfil, sync.sincronizado_em]);

  if (estado.fase === 'carregando') {
    return (
      <Screen testID="pagina-catalogo-produto">
        <BackLink label="Catálogo" fallback={hrefCatalogo(clienteId)} />
        <ActivityIndicator color={colors.accent} />
      </Screen>
    );
  }
  if (estado.fase === 'nao_encontrado') {
    return (
      <Screen testID="pagina-catalogo-produto">
        <BackLink label="Catálogo" fallback={hrefCatalogo(clienteId)} />
        <Empty text="Produto não encontrado neste aparelho. Sincronize e tente de novo, ou busque pelo nome no catálogo." />
      </Screen>
    );
  }

  const { product: item, attributes, content, catalogo } = estado.ficha;
  const aplicacao = catalogo?.aplicacao ?? null;
  const recolher = !!aplicacao && !aplicacaoAberta && aplicacaoPrecisaRecolher(aplicacao);
  const preco = rotuloPreco(item);
  const estoque = rotuloEstoque(item, relogioReal().agora().toISOString(), fuso);
  return (
    <Screen testID="pagina-catalogo-produto">
      <BackLink label="Catálogo" fallback={hrefCatalogo(clienteId)} />
      <View style={{ gap: 4 }}>
        <Text style={t.h1Small}>{item.description}</Text>
        <Text style={t.sub}>
          {subtituloProduto(item)} · {item.unit}
          {item.ean ? ` · EAN ${item.ean}` : ''}
        </Text>
        {item.is_campaign ? <Badge label="Destaque" tone="accent" style={{ alignSelf: 'flex-start', marginTop: 4 }} /> : null}
      </View>

      {preco || estoque ? (
        <Card style={s.card} testID="produto-preco-estoque">
          {preco ? (
            <View style={{ gap: 2 }}>
              <Text style={t.label}>{clienteId ? 'Preço para este cliente' : 'Preço'}</Text>
              <View style={s.linha}>
                <Text style={preco.vendavel ? s.preco : s.semPreco} testID="produto-preco">
                  {preco.texto}
                </Text>
                {preco.riscado ? <Text style={s.riscado}>{preco.riscado}</Text> : null}
              </View>
            </View>
          ) : null}
          {estoque ? (
            <View style={{ gap: 6 }}>
              <Text style={t.label}>Estoque</Text>
              <Badge label={estoque.texto} tone={estoque.tom} style={{ alignSelf: 'flex-start' }} />
              <Text style={[t.small, estoque.desatualizado && { color: colors.warning }]}>{estoque.detalhe}</Text>
              {item.availability && item.availability.by_branch.length > 1
                ? item.availability.by_branch.map((b) => (
                    <Text key={b.branch_id} style={t.small}>
                      {rotuloEstoqueFilial(b)}
                    </Text>
                  ))
                : null}
            </View>
          ) : null}
        </Card>
      ) : null}

      <BotoesAcao item={item} clienteId={clienteId} />

      {aplicacao ? (
        <Card style={s.card} testID="produto-aplicacao">
          <SectionHeader title="Aplicação" />
          <Text style={t.body} numberOfLines={recolher ? LINHAS_APLICACAO_RECOLHIDA : undefined}>
            {aplicacao}
          </Text>
          {aplicacaoPrecisaRecolher(aplicacao) ? (
            <Pressable accessibilityRole="button" accessibilityLabel={aplicacaoAberta ? 'Ver menos da aplicação' : 'Ver mais da aplicação'} onPress={() => setAplicacaoAberta((v) => !v)} style={s.verMais}>
              <Text style={t.bodyStrong}>{aplicacaoAberta ? 'Ver menos' : 'Ver mais'}</Text>
            </Pressable>
          ) : null}
        </Card>
      ) : null}

      {catalogo && catalogo.referencias.length > 0 ? (
        <Card style={s.card} testID="produto-equivale-a">
          <SectionHeader title="Equivale a" />
          {catalogo.referencias.map((r) => (
            <Text key={`${r.marca_id}:${r.codigo}`} style={t.body}>
              {r.marca_nome} <Text style={t.bodyStrong}>{r.codigo}</Text>
            </Text>
          ))}
        </Card>
      ) : null}

      {catalogo && catalogo.oferece_junto.length > 0 ? (
        <Card style={s.card} testID="produto-oferece-junto">
          <SectionHeader title="Oferece junto" />
          {catalogo.oferece_junto.map((o) => (
            <Pressable key={o.produto_id} accessibilityRole="button" accessibilityLabel={`Abrir ${o.description}`} onPress={() => irParaProduto(o.produto_id, clienteId)} style={s.ofereceJunto}>
              <Text style={t.bodyStrong}>{o.description}</Text>
              <Text style={t.small}>{o.erp_code}</Text>
            </Pressable>
          ))}
        </Card>
      ) : null}

      {catalogo && catalogo.etiquetas.length > 0 ? (
        <View style={s.etiquetas} testID="produto-etiquetas">
          {catalogo.etiquetas.map((e) => (
            <Badge key={e} label={e} tone="neutral" />
          ))}
        </View>
      ) : null}

      {content.description || content.selling_points.length > 0 ? (
        <Card style={s.card}>
          <SectionHeader title="Sobre o produto" />
          {content.description ? <Text style={t.body}>{content.description}</Text> : null}
          {content.selling_points.map((a) => (
            <Text key={a} style={t.body}>
              • {a}
            </Text>
          ))}
        </Card>
      ) : null}

      {attributes.length > 0 ? (
        <Card style={s.card} testID="produto-atributos">
          <SectionHeader title="Ficha técnica" />
          {attributes.map((a) => (
            <View key={`${a.name}:${a.value}`} style={s.atributo}>
              <Text style={[t.small, { flex: 1 }]}>{a.name}</Text>
              <Text style={[t.bodyStrong, { flex: 1, textAlign: 'right' }]}>{a.value}</Text>
            </View>
          ))}
        </Card>
      ) : null}

      {content.faq.length > 0 ? (
        <Card style={s.card}>
          <SectionHeader title="Perguntas frequentes" />
          {content.faq.map((f) => (
            <View key={f.question} style={{ gap: 2 }}>
              <Text style={t.bodyStrong}>{f.question}</Text>
              <Text style={t.body}>{f.answer}</Text>
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  card: { padding: 14, gap: 10 },
  linha: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  preco: { fontFamily: fonts.display, fontSize: 24, color: colors.ink },
  semPreco: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink2 },
  riscado: { fontFamily: fonts.body, fontSize: 14, color: colors.ink3, textDecorationLine: 'line-through' },
  verMais: { minHeight: 48, justifyContent: 'center' },
  ofereceJunto: { minHeight: 48, justifyContent: 'center', gap: 2, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  etiquetas: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  atributo: { flexDirection: 'row', gap: 12, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
});
