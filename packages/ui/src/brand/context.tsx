import { createContext, useContext, type ComponentType, type ReactNode } from "react";

type WordmarkComponent = ComponentType<{ className?: string }>;

const BrandSlot = createContext<WordmarkComponent | null>(null);

/**
 * Lets a subtree render a different wordmark wherever `<Wordmark />` is used — for
 * previewing identity options. Nothing in the apps needs it; without a provider the
 * shipped wordmark renders.
 */
export function BrandProvider({ wordmark, children }: { wordmark: WordmarkComponent; children: ReactNode }) {
  return <BrandSlot.Provider value={wordmark}>{children}</BrandSlot.Provider>;
}

export function useWordmarkOverride(): WordmarkComponent | null {
  return useContext(BrandSlot);
}
