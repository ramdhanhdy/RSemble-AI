// =============================================================================
// OpenAI-style content mapping — attachments plan 7.3.3 / 7.4.2
//
// Shared by every OpenAI-compatible transport (OpenRouter, openai-compat and
// the bridges that inherit its shape). The critical invariant: a plain string
// passes through UNCHANGED so attachment-free request bodies stay byte-identical
// to what they were before the attachments feature existed.
// =============================================================================

import type { ChatMessage, ContentPart } from "./types";

/** Wire shape of one content part on an OpenAI-style request. */
export type OpenAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

/** Wire shape of a message after content mapping. */
export interface OpenAIMessage {
  role: ChatMessage["role"];
  content: string | OpenAIContentPart[];
}

function toOpenAIPart(part: ContentPart): OpenAIContentPart {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };
    case "image":
      return { type: "image_url", image_url: { url: `data:${part.mimeType};base64,${part.data}` } };
    case "file":
      return {
        type: "file",
        file: { filename: part.filename, file_data: `data:${part.mimeType};base64,${part.data}` },
      };
  }
}

/**
 * Map a message's content to the OpenAI wire shape.
 * `string` content is returned as-is; `ContentPart[]` becomes the typed array.
 */
export function toOpenAIContent(content: string | ContentPart[]): string | OpenAIContentPart[] {
  if (typeof content === "string") return content;
  return content.map(toOpenAIPart);
}

/**
 * Flatten message content to a plain string. String content passes through;
 * `ContentPart[]` joins the text parts with newlines and drops binary parts
 * (image/file data has no text projection). Used where a consumer needs a
 * string view — token estimates, blindness scans, judge prompt assembly.
 */
export function contentToText(content: string | ContentPart[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

/** Map a full message list, preserving roles. */
export function toOpenAIMessages(messages: ChatMessage[]): OpenAIMessage[] {
  return messages.map((m) => ({ role: m.role, content: toOpenAIContent(m.content) }));
}
