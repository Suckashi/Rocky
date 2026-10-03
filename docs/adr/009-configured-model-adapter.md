# ADR-009: configured models retain the native Agent runtime

Status: adapter and server-owned connection leases implemented; Work/UI selection remains pending.

`ConfiguredModel` implements the installed LangChain BaseChatModel public contract and uses its public tool converter. It sends text/tool messages through the existing per-connection ModelNetwork to either OpenAI-compatible chat completions or Anthropic Messages. It never runs tools or implements an agent loop. The existing createRockyAgent factory accepts root/child model overrides; native Deep Agents still owns task, todos, interrupts and resume, with the same policy middleware.

The installed declarations and executed tests are compatibility evidence. Relevant primary references are [BaseChatModel](https://reference.langchain.com/javascript/langchain-core/language_models/chat_models/BaseChatModel) and [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create).

Registry leases pin connection revision and resolve credentials only within the daemon. Acquiring a model requires an explicit context window larger than its output reserve. The native model profile exposes that configured input space, without an assumed 256K default. A trusted model-specific input token bound, when supplied, is checked before dispatch. No generic character-to-token heuristic is advertised as a trusted tokenizer. Requests/responses have a separate 1 MiB byte cap and a 60-second per-call deadline.

Every model call reserves through injected root accounting before network I/O. Ordinary provider-reported input/output usage settles the reservation and populates AIMessage usage metadata. Missing usage stays unknown. Cache-priced usage is conservatively unknown until explicit cache pricing is supported; it is not silently billed as ordinary input. Valid usage can be retained even if the accompanying model response is unusable. Malformed/truncated output is rejected with safe errors rather than treated as a final answer.

Editing the connection aborts older leases and prevents their next dispatch. Closing a model destroys its dispatcher and waits for in-flight generation cleanup before releasing the store. No automatic network retry or endpoint fallback exists. Tests use synthetic HTTP providers, not paid/public endpoints, and exercise the actual factory through a native child, approval interruption and resume while recording shared usage.

This adapter currently supports text and ordinary tool calls. Vision, structured output, explicit tool-choice overrides, cache-priced accounting and incremental runtime streaming are not implemented. BaseChatModel's normal non-stream fallback remains; the separate connection probe's SSE success is not a claim of incremental Agent streaming. Work submission/UI selection, evaluation configured-model selection and trusted tokenizer profiles remain next work. Existing UI/runtime availability declarations stay false until that integration is verified.
