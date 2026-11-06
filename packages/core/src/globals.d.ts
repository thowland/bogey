// Globals that exist in every environment core supports (modern browsers, workers, Node 22+).
// Core's tsconfig excludes the DOM and Node type libraries; anything used from the host
// environment must be declared here, which keeps the cross-environment surface explicit.

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
  readonly encoding: string;
  decode(input?: Uint8Array, options?: { stream?: boolean }): string;
}
