/**
 * Ficha do vendedor ou promotor no dia (RF-GES-02/10) e o pedido em nome (RF-GES-05, RN-VEN-35).
 * Online: ficha da API (com a disponibilidade do pedido em nome). Offline: monta do cache da visão, sem pedido em nome.
 * O pedido em nome é do Vendedor (slot `pedido.criar_em_nome`): sem item registrado, ou sem o Vendedor ativo, o botão
 * simplesmente não aparece (RN-CORE-03). RN-PRO-01: na ficha do promotor nunca há pedido.
 */
import { formatBRL0 } from '@macuxi/comum';
import { ROTULO_INDICADOR_META } from '@macuxi/core/contracts';
import { useExtensoes } from '@macuxi/platform-sdk/react';
import { BackLink, Banner, Botao, Cartao, ChipEstado, EstadoVazio, Loading, Screen, SyncStamp, type as t } from '@macuxi/ui/mobile';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { ContextoPedidoEmNome, FichaMembro, PainelDia } from '../../contracts';
import { relogioReal } from '@macuxi/comum/relogio';
import { statusAgora } from '../../domain/agora-status';
import { fracao } from '../lib/apresentacao';
import { PARADO_MIN_PADRAO, STATUS_AGORA_ROTULO } from '../lib/equipe-agora';
import { pct } from '../lib/formato';
import { CAMINHO_EQUIPE } from '../rotas';
import { useGestor } from '../state/use-gestor';

/**
 * Formato esperado do item do slot `pedido.criar_em_nome` (o contrato oficial é do Vendedor; pedido por recado na
 * T-0055): abre o novo pedido do Vendedor já com o vendedor dono da venda e o gestor autor; o cliente se escolhe lá.
 */
interface AcaoPedidoEmNome {
  rotulo?: string;
  abrir(contexto: Pick<ContextoPedidoEmNome, 'vendedor_id' | 'autor_id'> & { vendedor_nome?: string }): void;
}

export default function FichaScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const g = useGestor();
  const [estado, setEstado] = useState<{ ficha: FichaMembro | null; doCache: boolean; erro: string | null } | null>(null);
  const emNome = useExtensoes<AcaoPedidoEmNome>('pedido.criar_em_nome');
  const [tentativa, setTentativa] = useState(0);
  useEffect(() => {
    if (id && g.carregado) void g.ficha(id).then(setEstado);
  }, [id, g.carregado, g.ficha, tentativa]);
  /** Tentar de novo: volta ao carregando e refaz a carga da ficha. */
  const tentarDeNovo = () => {
    setEstado(null);
    setTentativa((n) => n + 1);
  };

  if (!estado) return <Loading />;
  const f = estado.ficha;
  if (!f) {
    return (
      <Screen testID="gestor-ficha">
        <BackLink label="Equipe" fallback={`/m/${CAMINHO_EQUIPE}`} />
        <EstadoVazio icone="users" titulo={estado.erro ? 'Não deu para abrir a ficha' : 'Esta pessoa não está na sua equipe'} texto={estado.erro ?? 'Volte à equipe e escolha outra pessoa.'} />
        {estado.erro ? <Botao testID="gestor-ficha-tentar-de-novo" nivel="principal" rotulo="Tentar de novo" icone="sync" onPress={tentarDeNovo} /> : null}
      </Screen>
    );
  }
  const p = f.painel;
  const s = STATUS_AGORA_ROTULO[statusAgora({ status_dia: p.status_dia, paradas_planejadas: p.paradas_planejadas, paradas_pendentes: p.paradas_pendentes, ultimo_checkout_em: p.ultimo_checkout_em, parado_min: g.visao?.parado_min ?? PARADO_MIN_PADRAO, agora: relogioReal().agora().toISOString() }).status];
  const acao = f.pedido_em_nome.permitido && g.usuarioId ? emNome[0] : undefined;
  return (
    <Screen testID="gestor-ficha">
      <BackLink label="Equipe" fallback={`/m/${CAMINHO_EQUIPE}`} />
      <View style={{ gap: 4 }}>
        <Text style={t.h1}>{f.membro.nome}</Text>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Text style={t.small}>{f.membro.perfil === 'promotor' ? 'Promotor' : 'Vendedor'}</Text>
          <ChipEstado texto={s.label} tom={s.tom} pequeno />
        </View>
        <SyncStamp at={g.sincronizado_em} offline={g.offline} tz={g.tz} />
      </View>
      {estado.erro && !estado.doCache ? <Banner tone="danger">{estado.erro}</Banner> : null}
      <Secoes p={f.painel} />
      {acao && g.usuarioId ? (
        <Botao
          testID="gestor-pedido-em-nome"
          nivel="principal"
          rotulo={acao.payload.rotulo ?? `Fazer pedido em nome de ${f.membro.nome.split(' ')[0]}`}
          icone="plus"
          onPress={() => acao.payload.abrir({ vendedor_id: f.membro.id, autor_id: g.usuarioId!, vendedor_nome: f.membro.nome })}
        />
      ) : null}
      {f.pedido_em_nome.visivel && !f.pedido_em_nome.permitido && f.pedido_em_nome.mensagem ? <Text style={t.small}>{f.pedido_em_nome.mensagem}</Text> : null}
    </Screen>
  );
}

function Secoes({ p }: { p: PainelDia }) {
  return (
    <>
      <Cartao preenchimento={14} gap={6}>
        <Text style={t.h2}>Visitas</Text>
        <Linha rotulo="Realizadas" valor={fracao(p.visitas.realizadas, p.visitas.planejadas)} />
        <Linha rotulo={ROTULO_INDICADOR_META.cobertura_pct} valor={p.visitas.cobertura_pct === null ? '—' : pct(Math.round(p.visitas.cobertura_pct))} />
        <Linha rotulo="Tempo em cliente" valor={`${Math.round(p.visitas.tempo_total_min)} min`} />
        {p.visitas.curtas > 0 ? <Linha rotulo="Visitas curtas" valor={String(p.visitas.curtas)} /> : null}
      </Cartao>
      {p.vendas ? (
        <Cartao preenchimento={14} gap={6}>
          <Text style={t.h2}>Vendas do dia</Text>
          <Linha rotulo="Vendido" valor={formatBRL0(p.vendas.vendas_cents)} />
          <Linha rotulo="Pedidos" valor={String(p.vendas.pedidos)} />
          <Linha rotulo="Positivados" valor={String(p.vendas.clientes_positivados)} />
          <Linha rotulo="Desconto médio" valor={pct(p.vendas.desconto_medio_pct)} />
          {p.faturamento ? <Linha rotulo="A faturar" valor={formatBRL0(p.faturamento.a_faturar_cents)} /> : null}
        </Cartao>
      ) : null}
      {p.mes ? (
        <Cartao preenchimento={14} gap={6}>
          <Text style={t.h2}>Mês</Text>
          <Linha rotulo="Vendido no mês" valor={formatBRL0(p.mes.vendas_cents)} />
          <Linha rotulo="Meta" valor={p.mes.meta_cents === null ? 'sem meta' : formatBRL0(p.mes.meta_cents)} />
          <Linha rotulo="Atingido" valor={p.mes.atingimento_pct === null ? '—' : pct(Math.round(p.mes.atingimento_pct))} />
          <Linha rotulo="Precisa por dia" valor={p.mes.necessidade_diaria_cents === null ? '—' : formatBRL0(p.mes.necessidade_diaria_cents)} />
        </Cartao>
      ) : null}
      {p.trade ? (
        <Cartao preenchimento={14} gap={6}>
          <Text style={t.h2}>Trade</Text>
          <Linha rotulo="Lojas visitadas" valor={String(p.trade.lojas_visitadas)} />
          <Linha rotulo="Gôndola conforme" valor={pct(p.trade.conformidade_pct)} />
          <Linha rotulo="Share médio" valor={pct(p.trade.share_medio_pct)} />
          <Linha rotulo="Ruptura" valor={pct(p.trade.ruptura_pct)} />
          <Linha rotulo="Tarefas concluídas" valor={String(p.trade.tarefas_concluidas)} />
        </Cartao>
      ) : null}
    </>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', minHeight: 24 }}>
      <Text style={t.body}>{rotulo}</Text>
      <Text style={t.bodyStrong}>{valor}</Text>
    </View>
  );
}
