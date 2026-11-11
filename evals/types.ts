// Shapes for the eval datasets in evals/data/*.json.
// Structure follows the agents-v2 course: data (input) + target (expectations).

export type ToolCall = { toolName: string; args: Record<string, unknown> }

/** A check on one argument of one tool call. */
export type ArgCheck = {
  tool: string
  arg: string
  /** Exactly one of these: */
  equals?: string
  oneOf?: string[]
  contains?: string
  absent?: true
}

// --- single-turn: which tools does the model pick, with what arguments? -----

export type SingleTurnData = { prompt: string }

export type SingleTurnTarget = {
  /** golden: must select these. secondary: scored by F1. negative: must avoid forbiddenTools. */
  category: 'golden' | 'secondary' | 'negative'
  expectedTools?: string[]
  forbiddenTools?: string[]
  args?: ArgCheck[]
  /** e.g. 5 independent lookups → at least 5 web_search calls in one step. */
  minCalls?: { tool: string; count: number }
}

export type SingleTurnResult = { toolCalls: ToolCall[]; toolNames: string[]; text: string; seconds: number }

// --- multi-turn: does the agent complete the task? ---------------------------

/** A page the fake search engine can return. No publishedDate = undated page. */
export type MockPage = {
  /** Returned when the query contains any of these (case-insensitive). */
  match: string[]
  url: string
  title: string
  publishedDate?: string
  text: string
}

export type SeedMessage = {
  conversation: string
  /** Local date and time in the eval timezone, e.g. "2026-11-03 14:05". */
  at: string
  role: 'user' | 'assistant'
  text: string
}

export type MultiTurnData = {
  name: string
  /** Past conversations to put in the database first. Empty = fresh instance. */
  seed?: SeedMessage[]
  /** User messages, sent in order in one conversation. The last answer is scored. */
  prompts: string[]
  pages?: MockPage[]
  /** Make every search fail, to test error handling. */
  searchFails?: boolean
}

export type MultiTurnTarget = {
  /** Tools that must be called, in this order (other calls may come between). */
  expectedToolOrder?: string[]
  forbiddenTools?: string[]
  minCalls?: { tool: string; count: number }
  args?: ArgCheck[]
  /** Regexes (case-insensitive) the final answer must / must not match. */
  mustMention?: string[]
  mustNotMention?: string[]
  /** Domains that must / must not be cited as links in the final answer. */
  mustCite?: string[]
  mustNotCite?: string[]
  /** Any line stating `value` (regex) must link `domain`: the number is cited to the page it came from. */
  attribution?: { value: string; domain: string }[]
  /** What a correct answer does, for the LLM judge. */
  rubric: string
}

export type MultiTurnResult = {
  answer: string
  toolCalls: ToolCall[]
  toolNames: string[]
  /** Every URL the tools returned in this run. */
  returnedUrls: string[]
  /** What the tools returned, shortened, for the judge. */
  toolResults: string
  seconds: number
  firstTextSeconds: number
}
