/**
 * Estado do repositório quando um PR de outro dono ainda não entrou no main: cada teste afetado vale nos DOIS estados e
 * decide pelo fonte. Uma detecção, um lugar: os testes importam daqui em vez de repetir a regra.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = join(__dirname, '..', '..', '..');
const existe = (rel: string) => existsSync(join(RAIZ, rel));

/** PR do modulo-vendedor (R-20261114-151000, Catálogo só para consulta): a extensão do Catálogo é "Adicionar ao orçamento". */
export const SO_ORCAMENTO = /id: 'adicionar-ao-orcamento'/.test(readFileSync(join(RAIZ, 'modules/vendedor/app/index.ts'), 'utf8'));

/** PR #243 (ADR 0048): o passo Empresa do portal confere o CNPJ na Receita (falsa nos testes, sem rede). */
export const COM_RECEITA = existe('apps/api/src/consulta-cnpj.ts');

/**
 * PR #258 (modulo-core, R-20261114-150000/150500): a folha do check-in só abre a ficha (`checkin-abrir-ficha`), o Check-in volta ao
 * rodapé da ficha (RN-CORE-51) e o check-in fora da rota do dia depende de `visita.checkin_fora_de_rota` (RN-CORE-52).
 */
export const CHECKIN_NA_FICHA = existe('modules/core/domain/checkin-rota.ts');

/** 0069 (banco-dados, R-20261114-153500): um perfil por usuário (exclusão adiada `usuario_perfil_um_vivo`). */
export const UM_PERFIL = existe('db/migrations/0069_core_cargo_hierarquia.up.sql');
