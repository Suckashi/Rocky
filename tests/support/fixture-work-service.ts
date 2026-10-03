import { WorkService } from "../../apps/daemon/src/work-service.js";
/** Explicit test harness; production daemon never imports this entry. */
export class FixtureWorkService extends WorkService {
  constructor(root: string, config?: unknown) {
    super(root, config, true);
  }
}
