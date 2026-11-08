# n8n — AI-assisted scientific review (read-only)

This is a quick reference for running the local n8n stack. The full description covers the
workflow design, evidence pack, AI instructions, output checks and the verified case study:
**[docs/AI_N8N_INTEGRATION.md](../../docs/AI_N8N_INTEGRATION.md)**.

Python (LUNA-P/OPS) remains the scientific computation authority. This workflow only sends `GET`
requests for stored records. Its AI Agent has no tools, and its recommendations are never
executed.

```bash
make up        # LUNA-P/OPS dev stack (API on host port 8000); rebuilds the API image
make n8n-up    # n8n on http://localhost:5678 (bound to 127.0.0.1 only)
```

| Item | Value |
| --- | --- |
| Compose file | `docker-compose.n8n.yml` (Compose project `luna-ops-n8n`) |
| Image | `n8nio/n8n:2.38.7` |
| Persistent data | Docker volume `luna-ops-n8n-data` (workflows, executions, encrypted credentials) |
| API from n8n | `http://host.docker.internal:8000`, set in the workflow's **Config** node |
| Workflow file | `workflows/luna-ops-scientific-review.json` (id `LunaOpsSciRev001`) |

## First-time setup

1. Open http://localhost:5678 and create the local n8n owner account.
2. If the workflow is missing, run `make n8n-import`.
3. In **OpenRouter Chat Model**, create the OpenRouter credential (paste your key in the UI) and
   pick a model. Leave *Maximum Number of Tokens* unset.
4. **Execute workflow**.

`make n8n-import` replaces the n8n copy of the workflow (same id), including any UI edits. You'll
need to re-select the credential and model afterwards.

```bash
make n8n-down                       # stop; data stays in the volume
docker volume rm luna-ops-n8n-data  # irreversible: deletes the owner account, credentials and executions
```
