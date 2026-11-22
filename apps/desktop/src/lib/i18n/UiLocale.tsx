import { createContext, useContext, type ReactNode } from "react";
import { uiCopy, type UiLanguage } from "./uiCopy";

const UiLocale = createContext<UiLanguage>("es");
/** Controlled by the existing persisted appearance owner; never reads document content. */
export function UiLocaleProvider({ language, children }: {language:UiLanguage;children:ReactNode}) {
  return <UiLocale.Provider value={language}>{children}</UiLocale.Provider>;
}
export function useUiLocale() { return useContext(UiLocale); }
export function useUiCopy() { return uiCopy[useUiLocale()]; }
