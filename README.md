# DecisionTrail

**Capture why, not just what.** DecisionTrail is a Forge app for Jira and Confluence. It records decisions: what was chosen, the options considered, the rationale and who owns it. Each decision is linked to the issues and pages it affects, and the app warns you when a later comment quietly reverses one.

Entry for **Atlassian Codegeist 2026** (Apps for Software Teams). Runs on Atlassian: no external egress, and all data is held in Forge storage and Jira issue properties.

## Features

| | Where | What it does |
|---|---|---|
| Decisions panel | Jira issue panel | Add or link decisions, change status and supersede. Onboarding includes a one-click Acme demo. |
| Decision log | Confluence macro "Decision log" | Site-wide table filtered by status, or the decisions linked to this page. |
| Capture agent (F1) | Rovo agent "DecisionTrail Capture" | Extracts candidate decisions, options and owners from an issue or page comment thread, with citations. |
| Why agent (F2) | Rovo agent "DecisionTrail Why" | Answers "why did we choose X?" from recorded decisions, citing the source comments. |
| Conflict guard (F6) | Jira comment trigger | When a comment contradicts an accepted decision, the app posts a warning that @mentions the owner and flags it in the panel. From the flag you can record a superseding decision or dismiss it. |
| Decision trace (F5) | Jira project page and Confluence app page | Shows each decision with its issues, pages and the decisions it replaced. |
| Work links (F7) | Jira issue Links section | Each Confluence page that documents a decision becomes a "Decision record" remote link on its issues. Jira surfaces these through Teamwork Graph and search. |
| Decision health (F8) | Jira dashboard gadget | Flags decisions with no owner, stale proposals, unlinked decisions and reversals. **Export as ADR markdown** (Nygard format). |

## Judge setup (about 10 minutes)

You need an Atlassian Cloud site with Jira and Confluence where you're an admin. A free site from <https://www.atlassian.com/try/cloud/signup?bundle=jira-software&edition=free> works for every feature except the Rovo agents. Rovo Chat isn't reliably available on free developer sites; see [Rovo agents](#testing-the-rovo-agents) below.

1. **Install.** Open the installation link from the submission ("Start sharing your app"). Install it on **Jira**, then open the same link again and install it on **Confluence**. Both are needed, because decisions recorded in Jira also appear in Confluence.
2. **Seed the Acme demo (optional but recommended):**
   ```bash
   git clone <this repo> && cd decisiontrail
   SITE=https://<your-site>.atlassian.net ATL_EMAIL=<you> ATL_TOKEN=<api token> \
     node --experimental-strip-types scripts/seed-judge.ts      # add --dry-run to preview
   ```
   This creates project **ACME** and the issue "Choose message queue for order events" with a six-comment Kafka vs RabbitMQ debate. It also creates the Confluence page "Order events architecture". It's idempotent and never prints your token. Without the script, any existing issue works.
3. **Load decisions.** On the issue, open the **Decisions** panel and click **Load Acme demo decisions**. That adds RabbitMQ (superseded), then Kafka (accepted, supersedes RabbitMQ), then Avro (proposed, no owner).

### What to try

1. **Conflict guard.** Comment on the issue: *"Ops is stretched thin, let's switch to RabbitMQ for order events."* Within about 30 seconds DecisionTrail replies with a warning that @mentions the owner, and the Decisions panel shows the flag. Click **Record "RabbitMQ" as superseding decision**, or **Dismiss**.
2. **Trace.** Go to the ACME project sidebar → **Decision trace**, or Confluence → Apps → **Decision trace**, to see the supersession chain and links.
3. **Confluence.** On "Order events architecture", insert the **Decision log** macro. Choose "All decisions" for the log, or "This page" to link decisions to the page.
4. **Work links.** Link a decision to the Confluence page from the page's Decision log ("This page" scope), then reopen the Jira issue. A **Decision record** link appears under the issue's Links.
5. **Dashboard.** Go to Dashboards → create a dashboard → Add gadget → **Decision health**. It shows the unowned Avro proposal and one reversal. Click **Export as ADR markdown**.

### Testing the Rovo agents

Rovo needs a site with Rovo Chat. The free option Atlassian supports is a Forge demo development site: `forge site provision`, then `forge install --demo-site`. In Rovo Chat → Browse agents, enable **DecisionTrail Capture** or **DecisionTrail Why**. Then ask Capture to *"extract decisions from ACME-1"*, and ask Why *"why did we choose Kafka for order events?"*

## Develop

```bash
npm install
export FORGE_EMAIL=... FORGE_API_TOKEN=...      # or forge login
npx vitest run && npx tsc --noEmit && forge lint
forge deploy -e development
forge install -e development -s <site> -p Jira && forge install -e development -s <site> -p Confluence
```

Architecture, storage and the cross-product flow are covered in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The build plan is in [PLAN.md](PLAN.md).

**Permissions:** `storage:app`, `read:jira-work`, `write:jira-work` (issue properties, app comments, remote links), and read-only Confluence page, comment and summary scopes. No external fetch.

## License

MIT, see [LICENSE](LICENSE).
