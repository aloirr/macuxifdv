/**
 * Aba Resumo da ficha (T-0186, spec §3), igual no Campo e no Gestão. Ordem: Dados cadastrais · crédito (Limite, Saldo disponível e Prazo
 * médio) · Endereços · Contatos · Performance · Últimos itens comprados · seções dos módulos · Observações. Tudo lido do aparelho
 * (modo avião). Sem alerta financeiro na ficha (R-20261119-0440).
 */
import { Badge, ObservacoesCliente, SectionHeader, colors, type as t } from '@macuxi/ui/mobile';
import { useState, type ReactNode } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';

import type { CartaoCredito } from '../../contracts';
import { observacaoComCadastro, type PerformanceCalculada } from '../../domain';
import type { Cliente360Local } from '../lib/cliente360-local';
import { dataCurta, linhasCartaoCredito, linhasDadosCadastrais, linhasPerformance, tituloDaCarteira, valorSemMoeda } from '../lib/ficha-v2';
import { mapsUrl } from '../lib/route';
import { BotaoCelula, CelulaTexto, TabelaFicha, TabelaRotuloValor, type LinhaFicha } from './tabelas-ficha';

const num = (v: string | number | null): number | null => (v === null || v === '' ? null : Number(v));

export interface ItemCompradoLinha {
  produto_id: string;
  nome: string;
  quantidade: number;
  unidade: string | null;
  data_local: string;
  total_cents: number;
  /** SKU do produto (2ª linha do Produto). */
  codigo: string | null;
}

export interface PessoaDaCarteira {
  id: string;
  nome: string;
  tel: string | null;
  whatsapp_url: string | null;
}

/** RN-CORE-50: os 3 últimos e "Ver os 20 itens ›". */
const ITENS_NO_INICIO = 3;

export function AbaResumo({
  ficha,
  cartao,
  performance,
  gestao,
  clienteDesde,
  itens,
  secoes,
  atendimento,
  carteira,
}: {
  ficha: Cliente360Local;
  cartao: CartaoCredito | null;
  performance: PerformanceCalculada;
  gestao: boolean;
  clienteDesde: string | null;
  itens: readonly ItemCompradoLinha[];
  /** Seções de outros módulos (`cliente.abas`), cada uma com o cabeçalho. */
  secoes?: ReactNode;
  /** "Em atendimento · desde 09:41" (aviso que não é financeiro). */
  atendimento?: string | null;
  /** Gestão: quem tem o cliente na carteira (spec §3.5); sem a lista, a tabela não aparece. */
  carteira?: readonly PessoaDaCarteira[];
}) {
  const [todos, setTodos] = useState(false);
  const c = ficha.cliente;
  const credito = linhasCartaoCredito(cartao);
  const perf = linhasPerformance(performance, { gestao });
  const visiveis = todos ? itens : itens.slice(0, ITENS_NO_INICIO);
  return (
    <View style={{ gap: 14 }} testID="cliente-resumo">
      {!c.ativo || atendimento ? (
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }} testID="cliente-tags">
          {!c.ativo ? <Badge label="Inativo" tone="warning" /> : null}
          {atendimento ? <Badge label={atendimento} tone="accent" /> : null}
        </View>
      ) : null}

      <View style={{ gap: 8 }} testID="cliente-cadastro">
        <SectionHeader title="Dados cadastrais" />
        <TabelaRotuloValor linhas={linhasDadosCadastrais(c, ficha.filial_rotulo, clienteDesde)} larguraRotulo={104} />
      </View>

      {credito ? <TabelaRotuloValor linhas={credito} testID="cliente-credito" /> : null}

      <View style={{ gap: 8 }} testID="cliente-enderecos">
        <SectionHeader title="Endereços" />
        {ficha.enderecos.length === 0 ? (
          <Text style={t.sub}>Nenhum endereço cadastrado.</Text>
        ) : (
          <TabelaFicha
            colunas={[
              { id: 'local', titulo: 'Local' },
              { id: 'endereco', titulo: 'Endereço' },
              { id: 'mapa', titulo: 'Mapa', largura: 48, alinhar: 'centro' },
            ]}
            linhas={ficha.enderecos.map<LinhaFicha>((e) => ({
              tipo: 'linha',
              key: e.id,
              testID: e.padrao ? 'cliente-endereco-padrao' : 'cliente-endereco',
              celulas: [
                <CelulaTexto key="l" principal={e.descricao || (e.tipo === 'cobranca' ? 'Cobrança' : 'Entrega')} segunda={e.padrao ? 'Padrão' : null} />,
                <CelulaTexto key="e" principal={e.resumo} mudo />,
                <BotaoCelula key="m" icone="navigate" rotulo={`Abrir no mapa: ${e.resumo}`} onPress={() => void Linking.openURL(mapsUrl(num(e.latitude), num(e.longitude), e.resumo))} />,
              ],
            }))}
          />
        )}
      </View>

      <View style={{ gap: 8 }} testID="cliente-contatos">
        <SectionHeader title="Contatos" />
        {ficha.contatos.length === 0 ? (
          <Text style={t.sub}>Nenhum contato cadastrado.</Text>
        ) : (
          <TabelaFicha
            colunas={[
              { id: 'nome', titulo: 'Nome' },
              { id: 'cargo', titulo: 'Cargo' },
              { id: 'ligar', titulo: 'Ligar', largura: 48, alinhar: 'centro' },
              { id: 'zap', titulo: 'WhatsApp', largura: 60, alinhar: 'centro' },
            ]}
            linhas={ficha.contatos.map<LinhaFicha>((ct) => ({
              tipo: 'linha',
              key: ct.id,
              celulas: [
                <CelulaTexto key="n" principal={ct.nome} segunda={ct.principal ? 'Principal' : null} />,
                <CelulaTexto key="c" principal={ct.cargo ?? '—'} mudo />,
                <BotaoCelula key="t" icone="phone" rotulo={ct.tel ? `Ligar para ${ct.nome}` : `Ligar indisponível: ${ct.nome} sem número`} desligado={!ct.tel} onPress={() => ct.tel && void Linking.openURL(ct.tel)} testID={`cliente-ligar-${ct.id}`} />,
                <BotaoCelula key="w" icone="chat" rotulo={ct.whatsapp_url ? `WhatsApp de ${ct.nome}` : `WhatsApp indisponível: ${ct.nome} sem número`} desligado={!ct.whatsapp_url} onPress={() => ct.whatsapp_url && void Linking.openURL(ct.whatsapp_url)} testID={`cliente-whatsapp-${ct.id}`} />,
              ],
            }))}
          />
        )}
      </View>

      {gestao && carteira && carteira.length > 0 ? (
        <View style={{ gap: 8 }} testID="cliente-carteira">
          <SectionHeader title="Carteira" />
          <TabelaFicha
            colunas={[
              { id: 'pessoa', titulo: tituloDaCarteira(carteira.length) },
              { id: 'ligar', titulo: 'Ligar', largura: 48, alinhar: 'centro' },
              { id: 'zap', titulo: 'WhatsApp', largura: 60, alinhar: 'centro' },
            ]}
            linhas={carteira.map<LinhaFicha>((p) => ({
              tipo: 'linha',
              key: p.id,
              celulas: [
                <CelulaTexto key="n" principal={p.nome} />,
                <BotaoCelula key="t" icone="phone" rotulo={p.tel ? `Ligar para ${p.nome}` : `Ligar indisponível: ${p.nome} sem número`} desligado={!p.tel} onPress={() => p.tel && void Linking.openURL(p.tel)} testID={`carteira-ligar-${p.id}`} />,
                <BotaoCelula key="w" icone="chat" rotulo={p.whatsapp_url ? `WhatsApp de ${p.nome}` : `WhatsApp indisponível: ${p.nome} sem número`} desligado={!p.whatsapp_url} onPress={() => p.whatsapp_url && void Linking.openURL(p.whatsapp_url)} testID={`carteira-whatsapp-${p.id}`} />,
              ],
            }))}
          />
        </View>
      ) : null}

      <View style={{ gap: 8 }} testID="cliente-performance">
        <SectionHeader title={perf.titulo} />
        <TabelaRotuloValor linhas={perf.linhas} />
        {perf.semCompras ? (
          <Text style={t.sub} testID="cliente-sem-compras">
            Sem compras em 12 meses
          </Text>
        ) : null}
      </View>

      {itens.length > 0 ? (
        <View style={{ gap: 8 }} testID="cliente-ultimos-itens">
          <SectionHeader title="Últimos itens comprados" />
          <TabelaFicha
            colunas={[
              { id: 'produto', titulo: 'Produto' },
              { id: 'qtd', titulo: 'Qtd', largura: 52, alinhar: 'dir' },
              { id: 'data', titulo: 'Data', largura: 44 },
              { id: 'total', titulo: 'Total (R$)', largura: 72, alinhar: 'dir' },
            ]}
            linhas={visiveis.map<LinhaFicha>((i) => ({
              tipo: 'linha',
              key: i.produto_id,
              celulas: [
                <CelulaTexto key="p" principal={i.nome} segunda={i.codigo} segundaCodigo />,
                <CelulaTexto key="q" principal={`${i.quantidade}${i.unidade ? ` ${i.unidade}` : ''}`} dir />,
                <CelulaTexto key="d" principal={dataCurta(i.data_local)} mudo />,
                <CelulaTexto key="t" principal={valorSemMoeda(i.total_cents)} dir />,
              ],
            }))}
          />
          {!todos && itens.length > ITENS_NO_INICIO ? (
            <Pressable accessibilityRole="button" onPress={() => setTodos(true)} style={{ minHeight: 48, justifyContent: 'center' }} testID="cliente-ver-itens">
              <Text style={[t.bodyStrong, { color: colors.accentInk }]}>{`Ver os ${itens.length} itens ›`}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {secoes}

      {/* RN-CORE-17: linha automática de cadastro incompleto no topo, texto do ERP intacto abaixo (montada aqui, nunca gravada) */}
      <ObservacoesCliente automatica={observacaoComCadastro(null, c.cadastro_campos_faltantes ?? [])} texto={c.observacao ?? null} />
    </View>
  );
}
