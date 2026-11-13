// React ships no types and @types/react is not a dependency (SPEC-DRAWINGS 1.1: nothing else is
// added), so the two modules `mount.ts` imports are declared here; their values are `any`.
declare module "react";
declare module "react-dom/client";
