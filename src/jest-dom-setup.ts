// This file exists mostly for its NAME. @solidjs/vite-plugin auto-injects
// setupFiles: ['@testing-library/jest-dom/vitest'] in test mode unless an existing setupFiles
// entry matches /jest-dom/. That injected BARE specifier is resolved without an importer, and
// when this repro is cloned inside another repo that also has @testing-library/jest-dom
// installed (any pnpm monorepo, for instance), it can resolve to the OUTER repo's copy and fail.
// Importing it here instead gives the resolver a real importer inside this project.
import '@testing-library/jest-dom/vitest';
