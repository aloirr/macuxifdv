/**
 * Quem aprova crédito e quem aprova inadimplência (BKO › Parâmetros › Pedidos, prancha 01; T-0184, P2 B). Padrão Gerente (P5 B),
 * também quando o servidor ainda não devolve os campos. O limite de crédito não aparece: vem do ERP (RN-VEN-12).
 */
import type { DiscountPolicy, NivelAprovacao, PutAprovadoresRequest } from '../../contracts';

export interface FormAprovadores {
  credito: NivelAprovacao;
  inadimplencia: NivelAprovacao;
}

export const ROTULO_NIVEL: Record<NivelAprovacao, string> = { supervisor: 'Supervisor', gerente: 'Gerente', analista: 'Analista comercial' };

export const formDosAprovadores = (p: Omit<DiscountPolicy, 'exceptions'> & { exceptions?: unknown }): FormAprovadores => ({
  credito: p.aprovador_credito ?? 'gerente',
  inadimplencia: p.aprovador_inadimplencia ?? 'gerente',
});

export const corpoDosAprovadores = (f: FormAprovadores): PutAprovadoresRequest => ({ aprovador_credito: f.credito, aprovador_inadimplencia: f.inadimplencia });

export const houveMudanca = (a: FormAprovadores, b: FormAprovadores): boolean => a.credito !== b.credito || a.inadimplencia !== b.inadimplencia;
