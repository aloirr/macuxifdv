/**
 * Início (T-0076, referência aprovada R-20261104-164000-alexandre; substitui o layout da T-0073 onde conflitar): primeira
 * tela depois do login e da carga, nas variantes Campo e Gestão. De cima para baixo:
 * - boas-vindas (data, saudação no fuso do tenant, "6 visitas hoje · 3 feitas");
 * - Recados de hoje (recado do dia destacado + notificações mais recentes, até 3; selo "N novos"; "Ver todos" abre a
 *   central de notificações, RF-CORE-09);
 * - Meta de hoje (Campo) ou Meta de hoje da equipe (Gestão): realizado do dia × necessidade diária (RN-CORE-22/26),
 *   barra, "Faltam R$ X hoje" e o % do mês;
 * - cards do slot `inicio.cards` (Orçamentos e A faturar do Vendedor; Pedidos para aprovar do Gestor), só de módulos
 *   efetivos, do perfil e com a ação (o promotor não recebe card de pedido, RN-PRO-01);
 * - Gestão: Equipe agora;
 * - no fim, SÓ o botão Sincronizar com "Última sincronização hh:mm · N na fila" (RN-CORE-23).
 * Tudo sai do aparelho (`useInicio()` do Core sobre a última sincronização; offline-first). Puxar para baixo = Sincronizar
 * (RN-CORE-23 item 5). Nenhum timer. O shell só desenha: textos e tons em `lib/inicio.ts`.
 */
import { useInicio, useNotificacoes } from '@macuxi/core/app';
import { useMotorSync, useVisaoShell } from '@macuxi/platform-sdk/react';
import { Banner, BotaoSincronizar, firstName, Loading, Screen, useAtualizacaoAutomatica } from '@macuxi/ui/mobile';
import { router } from 'expo-router';
import { View } from 'react-native';

import { CardsDoInicio } from '@/components/extensoes-shell';
import { BoasVindas, EquipeAgora, MetaDeHoje, RecadosDeHoje } from '@/components/inicio';
import { dataDoCabecalho, recadosDeHoje, saudacao, textoBaseDefasada, textoVisitasHoje, visitasDaEquipe } from '@/lib/inicio';
import { usePlataforma } from '@/state/plataforma';

export default function Inicio() {
  const { sessao, me } = usePlataforma();
  const visaoShell = useVisaoShell();
  const { estado } = useMotorSync();
  const inicio = useInicio();
  const { marcarLida } = useNotificacoes();
  const tz = me?.tenant.timezone ?? sessao?.tenant?.fuso ?? 'America/Manaus';
  const auto = useAtualizacaoAutomatica({ tz });

  if (!inicio) return <Loading />;

  const agora = new Date();
  const equipe = inicio.escopo === 'equipe';
  const nomeEquipe = inicio.equipe_nome ?? sessao?.user.team_name ?? me?.seller?.team_name ?? null;
  // Indicadores com meta e sem realizado na cópia de `core.inicio@1` (o Core decide em `sem_realizado`; o contorno
  // `base.dia === null` vale para cópias antigas). O promotor não vende.
  const semCopia = inicio.sem_realizado ? inicio.sem_realizado.length > 0 : inicio.base.dia === null && visaoShell.perfil !== 'promotor';
  const aviso = semCopia ? 'Sincronize para ver as vendas' : textoBaseDefasada(inicio.base, tz);
  const navegar = (href: string) => router.navigate(href as never);

  return (
    <Screen testID="inicio" refreshing={auto.puxando} onRefresh={auto.puxar} contentStyle={{ flexGrow: 1 }}>
      <BoasVindas
        data={dataDoCabecalho(agora, tz, equipe ? nomeEquipe : null)}
        saudacao={nomeado(inicio.saudacao ?? saudacao(agora, tz, ''), firstName(sessao?.user.name ?? ''))}
        visitas={textoVisitasHoje(equipe ? visitasDaEquipe(inicio.equipe_agora) : inicio.rota)}
        onPerfil={() => router.push('/profile')}
      />
      {estado.limpezaPendente.length > 0 ? (
        <Banner icon="alert" tone="danger" testID="aviso-modulo-desativado">
          Um módulo foi desativado e há itens não enviados. Veja em Perfil › Fila do aparelho.
        </Banner>
      ) : null}

      <RecadosDeHoje
        itens={recadosDeHoje(inicio, agora, tz)}
        naoLidas={inicio.recados_hoje?.novos ?? inicio.notificacoes.nao_lidas}
        onAbrir={(r) => {
          // tocar marca como lida (como a central); a navegação não espera o banco do aparelho
          if (r.notificacao_id) void marcarLida(r.notificacao_id).catch(() => undefined);
          navegar(r.destino);
        }}
        onVerTodos={() => navegar('/m/notificacoes')}
      />
      <MetaDeHoje metas={inicio.metas} pronto={inicio.meta_hoje} equipe={equipe} aviso={aviso} />
      <CardsDoInicio />
      {equipe ? (
        <EquipeAgora
          membros={inicio.equipe_agora ?? []}
          tz={tz}
          onAbrir={visaoShell.pagina('equipe-membro') ? (id) => navegar(`/m/equipe-membro?id=${encodeURIComponent(id)}`) : null}
        />
      ) : null}

      {/* o Sincronizar fica no pé da tela quando sobra espaço (referência), e logo depois dos blocos quando rola */}
      <View style={{ flex: 1, minHeight: 4 }} />
      <BotaoSincronizar testID="inicio-sincronizar" />
    </Screen>
  );
}

/** "Boa tarde" + "Lucas" → "Boa tarde, Lucas". */
function nomeado(parte: string, primeiroNome: string): string {
  return primeiroNome ? `${parte}, ${primeiroNome}` : parte;
}
