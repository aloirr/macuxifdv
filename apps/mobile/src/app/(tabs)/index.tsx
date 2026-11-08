/**
 * Início (T-0076, referência aprovada R-20261104-164000-alexandre; substitui o layout da T-0073 onde conflitar): primeira
 * tela depois do login e da carga, nas variantes Campo e Gestão. De cima para baixo:
 * - boas-vindas (data, saudação no fuso do tenant, "6 visitas hoje · 3 feitas" ou "Sem rota hoje · não é dia útil");
 * - Recados (as 3 primeiras da caixa, o recado do dia destacado; selo "N novos"; o topo e o "Ver todos" abrem a central
 *   de notificações, RF-CORE-09);
 * - Meta do mês (Campo) ou Meta do mês da equipe (Gestão), T-0124/RD-0002: realizado do mês de meta do mês, barra, o %
 *   uma vez e a última linha do dia ("Meta de hoje R$ X" no dia útil, RN-CORE-26);
 * - cards do slot `inicio.cards` (Orçamentos e A faturar do Vendedor; Pedidos para aprovar do Gestor), só de módulos
 *   efetivos, do perfil e com a ação (o promotor não recebe card de pedido, RN-PRO-01);
 * - Gestão: Equipe agora;
 * - no fim, SÓ o botão Sincronizar com "Última sincronização hh:mm · N na fila" (RN-CORE-23) e, quando os dados estão
 *   antigos, o aviso único "Dados de 06/11, 6h28" (RD-0008).
 * Tudo sai do aparelho (`useInicio()` do Core sobre a última sincronização; offline-first). Puxar para baixo = Sincronizar
 * (RN-CORE-23 item 5). Nenhum timer. O shell só desenha: textos e tons em `lib/inicio.ts`.
 */
import { useInicio, useNotificacoes } from '@macuxi/core/app';
import { useMotorSync, useVisaoShell } from '@macuxi/platform-sdk/react';
import { Banner, BotaoSincronizar, colors, firstName, Loading, Screen, type as t, useAtualizacaoAutomatica } from '@macuxi/ui/mobile';
import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { AvisoPosLogin } from '@/components/aviso-pos-login';
import { CardsDoInicio } from '@/components/extensoes-shell';
import { BoasVindas, EquipeAgora, MetaDoMes, Recados } from '@/components/inicio';
import { avisoDosDados, dataDoCabecalho, mostrarVerTodos, recadosDoInicio, textoVisitasHoje, visitasDaEquipe } from '@/lib/inicio';
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
  // T-0124/RD-0012: só os campos prontos do Core (`saudacao`, `recados_hoje`, `meta_hoje`, `sem_realizado`), sem contornos
  // que repitam o domain. Enquanto forem opcionais no core.inicio@1, a falta vira vazio, nunca uma regra local.
  const semVendas = (inicio.sem_realizado?.length ?? 0) > 0;
  const aviso = avisoDosDados(inicio, tz);
  const navegar = (href: string) => router.navigate(href as never);

  return (
    <View style={{ flex: 1 }}>
      <Screen testID="inicio" refreshing={auto.puxando} onRefresh={auto.puxar} contentStyle={{ flexGrow: 1 }}>
      <BoasVindas
        data={dataDoCabecalho(agora, tz, equipe ? nomeEquipe : null)}
        saudacao={nomeado(inicio.saudacao ?? '', firstName(sessao?.user.name ?? ''))}
        visitas={textoVisitasHoje(equipe ? visitasDaEquipe(inicio.equipe_agora) : inicio.rota, inicio.dia_util)}
        onPerfil={() => router.push('/profile')}
      />
      {estado.limpezaPendente.length > 0 ? (
        <Banner icon="alert" tone="danger" testID="aviso-modulo-desativado">
          Um módulo foi desativado e há itens não enviados. Veja em Perfil › Fila do aparelho.
        </Banner>
      ) : null}

      <Recados
        itens={recadosDoInicio(inicio.recados_hoje)}
        naoLidas={inicio.recados_hoje?.novos ?? 0}
        verTodos={mostrarVerTodos(inicio.recados_hoje)}
        onAbrir={(r) => {
          // tocar marca como lida (como a central); a navegação não espera o banco do aparelho
          if (r.notificacao_id) void marcarLida(r.notificacao_id).catch(() => undefined);
          navegar(r.destino);
        }}
        onVerTodos={() => navegar('/m/notificacoes')}
      />
      <MetaDoMes metas={inicio.metas} pronto={inicio.meta_hoje} equipe={equipe} semVendas={semVendas} />
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
      {/* RD-0008: aviso único de dado antigo, no bloco Sincronizar (provisório até a prop do kit, R-20261108-164227) */}
      {aviso ? (
        <Text style={[t.small, { color: colors.warningInk, textAlign: 'center' }]} testID="inicio.aviso-dados">
          {aviso}
        </Text>
      ) : null}
      <BotaoSincronizar testID="inicio-sincronizar" />
      </Screen>
      {/* T-0094: "Senha criada." depois da troca obrigatória, uma vez */}
      <AvisoPosLogin />
    </View>
  );
}

/** "Boa tarde" + "Lucas" → "Boa tarde, Lucas"; sem a saudação do Core, só o nome. */
function nomeado(parte: string, primeiroNome: string): string {
  return parte && primeiroNome ? `${parte}, ${primeiroNome}` : parte || primeiroNome;
}
