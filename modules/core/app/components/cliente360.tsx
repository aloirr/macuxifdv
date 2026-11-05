/**
 * Seções do Cliente 360 (RF-CORE-04; desenho T-0016 §3.4), montadas com as linhas do aparelho: funcionam em modo
 * avião. Ligar, WhatsApp e mapa em 1 toque (alvos ≥ 48 dp). Valores em centavos formatados com `formatBRL0`.
 * As abas de módulos (`cliente.abas`) são desenhadas pela tela da ficha, não aqui.
 */
import { formatBRL0 } from '@macuxi/comum';
import { Badge, Card, EtiquetaCadastroIncompleto, ObservacoesCliente, colors, fonts, Icon, radius, SectionHeader, type as t, type IconName } from '@macuxi/ui/mobile';
import type { ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Cliente360Local } from '../lib/cliente360-local';
import { mapsUrl } from '../lib/route';
import { observacaoComCadastro } from '../../domain';

const num = (v: string | number | null): number | null => (v === null || v === '' ? null : Number(v));
const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const mesBr = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;

export function nomeDoCliente(c: Cliente360Local['cliente']): string {
  return c.nome_fantasia?.trim() || c.razao_social;
}

export function enderecoDoCliente(c: Cliente360Local['cliente']): string {
  return [c.logradouro && c.numero ? `${c.logradouro}, ${c.numero}` : c.logradouro, c.bairro, c.cidade && c.uf ? `${c.cidade}/${c.uf}` : c.cidade]
    .filter(Boolean)
    .join(' · ');
}

/** Ligar, WhatsApp e mapa: uma linha de 3 botões de 48 dp. */
export function AcoesContato({ ficha }: { ficha: Cliente360Local }) {
  const c = ficha.cliente;
  const abrir = (url: string | null) => {
    if (url) void Linking.openURL(url);
  };
  return (
    <View style={{ flexDirection: 'row', gap: 8 }} testID="cliente-acoes-contato">
      <Acao icon="phone" label="Ligar" desligado={!ficha.ligar} onPress={() => abrir(ficha.ligar)} testID="cliente-ligar" />
      <Acao icon="chat" label="WhatsApp" desligado={!ficha.whatsapp} onPress={() => abrir(ficha.whatsapp)} testID="cliente-whatsapp" />
      <Acao icon="navigate" label="Mapa" onPress={() => abrir(mapsUrl(num(c.latitude), num(c.longitude), enderecoDoCliente(c)))} testID="cliente-mapa" />
    </View>
  );
}

export function CabecalhoCliente({ ficha }: { ficha: Cliente360Local }) {
  const c = ficha.cliente;
  const fin = ficha.resumo_financeiro;
  return (
    <View style={{ gap: 6 }}>
      <Text style={t.h1Small} testID="customer-name">
        {nomeDoCliente(c)}
      </Text>
      <Text style={t.sub}>{enderecoDoCliente(c) || 'Endereço não informado'}</Text>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        {c.segmento ? <Badge label={c.segmento} tone="neutral" /> : null}
        {fin?.bloqueado ? <Badge label={`Bloqueado${fin.motivo_bloqueio ? ` · ${fin.motivo_bloqueio}` : ''}`} tone="danger" /> : null}
        {fin && fin.vencidos_qtd > 0 ? <Badge label={`${fin.vencidos_qtd} vencido${fin.vencidos_qtd > 1 ? 's' : ''}`} tone="danger" /> : null}
        {c.cadastro_incompleto ? <EtiquetaCadastroIncompleto /> : null}
        {!c.ativo ? <Badge label="Inativo" tone="warning" /> : null}
      </View>
    </View>
  );
}

/**
 * `indicadoresIniciais`: cartões que a tela já montou (ex.: Compra média, Última compra, Limite, Títulos vencidos) e que
 * entram no começo da MESMA grade, na ordem da referência (T-0076). Com eles, "Última compra" não se repete aqui.
 */
export function SecoesCliente360({ ficha, indicadoresIniciais }: { ficha: Cliente360Local; indicadoresIniciais?: ReactNode }) {
  const fin = ficha.resumo_financeiro;
  const compras = ficha.resumo_compras;
  const vencidos = ficha.titulos.filter((x) => x.situacao_calculada === 'vencido');
  const aVencer = ficha.titulos.filter((x) => x.situacao_calculada === 'a_vencer');
  return (
    <View style={{ gap: 14 }} testID="cliente-360">
      {/* RN-PRO-01: com a opção promotor_ve_pedidos desligada o promotor não vê compras, valores nem contagem de pedidos */}
      {ficha.pedidos_visiveis || indicadoresIniciais ? (
        <View style={styles.grid}>
          {indicadoresIniciais}
          {ficha.pedidos_visiveis ? (
            <>
              {indicadoresIniciais ? null : <Stat label="Última compra" value={ultimaCompraDaFicha(compras.dias_sem_compra)} aviso={compras.dias_sem_compra === null || compras.dias_sem_compra >= 45} />}
              <Stat label="Ticket médio" value={formatBRL0(compras.ticket_medio_cents)} />
              <Stat label="Frequência média" value={compras.frequencia_media_dias === null ? '—' : `a cada ${Math.round(compras.frequencia_media_dias)} dias`} />
              <Stat label="Compras em 12 meses" value={formatBRL0(compras.total_12m_cents)} />
            </>
          ) : null}
        </View>
      ) : null}

      <View style={{ gap: 8 }}>
        <SectionHeader title="Contatos" />
        {ficha.contatos.length === 0 ? (
          <Text style={t.sub}>Nenhum contato cadastrado. O telefone do cadastro do cliente é usado no botão Ligar.</Text>
        ) : (
          <Card>
            {ficha.contatos.map((c, i) => (
              <View key={c.id} style={[styles.row, i < ficha.contatos.length - 1 && styles.divider]}>
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={t.bodyStrong}>
                    {c.nome}
                    {c.principal ? ' · principal' : ''}
                  </Text>
                  {c.cargo ? <Text style={t.small}>{c.cargo}</Text> : null}
                </View>
                {c.tel ? <Mini icon="phone" label={`Ligar para ${c.nome}`} onPress={() => void Linking.openURL(c.tel!)} /> : null}
                {c.whatsapp_url ? <Mini icon="chat" label={`WhatsApp de ${c.nome}`} onPress={() => void Linking.openURL(c.whatsapp_url!)} /> : null}
              </View>
            ))}
          </Card>
        )}
      </View>

      {/* RF-CORE-12 / RN-VEN-17: endereços de entrega do ERP, o padrão (principal) destacado e primeiro; lidos do aparelho */}
      <View style={{ gap: 8 }} testID="cliente-enderecos">
        <SectionHeader title="Endereços de entrega" />
        {ficha.enderecos.length === 0 ? (
          <Text style={t.sub}>Nenhum endereço de entrega neste aparelho. Sincronize quando houver sinal; endereço novo entra pelo cadastro no ERP.</Text>
        ) : (
          <Card>
            {ficha.enderecos.map((e, i) => (
              <View key={e.id} testID={e.padrao ? 'cliente-endereco-padrao' : 'cliente-endereco'} style={[styles.row, { minHeight: 48 }, i < ficha.enderecos.length - 1 && styles.divider, e.padrao && { backgroundColor: colors.surface }]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    {e.descricao ? <Text style={t.bodyStrong}>{e.descricao}</Text> : null}
                    {e.padrao ? <Badge label="Padrão" tone="success" /> : null}
                    {e.tipo === 'cobranca' ? <Badge label="Cobrança" tone="neutral" /> : null}
                  </View>
                  <Text style={e.padrao ? t.bodyStrong : t.body}>{e.resumo}</Text>
                </View>
                <Mini icon="navigate" label={`Abrir no mapa: ${e.resumo}`} onPress={() => void Linking.openURL(mapsUrl(num(e.latitude), num(e.longitude), e.resumo))} />
              </View>
            ))}
          </Card>
        )}
      </View>

      {/* RN-CORE-17: linha automática de cadastro incompleto no topo, texto do ERP intacto abaixo (montada aqui, nunca gravada) */}
      <ObservacoesCliente automatica={observacaoComCadastro(null, ficha.cliente.cadastro_campos_faltantes ?? [])} texto={ficha.cliente.observacao ?? null} />

      <View style={{ gap: 8 }} testID="cliente-financeiro">
        <SectionHeader title="Financeiro" />
        {!fin ? (
          <Text style={t.sub}>Sem dados financeiros neste aparelho. Sincronize quando houver sinal.</Text>
        ) : (
          <>
            <View style={styles.grid}>
              <Stat label="Limite" value={formatBRL0(fin.limite_cents)} />
              <Stat label="Saldo em aberto" value={formatBRL0(fin.saldo_aberto_cents)} />
              <Stat label="Crédito disponível" value={formatBRL0(fin.credito_disponivel_cents)} aviso={fin.credito_disponivel_cents <= 0} />
              <Stat label="Vencidos" value={fin.vencidos_qtd === 0 ? 'Nenhum' : `${fin.vencidos_qtd} · ${formatBRL0(fin.vencidos_cents)}`} aviso={fin.vencidos_qtd > 0} />
            </View>
            {fin.bloqueado ? <Text style={[t.small, { color: colors.danger }]}>Cliente bloqueado{fin.motivo_bloqueio ? `: ${fin.motivo_bloqueio}` : ''}.</Text> : null}
            {vencidos.length + aVencer.length > 0 ? (
              <Card>
                {[...vencidos, ...aVencer].map((x, i, todos) => (
                  <View key={x.id} style={[styles.row, i < todos.length - 1 && styles.divider]}>
                    <View style={{ flex: 1, gap: 1 }}>
                      <Text style={[t.bodyStrong, { fontFamily: fonts.mono, fontSize: 13 }]}>
                        {x.documento}
                        {x.parcela ? ` · ${x.parcela}` : ''}
                      </Text>
                      <Text style={[t.small, x.situacao_calculada === 'vencido' ? { color: colors.danger } : null]}>
                        {x.situacao_calculada === 'vencido' ? `venceu ${dataBr(x.vencimento)} · ${x.dias_atraso} dias` : `vence ${dataBr(x.vencimento)}`}
                      </Text>
                    </View>
                    <Text style={t.bodyStrong}>{formatBRL0(x.saldo_cents)}</Text>
                  </View>
                ))}
              </Card>
            ) : null}
          </>
        )}
      </View>

      {ficha.pedidos_visiveis ? (
      <View style={{ gap: 8 }} testID="cliente-historico">
        <SectionHeader title="Compras dos últimos 12 meses" />
        {ficha.historico.length === 0 ? (
          <Text style={t.sub}>Sem compras nos últimos 12 meses.</Text>
        ) : (
          <Card>
            {ficha.historico.map((h, i) => (
              <View key={h.id} style={[styles.row, { minHeight: 48 }, i < ficha.historico.length - 1 && styles.divider]}>
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={t.bodyStrong}>{mesBr(h.ano_mes)}</Text>
                  <Text style={t.small}>
                    {h.pedidos} pedido{h.pedidos === 1 ? '' : 's'} · {h.itens} iten{h.itens === 1 ? '' : 's'}
                  </Text>
                </View>
                <Text style={t.bodyStrong}>{formatBRL0(h.valor_cents)}</Text>
              </View>
            ))}
          </Card>
        )}
      </View>
      ) : null}
    </View>
  );
}

function Acao({ icon, label, onPress, desligado, testID }: { icon: IconName; label: string; onPress: () => void; desligado?: boolean; testID: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={desligado ? `${label} indisponível: sem número cadastrado` : label}
      accessibilityState={{ disabled: Boolean(desligado) }}
      disabled={desligado}
      onPress={onPress}
      style={({ pressed }) => [styles.action, desligado && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}>
      <Icon name={icon} size={16} color={colors.ink} strokeWidth={1.9} />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

function Mini({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={4} style={styles.mini}>
      <Icon name={icon} size={18} color={colors.ink} strokeWidth={1.9} />
    </Pressable>
  );
}

/** Valor do cartão "Última compra" (minúsculo, como na referência). */
export function ultimaCompraDaFicha(dias: number | null): string {
  return dias === null ? 'Nunca comprou' : dias === 0 ? 'hoje' : `há ${dias} dias`;
}

function Stat({ label, value, aviso }: { label: string; value: string; aviso?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={t.small}>{label}</Text>
      <Text style={[t.number, aviso ? { color: colors.danger } : null]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  action: { flex: 1, height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  actionText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  mini: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { flexBasis: '48%', flexGrow: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 12, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingRight: 4, paddingLeft: 14, minHeight: 48 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
});
