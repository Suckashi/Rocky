// Installed skills, for the settings page. Installing is done by hand in the folder.
import { Hono } from 'hono';
import type { SkillStore } from '../../skills/store.ts';

export function skillRoutes(skills: SkillStore): Hono {
  const app = new Hono();
  app.get('/skills', (c) => c.json({ dir: skills.dir, skills: skills.list() }));
  return app;
}
