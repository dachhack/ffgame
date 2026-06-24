# `dispatch-sim` edge function

Lets an **admin** launch the real server-driven live-feed sim from the admin page
(the `▶ play live` button), instead of opening the GitHub Actions UI. It verifies
the caller is an admin (`is_admin()` against their JWT), then fires a
`workflow_dispatch` at `.github/workflows/simulate.yml`.

## One-time deploy

Needs the [Supabase CLI](https://supabase.com/docs/guides/cli) and a fine-grained
GitHub PAT with **Actions: Read and write** on `dachhack/ffgame`.

```bash
# from the repo root, linked to the project (supabase link --project-ref <ref>)
supabase functions deploy dispatch-sim

# secrets the function reads (SUPABASE_* are injected automatically):
supabase secrets set \
  GH_TOKEN=github_pat_xxx \
  GH_REPO=dachhack/ffgame \
  GH_REF=main \
  GH_WORKFLOW=simulate.yml
```

### `GH_REF` — which branch the Action runs on

`workflow_dispatch` resolves the workflow **by file name on the default branch**,
then checks out the `ref` you pass. So `simulate.yml` must exist on the repo's
default branch, and `GH_REF` should point at a branch that has the **current
server code**.

- After PR #1 merges → set `GH_REF=main` (simplest; main is current).
- Before that → set `GH_REF=claude/youthful-albattani-s9kprl` (the deploy branch),
  and make sure `simulate.yml` is also present on the default branch so the
  dispatch endpoint can find it.

## What the button sends

```jsonc
{ "mode": "live", "league": "<league uuid>", "week": "1", "src": "1", "speed": "300" }
```

`mode` can also be `reset` (revert a sim'd week) — wired to the admin "↺ reset
all" companion if desired. The function rejects anything but an admin JWT.

## Test from the CLI

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/dispatch-sim" \
  -H "Authorization: Bearer <an admin user access token>" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"live","league":"<id>","week":1,"src":1,"speed":300}'
# → {"ok":true,"mode":"live","ref":"main","repo":"dachhack/ffgame"}
```
