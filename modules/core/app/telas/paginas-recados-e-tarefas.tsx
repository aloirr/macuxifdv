/**
 * Páginas do shell para Recados e tarefas (T-0170): ligam as telas às rotas `/m/recados-e-tarefas` e `/m/tarefa?id=…`.
 * A Pesquisa não é chamada aqui; o botão "Responder pesquisa" fica desligado até o shell passar `responderPesquisa`.
 */
import { router, useLocalSearchParams } from 'expo-router';

import { TelaRecadosETarefas, TelaTarefa } from './recados-e-tarefas';

export const ROTA_RECADOS_E_TAREFAS = '/m/recados-e-tarefas';
export const rotaDaTarefa = (id: string) => `/m/tarefa?id=${encodeURIComponent(id)}`;
export const abrirTarefaDoCore = (id: string) => router.push(rotaDaTarefa(id) as never);

export function PaginaRecadosETarefas() {
  return <TelaRecadosETarefas abrirTarefa={abrirTarefaDoCore} />;
}

export function PaginaTarefa() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <TelaTarefa tarefaId={id ?? ''} rotaDaLista={ROTA_RECADOS_E_TAREFAS} />;
}
