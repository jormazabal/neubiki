# AGENTS.md

## Product Objective

Neubiki is an independent Windows and Android Tauri application for working with files stored in Proton Drive. Preserve all inherited user-facing functionality, including the full Markdown editor, contextual AI, translation, and image generation. Adapt these capabilities to Proton Drive and verify them on each platform as they are integrated. See [the Neubiki product design](docs/product/neubiki.md) for the agreed storage, connectivity, recovery, and platform scope.

## Mandatory Stack

- Native application: Tauri v2.
- Frontend: React + TypeScript.
- Styles: Tailwind CSS.
- Visual Markdown editor: Milkdown.
- Local runtime: Rust/Tauri commands.
- Persistence target: Proton Drive for project files and shared state. Local files support temporary processing, recovery, settings, and protected sessions.
- Versioning target: Proton Drive file revisions mediated by Rust services.
- AI: Rust/Tauri mediated provider integration; React never calls AI providers directly.

## Architecture Rules

- Keep a clear separation between UI, services, models, and runtime integration.
- Components render state and dispatch intent; they must not own filesystem, Git, AI, or persistence business logic.
- Frontend API access belongs under `apps/desktop/src/lib/api`.
- Shared product types belong under `apps/desktop/src/types`.
- Rust command registration belongs under `apps/desktop/src-tauri/src`.
- Rust business rules belong in crates under `apps/desktop/src-tauri/crates`.
- Tauri commands must stay thin and call Rust services.
- Do not introduce unrelated frameworks or state managers without a concrete product need.

## Rust Runtime Rules

- The product has no external product service, HTTP runtime server, packaged auxiliary process, or compatibility runtime option.
- Windows and Android run the native Rust runtime on device and access project files online through the Proton SDK.
- Runtime commands must return structured JSON with predictable IDs and timestamps.
- Use test doubles only for development and tests.
- Do not block the UI thread with filesystem, Git, document conversion, or AI work.

## Frontend Rules

- Use React components organized by product feature.
- Use TypeScript types for projects, document tree nodes, documents, versions, and AI requests.
- Use Tailwind tokens matching the Neubiki palette.
- Use lucide-react for linear icons.
- Keep the main document as a single-column editing surface.
- Do not mix business logic into visual-only components.
- Do not call mock data directly from arbitrary components; use the API layer.

## Milkdown Rules

- Milkdown is the required visual Markdown editor.
- Do not replace Milkdown with MDXEditor, Tiptap, Lexical, Monaco, CodeMirror-only, or another editor without an explicit product decision.
- Do not show raw Markdown as the primary user experience.
- The editor must load from a Markdown string and export Markdown back to application state.
- Customize Milkdown visually with Tailwind/CSS so it feels native to Neubiki.
- Document content must remain a normal single-column document flow.

## Tauri Rules

- Use Tauri, not Electron.
- React remains the primary UI.
- Keep native command handlers minimal and delegate to Rust crates.
- Do not add auxiliary product runtime processes.
- Do not block the UI thread with filesystem, Git, document, or AI operations.

## Release And Updater Rules

- Use [release management](docs/skills/release-management-skill.md) for release changes and keep manifests aligned with VERSION.
- Keep Neubiki installation identifiers, app data, native libraries, and signing independent.
- Candidates use no updater channel. For public distribution use Neubiki's own endpoints and signatures, following [the release process](docs/development/release-process.md).

## Persistence And Versioning

- Proton Drive is the authority on project files, identity and revisions. Use the opened revision as the write base.
- Enable remote writes only when the runtime can guarantee that the base revision has not changed.
- Keep recovery drafts private and expose their status accurately. Only a confirmed remote revision is saved.
- Do not expose Git or a separate local project mode in the product.

## AI Rules

- AI interactions must be contextual to the active document.
- AI intent resolution must be structured: runtime state + LLM decision + validated deterministic execution.
- The prompt execution mode controls cost and routing: quick mode is direct and non-agentic; reasoning mode may run structured preflight and then choose direct or agentic work.
- Do not implement intent logic with user-text heuristics, regexes, language-specific phrase lists, or keyword matching.
- Do not call real AI providers directly from React components.
- All AI calls go through Rust/Tauri services.
- Initial AI behavior can be mocked, but request/response schemas should be stable.
- Do not stream or persist prompts until product and privacy rules are defined.

## Visual Design Rules

- Primary action color: `#F37021`.
- Dark orange: `#D85A12`.
- Main text: `#111827`.
- Secondary text: `#6B7280`.
- Soft border: `#E5E7EB`.
- Main background: `#FFFFFF`.
- Sidebar background: `#FAFAFA`.
- Orange hover: `#FFF1E8`.
- Do not use blue as the primary action color.
- Use a white main canvas, light left panel, subtle borders, and very soft shadows.
- Keep the UI compact and operational.
- Do not add a search input to the sidebar header.
- Do not add an external plus button next to the project selector.
- Tree item actions appear through hover/context menus, not permanent action icons.

## Quality Rules

- Keep changes scoped to the requested product surface.
- Favor simple, typed contracts over clever abstractions.
- Validate with TypeScript build, frontend tests, Rust tests, and contract tests when possible.
- Avoid unrelated refactors.
- Keep mock data realistic and centralized.

## Testing Rules

- During development, do not repeatedly run full frontend or Rust workspace suites. Run only focused checks justified by changed critical behavior, a reproduced defect, or a materially affected shared contract; reuse unaffected results.
- Group native builds and UI campaigns at meaningful product milestones, rather than rebuilding for each minor adjustment.
- Run the complete regression after the whole implementation is finished. After a fix, repeat only checks whose results the fix invalidated.
- Add tests for Rust/Tauri contracts.
- Add frontend component tests for critical interactions when expanding behavior.
- Maintain `docs/development/manual-test-checklist.md`.
- Manual acceptance must include project selector, tree menus, tab switching, Milkdown editing, save feedback, history drawer, AI input, import/export, previews, settings, Windows update, and Android connectivity loss and draft recovery.

## Documentation Rules

- Update product, architecture, and development docs when contracts or structure change.
- Document known limitations and next technical steps.
- Keep docs practical for future agents and engineers.
- For release changes, update `CHANGELOG.md`, `docs/releases/<version>.md`, `docs/development/release-process.md` when the process changes, and the manual test checklist when acceptance steps change.

## Working By Phases

1. Product shell and visual fidelity.
2. Stable frontend/Rust runtime contracts.
3. Proton Drive navigation, document reads and private recovery.
4. Verified Proton Drive revisions and remote writes.
5. Real AI integration through Tauri/Rust.
6. Tauri packaging and hardening for Windows and Android.
7. Automated frontend, Rust, and integration tests.

## Do Not Do

- Do not use Electron.
- Do not add external server runtime paths, compatibility runtime paths, or auxiliary product processes.
- Do not replace Milkdown without explicit approval.
- Do not show raw Markdown as the main editor.
- Do not introduce Git branches in the interface.
- Do not use blue as the main action color.
- Do not execute Git from React components.
- Do not mix runtime or business logic into visual components.
- Do not scatter mock data across the UI.
