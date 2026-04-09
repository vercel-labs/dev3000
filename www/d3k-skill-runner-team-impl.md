# d3k-skill-runner Team Worker Implementation Plan

## Goal

Move skill-runner execution costs off `dev3000-www` and onto a team-owned worker project, while keeping `dev3000-www` as the control-plane UI.

The target outcome is:

- users browse and start runs from `dev3000-www`
- each team installs a Vercel integration once
- we provision a `d3k-skill-runner` worker project in that team
- workflow execution, sandbox activity, report generation, and storage happen in that team-owned worker
- `dev3000-www` polls the worker for run state and renders the same normalized report UI

## Current Rollout Status

We now have the first control-plane milestone implemented:

- a team-level skill-runner execution mode flag
- two modes: `hosted` and `self-hosted`
- an admin-only `/admin` page to edit that mode per team
- optional worker metadata fields per team:
  - worker base URL
  - worker project id
  - worker status

What this milestone does **not** do yet:

- run execution on the team-owned worker
- poll worker-owned runs from the control plane
- read worker-owned reports from `/dev-agents/runs`

Right now, `self-hosted` is a real product setting and a real UI state, but it is intentionally blocked at run start until the worker execution path exists end to end.

This is deliberate: it lets us test the product split and team-level configuration safely without pretending that team-owned execution already works.

## Non-Goals

- full multi-tenant bring-your-own-AI-provider support in v1
- self-hosted worker deployment outside Vercel
- direct PR creation in v1
- arbitrary worker customization per team

## Current State

Today:

- `dev3000-www` starts workflows itself via `start(cloudFixWorkflow, ...)`
- workflow compute is billed to `dev3000-www`
- Blob/report writes are billed to `dev3000-www`
- AI usage is also controlled by `dev3000-www`
- user/team tokens are only used for project-scoped sandbox operations

That means a run may target the user's repo and team, but the run is still hosted and billed by us.

## Proposed Architecture

Split the product into:

1. Control Plane: `dev3000-www`
2. Data Plane: per-team `d3k-skill-runner` worker project

## Implementation Phases

### Phase 1: Control-Plane Mode Flag

Ship now.

- store team-level skill-runner settings in the existing blob-backed team state
- add admin-only UI for mode switching
- show hosted vs self-hosted state in the skill-runner surface
- block self-hosted starts with an explicit message until worker execution is wired

### Phase 2: Worker Provisioning Metadata

- store integration installation id
- store worker project id and canonical worker base URL
- track worker status: `unconfigured | provisioning | ready | error`
- add verification/reconciliation checks in `/admin`

### Phase 3: Worker Start Path

- add a worker-owned start endpoint
- move workflow start onto the worker project when team mode is `self-hosted`
- keep hosted mode on `dev3000-www`

### Phase 4: Worker Run Read Path

- teach the control plane to read run status from either:
  - local hosted storage
  - team worker API/storage
- preserve one normalized report UI regardless of execution host

### Phase 5: Provisioning Automation

- create/install `d3k-skill-runner` automatically after integration install
- wire env vars and worker secrets
- verify deployment health before enabling self-hosted mode for a team

### Control Plane Responsibilities

- auth and team selection
- `/skill-runner` catalog UI
- skill search/import
- team settings and installation status
- start-run requests
- run list and report rendering
- polling the worker for run state

### Worker Responsibilities

- host the durable workflow
- create and manage sandboxes
- install `d3k` and skill packages
- run observation and verification
- generate report payloads
- write artifacts and run state to worker-owned storage
- expose run status APIs back to the control plane

## Required Product Primitive

We need a Vercel integration, e.g. `d3k-skill-runner`.

The integration is the authorization boundary that lets us:

- install into a team explicitly
- receive team-scoped credentials
- create/manage a project in that team programmatically
- keep operating on behalf of that team without asking for PATs

Without the integration install step, we cannot safely or cleanly create a worker project in the customer's team.

## Provisioning Flow

### 1. Install Integration

From `dev3000-www`, the user clicks `Install d3k Skill Runner`.

The install flow should:

- target a specific Vercel team
- request the minimum project-level permissions needed
- return the installation/team context to `dev3000-www`

Persist per team:

- integration installation id
- team id
- team slug
- install status
- last verified at

### 2. Provision Worker Project

After installation completes:

- create project `d3k-skill-runner` in the installed team if it does not already exist
- store the created `projectId`, project name, and canonical worker URL in team config

Project conventions:

- name: `d3k-skill-runner`
- framework: Next.js or minimal worker shell matching the current workflow runtime needs
- repo source: dedicated worker repo or subdir deployment target owned by us
- env vars: injected automatically during provisioning

### 3. Configure Worker

Provision these inputs into the worker project:

- control-plane callback origin
- worker auth secret shared with `dev3000-www`
- Blob/report storage config for that team-owned project
- AI provider config for the worker
- any workflow-required Vercel environment variables

### 4. First Deployment

After the project is created and configured:

- trigger an initial deployment
- wait until the deployment is `Ready`
- mark the team worker status as `ready`

### 5. Ongoing Reconciliation

Whenever the user visits `/skill-runner`:

- verify the installation still exists
- verify the worker project still exists
- verify the last deployment is healthy
- surface repair actions if something drifted

## Worker API Surface

The worker should expose a narrow authenticated API for the control plane.

### `POST /api/skill-runner/start`

Starts a run on the team-owned worker.

Input:

- runner id
- canonical skill path
- upstream skill hash
- selected target `projectId`
- selected target `teamId`
- user context needed for audit

Output:

- `runId`
- worker run url or polling token

### `GET /api/skill-runner/runs/:id`

Returns normalized run state:

- status
- step
- progress logs
- screenshots
- before/after vitals
- success eval
- report blob url

### `GET /api/skill-runner/runs`

Optional list endpoint for team-scoped runs if we want the control plane to load directly from worker state instead of central indexing.

### `POST /api/skill-runner/health`

Internal or signed endpoint for verifying worker health/version.

## Authentication Between Control Plane and Worker

Do not rely on browser session cookies for worker calls.

Use server-to-server auth:

- `dev3000-www` stores a per-team worker secret or signed token config
- outgoing requests from control plane to worker are signed
- worker validates signature and installation/team context

Recommended v1:

- shared secret per team worker
- HMAC-signed requests with timestamp

## Storage Model

Keep `skill-runner` catalog metadata in the control plane for product UX, but move run execution artifacts to the worker.

### Control Plane Storage

- imported skill runners
- hidden default runners
- canonical skills.sh path and cached hash
- worker installation metadata
- worker project metadata

### Worker Storage

- workflow run state
- screenshots
- reports
- logs and observations
- generated artifacts needed during execution

## Run Lifecycle

1. User opens `/skill-runner`
2. Control plane ensures team worker is installed and healthy
3. User starts a run
4. Control plane calls worker `POST /api/skill-runner/start`
5. Worker starts workflow locally in its own project context
6. Worker executes sandbox + AI flow
7. Control plane polls worker for status
8. Control plane renders `Skill Run Report` from normalized worker payload

## Skill Sync and Cache Behavior

The current skill-runner model already treats `skills.sh` as upstream and caches generated wrappers by upstream hash.

Keep that model, but move execution ownership to the worker.

Rules:

- the control plane still performs live skills.sh lookup/import
- imported runner identity stays `owner/path`
- if upstream hash changes, regenerate on next run
- wrapper generation may happen either:
  - in the control plane before start, or
  - in the worker after receiving canonical path + hash

Recommendation:

- control plane resolves the skill and sends canonical path + upstream content/hash
- worker generates the executable wrapper locally for deterministic execution

That keeps the worker self-sufficient for the actual run.

## Billing Boundaries

This design only shifts billing if the worker truly owns execution.

That means:

- workflow host must be the worker project
- worker storage writes must happen from the worker project
- AI calls must be issued by the worker project if you want those costs to land there too

If AI calls still route through `dev3000-www`, then compute moves but AI cost does not.

This needs an explicit product decision:

### Option A: Team Pays for Compute Only

- easiest intermediate state
- worker owns workflows and storage
- control plane still owns AI gateway/provider billing

### Option B: Team Pays for Compute and AI

- cleaner end state
- worker gets its own AI provider credentials/config
- likely requires integration setup or explicit team configuration UX

Recommendation:

- ship Option A first if speed matters
- design APIs so Option B can replace it later without changing the UI

## Provisioning UX

### `/skill-runner` When Not Installed

Show:

- why team-owned worker exists
- that runs will execute in their Vercel team
- what permissions the integration needs
- CTA: `Install d3k Skill Runner`

### During Provisioning

Show:

- `Installing integration`
- `Creating worker project`
- `Configuring environment`
- `Deploying worker`

This should behave like a small setup wizard, not a raw error page.

### Failure States

Need explicit repair UX for:

- integration removed
- worker project deleted
- deployment failed
- env drift
- worker version too old

## Deployment Strategy

Use a dedicated worker app/repo, not the full `dev3000-www` app.

The worker should contain only:

- workflow code
- run/report APIs needed by the control plane
- minimal auth and storage plumbing

Benefits:

- smaller deploy surface
- cleaner permission model
- easier versioning and rollout
- fewer accidental control-plane dependencies

## Versioning Strategy

Track:

- worker app version
- wrapper generation version
- workflow schema version

When the control plane talks to a worker:

- include expected protocol version
- worker returns its version
- if incompatible, mark the worker as needing upgrade

## Security Model

Minimum requirements:

- all control-plane to worker requests signed
- worker only accepts requests for its own team
- no trust in client-supplied team ids
- sensitive installation metadata stored server-side only
- audit log who started each run

## MVP Scope

Build the smallest useful version in this order:

1. Create integration install state in control plane
2. Provision one worker project per team
3. Build minimal worker API for start + status
4. Move workflow execution to the worker
5. Poll worker from existing `/skill-runner` UI
6. Render the same normalized report shape in control plane

Do not start with:

- PR creation
- advanced worker settings
- multiple worker regions
- per-run AI provider selection

## Recommended Data Shape

### Team Worker Record

Store in Blob or DB:

- `teamId`
- `teamSlug`
- `installationId`
- `workerProjectId`
- `workerProjectName`
- `workerBaseUrl`
- `workerStatus`
- `workerVersion`
- `sharedSecretId` or secret reference
- `lastHealthCheckAt`
- `createdAt`
- `updatedAt`

### Run Index Record

The control plane should keep a lightweight run index so `/runs` remains fast:

- `runId`
- `teamId`
- `runnerId`
- `runnerKind`
- `projectId`
- `projectName`
- `status`
- `startedAt`
- `completedAt`
- `workerBaseUrl`
- `reportUrl`

The worker remains source of truth for detailed run payloads.

## Risks

### 1. Git Linkage

If worker deployment depends on a repo connection, provisioning can get messy.

Mitigation:

- use a dedicated worker repo and automated project creation
- keep the deployment shape standardized

### 2. Env Drift

Worker can break if required env vars are removed.

Mitigation:

- health endpoint validates required config
- control plane can repair env on demand

### 3. Billing Confusion

Users may assume all costs moved to their team when only compute did.

Mitigation:

- be explicit in product copy about what is billed where in v1

### 4. Upgrade Drift

Different teams can end up on different worker versions.

Mitigation:

- record worker version
- add reconcile/upgrade path in control plane

## Open Decisions

1. Should v1 move only workflow compute and storage, or also AI billing?
2. Should the worker use team-owned Blob/report storage, or report back and let control plane persist final normalized reports?
3. Should one worker project serve all skill runners for a team, or do we ever need multiple workers later?

Recommendation:

- one worker project per team
- team-owned workflow compute and storage in v1
- keep AI billing centralized first if needed for speed

## Suggested Build Order

### Phase 1: Design and Scaffolding

- create worker app skeleton
- define control-plane to worker protocol
- add team worker installation records

### Phase 2: Provisioning

- integration install flow
- create worker project in team
- inject env vars
- initial deployment and health check

### Phase 3: Execution

- move `start-fix` equivalent into worker
- move run polling to worker APIs
- preserve normalized report schema

### Phase 4: Reconciliation and Repair

- add worker health UI
- add reinstall/redeploy/repair actions

## Bottom Line

This is feasible and the architecture is straightforward once we accept one fact:

Changing the target repo/team token does not move billing. Only moving workflow execution into a team-owned deployed worker does.

The correct product shape is:

- `dev3000-www` as control plane
- one installed Vercel integration per team
- one provisioned `d3k-skill-runner` worker project per team
- worker-owned execution with control-plane UI on top
