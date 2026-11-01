'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, ErrorBlock, LoadingBlock, Notice, PageHeader, Panel, SelectField } from '@macuxi/ui/web';
import { EnviarNotificacaoRespostaSchema, HierarquiaEquipeSchema, NotificacaoSyncSchema, RecadosEnviadosRespostaSchema, type NotificacaoSync } from '../../../contracts';

/**
 * Tela "Recados" do BKO (RF-CORE-09): envia um recado a pessoas do seu escopo (ação `notificacao.enviar`; a API
 * revalida o escopo e responde 403 FORA_DO_ESCOPO) e mostra a caixa do próprio usuário do BKO. O `id` do envio é gerado
 * ao abrir o formulário e só muda depois de enviar: clicar duas vezes não duplica. testIDs: docs/modulos/core/test-ids.md.
 */
export function RecadosPage() {
  const pode = usePode('notificacao.enviar');
  const [titulo, setTitulo] = useState('');
  const [corpo, setCorpo] = useState('');
  const [prioridade, setPrioridade] = useState<'normal' | 'alta'>('normal');
  const [escolhidos, setEscolhidos] = useState<ReadonlySet<string>>(new Set());
  const [aviso, setAviso] = useState<{ tom: 'success' | 'danger'; texto: string } | null>(null);
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
      setAviso({ tom: 'success', texto: r.criadas > 0 ? `Recado enviado para ${r.criadas} pessoa${r.criadas === 1 ? '' : 's'}. Chega no app no próximo sync.` : 'Este recado já tinha sido enviado.' });
      envioId.current = crypto.randomUUID();
      void enviados.refetch();
      setTitulo('');
      setCorpo('');
      setEscolhidos(new Set());
    },
    onError: (e) => setAviso({ tom: 'danger', texto: errorMessage(e) }),
  });

  const alternar = (id: string) =>
    setEscolhidos((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  const destinatarios = useMemo(() => (equipe.data ?? []).slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')), [equipe.data]);

  return (
    <div className="flex w-full max-w-[1000px] flex-col gap-5" data-testid="recados.tela">
      <PageHeader title="Recados" subtitle="Envie um aviso para quem está na sua equipe. Ele aparece na caixa de notificações do app." />
      {aviso && (
        <Notice tone={aviso.tom} onClose={() => setAviso(null)}>
          {aviso.texto}
        </Notice>
      )}
      {pode ? (
        <Panel title="Novo recado">
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (valido) enviar.mutate();
            }}
          >
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
              Título
              <input value={titulo} maxLength={120} onChange={(e) => setTitulo(e.target.value)} data-testid="recados.titulo" className="h-[44px] rounded-xl border border-field bg-surface px-3 text-[14px]" />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
              Mensagem
              <textarea value={corpo} maxLength={1000} rows={4} onChange={(e) => setCorpo(e.target.value)} data-testid="recados.corpo" className="rounded-xl border border-field bg-surface px-3 py-2 text-[14px]" />
            </label>
            <SelectField label="Prioridade" value={prioridade} onChange={(e) => setPrioridade(e.target.value as 'normal' | 'alta')} data-testid="recados.prioridade">
              <option value="normal">Normal</option>
              <option value="alta">Importante</option>
            </SelectField>
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
            <div>
              <Button type="submit" variant="primary" disabled={!valido || enviar.isPending} data-testid="recados.enviar">
                {enviar.isPending ? 'Enviando…' : 'Enviar recado'}
              </Button>
            </div>
          </form>
        </Panel>
      ) : (
        <Notice tone="info">Só supervisor, gerente, analista e administrador enviam recados. Você pode ler os seus abaixo.</Notice>
      )}

      {pode && (
        <Panel title="Enviados e leitura">
          {enviados.isPending && <LoadingBlock label="Carregando…" />}
          {enviados.isError && <ErrorBlock message={errorMessage(enviados.error)} onRetry={() => void enviados.refetch()} />}
          {enviados.data && enviados.data.length === 0 && <p className="m-0 text-[13px]">Nenhum recado enviado ainda.</p>}
          {enviados.data && enviados.data.length > 0 && (
            <table className="w-full border-collapse text-[13px]" data-testid="recados.enviados">
              <thead>
                <tr className="text-left text-ink-2">
                  <th className="py-1 pr-2">Recado</th>
                  <th className="py-1 pr-2">Para</th>
                  <th className="py-1 pr-2">Enviado em</th>
                  <th className="py-1">Leitura</th>
                </tr>
              </thead>
              <tbody>
                {enviados.data.map((r) => (
                  <tr key={r.id} className="border-t border-line" data-testid={`recados.enviado.${r.id}`}>
                    <td className="py-1 pr-2">{r.titulo}</td>
                    <td className="py-1 pr-2">{r.destinatario_nome}</td>
                    <td className="py-1 pr-2">{new Date(r.enviada_em).toLocaleString('pt-BR')}</td>
                    <td className="py-1">{r.lida_em ? `Lida em ${new Date(r.lida_em).toLocaleString('pt-BR')}` : <span className="font-semibold text-accent">Não lida</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      )}

      <Panel title="Minha caixa">
        {caixa.isPending && <LoadingBlock label="Carregando…" />}
        {caixa.isError && <ErrorBlock message={errorMessage(caixa.error)} onRetry={() => void caixa.refetch()} />}
        {caixa.data && caixa.data.length === 0 && <p className="m-0 text-[13px]">Nenhum aviso por enquanto.</p>}
        <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="recados.caixa">
          {(caixa.data ?? []).map((n) => (
            <li key={n.id} className="rounded-xl border border-line px-3 py-2 text-[13px]" data-testid={`recados.item.${n.id}`}>
              <strong>{n.titulo}</strong> {n.lida_em ? <span className="text-ink-2">· lida</span> : <span className="font-semibold text-accent">· não lida</span>}
              <div>{n.corpo}</div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
