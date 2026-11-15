'use client';

import { Badge, EstadoVazio, formatDateTime, Panel, rotuloComContagem, TabelaDados, type ColunaDaTabela } from '@macuxi/ui/web';
import type { ConectorResumo } from '../../contracts';
import { resumoAtualizacao, ROTULO_ENTIDADE, ROTULO_SAUDE, ROTULO_SITUACAO_VERSAO, TOM_SAUDE, TOM_SITUACAO_VERSAO, tempoDesde } from '../lib/apresentacao';

/** Nome do Conector com o id e o que ele faz (no `title`, para não ocupar a linha). */
function sobreOConector(c: ConectorResumo): string {
  return [c.nome, c.conector_id, c.recebe_pedidos ? 'recebe pedidos' : null, c.aceita_cancelamento ? 'aceita cancelamento' : null].filter(Boolean).join(' · ');
}

function textoDaChave(c: ConectorResumo, tz: string): string {
  if (!c.chave) return 'sem chave';
  const anterior = c.chave.anterior_prefixo && c.chave.anterior_valida_ate ? ` · anterior vale até ${formatDateTime(c.chave.anterior_valida_ate, tz)}` : '';
  return `${c.chave.prefixo}…${anterior}`;
}

/**
 * Colunas (revisão do BKO §P2): uma coluna por assunto, cada uma com o seu selo (sinal de vida, versão, atualização automática);
 * o detalhe (último sinal exato, mensagem da atualização, chave anterior) fica no `title` da célula.
 */
function colunas(agora: Date, tz: string): ReadonlyArray<ColunaDaTabela<ConectorResumo>> {
  return [
    {
      id: 'conector',
      titulo: 'Conector',
      texto: sobreOConector,
      celula: (c) => <span className="font-semibold">{c.nome}</span>,
    },
    { id: 'sinal', titulo: 'Sinal de vida', largura: '150px', celula: (c) => <Badge tone={TOM_SAUDE[c.saude]}>{ROTULO_SAUDE[c.saude]}</Badge> },
    {
      id: 'ultimo-sinal',
      titulo: 'Último sinal',
      prioridade: 2,
      largura: '112px',
      celula: (c) => tempoDesde(c.ultimo_sinal_em, agora),
      texto: (c) => (c.ultimo_sinal_em ? formatDateTime(c.ultimo_sinal_em, tz) : ''),
    },
    {
      id: 'versao',
      titulo: 'Versão',
      prioridade: 2,
      largura: '200px',
      texto: (c) => `${c.versao_conector ?? '—'} · ${ROTULO_SITUACAO_VERSAO[c.situacao_versao]}`,
      celula: (c) => (
        <>
          <span className="mr-1.5 font-mono">{c.versao_conector ?? '—'}</span>
          <Badge tone={TOM_SITUACAO_VERSAO[c.situacao_versao]}>{ROTULO_SITUACAO_VERSAO[c.situacao_versao]}</Badge>
        </>
      ),
    },
    {
      id: 'atualizacao',
      titulo: 'Atualização automática',
      prioridade: 3,
      largura: '176px',
      texto: (c) => {
        const r = resumoAtualizacao(c.atualizacao);
        return c.atualizacao ? `${r.detalhe} ${formatDateTime(c.atualizacao.em, tz)}` : r.detalhe;
      },
      celula: (c) => {
        const r = resumoAtualizacao(c.atualizacao);
        return (
          <span data-testid={`integracao.conector.atualizacao.${c.conector_id}`}>
            <Badge tone={r.tom}>{r.rotulo}</Badge>
          </span>
        );
      },
    },
    {
      id: 'entidades',
      titulo: 'Entidades',
      prioridade: 3,
      celula: (c) => c.entidades.map((e) => ROTULO_ENTIDADE[e]).join(', '),
      texto: (c) => c.entidades.map((e) => ROTULO_ENTIDADE[e]).join(', '),
    },
    { id: 'chave', titulo: 'Chave', prioridade: 3, largura: '120px', celula: (c) => <span className="font-mono text-[12px]">{c.chave ? `${c.chave.prefixo}…` : 'sem chave'}</span>, texto: (c) => textoDaChave(c, tz) },
  ];
}

/**
 * Conectores do tenant (RF-INT-04): sinal de vida (saúde calculada na API por `avaliarSaudeConector`), versão contra a política
 * do tenant, última atualização automática (T-0116), entidades e chave de API (só o prefixo; a chave em claro nunca volta).
 */
export function ConectoresPanel({ conectores, agora, tz }: { conectores: readonly ConectorResumo[]; agora: Date; tz: string }) {
  return (
    <Panel label="Conectores" title={rotuloComContagem('Conectores', conectores.length)}>
      <TabelaDados
        colunas={colunas(agora, tz)}
        linhas={conectores}
        chave={(c) => c.id}
        rotulo="Conectores"
        testId="integracao.conectores"
        linhaTestId={(c) => `integracao.conector.${c.conector_id}`}
        esmaecida={(c) => !c.ativo}
        vazio={<EstadoVazio titulo="Nenhum Conector cadastrado." testId="integracao.conectores.vazio" />}
      />
    </Panel>
  );
}
