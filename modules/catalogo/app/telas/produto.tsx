/**
 * Ficha do produto (RF-CAT-03, T-0052). OFFLINE-FIRST: abre do aparelho (cadastro, preço da tabela do cliente,
 * estoque, atributos e conteúdo sincronizados); com sinal e sem o produto no aparelho, busca na API. Preço e estoque
 * seguem o RN-CAT-05. Botão "Copiar código" próprio e, além dele, só as ações de outros módulos pela extensão `produto.acoes`
 * (o promotor nunca vê as de pedido).
 */
import { relogioReal } from '@macuxi/comum/relogio';
import { useAmbiente, useMotorSync, useParametros } from '@macuxi/platform-sdk/react';
import { Badge, Card, colors, DEFAULT_TZ, Empty, fonte, Icon, Screen, SectionHeader, type as t } from '@macuxi/ui/mobile';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { caminhoCatalogo, type FichaProduto } from '../../contracts';
import { aplicacaoPrecisaRecolher, estadoOfereceJunto, LINHAS_APLICACAO_RECOLHIDA, rotuloEstoque, rotuloEstoqueFilial, rotuloPreco, subtituloProduto } from '../lib/apresentacao';
import { fichaLocal } from '../lib/local';
import { hrefCatalogo, irParaProduto } from '../rotas';
import { BotaoCopiarCodigo, BotoesAcao } from './comum';

type Estado = { fase: 'carregando' } | { fase: 'pronta'; ficha: FichaProduto; noAparelho: boolean } | { fase: 'nao_encontrado' };

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
      if (local) return { fase: 'pronta', ficha: local, noAparelho: true };
      if (!ambiente.online() || !id) return { fase: 'nao_encontrado' };
      try {
        const ficha = await ambiente.http.get<FichaProduto>(caminhoCatalogo('produto', { id }), { customer_id: clienteId });
        return { fase: 'pronta', ficha, noAparelho: false };
      } catch {
        return { fase: 'nao_encontrado' };
      }
    };
    void carregar().then((e) => vivo && setEstado(e));
    return () => {
      vivo = false;
    };
  }, [motor, id, clienteId, parametros, ambiente, usuario?.perfil, sync.sincronizado_em]);

  // T-0172: título, subtítulo e voltar na faixa Azul noite do kit (docs/design/componentes.md §5.2)
  const voltar = { label: 'Catálogo', fallback: hrefCatalogo(clienteId) };
  if (estado.fase === 'carregando') {
    return (
      <Screen testID="pagina-catalogo-produto" cabecalho={{ titulo: 'Produto', voltar }}>
        <ActivityIndicator color={colors.accent} />
      </Screen>
    );
  }
  if (estado.fase === 'nao_encontrado') {
    return (
      <Screen testID="pagina-catalogo-produto" cabecalho={{ titulo: 'Produto', voltar }}>
        <Empty text="Produto não encontrado neste aparelho. Sincronize e tente de novo, ou busque pelo nome no catálogo." />
      </Screen>
    );
  }

  const { product: item, attributes, content, catalogo } = estado.ficha;
  const aplicacao = catalogo?.aplicacao ?? null;
  const recolher = !!aplicacao && !aplicacaoAberta && aplicacaoPrecisaRecolher(aplicacao);
  const preco = rotuloPreco(item);
  const estoque = rotuloEstoque(item, relogioReal().agora().toISOString(), fuso, { filialDoCliente: clienteId !== null });
  return (
    <Screen testID="pagina-catalogo-produto" cabecalho={{ titulo: item.description, subtitulo: `${subtituloProduto(item)} · ${item.unit}${item.ean ? ` · EAN ${item.ean}` : ''}`, voltar }}>
      {item.is_campaign || (catalogo && catalogo.etiquetas.length > 0) ? (
        <View style={{ gap: 4 }}>
          {item.is_campaign ? <Badge label="Destaque" tone="accent" style={{ alignSelf: 'flex-start' }} /> : null}
          {catalogo && catalogo.etiquetas.length > 0 ? (
            <View style={s.etiquetas} testID="produto-etiquetas">
              {catalogo.etiquetas.map((e) => (
                <Badge key={e} label={e} tone="neutral" />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

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
              <Text style={t.label}>{clienteId && item.availability?.by_branch.length === 1 ? `Estoque na filial ${item.availability.by_branch[0]!.branch_name}` : clienteId ? 'Estoque na filial do cliente' : 'Estoque'}</Text>
              <Badge label={estoque.texto} tone={estoque.tom} style={{ alignSelf: 'flex-start' }} />
              {estoque.detalhe ? <Text style={[t.small, estoque.desatualizado && { color: colors.warning }]}>{estoque.detalhe}</Text> : null}
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

      <BotaoCopiarCodigo codigo={item.erp_code} />
      <BotoesAcao item={item} clienteId={clienteId} />

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

      {aplicacao ? (
        <Card style={s.card} testID="produto-aplicacao">
          <SectionHeader title="Aplicação" />
          <Text style={t.body} numberOfLines={recolher ? LINHAS_APLICACAO_RECOLHIDA : undefined}>
            {aplicacao}
          </Text>
          {aplicacaoPrecisaRecolher(aplicacao) ? (
            <Pressable accessibilityRole="button" accessibilityLabel={aplicacaoAberta ? 'Ver menos da aplicação' : 'Ver mais da aplicação'} onPress={() => setAplicacaoAberta((v) => !v)} style={s.verMais}>
              <Text style={s.verMaisTexto}>{aplicacaoAberta ? 'Ver menos' : 'Ver mais'}</Text>
            </Pressable>
          ) : null}
        </Card>
      ) : null}

      {catalogo && catalogo.oferece_junto.length > 0 ? (
        <Card style={s.card} testID="produto-oferece-junto">
          <SectionHeader title="Oferece junto" />
          {catalogo.oferece_junto.map((o, i) => {
            const e = estadoOfereceJunto({ online: ambiente.online(), fichaNoAparelho: estado.noAparelho });
            const ultima = i === catalogo.oferece_junto.length - 1;
            return (
              <Pressable
                key={o.produto_id}
                accessibilityRole="button"
                accessibilityLabel={`Abrir ${o.description}`}
                accessibilityState={{ disabled: !e.toca }}
                disabled={!e.toca}
                onPress={() => irParaProduto(o.produto_id, clienteId)}
                style={({ pressed }) => [s.ofereceJunto, ultima && { borderBottomWidth: 0 }, pressed && { backgroundColor: colors.ground, transform: [{ scale: 0.97 }] }]}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={t.bodyStrong}>{o.description}</Text>
                  <Text style={t.small}>{e.apoio ? `${o.erp_code} · ${e.apoio}` : o.erp_code}</Text>
                </View>
                {e.toca ? <Icon name="chevron" size={18} color={colors.ink3} /> : null}
              </Pressable>
            );
          })}
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
  preco: { ...fonte.bold, fontSize: 22, color: colors.ink },
  semPreco: { ...fonte.medium, fontSize: 14, color: colors.ink2 },
  riscado: { ...fonte.body, fontSize: 14, color: colors.ink3, textDecorationLine: 'line-through' },
  verMais: { minHeight: 48, justifyContent: 'center' },
  verMaisTexto: { ...fonte.semibold, fontSize: 14, color: colors.accentInk },
  ofereceJunto: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  etiquetas: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  atributo: { flexDirection: 'row', gap: 12, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
});
