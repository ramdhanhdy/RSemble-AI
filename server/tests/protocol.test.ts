// @vitest-environment node
// =============================================================================
// CodexProtocolAdapter — deterministic fixture-driven compatibility tests.
//
// Plan 008 Workstream D: the protocol adapter centralizes the Codex protocol
// surface so upstream drift is diagnosable. These tests pin the translation,
// header, event-parse, and failure-classification contracts with synthetic
// fixtures. No live Codex auth or paid calls are used (deterministic only).
// =============================================================================
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CODEX_PROTOCOL_VERSION,
  CODEX_USER_AGENT,
  CODEX_ORIGINATOR,
  CODEX_UPSTREAM_ENDPOINT,
  CODEX_OAUTH_CLIENT_ID,
  CODEX_OAUTH_TOKEN_ENDPOINT,
  CODEX_DEFAULT_MODEL,
  codexResponsesUrl,
  translateToCodexRequestBody,
  buildUpstreamHeaders,
  parseCodexSseEvent,
  isCodexTerminalEvent,
  classifyCodexOutcome,
  CODEX_FAILURE_LABELS,
  isCodexCompatibilityFailure,
} from "../codex-bridge/protocol.js";

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const codexStreamFixture = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, "__fixtures__/codex-stream-events.json"), "utf-8"),
) as {
  "codex-sse": {
    done_sentinel: string;
    delta: { type: string; delta: string };
    done_event: { type: string; text: string };
    created: { type: string; id: string };
    error_shape: { error: { message: string } };
  };
};

// ---------------------------------------------------------------------------
// Protocol constants — centralize so they are updated in exactly one place.
// ---------------------------------------------------------------------------

describe("CodexProtocolAdapter — constants", () => {
  it("centralizes the upstream endpoint and version string", () => {
    expect(CODEX_UPSTREAM_ENDPOINT).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(CODEX_PROTOCOL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("builds the upstream URL with client_version appended", () => {
    expect(codexResponsesUrl()).toBe(
      `https://chatgpt.com/backend-api/codex/responses?client_version=${CODEX_PROTOCOL_VERSION}`,
    );
    expect(codexResponsesUrl("9.9.9")).toBe(
      "https://chatgpt.com/backend-api/codex/responses?client_version=9.9.9",
    );
  });

  it("exposes the OAuth client id and token endpoint", () => {
    expect(CODEX_OAUTH_CLIENT_ID).toMatch(/^app_[A-Za-z0-9]+$/);
    expect(CODEX_OAUTH_TOKEN_ENDPOINT).toBe("https://auth.openai.com/oauth/token");
  });
});

// ---------------------------------------------------------------------------
// Upstream headers — client metadata centralized.
// ---------------------------------------------------------------------------

describe("CodexProtocolAdapter — upstream headers", () => {
  it("emits the Authorization, User-Agent, version, and Originator headers", () => {
    const headers = buildUpstreamHeaders({ token: "t" });
    expect(headers.Authorization).toBe("Bearer t");
    expect(headers["User-Agent"]).toBe(CODEX_USER_AGENT);
    expect(headers.version).toBe(CODEX_PROTOCOL_VERSION);
    expect(headers.Originator).toBe(CODEX_ORIGINATOR);
  });

  it("adds the account header only when an account id is present", () => {
    expect(buildUpstreamHeaders({ token: "t" })["ChatGPT-Account-ID"]).toBeUndefined();
    expect(buildUpstreamHeaders({ token: "t", accountId: "acct-1" })["ChatGPT-Account-ID"]).toBe(
      "acct-1",
    );
  });
});

// ---------------------------------------------------------------------------
// Request translation — bridge OpenAI-compat body -> Codex Responses-API.
// ---------------------------------------------------------------------------

describe("CodexProtocolAdapter — request translation", () => {
  it("translates a plain user prompt into the legacy input shape with a default model and instruction", () => {
    const body = translateToCodexRequestBody({
      model: "",
      messages: [{ role: "user", content: "hello" }],
    });
    expect(body.model).toBe(CODEX_DEFAULT_MODEL);
    expect(body.instructions).toBe("You are a helpful, rigorous assistant.");
    expect(body.input).toEqual([{ role: "user", content: "hello" }]);
  });

  it("splits the system prompt into instructions", () => {
    const body = translateToCodexRequestBody({
      model: "gpt-x",
      messages: [
        { role: "system", content: "Be rigorous." },
        { role: "user", content: "question?" },
      ],
    });
    expect(body.model).toBe("gpt-x");
    expect(body.instructions).toBe("Be rigorous.");
    expect(body.input).toEqual([{ role: "user", content: "question?" }]);
  });

  it("combines multiple system messages in order and keeps non-system messages in input (CR-08)", () => {
    const body = translateToCodexRequestBody({
      model: "gpt-x",
      messages: [
        { role: "system", content: "First." },
        { role: "user", content: "question?" },
        { role: "system", content: "Second." },
      ],
    });
    expect(body.instructions).toBe("First.\n\nSecond.");
    // Only the non-system message participates in input.
    expect(body.input).toEqual([{ role: "user", content: "question?" }]);
  });

  it("maps per-message parts to Responses-API input items", () => {
    const body = translateToCodexRequestBody({
      model: "gpt-x",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "see this" },
            { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
          ],
        },
      ],
    });
    expect(body.input).toEqual([
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "see this" },
          { type: "input_image", image_url: "data:image/png;base64,AAAA" },
        ],
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// SSE event parsing — known upstream response-event forms.
// ---------------------------------------------------------------------------

describe("CodexProtocolAdapter — SSE event parsing", () => {
  it("parses the [DONE] sentinel", () => {
    expect(parseCodexSseEvent("[DONE]")).toEqual({ type: "done" });
  });

  it("parses a text delta event", () => {
    const evt = parseCodexSseEvent(
      JSON.stringify({ type: "response.output_text.delta", delta: "hi" }),
    );
    expect(evt).toEqual({ type: "text_delta", delta: "hi" });
  });

  it("parses a text done event", () => {
    const evt = parseCodexSseEvent(
      JSON.stringify({ type: "response.output_text.done", text: "full" }),
    );
    expect(evt).toEqual({ type: "text_done", text: "full" });
  });

  it("treats malformed or unexpected payloads as 'other' instead of crashing", () => {
    expect(parseCodexSseEvent("not-json").type).toBe("other");
    const unknown = parseCodexSseEvent(JSON.stringify({ type: "response.created", id: "1" }));
    expect(unknown.type).toBe("other");
  });

  it("returns 'other' for JSON primitives without throwing (CR-19)", () => {
    // JSON null would crash the parser before the guard (reading .type on null).
    expect(parseCodexSseEvent("null")).toEqual({ type: "other", payload: null });
    expect(parseCodexSseEvent(JSON.stringify("plain-string")).type).toBe("other");
    expect(parseCodexSseEvent(JSON.stringify(42)).type).toBe("other");
    expect(parseCodexSseEvent(JSON.stringify([1, 2])).type).toBe("other");
  });

  it("exercises the fixture corpus shapes (CR-14)", () => {
    const f = codexStreamFixture["codex-sse"];
    // done_sentinel
    expect(parseCodexSseEvent(f.done_sentinel)).toEqual({ type: "done" });
    // delta
    expect(parseCodexSseEvent(JSON.stringify(f.delta))).toEqual({
      type: "text_delta",
      delta: "Hello, world.",
    });
    // done_event
    expect(parseCodexSseEvent(JSON.stringify(f.done_event))).toEqual({
      type: "text_done",
      text: "Hello, world.",
    });
    // created (non-terminal other)
    const created = parseCodexSseEvent(JSON.stringify(f.created));
    expect(created.type).toBe("other");
    expect(isCodexTerminalEvent(created)).toBe(false);
    // error_shape feeds the protocol-shape classifier evidence
    const d = classifyCodexOutcome({ httpStatus: 400, upstreamErrorBody: f.error_shape });
    expect(d.category).toBe("protocol_shape_changed");
    // done_sentinel and done_event are terminal per the contract
    expect(isCodexTerminalEvent(parseCodexSseEvent(f.done_sentinel))).toBe(true);
    expect(isCodexTerminalEvent(parseCodexSseEvent(JSON.stringify(f.done_event)))).toBe(true);
  });

  it("recognizes the [DONE] sentinel and response.output_text.done as terminal events", () => {
    expect(isCodexTerminalEvent(parseCodexSseEvent("[DONE]"))).toBe(true);
    expect(
      isCodexTerminalEvent(
        parseCodexSseEvent(JSON.stringify({ type: "response.output_text.done", text: "x" })),
      ),
    ).toBe(true);
  });

  it("treats deltas, created, and malformed events as non-terminal", () => {
    expect(
      isCodexTerminalEvent(
        parseCodexSseEvent(JSON.stringify({ type: "response.output_text.delta", delta: "x" })),
      ),
    ).toBe(false);
    expect(
      isCodexTerminalEvent(
        parseCodexSseEvent(JSON.stringify({ type: "response.created", id: "1" })),
      ),
    ).toBe(false);
    expect(isCodexTerminalEvent(parseCodexSseEvent("not-json"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Failure classification — protocol drift must be a distinct diagnosis.
// ---------------------------------------------------------------------------

describe("CodexProtocolAdapter — failure classification", () => {
  it("classifies an unreachable bridge", () => {
    const d = classifyCodexOutcome({ httpStatus: null });
    expect(d.category).toBe("bridge_unavailable");
    expect(d.definite).toBe(true);
  });

  it("classifies auth failures distinctly (401/403)", () => {
    expect(classifyCodexOutcome({ httpStatus: 401 }).category).toBe("auth_unavailable");
    expect(classifyCodexOutcome({ httpStatus: 403 }).category).toBe("auth_unavailable");
  });

  it("classifies model-unavailable on 404", () => {
    expect(classifyCodexOutcome({ httpStatus: 404 }).category).toBe("model_unavailable");
  });

  it("classifies protocol shape change when upstream rejects a 400 with a shape error", () => {
    const d = classifyCodexOutcome({
      httpStatus: 400,
      upstreamErrorBody: { error: { message: "invalid request: unexpected field 'foo'" } },
    });
    expect(d.category).toBe("protocol_shape_changed");
    expect(d.definite).toBe(true);
  });

  it("classifies unexpected stream termination separately", () => {
    const d = classifyCodexOutcome({ httpStatus: 200, streamTerminatedUnexpectedly: true });
    expect(d.category).toBe("stream_terminated_unexpectedly");
  });

  it("does not classify a generic 429 as protocol_shape_changed (no evidence)", () => {
    const d = classifyCodexOutcome({ httpStatus: 429, upstreamErrorBody: "rate limit" });
    expect(d.category).toBeUndefined();
    expect(d.definite).toBe(false);
  });

  it("does not classify a generic 5xx as client_metadata_rejected (no evidence)", () => {
    const d = classifyCodexOutcome({ httpStatus: 500, upstreamErrorBody: "internal error" });
    expect(d.category).toBeUndefined();
    expect(d.definite).toBe(false);
  });

  it("classifies protocol_shape_changed from body evidence (not status alone)", () => {
    const d = classifyCodexOutcome({
      httpStatus: 500,
      upstreamErrorBody: { error: { message: "invalid request: unexpected field" } },
    });
    expect(d.category).toBe("protocol_shape_changed");
    expect(d.definite).toBe(true);
  });

  it("classifies model_unavailable from explicit body evidence", () => {
    const d = classifyCodexOutcome({
      httpStatus: 500,
      upstreamErrorBody: { error: { message: "model gpt-5.6-sol not supported" } },
    });
    expect(d.category).toBe("model_unavailable");
  });

  it("classifies uppercase 'Model not found' as model_unavailable (CR-09)", () => {
    const d = classifyCodexOutcome({
      httpStatus: 400,
      upstreamErrorBody: { error: { message: "Model not found" } },
    });
    expect(d.category).toBe("model_unavailable");
    expect(d.definite).toBe(true);
  });

  it("classifies a bearer-fragment body as a fixed label without leaking the fragment (CR-15)", () => {
    const d = classifyCodexOutcome({
      httpStatus: 401,
      upstreamErrorBody: { error: { message: "unauthorized: bearer abc123secret" } },
    });
    expect(d.category).toBe("auth_unavailable");
    expect(d.reason).not.toContain("abc123secret");
  });

  it("every emitted category is a member of the shared taxonomy (CR-18)", () => {
    for (const key of [
      "bridge_unavailable",
      "auth_unavailable",
      "model_unavailable",
      "protocol_shape_changed",
      "client_metadata_rejected",
      "stream_terminated_unexpectedly",
    ] as const) {
      expect(isCodexCompatibilityFailure(key)).toBe(true);
    }
    expect(isCodexCompatibilityFailure("some_unknown_category")).toBe(false);
    expect(isCodexCompatibilityFailure("")).toBe(false);
    expect(isCodexCompatibilityFailure(undefined)).toBe(false);
    expect(isCodexCompatibilityFailure(42)).toBe(false);
  });

  it("classifies client_metadata_rejected only with client-metadata evidence", () => {
    const d = classifyCodexOutcome({
      httpStatus: 500,
      upstreamErrorBody: { error: { message: "unsupported User-Agent; client version rejected" } },
    });
    expect(d.category).toBe("client_metadata_rejected");
    expect(d.definite).toBe(true);
  });

  it("omits the category when the body is indeterminate", () => {
    const d = classifyCodexOutcome({ httpStatus: 429 });
    expect(d.category).toBeUndefined();
    expect(d.reason.length).toBeGreaterThan(0);
  });

  it("distinguishes each Plan 008 category with a stable human label", () => {
    for (const key of [
      "bridge_unavailable",
      "auth_unavailable",
      "model_unavailable",
      "protocol_shape_changed",
      "client_metadata_rejected",
      "stream_terminated_unexpectedly",
    ] as const) {
      expect(typeof CODEX_FAILURE_LABELS[key]).toBe("string");
      expect(CODEX_FAILURE_LABELS[key].length).toBeGreaterThan(0);
    }
  });
});
