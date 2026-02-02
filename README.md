# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Phase 13 Data Integrity (Donations)

Read-only validation:
```bash
node scripts/phase13_validate.js --projectId YOUR_PROJECT_ID
```

Optional report file:
```bash
node scripts/phase13_validate.js --projectId YOUR_PROJECT_ID --writeReport
```

Safe fixer (dry run by default):
```bash
node scripts/phase13_fix.js --projectId YOUR_PROJECT_ID
```

Apply fixes:
```bash
node scripts/phase13_fix.js --projectId YOUR_PROJECT_ID --apply
```

Optional legacy conversion (amounts likely in dollars):
```bash
node scripts/phase13_fix.js --projectId YOUR_PROJECT_ID --apply --convertLikelyDollars
```
