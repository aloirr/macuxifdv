'use client';

import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, Dialog, Notice, td, th, TableScroll } from '@macuxi/ui/web';
import {
  caminhoDispensa,
  dataOuTraco,
  JUSTIFICATIVA_MAX,
  SITUACAO_ETAPA,
  TEXTO_VISITA_CONTA,
  temPendente,
  tituloDialogoEtapas,
  validarJustificativa,
  type EtapaVisitaBko,
  type VisitaComEtapas,
} from '../../lib/etapas-visita';

/**
 * Diálogo "Etapas da visita" (T-0039; checkout-pendencia.md §3.2). As etapas vêm na própria lista de visitas.
 * "Dispensar" (desenho §2.5a) só para quem tem `visita.dispensar_etapa` (supervisor e admin); a API revalida e audita.
 * testIDs: `visitas.etapas` · `.etapa.<modulo>.<etapa>` · `.dispensar.<modulo>.<etapa>` · `.justificativa` · `.confirmar-dispensa` · `.fechar`.
 */
export function EtapasDialog({
  visita,
  fuso,
  onClose,
}: {
  visita: VisitaComEtapas;
  fuso: string;
  onClose: () => void;
}) {
  const pode = usePode('visita.dispensar_etapa');
  const qc = useQueryClient();
  const idErro = useId();
  const [alvo, setAlvo] = useState<EtapaVisitaBko | null>(null);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [erroApi, setErroApi] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const dispensar = useMutation({
    mutationFn: async (a: { etapa: EtapaVisitaBko; justificativa: string }) =>
      api<unknown>(caminhoDispensa(visita.id, a.etapa.modulo, a.etapa.etapa), {
        method: 'POST',
        body: { justificativa: a.justificativa },
      }),
    onSuccess: async () => {
      setAlvo(null);
      setTexto('');
      setAviso('Etapa dispensada. A visita segue como concluída');
      await qc.invalidateQueries({ queryKey: ['core', 'visitas'] });
    },
    onError: (e) => setErroApi(errorMessage(e)),
  });

  const confirmar = () => {
    if (!alvo) return;
    const v = validarJustificativa(texto);
    if (!v.ok) return setErro(v.erro);
    setErro(null);
    setErroApi(null);
    dispensar.mutate({ etapa: alvo, justificativa: v.valor });
  };

  return (
    <Dialog
      open
      title={tituloDialogoEtapas(visita.cliente_nome, visita.checkin_em, fuso)}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose} data-testid="visitas.etapas.fechar">
          Fechar
        </Button>
      }
    >
      <div className="flex flex-col gap-3" data-testid="visitas.etapas">
        {erroApi && (
          <Notice tone="danger" onClose={() => setErroApi(null)}>
            <span data-testid="visitas.etapas.erro-api">{erroApi}</span>
          </Notice>
        )}
        {aviso && (
          <Notice tone="success" onClose={() => setAviso(null)}>
            {aviso}
          </Notice>
        )}
        <TableScroll minWidth={520}>
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={th}>Etapa</th>
                <th className={th}>Situação</th>
                <th className={th}>Desde</th>
                <th className={th}>Alerta enviado</th>
                {pode && <th className={th}>Ação</th>}
              </tr>
            </thead>
            <tbody>
              {visita.etapas.map((e) => {
                const s = SITUACAO_ETAPA[e.situacao];
                const chave = `${e.modulo}.${e.etapa}`;
                return (
                  <tr key={chave} data-testid={`visitas.etapas.etapa.${chave}`}>
                    <td className={td}>{e.rotulo ?? e.etapa}</td>
                    <td className={td}>
                      <Badge tone={s.tom}>{s.rotulo}</Badge>
                    </td>
                    <td className={td}>{dataOuTraco(e.pendente_desde, fuso)}</td>
                    <td className={td}>{dataOuTraco(e.alertada_em, fuso)}</td>
                    {pode && (
                      <td className={td}>
                        {e.situacao === 'pendente' ? (
                          <button
                            type="button"
                            onClick={() => {
                              setAlvo(e);
                              setTexto('');
                              setErro(null);
                              setErroApi(null);
                              setAviso(null);
                            }}
                            aria-label={`Dispensar a etapa ${e.rotulo ?? e.etapa}`}
                            data-testid={`visitas.etapas.dispensar.${chave}`}
                            className="h-[44px] min-w-[88px] rounded-xl border border-field bg-surface px-3 text-[13px] font-semibold text-ink hover:bg-ground"
                          >
                            Dispensar
                          </button>
                        ) : null}
                      </td>
                    )}
                  </tr>
                );
              })}
              {visita.etapas.length === 0 && (
                <tr>
                  <td className={td} colSpan={pode ? 5 : 4}>
                    Nenhuma etapa registrada nesta visita.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TableScroll>
        {temPendente(visita.etapas) && <p className="m-0 text-[13px] text-ink-2">{TEXTO_VISITA_CONTA}</p>}
        {pode && alvo && (
          <div
            className="flex flex-col gap-2 rounded-xl border border-field p-3"
            data-testid="visitas.etapas.dispensa"
          >
            <label className="flex flex-col gap-1 text-[14px] font-semibold text-ink">
              Justificativa para dispensar "{alvo.rotulo ?? alvo.etapa}"
              <span className="text-[13px] font-normal text-ink-2">
                Fica registrada na auditoria, com o seu nome. De 3 a {JUSTIFICATIVA_MAX} caracteres
              </span>
              {erro && (
                <span
                  id={idErro}
                  role="alert"
                  className="text-[13px] font-normal text-danger"
                  data-testid="visitas.etapas.erro"
                >
                  {erro}
                </span>
              )}
              <textarea
                value={texto}
                maxLength={JUSTIFICATIVA_MAX + 40}
                rows={3}
                autoFocus
                onChange={(ev) => setTexto(ev.target.value)}
                aria-invalid={erro ? true : undefined}
                aria-describedby={erro ? idErro : undefined}
                data-testid="visitas.etapas.justificativa"
                className={`w-full rounded-xl border bg-surface px-3 py-2 text-[14px] font-normal text-ink ${erro ? 'border-danger' : 'border-field'}`}
              />
              {texto.trim().length >= 250 && (
                <span
                  className={`self-end text-[13px] font-normal tabular-nums ${texto.trim().length > JUSTIFICATIVA_MAX ? 'text-danger' : 'text-ink-2'}`}
                  data-testid="visitas.etapas.contador"
                >
                  {texto.trim().length} de {JUSTIFICATIVA_MAX} caracteres
                </span>
              )}
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={confirmar}
                disabled={dispensar.isPending}
                data-testid="visitas.etapas.confirmar-dispensa"
              >
                {dispensar.isPending ? 'Dispensando…' : 'Dispensar etapa'}
              </Button>
              <Button variant="secondary" onClick={() => setAlvo(null)} disabled={dispensar.isPending}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
