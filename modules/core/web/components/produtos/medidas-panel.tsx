'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, Dialog, ErrorBlock, LoadingBlock, Panel, td, th, TableScroll } from '@macuxi/ui/web';
import { MedidasListaSchema, type Medida } from '../../../contracts';
import { DESCRICAO_MEDIDA_MAX, normalizarSigla } from '../../../domain';
import { erroDoFormularioDeMedida } from '../../lib/medidas';
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

/**
 * Medidas do produto (RN-CORE-19; RF-CORE-14), na aba Medidas de Parâmetros → Produtos. Cadastra, edita, inativa e reativa;
 * só apaga medida sem uso (em uso, o botão fica desligado e explica: inative em vez de apagar). Analista e admin editam
 * (ação `medida.gerenciar`); gerente consulta. A API revalida tudo e audita.
 */
export function MedidasPanel({ onAviso }: { onAviso: (texto: string) => void }) {
  const qc = useQueryClient();
  const pode = usePode('medida.gerenciar');
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [busca, setBusca] = useState('');
  const lista = useMedidas();

  const atualizar = () => qc.invalidateQueries({ queryKey: ['core'] });
  const salvar = useMutation({
    mutationFn: (r: Rascunho) =>
      r.existente
        ? api<unknown>(`/core/medidas/${r.id}`, { method: 'PUT', body: { descricao: r.descricao.trim(), ...(r.siglaTravada ? {} : { sigla: normalizarSigla(r.sigla) }) } })
        : api<unknown>('/core/medidas', { method: 'POST', body: { id: r.id, sigla: normalizarSigla(r.sigla), descricao: r.descricao.trim() } }),
    onSuccess: async () => {
      setRascunho(null);
      onAviso('Medida salva. Os aparelhos recebem na próxima sincronização.');
      await atualizar();
    },
    onError: (e) => onAviso(errorMessage(e)),
  });
  const alternar = useMutation({
    mutationFn: (m: Medida) => api<unknown>(`/core/medidas/${m.id}`, { method: 'PUT', body: { ativo: !m.ativo } }),
    onSuccess: async (_r, m) => {
      onAviso(m.ativo ? `Medida ${m.sigla} inativada. Produtos que já a usam mantêm a sigla; ela não aparece mais nas escolhas novas.` : `Medida ${m.sigla} reativada.`);
      await atualizar();
    },
    onError: (e) => onAviso(errorMessage(e)),
  });
  const apagar = useMutation({
    mutationFn: (m: Medida) => api<unknown>(`/core/medidas/${m.id}`, { method: 'DELETE' }),
    onSuccess: async (_r, m) => {
      onAviso(`Medida ${m.sigla} apagada.`);
      await atualizar();
    },
    onError: (e) => onAviso(errorMessage(e)),
  });

  const itens = (lista.data ?? []).filter((m) => !busca.trim() || `${m.sigla} ${m.descricao}`.toLowerCase().includes(busca.trim().toLowerCase()));
  const erroForm = rascunho ? erroDoFormularioDeMedida(rascunho.sigla, rascunho.descricao) : null;

  return (
    <div className="flex flex-col gap-4" data-testid="medidas.tela">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por sigla ou descrição"
          aria-label="Buscar medida"
          data-testid="medidas.busca"
          className="h-[44px] max-w-[360px] flex-1 rounded-xl border border-field bg-surface px-3 text-[14px]"
        />
        <Button variant="primary" disabled={!pode} onClick={() => setRascunho({ id: novoId(), existente: false, sigla: '', descricao: '', siglaTravada: false })} data-testid="medidas.nova">
          Nova medida
        </Button>
      </div>
      {!pode && <p className="text-[13px] text-ink-2">Só analista e administrador cadastram medidas. Você pode consultar.</p>}
      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && <LoadingBlock label="Carregando as medidas…" />}
      {lista.data && (
        <Panel title={`${itens.length} medidas`}>
          <TableScroll minWidth={640}>
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={th}>Sigla</th>
                  <th className={th}>Descrição</th>
                  <th className={th}>Situação</th>
                  <th className={th}>Produtos</th>
                  <th className={th}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((m) => (
                  <tr key={m.id} data-testid={`medidas.linha.${m.sigla}`}>
                    <td className={`${td} font-mono font-semibold`}>{m.sigla}</td>
                    <td className={td}>{m.descricao}</td>
                    <td className={td}>
                      <Badge tone={m.ativo ? 'success' : 'warning'}>{m.ativo ? 'Ativa' : 'Inativa'}</Badge>
                    </td>
                    <td className={td}>{m.em_uso === 0 ? <span className="text-ink-2">sem uso</span> : `${m.em_uso} em uso`}</td>
                    <td className={td}>
                      <div className="flex flex-wrap gap-2">
                        <Button disabled={!pode} onClick={() => setRascunho({ id: m.id, existente: true, sigla: m.sigla, descricao: m.descricao, siglaTravada: m.em_uso > 0 })} data-testid={`medidas.editar.${m.sigla}`}>
                          Editar
                        </Button>
                        <Button disabled={!pode || alternar.isPending} onClick={() => alternar.mutate(m)} data-testid={`medidas.alternar.${m.sigla}`}>
                          {m.ativo ? 'Inativar' : 'Reativar'}
                        </Button>
                        <Button
                          disabled={!pode || apagar.isPending || m.em_uso > 0}
                          title={m.em_uso > 0 ? `Medida em uso por ${m.em_uso} produto(s): inative em vez de apagar.` : undefined}
                          onClick={() => apagar.mutate(m)}
                          data-testid={`medidas.apagar.${m.sigla}`}
                        >
                          Apagar
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
      )}
      {rascunho && (
        <Dialog
          open
          title={rascunho.existente ? `Editar medida ${rascunho.sigla}` : 'Nova medida'}
          onClose={() => setRascunho(null)}
          footer={
            <>
              <Button onClick={() => setRascunho(null)}>Cancelar</Button>
              <Button variant="primary" disabled={salvar.isPending || erroForm !== null} onClick={() => salvar.mutate(rascunho)} data-testid="medidas.salvar">
                Salvar
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3 text-[13px] font-semibold text-ink">
            <label className="flex flex-col gap-1">
              Sigla (1 a 4 letras)
              <input
                value={rascunho.sigla}
                maxLength={4}
                disabled={rascunho.siglaTravada}
                onChange={(e) => setRascunho({ ...rascunho, sigla: e.target.value.toUpperCase() })}
                data-testid="medidas.sigla"
                className="h-[44px] max-w-[160px] rounded-xl border border-field bg-surface px-3 font-mono text-[14px] font-normal uppercase"
              />
            </label>
            {rascunho.siglaTravada && <p className="font-normal text-ink-2">A sigla não muda enquanto algum produto usa a medida. Altere só a descrição ou crie outra medida e inative esta.</p>}
            <label className="flex flex-col gap-1">
              Descrição (ex.: Caixa)
              <input
                value={rascunho.descricao}
                maxLength={DESCRICAO_MEDIDA_MAX}
                onChange={(e) => setRascunho({ ...rascunho, descricao: e.target.value })}
                data-testid="medidas.descricao"
                className="h-[44px] rounded-xl border border-field bg-surface px-3 text-[14px] font-normal"
              />
            </label>
            {erroForm && (rascunho.sigla !== '' || rascunho.descricao !== '') && <p className="font-normal text-danger">{erroForm}</p>}
          </div>
        </Dialog>
      )}
    </div>
  );
}
