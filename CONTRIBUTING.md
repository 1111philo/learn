# Contributing to 1111

## Workflow

We use a **feature branch → pull request → main** workflow. `main` is always the source of truth.

### 1. Stay up to date

Before starting any work, pull the latest from `main`:

```bash
git checkout main
git pull origin main
```

### 2. Create a feature branch

Branch off `main` with a short, descriptive name:

```bash
git checkout -b your-feature-name
```

Examples: `fix-activity-scoring`, `add-learner-profile-integration`, `ui-lesson-reader`.

### 3. Make your changes

Keep commits focused. Each commit should represent one logical change. Write clear commit messages that describe *why*, not just *what*.

### 4. Run the tests

Before pushing, run the backend test suite:

```bash
cd backend
PYTHONPATH=src ANTHROPIC_API_KEY=test-key uv run pytest tests/ -v
```

All tests must pass. If you changed generation-related code, update the corresponding test file — each file has a comment at the top describing what to update.

### 5. Keep your branch current

If `main` moves forward while you're working, rebase your branch on top of it:

```bash
git fetch origin
git rebase origin/main
```

Do this regularly — the longer you wait, the harder conflicts become.

### 6. Open a pull request

Push your branch and open a PR against `main`:

```bash
git push origin your-feature-name
```

In your PR description, include:
- What the change does
- Why it's needed
- Any notable decisions or trade-offs
- Steps to test it manually (if applicable)

### 7. Review and merge

PRs require at least one review before merging. Address feedback, push updates to the same branch, and merge once approved.

---

## Branch Naming

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feature/...` or plain | `add-dark-mode` |
| Bug fix | `fix/...` | `fix-sse-reconnect` |
| Chore / refactor | `chore/...` | `chore-update-deps` |

## What Not to Do

- **Do not commit directly to `main`**
- **Do not force-push to `main`**
- **Do not merge your own PR without a review** (unless working solo and explicitly agreed)
- **Do not open a PR with unresolved merge conflicts** — rebase first
- **Do not open a PR with failing tests** — the CI check will block the merge anyway

## CI/CD

### Workflows

Two GitHub Actions workflows run automatically:

**CI** (`.github/workflows/ci.yml`) — triggers on every PR to `main`:
- Runs the backend test suite
- Required status check — PRs cannot be merged until it passes

**Deploy** (`.github/workflows/deploy.yml`) — triggers on every push to `main` (and can be triggered manually via the GitHub Actions tab):
1. Runs the test suite
2. Builds the Docker image (`linux/amd64`)
3. Pushes to ECR (tagged with commit SHA and `latest`)
4. Triggers an App Runner redeployment

### GitHub secrets setup

After running `terraform apply`, configure these secrets in your GitHub repo under **Settings → Secrets and variables → Actions**:

| Secret | How to get it |
|--------|---------------|
| `AWS_ACCESS_KEY_ID` | Your AWS IAM access key |
| `AWS_SECRET_ACCESS_KEY` | Your AWS IAM secret key |
| `AWS_REGION` | Your AWS region (e.g. `us-east-1`) |
| `ECR_REGISTRY` | `terraform -chdir=infra output -raw ecr_repository_url` |
| `APPRUNNER_SERVICE_ARN` | `terraform -chdir=infra output -raw apprunner_service_arn` |

### First deploy

Terraform creates the infrastructure but doesn't push an image. After setting secrets, trigger the first deploy:

```bash
./infra/deploy.sh
```

Or trigger the deploy workflow manually from the GitHub Actions tab. From then on, every merge to `main` deploys automatically.

## Local Dev Setup

See [README.md](README.md) for environment setup, running locally, and Docker instructions.
