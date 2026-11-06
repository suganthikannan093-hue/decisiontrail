# DecisionTrail: Codegeist 2026 build plan

> A Forge app for Jira and Confluence that captures every team decision (what was decided, why, by whom, and what options were rejected) and traces it to the issues, pages and goals it affects.

## 1. Rules facts (from codegeist2026.devpost.com and /rules, read 4 Nov 2026)
- **Submission deadline:** Tue 22 Dec 2026, 12:00 PM PT, which is **Wed 23 Dec 2026, 1:30 AM IST**. Submissions opened 27 Oct 2026.
- **Judging** runs 5 Jan to 3 Feb 2027. Winners are announced around 15 Feb 2027 (9 AM PT, which is 10:30 PM IST).
- **Prizes ($120K+):**
  - 1st place: 3 × $15,000, plus 2 Team '27 (AMER) tickets (travel not included), a blog feature and swag
  - 2nd place: 3 × $8,000
  - 3rd place: 3 × $5,000
  - Bonus prizes, 6 × $1,500 each: Best Rovo agent (`rovo:agent`, `rovo:agentConnector`, or reusable `rovo:skill`/`rovo:action`), Best Atlassian MCP app (`rovo:mcp` module), Best Teamwork Graph integration, and Best Marketplace-published app (listing or review-ticket link)
  - 300 swag packs, first come first served
  - Categories: Apps for Software Teams, Business Teams, or Specialized Industries
  - **Unverified:** whether one project can win both a placing and a bonus prize.
- **Judging:**
  - Stage 1 is pass/fail: the app must fit the theme and use the required APIs.
  - Stage 2 has five equal criteria at 20% each: Technological Implementation, Design (a complete product, not a proof of concept), Potential Impact, Innovation/Idea, and Presentation (the video shows it working end to end and explains the problem, who it's for and why it matters).
  - Ties are broken by the criteria in that order.
- **Submission requirements:**
  - The app must be built on Forge and integrate with at least one of Jira, Confluence, JSM, Bitbucket, Teamwork Graph or Rovo.
  - Judges need a working **installation link** ("Start sharing your app") plus full setup instructions. The app must install in a judge's site and work as shown.
  - A public **YouTube** video under 5 minutes. Judges aren't required to watch past 3 minutes. No unlicensed music or third-party trademarks.
  - A text description, an explanation of how it meets the tech requirement, the category and bonus picks, and the bonus write-ups. Everything must be in English.
  - A Marketplace listing is required **only** for the Marketplace bonus.
  - **No public code repository or open-source licence is required** by the rules. Keep the repo private and add the MIT licence anyway.
  - The project must be new, or rebuilt on Forge after 27 Oct 2026.
- **Eligibility:**
  - Entrants must be of legal age. Solo entrants, teams and organisations can all enter.
  - Excluded places: Brazil, Quebec, Russia, Belarus, Crimea, Cuba, Iran, North Korea, Syria, Sudan, Myanmar and other OFAC-sanctioned places. India is eligible.
  - Projects built with funding or preferential support from Atlassian or Devpost are excluded.
  - Rules mention that a Free Atlassian Cloud Developer licence is needed.

## 2. Why this idea can win
The challenge text names "what's already been decided" and "turning organizational data into a decision" outright, so DecisionTrail fits the theme exactly. Teams lose decisions in comment threads, then argue them again or reverse them without realising. DecisionTrail makes decisions first-class, linked and queryable objects, and it lets Rovo answer "why is it like this?"

**Category:** Apps for Software Teams. Architecture decision records (ADRs) are a well-known pain, and it fits the judges' "context to ship with confidence" wording. The Business Teams angle can be mentioned in the pitch.

**Bonus targets:** Rovo Agent (primary), Teamwork Graph, and Marketplace (submit for listing in December, since only the review ticket is needed). MCP is a stretch goal.

## 3. Features, mapped to the criteria
| # | Feature | Forge modules | Criteria hit |
|---|---------|---------------|--------------|
| F1 | **Decision Capture Rovo agent.** Reads an issue's or page's comments and suggests structured decisions (title, context, options, chosen option, rationale, owner, date, confidence). The user confirms in one click. | `rovo:agent`, `rovo:action` (extractDecisions, saveDecision), `function` | Tech, Innovation, Rovo bonus |
| F2 | **"Why?" agent and skill.** Ask "why did we choose Postgres?" and get the answer with citations to the decision, its source comments and linked issues. Exposed as a reusable `rovo:skill`/`rovo:action` so other agents can call it. | `rovo:agent`, `rovo:action` (findDecisions, explainWhy) | Impact, Rovo bonus |
| F3 | **Jira issue panel.** Lists the decisions affecting this issue, with status (Proposed/Accepted/Superseded) and an "Add decision" form. | `jira:issuePanel` (UI Kit), `jira:issueContext` badge | Design, Tech |
| F4 | **Confluence decision log macro.** Inserts a live, filterable table of decisions by space, label or epic. Also a byline item on pages that a decision cites. | `macro`, `confluence:contentBylineItem` | Design, Impact |
| F5 | **Traceability graph.** A Jira project page and Confluence global page showing decision → issues → pages → superseding decisions, with click-through. | `jira:projectPage`, `confluence:globalPage` (Custom UI with a graph library) | Innovation, Design, Presentation |
| F6 | **Conflict and reversal guard.** When a new decision contradicts or supersedes an earlier one, flag it, ask the user to link "supersedes", and notify the owner. | `trigger` (comment and issue events), Rovo action | Innovation, Impact |
| F7 | **Teamwork Graph link.** Write decision ↔ work links into the graph, or read issue/page/goal relations to suggest links (exact API surface needs checking in the Forge docs). | TWG API, `function` | TWG bonus |
| F8 | **Decision health dashboard.** Shows decisions with no owner, stale proposals and reversal counts. Exportable as ADR markdown. | `jira:dashboardGadget` | Impact, Design |
| F9 (stretch) | Expose findDecisions and explainWhy via `rovo:mcp` so IDE agents can ask "why" | `rovo:mcp` | MCP bonus |

- **Storage:** Forge SQL, or Custom Entities in Forge storage, with indexes by issue, page and status. Entity links are also stored as issue/content properties so JQL and CQL can search them, e.g. `issue.property[decisiontrail].count > 0`.
- **Platform:** fully Runs on Atlassian (no egress), which is a Marketplace trust-badge selling point. LLM work runs through Rovo, so no external key is needed.

## 4. Milestones (all dates IST)
| Dates | Milestone |
|-------|-----------|
| **Needs Suganthi's go-ahead first** | Atlassian developer account and free dev site, Devpost registration, private GitHub repo `decisiontrail` (MIT) |
| 5–9 Nov | Forge login, `forge create` from the UI Kit template, data model (Decision, Link), storage layer and unit tests |
| 10–16 Nov | F3 Jira issue panel and F4 Confluence macro working end to end with manual decisions |
| 17–25 Nov | F1 capture agent and F2 "Why?" skill (Rovo agent, actions, prompt tuning on seeded demo data) |
| 26 Nov – 3 Dec | F5 traceability graph, F6 conflict guard (triggers) |
| 4–9 Dec | F7 Teamwork Graph, F8 dashboard, UI polish, empty states, onboarding |
| 10–13 Dec | Distribution: installation link, judge test instructions, seed-data script; submit the Marketplace listing for the review ticket |
| 14–17 Dec | Demo video (target 2:45, hard cap 4:30), README, Devpost write-ups for each bonus |
| 18–20 Dec | Fresh-site install test, bug bash, freeze |
| **21 Dec** | Submit on Devpost (a buffer of more than 1 day before 23 Dec, 1:30 AM IST) |

## 5. Demo storyline (main content in the first 3 minutes)
1. **0:00–0:20 Problem:** "Six weeks later, nobody remembers why we picked Kafka, and the team reverses it." Show a messy comment thread.
2. **0:20–1:00 Capture:** run the Rovo Decision Capture agent on the thread. It produces 2 structured decisions, and the user accepts them with one click. They appear in the Jira issue panel.
3. **1:00–1:40 Trace:** the Confluence decision log macro, then the traceability graph across issues, pages and the superseded decision.
4. **1:40–2:20 Ask why:** in Rovo chat, "Why are we on Postgres?" gets a cited answer. Another agent calls the DecisionTrail skill.
5. **2:20–2:50 Guard:** a new comment contradicts an accepted decision, so the conflict flag fires and the owner is notified. Then the dashboard.
6. **2:50–3:15 Impact and business:** who it's for, Runs on Atlassian, installation readiness, and the bonus modules used.

## 6. Risks
- **Rovo availability on dev sites and the Rovo/TWG API surface:** check in week 1. Fallback: a Forge LLM module or a rules-based extractor.
- **Judges' install:** test the installation link on a second clean site.
- **Marketplace review time:** submit for listing by 13 Dec. Only the ticket link is needed.
- Never include employer names or real company data in demo content. Use a fictional "Acme" seed.
