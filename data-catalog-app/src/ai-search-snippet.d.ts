import type {
  SearchBarSnippet,
  SearchModalSnippet,
  ChatBubbleSnippet,
  ChatPageSnippet,
} from "@cloudflare/ai-search-snippet";
import type { HTMLAttributes, RefAttributes } from "react";

type KebabToCamel<S extends string> = S extends `${infer T}-${infer U}`
  ? `${T}${Capitalize<KebabToCamel<U>>}`
  : S;

type GetObservedAttributes<C> = C extends {
  observedAttributes: readonly (infer P)[];
}
  ? P & string
  : never;

type ReactCustomElement<
  Instance extends HTMLElement,
  Constructor extends { observedAttributes: readonly string[] },
> = {
  [K in GetObservedAttributes<Constructor> as KebabToCamel<K>]?:
    | string
    | number
    | boolean;
} & HTMLAttributes<Instance> &
  RefAttributes<Instance>;

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "search-bar-snippet": ReactCustomElement<
        SearchBarSnippet,
        typeof SearchBarSnippet
      >;
      "search-modal-snippet": ReactCustomElement<
        SearchModalSnippet,
        typeof SearchModalSnippet
      >;
      "chat-bubble-snippet": ReactCustomElement<
        ChatBubbleSnippet,
        typeof ChatBubbleSnippet
      >;
      "chat-page-snippet": ReactCustomElement<
        ChatPageSnippet,
        typeof ChatPageSnippet
      >;
    }
  }
}
