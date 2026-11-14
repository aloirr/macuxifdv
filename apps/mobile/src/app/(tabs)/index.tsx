/**
 * Início do shell, nas duas variantes.
 * - Campo (T-0170, v1.0.6): a `TelaInicioCampo` do Core (painel, Metas do mês com o sino na linha, Produtividade e
 *   Sincronizar). O shell passa o sino (`Sino`), as rotas (Performance e Perfil) e o aviso de módulo desativado. Saíram daqui
 *   Orçamentos, A faturar e o cartão de Recados: o recado fica só no sino (D2, R-20261113-054158; RD-0249).
 * - Gestão (T-0076/T-0124): boas-vindas com o sino → Meta do mês da equipe → cards do slot `inicio.cards` (Pedidos para
 *   aprovar do Gestor) → Equipe agora → Sincronizar com "Última sincronização hh:mm · N na fila" (RN-CORE-23) e o aviso único
 *   de dado antigo (RD-0008). Sem o cartão de Recados (RD-0249): o sino é o único acesso.
 * Tudo sai do aparelho (offline-first). Puxar para baixo = Sincronizar (RN-CORE-23 item 5). Nenhum timer.
 */
import { TelaInicioCampo, useInicio } from '@macuxi/core/app';
import { useMotorSync, useVisaoShell } from '@macuxi/platform-sdk/react';
import { Banner, BotaoSincronizar, colors, firstName, Loading, Screen, useAtualizacaoAutomatica } from '@macuxi/ui/mobile';
import { router } from 'expo-router';
import { View } from 'react-native';

import { useCorDaFaixaNoFoco } from '@/components/area-segura';
import { AvisoPosLogin } from '@/components/aviso-pos-login';
import { CardsDoInicio } from '@/components/extensoes-shell';
import { BoasVindas, EquipeAgora, MetaDoMes } from '@/components/inicio';
import { Sino } from '@/components/sino';
import { avisoDosDados, dataDoCabecalho, textoVisitasHoje, visitasDaEquipe } from '@/lib/inicio';
import { varianteAtual } from '@/lib/variante';
import { usePlataforma } from '@/state/plataforma';

const navegar = (href: string) => router.navigate(href as never);
const abrirPerfil = () => router.push('/profile');

export default function Inicio() {
  return (
    <View style={{ flex: 1 }}>
      {varianteAtual() === 'campo' ? <InicioCampo /> : <InicioGestao />}
      {/* T-0094: "Senha criada." depois da troca obrigatória, uma vez */}
      <AvisoPosLogin />
    </View>
  );
}

/** Um módulo foi desativado com itens na fila do aparelho (as duas variantes). */
function AvisoModuloDesativado() {
  const { estado } = useMotorSync();
  if (estado.limpezaPendente.length === 0) return null;
  return (
    <Banner icon="alert" tone="danger" testID="aviso-modulo-desativado">
      Um módulo foi desativado e há itens não enviados. Veja em Perfil › Fila do aparelho.
    </Banner>
  );
}

function InicioCampo() {
  // T-0172: a faixa da barra de status em Azul noite (barra light) só com o Início em foco; nas outras abas, o fundo do app
  useCorDaFaixaNoFoco(colors.faixa, 'light');
  return (
    <TelaInicioCampo
      // o `novos` que a tela passa é o mesmo `sino.total` do Core; o sino lê a contagem única do layout (`ProvedorContagemSino`)
      sino={() => <Sino testID="inicio-sino" />}
      onAbrirPerformance={() => navegar('/m/performance')}
      onPerfil={abrirPerfil}
      avisos={<AvisoModuloDesativado />}
    />
  );
}

function InicioGestao() {
  const { sessao, me } = usePlataforma();
  const visaoShell = useVisaoShell();
  const inicio = useInicio();
  const tz = me?.tenant.timezone ?? sessao?.tenant?.fuso ?? 'America/Manaus';
  const auto = useAtualizacaoAutomatica({ tz });

  if (!inicio) return <Loading />;

  const equipe = inicio.escopo === 'equipe';
  const nomeEquipe = inicio.equipe_nome ?? sessao?.user.team_name ?? me?.seller?.team_name ?? null;
  // T-0124/RD-0012: só os campos prontos (e obrigatórios) do Core: `saudacao`, `meta_hoje`, `sem_realizado`.
  const semVendas = inicio.sem_realizado.length > 0;

  return (
    <Screen testID="inicio" refreshing={auto.puxando} onRefresh={auto.puxar} contentStyle={{ flexGrow: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <BoasVindas
            data={dataDoCabecalho(new Date(), tz, equipe ? nomeEquipe : null)}
            saudacao={nomeado(inicio.saudacao, firstName(sessao?.user.name ?? ''))}
            visitas={textoVisitasHoje(equipe ? visitasDaEquipe(inicio.equipe_agora) : inicio.rota, inicio.dia_util)}
            onPerfil={abrirPerfil}
          />
        </View>
        {/* T-0170: o sino do shell (o Início não usa o CabecalhoTela do kit) */}
        <Sino testID="inicio-sino" />
      </View>
      <AvisoModuloDesativado />

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
      {/* RD-0008: aviso único de dado antigo, na linha de situação do Sincronizar (kit, docs/design/inicio.md §1.5) */}
      <BotaoSincronizar testID="inicio-sincronizar" avisoDados={avisoDosDados(inicio, tz)} />
    </Screen>
  );
}

/** "Boa tarde" + "Lucas" → "Boa tarde, Lucas"; sem o nome, só a saudação do Core. */
function nomeado(parte: string, primeiroNome: string): string {
  return parte && primeiroNome ? `${parte}, ${primeiroNome}` : parte || primeiroNome;
}
