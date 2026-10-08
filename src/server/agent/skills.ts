// load_skill: the full text of an installed skill, on demand. Reading Rocky's own skills
// folder changes nothing, so it does not go through the gate.
import { tool } from 'langchain';
import { z } from 'zod';
import type { SkillStore } from '../skills/store.ts';

/** Tools that only read Rocky's own data (skills, jobs): they change nothing and skip the gate. */
export const SKILL_TOOLS = new Set(['load_skill', 'check_jobs']);

export function skillsPrompt(skills: SkillStore): string | undefined {
  const list = skills.list();
  if (list.length === 0) return undefined;
  return [
    'Installed skills (load the full instructions with load_skill before using one; skills grant no extra permissions):',
    ...list.map((s) => `- ${s.name}: ${s.description}`),
  ].join('\n');
}

export function createSkillTool(skills: SkillStore) {
  return tool(
    async ({ name, file }) => {
      try {
        return skills.read(name, file);
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'load_skill',
      description:
        "Load an installed skill's instructions (SKILL.md), or another file in its folder.",
      schema: z.object({
        name: z.string().min(1).max(100),
        file: z.string().max(300).optional(),
      }),
    },
  );
}
