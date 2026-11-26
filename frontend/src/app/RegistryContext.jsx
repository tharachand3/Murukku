import { createContext, useContext } from 'react';

let defaultRegistry = null;
const RegistryContext = createContext(null);

export function setDefaultRegistry(registry) {
  defaultRegistry = registry;
}

export function RegistryProvider({ children, value = defaultRegistry }) {
  return (
    <RegistryContext.Provider value={value}>
      {children}
    </RegistryContext.Provider>
  );
}

export function useRegistry() {
  const context = useContext(RegistryContext);
  if (!context && !defaultRegistry) {
    throw new Error('No route registry is available');
  }
  return context ?? defaultRegistry;
}
