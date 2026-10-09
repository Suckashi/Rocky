// The tool registry (ADR 0024): every tool the model can call, registered with a judge that
// says what calling it would do. The gate middleware asks the registry instead of matching
// tool names; a tool nobody registered falls back to `unknown` (an outside action).
import type { CreateDeepAgentParams } from 'deepagents';
import type { Effect } from '../effects/types.ts';

/** What one tool call would do: an effect for the gate (with the current content for the
 * approval diff, and the root it is judged against when that is not the project), an error
 * for the model, or nothing to judge (the tool changes nothing outside the agent). */
export type ToolEffect =
  | { effect: Effect; before?: string; root?: string }
  | { error: string }
  | { none: true };

export type Judge = (
  args: Record<string, unknown>,
) => ToolEffect | Promise<ToolEffect>;

/** A tool as Deep Agents takes it (LangChain tools). */
export type AgentTool = NonNullable<CreateDeepAgentParams['tools']>[number];

export class ToolRegistry {
  private readonly judges = new Map<string, Judge>();
  private readonly own: AgentTool[] = [];
  private readonly unknown: (
    name: string,
    args: Record<string, unknown>,
  ) => ToolEffect;

  /** `unknown` judges a call to a tool nobody registered. */
  constructor(
    unknown: (name: string, args: Record<string, unknown>) => ToolEffect,
  ) {
    this.unknown = unknown;
  }

  /** A tool Rocky defines: offered to the model, in registration order, and judged by `judge`. */
  add(tool: AgentTool & { name: string }, judge: Judge): this {
    this.own.push(tool);
    this.judges.set(tool.name, judge);
    return this;
  }

  /** A tool another layer offers (Deep Agents' file tools, write_todos, task). */
  judge(name: string, judge: Judge): this {
    this.judges.set(name, judge);
    return this;
  }

  /** Rocky's own tools, for the agent. */
  tools(): AgentTool[] {
    return [...this.own];
  }

  effectOf(
    name: string,
    args: Record<string, unknown>,
  ): ToolEffect | Promise<ToolEffect> {
    const judge = this.judges.get(name);
    return judge ? judge(args) : this.unknown(name, args);
  }
}
