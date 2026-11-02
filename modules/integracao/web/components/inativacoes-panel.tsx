'use client';

import { useState } from 'react';
import type { Perfil } from '@macuxi/platform-sdk';
import { downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, Dialog, formatDateTime, IconDownload, Panel, TableScroll, td, tdNum, th, thNum, useToast } from '@macuxi/ui/web';
import type { DecidirInativacaoEntrada, PendenciaInativacao } from '../../contracts';
import { decisaoDaPendencia, ROTULO_ENTIDADE } from '../lib/apresentacao';
import { pendenciaParaCsv } from '../lib/csv';
import { useDecidirInativacao } from '../lib/queries';

type Acao = DecidirInativacaoEntrada['acao'];

const pct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

/**
 * Inativação em massa aguardando confirmação (RN-INT-06, P-3): a carga completa inativaria mais que o limite dos ativos. Admin ou
 * analista confirma ou recusa, com motivo opcional; a API grava a auditoria (quem, quando, lote, quantidade) na mesma transação.
 * O botão só aparece habilitado para quem pode (`decisaoDaPendencia`); a API revalida perfil, validade e estado.
 */
export function InativacoesPanel({ pendencias, perfil, agora, tz }: { pendencias: readonly PendenciaInativacao[]; perfil: Perfil | null; agora: Date; tz: string }) {
  const toast = useToast();
  const decidir = useDecidirInativacao();
  const [aberta, setAberta] = useState<{ p: PendenciaInativacao; acao: Acao } | null>(null);
  const [motivo, setMotivo] = useState('');

  const abrir = (p: PendenciaInativacao, acao: Acao) => {
    setMotivo('');
    setAberta({ p, acao });
  };
  const fechar = () => {
    if (!decidir.isPending) setAberta(null);
  };

  const enviar = () => {
    if (!aberta) return;
    const { p, acao } = aberta;
    const entrada: DecidirInativacaoEntrada = { acao, ...(motivo.trim() ? { motivo: motivo.trim().slice(0, 300) } : {}) };
    decidir.mutate(
      { id: p.id, entrada },
      {
        onSuccess: (r) => {
          toast('success', acao === 'confirmar' ? `Inativação confirmada: ${r.inativadas} registros de ${ROTULO_ENTIDADE[p.entidade]} inativados.` : `Inativação recusada: nenhum registro de ${ROTULO_ENTIDADE[p.entidade]} foi inativado.`);
          setAberta(null);
        },
        onError: (e) => toast('danger', errorMessage(e)),
      },
    );
  };

  const exportar = (p: PendenciaInativacao) => {
    downloadBlob(new Blob([pendenciaParaCsv(p, tz)], { type: 'text/csv;charset=utf-8' }), `inativacao_${p.entidade}_${p.lote_id.slice(0, 8)}.csv`);
  };

  return (
    <Panel label="Inativações aguardando" title={<>Inativação em massa <span className="font-sans text-[13px] font-normal text-ink-2">· {pendencias.length} aguardando</span></>}>
      {pendencias.length === 0 ? (
        <span className="text-[13px] text-ink-2" data-testid="integracao.inativacoes.vazio">
          Nenhuma carga completa aguardando confirmação.
        </span>
      ) : (
        <TableScroll minWidth={860}>
          <thead>
            <tr>
              <th scope="col" className={th}>Entidade</th>
              <th scope="col" className={th}>Conector</th>
              <th scope="col" className={thNum}>Inativaria</th>
              <th scope="col" className={thNum}>% dos ativos</th>
              <th scope="col" className={th}>Amostra (código no ERP)</th>
              <th scope="col" className={th}>Vale até</th>
              <th scope="col" className={th}>Decisão</th>
            </tr>
          </thead>
          <tbody data-testid="integracao.inativacoes">
            {pendencias.map((p) => {
              const d = decisaoDaPendencia(p, perfil, agora);
              return (
                <tr key={p.id} data-testid={`integracao.inativacao.${p.id}`}>
                  <td className={`${td} font-semibold`}>{ROTULO_ENTIDADE[p.entidade]}</td>
                  <td className={`${td} font-mono text-[12px]`}>{p.conector_id}</td>
                  <td className={tdNum}>
                    {p.candidatos} de {p.total_ativos}
                  </td>
                  <td className={`${tdNum} font-semibold text-danger`}>
                    {pct(p.percentual)}
                    <div className="text-[11px] font-normal text-ink-2">limite {pct(p.limite_pct)}</div>
                  </td>
                  <td className={`${td} max-w-[220px] font-mono text-[12px]`}>
                    <span className="line-clamp-2 break-all">{p.amostra.join(', ') || '—'}</span>
                    <Button variant="link" size="sm" onClick={() => exportar(p)} data-testid={`integracao.inativacao.csv.${p.id}`}>
                      <IconDownload size={13} />
                      CSV
                    </Button>
                  </td>
                  <td className={`${td} whitespace-nowrap`}>{formatDateTime(p.expira_em, tz)}</td>
                  <td className={td}>
                    {d.pode ? (
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="danger" onClick={() => abrir(p, 'confirmar')} data-testid={`integracao.inativacao.confirmar.${p.id}`}>
                          Confirmar
                        </Button>
                        <Button size="sm" onClick={() => abrir(p, 'recusar')} data-testid={`integracao.inativacao.recusar.${p.id}`}>
                          Recusar
                        </Button>
                      </div>
                    ) : (
                      <span className="text-[12px] text-ink-2" data-testid={`integracao.inativacao.bloqueada.${p.id}`}>
                        {d.motivo}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableScroll>
      )}

      <Dialog
        open={!!aberta}
        title={aberta?.acao === 'confirmar' ? 'Confirmar a inativação?' : 'Recusar a inativação?'}
        onClose={fechar}
        footer={
          <>
            <Button onClick={fechar} disabled={decidir.isPending}>
              Voltar
            </Button>
            <Button variant={aberta?.acao === 'confirmar' ? 'danger' : 'primary'} onClick={enviar} disabled={decidir.isPending} data-testid="integracao.inativacao.enviar">
              {decidir.isPending ? 'Enviando…' : aberta?.acao === 'confirmar' ? 'Confirmar inativação' : 'Recusar inativação'}
            </Button>
          </>
        }
      >
        {aberta && (
          <div className="flex flex-col gap-3">
            <p className="m-0">
              {aberta.acao === 'confirmar'
                ? `Até ${aberta.p.candidatos} registros de ${ROTULO_ENTIDADE[aberta.p.entidade]} (${pct(aberta.p.percentual)} dos ativos) saem dos aparelhos e do Backoffice. Nada é apagado: a inativação é lógica e fica na auditoria.`
                : `Nenhum registro de ${ROTULO_ENTIDADE[aberta.p.entidade]} será inativado. O lote continua aplicado; se a ausência for real, o Conector precisa mandar uma nova carga completa.`}
            </p>
            <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
              Motivo (opcional, fica na auditoria)
              <textarea
                className="min-h-[72px] rounded-[10px] border border-field bg-surface p-2 text-[14px] text-ink"
                maxLength={300}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                data-testid="integracao.inativacao.motivo"
              />
            </label>
          </div>
        )}
      </Dialog>
    </Panel>
  );
}
