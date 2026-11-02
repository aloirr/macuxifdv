/**
 * Hook da aba Loja (T-0056): lê o check-in aberto do Core, os cadastros de trade e o estado do Promotor do aparelho e
 * escreve as coletas na fila do motor de sync (`useMotorSync`). Offline-first: nada aqui espera a rede; o envio vai em
 * segundo plano e a API revalida tudo (RN-PRO-02..07). Relógio: `relogioReal()` de `@macuxi/comum/relogio`.
 * Ordem na fila (o servidor depende dela): visita de loja → foto → coleta que usa a foto → checkout.
 * RN-PRO-01: nenhuma ação de pedido.
 */
import type { ClienteSync, ProdutoSync, VisitaSync } from '@macuxi/core/contracts';
import { DEFAULT_TZ, localIsoDate } from '@macuxi/comum/fuso';
import { relogioReal } from '@macuxi/comum/relogio';
import type { LinhaSync } from '@macuxi/platform-sdk';
import { useAmbiente, useMotorSync } from '@macuxi/platform-sdk/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CategoriaGondolaSync, ChecklistLojaSync, MetaShareSync, MixObrigatorioSync, TarefaTradeSync, TipoFoto, VisitaLoja } from '../../contracts';
import { cadastrosDaLoja, checklistDaLoja, metaDaCategoria, parametrosDosBrutos, progressoChecklist, type ProgressoChecklist } from '../../domain';
import { capturarFoto } from '../lib/captura-foto';
import { abrirVisitaLoja, checkinAberto, fecharVisitaLoja, montarFoto, type CheckinAberto } from '../lib/loja';
import { criarRepositorioLoja, visitaDaLoja, type DadosLoja, type RegistroLocal } from '../lib/repositorio';

export interface ItemDoMix {
  mix: MixObrigatorioSync;
  nome: string;
}

export interface EstadoLoja {
  carregado: boolean;
  hoje: string;
  fuso: string;
  checkin: CheckinAberto | null;
  loja: { id: string; nome: string; segmento: string | null } | null;
  visita: VisitaLoja | null;
  registros: RegistroLocal[];
  categorias: CategoriaGondolaSync[];
  mix: ItemDoMix[];
  checklist: ChecklistLojaSync | null;
  progresso: ProgressoChecklist | null;
  tarefas: TarefaTradeSync[];
  metas: MetaShareSync[];
  precos: Record<string, number>;
}

const VAZIO: EstadoLoja = {
  carregado: false,
  hoje: '',
  fuso: DEFAULT_TZ,
  checkin: null,
  loja: null,
  visita: null,
  registros: [],
  categorias: [],
  mix: [],
  checklist: null,
  progresso: null,
  tarefas: [],
  metas: [],
  precos: {},
};

const vivas = <T extends LinhaSync>(l: readonly T[]) => l.filter((x) => !x.deleted_at);

export function useLoja() {
  const { motor, estado } = useMotorSync();
  const ambiente = useAmbiente();
  const usuario = ambiente.usuario();
  const fuso = usuario?.fuso ?? DEFAULT_TZ;
  const relogio = useMemo(() => relogioReal(), []);
  const repo = useMemo(() => (motor ? criarRepositorioLoja(motor.armazenamentoDoModulo('promotor')) : null), [motor]);
  const [dados, setDados] = useState<EstadoLoja>(VAZIO);
  const parametros = parametrosDosBrutos(ambiente.parametros('promotor'));

  const recarregar = useCallback(async () => {
    if (!motor || !repo || !usuario) return;
    const hoje = localIsoDate(relogio.agora(), fuso);
    const [visitasCore, clientes, produtos, categorias, checklists, mixes, metas, tarefas, local] = await Promise.all([
      motor.linhas<VisitaSync & LinhaSync>('visita'),
      motor.linhas<ClienteSync & LinhaSync>('cliente'),
      motor.linhas<ProdutoSync & LinhaSync>('produto'),
      motor.linhas<CategoriaGondolaSync & LinhaSync>('categoria_gondola'),
      motor.linhas<ChecklistLojaSync & LinhaSync>('checklist_loja'),
      motor.linhas<MixObrigatorioSync & LinhaSync>('mix_obrigatorio'),
      motor.linhas<MetaShareSync & LinhaSync>('meta_share'),
      motor.linhas<TarefaTradeSync & LinhaSync>('tarefa_trade'),
      repo.carregar(),
    ]);
    const checkin = checkinAberto(visitasCore, motor.estado().fila, usuario.id);
    const cliente = checkin ? vivas(clientes).find((c) => c.id === checkin.cliente_id) : undefined;
    const loja = checkin ? { id: checkin.cliente_id, nome: cliente?.nome_fantasia || cliente?.razao_social || 'Loja', segmento: cliente?.segmento ?? null } : null;
    const visita = visitaDaLoja(local as DadosLoja, checkin?.visita_id ?? null);
    const nomes = new Map(vivas(produtos).map((p) => [p.id, p.nome] as const));
    const checklist = loja ? checklistDaLoja(vivas(checklists), loja, hoje) : null;
    const registros = visita ? (local.registros[visita.id] ?? []) : [];
    const feitas = new Set(registros.filter((r) => r.entidade === 'checklist_resposta').map((r) => r.chave.replace(/^etapa:/, '')));
    setDados({
      carregado: true,
      hoje,
      fuso,
      checkin,
      loja,
      visita,
      registros,
      categorias: vivas(categorias).filter((c) => c.ativo).sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome)),
      mix: loja ? cadastrosDaLoja(vivas(mixes), loja, hoje).map((m) => ({ mix: m, nome: nomes.get(m.produto_id) ?? 'Produto do mix' })) : [],
      checklist,
      progresso: checklist ? progressoChecklist(checklist.itens.map((i) => ({ id: i.id, rotulo: i.rotulo, obrigatoria: i.obrigatoria, concluida: feitas.has(i.id) }))) : null,
      tarefas: loja ? cadastrosDaLoja(vivas(tarefas), loja, hoje) : [],
      metas: vivas(metas),
      precos: local.precos,
    });
  }, [motor, repo, usuario, relogio, fuso]);

  useEffect(() => {
    void recarregar();
  }, [recarregar, estado.fila.length, estado.sincronizado_em]);

  /** Põe a coleta na fila e lembra dela na visita (a tela marca "feito"). Erro de contrato = bug, mensagem ao usuário. */
  const registrar = useCallback(
    async (entidade: string, coleta: { id: string; visita_loja_id: string }, chave: string, rotulo: string): Promise<string | null> => {
      if (!motor || !repo) return 'O aparelho ainda está preparando os dados. Tente de novo em instantes.';
      try {
        await motor.enfileirar({ id: coleta.id, entidade, payload: coleta, rotulo: `${rotulo} · ${dados.loja?.nome ?? 'Loja'}` });
      } catch (e) {
        return `Não foi possível guardar a coleta: ${(e as Error).message}`;
      }
      await repo.registrar(coleta.visita_loja_id, { entidade, id: coleta.id, chave, rotulo });
      void motor.enviar().catch(() => undefined);
      await recarregar();
      return null;
    },
    [motor, repo, dados.loja, recarregar],
  );

  /** Abre a visita de loja sobre o check-in do Core (RN-PRO-02). */
  const iniciar = useCallback(async (): Promise<string | null> => {
    if (!motor || !repo || !dados.checkin) return 'Faça o check-in na loja (aba Rota ou Clientes) para começar as coletas.';
    const v = abrirVisitaLoja(ambiente.novoId(), dados.checkin, dados.checklist?.id ?? null);
    try {
      await motor.enfileirar({ id: v.id, entidade: 'visita_loja', payload: v, rotulo: `Visita de loja · ${dados.loja?.nome ?? 'Loja'}` });
    } catch (e) {
      return `Não foi possível abrir a visita de loja: ${(e as Error).message}`;
    }
    await repo.guardarVisita(v);
    void motor.enviar().catch(() => undefined);
    await recarregar();
    return null;
  }, [motor, repo, dados.checkin, dados.checklist, dados.loja, ambiente, recarregar]);

  /** Tira a foto pela câmera do app, põe na fila (comando + arquivo) e devolve o id; `null` + mensagem se não deu. */
  const tirarFoto = useCallback(
    async (tipo: TipoFoto, rotulo: string): Promise<{ id: string } | { erro: string }> => {
      if (!motor || !dados.visita) return { erro: 'Abra a visita de loja antes de tirar fotos.' };
      const f = await capturarFoto();
      if (!f) return { erro: 'Não foi possível abrir a câmera. Confira a permissão de câmera e tente de novo.' };
      const foto = montarFoto({ id: f.id, visita_loja_id: dados.visita.id, tipo, agora: relogio.agora(), latitude: f.latitude, longitude: f.longitude });
      const erro = await registrar('foto_coleta', foto, `foto:${foto.id}`, rotulo);
      if (erro) return { erro };
      await motor.enfileirarArquivo({ id: foto.id, modulo: 'promotor', rotulo: `${rotulo} · ${dados.loja?.nome ?? 'Loja'}` });
      return { id: foto.id };
    },
    [motor, dados.visita, dados.loja, relogio, registrar],
  );

  /** Encerra as coletas da loja (checkout da visita de loja, RN-PRO-06/07). Ainda na fila = altera o mesmo item. */
  const encerrar = useCallback(async (): Promise<string | null> => {
    if (!motor || !repo || !dados.visita) return 'Nenhuma visita de loja aberta.';
    const pendentes = dados.progresso?.obrigatorias_pendentes ?? [];
    if (pendentes.length > 0) return `Faltam etapas obrigatórias: ${pendentes.map((p) => p.rotulo).join('; ')}. Conclua-as para encerrar.`;
    const fechada = fecharVisitaLoja(dados.visita, relogio.agora());
    try {
      const naFila = motor.estado().fila.some((i) => i.id === fechada.id);
      if (naFila) await motor.alterar(fechada.id, { payload: fechada });
      else await motor.enfileirar({ id: fechada.id, entidade: 'visita_loja', payload: fechada, rotulo: `Fim da visita de loja · ${dados.loja?.nome ?? 'Loja'}` });
    } catch (e) {
      return `Não foi possível encerrar a visita de loja: ${(e as Error).message}`;
    }
    await repo.guardarVisita(fechada);
    void motor.enviar().catch(() => undefined);
    await recarregar();
    return null;
  }, [motor, repo, dados.visita, dados.progresso, dados.loja, relogio, recarregar]);

  const metaDa = useCallback(
    (categoriaId: string) => (dados.loja ? metaDaCategoria(dados.metas, categoriaId, dados.loja, dados.hoje) : null),
    [dados.loja, dados.metas, dados.hoje],
  );

  return {
    ...dados,
    parametros,
    offline: !ambiente.online(),
    agora: () => relogio.agora(),
    novoId: () => ambiente.novoId(),
    recarregar,
    iniciar,
    registrar,
    tirarFoto,
    encerrar,
    metaDa,
    guardarPreco: (produtoId: string, cents: number) => (repo && dados.loja ? repo.guardarPreco(dados.loja.id, produtoId, cents) : Promise.resolve()),
  };
}

export type UsoLoja = ReturnType<typeof useLoja>;
