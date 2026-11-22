// Ciclo indireto: core/contracts → core/domain → vendedor/contracts → core/contracts (só ciclo-entre-modulos pega).
import { status } from '../../vendedor/contracts';

export const regra = status;
