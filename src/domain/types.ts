export type DecisionStatus = 'proposed' | 'accepted' | 'superseded' | 'rejected';
export const STATUSES: DecisionStatus[] = ['proposed', 'accepted', 'superseded', 'rejected'];

export type LinkType = 'jira-issue' | 'confluence-page';

export interface DecisionLink {
  type: LinkType;
  /** Jira issue key (e.g. ACME-12) or Confluence page id */
  id: string;
}

export interface Decision {
  id: string;
  title: string;
  rationale: string;
  options: string[];
  status: DecisionStatus;
  decidedBy: string; // Atlassian accountId
  date: string; // ISO date (YYYY-MM-DD)
  links: DecisionLink[];
  supersedes?: string; // id of an earlier decision
  supersededBy?: string;
  /** citations to source comments, e.g. "jira:ACME-1#10001" or "confluence:360449#98305" */
  sources?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DecisionInput {
  title: string;
  rationale?: string;
  options?: string[];
  status?: DecisionStatus;
  decidedBy?: string;
  date?: string;
  links?: DecisionLink[];
  supersedes?: string;
  sources?: string[];
}

/** Storage-agnostic repository so domain logic is unit-testable. */
export interface DecisionRepo {
  get(id: string): Promise<Decision | undefined>;
  put(d: Decision): Promise<void>;
  delete(id: string): Promise<void>;
  listByTarget(link: DecisionLink): Promise<Decision[]>;
  listAll(limit?: number): Promise<Decision[]>;
}
