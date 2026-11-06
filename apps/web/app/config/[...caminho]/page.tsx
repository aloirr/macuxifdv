import { notFound } from 'next/navigation';

/**
 * Caminho que o portal ainda não tem (T-0086): 404. Sem esta rota, `/config/<x>` (o `config.` reescreve `/<x>` para cá)
 * cairia no coringa do BKO (`app/(bko)/[...caminho]`) e abriria o shell do backoffice. As telas chegam na T-0087.
 */
export default function PortalCaminhoInexistente() {
  notFound();
}
