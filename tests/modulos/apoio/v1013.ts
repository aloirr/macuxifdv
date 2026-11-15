/**
 * v1.0.13 (meta do dono do produto, 15/11/2026): os testes de aceite valem nos DOIS estados do main. Antes do PR de cada item,
 * o teste afirma que a peça ainda não está lá; depois, confere o critério. O código do item entra por import dinâmico (o caminho
 * não existe no main de antes do PR, e o typecheck não pode depender dele): cada teste declara só a forma que usa.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const RAIZ = join(__dirname, '..', '..', '..');
export const existe = (rel: string): boolean => existsSync(join(RAIZ, rel));
export const ler = (rel: string): string => readFileSync(join(RAIZ, rel), 'utf8');

/** Import de um arquivo do repositório que pode ainda não estar no main; `T` é a forma que o teste usa. */
export async function importar<T>(rel: string): Promise<T> {
  return (await import(/* @vite-ignore */ join(RAIZ, rel))) as T;
}
