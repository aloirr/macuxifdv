'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, CampoFormulario, CLASSE_CAMPO, Drawer, EstadoVazio, Notice, TabelaDados, useToast, type ColunaDaTabela } from '@macuxi/ui/web';
import {
  caminhoDispensa,
  dataOuTraco,
  JUSTIFICATIVA_MAX,
  SITUACAO_ETAPA,
  tituloDialogoEtapas,
  validarJustificativa,
  type EtapaVisitaBko,
  type VisitaComEtapas,
} from '../../lib/etapas-visita';

/**
 * Gaveta "Etapas da visita" (T-0039; checkout-pendencia.md §3.2). As etapas vêm na própria lista de visitas.
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
  const toast = useToast();
  const [alvo, setAlvo] = useState<EtapaVisitaBko | null>(null);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [erroApi, setErroApi] = useState<string | null>(null);

  const dispensar = useMutation({
    mutationFn: async (a: { etapa: EtapaVisitaBko; justificativa: string }) =>
      api<unknown>(caminhoDispensa(visita.id, a.etapa.modulo, a.etapa.etapa), {
        method: 'POST',
        body: { justificativa: a.justificativa },
      }),
    onSuccess: async () => {
      setAlvo(null);
      setTexto('');
      toast('success', 'Etapa dispensada.');
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

  const colunas: ReadonlyArray<ColunaDaTabela<EtapaVisitaBko>> = [
    { id: 'etapa', titulo: 'Etapa', texto: (e) => e.rotulo ?? e.etapa, celula: (e) => e.rotulo ?? e.etapa },
    {
      id: 'situacao',
      titulo: 'Situação',
      largura: '110px',
      celula: (e) => {
        const s = SITUACAO_ETAPA[e.situacao];
        return <Badge tone={s.tom}>{s.rotulo}</Badge>;
      },
    },
    { id: 'desde', titulo: 'Desde', largura: '110px', celula: (e) => dataOuTraco(e.pendente_desde, fuso), texto: (e) => dataOuTraco(e.pendente_desde, fuso) },
    { id: 'alerta', titulo: 'Alerta enviado', largura: '110px', celula: (e) => dataOuTraco(e.alertada_em, fuso), texto: (e) => dataOuTraco(e.alertada_em, fuso) },
  ];
  const abrirDispensa = (e: EtapaVisitaBko) => {
    setAlvo(e);
    setTexto('');
    setErro(null);
    setErroApi(null);
  };

  return (
    <Drawer
      open
      title={tituloDialogoEtapas(visita.cliente_nome, visita.checkin_em, fuso)}
      onClose={onClose}
      rodape={
        alvo ? (
          <>
            <Button variant="secondary" onClick={() => setAlvo(null)} disabled={dispensar.isPending}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={confirmar} disabled={dispensar.isPending} data-testid="visitas.etapas.confirmar-dispensa">
              {dispensar.isPending ? 'Dispensando…' : 'Dispensar etapa'}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose} data-testid="visitas.etapas.fechar">
            Fechar
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4" data-testid="visitas.etapas">
        {erroApi && (
          <Notice tone="danger" onClose={() => setErroApi(null)}>
            <span data-testid="visitas.etapas.erro-api">{erroApi}</span>
          </Notice>
        )}
        <TabelaDados
          rotulo="Etapas da visita"
          colunas={colunas}
          linhas={visita.etapas}
          chave={(e) => `${e.modulo}.${e.etapa}`}
          linhaTestId={(e) => `visitas.etapas.etapa.${e.modulo}.${e.etapa}`}
          vazio={<EstadoVazio titulo="Nenhuma etapa registrada nesta visita." />}
          acoes={
            pode
              ? (e) => (e.situacao === 'pendente' ? [{ id: 'dispensar', rotulo: 'Dispensar', aoEscolher: () => abrirDispensa(e), testId: `visitas.etapas.dispensar.${e.modulo}.${e.etapa}` }] : [])
              : undefined
          }
        />
        {pode && alvo && (
          <div className="flex flex-col gap-2" data-testid="visitas.etapas.dispensa">
            <CampoFormulario rotulo={`Justificativa para dispensar "${alvo.rotulo ?? alvo.etapa}"`}>
              <textarea
                value={texto}
                maxLength={JUSTIFICATIVA_MAX + 40}
                rows={3}
                autoFocus
                onChange={(ev) => setTexto(ev.target.value)}
                aria-invalid={erro ? true : undefined}
                data-testid="visitas.etapas.justificativa"
                className={`${CLASSE_CAMPO} h-auto py-2`}
              />
              {erro && (
                <span role="alert" className="text-[13px] font-normal text-danger" data-testid="visitas.etapas.erro">
                  {erro}
                </span>
              )}
              {texto.trim().length >= 250 && (
                <span className={`self-end text-[13px] font-normal tabular-nums ${texto.trim().length > JUSTIFICATIVA_MAX ? 'text-danger' : 'text-ink-2'}`} data-testid="visitas.etapas.contador">
                  {texto.trim().length} de {JUSTIFICATIVA_MAX} caracteres
                </span>
              )}
            </CampoFormulario>
          </div>
        )}
      </div>
    </Drawer>
  );
}
