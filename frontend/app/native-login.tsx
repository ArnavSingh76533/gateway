"use client";
import { useEffect, useRef, useState } from "react";
import { ExternalLink, LoaderCircle, ShieldCheck } from "lucide-react";
import { api, providerInfo } from "@/lib/api";
import { Banner } from "./ui";

export type DeviceFlow = {
  flow_id: string;
  verification_url: string;
  user_code: string;
  expires_in: number;
  interval: number;
};

export default function NativeLogin({
  kind,
  flow,
  onConnected,
  onCancel,
}: {
  kind: string;
  flow: DeviceFlow;
  onConnected: (id: string) => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [remaining, setRemaining] = useState(flow.expires_in);
  const completed = useRef(onConnected);
  completed.current = onConnected;
  useEffect(() => {
    let active = true;
    const expiry = Date.now() + flow.expires_in * 1000;
    let timer: ReturnType<typeof setTimeout>;
    const clock = setInterval(
      () => setRemaining(Math.max(0, Math.ceil((expiry - Date.now()) / 1000))),
      1000,
    );
    const poll = async () => {
      if (!active) return;
      if (Date.now() >= expiry) {
        setError("Sign-in expired. Cancel and start again for a new code.");
        return;
      }
      try {
        const result = await api<{
          status: string;
          provider_id?: string;
          interval?: number;
        }>(`/oauth/${kind}/poll`, {
          method: "POST",
          body: JSON.stringify({ flow_id: flow.flow_id }),
        });
        if (!active) return;
        if (result.status === "connected" && result.provider_id) {
          completed.current(result.provider_id);
          return;
        }
        timer = setTimeout(
          poll,
          Math.max(3, result.interval || flow.interval) * 1000,
        );
      } catch (err) {
        if (active) setError((err as Error).message);
      }
    };
    timer = setTimeout(poll, flow.interval * 1000);
    return () => {
      active = false;
      clearTimeout(timer);
      clearInterval(clock);
    };
  }, [kind, flow]);
  async function cancel() {
    setCancelling(true);
    try {
      const result = await api<{ status: string; provider_id?: string }>(
        `/oauth/${kind}/cancel`,
        { method: "POST", body: JSON.stringify({ flow_id: flow.flow_id }) },
      );
      if (result.status === "connected" && result.provider_id)
        completed.current(result.provider_id);
      else onCancel();
    } catch {
      onCancel();
    }
  }
  return (
    <div className="native-login form">
      <ShieldCheck className="accent" size={30} />
      <h3>Authorize {providerInfo[kind].name}</h3>
      <p className="muted">
        Open the provider’s page, sign in, and approve this connection. Your
        password stays with the provider. This gateway stores the resulting
        account tokens encrypted.
      </p>
      {kind === "codex" && (
        <p className="form-note">
          Enable device-code login in your ChatGPT security settings or
          workspace permissions first.
        </p>
      )}
      <label>
        One-time authorization code
        <input
          className="device-code mono"
          readOnly
          value={flow.user_code}
          onFocus={(e) => e.target.select()}
        />
      </label>
      <a
        className="button primary"
        href={flow.verification_url}
        target="_blank"
        rel="noreferrer"
      >
        Open {providerInfo[kind].name} authorization <ExternalLink size={16} />
      </a>
      {!error && (
        <p className="form-note" role="status">
          <LoaderCircle size={16} className="spin" /> Waiting for your approval
          · {Math.floor(remaining / 60)}:
          {String(remaining % 60).padStart(2, "0")} remaining
        </p>
      )}
      {error && <Banner tone="error">{error}</Banner>}
      <button
        type="button"
        className="button"
        disabled={cancelling}
        onClick={() => void cancel()}
      >
        Cancel sign-in
      </button>
    </div>
  );
}
