'use client';

import { Badge, formatDateTime, Panel, TableScroll, td, th } from '@macuxi/ui/web';
import type { ConectorResumo } from '../../contracts';
import { ROTULO_ENTIDADE, ROTULO_SAUDE, ROTULO_SITUACAO_VERSAO, TOM_SAUDE, TOM_SITUACAO_VERSAO, tempoDesde } from '../lib/apresentacao';

/**
 * Conectores do tenant (RF-INT-04): sinal de vida (saúde calculada na API por `avaliarSaudeConector`), versão contra a política
 * do tenant, entidades e chave de API (só o prefixo; a chave em claro nunca volta).
 */
export function ConectoresPanel({ conectores, agora, tz }: { conectores: readonly ConectorResumo[]; agora: Date; tz: string }) {
  return (
    <Panel label="Conectores" title={<>Conectores <span className="font-sans text-[13px] font-normal text-ink-2">· {conectores.length}</span></>}>
      {conectores.length === 0 ? (
        <span className="text-[13px] text-ink-2" data-testid="integracao.conectores.vazio">
          Nenhum Conector cadastrado. Peça ao administrador para cadastrar o Conector da empresa e instalar o serviço no servidor do ERP.
        </span>
      ) : (
        <TableScroll minWidth={820}>
          <thead>
            <tr>
              <th scope="col" className={th}>Conector</th>
              <th scope="col" className={th}>Sinal de vida</th>
              <th scope="col" className={th}>Último sinal</th>
              <th scope="col" className={th}>Versão</th>
              <th scope="col" className={th}>Entidades</th>
              <th scope="col" className={th}>Chave</th>
            </tr>
          </thead>
          <tbody data-testid="integracao.conectores">
            {conectores.map((c) => (
              <tr key={c.id} data-testid={`integracao.conector.${c.conector_id}`}>
                <td className={td}>
                  <div className="font-semibold">{c.nome}</div>
                  <div className="font-mono text-[12px] text-ink-2">
                    {c.conector_id}
                    {c.recebe_pedidos ? ' · recebe pedidos' : ''}
                    {c.aceita_cancelamento ? ' · aceita cancelamento' : ''}
                  </div>
                </td>
                <td className={td}>
                  <Badge tone={TOM_SAUDE[c.saude]}>{ROTULO_SAUDE[c.saude]}</Badge>
                </td>
                <td className={`${td} whitespace-nowrap`} title={c.ultimo_sinal_em ? formatDateTime(c.ultimo_sinal_em, tz) : undefined}>
                  {tempoDesde(c.ultimo_sinal_em, agora)}
                </td>
                <td className={`${td} whitespace-nowrap`}>
                  <span className="mr-1.5 font-mono">{c.versao_conector ?? '—'}</span>
                  <Badge tone={TOM_SITUACAO_VERSAO[c.situacao_versao]}>{ROTULO_SITUACAO_VERSAO[c.situacao_versao]}</Badge>
                </td>
                <td className={`${td} text-[12px] text-ink-2`}>{c.entidades.map((e) => ROTULO_ENTIDADE[e]).join(', ')}</td>
                <td className={`${td} whitespace-nowrap text-[12px]`}>
                  {c.chave ? (
                    <>
                      <span className="font-mono">{c.chave.prefixo}…</span>
                      {c.chave.anterior_prefixo && c.chave.anterior_valida_ate && (
                        <div className="text-ink-2">anterior vale até {formatDateTime(c.chave.anterior_valida_ate, tz)}</div>
                      )}
                    </>
                  ) : (
                    <span className="text-ink-2">sem chave</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      )}
    </Panel>
  );
}
