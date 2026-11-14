import { CLIENTE } from './cenario';

export const router = { navigate: () => undefined, push: () => undefined, back: () => undefined, setParams: () => undefined };
export const useLocalSearchParams = () => ({ id: CLIENTE, from: 'Clientes' });
export const useRouter = () => router;
