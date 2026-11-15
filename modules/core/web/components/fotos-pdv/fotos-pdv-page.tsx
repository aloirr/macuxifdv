'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, CampoFormulario, CLASSE_CAMPO, Drawer, ErrorBlock, EstadoVazio, LoadingBlock, Notice, PageHeader, rotuloComContagem, TabelaDados, useToast, type ColunaDaTabela } from '@macuxi/ui/web';
import { FotoTipoCriarSchema, FotoTipoEditarSchema, FotoTiposListaSchema, type FotoTipo } from '../../../contracts';
import { fraseDoVazio, QuadroDaLista } from '../../lib/lista-bko';
import { novoId } from '../../lib/visitas';

interface Rascunho {
  id: string;
  existente: boolean;
  fachada: boolean;
  nome: string;
  obrigatorio: boolean;
  sensivel: boolean;
  ativo: boolean;
}

const vazio = (): Rascunho => ({ id: novoId(), existente: false, fachada: false, nome: '', obrigatorio: false, sensivel: false, ativo: true });

/**
 * Tipos de foto do PDV (RN-CORE-38; T-0147): o admin define os tipos (Fachada, CNH do sócio, Contrato social...) e diz quais são
 * obrigatórios e quais são documentos sensíveis (só admin, analista, gerente e supervisor da carteira abrem). A Fachada já nasce
 * cadastrada: não se apaga, não se inativa e nunca é sensível. Só o admin edita (`foto_tipo.editar`); a API revalida e audita.
 */
export function FotosPdvPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const pode = usePode('foto_tipo.editar');
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [erroApi, setErroApi] = useState<string | null>(null);
  const lista = useQuery({
    queryKey: ['core', 'fotos-tipos'],
    queryFn: async () => FotoTiposListaSchema.parse(await api<unknown>('/core/fotos-tipos')).itens,
  });
  const atualizar = () => qc.invalidateQueries({ queryKey: ['core', 'fotos-tipos'] });
  const salvar = useMutation({
    mutationFn: (r: Rascunho) =>
      r.existente
        ? api(`/core/fotos-tipos/${r.id}`, { method: 'PUT', body: FotoTipoEditarSchema.parse({ nome: r.nome, obrigatorio: r.obrigatorio, sensivel: r.sensivel, ativo: r.ativo }) })
        : api('/core/fotos-tipos', { method: 'POST', body: FotoTipoCriarSchema.parse({ id: r.id, nome: r.nome, obrigatorio: r.obrigatorio, sensivel: r.sensivel }) }),
    onSuccess: async () => {
      setRascunho(null);
      toast('success', 'Tipo de foto salvo.');
      await atualizar();
    },
    onError: (e) => setErroApi(errorMessage(e)),
  });
  const apagar = useMutation({
    mutationFn: (id: string) => api(`/core/fotos-tipos/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast('success', 'Tipo de foto apagado.');
      await atualizar();
    },
    onError: (e) => toast('danger', errorMessage(e)),
  });

  const itens = lista.data ?? [];
  const abrir = (r: Rascunho) => {
    setErroApi(null);
    setRascunho(r);
  };
  const editar = (t: FotoTipo) => abrir({ id: t.id, existente: true, fachada: t.fachada, nome: t.nome, obrigatorio: t.obrigatorio, sensivel: t.sensivel, ativo: t.ativo });

  const colunas: ReadonlyArray<ColunaDaTabela<FotoTipo>> = [
    { id: 'tipo', titulo: 'Tipo', texto: (t) => t.nome, celula: (t) => t.nome },
    {
      id: 'regras',
      titulo: 'Regras',
      prioridade: 2,
      largura: '34%',
      celula: (t) => (
        <span className="flex gap-1">
          {t.fachada ? <Badge tone="neutral">Fachada</Badge> : null}
          {t.obrigatorio ? <Badge tone="warning">Obrigatório</Badge> : <Badge tone="neutral">Opcional</Badge>}
          {t.sensivel ? <Badge tone="danger">Sensível</Badge> : null}
        </span>
      ),
    },
    { id: 'situacao', titulo: 'Situação', largura: '110px', celula: (t) => <Badge tone={t.ativo ? 'success' : 'neutral'}>{t.ativo ? 'Ativo' : 'Inativo'}</Badge> },
  ];
  const criar = pode ? (
    <Button variant="primary" onClick={() => abrir(vazio())} data-testid="fotos-pdv.novo">
      Novo tipo
    </Button>
  ) : undefined;

  return (
    <div className="flex w-full max-w-[960px] flex-col gap-5" data-testid="fotos-pdv.tela">
      <PageHeader title={rotuloComContagem('Fotos do PDV', itens.length)} actions={criar} />
      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && <LoadingBlock label="Carregando os tipos de foto…" />}
      {lista.data && (
        <QuadroDaLista vazia={itens.length === 0} vazio={<EstadoVazio titulo={fraseDoVazio('tipo de foto', false, false)} acao={criar} />}>
          <TabelaDados
            rotulo="Tipos de foto do PDV"
            colunas={colunas}
            linhas={itens}
            chave={(t) => t.id}
            linhaTestId={(t) => `fotos-pdv.linha.${t.id}`}
            esmaecida={(t) => !t.ativo}
            aoAbrir={pode ? editar : undefined}
            acoes={(t) =>
              pode
                ? [
                    { id: 'editar', rotulo: 'Editar', aoEscolher: () => editar(t), testId: `fotos-pdv.editar.${t.id}` },
                    ...(!t.fachada ? [{ id: 'apagar', rotulo: 'Apagar', perigo: true, desligada: apagar.isPending, aoEscolher: () => apagar.mutate(t.id), testId: `fotos-pdv.apagar.${t.id}` }] : []),
                  ]
                : []
            }
          />
        </QuadroDaLista>
      )}
      <Drawer
        open={rascunho !== null}
        title={rascunho?.existente ? 'Editar tipo de foto' : 'Novo tipo de foto'}
        onClose={() => setRascunho(null)}
        rodape={
          rascunho && (
            <>
              <Button onClick={() => setRascunho(null)}>Cancelar</Button>
              <Button variant="primary" disabled={salvar.isPending || !rascunho.nome.trim()} onClick={() => salvar.mutate(rascunho)} data-testid="fotos-pdv.salvar">
                {salvar.isPending ? 'Salvando…' : 'Salvar'}
              </Button>
            </>
          )
        }
      >
        {rascunho && (
          <div className="flex flex-col gap-4">
            {erroApi && <Notice tone="danger">{erroApi}</Notice>}
            <CampoFormulario rotulo="Nome">
              <input value={rascunho.nome} maxLength={60} onChange={(e) => setRascunho({ ...rascunho, nome: e.target.value })} data-testid="fotos-pdv.nome" className={CLASSE_CAMPO} />
            </CampoFormulario>
            <label className="flex min-h-[44px] items-center gap-2 text-[14px] font-medium">
              <input type="checkbox" checked={rascunho.obrigatorio} onChange={(e) => setRascunho({ ...rascunho, obrigatorio: e.target.checked })} className="h-5 w-5" data-testid="fotos-pdv.obrigatorio" />
              Obrigatório
            </label>
            <label className="flex min-h-[44px] items-center gap-2 text-[14px] font-medium">
              <input type="checkbox" checked={rascunho.sensivel} disabled={rascunho.fachada} onChange={(e) => setRascunho({ ...rascunho, sensivel: e.target.checked })} className="h-5 w-5" data-testid="fotos-pdv.sensivel" />
              Documento sensível
            </label>
            {rascunho.existente && !rascunho.fachada ? (
              <label className="flex min-h-[44px] items-center gap-2 text-[14px] font-medium">
                <input type="checkbox" checked={rascunho.ativo} onChange={(e) => setRascunho({ ...rascunho, ativo: e.target.checked })} className="h-5 w-5" data-testid="fotos-pdv.ativo" />
                Ativo
              </label>
            ) : null}
          </div>
        )}
      </Drawer>
    </div>
  );
}
