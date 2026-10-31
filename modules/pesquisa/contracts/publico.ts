/**
 * Público-alvo, vigência, frequência e modo da pesquisa (RF-PES-02, RF-PES-03, RN-PES-02).
 * Critério vazio = sem restrição; critérios de usuário (perfis, equipes) e de cliente (segmentos,
 * regiões, lista) valem juntos (E). Ver docs/modulos/pesquisa/regras.md §4.
 */
import { z } from 'zod';
import { InstanteUtc, PerfilQueResponde, TextoCurto, Uuid } from './base';

export const PublicoAlvo = z
  .object({
    perfis: z.array(PerfilQueResponde).default([]),
    /** Ids de equipe; vale a equipe do usuário e as acima dela na árvore (o Core informa a lista). */
    equipes: z.array(Uuid).default([]),
    segmentos: z.array(TextoCurto).default([]),
    regioes: z.array(TextoCurto).default([]),
    /** Lista explícita de clientes: entram além dos que casam por segmento/região (sem canal até o Core ter o campo: RN-PES-05). */
    clientes: z.array(Uuid).default([]),
  })
  .strict();
export type PublicoAlvo = z.infer<typeof PublicoAlvo>;

export const FREQUENCIAS = ['uma_vez_por_cliente', 'a_cada_visita', 'semanal', 'mensal'] as const;
export const Frequencia = z.enum(FREQUENCIAS);
export type Frequencia = z.infer<typeof Frequencia>;

/** RF-PES-03: avulsa (aba "Pesquisas") ou etapa obrigatória do checkout da visita. */
export const MODOS = ['avulsa', 'checkout_obrigatoria'] as const;
export const ModoPesquisa = z.enum(MODOS);
export type ModoPesquisa = z.infer<typeof ModoPesquisa>;

/** Início e fim em UTC; fim `null` = sem prazo. Ambos inclusivos. */
export const Vigencia = z
  .object({ inicio: InstanteUtc, fim: InstanteUtc.nullable().default(null) })
  .strict()
  .refine((v) => v.fim === null || Date.parse(v.fim) >= Date.parse(v.inicio), { path: ['fim'], message: 'O fim da vigência não pode ser anterior ao início.' });
export type Vigencia = z.infer<typeof Vigencia>;
