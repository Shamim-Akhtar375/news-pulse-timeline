# Workspace Customization Rules

## Development and Deployment Constraints

### 1. TypeScript and Vite Imports
- Always check if `"verbatimModuleSyntax": true` is set in the project's `tsconfig.json`.
- If enabled, strictly use `import type { ... }` or `import { type ... }` for importing interfaces, types, or type-only files. Do not import type-only symbols inside standard value imports, as this causes runtime browser crashes in Vite deployments.

### 2. Render Blueprint Specification (render.yaml)
- For static sites, set `type: web` and `runtime: static` (not `type: static` or `env: static`).
- Specify the static build output folder using the `staticPublishPath` property (not `publishDir`).
- For Docker web services, use `runtime: docker` (not `env: docker`), and use the case-sensitive `dockerfilePath` property (lowercase `f`, uppercase `P`).

### 3. SQLite Database Initialization
- When deploying an app using SQLite where the `.db` file is ignored by Git, ensure the server code or start command includes an auto-initialization phase to create the database file and run schema migrations/ORM `create_all()` calls at startup before listening to requests. This prevents database 500 error crashes on first run.
