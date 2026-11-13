/**
 * Seções do Cliente 360 (RF-CORE-04; desenho T-0016 §3.4), montadas com as linhas do aparelho: funcionam em modo
 * avião. Ligar, WhatsApp e mapa em 1 toque (alvos ≥ 48 dp). Valores em centavos formatados com `formatBRL0`.
 * As abas de módulos (`cliente.abas`) são desenhadas pela tela da ficha, não aqui.
 */
import { formatBRL0 } from '@macuxi/comum';
import { Badge, Card, ObservacoesCliente, colors, fonts, Icon, radius, SectionHeader, type as t, type IconName } from '@macuxi/ui/mobile';
import type { ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Cliente360Local } from '../lib/cliente360-local';
import { fotoPdvTrancada } from '../lib/foto-fachada';
import { mapsUrl } from '../lib/route';
import { observacaoComCadastro, resumoSemCompras } from '../../domain';

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

/** Ligar, WhatsApp, mapa e (com fotos do PDV) Foto do PDV: botões iguais em pé, 64 dp de altura (T-0147, spec permissoes-e-fotos-pdv §2). */
export function AcoesContato({ ficha, onVerFotoPdv }: { ficha: Cliente360Local; onVerFotoPdv?: () => void }) {
  const c = ficha.cliente;
  const abrir = (url: string | null) => {
    if (url) void Linking.openURL(url);
  };
  return (
    <View style={{ flexDirection: 'row', gap: 8 }} testID="cliente-acoes-contato">
      <Acao icon="phone" label="Ligar" desligado={!ficha.ligar} rotuloDesligado="Ligar indisponível: sem número cadastrado" onPress={() => abrir(ficha.ligar)} testID="cliente-ligar" />
      <Acao icon="chat" label="WhatsApp" desligado={!ficha.whatsapp} rotuloDesligado="WhatsApp indisponível: sem número cadastrado" onPress={() => abrir(ficha.whatsapp)} testID="cliente-whatsapp" />
      <Acao icon="navigate" label="Mapa" onPress={() => abrir(mapsUrl(num(c.latitude), num(c.longitude), enderecoDoCliente(c)))} testID="cliente-mapa" />
      {/* RN-CORE-38: ligado só com a fachada enviada e com o visualizador do shell registrado */}
      {ficha.fotos_pdv ? (
        <Acao
          icon="galeria"
          label="Foto do PDV"
          desligado={!ficha.fotos_pdv.fachada_foto || !onVerFotoPdv}
          rotuloLigado="Ver foto do PDV"
          rotuloDesligado="Foto do PDV indisponível: sem foto da fachada"
          onPress={() => onVerFotoPdv?.()}
          testID="cliente-foto-pdv"
        />
      ) : null}
    </View>
  );
}

/** RN-CORE-38: resumo tem/falta por tipo, logo abaixo das ações; cadeado por `fotoPdvTrancada`. */
/** `onAdicionar` (tipo que falta): abre a captura do shell (câmera ou galeria); sem ele (sem porta do shell), não há botão. */
export function BlocoFotosPdv({ ficha, onAdicionar }: { ficha: Cliente360Local; onAdicionar?: (tipoId: string) => void }) {
  if (!ficha.fotos_pdv) return null;
  return (
    <View style={{ gap: 8 }} testID="cliente-fotos-pdv">
      <SectionHeader title="Fotos do PDV" />
      <Card>
        {ficha.fotos_pdv.itens.map((i, n, todos) => (
          <View key={i.tipo_id} style={[styles.row, { minHeight: 52 }, n < todos.length - 1 && styles.divider]}>
            <Text style={[t.body, { flex: 1 }]}>{i.nome}</Text>
            {i.na_fila ? (
              <Text style={[t.small, { color: colors.ink2, fontFamily: fonts.semibold }]}>Na fila</Text>
            ) : i.situacao === 'tem' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Icon name="check" size={14} color={colors.success} strokeWidth={2.4} />
                <Text style={[t.small, { color: colors.success, fontFamily: fonts.semibold }]}>Tem</Text>
              </View>
            ) : (
              <Text style={[t.small, { color: i.obrigatorio ? colors.danger : colors.ink2, fontFamily: fonts.semibold }]}>{i.obrigatorio ? 'Falta' : 'Opcional'}</Text>
            )}
            {i.situacao === 'falta' && onAdicionar ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Adicionar foto: ${i.nome}`}
                onPress={() => onAdicionar(i.tipo_id)}
                style={styles.adicionar}
                testID={`cliente-foto-adicionar-${i.tipo_id}`}
              >
                <Icon name="camera" size={16} color={colors.accent} />
                <Text style={[t.small, { color: colors.accent, fontFamily: fonts.semibold }]}>Adicionar</Text>
              </Pressable>
            ) : null}
            {fotoPdvTrancada(i) ? <Icon name="lock" size={16} color={colors.ink2} /> : null}
          </View>
        ))}
      </Card>
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
        {/* RD-0065: o motivo do bloqueio e os vencidos aparecem só no bloco Financeiro */}
        {fin?.bloqueado ? <Badge label="Bloqueado" tone="danger" /> : null}
        {!c.ativo ? <Badge label="Inativo" tone="warning" /> : null}
      </View>
    </View>
  );
}

/**
 * `indicadoresIniciais`: cartões que a tela já montou (Compra média, Última compra; limite e vencidos ficam só no Financeiro, T-0146) e que
 * entram no começo da MESMA grade, na ordem da referência (T-0076). Com eles, "Última compra" não se repete aqui.
 */
export function SecoesCliente360({ ficha, indicadoresIniciais }: { ficha: Cliente360Local; indicadoresIniciais?: ReactNode }) {
  const fin = ficha.resumo_financeiro;
  const compras = ficha.resumo_compras;
  const vencidos = ficha.titulos.filter((x) => x.situacao_calculada === 'vencido');
  const aVencer = ficha.titulos.filter((x) => x.situacao_calculada === 'a_vencer');
  // RN-CORE-40: sem compra na janela de 12 meses, uma linha no lugar dos indicadores de compra, sem zeros
  const semCompras = ficha.pedidos_visiveis && resumoSemCompras(compras);
  return (
    <View style={{ gap: 14 }} testID="cliente-360">
      {/* RN-PRO-01: com a opção promotor_ve_pedidos desligada o promotor não vê compras, valores nem contagem de pedidos */}
      {semCompras ? (
        <Text style={t.sub} testID="cliente-sem-compras">
          Sem compras em 12 meses
        </Text>
      ) : ficha.pedidos_visiveis || indicadoresIniciais ? (
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

      {ficha.filial_rotulo ? (
        <Text style={t.sub} testID="cliente-filial">
          Filial: {ficha.filial_rotulo}
        </Text>
      ) : null}

      <View style={{ gap: 8 }}>
        <SectionHeader title="Contatos" />
        {ficha.contatos.length === 0 ? (
          <Text style={t.sub}>Nenhum contato cadastrado.</Text>
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
          <Text style={t.sub}>Nenhum endereço de entrega. Sincronize para atualizar.</Text>
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
          <Text style={t.sub}>Sem dados financeiros. Sincronize para atualizar.</Text>
        ) : (
          <>
            <View style={styles.grid}>
              <Stat label="Limite" value={formatBRL0(fin.limite_cents)} />
              <Stat label="Saldo em aberto" value={formatBRL0(fin.saldo_aberto_cents)} />
              <Stat label="Crédito disponível" value={formatBRL0(fin.credito_disponivel_cents)} aviso={fin.credito_disponivel_cents <= 0} />
              <Stat label="Vencidos" value={fin.vencidos_qtd === 0 ? 'Nenhum' : `${fin.vencidos_qtd} · ${formatBRL0(fin.vencidos_cents)}`} aviso={fin.vencidos_qtd > 0} />
            </View>
            {fin.bloqueado && fin.motivo_bloqueio ? <Text style={[t.small, { color: colors.danger }]}>Motivo do bloqueio: {fin.motivo_bloqueio}</Text> : null}
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

      {ficha.pedidos_visiveis && !semCompras ? (
      <View style={{ gap: 8 }} testID="cliente-historico">
        <SectionHeader title="Compras dos últimos 12 meses" />
        {ficha.historico.length === 0 ? null : (
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

function Acao({
  icon,
  label,
  onPress,
  desligado,
  rotuloDesligado,
  rotuloLigado,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  desligado?: boolean;
  rotuloDesligado?: string;
  rotuloLigado?: string;
  testID: string;
}) {
  const cor = desligado ? colors.ink3 : colors.ink;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={desligado ? (rotuloDesligado ?? `${label} indisponível`) : (rotuloLigado ?? label)}
      accessibilityState={{ disabled: Boolean(desligado) }}
      disabled={desligado}
      onPress={onPress}
      style={({ pressed }) => [styles.action, desligado && styles.actionOff, pressed && { opacity: 0.7 }]}>
      <Icon name={icon} size={20} color={cor} strokeWidth={1.9} />
      <Text style={[styles.actionText, { color: cor }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
        {label}
      </Text>
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
  action: { flex: 1, height: 64, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 0 },
  actionOff: { backgroundColor: colors.neutralBg, borderWidth: 0 },
  actionText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink },
  mini: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { flexBasis: '48%', flexGrow: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 12, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingRight: 4, paddingLeft: 14, minHeight: 48 },
  adicionar: { minHeight: 48, minWidth: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 8 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
});
