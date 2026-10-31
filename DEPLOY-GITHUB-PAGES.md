# Deploying to GitHub Pages

This build of the app is fully static: puzzles are bundled at build time from
`src/data/puzzles.json` (exported from the old `/api/public/puzzles` endpoint),
and there is no backend, no database and no login.

## Option A — automatic deploys (recommended)

The repository includes `.github/workflows/deploy.yml`, which builds the site and
publishes `dist/` on every push to `main`.

1. Push this project to `github.com/asiatour/unipol-logic-puzzles` (branch `main`).
2. In the repository: **Settings → Pages → Build and deployment → Source =
   GitHub Actions**.
3. Push a commit (or run the workflow manually from the **Actions** tab).
4. The site appears at `https://asiatour.github.io/unipol-logic-puzzles/`.

## Option B — upload the built files yourself

Use `unipol-logic-puzzles-site.zip` (contents of `dist/`, already built with the
correct base path):

1. Switch Pages to **Source = Deploy from a branch**.
2. Put the zip contents at the root of the `main` branch, or in a `docs/` folder
   and select that folder.
3. Save; Pages publishes within a minute or two.

## Base path

`vite.config.ts` sets `base: "/unipol-logic-puzzles/"` so assets resolve under the
project URL. If you rename the repository or add a custom domain, set the
`PAGES_BASE` environment variable at build time instead of editing the config
(`PAGES_BASE=/ npm run build` for a domain at the root).

## Notes

- The app is a single page with no client-side routes, so no `404.html` fallback
  is needed.
- "Edit" only appears when the page is inside an editor iframe, so players on
  GitHub Pages never see the designer. If someone does open it, edits live in
  that browser's localStorage only.
- PDFs are served from `public/pdfs/` and are linked relative to the base path.
- The old backend (`backend/`, EdgeSpark) is unused by this build and is not
  deployed.
