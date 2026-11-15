/**
 * Ficha do produto (RF-CAT-03, T-0052). OFFLINE-FIRST: abre do aparelho (cadastro, preço da tabela do cliente,
 * estoque, atributos e conteúdo sincronizados); com sinal e sem o produto no aparelho, busca na API. Preço e estoque
 * seguem o RN-CAT-05. Botão "Copiar código" próprio e, além dele, só as ações de outros módulos pela extensão `produto.acoes`
 * (o promotor nunca vê as de pedido).
 */
import { relogioReal } from '@macuxi/comum/relogio';
import { useAmbiente, useMotorSync, useParametros } from '@macuxi/platform-sdk/react';
import { Badge, CatalogoCarregando, Card, ChipEstado, colors, DEFAULT_TZ, Empty, fonts, Icon, Screen, SectionHeader, type as t } from '@macuxi/ui/mobile';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { caminhoCatalogo, type FichaProduto } from '../../contracts';
import { modoDaCarga } from '../lib/carga-online';
import { aplicacaoPrecisaRecolher, estadoOfereceJunto, LINHAS_APLICACAO_RECOLHIDA, rotuloPreco, subtituloProduto } from '../lib/apresentacao';
import { dadosDaFolha } from '../lib/estoque-folha';
import { leituraDoEstoque, tagDeEstoque } from '../lib/grade';
import { fichaLocal, filiaisDoUsuarioLocal } from '../lib/local';
import { hrefCatalogo, irParaProduto } from '../rotas';
import { BotaoCopiarCodigo, BotoesAcao } from './comum';
import { BotaoPorFilialDaFicha, FolhaEstoquePorFilial } from './estoque-filial';

type Estado = { fase: 'carregando' } | { fase: 'pronta'; ficha: FichaProduto; noAparelho: boolean } | { fase: 'nao_encontrado' } | { fase: 'catalogo_carregando' };

export default function TelaProduto() {
  const params = useLocalSearchParams<{ id?: string; cliente?: string }>();
  const id = String(params.id ?? '');
  const clienteId = params.cliente ? String(params.cliente) : null;
  const ambiente = useAmbiente();
  const { motor, estado: sync } = useMotorSync();
  const parametros = useParametros('catalogo');
  const usuario = ambiente.usuario();
  const fuso = usuario?.fuso ?? DEFAULT_TZ;
  const modo = modoDaCarga(sync, ambiente.online());
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });
  const [aplicacaoAberta, setAplicacaoAberta] = useState(false);
  const [filialCadastroId, setFilialCadastroId] = useState<string | null>(null);
  const [folhaAberta, setFolhaAberta] = useState(false);
  const usuarioId = usuario?.id ?? null;

  // filial de cadastro do usuário (sync): primeira na folha, "sua filial"
  useEffect(() => {
    if (!motor) return;
    let vivo = true;
    void filiaisDoUsuarioLocal(motor, usuarioId).then((f) => vivo && setFilialCadastroId(f?.filialCadastro ?? null)).catch(() => vivo && setFilialCadastroId(null));
    return () => {
      vivo = false;
    };
  }, [motor, usuarioId, sync.sincronizado_em]);

  useEffect(() => {
    let vivo = true;
    const carregar = async (): Promise<Estado> => {
      // ADR 0054: catálogo ainda carregando = ficha e preço do cliente pela API; sem sinal, só o que já chegou ao aparelho
      const daApi = async (): Promise<Estado | null> => {
        try {
          const ficha = await ambiente.http.get<FichaProduto>(caminhoCatalogo('produto', { id }), { customer_id: clienteId });
          return { fase: 'pronta', ficha, noAparelho: false };
        } catch {
          return null;
        }
      };
      if (modo === 'api' && id) {
        const r = await daApi();
        if (r) return r;
      }
            const local = motor ? await fichaLocal(motor, { perfil: usuario?.perfil ?? null, parametros, agora: relogioReal().agora().toISOString(), clienteId, produtoId: id, usuarioId }) : null;
      if (local) return { fase: 'pronta', ficha: local, noAparelho: true };
      if (modo === 'sem_sinal') return { fase: 'catalogo_carregando' };
      if (!ambiente.online() || !id) return { fase: 'nao_encontrado' };
      return modo === 'api' ? { fase: 'nao_encontrado' } : ((await daApi()) ?? { fase: 'nao_encontrado' });
    };
    void carregar().then((e) => vivo && setEstado(e));
    return () => {
      vivo = false;
    };
  }, [motor, id, clienteId, parametros, ambiente, usuario?.perfil, usuarioId, sync.sincronizado_em, modo]);

  // T-0172: título, subtítulo e voltar na faixa Azul noite do kit (docs/design/componentes.md §5.2)
  const voltar = { label: 'Catálogo', fallback: hrefCatalogo(clienteId) };
  if (estado.fase === 'carregando') {
    return (
      <Screen testID="pagina-catalogo-produto" cabecalho={{ titulo: 'Produto', voltar }}>
        <ActivityIndicator color={colors.accent} />
      </Screen>
    );
  }
  if (estado.fase === 'catalogo_carregando') {
    return (
      <Screen testID="pagina-catalogo-produto" cabecalho={{ titulo: 'Produto', voltar }}>
        <CatalogoCarregando comTitulo />
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
  // catalogo-campo-v2 §2: "Estoque: N" (exato, sem o 999+ do cartão) com o botão "Por filial"; a tabela e a hora ficam na folha
  const estoque = tagDeEstoque(item, { noCartao: false });
  const folha = item.availability && usuario?.perfil ? dadosDaFolha({ codigo: item.erp_code, availability: item.availability, cargaEm: sync.sincronizado_em, filialCadastro: filialCadastroId, agora: relogioReal().agora().toISOString(), fuso }) : null;
  return (
    <Screen testID="pagina-catalogo-produto" cabecalho={{ titulo: item.description, subtitulo: `${subtituloProduto(item)} · ${item.unit}${item.ean ? ` · EAN ${item.ean}` : ''}`, voltar, direita: <BotaoCopiarCodigo codigo={item.erp_code} variante="faixa" /> }}>
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
            <View style={s.estoqueLinha}>
              <ChipEstado texto={estoque.texto} tom={estoque.tom} rotuloAcessivel={leituraDoEstoque(item) ?? estoque.texto} testID="produto-estoque" />
              <BotaoPorFilialDaFicha onPress={() => setFolhaAberta(true)} />
            </View>
          ) : null}
        </Card>
      ) : null}

      <FolhaEstoquePorFilial visivel={folhaAberta} onFechar={() => setFolhaAberta(false)} dados={folha} />
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
  estoqueLinha: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  linha: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  preco: { fontFamily: fonts.display, fontSize: 24, color: colors.ink },
  semPreco: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink2 },
  riscado: { fontFamily: fonts.body, fontSize: 14, color: colors.ink3, textDecorationLine: 'line-through' },
  verMais: { minHeight: 48, justifyContent: 'center' },
  verMaisTexto: { fontFamily: fonts.semibold, fontSize: 14, color: colors.accentInk },
  ofereceJunto: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  etiquetas: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  atributo: { flexDirection: 'row', gap: 12, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
});
