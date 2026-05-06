/**
 * Agent Task Pack 公開型別
 * 第一版：plan-only、step.type 僅支援 'command'
 */

export type AgentTaskSource = 'builtin' | 'shared' | 'local'
export type AgentTaskMode = 'plan-only'
export type AgentTaskStepType = 'command'
export type AgentTaskRisk = 'readonly' | 'dry-run' | 'write' | 'unknown'

export type AgentTaskEngine = 'postgres' | 'mysql' | 'mongodb' | 'redis' | 'elasticsearch'

export type AgentTaskParamType = 'string' | 'number' | 'boolean'

export interface AgentTaskParam {
  name: string
  type: AgentTaskParamType
  required?: boolean
  description?: string
  default?: string | number | boolean
  enum?: Array<string | number | boolean>
}

export interface AgentTaskStep {
  type: AgentTaskStepType
  command: string
  reason?: string
  risk?: AgentTaskRisk
}

export interface AgentTask {
  name: string
  description?: string
  tags: string[]
  engines?: AgentTaskEngine[]
  params: AgentTaskParam[]
  safety: {
    mode: AgentTaskMode
    requires?: string[]
  }
  steps: AgentTaskStep[]
  notes?: string
  source: AgentTaskSource
  file: string
}

/** Resolved param values keyed by name (post-default-application) */
export type AgentTaskParamValues = Record<string, string | number | boolean>

export interface AgentTaskPlanStep {
  command: string
  resolvedCommand: string
  argv: string[]
  reason?: string
  risk?: AgentTaskRisk
}

export interface AgentTaskPlan {
  name: string
  source: AgentTaskSource
  file: string
  description?: string
  mode: AgentTaskMode
  requires: string[]
  parameters: AgentTaskParamValues
  steps: AgentTaskPlanStep[]
  warnings: string[]
}

export class AgentTaskError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'PARSE_ERROR'
      | 'NOT_FOUND'
      | 'PARAM_MISSING'
      | 'PARAM_INVALID'
      | 'TEMPLATE_SYNTAX'
      | 'IO_ERROR',
    public readonly file?: string
  ) {
    super(message)
    this.name = 'AgentTaskError'
    Object.setPrototypeOf(this, AgentTaskError.prototype)
  }
}
