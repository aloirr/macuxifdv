'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, CampoBusca, CampoFormulario, CLASSE_CAMPO, Drawer, ErrorBlock, EstadoVazio, FilterBar, LoadingBlock, Notice, TabelaDados, useToast, type ColunaDaTabela } from '@macuxi/ui/web';
import { MedidasListaSchema, type Medida } from '../../../contracts';
import { DESCRICAO_MEDIDA_MAX, normalizarSigla } from '../../../domain';
import { erroDoFormularioDeMedida } from '../../lib/medidas';
import { fraseDoVazio, LimparFiltros, QuadroDaLista, type useBuscaComEspera } from '../../lib/lista-bko';
import { novoId } from '../../lib/visitas';

interface Rascunho {
  id: string;
  existente: boolean;
  sigla: string;
  descricao: string;
  /** Em uso: a sigla não muda (só a descrição). */
  siglaTravada: boolean;
}

/** Lista de medidas do tenant, compartilhada com o formulário do produto (mesma chave de cache). */
export const useMedidas = () =>
  useQuery({
    queryKey: ['core', 'medidas'],
    queryFn: async ({ signal }) => MedidasListaSchema.parse(await api<unknown>('/core/medidas', { signal })).itens,
  });

/** Medidas que casam com a busca (sigla ou descrição). */
export const filtrarMedidas = (medidas: readonly Medida[], termo: string): Medida[] => {
  const t = termo.trim().toLowerCase();
  return medidas.filter((m) => !t || `${m.sigla} ${m.descricao}`.toLowerCase().includes(t));
};

/**
 * Medidas do produto (RN-CORE-19; RF-CORE-14), na aba Medidas de Parâmetros → Produtos. Cadastra, edita, inativa e reativa;
 * só apaga medida sem uso (em uso, a ação "Apagar" não aparece: inative em vez de apagar). Analista e admin editam
 * (ação `medida.gerenciar`); gerente consulta. A API revalida tudo e audita. A busca vem da página (a contagem fica na aba).
 */
export function MedidasPanel({ busca }: { busca: ReturnType<typeof useBuscaComEspera> }) {
  const qc = useQueryClient();
  const toast = useToast();
  const pode = usePode('medida.gerenciar');
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [erroApi, setErroApi] = useState<string | null>(null);
  const lista = useMedidas();

  const atualizar = () => qc.invalidateQueries({ queryKey: ['core'] });
  const salvar = useMutation({
    mutationFn: (r: Rascunho) =>
      r.existente
        ? api<unknown>(`/core/medidas/${r.id}`, { method: 'PUT', body: { descricao: r.descricao.trim(), ...(r.siglaTravada ? {} : { sigla: normalizarSigla(r.sigla) }) } })
        : api<unknown>('/core/medidas', { method: 'POST', body: { id: r.id, sigla: normalizarSigla(r.sigla), descricao: r.descricao.trim() } }),
    onSuccess: async () => {
      setRascunho(null);
      toast('success', 'Medida salva.');
      await atualizar();
    },
    onError: (e) => setErroApi(errorMessage(e)),
  });
  const alternar = useMutation({
    mutationFn: (m: Medida) => api<unknown>(`/core/medidas/${m.id}`, { method: 'PUT', body: { ativo: !m.ativo } }),
    onSuccess: async (_r, m) => {
      toast('success', m.ativo ? `Medida ${m.sigla} inativada.` : `Medida ${m.sigla} reativada.`);
      await atualizar();
    },
    onError: (e) => toast('danger', errorMessage(e)),
  });
  const apagar = useMutation({
    mutationFn: (m: Medida) => api<unknown>(`/core/medidas/${m.id}`, { method: 'DELETE' }),
    onSuccess: async (_r, m) => {
      toast('success', `Medida ${m.sigla} apagada.`);
      await atualizar();
    },
    onError: (e) => toast('danger', errorMessage(e)),
  });

  const itens = filtrarMedidas(lista.data ?? [], busca.termo);
  const erroForm = rascunho ? erroDoFormularioDeMedida(rascunho.sigla, rascunho.descricao) : null;
  const abrirNova = () => {
    setErroApi(null);
    setRascunho({ id: novoId(), existente: false, sigla: '', descricao: '', siglaTravada: false });
  };
  const editar = (m: Medida) => {
    setErroApi(null);
    setRascunho({ id: m.id, existente: true, sigla: m.sigla, descricao: m.descricao, siglaTravada: m.em_uso > 0 });
  };

  const colunas: ReadonlyArray<ColunaDaTabela<Medida>> = [
    { id: 'sigla', titulo: 'Sigla', largura: '110px', texto: (m) => m.sigla, celula: (m) => <span className="font-mono">{m.sigla}</span> },
    { id: 'descricao', titulo: 'Descrição', texto: (m) => m.descricao, celula: (m) => m.descricao },
    { id: 'situacao', titulo: 'Situação', largura: '120px', celula: (m) => <Badge tone={m.ativo ? 'success' : 'warning'}>{m.ativo ? 'Ativa' : 'Inativa'}</Badge> },
    { id: 'produtos', titulo: 'Produtos', numero: true, prioridade: 2, largura: '110px', celula: (m) => (m.em_uso === 0 ? '—' : `${m.em_uso} em uso`), texto: (m) => (m.em_uso === 0 ? 'Sem uso' : `${m.em_uso} em uso`) },
  ];

  return (
    <div className="flex flex-col gap-4" data-testid="medidas.tela">
      <FilterBar>
        <CampoBusca
          rotulo="Buscar sigla ou descrição"
          value={busca.texto}
          onChange={(e) => busca.setTexto(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && busca.aplicar()}
          data-testid="medidas.busca"
        />
        <LimparFiltros ligado={busca.texto !== ''} onLimpar={busca.limpar} />
        {pode && (
          <Button variant="primary" className="ml-auto" onClick={abrirNova} data-testid="medidas.nova">
            Nova medida
          </Button>
        )}
      </FilterBar>
      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && <LoadingBlock label="Carregando as medidas…" />}
      {lista.data && (
        <QuadroDaLista
          vazia={itens.length === 0}
          vazio={
            <EstadoVazio
              titulo={fraseDoVazio('medida', true, busca.termo !== '')}
              acao={
                busca.termo === '' && pode ? (
                  <Button variant="primary" onClick={abrirNova}>
                    Nova medida
                  </Button>
                ) : undefined
              }
            />
          }
        >
          <TabelaDados
            rotulo="Medidas"
            colunas={colunas}
            linhas={itens}
            chave={(m) => m.id}
            linhaTestId={(m) => `medidas.linha.${m.sigla}`}
            esmaecida={(m) => !m.ativo}
            aoAbrir={pode ? editar : undefined}
            acoes={(m) =>
              pode
                ? [
                    { id: 'editar', rotulo: 'Editar', aoEscolher: () => editar(m), testId: `medidas.editar.${m.sigla}` },
                    { id: 'alternar', rotulo: m.ativo ? 'Inativar' : 'Reativar', desligada: alternar.isPending, aoEscolher: () => alternar.mutate(m), testId: `medidas.alternar.${m.sigla}` },
                    ...(m.em_uso === 0 ? [{ id: 'apagar', rotulo: 'Apagar', perigo: true, desligada: apagar.isPending, aoEscolher: () => apagar.mutate(m), testId: `medidas.apagar.${m.sigla}` }] : []),
                  ]
                : []
            }
          />
        </QuadroDaLista>
      )}
      <Drawer
        open={rascunho !== null}
        title={rascunho?.existente ? `Editar medida ${rascunho.sigla}` : 'Nova medida'}
        onClose={() => setRascunho(null)}
        rodape={
          rascunho && (
            <>
              <Button onClick={() => setRascunho(null)}>Cancelar</Button>
              <Button variant="primary" disabled={salvar.isPending || erroForm !== null} onClick={() => salvar.mutate(rascunho)} data-testid="medidas.salvar">
                {salvar.isPending ? 'Salvando…' : 'Salvar'}
              </Button>
            </>
          )
        }
      >
        {rascunho && (
          <div className="flex flex-col gap-4">
            {erroApi && <Notice tone="danger">{erroApi}</Notice>}
            <CampoFormulario rotulo="Sigla (1 a 4 letras)">
              <input
                value={rascunho.sigla}
                maxLength={4}
                disabled={rascunho.siglaTravada}
                onChange={(e) => setRascunho({ ...rascunho, sigla: e.target.value.toUpperCase() })}
                data-testid="medidas.sigla"
                className={`${CLASSE_CAMPO} max-w-[160px] font-mono uppercase`}
              />
            </CampoFormulario>
            <CampoFormulario rotulo="Descrição" erro={erroForm && (rascunho.sigla !== '' || rascunho.descricao !== '') ? erroForm : undefined}>
              <input
                value={rascunho.descricao}
                maxLength={DESCRICAO_MEDIDA_MAX}
                placeholder="Ex.: Caixa"
                onChange={(e) => setRascunho({ ...rascunho, descricao: e.target.value })}
                aria-invalid={erroForm !== null && (rascunho.sigla !== '' || rascunho.descricao !== '')}
                data-testid="medidas.descricao"
                className={CLASSE_CAMPO}
              />
            </CampoFormulario>
          </div>
        )}
      </Drawer>
    </div>
  );
}
