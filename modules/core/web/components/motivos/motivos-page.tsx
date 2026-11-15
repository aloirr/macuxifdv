'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, CampoFormulario, CLASSE_CAMPO, Drawer, ErrorBlock, EstadoVazio, LoadingBlock, Notice, PageHeader, rotuloComContagem, TabelaDados, useToast, type ColunaDaTabela } from '@macuxi/ui/web';
import { MotivoSyncSchema, type MotivoPut, type MotivoSync } from '../../../contracts';
import { fraseDoVazio, QuadroDaLista } from '../../lib/lista-bko';
import { novoId } from '../../lib/visitas';

const TIPOS: Record<MotivoSync['tipo'], string> = { nao_venda: 'Não venda', cliente_fechado: 'Cliente fechado', fora_do_raio: 'Fora do raio' };

interface Rascunho {
  id: string;
  existente: boolean;
  tipo: MotivoSync['tipo'];
  codigo: string;
  descricao: string;
  ativo: boolean;
  ordem: number;
}

const corpo = (r: Rascunho): MotivoPut => ({ tipo: r.tipo, codigo: r.codigo, descricao: r.descricao.trim(), exige_foto: r.tipo === 'cliente_fechado', ativo: r.ativo, ordem: r.ordem });
const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'm_$1').slice(0, 60);

/**
 * Cadastro de motivos (RN-CORE-14): motivos de não venda do tenant. Os de sistema (loja fechada e acesso negado, que exigem
 * a foto da fachada) aparecem sem ações. Só analista e admin editam (ação `motivo.editar`); a API revalida e audita.
 */
export function MotivosPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const pode = usePode('motivo.editar');
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [erroApi, setErroApi] = useState<string | null>(null);
  const lista = useQuery({
    queryKey: ['core', 'motivos'],
    queryFn: async () => ((await api<{ itens: unknown[] }>('/core/motivos')).itens.map((i) => MotivoSyncSchema.parse(i))),
  });
  const salvar = useMutation({
    mutationFn: (r: Rascunho) => api(`/core/motivos/${r.id}`, { method: 'PUT', body: corpo(r) }),
    onSuccess: async () => {
      setRascunho(null);
      toast('success', 'Motivo salvo.');
      await qc.invalidateQueries({ queryKey: ['core', 'motivos'] });
    },
    onError: (e) => setErroApi(errorMessage(e)),
  });
  const remover = useMutation({
    mutationFn: (id: string) => api(`/core/motivos/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast('success', 'Motivo removido.');
      await qc.invalidateQueries({ queryKey: ['core', 'motivos'] });
    },
    onError: (e) => toast('danger', errorMessage(e)),
  });

  const itens = lista.data ?? [];
  const abrir = (r: Rascunho) => {
    setErroApi(null);
    setRascunho(r);
  };
  const novo = (): Rascunho => ({ id: novoId(), existente: false, tipo: 'nao_venda', codigo: '', descricao: '', ativo: true, ordem: (itens.at(-1)?.ordem ?? 0) + 10 });
  const editar = (m: MotivoSync) => abrir({ id: m.id, existente: true, tipo: m.tipo, codigo: m.codigo, descricao: m.descricao, ativo: m.ativo, ordem: m.ordem });
  const editavel = (m: MotivoSync) => pode && !m.sistema;

  const colunas: ReadonlyArray<ColunaDaTabela<MotivoSync>> = [
    {
      id: 'motivo',
      titulo: 'Motivo',
      texto: (m) => m.descricao,
      celula: (m) => (
        <>
          {m.descricao}
          <span className="block truncate font-mono text-[12px] font-normal text-ink-2">{m.codigo}</span>
        </>
      ),
    },
    {
      id: 'tipo',
      titulo: 'Tipo',
      prioridade: 2,
      largura: '28%',
      texto: (m) => `${TIPOS[m.tipo]}${m.exige_foto ? ' · exige foto da fachada' : ''}`,
      celula: (m) => (
        <>
          {TIPOS[m.tipo]}
          {m.exige_foto ? <span className="block truncate text-ink-2">exige foto da fachada</span> : null}
        </>
      ),
    },
    {
      id: 'situacao',
      titulo: 'Situação',
      largura: '130px',
      celula: (m) => <Badge tone={m.sistema ? 'neutral' : m.ativo ? 'success' : 'neutral'}>{m.sistema ? 'Sistema' : m.ativo ? 'Ativo' : 'Desativado'}</Badge>,
    },
  ];
  const criar = pode ? (
    <Button variant="primary" onClick={() => abrir(novo())} data-testid="motivos.novo">
      Novo motivo
    </Button>
  ) : undefined;

  return (
    <div className="flex w-full max-w-[960px] flex-col gap-5" data-testid="motivos.tela">
      <PageHeader title={rotuloComContagem('Motivos de não venda', itens.length)} actions={criar} />
      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && <LoadingBlock label="Carregando os motivos…" />}
      {lista.data && (
        <QuadroDaLista vazia={itens.length === 0} vazio={<EstadoVazio titulo={fraseDoVazio('motivo', false, false)} acao={criar} />}>
          <TabelaDados
            rotulo="Motivos de não venda"
            colunas={colunas}
            linhas={itens}
            chave={(m) => m.id}
            linhaTestId={(m) => `motivos.linha.${m.codigo}`}
            esmaecida={(m) => !m.sistema && !m.ativo}
            aoAbrir={pode ? (m) => editavel(m) && editar(m) : undefined}
            acoes={(m) =>
              editavel(m)
                ? [
                    { id: 'editar', rotulo: 'Editar', aoEscolher: () => editar(m), testId: `motivos.editar.${m.codigo}` },
                    { id: 'remover', rotulo: 'Remover', perigo: true, desligada: remover.isPending, aoEscolher: () => remover.mutate(m.id), testId: `motivos.remover.${m.codigo}` },
                  ]
                : []
            }
          />
        </QuadroDaLista>
      )}
      <Drawer
        open={rascunho !== null}
        title={rascunho?.existente ? 'Editar motivo' : 'Novo motivo'}
        onClose={() => setRascunho(null)}
        rodape={
          rascunho && (
            <>
              <Button onClick={() => setRascunho(null)}>Cancelar</Button>
              <Button variant="primary" disabled={salvar.isPending || rascunho.descricao.trim().length < 2 || rascunho.codigo.length < 1} onClick={() => salvar.mutate(rascunho)} data-testid="motivos.salvar">
                {salvar.isPending ? 'Salvando…' : 'Salvar'}
              </Button>
            </>
          )
        }
      >
        {rascunho && (
          <div className="flex flex-col gap-4">
            {erroApi && <Notice tone="danger">{erroApi}</Notice>}
            <CampoFormulario rotulo="Descrição">
              <input
                value={rascunho.descricao}
                maxLength={120}
                onChange={(e) => setRascunho({ ...rascunho, descricao: e.target.value, codigo: rascunho.existente ? rascunho.codigo : slug(e.target.value) })}
                data-testid="motivos.descricao"
                className={CLASSE_CAMPO}
              />
            </CampoFormulario>
            {rascunho.existente && (
              <p className="m-0 text-[13px] text-ink-2">
                Código: <span className="font-mono">{rascunho.codigo}</span>
              </p>
            )}
            <label className="flex min-h-[44px] items-center gap-2 text-[14px] font-medium">
              <input type="checkbox" checked={rascunho.ativo} onChange={(e) => setRascunho({ ...rascunho, ativo: e.target.checked })} className="h-5 w-5" data-testid="motivos.ativo" />
              Ativo
            </label>
          </div>
        )}
      </Drawer>
    </div>
  );
}
