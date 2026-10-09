// One more try when the model provider refuses a request without saying why (ADR 0026).
// Command Code answered about 0.5% of requests with a bare 400 invalid_request_error, and
// the same request succeeded when sent again. Model calls change nothing outside, so one
// retry is safe; a 400 that names its cause (code or param, such as a context that is too
// long) is not retried, and a second refusal ends the run as before.
import { modelRetryMiddleware, type AgentMiddleware } from 'langchain';

/** LangChain wraps the provider's error (MiddlewareError); the HTTP status is on a cause. */
export function isUnexplainedRefusal(error: unknown): boolean {
  for (let e = error, depth = 0; e && depth < 5; depth++) {
    const x = e as { status?: unknown; code?: unknown; param?: unknown };
    if (x.status !== undefined)
      return x.status === 400 && x.code == null && x.param == null;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

export function providerRetry(): AgentMiddleware {
  return modelRetryMiddleware({
    maxRetries: 1,
    retryOn: isUnexplainedRefusal,
    onFailure: 'error',
    initialDelayMs: 1000,
  }) as unknown as AgentMiddleware;
}
