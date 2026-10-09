// A scripted OpenAI-compatible chat completions server on 127.0.0.1.
// It lets tests and the browser end-to-end scripts drive the real ChatOpenAI client without a live model.
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ScriptedToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ScriptedReply {
  text?: string;
  toolCalls?: ScriptedToolCall[];
  /** Answer with this HTTP error instead (a provider refusing the request). */
  httpError?: { status: number; body: unknown };
}

export interface ChatRequestMessage {
  role: string;
  content?: unknown;
  tool_calls?: unknown[];
}

export interface RecordedRequest {
  messages: ChatRequestMessage[];
  toolNames: string[];
  /** The tool definitions as sent: name, description and JSON schema. */
  tools: {
    function: { name: string; description?: string; parameters?: unknown };
  }[];
  stream: boolean;
}

export type Script = (messages: ChatRequestMessage[]) => ScriptedReply;

export interface FakeOpenAI {
  baseURL: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

const USAGE = {
  prompt_tokens: 1200,
  completion_tokens: 40,
  total_tokens: 1240,
  prompt_tokens_details: { cached_tokens: 1024 },
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function halves(text: string): string[] {
  const middle = Math.ceil(text.length / 2);
  return [text.slice(0, middle), text.slice(middle)].filter(Boolean);
}

function streamChunks(id: string, reply: ScriptedReply): unknown[] {
  const base = {
    id,
    object: 'chat.completion.chunk',
    created: 0,
    model: 'fake',
  };
  const chunks: unknown[] = [
    {
      ...base,
      choices: [{ index: 0, delta: { role: 'assistant', content: '' } }],
    },
  ];
  for (const piece of halves(reply.text ?? '')) {
    chunks.push({
      ...base,
      choices: [{ index: 0, delta: { content: piece } }],
    });
  }
  (reply.toolCalls ?? []).forEach((call, index) => {
    const [first = '', second = ''] = halves(JSON.stringify(call.args));
    chunks.push({
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index,
                id: `${id}-call-${index}`,
                type: 'function',
                function: { name: call.name, arguments: first },
              },
            ],
          },
        },
      ],
    });
    if (second) {
      chunks.push({
        ...base,
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ index, function: { arguments: second } }] },
          },
        ],
      });
    }
  });
  const finish = reply.toolCalls?.length ? 'tool_calls' : 'stop';
  chunks.push({
    ...base,
    choices: [{ index: 0, delta: {}, finish_reason: finish }],
  });
  chunks.push({ ...base, choices: [], usage: USAGE });
  return chunks;
}

function completion(id: string, reply: ScriptedReply): unknown {
  const toolCalls = (reply.toolCalls ?? []).map((call, index) => ({
    id: `${id}-call-${index}`,
    type: 'function',
    function: { name: call.name, arguments: JSON.stringify(call.args) },
  }));
  return {
    id,
    object: 'chat.completion',
    created: 0,
    model: 'fake',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: reply.text ?? '',
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: toolCalls.length ? 'tool_calls' : 'stop',
      },
    ],
    usage: USAGE,
  };
}

export async function startFakeOpenAI(script: Script): Promise<FakeOpenAI> {
  const requests: RecordedRequest[] = [];
  let counter = 0;
  const server: Server = createServer((req, res) => {
    void (async () => {
      if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
        res.writeHead(404).end();
        return;
      }
      const body = JSON.parse(await readBody(req)) as {
        messages: ChatRequestMessage[];
        tools?: RecordedRequest['tools'];
        stream?: boolean;
      };
      requests.push({
        messages: body.messages,
        toolNames: (body.tools ?? []).map((tool) => tool.function.name),
        tools: body.tools ?? [],
        stream: body.stream === true,
      });
      const reply = script(body.messages);
      const id = `chatcmpl-${++counter}`;
      if (reply.httpError) {
        res.writeHead(reply.httpError.status, {
          'content-type': 'application/json',
        });
        res.end(JSON.stringify(reply.httpError.body));
        return;
      }
      if (!body.stream) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(completion(id, reply)));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const chunk of streamChunks(id, reply)) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      res.end('data: [DONE]\n\n');
    })().catch((error: unknown) => {
      res.writeHead(500).end(String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseURL: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
