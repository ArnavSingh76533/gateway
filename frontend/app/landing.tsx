"use client";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Code2,
  Gauge,
  Github,
  KeyRound,
  Layers3,
  Network,
  ShieldCheck,
  Sparkles,
  Waypoints,
} from "lucide-react";
import { providerDirectory, User } from "@/lib/api";
import { SiteOptions } from "@/lib/site";

export default function Landing({
  site,
  user,
  onSignIn,
}: {
  site: SiteOptions;
  user: User | null;
  onSignIn: () => void;
}) {
  const direct = providerDirectory.filter(
    (p) => p.integration === "direct",
  ).length;
  return (
    <div className="landing" data-accent={site.accent}>
      <a className="skip-link" href="#landing-main">
        Skip to content
      </a>
      <header className="landing-nav">
        <a className="brand" href="#home">
          <span className="brand-mark">{site.site_name.slice(0, 1)}</span>
          <span className="landing-brand-name">{site.site_name.toLowerCase()}</span>
          <span className="brand-period">.</span>
        </a>
        <nav aria-label="Site navigation">
          <a href="#providers">Providers</a>
          <a href="#docs">Documentation</a>
          <a
            href="https://github.com/ArnavSingh76533/gateway"
            target="_blank"
            rel="noreferrer"
            aria-label="Gateway on GitHub"
          >
            <Github size={18} />
          </a>
        </nav>
        {user ? (
          <a className="button" href="#overview">
            Workspace <ArrowRight size={15} />
          </a>
        ) : (
          <button className="button" onClick={onSignIn}>
            Sign in <ArrowRight size={15} />
          </button>
        )}
      </header>
      <main id="landing-main">
        <section className="landing-hero">
          <div className="hero-copy">
            <span className="hero-pill">
              <span /> YOUR AI. YOUR CONNECTIONS.
            </span>
            <h1>
              Every model.
              <br />
              <span>One clear path.</span>
            </h1>
            <p>
              Bring your AI providers together. Connect your keys, choose the
              model, and give every app one endpoint to work with.
            </p>
            <div className="hero-actions">
              {user ? (
                <a className="button primary" href="#overview">
                  Open your workspace <ArrowRight size={17} />
                </a>
              ) : (
                <button className="button primary" onClick={onSignIn}>
                  Build your gateway <ArrowRight size={17} />
                </button>
              )}
              <a className="button hero-secondary" href="#overview">
                Explore the demo <ChevronRight size={16} />
              </a>
            </div>
            <div className="hero-proof">
              <span>
                <Check size={14} /> Your keys, encrypted
              </span>
              <span>
                <Check size={14} /> OpenAI-compatible
              </span>
            </div>
          </div>
          <div
            className="routing-preview"
            aria-label="Illustration of apps connecting to multiple providers through one gateway"
          >
            <div className="preview-top">
              <span>
                <i />
                <i />
                <i />
              </span>
              <small>ONE ENDPOINT. MORE POSSIBILITIES.</small>
            </div>
            <div className="route-apps">
              <span>
                <Code2 size={17} /> Your app
              </span>
              <span>
                <Sparkles size={17} /> AI tools
              </span>
              <span>
                <TerminalIcon /> Agents
              </span>
            </div>
            <div className="route-trunk" />
            <div className="route-hub">
              <span className="hub-icon">
                <Network size={28} />
              </span>
              <div>
                <strong>{site.site_name}</strong>
                <small>Your universal AI gateway</small>
              </div>
              <span className="hub-label">/v1</span>
            </div>
            <div className="route-branches">
              <span />
              <span />
              <span />
            </div>
            <div className="route-destinations">
              <div>
                <span className="destination-or">↗</span>
                <strong>OpenRouter</strong>
                <small>API key / OAuth</small>
              </div>
              <div>
                <span className="destination-groq">g</span>
                <strong>Groq</strong>
                <small>API key</small>
              </div>
              <div>
                <Waypoints size={24} />
                <strong>Private 9router</strong>
                <small>Subscriptions</small>
              </div>
            </div>
            <div className="preview-code">
              <span>client.chat.completions.create(</span>
              <br />
              &nbsp; model=<b>"your-connection::model"</b>
              <br />
              <span>)</span>
              <small>Choose the provider. Keep your app code.</small>
            </div>
          </div>
        </section>
        <section
          className="landing-provider-strip"
          aria-label="Provider examples"
        >
          <p>ONE PLACE FOR THE PROVIDERS YOU ALREADY USE</p>
          <div>
            <span>↗ OpenRouter</span>
            <span>groq</span>
            <span>✦ Google</span>
            <span>DeepSeek</span>
            <span>Anthropic</span>
            <span>NVIDIA NIM</span>
          </div>
        </section>
        <section className="landing-section">
          <div className="section-intro">
            <span className="eyebrow">CONNECTED, ON YOUR TERMS</span>
            <h2>
              Less setup.
              <br />
              More room to build.
            </h2>
            <p>
              Different providers, one familiar workflow. Keep each connection
              separate and choose exactly where a request goes.
            </p>
          </div>
          <div className="landing-feature-grid">
            <article>
              <span className="feature-icon">
                <KeyRound size={22} />
              </span>
              <h3>Bring your API keys</h3>
              <p>
                {direct} direct connectors, plus custom OpenAI-compatible
                endpoints. Discover models and find them in a searchable
                playground.
              </p>
              <a href="#providers">
                Explore providers <ArrowRight size={15} />
              </a>
            </article>
            <article>
              <span className="feature-icon">
                <Waypoints size={22} />
              </span>
              <h3>Connect your subscriptions</h3>
              <p>
                Sign in with OpenRouter, or connect a private 9router instance
                for supported subscription accounts and their models.
              </p>
              <a href="#providers">
                Find your connection <ArrowRight size={15} />
              </a>
            </article>
            <article>
              <span className="feature-icon">
                <Layers3 size={22} />
              </span>
              <h3>Pick the model. And the route.</h3>
              <p>
                The same model can live on multiple providers. Select a specific
                connection, or use automatic routing for compatible models.
              </p>
              <a href="#models">
                Open model explorer <ArrowRight size={15} />
              </a>
            </article>
          </div>
        </section>
        <section className="landing-limits">
          <div>
            <span className="eyebrow">KNOW WHERE YOU STAND</span>
            <h2>
              A clearer view
              <br />
              of your limits.
            </h2>
            <p>
              See remaining tokens and reset times when providers report them.
              Check supported credit balances and track usage through your
              gateway.
            </p>
            <a className="button" href="#quotas">
              Explore token limits <ArrowRight size={16} />
            </a>
            <small>
              Availability varies by provider. Unreported limits stay unknown.
            </small>
          </div>
          <div className="limit-preview">
            <div className="limit-preview-title">
              <span>
                <Gauge size={18} /> Provider limits
              </span>
              <small>ILLUSTRATIVE PREVIEW</small>
            </div>
            <div className="limit-preview-provider">
              <strong>Groq</strong>
              <span>Tokens per minute</span>
            </div>
            <div className="limit-preview-value">
              20,400 <span>/ 30,000 left</span>
            </div>
            <div className="limit-meter">
              <span />
            </div>
            <div className="limit-preview-bottom">
              <span>Reported by provider</span>
              <span>
                Resets in <b>1m 42s</b>
              </span>
            </div>
            <div className="limit-preview-note">
              <ShieldCheck size={16} />
              <span>Credit balances and rate limits shown separately.</span>
            </div>
          </div>
        </section>
        <section className="landing-section landing-steps">
          <div className="section-intro">
            <span className="eyebrow">FROM CONNECTION TO COMPLETION</span>
            <h2>Three steps to your next idea.</h2>
          </div>
          <div>
            {[
              {
                n: "01",
                title: "Connect a provider",
                copy: "Add an API key, use OpenRouter sign-in, or link your private 9router.",
              },
              {
                n: "02",
                title: "Find your model",
                copy: "Search your catalog, compare available routes, and try a prompt.",
              },
              {
                n: "03",
                title: "Build with one endpoint",
                copy: "Create a gateway key and point your app at the OpenAI-compatible API.",
              },
            ].map((step) => (
              <article key={step.n}>
                <span>{step.n}</span>
                <h3>{step.title}</h3>
                <p>{step.copy}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="landing-cta">
          <span className="eyebrow">YOUR WORKSPACE IS READY</span>
          <h2>Make your AI work together.</h2>
          <a
            className="button primary"
            href={user ? "#overview" : "#providers"}
          >
            Explore your connections <ArrowRight size={17} />
          </a>
        </section>
      </main>
      <footer className="landing-footer">
        <a className="brand" href="#home">
          {site.site_name.toLowerCase()}
          <span className="brand-period">.</span>
        </a>
        <span>One gateway. Your choice of AI.</span>
        <a href="#docs">Documentation</a>
        <a
          href="https://github.com/ArnavSingh76533/gateway"
          target="_blank"
          rel="noreferrer"
        >
          Source on GitHub ↗
        </a>
      </footer>
    </div>
  );
}
function TerminalIcon() {
  return (
    <span className="mono" aria-hidden="true">
      &gt;_
    </span>
  );
}
