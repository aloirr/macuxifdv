/**
 * Visão da tela "Aparelhos" do BKO (RN-CORE-15): funções puras sobre `GET /v1/core/dispositivos`. Sem React e sem rede.
 */
import type { DispositivoItem } from '../../contracts';

const BOM = String.fromCharCode(0xfeff); // marca de ordem de bytes: o Excel abre o CSV em UTF-8
const aspas = (v: string) => `"${v.replace(/"/g, '""')}"`;

/** Data/hora curta no fuso informado (o tenant); sem data = "Nunca". */
export function quandoEmPortugues(iso: string | null, fuso: string): string {
  if (!iso) return 'Nunca';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

export function textoDoBloqueio(d: Pick<DispositivoItem, 'bloqueado_em'>): 'Bloqueado' | 'Liberado' {
  return d.bloqueado_em ? 'Bloqueado' : 'Liberado';
}

/** CSV com ponto e vírgula (Excel pt-BR): aparelho, usuário, plataforma, último acesso, situação. */
export function csvDeAparelhos(itens: readonly DispositivoItem[], fuso: string): string {
  const cab = ['Aparelho', 'Usuário', 'Plataforma', 'Último acesso', 'Situação', 'Bloqueado em'];
  const linhas = itens.map((d) =>
    [d.nome ?? d.id, d.usuario_nome, d.plataforma ?? '', quandoEmPortugues(d.ultimo_acesso_em, fuso), textoDoBloqueio(d), d.bloqueado_em ? quandoEmPortugues(d.bloqueado_em, fuso) : ''].map(aspas).join(';'),
  );
  return BOM + `${[cab.map(aspas).join(';'), ...linhas].join('\r\n')}\r\n`;
}
