# Customer React App Sentry Verification

Use this checklist to verify the `@sentry/react` integration in production.

## 1. Initialization and Error Boundaries
- [ ] **Error Boundary Fallback:** Trigger a render error in a deep component (e.g., throwing a new Error inside a `useEffect` on the Menu screen). Verify that the custom "Something went wrong" UI appears instead of a blank white screen.
- [ ] **Sentry Dashboard:** Verify that the aforementioned render error appears in the `orderlli-customer` Sentry project.

## 2. Source Maps
- [ ] **Un-minified Stack Traces:** Inspect the reported error in Sentry. Ensure the stack trace shows your actual React component names (e.g., `MenuSplash.jsx`) and original source code, rather than minified output from the Vite bundler.

## 3. Router Instrumentation
- [ ] **Performance Traces:** Open the Sentry Performance tab. Ensure you see navigation transactions representing your React Router routes (e.g., navigations to `/menu/item/:id`), rather than raw URLs.
- [ ] **Sample Rate Verification:** Ensure tracing is sparse in production (around 10%) but captures 100% of navigations during local development.

## 4. Privacy and Opt-Outs
- [ ] **Session Replay:** Verify Session Replay is fully disabled (no replays appear in Sentry).
- [ ] **Profiling:** Verify Profiling is fully disabled.
