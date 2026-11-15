'use client';

import { useState } from 'react';
import type { Perfil } from '@macuxi/platform-sdk';
import { downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, Dialog, formatDateTime, Panel, rotuloComContagem, TabelaDados, useToast, type ColunaDaTabela } from '@macuxi/ui/web';
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
 * Quadro de pendências (revisão do BKO §P6, regra 5): só aparece com pelo menos uma inativação aguardando, com a contagem no
 * título; Confirmar e Recusar ficam à vista (a decisão é a ação da linha) e o CSV da amostra vai no "⋯" (§P3).
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

  if (pendencias.length === 0) return null;

  const colunas: ReadonlyArray<ColunaDaTabela<PendenciaInativacao>> = [
    { id: 'entidade', titulo: 'Entidade', celula: (p) => <span className="font-semibold">{ROTULO_ENTIDADE[p.entidade]}</span>, texto: (p) => ROTULO_ENTIDADE[p.entidade] },
    { id: 'conector', titulo: 'Conector', prioridade: 3, celula: (p) => <span className="font-mono text-[12px]">{p.conector_id}</span>, texto: (p) => p.conector_id },
    { id: 'inativaria', titulo: 'Inativaria', numero: true, largura: '120px', celula: (p) => `${p.candidatos} de ${p.total_ativos}` },
    { id: 'percentual', titulo: '% dos ativos', numero: true, largura: '112px', celula: (p) => <span className="font-semibold text-danger">{pct(p.percentual)}</span>, texto: (p) => `limite ${pct(p.limite_pct)}` },
    { id: 'amostra', titulo: 'Amostra (código no ERP)', prioridade: 3, celula: (p) => <span className="font-mono text-[12px]">{p.amostra.join(', ') || '—'}</span>, texto: (p) => p.amostra.join(', ') },
    { id: 'vale-ate', titulo: 'Vale até', numero: true, prioridade: 2, largura: '140px', celula: (p) => formatDateTime(p.expira_em, tz) },
    {
      id: 'decisao',
      titulo: 'Decisão',
      largura: '208px',
      celula: (p) => {
        const d = decisaoDaPendencia(p, perfil, agora);
        return d.pode ? (
          <div className="flex gap-2">
            <Button size="sm" variant="danger" onClick={() => abrir(p, 'confirmar')} data-testid={`integracao.inativacao.confirmar.${p.id}`}>
              Confirmar
            </Button>
            <Button size="sm" onClick={() => abrir(p, 'recusar')} data-testid={`integracao.inativacao.recusar.${p.id}`}>
              Recusar
            </Button>
          </div>
        ) : (
          <div className="text-[12px] whitespace-normal text-ink-2" data-testid={`integracao.inativacao.bloqueada.${p.id}`}>
            {d.motivo}
          </div>
        );
      },
    },
  ];

  return (
    <Panel label="Inativações aguardando" title={rotuloComContagem('Inativações aguardando', pendencias.length)}>
      <TabelaDados
        colunas={colunas}
        linhas={pendencias}
        chave={(p) => p.id}
        rotulo="Inativações aguardando"
        testId="integracao.inativacoes"
        linhaTestId={(p) => `integracao.inativacao.${p.id}`}
        acoes={(p) => [{ id: 'csv', rotulo: 'Baixar amostra (CSV)', aoEscolher: () => exportar(p), testId: `integracao.inativacao.csv.${p.id}` }]}
      />

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
                className="min-h-[72px] rounded-[10px] border border-field bg-surface p-2 text-[13px] text-ink"
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
