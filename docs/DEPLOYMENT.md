# Deployment (Choreo)

This repo hosts two independently-deployable components in one GitHub repo:
`backend/` (FastAPI REST API) and `frontend/` (React web app). Each is deployed
as its own Choreo component pointing at a subdirectory of this repo.

> Choreo's console UI and exact config schema evolve over time — treat the
> steps below as a starting checklist and confirm field names against the
> current [Choreo docs](https://wso2.com/choreo/docs/) when you set this up,
> rather than assuming this file is byte-for-byte current.

## 1. Database

Provision a managed PostgreSQL instance (Choreo's own managed database
offering, or an external provider like Neon/Supabase/RDS). Note the
connection string — you'll set it as `DATABASE_URL` on the backend component.

## 2. Backend component

1. In the Choreo Console, create a new component from this GitHub repo.
2. Set the component's **directory** to `backend`.
3. Buildpack: use the provided `backend/Dockerfile` (Docker-based build) —
   this avoids relying on Choreo's Python buildpack correctly detecting `uv`.
4. Component type: REST API / Service. Choreo reads `backend/.choreo/endpoints.yaml`
   to expose the API on `/api` at port `8002`.
5. Set environment variables on the component (mirrors `backend/.env.example`):
   - `DATABASE_URL` — the managed Postgres connection string from step 1
   - `OPENAI_API_KEY` — your OpenAI API key
   - `OPENAI_MODEL` — e.g. `gpt-4o-mini`
   - `ALLOWED_ORIGINS` — the deployed frontend URL (see step 3)
   - `API_PREFIX` — `/api`
   - `DEBUG` — `False`
6. Deploy. Confirm `https://<backend-url>/docs` loads.

## 3. Frontend component

1. Create a second component from the same repo, directory `frontend`.
2. Buildpack: use the provided `frontend/Dockerfile`, or Choreo's Node/React
   buildpack if preferred (build command `npm run build`, output `dist/`).
3. Set environment variable:
   - `VITE_API_URL` — the deployed backend's `/api` URL from step 2
     (e.g. `https://<backend-url>/api`)
4. Deploy. Once live, go back to the backend component and update
   `ALLOWED_ORIGINS` to this frontend's URL, then redeploy the backend so CORS
   allows it.

## 4. Verify

- Open the frontend URL, start an interview, confirm a question is generated,
  submit an answer, confirm feedback comes back, and check `/history`.
- If the loader shows an error immediately, check the backend logs — it's
  almost always a missing/incorrect `DATABASE_URL` or `OPENAI_API_KEY`.
