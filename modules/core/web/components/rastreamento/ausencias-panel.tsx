'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Button, ErrorBlock, LoadingBlock, Notice } from '@macuxi/ui/web';
import type { AusenciaUsuario } from '../../../contracts';
import { CLASSE_CAMPO_BKO } from '../../lib/classes';
import { dataCivilBr } from '../../lib/rastreamento';
import { useSellersDeCampo } from '../../lib/queries';
import { CHAVE_AUSENCIAS, criarApiRastreamento, type ApiRastreamento } from './api';

const P = 'rastreamento.ausencias';
const DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parâmetros › Ausências (RN-CORE-13): férias, folga ou afastamento de usuário do escopo, sem motivo; nesses dias nada é rastreado. Quem tem
 * `ausencia.cadastrar` (supervisor, gerente, admin) vê só a equipe dele (a API recorta). testIDs: `rastreamento.ausencias.usuario|de|ate|cadastrar|aviso`
 * · `.linha.<id>` · `.cancelar.<id>`.
 */
export function AusenciasPanel({ cliente }: { cliente?: ApiRastreamento }) {
  const apiR = useMemo(() => cliente ?? criarApiRastreamento(), [cliente]);
  const qc = useQueryClient();
  const equipe = useSellersDeCampo();
  const q = useQuery({ queryKey: CHAVE_AUSENCIAS, queryFn: () => apiR.ausencias() });
  const [usuario, setUsuario] = useState('');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [aviso, setAviso] = useState<{ tom: 'success' | 'danger'; texto: string } | null>(null);
  const nomes = useMemo(() => new Map((equipe.data ?? []).map((s) => [s.id, s.name])), [equipe.data]);
  const invalidar = () => qc.invalidateQueries({ queryKey: CHAVE_AUSENCIAS });
  const cadastrar = useMutation({
    mutationFn: apiR.cadastrarAusencia,
    onSuccess: async () => {
      setDe('');
      setAte('');
      setAviso({ tom: 'success', texto: 'Ausência cadastrada.' });
      await invalidar();
    },
    onError: (e) => setAviso({ tom: 'danger', texto: errorMessage(e) }),
  });
  const cancelar = useMutation({
    mutationFn: apiR.cancelarAusencia,
    onSuccess: async () => {
      setAviso({ tom: 'success', texto: 'Ausência cancelada.' });
      await invalidar();
    },
    onError: (e) => setAviso({ tom: 'danger', texto: errorMessage(e) }),
  });
  const pronto = usuario !== '' && DATA.test(de) && DATA.test(ate);
  const enviar = () => {
    if (de > ate) return setAviso({ tom: 'danger', texto: 'A data final vem no mesmo dia ou depois da inicial.' });
    cadastrar.mutate({ usuario_id: usuario, de, ate });
  };

  return (
    <div className="flex flex-col gap-4" data-testid={`${P}.painel`}>
      {q.isError && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}
      {aviso && (
        <Notice tone={aviso.tom} onClose={() => setAviso(null)}>
          <span data-testid={`${P}.aviso`}>{aviso.texto}</span>
        </Notice>
      )}
      <div className="flex flex-wrap items-end gap-4 text-[15px]">
        <label className="flex flex-col gap-1 font-semibold text-ink">
          Usuário
          <select value={usuario} onChange={(e) => setUsuario(e.target.value)} className={`${CLASSE_CAMPO_BKO} min-w-[220px]`} data-testid={`${P}.usuario`}>
            <option value="">Escolha o usuário</option>
            {(equipe.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 font-semibold text-ink">
          De
          <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className={CLASSE_CAMPO_BKO} data-testid={`${P}.de`} />
        </label>
        <label className="flex flex-col gap-1 font-semibold text-ink">
          Até
          <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className={CLASSE_CAMPO_BKO} data-testid={`${P}.ate`} />
        </label>
        <Button variant="primary" onClick={enviar} disabled={!pronto || cadastrar.isPending} data-testid={`${P}.cadastrar`}>
          {cadastrar.isPending ? 'Cadastrando…' : 'Cadastrar ausência'}
        </Button>
      </div>
      {q.isPending && <LoadingBlock label="Carregando as ausências…" />}
      {q.data && q.data.length > 0 && (
        <table className="w-full border-collapse text-left text-[15px]" data-testid={`${P}.lista`}>
          <caption className="sr-only">Ausências cadastradas</caption>
          <thead>
            <tr className="text-[12px] font-semibold text-ink-2">
              <th scope="col" className="py-2">Usuário</th>
              <th scope="col">De</th>
              <th scope="col">Até</th>
              <th scope="col"><span className="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {q.data.map((a: AusenciaUsuario) => (
              <tr key={a.id} className="border-t border-line" data-testid={`${P}.linha.${a.id}`}>
                <td className="py-2">{nomes.get(a.usuario_id) ?? 'Usuário'}</td>
                <td>{dataCivilBr(a.de)}</td>
                <td>{dataCivilBr(a.ate)}</td>
                <td className="text-right">
                  <Button size="sm" onClick={() => cancelar.mutate(a.id)} disabled={cancelar.isPending} data-testid={`${P}.cancelar.${a.id}`}>
                    Cancelar
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
