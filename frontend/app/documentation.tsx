"use client";
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { CopyButton, PageHeading, Skeleton } from "./ui";
export default function Documentation({
  endpoint,
  notify,
}: {
  endpoint: string;
  notify: (s: string) => void;
}) {
  const [language, setLanguage] = useState("Python");
  const snippets: Record<string, string> = {
    Python: `import os\nfrom openai import OpenAI\n\nclient = OpenAI(\n    base_url="${endpoint}",\n    api_key=os.environ["GATEWAY_API_KEY"],\n    max_retries=0,  # Gateway owns the fallback budget\n)\n\nresponse = client.chat.completions.create(\n    model="auto/coding",\n    messages=[{"role": "user", "content": "Explain async Python"}],\n)\nprint(response.choices[0].message.content)`,
    TypeScript: `import OpenAI from "openai";\n\nconst client = new OpenAI({\n  baseURL: "${endpoint}",\n  apiKey: process.env.GATEWAY_API_KEY,\n  maxRetries: 0,\n});\n\nconst response = await client.chat.completions.create({\n  model: "auto/coding",\n  messages: [{ role: "user", content: "Explain async Python" }],\n});\nconsole.log(response.choices[0].message.content);`,
    cURL: `curl "${endpoint}/chat/completions" \\\n  -H "Authorization: Bearer $GATEWAY_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "model": "auto/coding",\n    "messages": [{"role":"user", "content":"Hello!"}]\n  }'`,
  };
  return (
    <>
      <PageHeading
        title="Integration guide"
        subtitle="Use the OpenAI SDK or any client that supports a custom OpenAI-compatible base URL."
      />
      <div className="docs-layout">
        <section className="panel docs-code">
          <div className="panel-heading">
            <div className="segmented">
              {Object.keys(snippets).map((x) => (
                <button
                  key={x}
                  className={language === x ? "active" : ""}
                  onClick={() => setLanguage(x)}
                >
                  {x}
                </button>
              ))}
            </div>
            <CopyButton value={snippets[language]} onCopy={notify} />
          </div>
          {endpoint ? (
            <pre>{snippets[language]}</pre>
          ) : (
            <div className="docs-loading">
              <Skeleton />
              <span className="sr-only">Loading your gateway endpoint</span>
            </div>
          )}
        </section>
        <section className="panel docs-steps">
          <h2>Connect in three steps</h2>
          {[
            [
              "Add your providers",
              "Search the provider directory to add API keys or authorize supported accounts directly, then rank your preferred models.",
            ],
            [
              "Create a Gateway API key",
              "Copy the key once and store it as an environment variable.",
            ],
            [
              "Point your client to Nexus",
              "Set the base URL and Gateway API key, then choose auto or a model from your registry.",
            ],
          ].map(([title, text], i) => (
            <div className="doc-step" key={title}>
              <span>{i + 1}</span>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </div>
          ))}
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>Routing reference</h2>
        </div>
        <div className="table-scroll">
          <table role="table">
            <thead>
              <tr>
                <th>Model / mode</th>
                <th>Behavior</th>
              </tr>
            </thead>
            <tbody>
              {[
                [
                  "auto",
                  "Selects a confirmed compatible model by provider priority and measured latency.",
                ],
                [
                  "auto/fastest",
                  "Prefers the lowest observed end-to-end latency. Unknown latency sorts last.",
                ],
                [
                  "auto/cheapest",
                  "Prefers the lowest known input + output token price. Unknown prices sort last.",
                ],
                [
                  "auto/coding",
                  "Prefers declared coding models or coding-family names, then normal priority.",
                ],
                [
                  "auto/reasoning · auto/vision",
                  "Requires confirmed reasoning or vision capability.",
                ],
                [
                  "auto/image · auto/embedding",
                  "Use on /images/generations or /embeddings respectively.",
                ],
                [
                  "provider + native model",
                  "Pins the provider and prefers the exact model ID.",
                ],
                [
                  "connection-id::model-id",
                  "Pins a specific provider connection. Copy this ID from Model explorer.",
                ],
              ].map(([a, b]) => (
                <tr key={a}>
                  <td className="mono">{a}</td>
                  <td>{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel docs-steps">
        <h2>Subscription providers and limits</h2>
        <p className="muted">
          Choose a provider and use its sign-in option. OpenRouter returns you
          here after authorization. Kimi Code, Kilo Code, GitHub Copilot, Codex,
          and Grok Build use a one-time code. Open the provider page and approve
          the connection; tokens stay encrypted on this server and renew
          automatically when supported. No separate gateway is needed.
        </p>
        <p className="muted">
          Tokens &amp; limits shows observed rate windows and reset times.
          Supported credit balances are shown separately. Providers that do not
          report quotas stay unknown. Account access and quota availability
          depend on the provider.
        </p>
        <a
          className="text-button"
          href="https://github.com/ArnavSingh76533/gateway/blob/main/docs/provider-hub.md"
          target="_blank"
          rel="noreferrer"
        >
          Native sign-in and model preferences guide <ExternalLink size={14} />
        </a>
      </section>
      <div className="two-columns docs-notes">
        <div className="note-panel">
          <h3>Streaming & fallback</h3>
          <p>
            The gateway retries eligible upstream errors before any response
            data has been sent. After streaming starts, an interruption is
            reported in-stream; it never silently combines output from two
            providers.
          </p>
        </div>
        <div className="note-panel">
          <h3>Agent compatibility</h3>
          <p>
            Use OpenAI-compatible mode in OpenCode, Continue, Cline, Cursor, Roo
            Code, or Aider. Some clients also require a model ID. Claude Code
            uses the included Messages bridge. Client-specific features and
            model capabilities still apply.
          </p>
          <a
            className="text-button"
            href="/api/docs"
            target="_blank"
            rel="noreferrer"
          >
            Open API reference <ExternalLink size={14} />
          </a>
        </div>
      </div>
    </>
  );
}
