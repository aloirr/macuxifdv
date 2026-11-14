// Stub do expo-router para o print (sem navegação real).
export const router = { push() {}, replace() {}, back() {}, canGoBack: () => false, navigate() {}, dismissTo() {} };
export const useLocalSearchParams = () => (globalThis as { __params?: Record<string, string> }).__params ?? {};
export const useRouter = () => router;
export const usePathname = () => '/';
export const useFocusEffect = () => {};
export const Link = () => null;
