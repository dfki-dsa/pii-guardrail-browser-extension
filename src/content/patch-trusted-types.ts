if (typeof window !== 'undefined' && (window as any).trustedTypes) {
  const tt = (window as any).trustedTypes;
  const originalCreate = tt.createPolicy.bind(tt);
  tt.createPolicy = function(name: string, rules: any) {
    try {
      return originalCreate(name, rules);
    } catch (e) {
      console.warn(`[PG:content] Intercepted TrustedType policy creation error for '${name}'. Returning dummy policy.`, e);
      return {
        createHTML: (s: string) => s,
        createScript: (s: string) => s,
        createScriptURL: (s: string) => s
      };
    }
  };
}
