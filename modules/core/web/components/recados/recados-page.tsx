'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, CampoFormulario, CLASSE_CAMPO, Drawer, ErrorBlock, EstadoVazio, formatDateTime, LoadingBlock, Notice, PageHeader, Panel, rotuloComContagem, TabelaDados, useToast, type ColunaDaTabela } from '@macuxi/ui/web';
import { EnviarNotificacaoRespostaSchema, HierarquiaEquipeSchema, NotificacaoSyncSchema, RecadoDoDiaDesmarcadoSchema, RecadoDoDiaMarcadoSchema, RecadosEnviadosRespostaSchema, type NotificacaoSync } from '../../../contracts';
import { useMe } from '../../lib/queries';
import { ACAO_RECADO_DO_DIA, agruparPorEnvio, mensagemDoRecadoDoDia, podeMarcarRecadoDoDia } from '../../lib/recado-do-dia';

/**
 * Tela "Recados" do BKO (RF-CORE-09): envia um recado a pessoas do seu escopo (ação `notificacao.enviar`; a API
 * revalida o escopo e responde 403 FORA_DO_ESCOPO) e mostra os envios, a leitura por pessoa e a caixa do próprio usuário do
 * BKO, em abas com a contagem. O `id` do envio é gerado ao abrir a gaveta e só muda depois de enviar: clicar duas vezes
 * não duplica. testIDs: docs/modulos/core/test-ids.md.
 */
type Aba = 'envios' | 'pessoas' | 'caixa';

export function RecadosPage() {
  const pode = usePode('notificacao.enviar');
  const podeRecadoDoDia = usePode(ACAO_RECADO_DO_DIA);
  const fuso = useMe().data.tenant.timezone;
  const toast = useToast();
  const [aberto, setAberto] = useState(false);
  const [aba, setAba] = useState<Aba>(pode ? 'envios' : 'caixa');
  const [titulo, setTitulo] = useState('');
  const [corpo, setCorpo] = useState('');
  const [prioridade, setPrioridade] = useState<'normal' | 'alta'>('normal');
  const [escolhidos, setEscolhidos] = useState<ReadonlySet<string>>(new Set());
  const [erroApi, setErroApi] = useState<string | null>(null);
  const envioId = useRef<string>(crypto.randomUUID());

  const equipe = useQuery({
    queryKey: ['core', 'equipe-hierarquia'],
    enabled: pode,
    queryFn: async () => HierarquiaEquipeSchema.parse(await api('/core/equipe/hierarquia')).membros.filter((m) => m.ativo),
  });
  const caixa = useQuery({
    queryKey: ['core', 'notificacoes'],
    queryFn: async () => ((await api<{ itens: unknown[] }>('/core/notificacoes?limite=50')).itens.map((i) => NotificacaoSyncSchema.parse(i))) as NotificacaoSync[],
  });

  const enviados = useQuery({
    queryKey: ['core', 'recados-enviados'],
    enabled: pode,
    queryFn: async () => RecadosEnviadosRespostaSchema.parse(await api('/core/notificacoes/enviadas?limite=100')).itens,
  });

  const valido = titulo.trim().length > 0 && corpo.trim().length > 0 && escolhidos.size > 0;
  const enviar = useMutation({
    mutationFn: async () =>
      EnviarNotificacaoRespostaSchema.parse(
        await api('/core/notificacoes', { method: 'POST', body: { id: envioId.current, usuario_ids: [...escolhidos], titulo: titulo.trim(), corpo: corpo.trim(), prioridade } }),
      ),
    onSuccess: (r) => {
      toast('success', r.criadas > 0 ? `Recado enviado para ${r.criadas} pessoa${r.criadas === 1 ? '' : 's'}.` : 'Este recado já tinha sido enviado.');
      envioId.current = crypto.randomUUID();
      void enviados.refetch();
      setTitulo('');
      setCorpo('');
      setEscolhidos(new Set());
      setAberto(false);
    },
    onError: (e) => setErroApi(errorMessage(e)),
  });

  // RN-CORE-26: marcar/tirar o recado do dia por envio. O servidor decide o dia (hoje no fuso do tenant); o corpo é vazio.
  const marcar = useMutation({
    mutationFn: async (v: { envioId: string; marcar: boolean }) => {
      const caminho = `/core/notificacoes/envios/${v.envioId}/recado-do-dia`;
      if (v.marcar) return RecadoDoDiaMarcadoSchema.parse(await api(caminho, { method: 'PUT', body: {} }));
      return RecadoDoDiaDesmarcadoSchema.parse(await api(caminho, { method: 'DELETE' }));
    },
    onSuccess: (_r, v) => {
      toast('success', v.marcar ? 'Recado do dia marcado.' : 'Recado do dia retirado.');
      void enviados.refetch();
    },
    onError: (e) => toast('danger', mensagemDoRecadoDoDia(e, errorMessage(e))),
  });
  const envios = useMemo(() => agruparPorEnvio(enviados.data ?? [], new Date(), fuso), [enviados.data, fuso]);

  const alternar = (id: string) =>
    setEscolhidos((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  const destinatarios = useMemo(() => (equipe.data ?? []).slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')), [equipe.data]);

  const colunasEnvios: ReadonlyArray<ColunaDaTabela<(typeof envios)[number]>> = [
    {
      id: 'envio',
      titulo: 'Recado',
      texto: (e) => e.titulo,
      celula: (e) => (
        <>
          {e.titulo}{' '}
          {e.recado_do_dia_hoje && (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[12px] font-semibold text-accent-ink" data-testid={`recados.chip-recado-do-dia.${e.envio_id}`}>
              Recado do dia · hoje
            </span>
          )}
        </>
      ),
    },
    { id: 'quando', titulo: 'Enviado em', prioridade: 2, largura: '150px', celula: (e) => formatDateTime(e.enviada_em, fuso), texto: (e) => formatDateTime(e.enviada_em, fuso) },
    { id: 'lidas', titulo: 'Lidas', numero: true, largura: '110px', celula: (e) => `${e.lidas} de ${e.destinatarios}`, texto: (e) => `${e.lidas} de ${e.destinatarios}` },
  ];
  const lista = enviados.data ?? [];
  const colunasPessoas: ReadonlyArray<ColunaDaTabela<(typeof lista)[number]>> = [
    { id: 'para', titulo: 'Para', texto: (r) => r.destinatario_nome, celula: (r) => r.destinatario_nome },
    { id: 'recado', titulo: 'Recado', texto: (r) => r.titulo, celula: (r) => r.titulo },
    { id: 'quando', titulo: 'Enviado em', prioridade: 2, largura: '150px', celula: (r) => formatDateTime(r.enviada_em, fuso), texto: (r) => formatDateTime(r.enviada_em, fuso) },
    {
      id: 'leitura',
      titulo: 'Leitura',
      largura: '170px',
      texto: (r) => (r.lida_em ? `Lida em ${formatDateTime(r.lida_em, fuso)}` : 'Não lida'),
      celula: (r) => (r.lida_em ? `Lida em ${formatDateTime(r.lida_em, fuso)}` : <span className="font-semibold text-accent-ink">Não lida</span>),
    },
  ];
  const abas: ReadonlyArray<readonly [Aba, string]> = [
    ...(pode ? ([['envios', rotuloComContagem('Envios', envios.length)], ['pessoas', rotuloComContagem('Por pessoa', lista.length)]] as const) : []),
    ['caixa', rotuloComContagem('Minha caixa', caixa.data?.length ?? 0)],
  ];

  return (
    <div className="flex w-full max-w-[1000px] flex-col gap-5" data-testid="recados.tela">
      <PageHeader
        title="Recados"
        actions={
          pode ? (
            <Button
              variant="primary"
              onClick={() => {
                setErroApi(null);
                setAberto(true);
              }}
              data-testid="recados.novo"
            >
              Novo recado
            </Button>
          ) : undefined
        }
      />
      <div className="flex gap-2" role="group" aria-label="Ver">
        {abas.map(([v, rotulo]) => (
          <Button key={v} size="sm" variant={aba === v ? 'primary' : 'secondary'} aria-pressed={aba === v} onClick={() => setAba(v)} data-testid={`recados.aba.${v}`}>
            {rotulo}
          </Button>
        ))}
      </div>

      {pode && aba !== 'caixa' && enviados.isPending && <LoadingBlock label="Carregando…" />}
      {pode && aba !== 'caixa' && enviados.isError && <ErrorBlock message={errorMessage(enviados.error)} onRetry={() => void enviados.refetch()} />}

      {pode && aba === 'envios' && enviados.data && (
        <Panel>
          <TabelaDados
            rotulo="Envios"
            testId="recados.envios"
            colunas={colunasEnvios}
            linhas={envios}
            chave={(e) => e.envio_id}
            linhaTestId={(e) => `recados.envio.${e.envio_id}`}
            vazio={<EstadoVazio titulo="Nenhum recado enviado." />}
            acoes={podeRecadoDoDia ? (e) => (podeMarcarRecadoDoDia(podeRecadoDoDia, e) ? [{ id: 'dia', rotulo: e.recado_do_dia_hoje ? 'Tirar recado do dia' : 'Marcar como recado do dia', desligada: marcar.isPending, aoEscolher: () => marcar.mutate({ envioId: e.envio_id, marcar: !e.recado_do_dia_hoje }), testId: `recados.recado-do-dia.${e.envio_id}` }] : []) : undefined}
          />
        </Panel>
      )}

      {pode && aba === 'pessoas' && enviados.data && (
        <Panel>
          <TabelaDados rotulo="Recados por pessoa" testId="recados.enviados" colunas={colunasPessoas} linhas={lista} chave={(r) => r.id} linhaTestId={(r) => `recados.enviado.${r.id}`} vazio={<EstadoVazio titulo="Nenhum recado enviado." />} />
        </Panel>
      )}

      {aba === 'caixa' && (
        <>
          {caixa.isPending && <LoadingBlock label="Carregando…" />}
          {caixa.isError && <ErrorBlock message={errorMessage(caixa.error)} onRetry={() => void caixa.refetch()} />}
          {caixa.data && caixa.data.length === 0 && <EstadoVazio titulo="Nenhum aviso." />}
          {caixa.data && caixa.data.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="recados.caixa">
              {caixa.data.map((n) => (
                <li key={n.id} className="rounded-xl border border-line bg-surface px-3 py-2 text-[13px]" data-testid={`recados.item.${n.id}`}>
                  <strong>{n.titulo}</strong> {n.lida_em ? <span className="text-ink-2">· lida</span> : <span className="font-semibold text-accent-ink">· não lida</span>}
                  <div>{n.corpo}</div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {pode && (
        <Drawer
          open={aberto}
          title="Novo recado"
          onClose={() => setAberto(false)}
          rodape={
            <>
              <Button onClick={() => setAberto(false)}>Cancelar</Button>
              <Button type="submit" form="recados.form" variant="primary" disabled={!valido || enviar.isPending} data-testid="recados.enviar">
                {enviar.isPending ? 'Enviando…' : 'Enviar recado'}
              </Button>
            </>
          }
        >
          <form
            id="recados.form"
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (valido) enviar.mutate();
            }}
          >
            {erroApi && <Notice tone="danger">{erroApi}</Notice>}
            <CampoFormulario rotulo="Título">
              <input value={titulo} maxLength={120} onChange={(e) => setTitulo(e.target.value)} data-testid="recados.titulo" className={CLASSE_CAMPO} />
            </CampoFormulario>
            <CampoFormulario rotulo="Mensagem">
              <textarea value={corpo} maxLength={1000} rows={4} onChange={(e) => setCorpo(e.target.value)} data-testid="recados.corpo" className={`${CLASSE_CAMPO} h-auto py-2`} />
            </CampoFormulario>
            <CampoFormulario rotulo="Prioridade">
              <select value={prioridade} onChange={(e) => setPrioridade(e.target.value as 'normal' | 'alta')} data-testid="recados.prioridade" className={CLASSE_CAMPO}>
                <option value="normal">Normal</option>
                <option value="alta">Importante</option>
              </select>
            </CampoFormulario>
            <fieldset className="flex flex-col gap-1 border-0 p-0">
              <legend className="text-[13px] font-semibold text-ink">Para quem ({escolhidos.size} escolhido{escolhidos.size === 1 ? '' : 's'})</legend>
              {equipe.isPending && <LoadingBlock label="Carregando a equipe…" />}
              {equipe.isError && <ErrorBlock message={errorMessage(equipe.error)} onRetry={() => void equipe.refetch()} />}
              {equipe.data && destinatarios.length === 0 && <p className="m-0 text-[13px]">Você não tem ninguém na equipe para receber recados.</p>}
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {destinatarios.map((m) => (
                  <label key={m.id} className="flex min-h-[44px] items-center gap-2 text-[14px]">
                    <input type="checkbox" checked={escolhidos.has(m.id)} onChange={() => alternar(m.id)} data-testid={`recados.destino.${m.id}`} className="h-5 w-5" />
                    {m.nome} <span className="text-ink-2">({m.perfil})</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </form>
        </Drawer>
      )}
    </div>
  );
}
